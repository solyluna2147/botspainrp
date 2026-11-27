// ============================================================================
// MÓDULO TXADMIN: SANDBOX INTERACTIVO DE PRUEBAS (!panel-txadmintest / !panel-txownertest)
// ============================================================================
// Simula un servidor FiveM + txAdmin 100% conectado en memoria con datos realistas
// para probar todas las vistas, paginaciones, filtros, acciones, IA y Panel Creador
// sin tocar nunca el servidor real ni los paneles de producción.

const crypto = require('crypto');

const demoStates = new Map(); // guildId -> sandbox state

function createInitialDemoState(requesterUser) {
    const nowSec = Math.floor(Date.now() / 1000);
    const day = 86400;

    const ownerId = requesterUser?.id || '418558256840179722';
    const ownerTag = requesterUser?.tag || requesterUser?.username || 'LoLamento';

    const sessions = [
        {
            discordUserId: ownerId,
            discordTag: ownerTag,
            txUsername: 'LoLamento_Founder',
            linkedAt: Date.now() - 3 * 3600 * 1000,
            lastAction: 'Sesión activa (Modo Test)',
            master: true,
            permissions: ['all_permissions']
        },
        {
            discordUserId: '100000000000000001',
            discordTag: 'CarlosMod',
            txUsername: 'carlos_mod',
            linkedAt: Date.now() - 18 * 3600 * 1000,
            lastAction: 'Warn W4K9-P2',
            master: false,
            permissions: ['players.warn', 'players.kick', 'players.ban', 'players.whitelist']
        },
        {
            discordUserId: '100000000000000002',
            discordTag: 'AdminLuis',
            txUsername: 'admin_luis',
            linkedAt: Date.now() - 2 * day * 1000,
            lastAction: 'Ban TX91-B4K2',
            master: false,
            permissions: ['players.warn', 'players.kick', 'players.ban', 'players.whitelist', 'commands.resources']
        },
        {
            discordUserId: '100000000000000003',
            discordTag: 'MartaSoporte',
            txUsername: 'marta_soporte',
            linkedAt: Date.now() - 5 * 3600 * 1000,
            lastAction: 'Consulta antecedentes',
            master: false,
            permissions: ['players.warn', 'players.kick']
        }
    ];

    const admins = [
        { name: 'LoLamento_Founder', master: true, discordId: ownerId, providerIds: [`discord:${ownerId}`], permissions: ['all_permissions'] },
        { name: 'admin_luis', master: false, discordId: '200000000000000023', providerIds: ['discord:200000000000000023'], permissions: ['players.warn', 'players.kick', 'players.ban', 'commands.resources'] },
        { name: 'carlos_mod', master: false, discordId: '100000000000000001', providerIds: ['discord:100000000000000001'], permissions: ['players.warn', 'players.kick', 'players.ban'] },
        { name: 'marta_soporte', master: false, discordId: '100000000000000003', providerIds: ['discord:100000000000000003'], permissions: ['players.warn', 'players.kick'] },
        { name: 'dani_dev', master: false, discordId: null, providerIds: [], permissions: ['commands.resources', 'control.server', 'console.view'] }
    ];

    const onlinePlayers = [
        { id: 1, name: 'Hugoo', ping: 22, identifiers: ['license:9f82a10c4e1b2201', 'discord:418558256840179722', 'steam:11000013a10001'], character: { fullName: 'Hugo López', job: 'LSPD • Oficial II', bank: 48500 } },
        { id: 4, name: 'ElMakiRP', ping: 34, identifiers: ['license:44aa9911bb22cc33', 'discord:200000000000000004'], character: { fullName: 'Marcos Silva', job: 'Desempleado', bank: 12300 } },
        { id: 7, name: 'SofiaVega', ping: 19, identifiers: ['license:77dd11ee22ff3307', 'discord:200000000000000007'], character: { fullName: 'Sofía Vega', job: 'EMS • Cirujana', bank: 95200 } },
        { id: 11, name: 'Kiko_Drift', ping: 41, identifiers: ['license:11aa22bb33cc4411', 'discord:200000000000000011'], character: { fullName: 'Kiko Morales', job: 'Taller Bennys', bank: 31400 } },
        { id: 14, name: 'NereaRP', ping: 27, identifiers: ['license:14ff55ee66dd7714', 'discord:200000000000000014'], character: { fullName: 'Nerea Castro', job: 'Badulaque Sur', bank: 64000 } },
        { id: 19, name: 'TorettoES', ping: 55, identifiers: ['license:19cc88aa77bb6619', 'discord:200000000000000019'], character: { fullName: 'Rubén Navarro', job: 'Civil', bank: 8900 } },
        { id: 23, name: 'Valkiria', ping: 24, identifiers: ['license:23ab34cd45ef5623', 'discord:200000000000000023'], character: { fullName: 'Elena Ortiz', job: 'LSPD • Inspectora', bank: 112000 } },
        { id: 28, name: 'Javi_98', ping: 31, identifiers: ['license:28de45fa67bc8928', 'discord:200000000000000028'], character: { fullName: 'Javier Serrano', job: 'Taxista', bank: 15600 } },
        { id: 32, name: 'ZetaKing', ping: 48, identifiers: ['license:32fa12bc34de5632', 'discord:200000000000000032'], character: { fullName: 'Adrián León', job: 'Civil', bank: 4200 } },
        { id: 37, name: 'LolaMendez', ping: 29, identifiers: ['license:37bc90de12fa3437', 'discord:200000000000000037'], character: { fullName: 'Lola Méndez', job: 'Discoteca Bahama', bank: 73100 } },
        { id: 42, name: 'BichoRP', ping: 63, identifiers: ['license:42cd11ef22ab3342', 'discord:200000000000000042'], character: { fullName: 'Sergio Ramos', job: 'Mecánico Norte', bank: 22900 } },
        { id: 49, name: 'Aitana_VLC', ping: 21, identifiers: ['license:49ef55ab66cd7749', 'discord:200000000000000049'], character: { fullName: 'Aitana Gil', job: 'EMS • Paramédico', bank: 54800 } },
        { id: 53, name: 'Draxler', ping: 39, identifiers: ['license:53ab99cd88ef7753', 'discord:200000000000000053'], character: { fullName: 'Iván Torres', job: 'Armería Centro', bank: 88400 } },
        { id: 58, name: 'Peke_07', ping: 44, identifiers: ['license:58de11fa22bc3358', 'discord:200000000000000058'], character: { fullName: 'Lucas Prieto', job: 'Repartidor', bank: 6150 } }
    ];

    const playersDb = onlinePlayers.map((p, idx) => ({
        license: p.identifiers[0].replace('license:', ''),
        displayName: p.name,
        ids: p.identifiers,
        playTime: 420 + idx * 185,
        tsJoined: nowSec - (35 - idx) * day,
        tsLastConnection: nowSec - idx * 600,
        tsWhitelisted: nowSec - (35 - idx) * day,
        notes: idx === 0
            ? { author: 'admin_luis', text: 'Jugador activo, buen rol policial. Revisado en ticket #104.' }
            : (idx === 1 ? { author: 'carlos_mod', text: 'Vigilar conducción en persecuciones.' } : null)
    }));

    const actions = [
        { id: 'TX91-B4K2', type: 'ban', author: 'admin_luis', reason: 'VDM reiterado en zona segura [Discord: AdminLuis]', timestamp: nowSec - 1 * day, expiration: nowSec + 6 * day, playerName: 'ElMakiRP', ids: ['license:44aa9911bb22cc33', 'discord:200000000000000004'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX88-P1M9', type: 'ban', author: 'LoLamento_Founder', reason: 'Uso de menú externo / Cheats detectados', timestamp: nowSec - 2 * day, expiration: 0, playerName: 'Hackito99', ids: ['license:deadbeef00009999'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX84-Q7L3', type: 'warn', author: 'carlos_mod', reason: 'Mal uso de /me y /do en comisaría', timestamp: nowSec - 2 * day, expiration: 0, playerName: 'Hugoo', ids: ['license:9f82a10c4e1b2201', 'discord:418558256840179722'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX81-R5N8', type: 'ban', author: 'carlos_mod', reason: 'Combat Log (F8 quit) en robo a fleeca', timestamp: nowSec - 3 * day, expiration: nowSec + 2 * day, playerName: 'ZetaKing', ids: ['license:32fa12bc34de5632'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX77-K9Q2', type: 'ban', author: 'admin_luis', reason: 'Metagaming con stream abierto', timestamp: nowSec - 4 * day, expiration: nowSec + 10 * day, playerName: 'TorettoES', ids: ['license:19cc88aa77bb6619'], status: 'revoked', revokedBy: 'LoLamento_Founder', revokedAt: nowSec - 3 * day },
        { id: 'TX72-W4K9', type: 'warn', author: 'marta_soporte', reason: 'No valorar vida (NVV) al ser apuntado por 3 personas', timestamp: nowSec - 5 * day, expiration: 0, playerName: 'BichoRP', ids: ['license:42cd11ef22ab3342'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX68-H2V4', type: 'ban', author: 'admin_luis', reason: 'DM sin rol previo en plaza', timestamp: nowSec - 9 * day, expiration: nowSec - 2 * day, playerName: 'Kiko_Drift', ids: ['license:11aa22bb33cc4411'], status: 'expired', revokedBy: null, revokedAt: null },
        { id: 'TX64-M8J1', type: 'warn', author: 'carlos_mod', reason: 'Hablar OOC por chat de voz IC', timestamp: nowSec - 11 * day, expiration: 0, playerName: 'Hugoo', ids: ['license:9f82a10c4e1b2201', 'discord:418558256840179722'], status: 'revoked', revokedBy: 'admin_luis', revokedAt: nowSec - 10 * day },
        { id: 'TX59-Z3C6', type: 'ban', author: 'LoLamento_Founder', reason: 'Abuso de bug de duplicación de inventario', timestamp: nowSec - 14 * day, expiration: 0, playerName: 'DuperPro', ids: ['license:badc0ffee1234567'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX52-D9F2', type: 'warn', author: 'marta_soporte', reason: 'Cop baiting frente a comisaría', timestamp: nowSec - 16 * day, expiration: 0, playerName: 'Peke_07', ids: ['license:58de11fa22bc3358'], status: 'active', revokedBy: null, revokedAt: null },
        { id: 'TX49-N1B7', type: 'ban', author: 'carlos_mod', reason: 'Faltas de respeto graves OOC', timestamp: nowSec - 19 * day, expiration: nowSec - 12 * day, playerName: 'Javi_98', ids: ['license:28de45fa67bc8928'], status: 'expired', revokedBy: null, revokedAt: null },
        { id: 'TX41-T6S4', type: 'warn', author: 'admin_luis', reason: 'Conducción PG por montaña con superdeportivo', timestamp: nowSec - 22 * day, expiration: 0, playerName: 'ElMakiRP', ids: ['license:44aa9911bb22cc33'], status: 'active', revokedBy: null, revokedAt: null }
    ];

    const resources = [
        { name: 'oxmysql', state: 'started' },
        { name: 'ox_lib', state: 'started' },
        { name: 'ox_inventory', state: 'started' },
        { name: 'ox_target', state: 'started' },
        { name: 'qbx_core', state: 'started' },
        { name: 'pma-voice', state: 'started' },
        { name: 'vantex_tx_hook', state: 'started' },
        { name: 'vila_hud', state: 'started' },
        { name: 'vila_garajes', state: 'started' },
        { name: 'vila_trabajos', state: 'started' },
        { name: 'vila_tiendas', state: 'started' },
        { name: 'vila_policia', state: 'started' },
        { name: 'vila_ems', state: 'started' },
        { name: 'vila_mecanico', state: 'started' },
        { name: 'vila_bandas', state: 'started' },
        { name: 'vila_vehiculos', state: 'started' },
        { name: 'vila_ropa', state: 'started' },
        { name: 'vila_radio', state: 'started' },
        { name: 'vila_robos_joyeria', state: 'stopped' },
        { name: 'vila_mdt_tablet', state: 'stopped' },
        { name: 'vila_airdrop', state: 'stopped' }
    ];

    const consoleErrors = [
        '[2026-11-27 09:24:11] [script:vila_mdt_tablet] SCRIPT ERROR: @vila_mdt_tablet/server/main.lua:142: attempt to index a nil value (local \'playerData\')',
        '[2026-11-27 09:21:05] [citizen-server-impl] server thread hitch warning: timer interval of 248 milliseconds',
        '[2026-11-27 09:18:40] [script:vila_robos_joyeria] Error loading script server/heist.lua: Failed to connect to export ox_inventory',
        '[2026-11-27 09:12:19] [script:oxmysql] [WARNING] Query took 194ms: SELECT * FROM players WHERE citizenid = ?',
        '[2026-11-27 09:05:33] [script:vila_airdrop] Could not start resource vila_airdrop: missing dependency polyzone',
        '[2026-11-27 08:52:01] [script:vila_garajes] SCRIPT ERROR: @vila_garajes/server/spawn.lua:88: plate cannot be nil',
        '[2026-11-27 08:41:14] [citizen-server-impl] server thread hitch warning: timer interval of 182 milliseconds',
        '[2026-11-27 08:20:09] [script:vila_policia] [WARN] Dispatch callback timeout for source 23',
        '[2026-11-27 07:55:47] [script:vila_tiendas] SCRIPT ERROR: @vila_tiendas/server/shop.lua:51: invalid item "agua_premium"'
    ];

    const adminLogLines = [
        '[27/11/2026 09:31:02] [LoLamento_Founder] Executed command: restart vila_hud',
        '[27/11/2026 09:15:44] [admin_luis] Banned ElMakiRP (TX91-B4K2) - VDM reiterado en zona segura',
        '[27/11/2026 08:48:19] [carlos_mod] Warned Hugoo (TX84-Q7L3) - Mal uso de /me y /do en comisaría',
        '[27/11/2026 07:30:00] [txAdmin] Scheduled restart completed successfully',
        '[26/11/2026 23:44:12] [LoLamento_Founder] Revoked action TX77-K9Q2 (TorettoES)',
        '[26/11/2026 22:18:55] [carlos_mod] Banned ZetaKing (TX81-R5N8) - Combat Log (F8 quit)',
        '[26/11/2026 21:04:31] [admin_luis] Broadcasted announcement: ¡Evento de drift en el muelle en 10 minutos!',
        '[26/11/2026 19:50:08] [dani_dev] Stopped resource: vila_airdrop',
        '[26/11/2026 18:10:22] [marta_soporte] Warned BichoRP (TX72-W4K9) - No valorar vida (NVV)'
    ];

    return {
        readOnlyMode: false,
        sessions,
        admins,
        onlinePlayers,
        playersDb,
        actions,
        resources,
        consoleErrors,
        adminLogLines,
        whitelist: new Set(onlinePlayers.map(p => p.identifiers[0]))
    };
}

function getDemoState(guildId, requesterUser = null) {
    const gId = String(guildId || 'demo');
    if (!demoStates.has(gId)) {
        demoStates.set(gId, createInitialDemoState(requesterUser));
    }
    const st = demoStates.get(gId);
    // Asegurar que el creador solicitante tenga sesión demo lista si todavía no fue revocado manualmente
    if (requesterUser?.id && !st.manuallyRevokedOwner && !st.sessions.some(s => String(s.discordUserId) === String(requesterUser.id))) {
        st.sessions.unshift({
            discordUserId: String(requesterUser.id),
            discordTag: requesterUser.tag || requesterUser.username || 'Creador',
            txUsername: 'LoLamento_Founder',
            linkedAt: Date.now() - 2 * 3600 * 1000,
            lastAction: 'Sesión activa (Modo Test)',
            master: true,
            permissions: ['all_permissions']
        });
    }
    return st;
}

function resetDemoState(guildId, requesterUser = null) {
    const gId = String(guildId || 'demo');
    demoStates.set(gId, createInitialDemoState(requesterUser));
    return demoStates.get(gId);
}

function getDemoBridgeStatus(guildId, requesterUser = null) {
    const st = getDemoState(guildId, requesterUser);
    return {
        online: true,
        secretConfigured: true,
        readOnlyMode: Boolean(st.readOnlyMode),
        connectedAt: Date.now() - 6 * 3600 * 1000,
        lastSeenAt: Date.now(),
        latencyMs: 14,
        info: { mode: 'SANDBOX TEST', hostname: 'TEST-FIVEM-HOST' },
        sessions: st.sessions
    };
}

function toggleDemoReadOnly(guildId) {
    const st = getDemoState(guildId);
    st.readOnlyMode = !st.readOnlyMode;
    return st.readOnlyMode;
}

async function dispatchDemoAction(guildId, action, payload = {}, requesterUser = null) {
    const st = getDemoState(guildId, requesterUser);
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Sesiones
    if (action === 'session_login') {
        const { discordUserId, discordTag, txUsername } = payload;
        const foundAdmin = st.admins.find(a => a.name.toLowerCase() === String(txUsername || '').toLowerCase());
        const rec = {
            discordUserId: String(discordUserId),
            discordTag: discordTag || String(discordUserId),
            txUsername: foundAdmin ? foundAdmin.name : (txUsername || 'staff_demo'),
            linkedAt: Date.now(),
            lastAction: 'Sesión iniciada (Test)',
            master: foundAdmin ? foundAdmin.master : true,
            permissions: foundAdmin ? foundAdmin.permissions : ['players.warn', 'players.kick', 'players.ban', 'players.whitelist']
        };
        st.sessions = st.sessions.filter(s => String(s.discordUserId) !== String(discordUserId));
        st.sessions.unshift(rec);
        st.manuallyRevokedOwner = false;
        return { txUsername: rec.txUsername, master: rec.master, permissions: rec.permissions };
    }

    if (action === 'session_revoke') {
        const uid = String(payload.discordUserId || '');
        st.sessions = st.sessions.filter(s => String(s.discordUserId) !== uid);
        if (uid === '418558256840179722' || uid === '1308814761269395527') st.manuallyRevokedOwner = true;
        return { revoked: true };
    }

    if (action === 'session_revoke_all') {
        const n = st.sessions.length;
        st.sessions = [];
        st.manuallyRevokedOwner = true;
        return { revokedCount: n };
    }

    // 2. Consultas de lectura
    if (action === 'read_list_tx_admins') {
        return { admins: st.admins };
    }

    if (action === 'read_list_online_players') {
        const q = String(payload.search || '').trim().toLowerCase();
        const onlyStaff = Boolean(payload.onlyStaff);
        const enriched = st.onlinePlayers.map(p => {
            const discRaw = (p.identifiers || []).find(i => /^discord:\d+/i.test(i));
            const discordId = discRaw ? discRaw.replace(/^discord:/i, '') : null;
            const adm = st.admins.find(a =>
                (discordId && a.discordId === discordId) ||
                (p.identifiers || []).some(id => (a.providerIds || []).includes(id.toLowerCase()))
            );
            return {
                id: p.id,
                name: p.name,
                discordId,
                identifiers: p.identifiers,
                character: p.character || null,
                isTxAdmin: Boolean(adm),
                txAdminName: adm?.name || null,
                txAdminMaster: Boolean(adm?.master)
            };
        });
        const staffsOnline = enriched.filter(p => p.isTxAdmin).map(p => ({
            id: p.id,
            name: p.name,
            discordId: p.discordId,
            txAdminName: p.txAdminName,
            isMaster: p.txAdminMaster
        }));
        let players = onlyStaff ? enriched.filter(p => p.isTxAdmin) : enriched;
        if (q) {
            players = players.filter(p =>
                String(p.id) === q ||
                p.name.toLowerCase().includes(q) ||
                String(p.txAdminName || '').toLowerCase().includes(q) ||
                String(p.discordId || '').includes(q)
            );
        }
        return {
            online: true,
            maxClients: 128,
            uptime: '6h 18m',
            totalOnline: enriched.length,
            staffOnlineCount: staffsOnline.length,
            staffsOnline,
            players
        };
    }

    if (action === 'read_search_player') {
        const q = String(payload.query || '').trim().toLowerCase();
        const onlineMatch = st.onlinePlayers.find(p => String(p.id) === q || p.name.toLowerCase().includes(q) || p.identifiers.some(i => i.toLowerCase().includes(q)));
        const player = st.playersDb.find(p =>
            p.displayName.toLowerCase().includes(q) ||
            p.ids.some(i => i.toLowerCase().includes(q)) ||
            (onlineMatch && p.displayName === onlineMatch.name)
        );
        const actions = st.actions.filter(a => {
            if (player && (a.playerName.toLowerCase() === player.displayName.toLowerCase() || a.ids.some(i => player.ids.includes(i)))) return true;
            return a.playerName.toLowerCase().includes(q) || a.id.toLowerCase() === q || a.ids.some(i => i.toLowerCase().includes(q));
        });
        const finalPlayer = player || (actions.length > 0 ? {
            displayName: actions[0].playerName,
            ids: actions[0].ids,
            playTime: 95,
            tsJoined: nowSec - 20 * 86400,
            tsLastConnection: nowSec - 2 * 86400,
            tsWhitelisted: null,
            notes: null
        } : null);
        return {
            player: finalPlayer,
            onlinePlayer: onlineMatch || null,
            actions,
            characters: onlineMatch?.character ? [onlineMatch.character] : []
        };
    }

    if (action === 'read_query_sanctions') {
        const { type = 'all', status = 'all', rangeDays = 0, adminName = '', search = '' } = payload;
        const minTs = Number(rangeDays) > 0 ? (nowSec - Number(rangeDays) * 86400) : 0;
        const adminL = String(adminName || '').toLowerCase();
        const searchL = String(search || '').toLowerCase();
        const summary = {
            total: st.actions.length,
            activeBans: st.actions.filter(a => a.type === 'ban' && a.status === 'active').length,
            totalWarns: st.actions.filter(a => a.type === 'warn').length,
            revoked: st.actions.filter(a => a.status === 'revoked').length
        };
        const items = st.actions.filter(a => {
            if (type !== 'all' && a.type !== type) return false;
            if (status !== 'all' && a.status !== status) return false;
            if (minTs > 0 && a.timestamp < minTs) return false;
            if (adminL && !a.author.toLowerCase().includes(adminL)) return false;
            if (searchL && !`${a.id} ${a.playerName} ${a.reason} ${a.author} ${a.ids.join(' ')}`.toLowerCase().includes(searchL)) return false;
            return true;
        });
        return { summary, items };
    }

    if (action === 'read_get_staff_activity') {
        const map = new Map();
        const touch = (n) => { if (!map.has(n)) map.set(n, { admin: n, bans: 0, warns: 0, revocations: 0, total: 0 }); return map.get(n); };
        for (const a of st.actions) {
            const s = touch(a.author);
            if (a.type === 'ban') s.bans++; else s.warns++;
            s.total++;
            if (a.revokedBy) { const r = touch(a.revokedBy); r.revocations++; r.total++; }
        }
        return {
            ranking: [...map.values()].sort((a, b) => b.total - a.total),
            adminLogLines: payload.includeAdminLog ? st.adminLogLines : []
        };
    }

    if (action === 'read_get_server_resources') {
        const { filter = 'all', search = '' } = payload;
        const q = String(search || '').toLowerCase();
        const resources = st.resources.filter(r => {
            if (filter === 'started' && r.state !== 'started') return false;
            if (filter === 'stopped' && r.state === 'started') return false;
            if (q && !r.name.toLowerCase().includes(q)) return false;
            return true;
        });
        return { hookAvailable: true, resources };
    }

    if (action === 'read_get_console_errors') {
        const q = String(payload.filter || '').toLowerCase();
        const errors = q ? st.consoleErrors.filter(e => e.toLowerCase().includes(q)) : st.consoleErrors;
        return { totalScanned: 420, errors };
    }

    if (action === 'read_get_server_overview') {
        return {
            online: true,
            playersCount: st.onlinePlayers.length,
            maxClients: 128,
            uptime: '6h 18m',
            startedResources: st.resources.filter(r => r.state === 'started').length,
            stoppedResources: st.resources.filter(r => r.state !== 'started').length,
            hostCpu: '8 cores (load 1.14)',
            hostRam: '6.4 GB / 16.0 GB',
            recentErrorsCount: st.consoleErrors.filter(e => /error/i.test(e)).length,
            recentHitchesCount: st.consoleErrors.filter(e => /hitch/i.test(e)).length
        };
    }

    // 3. Acciones simuladas en vivo dentro del Sandbox
    const sess = st.sessions.find(s => String(s.discordUserId) === String(payload.discordUserId));
    const execAs = sess?.txUsername || 'LoLamento_Founder';
    const p = payload.params || {};
    const newId = `TX${Math.floor(10 + Math.random() * 89)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

    if (action === 'tx_ban') {
        st.actions.unshift({
            id: newId,
            type: 'ban',
            author: execAs,
            reason: p.reason || 'Motivo prueba',
            timestamp: nowSec,
            expiration: p.duration === 'permanent' ? 0 : nowSec + 7 * 86400,
            playerName: String(p.target || 'JugadorTest'),
            ids: [String(p.target || 'license:test')],
            status: 'active',
            revokedBy: null,
            revokedAt: null
        });
        st.adminLogLines.unshift(`[TEST] [${execAs}] Banned ${p.target} (${newId}) - ${p.reason}`);
        if (sess) sess.lastAction = `Ban ${p.target} (${newId})`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Ban \`${newId}\` registrado contra \`${p.target}\` (\`${p.duration || 'permanent'}\`). Ya aparece en *Historial de Sanciones*.` };
    }

    if (action === 'tx_revoke_action') {
        const targetId = String(p.actionId || '').toUpperCase();
        const act = st.actions.find(a => a.id.toUpperCase() === targetId);
        if (!act) throw new Error(`No existe el Action ID \`${targetId}\` en el Sandbox. Prueba por ejemplo con \`TX91-B4K2\` o \`TX84-Q7L3\`.`);
        act.status = 'revoked';
        act.revokedBy = execAs;
        act.revokedAt = nowSec;
        st.adminLogLines.unshift(`[TEST] [${execAs}] Revoked action ${act.id} (${act.playerName})`);
        if (sess) sess.lastAction = `Revocar ${act.id}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Acción \`${act.id}\` (${act.playerName}) marcada como **REVOCADA** en el Sandbox.` };
    }

    if (action === 'tx_warn') {
        st.actions.unshift({
            id: newId,
            type: 'warn',
            author: execAs,
            reason: p.reason || 'Advertencia prueba',
            timestamp: nowSec,
            expiration: 0,
            playerName: String(p.target || 'JugadorTest'),
            ids: [],
            status: 'active',
            revokedBy: null,
            revokedAt: null
        });
        st.adminLogLines.unshift(`[TEST] [${execAs}] Warned ${p.target} (${newId}) - ${p.reason}`);
        if (sess) sess.lastAction = `Warn ${p.target}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Advertencia \`${newId}\` enviada a \`${p.target}\` y añadida al historial.` };
    }

    if (action === 'tx_kick') {
        st.adminLogLines.unshift(`[TEST] [${execAs}] Kicked ${p.target} - ${p.reason}`);
        if (sess) sess.lastAction = `Kick ${p.target}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Jugador \`${p.target}\` expulsado correctamente en el Sandbox.` };
    }

    if (action === 'tx_whitelist') {
        const op = String(p.operation || 'add').toLowerCase();
        if (op === 'remove') st.whitelist.delete(p.identifier);
        else st.whitelist.add(p.identifier);
        st.adminLogLines.unshift(`[TEST] [${execAs}] Whitelist ${op}: ${p.identifier}`);
        if (sess) sess.lastAction = `WL ${op}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Whitelist (\`${op}\`) actualizada para \`${p.identifier}\`.` };
    }

    if (action === 'tx_resource_action') {
        const op = String(p.operation || 'restart').toLowerCase();
        const rName = String(p.resourceName || '').trim();
        const found = st.resources.find(r => r.name.toLowerCase() === rName.toLowerCase());
        if (found) found.state = op === 'stop' ? 'stopped' : 'started';
        st.adminLogLines.unshift(`[TEST] [${execAs}] Resource command: ${op} ${rName}`);
        if (sess) sess.lastAction = `${op} ${rName}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Comando \`${op} ${rName}\` ejecutado en el Sandbox${found ? ` (nuevo estado: \`${found.state}\`)` : ''}.` };
    }

    if (action === 'tx_announcement') {
        st.adminLogLines.unshift(`[TEST] [${execAs}] Broadcast: ${p.message}`);
        if (sess) sess.lastAction = 'Anuncio global';
        return { executedAs: execAs, message: `🧪 **[TEST]** Anuncio enviado: *"${String(p.message || '').slice(0, 140)}"*` };
    }

    if (action === 'tx_server_control') {
        const op = String(p.operation || 'restart').toUpperCase();
        st.adminLogLines.unshift(`[TEST] [${execAs}] Server control: ${op}`);
        if (sess) sess.lastAction = `Servidor: ${op}`;
        return { executedAs: execAs, message: `🧪 **[TEST]** Orden \`${op}\` simulada correctamente sobre FXServer.` };
    }

    throw new Error(`Acción demo no soportada: ${action}`);
}

module.exports = {
    getDemoState,
    resetDemoState,
    getDemoBridgeStatus,
    toggleDemoReadOnly,
    dispatchDemoAction
};
