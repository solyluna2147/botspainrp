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

const ACTION_PERMISSIONS = {
    tx_ban: ['players.ban'],
    tx_revoke_action: ['players.ban', 'players.warn'],
    tx_warn: ['players.warn'],
    tx_dm: ['players.direct_message', 'players.message'],
    tx_kick: ['players.kick'],
    tx_kick_all: ['control.server'],
    tx_resource_action: ['commands.resources', 'console.write'],
    tx_announcement: ['announcement', 'players.message', 'console.write'],
    tx_server_control: ['control.server']
};

function hasTxPermission(userSession, requiredPerms = []) {
    if (!userSession) return false;
    if (userSession.master) return true;
    const perms = Array.isArray(userSession.permissions) ? userSession.permissions : [];
    if (perms.includes('all_permissions')) return true;
    if (!requiredPerms || requiredPerms.length === 0) return true;
    return requiredPerms.some(p => perms.includes(p));
}

function canExecuteTxAction(userSession, actionKey, isOwner = false) {
    if ((actionKey === 'tx_server_control' || actionKey === 'tx_kick_all') && !isOwner) return false;
    if (!userSession) return false;
    const req = ACTION_PERMISSIONS[actionKey];
    return hasTxPermission(userSession, req);
}

const ACTION_LABELS = {
    tx_warn: '⚠️ Poner Warn',
    tx_dm: '💬 Mensaje Privado (DM)',
    tx_kick: '👢 Expulsar (Kick)',
    tx_ban: '🔨 Banear Jugador',
    tx_revoke_action: '🔓 Quitar Ban / Warn',
    tx_announcement: '📢 Anuncio en Pantalla',
    tx_resource_action: '🧩 Reiniciar / Parar Script',
    tx_server_control: '🔄 Reiniciar / Apagar / Encender Servidor',
    tx_kick_all: '💥 Expulsar a Todos (Kick All)'
};

const ACTION_REPEAT_LABELS = {
    tx_warn: 'Poner otro Warn',
    tx_dm: 'Enviar otro DM',
    tx_kick: 'Expulsar a otro',
    tx_ban: 'Banear a otro',
    tx_revoke_action: 'Quitar otro Ban/Warn',
    tx_announcement: 'Enviar otro Anuncio',
    tx_resource_action: 'Gestionar otro Script',
    tx_server_control: 'Otro Control Servidor',
    tx_kick_all: 'Otro Kick All'
};

const PARAM_LABELS = {
    target: '👤 Jugador / ID',
    duration: '⏳ Duración',
    reason: '📝 Motivo',
    actionId: '🆔 ID de Sanción',
    actionType: '⚖️ Tipo',
    targetName: '👤 Jugador',
    operation: '⚙️ Operación',
    resourceName: '🧩 Script',
    message: '📢 Mensaje'
};

