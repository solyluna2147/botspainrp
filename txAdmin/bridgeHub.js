// ============================================================================
// MÓDULO TXADMIN: PUENTE SEGURO REVERSE-RPC (HTTPS LONG-POLLING + HMAC-SHA256)
// ============================================================================
// Permite conectar cada servidor FiveM (en PC local o VPS) con el bot en Railway
// SIN abrir puertos entrantes ni exponer txAdmin a Internet y SIN dependencias npm extra.

const crypto = require('crypto');
const express = require('express');
const guildManager = require('../guildManager');

const POLL_TIMEOUT_MS = 25000;
const MAX_CLOCK_SKEW_MS = 60000;
const BRIDGE_ONLINE_TTL_MS = 45000;

// Estado aislado por servidor (guildId -> estado del puente)
const bridgeStates = new Map();
// Colas de peticiones pendientes por servidor (guildId -> [{ id, action, payload, resolve, reject, timer, createdAt }])
const pendingQueues = new Map();
// Peticiones ya entregadas al puente esperando respuesta (reqId -> { guildId, resolve, reject, timer, startedAt })
const inFlightRequests = new Map();
// Conexiones long-poll esperando trabajo ahora mismo (guildId -> { res, timer })
const waitingPollers = new Map();

function getBridgeSecretForGuild(guildId) {
    if (!guildId) return '';
    const gId = String(guildId);
    const cfg = guildManager.getGuildConfig(gId) || {};
    if (cfg.TX_BRIDGE_SECRET && String(cfg.TX_BRIDGE_SECRET).trim()) {
        return String(cfg.TX_BRIDGE_SECRET).trim();
    }
    const perGuildEnv = process.env[`TX_BRIDGE_SECRET_${gId}`];
    if (perGuildEnv && perGuildEnv.trim()) return perGuildEnv.trim();
    if (guildManager.isPrimaryGuild(gId) && process.env.TX_BRIDGE_SECRET && process.env.TX_BRIDGE_SECRET.trim()) {
        return process.env.TX_BRIDGE_SECRET.trim();
    }
    return '';
}

function generateBridgeSecret() {
    return crypto.randomBytes(32).toString('hex');
}

