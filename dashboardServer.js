// ==========================================
// MÓDULO INDEPENDIENTE: WEB DASHBOARD PRÉMIUM (OAUTH2 + CONFIGURACIÓN EN VIVO)
// ==========================================
// Zero dependencias externas adicionales (usa express existente + Node crypto + fetch nativo).
// Variables de entorno opcionales para OAuth2 real en Railway:
//   DISCORD_CLIENT_ID     (si no se pone, se autodetecta de client.user.id)
//   DISCORD_CLIENT_SECRET (secreto OAuth2 del Discord Developer Portal)
//   DASHBOARD_URL         (ej: https://tu-app.up.railway.app — si no se pone, se autodetecta)
//   DASHBOARD_SECRET      (secreto para firmar sesiones — si no se pone, se genera automático)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const GUILD_CONFIGS_FILE = path.join(__dirname, 'guild_configs.json');
const SESSION_COOKIE = 'vyre_dash_session';
const SESSION_SECRET = process.env.DASHBOARD_SECRET || crypto.createHash('sha256').update((process.env.DISCORD_TOKEN || 'dash_secret_key') + '_vyre_dash').digest('hex');

// Sesiones en memoria: sessionId -> { user, guilds, isDemo, createdAt }
const sessions = new Map();

function readGuildConfigs() {
    try {
        if (fs.existsSync(GUILD_CONFIGS_FILE)) {
            return JSON.parse(fs.readFileSync(GUILD_CONFIGS_FILE, 'utf8'));
        }
    } catch (e) { }
    return {};
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
        {
            id: 'demo_guild_1',
            name: 'TU SERVIDOR RP 🇪🇸',
            iconUrl: null,
            initials: 'TS',
            hasBot: true,
            memberCount: 1482,
            onlineCount: 319,
            isDemo: true
        },
        {
            id: 'demo_guild_2',
            name: 'MADRID CITY ROLEPLAY',
            iconUrl: null,
            initials: 'MC',
            hasBot: true,
            memberCount: 846,
            onlineCount: 174,
            isDemo: true
        },
        {
            id: 'demo_guild_3',
            name: 'COMUNIDAD FIVEM DEV',
            iconUrl: null,
            initials: 'CF',
            hasBot: false,
            memberCount: 215,
            onlineCount: 48,
            isDemo: true
        }
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
            { id: 'vc_charla', name: '💬┃Sala de Charla Staff' },
            { id: 'vc_afk', name: '💤┃AFK Staff' }
        ],
        roles: [
            { id: 'role_admin', name: '⚡┃Administrador', color: '#D900FF' },
            { id: 'role_mod', name: '🔰┃Moderador', color: '#00F0FF' },
            { id: 'role_soporte', name: '🔎┃Soporte', color: '#2ECC71' },
            { id: 'role_streamer', name: '🟣┃Streamer Oficial', color: '#9146FF' },
            { id: 'role_ciudadano', name: '🏙️┃Ciudadano WL', color: '#F1C40F' }
        ]
    };
}