const AUTOCLEAN_FOOTER_HINT = '⏳ Autoeliminación: 2 min';

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
            text: footerText || `${serverName} • ${AUTOCLEAN_FOOTER_HINT}`,
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
        ? '🟢 `En línea y sincronizado`'
        : (bridgeStatus.secretConfigured
            ? '🔴 `Sin conexión con el servidor`'
            : '🟡 `Pendiente de activación`');

    const modeTxt = bridgeStatus.readOnlyMode
        ? '🔒 `Solo Lectura` *(acciones pausadas temporalmente)*'
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
            `📡┃**Estado del Sistema**\n` +
            `> • **Enlace con txAdmin:** ${onlineTxt}\n` +
            `> • **Modo de Operación:** ${modeTxt}\n` +
            `> • **Sesiones Staff vinculadas:** \`${linkedCount}\` activas\n\n` +
            `────────────────────────────\n\n` +
            `📋┃**¿Cómo funciona este panel?**\n` +
            `> 1️⃣ **Inicia sesión una sola vez** con tu cuenta de txAdmin desde el menú de abajo *(queda permanente hasta que administración la cierre)*.\n` +
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
        .setPlaceholder('🛡️ Elige qué quieres ver o hacer en txAdmin...')
        .addOptions([
            {
                label: 'Iniciar / Cambiar Sesión',
                description: 'Vincula tu cuenta de txAdmin (solo 1 vez, queda guardada)',
                value: 'login',
                emoji: '🔑'
            },
            {
                label: 'Consulta con AI',
                description: 'Pregunta en lenguaje normal o pide acciones rápidas',
                value: 'ai',
                emoji: '🤖'
            },
            {
                label: 'Conectados y Staffs',
                description: 'Ver quién está online ahora y qué Staffs hay dentro',
                value: 'players',
                emoji: '👥'
            },
            {
                label: 'Buscar Jugador',
                description: 'Ver ficha, Discord, horas jugadas y sanciones de alguien',
                value: 'search_player',
                emoji: '🔎'
            },
            {
                label: 'Bans y Warns',
                description: 'Historial completo de sanciones con filtros y páginas',
                value: 'sanctions',
                emoji: '⚖️'
            },
            {
                label: 'Actividad del Staff',
                description: 'Ranking de moderación y últimas acciones de los Staffs',
                value: 'staff_activity',
                emoji: '🛡️'
            },
            {
                label: 'Estado, Scripts y Errores',
                description: 'Salud del servidor, scripts activos y errores recientes',
                value: 'server_status',
                emoji: '🖥️'
            },
            {
                label: 'Moderar / Acciones',
                description: 'Poner Warn, Kick, Ban, Desban, Anuncio o Reiniciar Script',
                value: 'actions',
                emoji: '⚡'
            }
        ]);

    const quickRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_login')
            .setLabel('Mi Sesión')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔑'),
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_ai')
            .setLabel('Consulta con AI')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤖'),
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_players')
            .setLabel('Conectados')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_actions')
            .setLabel('Moderar')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚡'),
        new ButtonBuilder()
            .setCustomId('btn_tx_refresh_main')
            .setLabel('Actualizar')
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
        ? '🟢 `En línea y sincronizado`'
        : (bridgeStatus.secretConfigured
            ? '🔴 `Sin conexión con el servidor`'
            : '🟡 `Pendiente de activación`');

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
            `📡┃**Estado del Enlace y Seguridad**\n` +
            `> • **Enlace con txAdmin:** ${onlineTxt}\n` +
            `> • **Modo de Operación:** ${bridgeStatus.readOnlyMode ? '🔒 `SOLO LECTURA (acciones bloqueadas)`' : '🟢 `Lectura + Acciones Activas`'}\n` +
            `> • **Vinculación:** ${bridgeStatus.secretConfigured ? '✅ `Configurada`' : '❌ `Pendiente`'}\n\n` +
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
        .setPlaceholder('👑 Menú Completo de Creador — elige cualquier herramienta...')
        .addOptions([
            {
                label: 'Iniciar / Cambiar Mi Sesión',
                description: 'Vincula tu cuenta personal de txAdmin (solo 1 vez)',
                value: 'login',
                emoji: '🔑'
            },
            {
                label: 'Consulta con AI (Total)',
                description: 'Consulta datos en vivo o solicita cualquier acción con IA',
                value: 'ai',
                emoji: '🤖'
            },
            {
                label: 'Conectados y Staffs',
                description: 'Ver jugadores online ahora y qué Staffs hay dentro',
                value: 'players',
                emoji: '👥'
            },
            {
                label: 'Buscar Jugador',
                description: 'Ficha, Discord, horas jugadas y sanciones de alguien',
                value: 'search_player',
                emoji: '🔎'
            },
            {
                label: 'Bans y Warns',
                description: 'Historial completo de sanciones con filtros y páginas',
                value: 'sanctions',
                emoji: '⚖️'
            },
            {
                label: 'Actividad del Staff',
                description: 'Ranking de moderación y registro de acciones',
                value: 'staff_activity',
                emoji: '🛡️'
            },
            {
                label: 'Estado, Scripts y Errores',
                description: 'Salud del servidor, scripts activos y consola',
                value: 'server_status',
                emoji: '🖥️'
            },
            {
                label: 'Moderar Jugadores y Scripts',
                description: 'Warn, DM, Kick, Ban, Desban, Anuncio y Scripts',
                value: 'actions',
                emoji: '⚡'
            },
            {
                label: 'Reiniciar Servidor FiveM',
                description: 'Reinicia el servidor al instante (con confirmación)',
                value: 'srv_restart',
                emoji: '🔄'
            },
            {
                label: 'Encender Servidor FiveM',
                description: 'Arranca el servidor si está detenido (con confirmación)',
                value: 'srv_start',
                emoji: '🟢'
            },
            {
                label: 'Apagar Servidor FiveM',
                description: 'Detiene el servidor FiveM (con confirmación)',
                value: 'srv_stop',
                emoji: '🛑'
            },
            {
                label: 'Expulsar a Todos (Kick All)',
                description: 'Saca a todos los jugadores conectados antes de mantenimiento',
                value: 'kick_all',
                emoji: '💥'
            },
            {
                label: 'Sesiones de Staff',
                description: 'Ver qué Staffs tienen sesión activa y cerrarla al instante',
                value: 'manage_sessions',
                emoji: '🔐'
            },
            {
                label: 'Lista de Admins txAdmin',
                description: 'Ver cuentas configuradas en txAdmin, Discord y permisos',
                value: 'view_admins',
                emoji: '📋'
            },
            {
                label: 'Pausar / Activar Acciones',
                description: 'Activa o desactiva el Modo Solo Lectura al instante',
                value: 'toggle_readonly',
                emoji: '🔒'
            },
            {
                label: 'Claves de Enlace (DM)',
                description: 'Recibe la configuración privada de conexión por DM',
                value: 'send_env_dm',
                emoji: '📩'
            }
        ]);

    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_ai')
            .setLabel('Consulta con AI')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤖'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_actions')
            .setLabel('Moderar')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚡'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_players')
            .setLabel('Conectados')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_sessions')
            .setLabel('Sesiones')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔐'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_refresh_panel')
            .setLabel('Actualizar')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );

    const serverControlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_srv_restart')
            .setLabel('Reiniciar Server')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_srv_start')
            .setLabel('Encender Server')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🟢'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_srv_stop')
            .setLabel('Apagar Server')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🛑'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_open_admins')
            .setLabel('Admins txAdmin')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId('btn_tx_owner_toggle_readonly')
            .setLabel(bridgeStatus.readOnlyMode ? 'Activar Acciones' : 'Solo Lectura')
            .setStyle(bridgeStatus.readOnlyMode ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(bridgeStatus.readOnlyMode ? '🔓' : '🔒')
    );

    const payload = {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(ownerMenu),
            btnRow,
            serverControlRow
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
            `> 📡 **Conexión:** ${bridgeStatus.online ? '🟢 `En línea`' : '🔴 `Desconectado`'}\n` +
            `> 🔑 **Tu sesión:** ${sessionLine}\n\n` +
            `Elige en el desplegable inferior a qué módulo quieres cambiar. Todo se actualiza **en este mismo mensaje**.`
        )
        .setFooter({
            text: `${serverName} • Solo tú puedes ver esta consola`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const options = [
        { label: 'Consulta con AI', description: 'Consulta en lenguaje normal o pide acciones', value: 'ai', emoji: '🤖' },
        { label: 'Conectados y Staffs', description: 'Ver quién está online y qué Staffs hay dentro', value: 'players', emoji: '👥' },
        { label: 'Buscar Jugador', description: 'Ficha, Discord, horas jugadas y sanciones', value: 'search_player', emoji: '🔎' },
        { label: 'Bans y Warns', description: 'Historial completo con filtros y páginas', value: 'sanctions', emoji: '⚖️' },
        { label: 'Actividad del Staff', description: 'Ranking y últimas acciones de los Staffs', value: 'staff_activity', emoji: '🛡️' },
        { label: 'Estado, Scripts y Errores', description: 'Salud del servidor, scripts y consola', value: 'server_status', emoji: '🖥️' },
        { label: 'Moderar / Acciones', description: 'Warn, Kick, Ban, Desban, Anuncio y Scripts', value: 'actions', emoji: '⚡' },
        { label: 'Iniciar / Cambiar Sesión', description: 'Vincular o refrescar tu cuenta de txAdmin', value: 'login', emoji: '🔑' }
    ];
    if (isOwner) {
        options.push(
            {
                label: 'Reiniciar Servidor FiveM',
                description: 'Reinicia el servidor FiveM al instante',
                value: 'srv_restart',
                emoji: '🔄'
            },
            {
                label: 'Encender Servidor FiveM',
                description: 'Arranca el servidor FiveM si está parado',
                value: 'srv_start',
                emoji: '🟢'
            },
            {
                label: 'Apagar Servidor FiveM',
                description: 'Detiene el servidor FiveM',
                value: 'srv_stop',
                emoji: '🛑'
            },
            {
                label: 'Panel de Creador',
                description: 'Sesiones Staff, Admins txAdmin y Solo Lectura',
                value: 'owner_panel',
                emoji: '👑'
            }
        );
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_ephemeral_nav')
        .setPlaceholder('🧭 Cambiar de sección...')
        .addOptions(options);

    const quickRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_tx_quick_ai').setLabel('Consulta con AI').setStyle(ButtonStyle.Primary).setEmoji('🤖'),
        new ButtonBuilder().setCustomId('tx_nav_actions').setLabel('Moderar').setStyle(ButtonStyle.Secondary).setEmoji('⚡'),
        new ButtonBuilder().setCustomId('tx_pg_players_0_all_ref').setLabel('Conectados').setStyle(ButtonStyle.Secondary).setEmoji('👥')
    );

    embed.setFooter({
        text: `${serverName} • ${AUTOCLEAN_FOOTER_HINT}`,
        ...(iconUrl ? { iconURL: iconUrl } : {})
    });

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu), quickRow]
    };
}

