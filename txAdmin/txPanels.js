// ============================================================================
// MÓDULO TXADMIN: PANELES INTERACTIVOS, MENÚS, MODALES Y PAGINACIÓN
// ============================================================================
// Diseño 100% interactivo al estilo de los logs/menús de tickets:
// - Menú desplegable principal donde pulsas y aparece todo.
// - Navegación paginada editando el mismo mensaje privado (0 spam en el canal).

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const guildManager = require('../guildManager');

const ACTION_LABELS = {
    tx_ban: '🔨 Banear Jugador',
    tx_revoke_action: '🔓 Revocar Sanción (Desban / Retirar Warn)',
    tx_warn: '⚠️ Enviar Advertencia (Warn)',
    tx_kick: '👢 Expulsar Jugador (Kick)',
    tx_resource_action: '🧩 Control de Recurso FiveM',
    tx_server_control: '🔄 Control del Servidor FXServer',
    tx_announcement: '📢 Enviar Anuncio Global'
};

function resolveIcon(guild, guildId, bannerType = null) {
    const v = guildManager.resolveGuildVisuals(guildId, bannerType);
    const httpsLogo = (v.config?.LOGO_URL && /^https?:\/\//i.test(v.config.LOGO_URL))
        ? v.config.LOGO_URL.trim()
        : (guild?.iconURL?.({ size: 256, extension: 'png' }) || undefined);

    const logoUrl = httpsLogo || v.logoUrl || undefined;
    const bannerUrl = v.bannerUrl || null;

    // Filtrar archivos adjuntos: incluir solo lo que realmente referencia el embed (evita logos flotantes gigantes)
    const files = (v.files || []).filter(f => {
        const ref = `attachment://${f.name}`;
        return ref === logoUrl || ref === bannerUrl;
    });

    return { v, iconUrl: logoUrl, bannerUrl, files, serverName: v.name || 'SERVIDOR RP' };
}

function fmtTs(unixSecOrMs) {
    if (!unixSecOrMs) return '`N/D`';
    const sec = unixSecOrMs > 1e12 ? Math.floor(unixSecOrMs / 1000) : Math.floor(unixSecOrMs);
    return `<t:${sec}:f>`;
}

function fmtRel(unixSecOrMs) {
    if (!unixSecOrMs) return '`N/D`';
    const sec = unixSecOrMs > 1e12 ? Math.floor(unixSecOrMs / 1000) : Math.floor(unixSecOrMs);
    return `<t:${sec}:R>`;
}

function fmtPlaytime(minutesOrSeconds) {
    const mins = Math.max(0, Math.round(Number(minutesOrSeconds) || 0));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function buildNoticeEmbed(guild, { title, description, color = null, footerText = null }) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const embed = new EmbedBuilder()
        .setColor(color || v.color)
        .setAuthor({
            name: `CONTROL TXADMIN • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(title)
        .setDescription(description || '\u200B')
        .setFooter({
            text: footerText || `${serverName} • Panel Interactivo txAdmin`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();
    if (iconUrl) embed.setThumbnail(iconUrl);
    return embed;
}

// ============================================================================
// 1. PANEL PERMANENTE DEL CANAL (!panel-txadmin)
// ============================================================================
function buildMainPanelPayload(guild, bridgeStatus, { includeFiles = true } = {}) {
    const { v, iconUrl, bannerUrl, files, serverName } = resolveIcon(guild, guild?.id, 'txadmin');
    const onlineTxt = bridgeStatus.online
        ? `🟢 \`Conectado\` *(latencia: \`${bridgeStatus.latencyMs ?? 0}ms\` • modo: \`${bridgeStatus.info?.mode || 'local'}\`)*`
        : (bridgeStatus.secretConfigured
            ? '🔴 `Puente desconectado` *(esperando que arranque `txBridge` en el PC/VPS)*'
            : '🟡 `Sin configurar` *(el creador debe usar `!tx-setup`)*');

    const modeTxt = bridgeStatus.readOnlyMode
        ? '🔒 `Solo Lectura` *(acciones bloqueadas por el Creador)*'
        : '🟢 `Lectura + Acciones Activas`';

    const linkedCount = (bridgeStatus.sessions || []).length;

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `CENTRO DE CONTROL TXADMIN | ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle('🛡️┃GESTIÓN INTEGRAL DE TXADMIN + ASISTENTE IA')
        .setDescription(
            `Bienvenido al **Centro de Control Interactivo de txAdmin** exclusivo del equipo de Staff de **${serverName}**.\n\n` +
            `📡┃**Estado de Conexión**\n` +
            `> • **Puente FiveM/txAdmin:** ${onlineTxt}\n` +
            `> • **Modo de Operación:** ${modeTxt}\n` +
            `> • **Sesiones Staff vinculadas:** \`${linkedCount}\` activas\n\n` +
            `────────────────────────────\n\n` +
            `📋┃**¿Cómo funciona este panel?**\n` +
            `> 1️⃣ **Inicia sesión una sola vez** con tu cuenta de txAdmin desde el menú de abajo *(queda permanente hasta que el creador la cierre)*.\n` +
            `> 2️⃣ **Selecciona cualquier sección del menú:** todo se abre en privado *(solo para ti)* con **paginación, filtros y edición en el mismo mensaje** para mantener el canal 100% limpio.\n` +
            `> 3️⃣ **Usa el Asistente IA** para consultar antecedentes, baneos, recursos o errores en lenguaje natural — toda acción requiere tu **confirmación por botón**.\n\n` +
            `💡 *Este panel es permanente. Ninguna interacción ensucia este canal.*`
        )
        .setFooter({
            text: `${serverName} • Centro de Control txAdmin`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    if (iconUrl) embed.setThumbnail(iconUrl);
    if (bannerUrl) embed.setImage(bannerUrl);

    const mainMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_main_menu')
        .setPlaceholder('🛡️ Selecciona una opción del panel de txAdmin...')
        .addOptions([
            {
                label: 'Iniciar Sesión en txAdmin',
                description: 'Vincula tu cuenta personal de txAdmin (1 sola vez, permanente)',
                value: 'login',
                emoji: '🔑'
            },
            {
                label: 'Asistente IA de txAdmin',
                description: 'Consulta datos reales o solicita acciones en lenguaje natural',
                value: 'ai',
                emoji: '🧠'
            },
            {
                label: 'Jugadores Conectados',
                description: 'Lista en vivo paginada con ID, ping e identificadores',
                value: 'players',
                emoji: '👥'
            },
            {
                label: 'Buscar Jugador / Antecedentes',
                description: 'Perfil completo, conexiones, notas, sanciones y personajes',
                value: 'search_player',
                emoji: '🔎'
            },
            {
                label: 'Historial de Sanciones',
                description: 'Baneos activos/expirados/revocados y Warnings paginados',
                value: 'sanctions',
                emoji: '⚖️'
            },
            {
                label: 'Actividad del Staff y Admin Log',
                description: 'Ranking de sanciones por admin y últimos cambios en admin.log',
                value: 'staff_activity',
                emoji: '🛡️'
            },
            {
                label: 'Estado, Recursos y Errores',
                description: 'Rendimiento, recursos iniciados/detenidos y errores de consola',
                value: 'server_status',
                emoji: '🖥️'
            },
            {
                label: 'Ejecutar Acción Administrativa',
                description: 'Ban, Desban, Warn, Kick, Recursos o Anuncio',
                value: 'actions',
                emoji: '⚡'
            }
        ]);

    const quickRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_login')
            .setLabel('Mi Sesión txAdmin')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔑'),
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_ai')
            .setLabel('Consulta IA')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🧠'),
        new ButtonBuilder()
            .setCustomId('btn_tx_refresh_main')
            .setLabel('Actualizar Estado')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );

    const payload = {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(mainMenu),
            quickRow
        ]
    };
    if (includeFiles && files.length > 0) payload.files = files;
    return payload;
}

// ============================================================================
// 1B. PANEL PERMANENTE EXCLUSIVO DEL CREADOR (!panel-txowner)
// ============================================================================
function buildOwnerPermanentPanelPayload(guild, bridgeStatus, { includeFiles = true } = {}) {
    const { iconUrl, bannerUrl, files, serverName } = resolveIcon(guild, guild?.id, 'txadmin');
    const onlineTxt = bridgeStatus.online
        ? `🟢 \`Conectado\` *(latencia: \`${bridgeStatus.latencyMs ?? 0}ms\` • modo: \`${bridgeStatus.info?.mode || 'local'}\`)*`
        : (bridgeStatus.secretConfigured
            ? '🔴 `Puente desconectado` *(esperando `txBridge`)*'
            : '🟡 `Sin configurar` *(pulsa "Generar Credenciales" o usa `!tx-setup`)*');

    const sessions = Array.isArray(bridgeStatus.sessions) ? bridgeStatus.sessions : [];
    const sessPreview = sessions.length > 0
        ? sessions.slice(0, 10).map((s, i) => `> \`#${i + 1}\` <@${s.discordUserId}> ➔ **\`${s.txUsername}\`** *(vinculado ${fmtRel(s.linkedAt)})*`).join('\n')
        : '> 📭 *Ningún Staff tiene sesión activa en este servidor todavía.*';

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({
            name: `PANEL MAESTRO DEL CREADOR | ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle('👑┃CONTROL MAESTRO TXADMIN (EXCLUSIVO CREADOR)')
        .setDescription(
            `Panel de administración superior de **txAdmin** exclusivo para el creador del bot en **${serverName}**.\n\n` +
            `📡┃**Estado del Puente y Seguridad**\n` +
            `> • **Puente FiveM/txAdmin:** ${onlineTxt}\n` +
            `> • **Modo de Operación:** ${bridgeStatus.readOnlyMode ? '🔒 `SOLO LECTURA (acciones bloqueadas)`' : '🟢 `Lectura + Acciones Activas`'}\n` +
            `> • **Token de Conexión:** ${bridgeStatus.secretConfigured ? '✅ `Configurado`' : '❌ `No generado`'}\n\n` +
            `────────────────────────────\n\n` +
            `👥┃**Sesiones de Staff Vinculadas (${sessions.length})**\n` +
            `${sessPreview}\n\n` +
            `💡 *Usa los controles inferiores para ver admins registrados en txAdmin, cerrar sesiones a cualquier Staff o bloquear acciones al instante.*`
        )
        .setFooter({
            text: `${serverName} • Panel Exclusivo Creador (!panel-txowner)`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    if (iconUrl) embed.setThumbnail(iconUrl);
    if (bannerUrl) embed.setImage(bannerUrl);

    const ownerMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_owner_panel')
        .setPlaceholder('👑 Selecciona una herramienta de Creador...')
        .addOptions([
            {
                label: 'Gestionar / Cerrar Sesiones de Staff',
                description: 'Ver todas las sesiones activas y revocar acceso individual o total',
                value: 'manage_sessions',
                emoji: '🔑'
            },
            {
                label: 'Ver Admins Registrados en txAdmin',
                description: 'Leer admins.json en vivo con los permisos reales de cada admin',
                value: 'view_admins',
                emoji: '📋'
            },
            {
                label: 'Alternar Modo Solo Lectura / Activo',
                description: 'Bloquear o permitir acciones administrativas desde Discord al instante',
                value: 'toggle_readonly',
                emoji: '🔒'
            },
            {
                label: 'Recibir Credenciales .env por DM',
                description: 'Envía por privado el bloque txBridge/.env actual de este servidor',
                value: 'send_env_dm',
                emoji: '🔐'
            },
            {
                label: 'Reiniciar / Detener / Arrancar Servidor',
                description: 'Control directo del proceso FXServer en txAdmin (Solo Creador)',
                value: 'server_control',
                emoji: '🔄'
            }
        ]);

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_sessions')
            .setLabel('Sesiones Staff')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_admins')
            .setLabel('Admins txAdmin')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_refresh_panel')
            .setLabel('Actualizar Panel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );

    const payload = {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(ownerMenu),
            btnRow
        ]
    };
    if (includeFiles && files.length > 0) payload.files = files;
    return payload;
}

// ============================================================================
// 2. MENÚ PRIVADO INTERACTIVO (VOLVER AL HUB DENTRO DEL MISMO MENSAJE EFÍMERO)
// ============================================================================
function buildEphemeralHubPayload(guild, bridgeStatus, userSession, isOwner) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const sessionLine = userSession
        ? `🟢 Vinculada como **\`${userSession.txUsername}\`** *(desde ${fmtRel(userSession.linkedAt)})*`
        : '🔴 Sin vincular *(usa `🔑 Iniciar Sesión` para ejecutar acciones con tu cuenta)*';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `CONSOLA PRIVADA TXADMIN • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle('🧭┃MENÚ INTERACTIVO DE CONTROL')
        .setDescription(
            `> 📡 **Puente:** ${bridgeStatus.online ? '🟢 `Conectado`' : '🔴 `Desconectado`'}\n` +
            `> 🔑 **Tu sesión:** ${sessionLine}\n\n` +
            `Elige en el desplegable inferior a qué módulo quieres cambiar. Todo se actualiza **en este mismo mensaje**.`
        )
        .setFooter({
            text: `${serverName} • Solo tú puedes ver esta consola`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const options = [
        { label: 'Asistente IA de txAdmin', description: 'Consultar o proponer acciones en lenguaje natural', value: 'ai', emoji: '🧠' },
        { label: 'Jugadores Conectados', description: 'Lista paginada en vivo', value: 'players', emoji: '👥' },
        { label: 'Buscar Jugador / Antecedentes', description: 'Ficha completa por nombre, license o Discord', value: 'search_player', emoji: '🔎' },
        { label: 'Historial de Sanciones', description: 'Baneos y warnings con filtros y paginación', value: 'sanctions', emoji: '⚖️' },
        { label: 'Actividad del Staff y Admin Log', description: 'Ranking y últimas acciones administrativas', value: 'staff_activity', emoji: '🛡️' },
        { label: 'Estado, Recursos y Errores', description: 'Uptime, recursos y fxserver.log', value: 'server_status', emoji: '🖥️' },
        { label: 'Ejecutar Acción Administrativa', description: 'Ban, Desban, Warn, Kick, Recursos, Anuncio...', value: 'actions', emoji: '⚡' },
        { label: 'Iniciar / Actualizar Sesión txAdmin', description: 'Vincular o refrescar tu cuenta de txAdmin', value: 'login', emoji: '🔑' }
    ];
    if (isOwner) {
        options.push({
            label: 'Panel Maestro del Creador',
            description: 'Sesiones activas, admins.json y modo solo lectura',
            value: 'owner_panel',
            emoji: '👑'
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_ephemeral_nav')
        .setPlaceholder('🧭 Cambiar de sección...')
        .addOptions(options);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)]
    };
}

// ============================================================================
// 3. VISTA PAGINADA: JUGADORES CONECTADOS
// ============================================================================
function buildOnlinePlayersPayload(guild, data, page = 0) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const players = Array.isArray(data?.players) ? data.players : [];
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(players.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = players.slice(safePage * perPage, safePage * perPage + perPage);

    let body = '';
    if (slice.length === 0) {
        body = '> 📭 *No hay jugadores conectados en este momento (o FXServer está apagado).*';
    } else {
        body = slice.map(p => {
            const disc = (p.identifiers || []).find(i => i.startsWith('discord:'));
            const lic = (p.identifiers || []).find(i => i.startsWith('license:'));
            const discTag = disc ? `<@${disc.replace('discord:', '')}>` : '`Sin Discord`';
            const licShort = lic ? `\`${lic.slice(0, 18)}…\`` : '`N/D`';
            const charTxt = p.character?.fullName ? ` • 🎭 **${p.character.fullName}** *(${p.character.job || 'Civil'})*` : '';
            return `> \`[ID ${p.id}]\` **${p.name}** • 📶 \`${p.ping ?? 0}ms\` • ${discTag} • ${licShort}${charTxt}`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `JUGADORES EN VIVO • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(`👥┃Jugadores Conectados (${players.length}/${data?.maxClients || '?'})`)
        .setDescription(
            `> 🖥️ **Servidor:** ${data?.online ? '🟢 `Online`' : '🔴 `Offline`'} • ⏱️ **Uptime:** \`${data?.uptime || 'N/D'}\`\n\n` +
            `────────────────────────────\n\n` +
            `${body}`
        )
        .setFooter({
            text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Solo tú puedes ver esta vista`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${Math.max(0, safePage - 1)}`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId('tx_pg_info_disabled')
            .setLabel(`Pág. ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${Math.min(totalPages - 1, safePage + 1)}`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${safePage}_ref`)
            .setLabel('Actualizar')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('↩️')
    );

    return { embeds: [embed], components: [navRow] };
}

// ============================================================================
// 4. VISTA PAGINADA: HISTORIAL DE SANCIONES (CON FILTROS COMO TICKET LOGS)
// ============================================================================
const SANCTION_FILTERS = {
    all: 'Todas las sanciones',
    ban_active: 'Baneos Activos',
    ban_expired: 'Baneos Expirados',
    revoked: 'Sanciones Revocadas',
    warn: 'Solo Advertencias (Warns)',
    week: 'Últimos 7 días'
};

function buildSanctionsPayload(guild, data, page = 0, filterKey = 'all') {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const items = Array.isArray(data?.items) ? data.items : [];
    const perPage = 6;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = items.slice(safePage * perPage, safePage * perPage + perPage);

    let body = '';
    if (slice.length === 0) {
        body = '> 📭 *No hay sanciones que coincidan con este filtro.*';
    } else {
        body = slice.map(a => {
            const typeEmoji = a.type === 'ban' ? '🔨' : '⚠️';
            const statusBadge = a.status === 'active'
                ? '🔴 `ACTIVO`'
                : (a.status === 'revoked' ? '🟣 `REVOCADO`' : '⚪ `EXPIRADO`');
            const durTxt = a.type === 'ban'
                ? (a.expiration ? `Expira: ${fmtTs(a.expiration)}` : '`Permanente`')
                : '`Advertencia`';
            const revLine = a.revokedBy ? `\n> 🔓 *Revocado por \`${a.revokedBy}\` (${fmtRel(a.revokedAt)})*` : '';
            return (
                `${typeEmoji} **\`${a.id}\`** • ${statusBadge} — **${a.playerName || 'Desconocido'}**\n` +
                `> 📝 **Motivo:** ${(a.reason || 'Sin motivo').slice(0, 140)}\n` +
                `> 🛡️ **Admin:** \`${a.author || 'txAdmin'}\` • 📅 ${fmtTs(a.timestamp)} • ⏳ ${durTxt}${revLine}`
            );
        }).join('\n\n');
    }

    const summary = data?.summary || {};
    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `HISTORIAL DE SANCIONES TXADMIN • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(`⚖️┃${SANCTION_FILTERS[filterKey] || 'Historial de Sanciones'}`)
        .setDescription(
            `> 🔎 **Mostrando:** \`${items.length}\` • 🔨 **Bans activos:** \`${summary.activeBans ?? 0}\` • ⚠️ **Warns:** \`${summary.totalWarns ?? 0}\` • 🟣 **Revocadas:** \`${summary.revoked ?? 0}\`\n\n` +
            `────────────────────────────\n\n` +
            `${body}`
        )
        .setFooter({
            text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Filtro: ${filterKey}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_pg_sanctions_${Math.max(0, safePage - 1)}_${filterKey}`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId('tx_pg_info_disabled')
            .setLabel(`Pág. ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`tx_pg_sanctions_${Math.min(totalPages - 1, safePage + 1)}_${filterKey}`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`tx_pg_sanctions_${safePage}_${filterKey}_ref`)
            .setLabel('Actualizar')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('↩️')
    );

    const filterMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_sanctions_filter')
        .setPlaceholder('🔎 Filtrar sanciones por tipo o estado...')
        .addOptions(
            Object.entries(SANCTION_FILTERS).map(([k, lbl]) => ({
                label: lbl,
                value: k,
                emoji: k === 'ban_active' ? '🔴' : (k === 'warn' ? '⚠️' : (k === 'revoked' ? '🟣' : '📋')),
                default: k === filterKey
            }))
        );

    return {
        embeds: [embed],
        components: [navRow, new ActionRowBuilder().addComponents(filterMenu)]
    };
}

// ============================================================================
// 5. VISTA PAGINADA: FICHA DE JUGADOR Y ANTECEDENTES
// ============================================================================
function buildPlayerProfilePayload(guild, data, query, page = 0) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);

    if (!data?.player) {
        return {
            embeds: [buildNoticeEmbed(guild, {
                title: '🔎┃Jugador No Encontrado',
                description: `No se encontró ningún registro en \`playersDB.json\` para **\`${query}\`**.\n\n> 💡 *Prueba con su nombre exacto, su \`license:\`, su \`discord:\` o su ID conectado.*`,
                color: 0xF39C12
            })],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tx_open_search_modal').setLabel('Buscar Otro').setStyle(ButtonStyle.Primary).setEmoji('🔎'),
                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
            )]
        };
    }

    const p = data.player;
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const chars = Array.isArray(data.characters) ? data.characters : [];
    const perPage = 5;
    const totalPages = Math.max(1, Math.ceil(actions.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = actions.slice(safePage * perPage, safePage * perPage + perPage);

    const idsText = (p.ids || []).slice(0, 6).map(id => `\`${id}\``).join(' · ') || '`Sin identificadores`';
    const notesText = p.notes?.text ? `> 📝 **Nota Staff (${p.notes.author || 'Staff'}):** *${p.notes.text.slice(0, 200)}*\n` : '';
    const charSection = chars.length > 0
        ? `🎭┃**Personajes IC (${chars.length})**\n` +
          chars.slice(0, 3).map(c => `> • **${c.fullName}** — Trabajo: \`${c.job || 'Civil'}\` • Banco: \`$${c.bank ?? '?'}\``).join('\n') + '\n\n'
        : '';

    let historyBody = '> ✅ *Sin antecedentes de baneos ni advertencias registrados.*';
    if (slice.length > 0) {
        historyBody = slice.map(a => {
            const ic = a.type === 'ban' ? '🔨' : '⚠️';
            const st = a.status === 'active' ? '🔴 `ACTIVO`' : (a.status === 'revoked' ? '🟣 `REVOCADO`' : '⚪ `EXPIRADO`');
            return `${ic} **\`${a.id}\`** ${st} • ${fmtTs(a.timestamp)}\n> **Admin:** \`${a.author}\` • **Motivo:** ${(a.reason || 'N/D').slice(0, 120)}`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `FICHA DE JUGADOR TXADMIN • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(`👤┃${p.displayName || 'Jugador'} ${data.onlinePlayer ? '🟢 (ONLINE)' : '⚪ (OFFLINE)'}`)
        .setDescription(
            `> 🆔 **IDs:** ${idsText}\n` +
            `> 📅 **1.ª Conexión:** ${fmtTs(p.tsJoined)} • 🕒 **Última:** ${fmtRel(p.tsLastConnection)}\n` +
            `> ⏱️ **Tiempo jugado:** \`${fmtPlaytime(p.playTime)}\`\n` +
            `${notesText}\n` +
            `${charSection}` +
            `────────────────────────────\n\n` +
            `⚖️┃**Antecedentes (${actions.length} registros)**\n${historyBody}`
        )
        .setFooter({
            text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Consulta: ${query.slice(0, 40)}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const safeQ = encodeURIComponent(query.slice(0, 40));
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_pg_player_${Math.max(0, safePage - 1)}_${safeQ}`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId('tx_pg_info_disabled')
            .setLabel(`Pág. ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`tx_pg_player_${Math.min(totalPages - 1, safePage + 1)}_${safeQ}`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('tx_open_search_modal')
            .setLabel('Otra Búsqueda')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔎'),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('↩️')
    );

    return { embeds: [embed], components: [navRow] };
}

// ============================================================================
// 6. VISTA PAGINADA: ACTIVIDAD DE STAFF Y ADMIN.LOG
// ============================================================================
function buildStaffActivityPayload(guild, data, page = 0, viewMode = 'ranking') {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);

    if (viewMode === 'adminlog') {
        const logs = Array.isArray(data?.adminLogLines) ? data.adminLogLines : [];
        const perPage = 12;
        const totalPages = Math.max(1, Math.ceil(logs.length / perPage));
        const safePage = Math.min(Math.max(0, page), totalPages - 1);
        const slice = logs.slice(safePage * perPage, safePage * perPage + perPage);

        const body = slice.length > 0
            ? `\`\`\`text\n${slice.join('\n').slice(0, 3400)}\n\`\`\``
            : '> 📭 *No hay entradas recientes en `admin.log`.*';

        const embed = new EmbedBuilder()
            .setColor(v.color)
            .setAuthor({ name: `REGISTRO ADMIN.LOG • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle('📜┃Últimas Acciones en admin.log')
            .setDescription(body)
            .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages} • admin.log`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.max(0, safePage - 1)}_adminlog`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                    new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.min(totalPages - 1, safePage + 1)}_adminlog`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                    new ButtonBuilder().setCustomId('tx_pg_staff_0_ranking').setLabel('Ver Ranking').setStyle(ButtonStyle.Primary).setEmoji('🏆'),
                    new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
                )
            ]
        };
    }

    const ranking = Array.isArray(data?.ranking) ? data.ranking : [];
    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(ranking.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = ranking.slice(safePage * perPage, safePage * perPage + perPage);

    const body = slice.length === 0
        ? '> 📭 *Todavía no hay estadísticas de actividad administrativa registradas.*'
        : slice.map((r, idx) => {
            const rankNum = safePage * perPage + idx + 1;
            const medal = rankNum === 1 ? '🥇' : (rankNum === 2 ? '🥈' : (rankNum === 3 ? '🥉' : `\`#${rankNum}\``));
            return `${medal} **${r.admin}** — \`${r.total}\` acciones\n> 🔨 Bans: \`${r.bans}\` • ⚠️ Warns: \`${r.warns}\` • 🔓 Revocaciones: \`${r.revocations}\``;
        }).join('\n\n');

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({ name: `ACTIVIDAD DEL STAFF • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle('🛡️┃Ranking de Actividad Administrativa (txAdmin)')
        .setDescription(
            `> 📊 **Total administradores activos:** \`${ranking.length}\`\n\n` +
            `────────────────────────────\n\n` +
            `${body}`
        )
        .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Ranking Staff`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.max(0, safePage - 1)}_ranking`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.min(totalPages - 1, safePage + 1)}_ranking`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                new ButtonBuilder().setCustomId('tx_pg_staff_0_adminlog').setLabel('Ver admin.log').setStyle(ButtonStyle.Primary).setEmoji('📜'),
                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
            )
        ]
    };
}

// ============================================================================
// 7. VISTA PAGINADA: ESTADO DEL SERVIDOR, RECURSOS Y ERRORES DE CONSOLA
// ============================================================================
function buildServerAndResourcesPayload(guild, data, page = 0, tab = 'overview') {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);

    const tabMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_server_tab')
        .setPlaceholder('🖥️ Cambiar vista técnica...')
        .addOptions([
            { label: 'Resumen General y Rendimiento', value: 'overview', emoji: '📊', default: tab === 'overview' },
            { label: 'Todos los Recursos FiveM', value: 'res_all', emoji: '🧩', default: tab === 'res_all' },
            { label: 'Solo Recursos Detenidos / Error', value: 'res_stopped', emoji: '🔴', default: tab === 'res_stopped' },
            { label: 'Últimos Errores de Consola (fxserver.log)', value: 'console_errors', emoji: '🚨', default: tab === 'console_errors' }
        ]);

    if (tab === 'overview') {
        const ov = data?.overview || {};
        const embed = new EmbedBuilder()
            .setColor(v.color)
            .setAuthor({ name: `MONITOR TÉCNICO • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle('🖥️┃Estado y Rendimiento del Servidor')
            .setDescription(
                `> 🟢 **FXServer:** ${ov.online ? '`ONLINE`' : '🔴 `OFFLINE`'} • 👥 **Jugadores:** \`${ov.playersCount ?? 0}/${ov.maxClients ?? '?'}\`\n` +
                `> ⏱️ **Uptime Puente/Host:** \`${ov.uptime || 'N/D'}\` • 🧩 **Recursos:** \`${ov.startedResources ?? '?'}\` activos / \`${ov.stoppedResources ?? '?'}\` detenidos\n` +
                `> 💻 **Host CPU/RAM:** \`${ov.hostCpu || 'N/D'}\` • \`${ov.hostRam || 'N/D'}\`\n` +
                `> 🚨 **Alertas recientes en fxserver.log:** \`${ov.recentErrorsCount ?? 0}\` errores • \`${ov.recentHitchesCount ?? 0}\` hitches\n\n` +
                `────────────────────────────\n` +
                `💡 *Usa el desplegable inferior para inspeccionar recursos iniciados/detenidos o ver los últimos errores de consola.*`
            )
            .setFooter({ text: `${serverName} • Monitor en Vivo`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tx_pg_srv_0_overview_ref').setLabel('Actualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
                    new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
                ),
                new ActionRowBuilder().addComponents(tabMenu)
            ]
        };
    }

    if (tab === 'console_errors') {
        const errs = Array.isArray(data?.errors) ? data.errors : [];
        const perPage = 8;
        const totalPages = Math.max(1, Math.ceil(errs.length / perPage));
        const safePage = Math.min(Math.max(0, page), totalPages - 1);
        const slice = errs.slice(safePage * perPage, safePage * perPage + perPage);

        const body = slice.length > 0
            ? `\`\`\`text\n${slice.join('\n').slice(0, 3400)}\n\`\`\``
            : '> ✅ *No se han detectado errores recientes en `fxserver.log`.*';

        const embed = new EmbedBuilder()
            .setColor(errs.length > 0 ? 0xE74C3C : 0x2ECC71)
            .setAuthor({ name: `CONSOLA FXSERVER • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle(`🚨┃Errores Recientes de Consola (${errs.length})`)
            .setDescription(body)
            .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages} • fxserver.log`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.max(0, safePage - 1)}_console_errors`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                    new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.min(totalPages - 1, safePage + 1)}_console_errors`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                    new ButtonBuilder().setCustomId(`tx_pg_srv_${safePage}_console_errors_ref`).setLabel('Actualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
                    new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
                ),
                new ActionRowBuilder().addComponents(tabMenu)
            ]
        };
    }

    // Recursos (res_all / res_stopped)
    const resources = Array.isArray(data?.resources) ? data.resources : [];
    const perPage = 16;
    const totalPages = Math.max(1, Math.ceil(resources.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = resources.slice(safePage * perPage, safePage * perPage + perPage);

    let body = '';
    if (!data?.hookAvailable) {
        body = '> ⚠️ *El recurso `vantex_tx_hook` no respondió todavía. Asegúrate de añadir `ensure vantex_tx_hook` en tu `server.cfg`.*';
    } else if (slice.length === 0) {
        body = tab === 'res_stopped'
            ? '> ✅ *¡Todos los recursos están iniciados correctamente!*'
            : '> 📭 *No se encontraron recursos.*';
    } else {
        body = slice.map(r => {
            const dot = r.state === 'started' ? '🟢' : (r.state === 'starting' ? '🟡' : '🔴');
            return `${dot} \`${r.name}\` — *${r.state}*`;
        }).join('\n');
    }

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({ name: `RECURSOS FIVEM • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle(`🧩┃${tab === 'res_stopped' ? 'Recursos Detenidos / Con Problema' : 'Recursos del Servidor'} (${resources.length})`)
        .setDescription(body)
        .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.max(0, safePage - 1)}_${tab}`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.min(totalPages - 1, safePage + 1)}_${tab}`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                new ButtonBuilder().setCustomId(`tx_pg_srv_${safePage}_${tab}_ref`).setLabel('Actualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
            ),
            new ActionRowBuilder().addComponents(tabMenu)
        ]
    };
}

// ============================================================================
// 8. SUBMENÚ INTERACTIVO DE ACCIONES ADMINISTRATIVAS
// ============================================================================
function buildActionsMenuPayload(guild, userSession, readOnlyMode) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const embed = new EmbedBuilder()
        .setColor(readOnlyMode ? 0xF39C12 : v.color)
        .setAuthor({ name: `ACCIONES ADMINISTRATIVAS • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle('⚡┃Ejecutar Acción Real en txAdmin')
        .setDescription(
            `> 🔑 **Tu cuenta txAdmin:** ${userSession ? `🟢 \`${userSession.txUsername}\`` : '🔴 `No vinculada (inicia sesión primero)`'}\n` +
            `> 🛡️ **Estado del sistema:** ${readOnlyMode ? '🔒 `MODO SOLO LECTURA ACTIVADO POR EL CREADOR`' : '🟢 `Acciones habilitadas`'}\n\n` +
            `────────────────────────────\n\n` +
            `Selecciona la acción en el menú inferior. Se abrirá un formulario privado y luego **un paso de confirmación** antes de enviarla a txAdmin.\n` +
            `*Todas las acciones quedan grabadas en txAdmin con tu nombre real y respetando tus permisos de txAdmin.*`
        )
        .setFooter({ text: `${serverName} • Confirmación obligatoria en todas las acciones`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    const actionsMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_action_pick')
        .setPlaceholder('⚡ Elige qué acción deseas ejecutar en txAdmin...')
        .setDisabled(Boolean(readOnlyMode) || !userSession)
        .addOptions([
            { label: 'Banear Jugador', description: 'Ban temporal o permanente (online u offline)', value: 'tx_ban', emoji: '🔨' },
            { label: 'Desbanear / Retirar Advertencia', description: 'Revocar un ban o warn usando su Action ID', value: 'tx_revoke_action', emoji: '🔓' },
            { label: 'Enviar Advertencia (Warn)', description: 'Warn oficial en txAdmin al jugador conectado', value: 'tx_warn', emoji: '⚠️' },
            { label: 'Expulsar Jugador (Kick)', description: 'Expulsar del servidor con motivo', value: 'tx_kick', emoji: '👢' },
            { label: 'Control de Recurso FiveM', description: 'ensure / stop / restart / refresh de un recurso', value: 'tx_resource_action', emoji: '🧩' },
            { label: 'Enviar Anuncio Global', description: 'Anuncio oficial dentro del servidor FiveM', value: 'tx_announcement', emoji: '📢' }
        ]);

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_tx_quick_login').setLabel(userSession ? 'Cambiar Sesión' : 'Iniciar Sesión').setStyle(ButtonStyle.Primary).setEmoji('🔑'),
        new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Volver al Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
    );

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(actionsMenu), btnRow]
    };
}

// ============================================================================
// 9. EMBED DE CONFIRMACIÓN HUMANA OBLIGATORIA (ACCIONES DIRECTAS E IA)
// ============================================================================
function buildConfirmationPayload(guild, { confirmId, bridgeAction, params, txUsername, aiAnswer = null }) {
    const { iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const label = ACTION_LABELS[bridgeAction] || bridgeAction;
    const paramLines = Object.entries(params || {})
        .filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')
        .map(([k, val]) => `> • **${k}:** \`${String(val).slice(0, 220)}\``)
        .join('\n') || '> *(Sin parámetros adicionales)*';

    const aiHeader = aiAnswer
        ? `💡┃**Análisis previo de la IA**\n${aiAnswer.slice(0, 2200)}\n\n────────────────────────────\n\n`
        : '';

    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setAuthor({ name: `CONFIRMACIÓN REQUERIDA • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle(`⚠️┃Confirmar: ${label}`)
        .setDescription(
            `${aiHeader}` +
            `📌┃**Detalles que se enviarán a txAdmin**\n` +
            `${paramLines}\n\n` +
            `> 🔑 **Se ejecutará como:** \`${txUsername || 'Sin sesión'}\`\n` +
            `> ⏳ **Validez:** *Esta confirmación caduca en 60 segundos y solo puedes pulsarla tú.*`
        )
        .setFooter({ text: `${serverName} • Protección Humana Obligatoria`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_confirm_yes_${confirmId}`)
            .setLabel('Confirmar y Ejecutar en txAdmin')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`tx_confirm_no_${confirmId}`)
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌'),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
    );

    return { embeds: [embed], components: [row] };
}

// ============================================================================
// 10. PANEL MAESTRO EXCLUSIVO DEL CREADOR (OWNER)
// ============================================================================
function buildOwnerMasterPayload(guild, bridgeStatus, txAdmins = [], showingAdmins = false) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const sessions = Array.isArray(bridgeStatus.sessions) ? bridgeStatus.sessions : [];

    let body = '';
    if (showingAdmins) {
        if (txAdmins.length === 0) {
            body = '> 📭 *No se pudo leer `admins.json` (puente desconectado o ruta no configurada).*';
        } else {
            body = `📋┃**Administradores en \`admins.json\` (${txAdmins.length})**\n` +
                txAdmins.slice(0, 20).map(a => {
                    const perms = a.master ? '`MASTER (Todos)`' : `\`${(a.permissions || []).slice(0, 5).join(', ') || 'Básicos'}\``;
                    return `> • **${a.name}** — ${perms}`;
                }).join('\n');
        }
    } else {
        if (sessions.length === 0) {
            body = '> 📭 *Ningún Staff tiene sesión vinculada actualmente en este servidor.*';
        } else {
            body = `👥┃**Staffs con Sesión Activa en el Bot (${sessions.length})**\n` +
                sessions.slice(0, 20).map((s, idx) =>
                    `> \`#${idx + 1}\` <@${s.discordUserId}> ➔ **\`${s.txUsername}\`** • Vinculado ${fmtRel(s.linkedAt)}${s.lastAction ? ` • Última: *${s.lastAction}*` : ''}`
                ).join('\n');
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({ name: `PANEL MAESTRO DEL CREADOR • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle('👑┃CONTROL DE SESIONES Y SEGURIDAD TXADMIN')
        .setDescription(
            `> 📡 **Puente VPS/Local:** ${bridgeStatus.online ? `🟢 \`Conectado\` (${bridgeStatus.latencyMs ?? 0}ms)` : '🔴 `Desconectado`'}\n` +
            `> 🔒 **Modo Solo Lectura:** ${bridgeStatus.readOnlyMode ? '🟡 `ACTIVADO (acciones bloqueadas)`' : '🟢 `Desactivado (acciones permitidas)`'}\n` +
            `> 🔐 **Token del puente:** ${bridgeStatus.secretConfigured ? '✅ `Configurado`' : '❌ `Falta (!tx-setup)`'}\n\n` +
            `────────────────────────────\n\n` +
            `${body}`
        )
        .setFooter({ text: `${serverName} • Acceso Exclusivo Creador`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    const components = [];

    if (sessions.length > 0 && !showingAdmins) {
        const revokeMenu = new StringSelectMenuBuilder()
            .setCustomId('select_tx_owner_revoke')
            .setPlaceholder('🔴 Selecciona un Staff para cerrarle la sesión al instante...')
            .addOptions(
                sessions.slice(0, 25).map(s => ({
                    label: `${s.discordTag || s.discordUserId} (${s.txUsername})`.slice(0, 100),
                    description: `Revocar acceso y borrar sesión cifrada de ${s.txUsername}`,
                    value: String(s.discordUserId),
                    emoji: '🔴'
                }))
            );
        components.push(new ActionRowBuilder().addComponents(revokeMenu));
    }

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(showingAdmins ? 'tx_owner_view_sessions' : 'tx_owner_view_admins')
            .setLabel(showingAdmins ? 'Ver Sesiones Bot' : 'Ver Admins txAdmin')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(showingAdmins ? '🔑' : '📋'),
        new ButtonBuilder()
            .setCustomId('tx_owner_toggle_readonly')
            .setLabel(bridgeStatus.readOnlyMode ? 'Activar Acciones' : 'Modo Solo Lectura')
            .setStyle(bridgeStatus.readOnlyMode ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(bridgeStatus.readOnlyMode ? '🔓' : '🔒'),
        new ButtonBuilder()
            .setCustomId('tx_owner_revoke_all')
            .setLabel('Cerrar TODAS')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('💣')
            .setDisabled(sessions.length === 0),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
    ));

    return { embeds: [embed], components };
}

// ============================================================================
// 11. MODALES PRIVADOS (LOGIN, IA, BÚSQUEDA Y ACCIONES)
// ============================================================================
function buildLoginModal() {
    const modal = new ModalBuilder()
        .setCustomId('modal_tx_login')
        .setTitle('🔑 Iniciar Sesión en txAdmin');

    const userIn = new TextInputBuilder()
        .setCustomId('tx_user')
        .setLabel('Usuario de txAdmin')
        .setPlaceholder('Tu nombre exacto de administrador en txAdmin')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(64);

    const passIn = new TextInputBuilder()
        .setCustomId('tx_pass')
        .setLabel('Contraseña de txAdmin')
        .setPlaceholder('Se cifrará con AES-256 en el puente local/VPS')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(128);

    return modal.addComponents(
        new ActionRowBuilder().addComponents(userIn),
        new ActionRowBuilder().addComponents(passIn)
    );
}

function buildAiQueryModal() {
    const modal = new ModalBuilder()
        .setCustomId('modal_tx_ai_query')
        .setTitle('🧠 Asistente IA de txAdmin');

    const qIn = new TextInputBuilder()
        .setCustomId('tx_ai_prompt')
        .setLabel('¿Qué quieres consultar o pedir en txAdmin?')
        .setPlaceholder('Ej: Busca baneos de esta semana / Antecedentes de Hugoo / Analiza últimos errores')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(800);

    return modal.addComponents(new ActionRowBuilder().addComponents(qIn));
}

function buildSearchPlayerModal() {
    const modal = new ModalBuilder()
        .setCustomId('modal_tx_search_player')
        .setTitle('🔎 Buscar Jugador en txAdmin');

    const qIn = new TextInputBuilder()
        .setCustomId('tx_player_query')
        .setLabel('Nombre, License, Discord ID o Server ID')
        .setPlaceholder('Ej: Hugoo / license:abc123 / discord:418558... / 14')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(120);

    return modal.addComponents(new ActionRowBuilder().addComponents(qIn));
}

function buildActionModal(actionKey) {
    const modal = new ModalBuilder()
        .setCustomId(`modal_tx_act_${actionKey}`)
        .setTitle((ACTION_LABELS[actionKey] || 'Acción txAdmin').slice(0, 45));

    if (actionKey === 'tx_ban') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target').setLabel('ID conectado o Identificador (license/dc)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('duration').setLabel('Duración (permanent, 2h, 1d, 7d, 30d)').setValue('permanent').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo del baneo').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400)
            )
        );
    } else if (actionKey === 'tx_revoke_action') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('actionId').setLabel('Action ID exacto de txAdmin (ej: A1B2-C3D4)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo de la revocación (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)
            )
        );
    } else if (actionKey === 'tx_warn' || actionKey === 'tx_kick') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target').setLabel('ID conectado del jugador (Server ID)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400)
            )
        );
    } else if (actionKey === 'tx_resource_action') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('operation').setLabel('Operación: restart, ensure, stop o refresh').setValue('restart').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('resourceName').setLabel('Nombre del recurso (vacío si es refresh)').setStyle(TextInputStyle.Short).setRequired(false)
            )
        );
    } else if (actionKey === 'tx_announcement') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('message').setLabel('Texto del anuncio global').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
            )
        );
    } else if (actionKey === 'tx_server_control') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('operation').setLabel('Operación: restart, stop o start').setValue('restart').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo del reinicio/parada').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
            )
        );
    }

    return modal;
}

module.exports = {
    ACTION_LABELS,
    buildNoticeEmbed,
    buildMainPanelPayload,
    buildOwnerPermanentPanelPayload,
    buildEphemeralHubPayload,
    buildOnlinePlayersPayload,
    buildSanctionsPayload,
    buildPlayerProfilePayload,
    buildStaffActivityPayload,
    buildServerAndResourcesPayload,
    buildActionsMenuPayload,
    buildConfirmationPayload,
    buildOwnerMasterPayload,
    buildLoginModal,
    buildAiQueryModal,
    buildSearchPlayerModal,
    buildActionModal
};