module.exports = function initDashboardServer(app, client, options = {}) {
    const getBotConfig = options.getBotConfig || (() => ({}));
    const updateBotConfig = options.updateBotConfig || (async () => {});

    app.use(express.json({ limit: '2mb' }));

    // Servir archivos estáticos del Dashboard
    const dashboardDir = path.join(__dirname, 'dashboard');
    app.use('/dashboard-static', express.static(dashboardDir));

    // Ruta principal y /dashboard sirven el SPA prémium
    app.get(['/', '/dashboard'], (req, res) => {
        const indexPath = path.join(dashboardDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }
        return res.status(200).send('🚀 Dashboard activo.');
    });

    // Estado global público del bot (para KPIs en vivo)
    app.get('/api/status', (req, res) => {
        const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id || '';
        const oauthEnabled = Boolean(clientId && process.env.DISCORD_CLIENT_SECRET);
        const totalMembers = client.guilds?.cache?.reduce((acc, g) => acc + (g.memberCount || 0), 0) || 0;
        const aiKeys = getConfiguredAiKeyCount();

        res.json({
            online: Boolean(client.isReady && client.isReady()),
            botName: client.user?.username || 'VYRE AI',
            botAvatar: client.user?.displayAvatarURL?.({ size: 256 }) || null,
            ping: Math.max(0, Math.round(client.ws?.ping || 0)),
            uptimeSeconds: Math.floor(process.uptime()),
            guildsCount: client.guilds?.cache?.size || 0,
            totalMembers,
            aiKeysCount: aiKeys,
            aiDailyTokens: aiKeys * 600000,
            oauthEnabled,
            inviteUrl: clientId
                ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`
                : null
        });
    });

    // Iniciar sesión en Modo Demo Interactivo (permite explorar todo el panel incluso sin OAuth2)
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
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(signSessionId(sid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        res.json({ ok: true });
    });

    // Discord OAuth2: Redirección de login
    app.get('/auth/login', (req, res) => {
        const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            return res.redirect('/?oauth_missing=1');
        }
        const redirectUri = `${getBaseUrl(req)}/auth/callback`;
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'identify guilds'
        });
        res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
    });

    // Discord OAuth2: Callback
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

            if (!tokenRes.ok) {
                return res.redirect('/?auth_error=token_failed');
            }

            const tokenData = await tokenRes.json();
            const authHeader = { Authorization: `Bearer ${tokenData.access_token}` };

            const [userRes, guildsRes] = await Promise.all([
                fetch('https://discord.com/api/users/@me', { headers: authHeader }),
                fetch('https://discord.com/api/users/@me/guilds', { headers: authHeader })
            ]);

            if (!userRes.ok || !guildsRes.ok) {
                return res.redirect('/?auth_error=fetch_failed');
            }

            const userData = await userRes.json();
            const rawGuilds = await guildsRes.json();

            // Filtrar servidores donde el usuario tiene permiso de Administrador (0x8) o Gestionar Servidor (0x20)
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

            // Ordenar: primero servidores donde YA está el bot
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

            res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(signSessionId(sid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
            res.redirect('/dashboard');
        } catch (err) {
            console.error('⚠️ [DASHBOARD OAuth Error]:', err.message);
            res.redirect('/?auth_error=exception');
        }
    });

    // Cerrar sesión
    app.post('/auth/logout', (req, res) => {
        const sess = verifySessionCookie(req.headers.cookie);
        if (sess) sessions.delete(sess.sid);
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
        res.json({ ok: true });
    });

    // Datos de sesión actual + servidores
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

        res.json({
            authenticated: true,
            isDemo: Boolean(sess.isDemo),
            user: sess.user,
            guilds
        });
    });

    // Middleware de autorización para rutas de servidor
    function requireGuildAccess(req, res, next) {
        const sess = verifySessionCookie(req.headers.cookie);
        if (!sess) return res.status(401).json({ error: 'No autenticado' });
        const guildId = req.params.id;
        const allowed = (sess.guilds || []).some(g => g.id === guildId);
        if (!allowed) return res.status(403).json({ error: 'Sin permisos en este servidor' });
        req.dashSession = sess;
        next();
    }

    // Metadatos en vivo de un servidor (canales de texto, voz y roles)
    app.get('/api/guild/:id/meta', requireGuildAccess, async (req, res) => {
        const guildId = req.params.id;
        if (req.dashSession.isDemo) {
            return res.json(buildDemoMeta(guildId));
        }

        const guild = client.guilds?.cache?.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'El bot no está en este servidor.' });
        }

        const textChannels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 5) // GuildText / GuildAnnouncement
            .sort((a, b) => a.rawPosition - b.rawPosition)
            .map(c => ({ id: c.id, name: c.name }));

        const voiceChannels = guild.channels.cache
            .filter(c => c.type === 2) // GuildVoice
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

    // Obtener configuración actual de un servidor
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
            BRAND_NAME: client.guilds?.cache?.get(guildId)?.name || 'MI SERVIDOR RP',
            BRAND_COLOR: '#D900FF',
            PREFIX: '!',
            AI_ENABLED: true,
            AI_AUTOCLEAN_SECONDS: 90,
            TICKETS_AI_ENABLED: true,
            LOCUCION_ENABLED: true,
            LOCUCION_INTERVAL_SEC: 30,
            ANTI_IA_WL_ENABLED: true,
            ASCENSOS_ENABLED: true,
            ...getBotConfig()
        };

        const merged = { ...base, ...(all[guildId] || {}) };
        res.json({ config: merged });
    });

    // Guardar configuración de un servidor en vivo
    app.post('/api/guild/:id/config', requireGuildAccess, async (req, res) => {
        try {
            const guildId = req.params.id;
            const incoming = req.body?.config || {};
            const all = readGuildConfigs();
            all[guildId] = { ...(all[guildId] || {}), ...incoming, updatedAt: new Date().toISOString() };
            saveGuildConfigs(all);

            // Si no es demo, sincronizar también las claves compatibles con botConfig en vivo
            if (!req.dashSession.isDemo) {
                const syncKeys = [
                    'CHANNEL_CONSULTAS_STAFF_ID', 'CHANNEL_CONSULTAS_USERS_ID', 'CHANNEL_CONSULTAS_LOGS_ID',
                    'CHANNEL_STREAM_PANEL_ID', 'CHANNEL_STREAMERS_ID',
                    'CHANNEL_EVENTOS_PANEL_ID', 'CHANNEL_EVENTOS_ID', 'CHANNEL_EVENTOS_2_ID',
                    'CHANNEL_SANCIONES_PANEL_ID', 'CHANNEL_SANCIONES_ID',
                    'CHANNEL_VALORACION_PANEL_ID', 'CHANNEL_VALORACIONES_ID',
                    'CHANNEL_SOLICITUDES_ID', 'CHANNEL_APROBADOS_ID', 'CHANNEL_DENEGADOS_ID',
                    'CHANNEL_BIENVENIDAS_ID', 'CHANNEL_NORMATIVAS_ID', 'CHANNEL_GENERAL_ID', 'CHANNEL_TICKETS_ID',
                    'ROLE_STREAMER_ID', 'FIVEM_CFX_CODE'
                ];
                for (const key of syncKeys) {
                    if (incoming[key] !== undefined) {
                        await updateBotConfig(key, String(incoming[key])).catch(() => {});
                    }
                }
            }

            res.json({ ok: true, savedAt: all[guildId].updatedAt });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Publicar un panel directamente en un canal desde el Dashboard Web
    app.post('/api/guild/:id/publish-panel', requireGuildAccess, async (req, res) => {
        const { panelType, channelId } = req.body || {};
        if (!panelType || !channelId) {
            return res.status(400).json({ error: 'Falta panelType o channelId.' });
        }

        if (req.dashSession.isDemo) {
            return res.json({
                ok: true,
                demo: true,
                message: `Panel "${panelType}" enviado con éxito (simulación en Modo Demo).`
            });
        }

        try {
            const guild = client.guilds?.cache?.get(req.params.id);
            const channel = guild?.channels?.cache?.get(channelId);
            if (!channel || !channel.isTextBased()) {
                return res.status(404).json({ error: 'Canal no encontrado en el servidor.' });
            }

            if (typeof options.publishPanel === 'function') {
                const result = await options.publishPanel(panelType, channel);
                return res.json({ ok: true, message: result || `Panel "${panelType}" publicado en #${channel.name}.` });
            }

            res.json({ ok: true, message: `Solicitud registrada para #${channel.name}.` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log('🌐 [DASHBOARD WEB] Panel de control web prémium inicializado en / y /dashboard');
};
