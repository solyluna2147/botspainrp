// ==========================================
// MÓDULO INDEPENDIENTE: WEB DASHBOARD PRÉMIUM COMPLETO (OAUTH2 + DATOS EN VIVO)
// ==========================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const guildManager = require('./guildManager');

const GUILD_CONFIGS_FILE = path.join(__dirname, 'guild_configs.json');
const SESSION_COOKIE = 'vyre_dash_session';
const SESSION_SECRET = process.env.DASHBOARD_SECRET || crypto.createHash('sha256').update((process.env.DISCORD_TOKEN || 'dash_secret_key') + '_vyre_dash').digest('hex');

const sessions = new Map();

function safeReadJson(filename, fallback) {
    try {
        const p = path.join(__dirname, filename);
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) { }
    return fallback;
}

function readGuildConfigs() {
    return safeReadJson('guild_configs.json', {});
}

function saveGuildConfigs(allConfigs) {
    try {
        fs.writeFileSync(GUILD_CONFIGS_FILE, JSON.stringify(allConfigs, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ [DASHBOARD] Error guardando guild_configs.json:', e.message);
    }
}

function signSessionId(sid) {
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('hex').slice(0, 24);
    return `${sid}.${sig}`;
}

function verifySessionCookie(cookieHeader) {
    if (!cookieHeader) return null;
    const match = cookieHeader.split(';').map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`));
    if (!match) return null;
    const raw = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [sid, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('hex').slice(0, 24);
    if (sig !== expected) return null;
    const session = sessions.get(sid);
    if (!session) return null;
    if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(sid);
        return null;
    }
    return { sid, ...session };
}

function getBaseUrl(req) {
    if (process.env.DASHBOARD_URL && process.env.DASHBOARD_URL.trim()) {
        return process.env.DASHBOARD_URL.trim().replace(/\/+$/, '');
    }
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
}

function getConfiguredAiKeyCount() {
    let count = 0;
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) count++;
    for (let i = 2; i <= 25; i++) {
        if (process.env[`GROQ_API_KEY_${i}`] && process.env[`GROQ_API_KEY_${i}`].trim()) count++;
    }
    return count;
}

function buildDemoGuilds() {
    return [
        { id: 'demo_guild_1', name: 'TU SERVIDOR RP 🇪🇸', iconUrl: null, initials: 'TS', hasBot: true, memberCount: 1482, isDemo: true },
        { id: 'demo_guild_2', name: 'MADRID CITY ROLEPLAY', iconUrl: null, initials: 'MC', hasBot: true, memberCount: 846, isDemo: true },
        { id: 'demo_guild_3', name: 'COMUNIDAD FIVEM DEV', iconUrl: null, initials: 'CF', hasBot: false, memberCount: 215, isDemo: true }
    ];
}

function buildDemoMeta(guildId) {
    return {
        guild: {
            id: guildId,
            name: guildId === 'demo_guild_2' ? 'MADRID CITY ROLEPLAY' : 'TU SERVIDOR RP 🇪🇸',
            memberCount: guildId === 'demo_guild_2' ? 846 : 1482,
            iconUrl: null
        },
        textChannels: [
            { id: 'ch_consultas_staff', name: '🧠┃consultas-staff' },
            { id: 'ch_consultas_users', name: '📚┃consultas-normativa' },
            { id: 'ch_logs_consultas', name: '📜┃logs-consultas' },
            { id: 'ch_stream_panel', name: '🟣┃panel-directos' },
            { id: 'ch_streamers', name: '🔴┃directos-en-vivo' },
            { id: 'ch_eventos_panel', name: '🎉┃panel-eventos' },
            { id: 'ch_eventos_1', name: '🔥┃eventos-oficiales' },
            { id: 'ch_eventos_2', name: '📢┃anuncios-eventos' },
            { id: 'ch_sanciones_panel', name: '🚨┃panel-sanciones' },
            { id: 'ch_sanciones', name: '⚖️┃registro-sanciones' },
            { id: 'ch_val_panel', name: '⭐┃panel-valoraciones' },
            { id: 'ch_valoraciones', name: '🏆┃valoraciones-staff' },
            { id: 'ch_solicitudes', name: '📋┃solicitudes-wl' },
            { id: 'ch_aprobados', name: '✅┃wl-aprobadas' },
            { id: 'ch_denegados', name: '❌┃wl-denegadas' },
            { id: 'ch_bienvenidas', name: '👋┃bienvenidas' },
            { id: 'ch_normativas', name: '📖┃normativas' },
            { id: 'ch_general', name: '💬┃chat-general' },
            { id: 'ch_tickets', name: '🎫┃abrir-ticket' },
            { id: 'ch_dashboards', name: '🖥️┃estado-del-bot' }
        ],
        voiceChannels: [
            { id: 'vc_espera', name: '⏳┃Espera de Soporte' },
            { id: 'vc_soporte_1', name: '🛡️┃Sala Soporte 1' },
            { id: 'vc_soporte_2', name: '🛡️┃Sala Soporte 2' },
            { id: 'vc_charla', name: '💬┃Sala de Charla Staff' }
        ],
        roles: [
            { id: 'role_admin', name: '⚡┃Administrador', color: '#D900FF' },
            { id: 'role_mod', name: '🔰┃Moderador', color: '#00F0FF' },
            { id: 'role_soporte', name: '🔎┃Soporte', color: '#2ECC71' },
            { id: 'role_streamer', name: '🟣┃Streamer Oficial', color: '#9146FF' }
        ]
    };
}

function buildDemoFullData() {
    return {
        stats: {
            ramMb: 112,
            uptimeSeconds: 124560,
            ping: 18,
            textChannelsCount: 20,
            voiceChannelsCount: 4,
            rolesCount: 16,
            onlineMembers: 318,
            openTicketsCount: 3,
            aiKeysCount: Math.max(getConfiguredAiKeyCount(), 13),
            aiDailyTokens: Math.max(getConfiguredAiKeyCount(), 13) * 600000
        },
        topStaff: [
            { id: '1', name: '(Tag Staff 1)', average: 9.9, totalRatings: 42 },
            { id: '2', name: '(Tag Staff 2)', average: 9.6, totalRatings: 31 },
            { id: '3', name: '(Tag Staff 3)', average: 9.4, totalRatings: 24 },
            { id: '4', name: '(Tag Staff 4)', average: 9.1, totalRatings: 18 }
        ],
        recentRatings: [
            { staffName: '(Tag Staff 1)', userName: '(Tag Usuario)', rating: 10, comment: 'Atención rapidísima y súper amable en soporte.', timestamp: new Date().toISOString() },
            { staffName: '(Tag Staff 2)', userName: '(Tag Usuario)', rating: 9, comment: 'Resolvió mi ticket de apelación en 2 minutos.', timestamp: new Date().toISOString() }
        ],
        sanciones: [
            { id: '4821', targetTag: '(Tag Usuario)', reporterTag: '(Tag Staff 1)', punishment: 'Ban temporal — 3 días', reason: 'Combat Logging (desconexión en rol activo).', timestamp: new Date().toISOString() },
            { id: '4820', targetTag: '(Tag Usuario 2)', reporterTag: '(Tag Staff 2)', punishment: '1 Warn Oficial', reason: 'Incumplimiento de zona segura.', timestamp: new Date().toISOString() }
        ],
        eventos: [
            { id: '901', title: 'GRAN TORNEO DE DRIFT NOCTURNO', hora: '22:30 (España)', lugar: 'Puerto Industrial', organiza: 'Administración', description: 'Premio de 250.000$ IC + vehículo exclusivo.', timestamp: new Date().toISOString() }
        ],
        streamers: [
            { userId: '1', name: '(Tag Streamer 1)', twitchUrl: 'https://twitch.tv/ejemplo1', kickUrl: '', tiktokUrl: '', title: 'Rol serio en TU SERVIDOR RP 🔥' },
            { userId: '2', name: '(Tag Streamer 2)', twitchUrl: '', kickUrl: 'https://kick.com/ejemplo2', tiktokUrl: '', title: 'Directo nocturno en la ciudad' }
        ],
        openTickets: [
            { id: 't1', name: 'ticket-soporte-0412', category: 'Soporte General' },
            { id: 't2', name: 'apelacion-ban-0192', category: 'Apelaciones' },
            { id: 't3', name: 'donacion-vip-0084', category: 'Donaciones' }
        ],
        voiceActive: [
            { channelName: '⏳┃Espera de Soporte', members: ['(Tag Usuario)'] },
            { channelName: '🛡️┃Sala Soporte 1', members: ['(Tag Staff 1)', '(Tag Staff 2)'] }
        ],
        audios: [
            { label: 'Aviso Staff 1 (Espera)', ok: true },
            { label: 'Aviso Staff 2 (Recordatorio)', ok: true },
            { label: 'Locución Usuarios (Bienvenida)', ok: true },
            { label: 'Aviso 3 (Sanción Staff)', ok: true },
            { label: 'Locución Sala de Charla', ok: true }
        ],
        plantillas: [
            { key: 'negocio', nombre: 'Postulación Negocio', emoji: '💼' },
            { key: 'mafia', nombre: 'Postulación Mafia', emoji: '💀' },
            { key: 'banda', nombre: 'Postulación Banda', emoji: '🏴‍☠️' },
            { key: 'staff', nombre: 'Postulación Staff', emoji: '🛡️' },
            { key: 'streamer', nombre: 'Postulación Streamer', emoji: '🎥' }
        ]
    };
}

const SAFE_CONFIG_KEYS = [
    'BRAND_NAME', 'BRAND_COLOR', 'ASSETS_FOLDER', 'PREFIX', 'FIVEM_CFX_CODE',
    'LOGO_URL', 'BANNER_DIRECTOS_URL', 'BANNER_EVENTOS_URL', 'BANNER_VALORACIONES_URL',
    'BANNER_TOPS_URL', 'BANNER_SANCIONES_URL', 'BANNER_PLANTILLAS_URL',
    'BANNER_BIENVENIDA_URL', 'BANNER_CONSULTAS_URL', 'BANNER_APROBADO_URL', 'BANNER_DENEGADO_URL',
    'AI_ENABLED', 'AI_AUTOCLEAN_SECONDS', 'TICKETS_AI_ENABLED',
    'LOCUCION_ENABLED', 'LOCUCION_INTERVAL_SEC', 'ANTI_IA_WL_ENABLED', 'ASCENSOS_ENABLED',
    'CHANNEL_CONSULTAS_STAFF_ID', 'CHANNEL_CONSULTAS_USERS_ID', 'CHANNEL_CONSULTAS_LOGS_ID',
    'CHANNEL_STREAM_PANEL_ID', 'CHANNEL_STREAMERS_ID',
    'CHANNEL_EVENTOS_PANEL_ID', 'CHANNEL_EVENTOS_ID', 'CHANNEL_EVENTOS_2_ID',
    'CHANNEL_SANCIONES_PANEL_ID', 'CHANNEL_SANCIONES_ID',
    'CHANNEL_VALORACION_PANEL_ID', 'CHANNEL_VALORACIONES_ID',
    'CHANNEL_SOLICITUDES_ID', 'CHANNEL_APROBADOS_ID', 'CHANNEL_DENEGADOS_ID',
    'CHANNEL_BIENVENIDAS_ID', 'CHANNEL_NORMATIVAS_ID', 'CHANNEL_GENERAL_ID', 'CHANNEL_TICKETS_ID',
    'ROLE_STREAMER_ID', 'ROLE_STAFF_ID', 'VOICE_ESPERA_ID', 'VOICE_CHARLA_ID'
];

function pickSafeConfig(obj = {}) {
    const out = {};
    for (const k of SAFE_CONFIG_KEYS) {
        if (obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
}

function buildCookieHeader(req, value, maxAge = 86400) {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps ? '; Secure' : ''}`;
}

module.exports = function initDashboardServer(app, client, options = {}) {
    const getBotConfig = options.getBotConfig || (() => ({}));
    const updateBotConfig = options.updateBotConfig || (async () => {});

    app.use(express.json({ limit: '1mb' }));

    // Cabeceras de seguridad HTTP estrictas + anti-caché en /api
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            res.setHeader('Pragma', 'no-cache');
        }
        next();
    });

    const dashboardDir = path.join(__dirname, 'dashboard');
    app.use('/dashboard-static', express.static(dashboardDir));

    app.get(['/', '/dashboard'], (req, res) => {
        const indexPath = path.join(dashboardDir, 'index.html');
        if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
        return res.status(200).send('🚀 Dashboard activo.');
    });

    app.get('/api/status', (req, res) => {
        const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id || '';
        const totalMembers = client.guilds?.cache?.reduce((acc, g) => acc + (g.memberCount || 0), 0) || 0;

        // Nunca exponer API keys, tokens, proveedores ni secretos al navegador
        res.json({
            online: Boolean(client.isReady && client.isReady()),
            botName: client.user?.username || 'VYRE CORE',
            ping: Math.max(0, Math.round(client.ws?.ping || 0)),
            uptimeSeconds: Math.floor(process.uptime()),
            guildsCount: client.guilds?.cache?.size || 0,
            totalMembers,
            aiStatus: 'Óptimo 24/7',
            inviteUrl: clientId
                ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`
                : null
        });
    });

    app.post('/api/demo-login', (req, res) => {
        const sid = crypto.randomBytes(24).toString('hex');
        sessions.set(sid, {
            isDemo: true,
            createdAt: Date.now(),
            user: {
                id: '1308814761269395527',
                username: 'Administrador (Modo Demo)',
                global_name: 'Vista Previa Interactiva',
                avatarUrl: client.user?.displayAvatarURL?.({ size: 128 }) || null
            },
            guilds: buildDemoGuilds()
        });
        res.setHeader('Set-Cookie', buildCookieHeader(req, signSessionId(sid), 86400));
        res.json({ ok: true });
    });

    app.get('/auth/login', (req, res) => {
        const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        if (!clientId || !clientSecret) return res.redirect('/?oauth_missing=1');
        const redirectUri = `${getBaseUrl(req)}/auth/callback`;
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'identify guilds'
        });
        res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    });

    app.get('/auth/callback', async (req, res) => {
        try {
            const code = req.query.code;
            if (!code) return res.redirect('/?auth_error=no_code');

            const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
            const clientSecret = process.env.DISCORD_CLIENT_SECRET;
            const redirectUri = `${getBaseUrl(req)}/auth/callback`;

            const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code: String(code),
                    redirect_uri: redirectUri
                })
            });
            if (!tokenRes.ok) return res.redirect('/?auth_error=token_failed');

            const tokenData = await tokenRes.json();
            const authHeader = { Authorization: `Bearer ${tokenData.access_token}` };
            const [userRes, guildsRes] = await Promise.all([
                fetch('https://discord.com/api/users/@me', { headers: authHeader }),
                fetch('https://discord.com/api/users/@me/guilds', { headers: authHeader })
            ]);
            if (!userRes.ok || !guildsRes.ok) return res.redirect('/?auth_error=fetch_failed');

            const userData = await userRes.json();
            const rawGuilds = await guildsRes.json();

            const manageable = (Array.isArray(rawGuilds) ? rawGuilds : []).filter(g => {
                const perms = BigInt(g.permissions || '0');
                return g.owner || (perms & 0x8n) === 0x8n || (perms & 0x20n) === 0x20n;
            }).map(g => {
                const botGuild = client.guilds?.cache?.get(g.id);
                const iconUrl = g.icon
                    ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.${g.icon.startsWith('a_') ? 'gif' : 'png'}?size=128`
                    : null;
                return {
                    id: g.id,
                    name: g.name,
                    iconUrl,
                    initials: (g.name || 'SV').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
                    hasBot: Boolean(botGuild),
                    memberCount: botGuild?.memberCount || 0,
                    isDemo: false
                };
            });

            manageable.sort((a, b) => Number(b.hasBot) - Number(a.hasBot) || b.memberCount - a.memberCount);

            const avatarUrl = userData.avatar
                ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.${userData.avatar.startsWith('a_') ? 'gif' : 'png'}?size=128`
                : null;

            const sid = crypto.randomBytes(24).toString('hex');
            sessions.set(sid, {
                isDemo: false,
                createdAt: Date.now(),
                user: {
                    id: userData.id,
                    username: userData.username,
                    global_name: userData.global_name || userData.username,
                    avatarUrl
                },
                guilds: manageable
            });

            res.setHeader('Set-Cookie', buildCookieHeader(req, signSessionId(sid), 86400));
            res.redirect('/dashboard');
        } catch (err) {
            console.error('⚠️ [DASHBOARD OAuth Error]:', err.message);
            res.redirect('/?auth_error=exception');
        }
    });

    app.post('/auth/logout', (req, res) => {
        const sess = verifySessionCookie(req.headers.cookie);
        if (sess) sessions.delete(sess.sid);
        res.setHeader('Set-Cookie', buildCookieHeader(req, '', 0));
        res.json({ ok: true });
    });

    app.get('/api/me', (req, res) => {
        const sess = verifySessionCookie(req.headers.cookie);
        if (!sess) return res.json({ authenticated: false });

        const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id || '';
        const guilds = (sess.guilds || []).map(g => {
            if (!g.isDemo) {
                const live = client.guilds?.cache?.get(g.id);
                return {
                    ...g,
                    hasBot: Boolean(live),
                    memberCount: live?.memberCount || g.memberCount || 0,
                    inviteUrl: clientId
                        ? `https://discord.com/oauth2/authorize?client_id=${clientId}&guild_id=${g.id}&permissions=8&scope=bot%20applications.commands`
                        : null
                };
            }
            return { ...g, inviteUrl: clientId ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands` : '#' };
        });

        res.json({ authenticated: true, isDemo: Boolean(sess.isDemo), user: sess.user, guilds });
    });

    function requireGuildAccess(req, res, next) {
        const sess = verifySessionCookie(req.headers.cookie);
        if (!sess) return res.status(401).json({ error: 'No autenticado' });
        const allowed = (sess.guilds || []).some(g => g.id === req.params.id);
        if (!allowed) return res.status(403).json({ error: 'Sin permisos en este servidor' });
        req.dashSession = sess;
        next();
    }

    app.get('/api/guild/:id/meta', requireGuildAccess, async (req, res) => {
        const guildId = req.params.id;
        if (req.dashSession.isDemo) return res.json(buildDemoMeta(guildId));

        const guild = client.guilds?.cache?.get(guildId);
        if (!guild) return res.status(404).json({ error: 'El bot no está en este servidor.' });

        const textChannels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 5)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .map(c => ({ id: c.id, name: c.name }));

        const voiceChannels = guild.channels.cache
            .filter(c => c.type === 2)
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .map(c => ({ id: c.id, name: c.name }));

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id && !r.managed)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));

        res.json({
            guild: {
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
                iconUrl: guild.iconURL({ size: 128 })
            },
            textChannels,
            voiceChannels,
            roles
        });
    });

    // ENDPOINT COMPLETO EN VIVO: devuelve TODOS los datos reales del bot (Top Staff, Sanciones, Eventos, Streamers, Tickets, Voz, Audios, Plantillas, IA)
    app.get('/api/guild/:id/full-data', requireGuildAccess, async (req, res) => {
        const guildId = req.params.id;
        if (req.dashSession.isDemo) return res.json(buildDemoFullData());

        const guild = client.guilds?.cache?.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Servidor no encontrado' });

        // 1. Valoraciones y Top Staff reales
        const valData = safeReadJson('valoraciones.json', { ratings: [], staffs: {} });
        const ratings = Array.isArray(valData.ratings) ? valData.ratings : [];
        const staffMap = new Map();
        for (const r of ratings) {
            const sid = r.staffId || r.staffTag || 'unknown';
            if (!staffMap.has(sid)) {
                const mem = guild.members.cache.get(r.staffId);
                staffMap.set(sid, {
                    id: sid,
                    name: mem?.displayName || mem?.user?.username || r.staffTag || `Staff ${sid.slice(-4)}`,
                    sum: 0,
                    count: 0
                });
            }
            const entry = staffMap.get(sid);
            entry.sum += Number(r.rating) || 0;
            entry.count++;
        }
        const topStaff = Array.from(staffMap.values())
            .map(s => ({ id: s.id, name: s.name, average: Number((s.sum / s.count).toFixed(1)), totalRatings: s.count }))
            .sort((a, b) => b.average - a.average || b.totalRatings - a.totalRatings)
            .slice(0, 20);

        const recentRatings = [...ratings].reverse().slice(0, 20).map(r => {
            const sm = guild.members.cache.get(r.staffId);
            const um = guild.members.cache.get(r.userId);
            return {
                staffName: sm?.displayName || r.staffTag || 'Staff',
                userName: um?.displayName || r.userTag || 'Usuario',
                rating: Number(r.rating) || 0,
                comment: r.comment || 'Sin comentario',
                timestamp: r.timestamp || null
            };
        });

        // 2. Sanciones reales
        const rawSanciones = safeReadJson('sanciones.json', []);
        const sanciones = (Array.isArray(rawSanciones) ? [...rawSanciones].reverse().slice(0, 40) : []).map(s => ({
            id: s.id || '----',
            targetTag: s.targetTag || s.targetId || 'Usuario',
            reporterTag: s.reporterTag || s.reporterId || 'Staff',
            punishment: s.punishment || 'Sanción',
            reason: s.reason || 'Sin motivo especificado',
            timestamp: s.timestamp || null
        }));

        // 3. Eventos reales
        const rawEventos = safeReadJson('eventos.json', []);
        const eventos = (Array.isArray(rawEventos) ? [...rawEventos].reverse().slice(0, 20) : []).map(e => ({
            id: e.id || '---',
            title: e.title || 'Evento Oficial',
            hora: e.hora || '',
            lugar: e.lugar || '',
            organiza: e.organiza || e.reporterTag || 'Staff',
            description: (e.description || '').slice(0, 220),
            timestamp: e.timestamp || null
        }));

        // 4. Streamers reales
        const rawStreamers = safeReadJson('streamers.json', {});
        const streamers = Object.entries(rawStreamers).map(([uid, d]) => {
            const mem = guild.members.cache.get(uid);
            return {
                userId: uid,
                name: mem?.displayName || mem?.user?.username || d.name || `Streamer ${uid.slice(-4)}`,
                twitchUrl: d.twitchUrl || (d.url && d.url.includes('twitch') ? d.url : ''),
                kickUrl: d.kickUrl || (d.url && d.url.includes('kick') ? d.url : ''),
                tiktokUrl: d.tiktokUrl || (d.url && d.url.includes('tiktok') ? d.url : ''),
                title: d.twitchTitle || d.kickTitle || d.tiktokTitle || d.title || 'Directo oficial'
            };
        });

        // 5. Tickets abiertos detectados en tiempo real
        const openTickets = guild.channels.cache
            .filter(c => c.type === 0 && /ticket|soporte|apelaci[oó]n|donaci[oó]n|creador|reporte|postulaci[oó]n/i.test(c.name) && !/panel|log|cerrad|transcript/i.test(c.name))
            .map(c => ({
                id: c.id,
                name: c.name,
                category: c.parent?.name || 'Tickets'
            }))
            .slice(0, 30);

        // 6. Salas de voz con gente conectada en tiempo real
        const voiceActive = guild.channels.cache
            .filter(c => c.type === 2 && c.members && c.members.size > 0)
            .map(c => ({
                channelName: c.name,
                members: c.members.map(m => m.displayName || m.user.username)
            }));

        // 7. Audios de locución en disco
        const audioFiles = [
            { file: 'aviso_staff.mp3', label: 'Aviso Staff 1 (Espera)' },
            { file: 'aviso_staff_2.mp3', label: 'Aviso Staff 2 (Recordatorio)' },
            { file: 'locucion_usuarios.mp3', label: 'Locución Usuarios (Bienvenida)' },
            { file: 'aviso_sancion_staff.mp3', label: 'Aviso 3 (Sanción Staff)' },
            { file: 'locucion_charla.mp3', label: 'Locución Sala de Charla' }
        ];
        const audios = audioFiles.map(a => ({
            label: a.label,
            ok: fs.existsSync(path.join(__dirname, 'assets', a.file)) || fs.existsSync(path.join(__dirname, a.file))
        }));

        // 8. Plantillas
        const rawPlantillas = safeReadJson('plantillas.json', { plantillas: {} });
        const plantillas = Object.entries(rawPlantillas.plantillas || {})
            .filter(([k]) => !/oral/i.test(k))
            .map(([k, v]) => ({ key: k, nombre: v.nombre || k, emoji: v.emoji || '📋' }));

        const onlineMembers = guild.members.cache.filter(m => m.presence && m.presence.status !== 'offline').size;

        res.json({
            stats: {
                ramMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                uptimeSeconds: Math.floor(process.uptime()),
                ping: Math.max(0, Math.round(client.ws?.ping || 0)),
                textChannelsCount: guild.channels.cache.filter(c => c.type === 0 || c.type === 5).size,
                voiceChannelsCount: guild.channels.cache.filter(c => c.type === 2).size,
                rolesCount: guild.roles.cache.size,
                onlineMembers,
                openTicketsCount: openTickets.length,
                aiStatus: 'Multi-Núcleo Activo'
            },
            topStaff,
            recentRatings,
            sanciones,
            eventos,
            streamers,
            openTickets,
            voiceActive,
            audios,
            plantillas
        });
    });

    app.get('/api/guild/:id/config', requireGuildAccess, (req, res) => {
        const guildId = req.params.id;
        const all = readGuildConfigs();
        const base = req.dashSession.isDemo ? {
            BRAND_NAME: guildId === 'demo_guild_2' ? 'MADRID CITY ROLEPLAY' : 'TU SERVIDOR RP',
            BRAND_COLOR: '#D900FF',
            PREFIX: '!',
            FIVEM_CFX_CODE: 'tucodigo',
            AI_ENABLED: true,
            AI_AUTOCLEAN_SECONDS: 90,
            TICKETS_AI_ENABLED: true,
            LOCUCION_ENABLED: true,
            LOCUCION_INTERVAL_SEC: 30,
            ANTI_IA_WL_ENABLED: true,
            ASCENSOS_ENABLED: true,
            CHANNEL_CONSULTAS_STAFF_ID: 'ch_consultas_staff',
            CHANNEL_CONSULTAS_USERS_ID: 'ch_consultas_users',
            CHANNEL_CONSULTAS_LOGS_ID: 'ch_logs_consultas',
            CHANNEL_STREAM_PANEL_ID: 'ch_stream_panel',
            CHANNEL_STREAMERS_ID: 'ch_streamers',
            CHANNEL_EVENTOS_PANEL_ID: 'ch_eventos_panel',
            CHANNEL_EVENTOS_ID: 'ch_eventos_1',
            CHANNEL_EVENTOS_2_ID: 'ch_eventos_2',
            CHANNEL_SANCIONES_PANEL_ID: 'ch_sanciones_panel',
            CHANNEL_SANCIONES_ID: 'ch_sanciones',
            CHANNEL_VALORACION_PANEL_ID: 'ch_val_panel',
            CHANNEL_VALORACIONES_ID: 'ch_valoraciones',
            CHANNEL_SOLICITUDES_ID: 'ch_solicitudes',
            CHANNEL_APROBADOS_ID: 'ch_aprobados',
            CHANNEL_DENEGADOS_ID: 'ch_denegados',
            CHANNEL_BIENVENIDAS_ID: 'ch_bienvenidas',
            CHANNEL_NORMATIVAS_ID: 'ch_normativas',
            CHANNEL_GENERAL_ID: 'ch_general',
            CHANNEL_TICKETS_ID: 'ch_tickets',
            ROLE_STREAMER_ID: 'role_streamer',
            ROLE_STAFF_ID: 'role_soporte',
            VOICE_ESPERA_ID: 'vc_espera',
            VOICE_CHARLA_ID: 'vc_charla'
        } : {
            ...pickSafeConfig(guildManager.getGuildConfig(guildId))
        };

        res.json({ config: pickSafeConfig(req.dashSession.isDemo ? { ...base, ...(all[guildId] || {}) } : base) });
    });

    app.post('/api/guild/:id/config', requireGuildAccess, async (req, res) => {
        try {
            const guildId = req.params.id;
            const incoming = pickSafeConfig(req.body?.config || {});

            if (req.dashSession.isDemo) {
                const all = readGuildConfigs();
                all[guildId] = { ...(all[guildId] || {}), ...incoming, updatedAt: new Date().toISOString() };
                saveGuildConfigs(all);
                return res.json({ ok: true, savedAt: all[guildId].updatedAt });
            }

            // Guardar en MongoDB por servidor (totalmente aislado por guildId, sin tocar Vallecas RP si es otro servidor)
            await guildManager.setGuildConfigBulk(guildId, incoming);
            res.json({ ok: true, savedAt: new Date().toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/guild/:id/publish-panel', requireGuildAccess, async (req, res) => {
        const { panelType, channelId } = req.body || {};
        if (!panelType || !channelId) return res.status(400).json({ error: 'Falta panelType o channelId.' });

        if (req.dashSession.isDemo) {
            return res.json({ ok: true, demo: true, message: `Panel "${panelType}" enviado con éxito (Modo Demo).` });
        }

        try {
            const guild = client.guilds?.cache?.get(req.params.id);
            const channel = guild?.channels?.cache?.get(channelId);
            if (!channel || !channel.isTextBased()) return res.status(404).json({ error: 'Canal no encontrado.' });

            if (typeof options.publishPanel === 'function') {
                const result = await options.publishPanel(panelType, channel);
                return res.json({ ok: true, message: result || `Panel "${panelType}" publicado en #${channel.name}.` });
            }
            res.json({ ok: true, message: `Solicitud enviada a #${channel.name}.` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Enviar anuncio personalizado con Embed prémium directamente desde la Web
    app.post('/api/guild/:id/announce', requireGuildAccess, async (req, res) => {
        const { channelId, title, message, color, pingEveryone } = req.body || {};
        if (!channelId || !message) return res.status(400).json({ error: 'Selecciona canal y escribe el mensaje.' });

        if (req.dashSession.isDemo) {
            return res.json({ ok: true, message: 'Anuncio enviado correctamente (simulación Modo Demo).' });
        }

        try {
            const guild = client.guilds?.cache?.get(req.params.id);
            const channel = guild?.channels?.cache?.get(channelId);
            if (!channel || !channel.isTextBased()) return res.status(404).json({ error: 'Canal no encontrado.' });

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            let logoUrl = client.user.displayAvatarURL();
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                logoUrl = 'attachment://logo.png';
            }

            const hexColor = /^#[0-9a-f]{6}$/i.test(color || '') ? parseInt(color.slice(1), 16) : 0xD900FF;
            const embed = new EmbedBuilder()
                .setColor(hexColor)
                .setAuthor({ name: `ANUNCIO OFICIAL | ${guild.name.toUpperCase()}`, iconURL: logoUrl })
                .setThumbnail(logoUrl)
                .setTitle(title ? `📢 ${title}` : '📢 COMUNICADO OFICIAL')
                .setDescription(message)
                .setFooter({ text: `${guild.name} • Enviado desde el Panel Web`, iconURL: logoUrl })
                .setTimestamp();

            await channel.send({
                content: pingEveryone ? '@everyone' : undefined,
                embeds: [embed],
                files
            });

            res.json({ ok: true, message: `Anuncio publicado en #${channel.name}` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log('🌐 [DASHBOARD WEB] Panel de control web prémium completo inicializado en / y /dashboard');
};