function computeSignature(secret, timestamp, rawBody) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${rawBody || ''}`)
        .digest('hex');
}

function safeEqualHex(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch (_) {
        return false;
    }
}

function verifyBridgeRequest(req) {
    const guildId = String(req.headers['x-tx-guild-id'] || '').trim();
    const timestamp = String(req.headers['x-tx-timestamp'] || '').trim();
    const signature = String(req.headers['x-tx-signature'] || '').trim();
    const authHeader = String(req.headers['authorization'] || '').trim();
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!guildId || !timestamp || !signature || !bearer) {
        return { ok: false, error: 'Cabeceras de autenticación incompletas' };
    }

    const secret = getBridgeSecretForGuild(guildId);
    if (!secret) {
        return { ok: false, error: 'Servidor sin TX_BRIDGE_SECRET configurado (usa !tx-setup)' };
    }

    if (!safeEqualHex(bearer, secret)) {
        return { ok: false, error: 'Token de puente inválido' };
    }

    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_CLOCK_SKEW_MS) {
        return { ok: false, error: 'Timestamp expirado o reloj desincronizado' };
    }

    const rawBody = typeof req.rawBodyStr === 'string' ? req.rawBodyStr : '';
    const expected = computeSignature(secret, timestamp, rawBody);
    if (!safeEqualHex(signature, expected)) {
        return { ok: false, error: 'Firma HMAC inválida' };
    }

    return { ok: true, guildId };
}

function touchBridgeState(guildId, patch = {}) {
    const gId = String(guildId);
    const prev = bridgeStates.get(gId) || {
        guildId: gId,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        latencyMs: null,
        readOnlyMode: false,
        info: {},
        sessions: []
    };
    const next = {
        ...prev,
        ...patch,
        lastSeenAt: Date.now(),
        info: { ...(prev.info || {}), ...(patch.info || {}) }
    };
    bridgeStates.set(gId, next);
    return next;
}

function getBridgeStatus(guildId) {
    const gId = String(guildId || '');
    const st = bridgeStates.get(gId);
    const secretConfigured = Boolean(getBridgeSecretForGuild(gId));
    const cfg = guildManager.getGuildConfig(gId) || {};
    const readOnlyMode = Boolean(cfg.TX_READ_ONLY_MODE);

    if (!st) {
        return {
            online: false,
            secretConfigured,
            readOnlyMode,
            lastSeenAt: null,
            latencyMs: null,
            info: {},
            sessions: []
        };
    }

    const online = (Date.now() - st.lastSeenAt) <= BRIDGE_ONLINE_TTL_MS || waitingPollers.has(gId);
    return {
        online,
        secretConfigured,
        readOnlyMode,
        connectedAt: st.connectedAt,
        lastSeenAt: st.lastSeenAt,
        latencyMs: st.latencyMs,
        info: st.info || {},
        sessions: Array.isArray(st.sessions) ? st.sessions : []
    };
}

function flushNextToPoller(guildId) {
    const gId = String(guildId);
    const poller = waitingPollers.get(gId);
    const queue = pendingQueues.get(gId);
    if (!poller || !queue || queue.length === 0) return false;

    const job = queue.shift();
    clearTimeout(poller.timer);
    waitingPollers.delete(gId);

    inFlightRequests.set(job.id, {
        guildId: gId,
        resolve: job.resolve,
        reject: job.reject,
        timer: job.timer,
        startedAt: Date.now()
    });

    try {
        poller.res.json({
            ok: true,
            job: {
                id: job.id,
                action: job.action,
                payload: job.payload
            }
        });
    } catch (_) {
        // Si el socket se cerró justo antes de responder, reencolar si aún no venció
        inFlightRequests.delete(job.id);
        queue.unshift(job);
    }
    return true;
}

/**
 * Envía una orden al puente local/VPS de un servidor específico y espera su resultado.
 */
function dispatchToBridge(guildId, action, payload = {}, timeoutMs = 20000) {
    const gId = String(guildId || '');
    const status = getBridgeStatus(gId);
    if (!status.secretConfigured) {
        return Promise.reject(new Error('Este servidor todavía no tiene configurado el puente txAdmin. El creador debe usar `!tx-setup`.'));
    }
    if (!status.online) {
        return Promise.reject(new Error('El puente local/VPS de txAdmin está desconectado en este momento. Enciende `txBridge` en la máquina del servidor FiveM.'));
    }

    return new Promise((resolve, reject) => {
        const reqId = `tx_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
        const timer = setTimeout(() => {
            // Limpiar de pendingQueues o inFlightRequests
            const q = pendingQueues.get(gId);
            if (q) {
                const idx = q.findIndex(item => item.id === reqId);
                if (idx !== -1) q.splice(idx, 1);
            }
            inFlightRequests.delete(reqId);
            reject(new Error(`Tiempo de espera agotado (${Math.round(timeoutMs / 1000)}s) esperando respuesta del puente txAdmin.`));
        }, timeoutMs);

        if (!pendingQueues.has(gId)) pendingQueues.set(gId, []);
        pendingQueues.get(gId).push({
            id: reqId,
            action,
            payload,
            resolve,
            reject,
            timer,
            createdAt: Date.now()
        });

        flushNextToPoller(gId);
    });
}