// ============================================================================
// 3. VISTA PAGINADA: CONECTADOS Y STAFFS EN VIVO (SIN PING/STEAM/LICENSE)
// ============================================================================
function buildOnlinePlayersPayload(guild, data, page = 0, filterMode = 'all') {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);
    const allPlayers = Array.isArray(data?.players) ? data.players : [];
    const staffList = allPlayers.filter(p => p.isTxAdmin);
    const totalCount = data?.totalOnline ?? allPlayers.length;
    const staffCount = data?.staffOnlineCount ?? staffList.length;
    const showingStaffOnly = filterMode === 'staff';
    const visiblePlayers = showingStaffOnly ? staffList : allPlayers;

    const perPage = 8;
    const totalPages = Math.max(1, Math.ceil(visiblePlayers.length / perPage));
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const slice = visiblePlayers.slice(safePage * perPage, safePage * perPage + perPage);

    let body = '';
    if (slice.length === 0) {
        body = showingStaffOnly
            ? '> 🛡️ *No hay ningún Staff/Admin de txAdmin conectado en el servidor ahora mismo.*'
            : '> 📭 *No hay jugadores conectados en este momento (o el servidor está apagado).*';
    } else {
        body = slice.map(p => {
            const dId = p.discordId || ((p.identifiers || []).find(i => /^discord:\d+/i.test(i)) || '').replace(/^discord:/i, '');
            const discTag = dId ? `<@${dId}>` : '`Sin Discord`';
            const staffBadge = p.isTxAdmin
                ? ` • 🛡️ **Staff txAdmin**${p.txAdminName ? ` (\`${p.txAdminName}\`)` : ''}`
                : '';
            const icon = p.isTxAdmin ? '🛡️' : '👤';
            const charLine = p.character?.fullName
                ? `\n> ╰ 🎭 **PJ:** ${p.character.fullName} *(${p.character.job || 'Civil'})*`
                : '';
            return (
                `${icon} **\`ID ${p.id}\` • ${p.name}**${staffBadge}\n` +
                `> ╰ 💬 **Discord:** ${discTag}${charLine}`
            );
        }).join('\n\n');
    }

    const embed = new EmbedBuilder()
        .setColor(showingStaffOnly ? 0x9B59B6 : v.color)
        .setAuthor({
            name: `${showingStaffOnly ? 'STAFFS CONECTADOS' : 'CONECTADOS EN VIVO'} • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(showingStaffOnly
            ? `🛡️┃Staffs con txAdmin Conectados (${staffCount})`
            : `👥┃Jugadores Conectados (${totalCount}/${data?.maxClients || '?'})`)
        .setDescription(
            `> 📡 **Servidor:** ${data?.online ? '🟢 `Online`' : '🔴 `Offline`'} • 👥 **Jugadores:** \`${totalCount}/${data?.maxClients || '?'}\` • 🛡️ **Staffs dentro:** \`${staffCount}\` • ⏱️ **Activo:** \`${data?.uptime || 'N/D'}\`\n\n` +
            `────────────────────────────\n\n` +
            `${body}`
        )
        .setFooter({
            text: `${serverName} • Pág. ${safePage + 1}/${totalPages} • ${AUTOCLEAN_FOOTER_HINT}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const nextMode = showingStaffOnly ? 'all' : 'staff';
    const curMode = showingStaffOnly ? 'staff' : 'all';

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${Math.max(0, safePage - 1)}_${curMode}_prev`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${Math.min(totalPages - 1, safePage + 1)}_${curMode}_next`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_0_${nextMode}_tog`)
            .setLabel(showingStaffOnly ? `Ver Todos (${totalCount})` : `Solo Staffs (${staffCount})`)
            .setStyle(showingStaffOnly ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setEmoji(showingStaffOnly ? '👥' : '🛡️'),
        new ButtonBuilder()
            .setCustomId(`tx_pg_players_${safePage}_${curMode}_ref`)
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
            .setCustomId(`tx_pg_sanctions_${Math.max(0, safePage - 1)}_${filterKey}_prev`)
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
            .setCustomId(`tx_pg_sanctions_${Math.min(totalPages - 1, safePage + 1)}_${filterKey}_next`)
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
                description: `No se encontró ningún registro en txAdmin para **\`${query}\`**.\n\n> 💡 *Prueba con su nombre exacto, su \`license:\`, su \`discord:\` o su ID conectado.*`,
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

    const allIds = [...(p.ids || []), ...(data.onlinePlayer?.identifiers || [])];
    const discRaw = allIds.find(id => /^discord:\d+/i.test(String(id)));
    const discordTag = discRaw ? `<@${String(discRaw).replace(/^discord:/i, '')}>` : '`Sin Discord vinculado`';
    const staffLine = data.onlinePlayer?.isTxAdmin
        ? `> 🛡️ **Rango txAdmin:** \`${data.onlinePlayer.txAdminName || 'Staff txAdmin'}\`\n`
        : '';
    const notesText = p.notes?.text ? `> 📝 **Nota Staff (${p.notes.author || 'Staff'}):** *${p.notes.text.slice(0, 200)}*\n` : '';
    const charSection = chars.length > 0
        ? `🎭┃**Personajes IC (${chars.length})**\n` +
          chars.slice(0, 3).map(c => `> • **${c.fullName}** — 💼 \`${c.job || 'Civil'}\` • 💳 \`$${c.bank ?? '?'}\``).join('\n') + '\n\n'
        : '';

    let historyBody = '> ✅ *Sin antecedentes de baneos ni advertencias registrados.*';
    if (slice.length > 0) {
        historyBody = slice.map(a => {
            const ic = a.type === 'ban' ? '🔨' : '⚠️';
            const st = a.status === 'active' ? '🔴 `ACTIVO`' : (a.status === 'revoked' ? '🟣 `REVOCADO`' : '⚪ `EXPIRADO`');
            return `${ic} **\`${a.id}\`** ${st} • ${fmtTs(a.timestamp)}\n> 🛡️ **Admin:** \`${a.author}\` • 📝 **Motivo:** ${(a.reason || 'N/D').slice(0, 120)}`;
        }).join('\n');
    }

    const statusBadge = data.onlinePlayer
        ? `🟢 Conectado (ID ${data.onlinePlayer.id})`
        : '⚪ Desconectado';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `FICHA DE JUGADOR • ${serverName}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTitle(`👤┃${p.displayName || 'Jugador'} • ${statusBadge}`)
        .setDescription(
            `> 💬 **Discord:** ${discordTag}\n` +
            `${staffLine}` +
            `> 📅 **1.ª Entrada:** ${fmtTs(p.tsJoined)} • 🕒 **Última vez:** ${fmtRel(p.tsLastConnection)}\n` +
            `> ⏱️ **Tiempo jugado:** \`${fmtPlaytime(p.playTime)}\`\n` +
            `${notesText}\n` +
            `${charSection}` +
            `────────────────────────────\n\n` +
            `⚖️┃**Antecedentes (${actions.length} registros)**\n${historyBody}`
        )
        .setFooter({
            text: `${serverName} • Pág. ${safePage + 1}/${totalPages} • ${AUTOCLEAN_FOOTER_HINT}`,
            ...(iconUrl ? { iconURL: iconUrl } : {})
        })
        .setTimestamp();

    const safeQ = encodeURIComponent(query.slice(0, 40));
    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_pg_player_prev_${Math.max(0, safePage - 1)}_${safeQ}`)
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
            .setCustomId(`tx_pg_player_next_${Math.min(totalPages - 1, safePage + 1)}_${safeQ}`)
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
            : '> 📭 *No hay registros administrativos recientes.*';

        const embed = new EmbedBuilder()
            .setColor(v.color)
            .setAuthor({ name: `REGISTRO ADMINISTRATIVO • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle('📜┃Últimas Acciones Administrativas')
            .setDescription(body)
            .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Registros`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.max(0, safePage - 1)}_adminlog_prev`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                    new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.min(totalPages - 1, safePage + 1)}_adminlog_next`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                    new ButtonBuilder().setCustomId('tx_pg_staff_0_ranking_tab').setLabel('Ver Ranking').setStyle(ButtonStyle.Primary).setEmoji('🏆'),
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
                new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.max(0, safePage - 1)}_ranking_prev`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`tx_pg_staff_${Math.min(totalPages - 1, safePage + 1)}_ranking_next`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                new ButtonBuilder().setCustomId('tx_pg_staff_0_adminlog_tab').setLabel('Ver Registros').setStyle(ButtonStyle.Primary).setEmoji('📜'),
                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
            )
        ]
    };
}

// ============================================================================
// 7. VISTA PAGINADA: ESTADO DEL SERVIDOR, RECURSOS Y ERRORES DE CONSOLA
// ============================================================================
function buildServerAndResourcesPayload(guild, data, page = 0, tab = 'overview', isOwner = false) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);

    const tabMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_server_tab')
        .setPlaceholder('🖥️ Cambiar vista técnica...')
        .addOptions([
            { label: 'Resumen General y Rendimiento', value: 'overview', emoji: '📊', default: tab === 'overview' },
            { label: 'Todos los Scripts FiveM', value: 'res_all', emoji: '🧩', default: tab === 'res_all' },
            { label: 'Solo Scripts Detenidos / Error', value: 'res_stopped', emoji: '🔴', default: tab === 'res_stopped' },
            { label: 'Últimos Errores de Consola', value: 'console_errors', emoji: '🚨', default: tab === 'console_errors' }
        ]);

    if (tab === 'overview') {
        const ov = data?.overview || {};
        const embed = new EmbedBuilder()
            .setColor(v.color)
            .setAuthor({ name: `MONITOR TÉCNICO • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle('🖥️┃Estado y Rendimiento del Servidor')
            .setDescription(
                `> 🟢 **Servidor FiveM:** ${ov.online ? '`ONLINE`' : '🔴 `OFFLINE`'} • 👥 **Jugadores:** \`${ov.playersCount ?? 0}/${ov.maxClients ?? '?'}\`\n` +
                `> ⏱️ **Tiempo activo:** \`${ov.uptime || 'N/D'}\` • 🧩 **Scripts:** \`${ov.startedResources ?? '?'}\` activos / \`${ov.stoppedResources ?? '?'}\` detenidos\n` +
                `> 💻 **Rendimiento:** \`${ov.hostCpu || 'N/D'}\` • \`${ov.hostRam || 'N/D'}\`\n` +
                `> 🚨 **Alertas recientes en consola:** \`${ov.recentErrorsCount ?? 0}\` errores • \`${ov.recentHitchesCount ?? 0}\` hitches\n\n` +
                `────────────────────────────\n` +
                `💡 *Usa el desplegable inferior para ver scripts o errores de consola.*`
            )
            .setFooter({ text: `${serverName} • Monitor en Vivo • ${AUTOCLEAN_FOOTER_HINT}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        const overviewBtns = [
            new ButtonBuilder().setCustomId('tx_pg_srv_0_overview_ref').setLabel('Actualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄')
        ];
        if (isOwner) {
            overviewBtns.push(
                new ButtonBuilder().setCustomId('tx_srv_ctl_restart').setLabel('Reiniciar').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
                new ButtonBuilder().setCustomId('tx_srv_ctl_start').setLabel('Encender').setStyle(ButtonStyle.Success).setEmoji('🟢'),
                new ButtonBuilder().setCustomId('tx_srv_ctl_stop').setLabel('Apagar').setStyle(ButtonStyle.Danger).setEmoji('🛑')
            );
        }
        overviewBtns.push(
            new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
        );

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(...overviewBtns),
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
            : '> ✅ *No se han detectado errores recientes en la consola del servidor.*';

        const embed = new EmbedBuilder()
            .setColor(errs.length > 0 ? 0xE74C3C : 0x2ECC71)
            .setAuthor({ name: `CONSOLA DEL SERVIDOR • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTitle(`🚨┃Errores Recientes de Consola (${errs.length})`)
            .setDescription(body)
            .setFooter({ text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Consola`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
            .setTimestamp();

        return {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.max(0, safePage - 1)}_console_errors_prev`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                    new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.min(totalPages - 1, safePage + 1)}_console_errors_next`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
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
        body = '> ⚠️ *El módulo de lectura de recursos del servidor FiveM no está conectado en este momento.*';
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
                new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.max(0, safePage - 1)}_${tab}_prev`).setLabel('Anterior').setStyle(ButtonStyle.Secondary).setEmoji('⬅️').setDisabled(safePage <= 0),
                new ButtonBuilder().setCustomId('tx_pg_info_disabled').setLabel(`Pág. ${safePage + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`tx_pg_srv_${Math.min(totalPages - 1, safePage + 1)}_${tab}_next`).setLabel('Siguiente').setStyle(ButtonStyle.Secondary).setEmoji('➡️').setDisabled(safePage >= totalPages - 1),
                new ButtonBuilder().setCustomId(`tx_pg_srv_${safePage}_${tab}_ref`).setLabel('Actualizar').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Danger).setEmoji('↩️')
            ),
            new ActionRowBuilder().addComponents(tabMenu)
        ]
    };
}

// ============================================================================
// 8. SUBMENÚ INTERACTIVO DE ACCIONES ADMINISTRATIVAS (FILTRADO POR PERMISOS REALES DE TXADMIN)
// ============================================================================
function buildActionsMenuPayload(guild, userSession, readOnlyMode, isOwner = false) {
    const { v, iconUrl, serverName } = resolveIcon(guild, guild?.id);

    const allActionOptions = [
        { label: 'Poner Warn', description: 'Envía aviso rojo en pantalla al jugador y lo guarda', value: 'tx_warn', emoji: '⚠️' },
        { label: 'Mensaje Privado (DM)', description: 'Envía un aviso privado en pantalla a un jugador online', value: 'tx_dm', emoji: '💬' },
        { label: 'Expulsar (Kick)', description: 'Saca del servidor en vivo al jugador con un motivo', value: 'tx_kick', emoji: '👢' },
        { label: 'Banear Jugador', description: 'Baneo temporal (2h, 1d, 7d...) o permanente', value: 'tx_ban', emoji: '🔨' },
        { label: 'Quitar Ban / Warn', description: 'Desbanea o retira un Warn por Action ID, ID o Discord', value: 'tx_revoke_action', emoji: '🔓' },
        { label: 'Anuncio en Pantalla', description: 'Publica un aviso global visible para todo el servidor', value: 'tx_announcement', emoji: '📢' },
        { label: 'Reiniciar / Parar Script', description: 'restart, ensure, stop o refresh de un script', value: 'tx_resource_action', emoji: '🧩' },
        { label: 'Reiniciar / Apagar / Encender Servidor', description: 'Control directo del servidor FiveM (Solo Creador)', value: 'tx_server_control', emoji: '🔄' },
        { label: 'Expulsar a Todos (Kick All)', description: 'Saca a todos los jugadores conectados (Solo Creador)', value: 'tx_kick_all', emoji: '💥' }
    ];

    // Mostrar ÚNICAMENTE las acciones permitidas por los permisos reales de la cuenta de txAdmin del usuario
    const allowedOptions = userSession
        ? allActionOptions.filter(opt => canExecuteTxAction(userSession, opt.value, isOwner))
        : [];

    const permsDisplay = !userSession
        ? '`Sin sesión iniciada`'
        : (userSession.master || (userSession.permissions || []).includes('all_permissions')
            ? '`Acceso completo (txAdmin)`'
            : `\`${(userSession.permissions || []).join(', ') || 'Solo consulta'}\``);

    const noPermsNotice = userSession && allowedOptions.length === 0
        ? '\n\n> ⚠️ *Tu cuenta de txAdmin actual no tiene permisos habilitados para ejecutar acciones desde este menú.*'
        : '';

    const embed = new EmbedBuilder()
        .setColor(readOnlyMode ? 0xF39C12 : v.color)
        .setAuthor({ name: `MODERACIÓN Y ACCIONES • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle('⚡┃Moderar y Ejecutar Acciones en txAdmin')
        .setDescription(
            `> 🔑 **Tu cuenta txAdmin:** ${userSession ? `🟢 \`${userSession.txUsername}\`` : '🔴 `No vinculada (inicia sesión primero)`'}\n` +
            `> 🪪 **Permisos activos:** ${permsDisplay}\n` +
            `> 🛡️ **Estado del panel:** ${readOnlyMode ? '🔒 `MODO SOLO LECTURA (Pausado por Creador)`' : '🟢 `Acciones listas`'}\n\n` +
            `────────────────────────────\n\n` +
            `🎯 Solo ves las acciones que **tu cuenta tiene autorizadas en txAdmin**. Tras rellenar el formulario te pedirá **confirmación por botón** antes de aplicarla.${noPermsNotice}`
        )
        .setFooter({ text: `${serverName} • ${AUTOCLEAN_FOOTER_HINT}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    const menuOptions = allowedOptions.length > 0
        ? allowedOptions
        : [{ label: 'Sin acciones disponibles', description: userSession ? 'Tu cuenta de txAdmin no tiene permisos de acción' : 'Inicia sesión en txAdmin primero', value: 'none', emoji: '🔒' }];

    const actionsMenu = new StringSelectMenuBuilder()
        .setCustomId('select_tx_action_pick')
        .setPlaceholder('⚡ Elige una acción para ejecutar ahora...')
        .setDisabled(Boolean(readOnlyMode) || !userSession || allowedOptions.length === 0)
        .addOptions(menuOptions);

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
        .map(([k, val]) => `> • **${PARAM_LABELS[k] || k}:** \`${String(val).slice(0, 220)}\``)
        .join('\n') || '> *(Sin parámetros adicionales)*';

    const aiHeader = aiAnswer
        ? `🤖┃**Análisis previo de la IA**\n${aiAnswer.slice(0, 2200)}\n\n────────────────────────────\n\n`
        : '';

    const embed = new EmbedBuilder()
        .setColor(0xF39C12)
        .setAuthor({ name: `CONFIRMACIÓN REQUERIDA • ${serverName}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTitle(`⚠️┃Confirmar: ${label}`)
        .setDescription(
            `${aiHeader}` +
            `📌┃**Datos que se aplicarán en txAdmin**\n` +
            `${paramLines}\n\n` +
            `> 🔑 **Ejecutar como:** \`${txUsername || 'Sin sesión'}\`\n` +
            `> ⏳ **Validez:** *Caduca en 60 segundos y solo puedes pulsarla tú.*`
        )
        .setFooter({ text: `${serverName} • Protección Humana • ${AUTOCLEAN_FOOTER_HINT}`, ...(iconUrl ? { iconURL: iconUrl } : {}) })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tx_confirm_yes_${confirmId}`)
            .setLabel('Confirmar y Ejecutar')
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
// 9B. PANTALLA DE RESULTADO CON BOTÓN DIRECTO PARA REPETIR LA MISMA ACCIÓN
// ============================================================================
function buildActionResultPayload(guild, { ok, bridgeAction, txUsername, message, canRepeat = true }) {
    const label = ACTION_LABELS[bridgeAction] || bridgeAction;
    const repeatLabel = ACTION_REPEAT_LABELS[bridgeAction] || 'Repetir Acción';

    const embed = buildNoticeEmbed(guild, {
        title: ok ? '✅┃Acción Aplicada en txAdmin' : '❌┃No se Pudo Aplicar la Acción',
        description: ok
            ? `> ⚡ **Acción:** ${label}\n` +
              `> 🔑 **Ejecutada como:** \`${txUsername || 'txAdmin'}\`\n` +
              `> 📋 **Resultado:** ${message || 'Completado correctamente.'}\n\n` +
              `💡 *Pulsa **${repeatLabel}** abajo para hacerlo de nuevo al instante sin volver al menú.*`
            : `> ⚡ **Acción:** ${label}\n` +
              `> 🚨 **Motivo:** ${message || 'Error desconocido al ejecutar en txAdmin.'}\n\n` +
              `💡 *Puedes corregir los datos e intentarlo de nuevo al instante con el botón inferior.*`,
        color: ok ? 0x2ECC71 : 0xE74C3C
    });

    const buttons = [];
    if (canRepeat && ACTION_REPEAT_LABELS[bridgeAction]) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`tx_repeat_act_${bridgeAction}`)
                .setLabel(ok ? repeatLabel : 'Reintentar')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🔁')
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId('btn_tx_quick_ai')
            .setLabel('Consulta con AI')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤖'),
        new ButtonBuilder()
            .setCustomId('tx_nav_actions')
            .setLabel('Otras Acciones')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚡'),
        new ButtonBuilder()
            .setCustomId('tx_nav_hub')
            .setLabel('Menú')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('↩️')
    );

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(...buttons)]
    };
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
            body = '> 📭 *No hay conexión activa con el servidor para consultar los administradores de txAdmin.*';
        } else {
            body = `📋┃**Administradores en txAdmin (${txAdmins.length})**\n` +
                txAdmins.slice(0, 20).map(a => {
                    const perms = a.master ? '👑 `MASTER (Todos)`' : `🛡️ \`${(a.permissions || []).slice(0, 5).join(', ') || 'Básicos'}\``;
                    const disc = a.discordId ? ` • 💬 <@${a.discordId}>` : '';
                    return `> • **${a.name}**${disc} — ${perms}`;
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
            `> 📡 **Enlace txAdmin:** ${bridgeStatus.online ? '🟢 `Conectado`' : '🔴 `Desconectado`'}\n` +
            `> 🔒 **Modo Solo Lectura:** ${bridgeStatus.readOnlyMode ? '🟡 `ACTIVADO (acciones bloqueadas)`' : '🟢 `Desactivado (acciones permitidas)`'}\n` +
            `> 🔐 **Vinculación:** ${bridgeStatus.secretConfigured ? '✅ `Configurada`' : '❌ `Pendiente`'}\n\n` +
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
        .setPlaceholder('Introduce tu contraseña personal de txAdmin')
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
        .setTitle('🤖 Asistente IA de txAdmin');

    const qIn = new TextInputBuilder()
        .setCustomId('tx_ai_prompt')
        .setLabel('¿Qué quieres consultar o hacer en txAdmin?')
        .setPlaceholder('Ej: Warns del ID 2 / Quita el warn WJNH-UM8Y / Pon anuncio: reinicio en 5 min')
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
        .setLabel('ID conectado, Discord ID o Nombre')
        .setPlaceholder('Ej: 2 / 418558256840179722 / EL JONNY')
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
                new TextInputBuilder().setCustomId('target').setLabel('ID conectado, Discord ID o Nombre').setPlaceholder('Ej: 2 / 418558256840179722 / EL JONNY').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('duration').setLabel('Duración (permanent, 2h, 1d, 7d, 1mes)').setValue('permanent').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo del baneo').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400)
            )
        );
    } else if (actionKey === 'tx_revoke_action') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('actionId').setLabel('Action ID, ID conectado, Discord o Nombre').setPlaceholder('Ej: WJNH-UM8Y / 2 / 418558256840179722 / EL JONNY').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo (opcional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(300)
            )
        );
    } else if (actionKey === 'tx_dm') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target').setLabel('ID conectado, Discord ID o Nombre').setPlaceholder('Ej: 2 / 418558256840179722 / EL JONNY').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('message').setLabel('Mensaje privado en pantalla').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400)
            )
        );
    } else if (actionKey === 'tx_kick_all') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Motivo para expulsar a todos').setValue('Mantenimiento del servidor').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
            )
        );
    } else if (actionKey === 'tx_warn' || actionKey === 'tx_kick') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target').setLabel('ID conectado, Discord ID o Nombre').setPlaceholder('Ej: 2 / 418558256840179722 / EL JONNY').setStyle(TextInputStyle.Short).setRequired(true)
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
    ACTION_REPEAT_LABELS,
    ACTION_PERMISSIONS,
    hasTxPermission,
    canExecuteTxAction,
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
    buildActionResultPayload,
    buildOwnerMasterPayload,
    buildLoginModal,
    buildAiQueryModal,
    buildSearchPlayerModal,
    buildActionModal
};