function mountBridgeRoutes(app, onBridgeEvent = null) {
    if (!app) return;

    const router = express.Router();

    // Capturar rawBody exacto para verificación HMAC-SHA256
    router.use(express.json({
        limit: '4mb',
        verify: (req, _res, buf) => {
            req.rawBodyStr = buf ? buf.toString('utf8') : '';
        }
    }));

    // Middleware de seguridad HMAC + Bearer por servidor
    router.use((req, res, next) => {
        const check = verifyBridgeRequest(req);
        if (!check.ok) {
            return res.status(401).json({ ok: false, error: check.error });
        }
        req.txGuildId = check.guildId;
        next();
    });

    // 1. Registro inicial / reconexión del puente
    router.post('/register', (req, res) => {
        const gId = req.txGuildId;
        const body = req.body || {};
        touchBridgeState(gId, {
            connectedAt: Date.now(),
            info: {
                bridgeVersion: body.bridgeVersion || '1.0.0',
                mode: body.mode || 'local',
                hostname: body.hostname || 'FiveM Host',
                txAdminUrl: body.txAdminUrl || 'http://127.0.0.1:40120',
                hasPlayersDb: Boolean(body.hasPlayersDb),
                hasFxLog: Boolean(body.hasFxLog),
                hasAdminLog: Boolean(body.hasAdminLog),
                hasLuaHook: Boolean(body.hasLuaHook),
                framework: body.framework || 'none'
            },
            sessions: Array.isArray(body.sessions) ? body.sessions : []
        });
        console.log(`🔗 [TX-BRIDGE] Puente conectado para guild ${gId} (${body.hostname || 'host'} • modo: ${body.mode || 'local'}).`);
        res.json({ ok: true, serverTime: Date.now() });
    });

    // 2. Heartbeat periódico + sincronización de lista de sesiones activas y eventos del recurso Lua
    router.post('/heartbeat', (req, res) => {
        const gId = req.txGuildId;
        const body = req.body || {};
        const patch = {};
        if (body.info && typeof body.info === 'object') patch.info = body.info;
        if (Array.isArray(body.sessions)) patch.sessions = body.sessions;
        touchBridgeState(gId, patch);

        if (body.event && typeof onBridgeEvent === 'function') {
            Promise.resolve(onBridgeEvent(gId, body.event)).catch(() => {});
        }
        res.json({ ok: true, serverTime: Date.now() });
    });

    // 3. Long-Polling saliente: el puente espera órdenes en tiempo real sin abrir puertos
    router.get('/poll', (req, res) => {
        const gId = req.txGuildId;
        touchBridgeState(gId);

        // Si había un poller anterior colgado para este mismo servidor, cerrarlo limpio
        const prev = waitingPollers.get(gId);
        if (prev) {
            clearTimeout(prev.timer);
            try { prev.res.json({ ok: true, job: null }); } catch (_) {}
            waitingPollers.delete(gId);
        }

        // Si ya hay un trabajo esperando en cola, entregarlo al instante (0ms)
        const queue = pendingQueues.get(gId);
        if (queue && queue.length > 0) {
            const job = queue.shift();
            inFlightRequests.set(job.id, {
                guildId: gId,
                resolve: job.resolve,
                reject: job.reject,
                timer: job.timer,
                startedAt: Date.now()
            });
            return res.json({
                ok: true,
                job: {
                    id: job.id,
                    action: job.action,
                    payload: job.payload
                }
            });
        }

        const timer = setTimeout(() => {
            if (waitingPollers.get(gId)?.res === res) {
                waitingPollers.delete(gId);
            }
            try { res.json({ ok: true, job: null }); } catch (_) {}
        }, POLL_TIMEOUT_MS);

        waitingPollers.set(gId, { res, timer });

        req.on('close', () => {
            if (waitingPollers.get(gId)?.res === res) {
                clearTimeout(timer);
                waitingPollers.delete(gId);
            }
        });
    });

    // 4. Recepción del resultado de una orden ejecutada por el puente
    router.post('/result', (req, res) => {
        const gId = req.txGuildId;
        const { id, ok, data, error, sessions } = req.body || {};

        const patch = {};
        if (Array.isArray(sessions)) patch.sessions = sessions;

        const flight = inFlightRequests.get(id);
        if (flight && flight.guildId === gId) {
            const latency = Date.now() - flight.startedAt;
            patch.latencyMs = latency;
            touchBridgeState(gId, patch);

            clearTimeout(flight.timer);
            inFlightRequests.delete(id);
            if (ok) {
                flight.resolve(data);
            } else {
                flight.reject(new Error(error || 'Error ejecutando operación en el puente txAdmin.'));
            }
        } else {
            touchBridgeState(gId, patch);
        }

        res.json({ ok: true });
    });

    app.use('/api/tx-bridge', router);
    console.log('🛡️ [TXADMIN] Endpoints seguros del puente montados en /api/tx-bridge/*');
}

module.exports = {
    getBridgeSecretForGuild,
    generateBridgeSecret,
    getBridgeStatus,
    dispatchToBridge,
    mountBridgeRoutes
};
