// ==========================================
// MÓDULO INDEPENDIENTE: SISTEMA AVANZADO DE TICKETS MULTI-SERVIDOR
// ==========================================
// Totalmente aislado por servidor (cada servidor tiene sus propias categorías,
// contadores secuenciales por categoría, tickets activos, logs interactivos,
// branding, banner tickets.png y base de datos propia en MongoDB).
//
// Comandos disponibles (Staff / Admin):
//   - !panel-soporte / !crear-panel-tickets / !fijar-tickets  -> Publica el panel de apertura con menú de 9 tipos y banner tickets.png
//   - !setlogs-tickets <#canal o ID>                          -> Configura el canal de logs con visor interactivo (sin .txt)
//   - !setcat-ticket <tipo> <ID_categoría>                    -> Configura una categoría en cualquier servidor
//   - !setrol-directiva <@rol o ID>                           -> Configura el rol de Directiva para tickets privados de directiva
//   - !tickets-config                                         -> Muestra la configuración actual de categorías, contadores y logs

const mongoose = require('mongoose');
const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType
} = require('discord.js');
const guildManager = require('./guildManager');

// ==========================================
// DEFINICIÓN DE LOS 9 TIPOS DE TICKET (ORDEN EXACTO)
// ==========================================
const TICKET_TYPES = [
    {
        key: 'soporte',
        emoji: '🛠️',
        label: 'Soporte y dudas',
        description: 'Dudas, ayuda o problemas dentro del servidor',
        channelPrefix: 'soporte',
        configKey: 'TKT_CAT_SOPORTE_ID',
        vilacityDefaultCat: '1507013311617699940',
        modalTitle: '🛠️ Soporte y dudas',
        fields: [
            { id: 'f1', label: 'Asunto o resumen del problema', placeholder: 'Ej: Problema en el servidor / duda sobre normativa', style: TextInputStyle.Short, required: true, maxLength: 120 },
            { id: 'f2', label: 'Explica detalladamente tu duda o problema', placeholder: 'Describe todo lo que ha ocurrido para poder ayudarte rápido...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'reportar',
        emoji: '🚨',
        label: 'Reportar jugador',
        description: 'Denuncia a un jugador (con pruebas)',
        channelPrefix: 'reporte',
        configKey: 'TKT_CAT_REPORTAR_ID',
        vilacityDefaultCat: '1574952176323788810',
        modalTitle: '🚨 Reportar jugador',
        fields: [
            { id: 'f1', label: 'Jugador(es) reportado(s) (Nombre / Discord)', placeholder: 'Ej: @usuario o nombre del jugador', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Infracción cometida (PG, MG, RDM, VDM...)', placeholder: 'Ej: RDM y F8 Quit en medio de un rol', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f3', label: 'Explicación de los hechos y enlace de pruebas', placeholder: 'Explica qué pasó y pega enlaces de clips/capturas (también puedes subirlas en el ticket)...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'donaciones',
        emoji: '💎',
        label: 'Donaciones',
        description: 'Compras, paquetes VIP y beneficios',
        channelPrefix: 'donacion',
        configKey: 'TKT_CAT_DONACIONES_ID',
        vilacityDefaultCat: '1504135612108898427',
        modalTitle: '💎 Donaciones',
        fields: [
            { id: 'f1', label: '¿Qué paquete, coche, casa o beneficio buscas?', placeholder: 'Ej: Pack VIP Oro / Coche importado / MLO', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Método de pago preferido', placeholder: 'Ej: Bizum / PayPal / Tarjeta', style: TextInputStyle.Short, required: true, maxLength: 80 },
            { id: 'f3', label: 'Detalles o dudas adicionales (opcional)', placeholder: 'Indica cualquier consulta o detalle extra sobre tu donación...', style: TextInputStyle.Paragraph, required: false, maxLength: 800 }
        ]
    },
    {
        key: 'recompensas',
        emoji: '🎁',
        label: 'Recompensas Boost / Twitch',
        description: 'Reclama tu recompensa por boost o por Twitch',
        channelPrefix: 'recompensa',
        configKey: 'TKT_CAT_RECOMPENSAS_ID',
        vilacityDefaultCat: '1507014060514742303',
        modalTitle: '🎁 Recompensas Boost / Twitch',
        fields: [
            { id: 'f1', label: 'Tipo de recompensa (Boost o Twitch)', placeholder: 'Ej: Server Boost x2 / Suscripción Twitch', style: TextInputStyle.Short, required: true, maxLength: 100 },
            { id: 'f2', label: 'Usuario de Twitch (si aplica)', placeholder: 'Ej: twitch.tv/miusuario (o escribe Boost)', style: TextInputStyle.Short, required: false, maxLength: 120 },
            { id: 'f3', label: 'Detalles o comentarios adicionales', placeholder: 'Puedes adjuntar captura dentro del ticket cuando se abra...', style: TextInputStyle.Paragraph, required: false, maxLength: 600 }
        ]
    },
    {
        key: 'ck',
        emoji: '💀',
        label: 'Solicitar CK',
        description: 'Petición de muerte permanente de un personaje',
        channelPrefix: 'ck',
        configKey: 'TKT_CAT_CK_ID',
        vilacityDefaultCat: '1507012637538517013',
        modalTitle: '💀 Solicitar CK',
        fields: [
            { id: 'f1', label: 'Nombre IC del personaje (Voluntario/Forzado)', placeholder: 'Ej: Marcos Vega — CK Voluntario', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Tiempo jugado con este personaje', placeholder: 'Ej: 2 meses', style: TextInputStyle.Short, required: true, maxLength: 80 },
            { id: 'f3', label: 'Motivo narrativo e historia del CK', placeholder: 'Explica detalladamente los motivos IC y el desarrollo del rol...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'organizaciones',
        emoji: '🏴',
        label: 'Organizaciones',
        description: 'Bandas, mafias y cárteles: crear o gestionar',
        channelPrefix: 'organizacion',
        configKey: 'TKT_CAT_ORGANIZACIONES_ID',
        vilacityDefaultCat: '1507014505861742752',
        modalTitle: '🏴 Organizaciones',
        fields: [
            { id: 'f1', label: 'Nombre de la banda / mafia / cártel', placeholder: 'Ej: Los Santos Cartel', style: TextInputStyle.Short, required: true, maxLength: 120 },
            { id: 'f2', label: 'Tipo de gestión (Crear / Modificar / Consulta)', placeholder: 'Ej: Crear nueva banda (6 integrantes)', style: TextInputStyle.Short, required: true, maxLength: 120 },
            { id: 'f3', label: 'Detalles, integrantes o historia breve', placeholder: 'Cuéntanos qué necesitas gestionar para tu organización...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'apelacion',
        emoji: '⚖️',
        label: 'Apelar sanción',
        description: 'Apelación de ban, warn u otra sanción',
        channelPrefix: 'apelacion',
        configKey: 'TKT_CAT_APELACION_ID',
        vilacityDefaultCat: '1507013069677531206',
        modalTitle: '⚖️ Apelar sanción',
        fields: [
            { id: 'f1', label: 'Tipo de sanción y Staff que la aplicó', placeholder: 'Ej: Ban 7 días / Warn 2 — Staff desconocido', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Motivo de la apelación y pruebas (si tienes)', placeholder: 'Explica tu versión de los hechos con respeto y claridad...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'directiva',
        emoji: '👑',
        label: 'Hablar con la directiva',
        description: 'Asuntos que solo puede tratar la directiva',
        channelPrefix: 'directiva',
        configKey: 'TKT_CAT_DIRECTIVA_ID',
        vilacityDefaultCat: '1507013829295476998',
        modalTitle: '👑 Hablar con la directiva',
        fields: [
            { id: 'f1', label: 'Asunto del ticket', placeholder: 'Ej: Queja interna / Propuesta / Colaboración', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Explica tu caso en detalle', placeholder: 'Este ticket solo lo verán tú y la Directiva del servidor...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    },
    {
        key: 'postulacion',
        emoji: '📝',
        label: 'Postulación a staff',
        description: 'Quiero formar parte del equipo de staff',
        channelPrefix: 'postulacion',
        configKey: 'TKT_CAT_POSTULACION_ID',
        vilacityDefaultCat: '1507016299216113877',
        modalTitle: '📝 Postulación a staff',
        fields: [
            { id: 'f1', label: 'Edad OOC y disponibilidad horaria', placeholder: 'Ej: 19 años — Tardes y noches (4-5h/día)', style: TextInputStyle.Short, required: true, maxLength: 150 },
            { id: 'f2', label: 'Experiencia previa como Staff en FiveM', placeholder: 'Ej: Moderador en X servidor durante 6 meses / Sin experiencia', style: TextInputStyle.Short, required: true, maxLength: 200 },
            { id: 'f3', label: '¿Por qué quieres formar parte del equipo de Staff?', placeholder: 'Cuéntanos qué puedes aportar al servidor y a la comunidad...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
        ]
    }
];

const TICKET_TYPE_MAP = new Map(TICKET_TYPES.map(t => [t.key, t]));

// ==========================================
// ESQUEMAS DE MONGODB (AISLADOS POR SERVIDOR)
// ==========================================
const ticketCounterSchema = new mongoose.Schema({
    categoryKey: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});

const activeTicketSchema = new mongoose.Schema({
    channelId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true },
    ticketCode: { type: String, required: true },
    categoryKey: { type: String, required: true },
    categoryLabel: { type: String, required: true },
    number: { type: Number, required: true },
    openerId: { type: String, required: true },
    openerTag: { type: String, default: '' },
    claimedById: { type: String, default: '' },
    claimedByTag: { type: String, default: '' },
    notifiedRoleIds: [{ type: String }],
    welcomeMessageId: { type: String, default: '' },
    formFields: [{
        label: String,
        value: String
    }],
    openedAt: { type: Date, default: Date.now }
});

const ticketLogSchema = new mongoose.Schema({
    logId: { type: String, required: true, unique: true },
    guildId: { type: String, required: true },
    ticketCode: { type: String, required: true },
    categoryKey: { type: String, required: true },
    categoryLabel: { type: String, required: true },
    number: { type: Number, default: 0 },
    openerId: { type: String, required: true },
    openerTag: { type: String, default: '' },
    claimedById: { type: String, default: '' },
    claimedByTag: { type: String, default: '' },
    closedById: { type: String, required: true },
    closedByTag: { type: String, default: '' },
    closeReason: { type: String, default: 'Sin motivo especificado' },
    openedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: Date.now },
    durationText: { type: String, default: '' },
    totalMessages: { type: Number, default: 0 },
    formFields: [{
        label: String,
        value: String
    }],
    participants: [{
        userId: String,
        userTag: String,
        isStaff: Boolean,
        count: Number
    }],
    messages: [{
        authorId: String,
        authorTag: String,
        isStaff: Boolean,
        isBot: Boolean,
        content: String,
        attachments: [String],
        timestamp: Number
    }]
}, { timestamps: true });

// Caché en memoria como respaldo si MongoDB tuviera algún microcorte
const memoryActiveTickets = new Map(); // channelId -> ticketObj
const memoryTicketLogs = new Map();    // logId -> logObj
const memoryCounters = new Map();      // `${guildId}:${categoryKey}` -> number

function getModelsForGuild(guildId) {
    if (mongoose.connection.readyState !== 1) return null;
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return {
            Counter: mongoose.models.AdvTicketCounter || mongoose.model('AdvTicketCounter', ticketCounterSchema),
            Active: mongoose.models.AdvActiveTicket || mongoose.model('AdvActiveTicket', activeTicketSchema),
            Log: mongoose.models.AdvTicketLog || mongoose.model('AdvTicketLog', ticketLogSchema)
        };
    }
    return {
        Counter: guildManager.getGuildModel(guildId, 'AdvTicketCounter', ticketCounterSchema),
        Active: guildManager.getGuildModel(guildId, 'AdvActiveTicket', activeTicketSchema),
        Log: guildManager.getGuildModel(guildId, 'AdvTicketLog', ticketLogSchema)
    };
}

// ==========================================
// RESOLUCIÓN DE CONFIGURACIÓN POR SERVIDOR
// ==========================================
function isVilacityGuild(guild) {
    if (!guild || guildManager.isPrimaryGuild(guild.id)) return false;
    return guild.channels.cache.has('1507013311617699940')
        || guild.channels.cache.has('1504135612108898427')
        || guild.roles.cache.has('1506768698143408319');
}

function getGuildTicketCategories(guild) {
    const out = {};
    if (!guild) return out;
    const cfg = guildManager.getGuildConfig(guild.id);
    const isVila = isVilacityGuild(guild);

    for (const t of TICKET_TYPES) {
        let catId = cfg[t.configKey] || '';
        if (!catId && isVila) {
            catId = t.vilacityDefaultCat;
        }
        out[t.key] = catId;
    }
    return out;
}

const BOT_CREATOR_IDS = new Set(['1308814761269395527', '418558256840179722']);

function isGuildStaff(member) {
    if (!member || member.user?.bot) return false;
    const uid = member.id || member.user?.id;
    if (uid && BOT_CREATOR_IDS.has(uid)) return true;
    if (member.guild && member.guild.ownerId === uid) return true;
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? '1538191116610838691' : '');
    if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
    if (gCfg.ROLE_DIRECTIVA_ID && member.roles?.cache?.has(gCfg.ROLE_DIRECTIVA_ID)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

function buildCategoryInheritedOverwrites(guild, parentCategory, openerId, botUserId, extraMemberOverwrites = []) {
    const overwriteMap = new Map();
    const allowedRoleIds = [];
    const everyoneId = guild.roles.everyone.id;

    // 1. Heredar EXACTAMENTE todos los permisos configurados en la categoría padre
    if (parentCategory && parentCategory.permissionOverwrites && parentCategory.permissionOverwrites.cache) {
        for (const ow of parentCategory.permissionOverwrites.cache.values()) {
            const allowBits = ow.allow.bitfield;
            const denyBits = ow.deny.bitfield;

            if (ow.id === everyoneId) {
                // @everyone siempre con ViewChannel denegado para mantener privacidad del ticket
                overwriteMap.set(everyoneId, {
                    id: everyoneId,
                    type: OverwriteType.Role,
                    allow: allowBits & ~PermissionFlagsBits.ViewChannel,
                    deny: denyBits | PermissionFlagsBits.ViewChannel
                });
            } else {
                overwriteMap.set(ow.id, {
                    id: ow.id,
                    type: ow.type,
                    allow: allowBits,
                    deny: denyBits
                });
                if (ow.type === OverwriteType.Role && ow.allow.has(PermissionFlagsBits.ViewChannel)) {
                    allowedRoleIds.push(ow.id);
                }
            }
        }
    }

    // Asegurar que @everyone siempre tiene ViewChannel denegado aunque la categoría no tuviera overwrite explícito
    if (!overwriteMap.has(everyoneId)) {
        overwriteMap.set(everyoneId, {
            id: everyoneId,
            type: OverwriteType.Role,
            deny: [PermissionFlagsBits.ViewChannel]
        });
    }

    // 2. Preservar usuarios añadidos manualmente al ticket (si los hubiera al sincronizar)
    for (const memOw of extraMemberOverwrites) {
        if (memOw && memOw.id && memOw.id !== botUserId) {
            overwriteMap.set(memOw.id, memOw);
        }
    }

    // 3. Dar acceso al usuario creador del ticket
    if (openerId) {
        overwriteMap.set(openerId, {
            id: openerId,
            type: OverwriteType.Member,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        });
    }

    // 4. Garantizar permisos completos del bot para gestionar el ticket
    if (botUserId) {
        overwriteMap.set(botUserId, {
            id: botUserId,
            type: OverwriteType.Member,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        });
    }

    return {
        permissionOverwrites: [...overwriteMap.values()],
        allowedRoleIds
    };
}

function serializeOverwrites(channel) {
    if (!channel || !channel.permissionOverwrites || !channel.permissionOverwrites.cache) return '';
    return [...channel.permissionOverwrites.cache.values()]
        .map(o => `${o.id}:${o.type}:${o.allow.bitfield.toString()}:${o.deny.bitfield.toString()}`)
        .sort()
        .join('|');
}

function getUserOpenTicketChannels(guild, userId) {
    const found = new Map();
    if (!guild || !userId) return [];

    // 1. Revisar tickets activos en memoria
    for (const [chId, act] of memoryActiveTickets.entries()) {
        if (act.guildId === guild.id && act.openerId === userId) {
            const ch = guild.channels.cache.get(chId);
            if (ch) found.set(ch.id, ch);
            else memoryActiveTickets.delete(chId);
        }
    }

    // 2. Respaldo instantáneo (0ms) por caché de Discord tras reinicios: buscar canales en las 9 categorías con la ID del usuario en el topic
    const catIds = new Set(Object.values(getGuildTicketCategories(guild)).filter(Boolean));
    for (const ch of guild.channels.cache.values()) {
        if (ch.type === ChannelType.GuildText && catIds.has(ch.parentId) && ch.topic && ch.topic.includes(`(${userId})`)) {
            found.set(ch.id, ch);
        }
    }

    return [...found.values()];
}

function formatDuration(ms) {
    const totalSec = Math.max(1, Math.floor(ms / 1000));
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

async function getNextTicketNumber(guildId, categoryKey) {
    const models = getModelsForGuild(guildId);
    if (models) {
        try {
            const doc = await models.Counter.findOneAndUpdate(
                { categoryKey },
                { $inc: { seq: 1 } },
                { upsert: true, returnDocument: 'after' }
            );
            if (doc && typeof doc.seq === 'number') {
                memoryCounters.set(`${guildId}:${categoryKey}`, doc.seq);
                return doc.seq;
            }
        } catch (e) {
            console.error('⚠️ [TICKETS] Error incrementando contador en Mongo:', e.message);
        }
    }
    const memKey = `${guildId}:${categoryKey}`;
    const next = (memoryCounters.get(memKey) || 0) + 1;
    memoryCounters.set(memKey, next);
    return next;
}

// ==========================================
// CONSTRUCTORES VISUALES (PANEL, TICKET, LOGS, VISOR)
// ==========================================
function buildTicketSelectRow() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('tkt_open_select')
        .setPlaceholder('🎫 Elige el tipo de ticket...')
        .addOptions(
            TICKET_TYPES.map(t => ({
                label: t.label,
                description: t.description.slice(0, 100),
                value: t.key,
                emoji: t.emoji
            }))
        );
    return new ActionRowBuilder().addComponents(menu);
}

function buildTicketPanelPayload(guild) {
    const v = guildManager.resolveGuildVisuals(guild?.id, 'tickets');
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `SISTEMA DE TICKETS | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle('🎟️ CENTRO DE ATENCIÓN Y SOPORTE')
        .setDescription(
            `\u200B\n` +
            `👋 ¡Bienvenido al **Sistema Oficial de Tickets** de **${serverName}** 🇪🇸!\n\n` +
            `Desde este panel podrás abrir un **canal privado** para recibir atención directa del equipo de Staff según el tema que necesites tratar *(todas las categorías disponibles se encuentran en el menú desplegable de abajo)*.\n\n` +
            `📋 **| ¿Cómo abrir un ticket?**\n` +
            `> 1️⃣ Despliega el menú **"🎫 Elige el tipo de ticket..."** aquí abajo y selecciona la categoría correspondiente.\n` +
            `> 2️⃣ Rellena el breve formulario con los datos de tu consulta o solicitud.\n` +
            `> 3️⃣ Se abrirá automáticamente un canal privado solo para ti y el departamento encargado.\n\n` +
            `⚠️ **| Normas importantes:**\n` +
            `> • Abre **solo un ticket por tema** y elige siempre la categoría adecuada.\n` +
            `> • **No menciones al Staff** dentro del ticket: el bot les avisa automáticamente al crearlo.\n\n` +
            `🇪🇸 **| ¡Disfruta de ${serverName}! |** 🇪🇸`
        )
        .setFooter({
            text: `${serverName} • Departamento de Atención y Soporte`,
            iconURL: iconUrl
        })
        .setTimestamp();

    if (v.bannerUrl) {
        embed.setImage(v.bannerUrl);
    }

    return {
        embeds: [embed],
        components: [buildTicketSelectRow()],
        files: [...v.files]
    };
}

function buildTicketWelcomeEmbed(guild, ticketData) {
    const bannerType = ticketData.categoryKey ? `ticket_${ticketData.categoryKey}` : 'tickets';
    const v = guildManager.resolveGuildVisuals(guild?.id, bannerType);
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;
    const tType = TICKET_TYPE_MAP.get(ticketData.categoryKey);
    const openedTs = Math.floor(new Date(ticketData.openedAt || Date.now()).getTime() / 1000);

    const safeFields = (ticketData.formFields || [])
        .filter(f => f.value && f.value.trim())
        .map(f => ({
            name: `📌 ${(f.label || 'Dato').slice(0, 240)}`,
            value: `> ${f.value.trim().slice(0, 980).replace(/\n/g, '\n> ')}`,
            inline: false
        }));

    if (safeFields.length === 0) {
        safeFields.push({
            name: '📝 Datos del Formulario',
            value: '> *Sin datos adicionales.*',
            inline: false
        });
    }

    const claimedLine = ticketData.claimedById
        ? `> 🟢 **Atendido por:** <@${ticketData.claimedById}>`
        : `> 🟡 **Estado:** \`Esperando a un miembro del Staff\``;

    const notifiedRolesLine = (ticketData.notifiedRoleIds && ticketData.notifiedRoleIds.length > 0)
        ? `\n> 🔔 **Equipo notificado:** ${ticketData.notifiedRoleIds.map(id => `<@&${id}>`).join(' · ')}`
        : '';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `SISTEMA DE TICKETS | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle(`${tType?.emoji || '🎟️'} ${tType?.label || ticketData.categoryLabel}`)
        .setDescription(
            `\u200B\n` +
            `👋 Hola <@${ticketData.openerId}>, tu solicitud en **${tType?.label || ticketData.categoryLabel}** ha sido abierta correctamente.\n` +
            `Un miembro del equipo de Staff te atenderá lo antes posible. *(Puedes adjuntar capturas o pruebas directamente aquí)*.\n\n` +
            `📋 **| Información del Ticket**\n` +
            `> 👤 **Usuario:** <@${ticketData.openerId}>\n` +
            `> 📅 **Apertura:** <t:${openedTs}:F> (<t:${openedTs}:R>)\n` +
            `${claimedLine}${notifiedRolesLine}\n\u200B`
        )
        .addFields(...safeFields)
        .setFooter({
            text: `${serverName} • Departamento de Atención y Soporte`,
            iconURL: iconUrl
        })
        .setTimestamp();

    if (v.bannerUrl) {
        embed.setImage(v.bannerUrl);
    }

    return { embed, files: [...v.files] };
}

function buildTicketControlRow(isClaimed = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('tkt_btn_claim')
            .setLabel(isClaimed ? 'Reclamado' : 'Reclamar Ticket')
            .setStyle(isClaimed ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setEmoji('🙋')
            .setDisabled(isClaimed),
        new ButtonBuilder()
            .setCustomId('tkt_btn_adduser')
            .setLabel('Añadir Usuario')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId('tkt_btn_rename')
            .setLabel('Renombrar')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✏️'),
        new ButtonBuilder()
            .setCustomId('tkt_btn_close')
            .setLabel('Cerrar Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
    );
}

function buildTicketLogSummaryPayload(guild, logDoc) {
    const v = guildManager.resolveGuildVisuals(guild?.id);
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;
    const tType = TICKET_TYPE_MAP.get(logDoc.categoryKey);
    const openedTs = Math.floor(new Date(logDoc.openedAt).getTime() / 1000);
    const closedTs = Math.floor(new Date(logDoc.closedAt).getTime() / 1000);

    const participantsText = (logDoc.participants && logDoc.participants.length > 0)
        ? logDoc.participants
            .slice(0, 12)
            .map(p => `> ${p.isStaff ? '🛡️' : '👤'} <@${p.userId}> — **${p.count}** msg(s)`)
            .join('\n')
        : '> *No hubo mensajes de usuarios en el ticket.*';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `REGISTRO DE TICKET CERRADO | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle(`${tType?.emoji || '📁'} Expediente: ${logDoc.ticketCode}`)
        .setDescription(
            `📂 **Categoría:** \`${logDoc.categoryLabel}\`\n` +
            `👤 **Abierto por:** <@${logDoc.openerId}>\n` +
            `🙋 **Reclamado por:** ${logDoc.claimedById ? `<@${logDoc.claimedById}>` : '`Sin reclamar`'}\n` +
            `🔒 **Cerrado por:** <@${logDoc.closedById}>\n\n` +
            `⏱️ **Apertura:** <t:${openedTs}:f> • **Cierre:** <t:${closedTs}:f>\n` +
            `⏳ **Duración:** \`${logDoc.durationText}\` • 💬 **Mensajes totales:** \`${logDoc.totalMessages}\`\n\n` +
            `📝 **Motivo / Resumen de cierre:**\n> ${logDoc.closeReason || 'Sin motivo especificado'}\n\n` +
            `👥 **Participantes en el ticket:**\n${participantsText}\n\n` +
            `💡 *Pulsa los botones de abajo para inspeccionar la conversación completa o filtrar los mensajes de cada persona sin descargar archivos.*`
        )
        .setFooter({
            text: `${serverName} • ID Log: ${logDoc.logId}`,
            iconURL: iconUrl
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tkt_log_view_${logDoc.logId}_0_all`)
            .setLabel('Ver Conversación')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📖'),
        new ButtonBuilder()
            .setCustomId(`tkt_log_form_${logDoc.logId}`)
            .setLabel('Ver Formulario Inicial')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋')
    );

    return { embeds: [embed], components: [row], files: [...v.files] };
}

function buildTranscriptViewerPayload(guild, logDoc, page = 0, filterUserId = 'all') {
    const v = guildManager.resolveGuildVisuals(guild?.id);
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;

    const allMsgs = Array.isArray(logDoc.messages) ? logDoc.messages : [];
    const filtered = filterUserId === 'all'
        ? allMsgs
        : allMsgs.filter(m => m.authorId === filterUserId);

    const PAGE_SIZE = 7;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const slice = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

    let body = '';
    if (slice.length === 0) {
        body = '📭 *No hay mensajes registrados para este filtro.*';
    } else {
        body = slice.map(m => {
            const ts = Math.floor((m.timestamp || Date.now()) / 1000);
            const badge = m.isBot ? '🤖' : (m.isStaff ? '🛡️' : '👤');
            const textPart = m.content ? m.content.slice(0, 380) : '*[Sin texto]*';
            const attPart = (m.attachments && m.attachments.length > 0)
                ? `\n> 📎 ${m.attachments.map((u, idx) => `[Adjunto ${idx + 1}](${u})`).join(' • ')}`
                : '';
            return `${badge} **${m.authorTag}** (<@${m.authorId}>) • <t:${ts}:t>\n> ${textPart.replace(/\n/g, '\n> ')}${attPart}`;
        }).join('\n\n');
    }

    if (body.length > 3850) {
        body = body.slice(0, 3800) + '\n\n*... (mensajes largos recortados para ajustar al contenedor)*';
    }

    const filterLabel = filterUserId === 'all'
        ? 'Todos los participantes'
        : (`Mensajes de ${logDoc.participants?.find(p => p.userId === filterUserId)?.userTag || filterUserId}`);

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `TRANSCRIPCIÓN INTERACTIVA • #${logDoc.ticketCode} | ${serverName}`,
            iconURL: iconUrl
        })
        .setTitle(`📖 Conversación del Ticket #${logDoc.ticketCode}`)
        .setDescription(
            `> 🔎 **Vista:** \`${filterLabel}\` • 💬 **Mostrando:** \`${filtered.length}\` mensaje(s)\n\n` +
            body
        )
        .setFooter({
            text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Log ${logDoc.logId}`
        })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tkt_log_prev_${logDoc.logId}_${Math.max(0, safePage - 1)}_${filterUserId}`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`tkt_log_page_info`)
            .setLabel(`Pág. ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`tkt_log_next_${logDoc.logId}_${Math.min(totalPages - 1, safePage + 1)}_${filterUserId}`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`tkt_log_back_${logDoc.logId}`)
            .setLabel('Volver al Registro')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('↩️')
    );

    const components = [navRow];

    // Selector para filtrar por cada persona que habló en el ticket
    const uniqueParticipants = (logDoc.participants || []).slice(0, 23);
    if (uniqueParticipants.length > 0) {
        const filterMenu = new StringSelectMenuBuilder()
            .setCustomId(`tkt_log_filter_${logDoc.logId}`)
            .setPlaceholder('👤 Filtrar mensajes por persona...')
            .addOptions([
                {
                    label: `Todos los participantes (${allMsgs.length} mensajes)`,
                    value: 'all',
                    emoji: '👥',
                    default: filterUserId === 'all'
                },
                ...uniqueParticipants.map(p => ({
                    label: `${p.userTag} (${p.count} msg)`.slice(0, 100),
                    description: p.isStaff ? 'Miembro del Staff' : 'Usuario / Participante',
                    value: p.userId,
                    emoji: p.isStaff ? '🛡️' : '👤',
                    default: filterUserId === p.userId
                }))
            ]);
        components.push(new ActionRowBuilder().addComponents(filterMenu));
    }

    return { embeds: [embed], components, files: [...v.files] };
}

// Temporizadores de auto-retorno al registro original en el canal de logs (2 minutos)
const logRevertTimers = new Map(); // messageId -> timeout

function clearLogRevertTimer(messageId) {
    if (logRevertTimers.has(messageId)) {
        clearTimeout(logRevertTimers.get(messageId));
        logRevertTimers.delete(messageId);
    }
}

function scheduleLogRevert(message, guild, logDoc, delayMs = 2 * 60 * 1000) {
    if (!message || !guild || !logDoc) return;
    clearLogRevertTimer(message.id);
    const timer = setTimeout(async () => {
        logRevertTimers.delete(message.id);
        try {
            const summary = buildTicketLogSummaryPayload(guild, logDoc);
            await message.edit({
                embeds: summary.embeds,
                components: summary.components
            }).catch(() => {});
        } catch (e) { }
    }, delayMs);
    logRevertTimers.set(message.id, timer);
}

async function fetchTicketLog(guildId, logId) {
    if (memoryTicketLogs.has(logId)) return memoryTicketLogs.get(logId);
    const models = getModelsForGuild(guildId);
    if (models) {
        const doc = await models.Log.findOne({ logId }).lean().catch(() => null);
        if (doc) {
            memoryTicketLogs.set(logId, doc);
            return doc;
        }
    }
    return null;
}

async function fetchActiveTicket(guildId, channelId) {
    if (memoryActiveTickets.has(channelId)) return memoryActiveTickets.get(channelId);
    const models = getModelsForGuild(guildId);
    if (models) {
        const doc = await models.Active.findOne({ channelId }).lean().catch(() => null);
        if (doc) {
            memoryActiveTickets.set(channelId, doc);
            return doc;
        }
    }
    return null;
}

// Recolecta todos los mensajes del ticket en orden cronológico (hasta 300)
async function collectTicketMessages(channel, guild) {
    const collected = [];
    let lastId = undefined;
    for (let batch = 0; batch < 3; batch++) {
        const fetched = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) }).catch(() => null);
        if (!fetched || fetched.size === 0) break;
        for (const msg of fetched.values()) {
            collected.push(msg);
        }
        lastId = fetched.last().id;
        if (fetched.size < 100) break;
    }

    collected.reverse(); // Orden cronológico (del más antiguo al más reciente)

    const participantMap = new Map();
    const formattedMsgs = [];

    for (const msg of collected) {
        // Ignorar mensajes vacíos del sistema/panel de control del propio bot sin contenido útil
        if (msg.author.bot && !msg.content && msg.embeds.length > 0 && msg.components.length > 0) continue;

        const member = msg.member || (guild ? guild.members.cache.get(msg.author.id) : null);
        const staffFlag = !msg.author.bot && isGuildStaff(member);
        const attachments = [...msg.attachments.values()].map(a => a.url);
        const content = msg.content || (msg.embeds.length > 0 ? `[Embed: ${msg.embeds[0].title || 'Mensaje'}]` : '');

        if (!content && attachments.length === 0) continue;

        formattedMsgs.push({
            authorId: msg.author.id,
            authorTag: msg.author.username || msg.author.tag || 'Usuario',
            isStaff: staffFlag,
            isBot: !!msg.author.bot,
            content: content.slice(0, 1000),
            attachments,
            timestamp: msg.createdTimestamp || Date.now()
        });

        if (!msg.author.bot) {
            const cur = participantMap.get(msg.author.id) || {
                userId: msg.author.id,
                userTag: msg.author.username || msg.author.tag || 'Usuario',
                isStaff: staffFlag,
                count: 0
            };
            cur.count += 1;
            participantMap.set(msg.author.id, cur);
        }
    }

    const participants = [...participantMap.values()].sort((a, b) => b.count - a.count);
    return { formattedMsgs, participants };
}

// ==========================================
// INICIALIZADOR DEL MÓDULO
// ==========================================
let initialized = false;

function initTicketSystem(client) {
    if (initialized) return;
    initialized = true;

    console.log('🎟️ [TICKETS AVANZADOS] Módulo independiente multi-servidor cargado (!panel-soporte, !setlogs-tickets, !setcat-ticket, !tickets-config).');

    // 1. COMANDOS DE CONFIGURACIÓN Y PUBLICACIÓN
    client.on('messageCreate', async (message) => {
        try {
            if (!message.guild || message.author.bot) return;
            const raw = message.content.trim();
            if (!raw.startsWith('!')) return;

            const args = raw.split(/\s+/);
            const cmd = args[0].toLowerCase();

            // Publicar panel de apertura de tickets (!panel-soporte / !crear-panel-tickets / !fijar-tickets)
            if (['!panel-soporte', '!panelsoporte', '!crear-panel-tickets', '!panel-abrir-tickets', '!fijar-tickets', '!tickets-panel'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const payload = buildTicketPanelPayload(message.guild);
                const sent = await message.channel.send(payload).catch(err => {
                    console.error('❌ [TICKETS] Error enviando panel de apertura:', err.message);
                    return null;
                });

                if (sent) {
                    await guildManager.setGuildConfigKey(message.guild.id, 'CHANNEL_TICKETS_ID', message.channel.id).catch(() => {});
                    await guildManager.setGuildConfigKey(message.guild.id, 'MSG_TICKETS_PANEL_ID', sent.id).catch(() => {});
                    guildManager.logGuild(message.guild, '🎟️', `Panel de soporte publicado en #${message.channel.name}`);
                }
                return;
            }

            // Configurar canal de logs de tickets cerrados: !setlogs-tickets <#canal o ID>
            if (['!setlogs-tickets', '!setlogstickets', '!logs-tickets', '!setcanal-logs-tickets'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const rawCh = args[1]?.replace(/[<#>]/g, '').trim();
                const targetCh = message.mentions.channels.first()
                    || (rawCh ? message.guild.channels.cache.get(rawCh) : null)
                    || message.channel;

                await guildManager.setGuildConfigKey(message.guild.id, 'CHANNEL_TICKETS_LOGS_ID', targetCh.id);
                const v = guildManager.resolveGuildVisuals(message.guild.id);
                const okEmbed = new EmbedBuilder()
                    .setColor(v.color)
                    .setTitle('📜 Canal de Logs de Tickets Configurado')
                    .setDescription(
                        `✅ Todos los tickets cerrados en **${v.name}** guardarán su historial completo e interactivo en <#${targetCh.id}> (\`${targetCh.id}\`).\n\n` +
                        `> 📖 *Cada registro incluirá botones para ver la conversación paginada y filtrar mensajes por persona sin descargar ningún \`.txt\`.*`
                    )
                    .setFooter({ text: `${v.name} • Sistema Avanzado de Tickets` })
                    .setTimestamp();

                const m = await message.channel.send({ embeds: [okEmbed] }).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 8000);
                return;
            }

            // Configurar categoría de ticket en cualquier servidor: !setcat-ticket <tipo> <ID_categoria>
            if (['!setcat-ticket', '!setcatticket', '!setcategoria-ticket'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const tipo = (args[1] || '').toLowerCase();
                const catId = (args[2] || '').replace(/[<#>]/g, '').trim();
                const tType = TICKET_TYPE_MAP.get(tipo);

                if (!tType || !catId) {
                    const keys = TICKET_TYPES.map(t => `\`${t.key}\``).join(', ');
                    const m = await message.channel.send(`⚠️ **Uso:** \`!setcat-ticket <tipo> <ID_Categoría>\`\n📌 **Tipos válidos:** ${keys}`).catch(() => null);
                    if (m) setTimeout(() => m.delete().catch(() => {}), 9000);
                    return;
                }

                await guildManager.setGuildConfigKey(message.guild.id, tType.configKey, catId);
                const m = await message.channel.send(`✅ Categoría **${tType.emoji} ${tType.label}** asignada a \`${catId}\` en **${message.guild.name}**.`).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 7000);
                return;
            }

            // Configurar rol de directiva: !setrol-directiva <@rol o ID>
            if (['!setrol-directiva', '!setdirectiva'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const rawRole = args[1]?.replace(/[<@&>]/g, '').trim();
                const role = message.mentions.roles.first() || (rawRole ? message.guild.roles.cache.get(rawRole) : null);
                if (!role) {
                    const m = await message.channel.send('⚠️ **Uso:** `!setrol-directiva <@rol o ID_rol>`').catch(() => null);
                    if (m) setTimeout(() => m.delete().catch(() => {}), 6000);
                    return;
                }
                await guildManager.setGuildConfigKey(message.guild.id, 'ROLE_DIRECTIVA_ID', role.id);
                const m = await message.channel.send(`👑 Rol de Directiva configurado en <@&${role.id}> para **${message.guild.name}**.`).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 7000);
                return;
            }

            // Configurar límite máximo de tickets simultáneos por usuario: !tklimites <numero>
            if (['!tklimites', '!tklimite', '!limitetickets', '!ticketlimites', '!setlimitetickets'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const v = guildManager.resolveGuildVisuals(message.guild.id);
                const gCfg = v.config || {};
                const iconUrl = v.logoUrl || message.guild.iconURL() || undefined;
                const currentLimit = Math.max(1, parseInt(gCfg.MAX_TICKETS_PER_USER, 10) || 1);

                const rawNum = args[1];
                if (!rawNum) {
                    const infoEmbed = new EmbedBuilder()
                        .setColor(v.color)
                        .setAuthor({ name: `SISTEMA DE TICKETS | ${v.name}`, iconURL: iconUrl })
                        .setThumbnail(iconUrl)
                        .setTitle('🎟️ Límite de Tickets Simultáneos')
                        .setDescription(
                            `\u200B\n` +
                            `📊 **| Configuración actual en ${v.name}:**\n` +
                            `> 🔒 **Límite por usuario:** \`${currentLimit}\` ticket(s) abiertos a la vez *(en cualquier categoría)*\n` +
                            `> 🛡️ **Exentos (Sin límite):** Propietario / Creador y miembros con el Rol de Staff.\n\n` +
                            `⚙️ **| ¿Cómo cambiar el límite?**\n` +
                            `> Escribe \`!tklimites <número>\` *(del 1 al 15)*.\n` +
                            `> 📌 *Ejemplo:* \`!tklimites 3\``
                        )
                        .setFooter({ text: `${v.name} • Este mensaje se auto-eliminará en 10s`, iconURL: iconUrl })
                        .setTimestamp();
                    const m = await message.channel.send({ embeds: [infoEmbed], files: v.files }).catch(() => null);
                    if (m) setTimeout(() => m.delete().catch(() => {}), 10000);
                    return;
                }

                const newLimit = parseInt(rawNum, 10);
                if (isNaN(newLimit) || newLimit < 1 || newLimit > 15) {
                    const errEmbed = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setAuthor({ name: `SISTEMA DE TICKETS | ${v.name}`, iconURL: iconUrl })
                        .setTitle('⚠️ Valor no válido')
                        .setDescription('Debes indicar un número válido entre **1** y **15**.\n\n> 📌 *Ejemplo:* `!tklimites 3`')
                        .setFooter({ text: `${v.name} • Este mensaje se auto-eliminará en 6s` });
                    const m = await message.channel.send({ embeds: [errEmbed] }).catch(() => null);
                    if (m) setTimeout(() => m.delete().catch(() => {}), 6000);
                    return;
                }

                await guildManager.setGuildConfigKey(message.guild.id, 'MAX_TICKETS_PER_USER', newLimit);
                const okEmbed = new EmbedBuilder()
                    .setColor(v.color)
                    .setAuthor({ name: `SISTEMA DE TICKETS | ${v.name}`, iconURL: iconUrl })
                    .setThumbnail(iconUrl)
                    .setTitle('✅ Límite de Tickets Actualizado')
                    .setDescription(
                        `\u200B\n` +
                        `Se ha establecido correctamente el nuevo límite global de tickets para **${v.name}**.\n\n` +
                        `📊 **| Resumen del cambio:**\n` +
                        `> 🎟️ **Máximo simultáneo por usuario:** \`${newLimit}\` ticket(s) *(combinando cualquier categoría)*\n` +
                        `> 👑 **Creador y Equipo de Staff:** \`Sin límite (Ilimitado)\`\n\n` +
                        `> 💡 *Los cambios ya están activos de forma inmediata.*`
                    )
                    .setFooter({ text: `${v.name} • Este mensaje se auto-eliminará en 8s`, iconURL: iconUrl })
                    .setTimestamp();

                const m = await message.channel.send({ embeds: [okEmbed], files: v.files }).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 8000);
                return;
            }

            // Ver configuración actual de tickets del servidor: !tickets-config
            if (['!tickets-config', '!vertickets', '!config-tickets'].includes(cmd)) {
                if (!isGuildStaff(message.member)) return;
                await message.delete().catch(() => {});

                const v = guildManager.resolveGuildVisuals(message.guild.id);
                const gCfg = v.config || {};
                const cats = getGuildTicketCategories(message.guild);

                const catLines = TICKET_TYPES.map(t => {
                    const id = cats[t.key];
                    const ch = id ? message.guild.channels.cache.get(id) : null;
                    return `> ${t.emoji} **${t.label}** (\`${t.channelPrefix}-N\`): ${id ? `\`${id}\` ${ch ? `(${ch.name})` : ''}` : '❌ Sin configurar'}`;
                }).join('\n');

                const maxPerUser = Math.max(1, parseInt(gCfg.MAX_TICKETS_PER_USER, 10) || 1);
                const embed = new EmbedBuilder()
                    .setColor(v.color)
                    .setAuthor({ name: `CONFIGURACIÓN DE TICKETS | ${v.name}`, iconURL: v.logoUrl })
                    .setTitle('🎟️ Estado y Categorías del Sistema de Tickets')
                    .setDescription(
                        `📜 **Canal de Logs:** ${gCfg.CHANNEL_TICKETS_LOGS_ID ? `<#${gCfg.CHANNEL_TICKETS_LOGS_ID}>` : '❌ Sin configurar (`!setlogs-tickets #canal`)'}\n` +
                        `🔢 **Límite por usuario:** \`${maxPerUser}\` ticket(s) a la vez *(\`!tklimites <n>\`)* • **Staff/Creador:** \`Ilimitado\`\n` +
                        `👑 **Rol Directiva:** ${gCfg.ROLE_DIRECTIVA_ID ? `<@&${gCfg.ROLE_DIRECTIVA_ID}>` : '`Administradores / Staff`'}\n\n` +
                        `📂 **Categorías configuradas (9):**\n${catLines}`
                    )
                    .setFooter({ text: `${v.name} • Sistema Avanzado de Tickets` })
                    .setTimestamp();

                const m = await message.channel.send({ embeds: [embed], files: v.files }).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 25000);
                return;
            }
        } catch (err) {
            console.error('⚠️ [TICKETS messageCreate Error]:', err.message);
        }
    });

    // 2. INTERACCIONES: SELECT MENU, MODALES, BOTONES DE CONTROL Y VISOR DE LOGS
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.guild) return;

            // A) MENÚ DESPLEGABLE: ABRIR MODAL AL INSTANTE (0ms, SIN LAG) Y RESETEAR EL SELECTOR
            if (interaction.isStringSelectMenu() && interaction.customId === 'tkt_open_select') {
                const selectedKey = interaction.values[0];
                const tType = TICKET_TYPE_MAP.get(selectedKey);
                if (!tType) return;

                const cats = getGuildTicketCategories(interaction.guild);
                const targetCatId = cats[selectedKey];

                // Resetear el menú desplegable en segundo plano para que NUNCA se quede seleccionada la opción
                if (interaction.message && interaction.message.editable) {
                    interaction.message.edit({ components: [buildTicketSelectRow()] }).catch(() => {});
                }

                // Comprobación instantánea de límite global de tickets (0ms, sin esperar a DB)
                // El Creador y los Staffs con el rol principal de Staff están 100% EXENTOS (tickets ilimitados)
                const isExempt = isGuildStaff(interaction.member);
                if (!isExempt) {
                    const gCfgLim = guildManager.getGuildConfig(interaction.guild.id);
                    const maxTickets = Math.max(1, parseInt(gCfgLim.MAX_TICKETS_PER_USER, 10) || 1);
                    const userOpenChannels = getUserOpenTicketChannels(interaction.guild, interaction.user.id);

                    if (userOpenChannels.length >= maxTickets) {
                        const vLim = guildManager.resolveGuildVisuals(interaction.guild.id);
                        const limIcon = vLim.logoUrl || interaction.guild.iconURL() || undefined;
                        const activeList = userOpenChannels
                            .map((ch, idx) => `> \`#${idx + 1}\` <#${ch.id}>`)
                            .join('\n');

                        const limitEmbed = new EmbedBuilder()
                            .setColor(0xE67E22)
                            .setAuthor({
                                name: `SISTEMA DE TICKETS | ${vLim.name}`,
                                iconURL: limIcon
                            })
                            .setThumbnail(limIcon)
                            .setTitle('🚫 Límite de Tickets Activos Alcanzado')
                            .setDescription(
                                `\u200B\n` +
                                `👋 Hola <@${interaction.user.id}>, ya has alcanzado el **máximo de tickets abiertos simultáneamente** en **${vLim.name}**.\n\n` +
                                `📊 **| Estado actual:**\n` +
                                `> 🎟️ **Tickets activos:** \`${userOpenChannels.length} / ${maxTickets}\`\n\n` +
                                `📂 **| Tus canales abiertos ahora mismo:**\n` +
                                `${activeList}\n\n` +
                                `💡 **| ¿Qué debes hacer?**\n` +
                                `> Continúa tu consulta en uno de tus tickets abiertos o espera a que un miembro del Staff cierre alguno para poder abrir uno nuevo.\n\n` +
                                `🇪🇸 **| ${vLim.name} • Departamento de Atención y Soporte |** 🇪🇸`
                            )
                            .setFooter({
                                text: `${vLim.name} • Este mensaje se auto-eliminará en 8s`,
                                iconURL: limIcon
                            })
                            .setTimestamp();

                        const jumpRow = new ActionRowBuilder().addComponents(
                            ...userOpenChannels.slice(0, 5).map(ch =>
                                new ButtonBuilder()
                                    .setLabel(`📩 Ir a #${ch.name}`.slice(0, 80))
                                    .setStyle(ButtonStyle.Link)
                                    .setURL(`https://discord.com/channels/${interaction.guild.id}/${ch.id}`)
                            )
                        );

                        await interaction.reply({
                            embeds: [limitEmbed],
                            components: [jumpRow],
                            files: vLim.files,
                            ephemeral: true
                        }).catch(() => {});
                        setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                        return;
                    }
                }

                if (!targetCatId) {
                    await interaction.reply({
                        content: `⚠️ La categoría para **${tType.label}** aún no está configurada en este servidor. Avisa a la Administración.`,
                        ephemeral: true
                    }).catch(() => {});
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                    return;
                }

                const modal = new ModalBuilder()
                    .setCustomId(`tkt_modal_open_${tType.key}`)
                    .setTitle(tType.modalTitle.slice(0, 45));

                for (const f of tType.fields) {
                    const input = new TextInputBuilder()
                        .setCustomId(f.id)
                        .setLabel(f.label.slice(0, 45))
                        .setPlaceholder(f.placeholder.slice(0, 100))
                        .setStyle(f.style)
                        .setRequired(!!f.required)
                        .setMaxLength(f.maxLength || 500);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                }

                return interaction.showModal(modal).catch(err => {
                    console.error('❌ [TICKETS] Error abriendo modal:', err.message);
                });
            }

            // B) MODAL ENVIADO -> CREAR CANAL PRIVADO EN SU CATEGORÍA CON CONTADOR SECUENCIAL
            if (interaction.isModalSubmit() && interaction.customId.startsWith('tkt_modal_open_')) {
                await interaction.deferReply({ ephemeral: true }).catch(() => {});

                const catKey = interaction.customId.replace('tkt_modal_open_', '');
                const tType = TICKET_TYPE_MAP.get(catKey);
                if (!tType) return;

                const guild = interaction.guild;
                const gCfg = guildManager.getGuildConfig(guild.id);
                const cats = getGuildTicketCategories(guild);
                const categoryId = cats[catKey];

                const formFields = tType.fields.map(f => {
                    let val = '';
                    try { val = interaction.fields.getTextInputValue(f.id).trim(); } catch (_) { }
                    return { label: f.label, value: val || 'No especificado' };
                });

                const nextNum = await getNextTicketNumber(guild.id, catKey);
                const ticketCode = `${tType.channelPrefix}-${nextNum}`;

                // Heredar ESTRICTAMENTE los permisos de la categoría en Discord + creador del ticket + bot
                // Así ningún Staff sin permiso en esa categoría podrá ver el ticket
                const parentCategory = categoryId
                    ? (guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null))
                    : null;

                const { permissionOverwrites, allowedRoleIds } = buildCategoryInheritedOverwrites(
                    guild,
                    parentCategory,
                    interaction.user.id,
                    client.user.id
                );

                const channel = await guild.channels.create({
                    name: ticketCode,
                    type: ChannelType.GuildText,
                    parent: categoryId || undefined,
                    topic: `Ticket ${ticketCode} | Categoría: ${tType.label} | Usuario: ${interaction.user.tag} (${interaction.user.id})`,
                    permissionOverwrites
                }).catch(err => {
                    console.error('❌ [TICKETS] Error creando canal de ticket:', err.message);
                    return null;
                });

                if (!channel) {
                    return interaction.editReply({
                        content: '❌ No se pudo crear el canal del ticket. Comprueba que el bot tiene permiso de **Gestionar Canales** en esa categoría.'
                    }).catch(() => {});
                }

                // Determinar exactamente qué roles notificar:
                // - Si el rol principal de Staff (ej: ⚡EQUIPO DE STAFF⚡) tiene acceso a esta categoría -> mencionar SOLO a ese rol.
                // - Si NO tiene acceso (categoría de rangos altos) -> mencionar solo a los roles humanos autorizados en orden de jerarquía.
                const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(guild.id) ? '1538191116610838691' : '');
                const validAllowedRoles = allowedRoleIds
                    .filter(rid => {
                        if (rid === guild.roles.everyone.id) return false;
                        const roleObj = guild.roles.cache.get(rid);
                        return roleObj && !roleObj.managed; // Excluir roles automáticos de bots
                    })
                    .sort((a, b) => {
                        const posA = guild.roles.cache.get(a)?.position || 0;
                        const posB = guild.roles.cache.get(b)?.position || 0;
                        return posB - posA;
                    });

                const notifiedRoleIds = (staffRoleId && validAllowedRoles.includes(staffRoleId))
                    ? [staffRoleId]
                    : validAllowedRoles;

                const ticketData = {
                    channelId: channel.id,
                    guildId: guild.id,
                    ticketCode,
                    categoryKey: catKey,
                    categoryLabel: tType.label,
                    number: nextNum,
                    openerId: interaction.user.id,
                    openerTag: interaction.user.username || interaction.user.tag,
                    claimedById: '',
                    claimedByTag: '',
                    notifiedRoleIds,
                    formFields,
                    openedAt: new Date()
                };

                const { embed, files } = buildTicketWelcomeEmbed(guild, ticketData);

                // Enviar el Embed 100% limpio sin texto feo encima (las menciones van ordenadas dentro del Embed)
                const welcomeMsg = await channel.send({
                    embeds: [embed],
                    components: [buildTicketControlRow(false)],
                    files
                }).catch(() => null);

                // Ping fantasma instantáneo (se borra al instante) para que llegue la notificación real a Discord sin ensuciar el chat
                const ghostMentions = [
                    `<@${interaction.user.id}>`,
                    ...notifiedRoleIds.map(rid => `<@&${rid}>`)
                ].join(' ');
                if (ghostMentions) {
                    const pingMsg = await channel.send({ content: ghostMentions }).catch(() => null);
                    if (pingMsg) pingMsg.delete().catch(() => {});
                }

                if (welcomeMsg) ticketData.welcomeMessageId = welcomeMsg.id;

                memoryActiveTickets.set(channel.id, ticketData);
                const models = getModelsForGuild(guild.id);
                if (models) {
                    await models.Active.findOneAndUpdate(
                        { channelId: channel.id },
                        ticketData,
                        { upsert: true }
                    ).catch(() => {});
                }

                // Actualizar Monitor de Tickets en Vivo inmediatamente
                if (typeof client.notifyTicketMonitor === 'function') {
                    client.notifyTicketMonitor(guild.id);
                }
                guildManager.logGuild(guild, '🎟️', `Ticket #${ticketCode} (${tType.label}) abierto por ${interaction.user.username}`);

                const vOk = guildManager.resolveGuildVisuals(guild.id);
                const okIcon = vOk.logoUrl || guild.iconURL() || undefined;
                const okEmbed = new EmbedBuilder()
                    .setColor(vOk.color)
                    .setAuthor({
                        name: `SISTEMA DE TICKETS | ${vOk.name}`,
                        iconURL: okIcon
                    })
                    .setThumbnail(okIcon)
                    .setTitle(`${tType.emoji} ¡Tu ticket ha sido abierto!`)
                    .setDescription(
                        `👋 Hola <@${interaction.user.id}>, ya hemos creado tu canal privado de **${tType.label}**.\n\n` +
                        `> 📩 **Canal asignado:** <#${channel.id}>\n` +
                        `> 🛡️ *Pulsa el botón de abajo para ir directamente a tu ticket.*`
                    )
                    .setFooter({
                        text: `${vOk.name} • Este mensaje se auto-eliminará en 5s`,
                        iconURL: okIcon
                    })
                    .setTimestamp();

                const goTicketRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('📩 Ir a mi Ticket')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://discord.com/channels/${guild.id}/${channel.id}`)
                );

                await interaction.editReply({
                    embeds: [okEmbed],
                    components: [goTicketRow],
                    files: vOk.files
                }).catch(() => {});
                setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                return;
            }

            // C) BOTONES DE CONTROL DENTRO DEL TICKET
            if (interaction.isButton() && ['tkt_btn_claim', 'tkt_btn_adduser', 'tkt_btn_rename', 'tkt_btn_close'].includes(interaction.customId)) {
                const ticket = await fetchActiveTicket(interaction.guild.id, interaction.channelId);
                const staff = isGuildStaff(interaction.member);

                // Reclamar ticket (solo Staff)
                if (interaction.customId === 'tkt_btn_claim') {
                    if (!staff) {
                        return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede reclamar tickets.', ephemeral: true }).catch(() => {});
                    }
                    if (!ticket) {
                        return interaction.reply({ content: '⚠️ No se encontró el expediente activo de este ticket.', ephemeral: true }).catch(() => {});
                    }
                    if (ticket.claimedById) {
                        return interaction.reply({ content: `ℹ️ Este ticket ya fue reclamado por <@${ticket.claimedById}>.`, ephemeral: true }).catch(() => {});
                    }

                    ticket.claimedById = interaction.user.id;
                    ticket.claimedByTag = interaction.user.username || interaction.user.tag;
                    memoryActiveTickets.set(interaction.channelId, ticket);

                    const models = getModelsForGuild(interaction.guild.id);
                    if (models) {
                        await models.Active.updateOne(
                            { channelId: interaction.channelId },
                            { claimedById: ticket.claimedById, claimedByTag: ticket.claimedByTag }
                        ).catch(() => {});
                    }

                    const { embed } = buildTicketWelcomeEmbed(interaction.guild, ticket);
                    await interaction.update({
                        embeds: [embed],
                        components: [buildTicketControlRow(true)]
                    }).catch(() => {});

                    const vCl = guildManager.resolveGuildVisuals(interaction.guild.id);
                    const clIcon = vCl.logoUrl || interaction.guild.iconURL() || undefined;
                    const claimEmbed = new EmbedBuilder()
                        .setColor(0x2ECC71)
                        .setAuthor({
                            name: `ATENCIÓN DE STAFF | ${vCl.name}`,
                            iconURL: clIcon
                        })
                        .setTitle('🙋 Ticket Reclamado')
                        .setDescription(
                            `🛡️ El miembro del Staff <@${interaction.user.id}> ha reclamado este ticket y se encargará de atender a <@${ticket.openerId}>.\n\n` +
                            `> 💬 *Ya puedes continuar explicando tu caso con total tranquilidad.*`
                        )
                        .setFooter({
                            text: `${vCl.name} • Departamento de Atención y Soporte`,
                            iconURL: clIcon
                        })
                        .setTimestamp();

                    await interaction.channel.send({ embeds: [claimEmbed], files: vCl.files }).catch(() => {});
                    guildManager.logGuild(interaction.guild, '🙋', `Ticket #${ticket.ticketCode} reclamado por ${interaction.user.username}`);
                    return;
                }

                // Añadir usuario (solo Staff)
                if (interaction.customId === 'tkt_btn_adduser') {
                    if (!staff) {
                        return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede añadir usuarios.', ephemeral: true }).catch(() => {});
                    }
                    const modal = new ModalBuilder()
                        .setCustomId('tkt_modal_adduser')
                        .setTitle('➕ Añadir usuario al ticket')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('user_id')
                                    .setLabel('ID del usuario de Discord')
                                    .setPlaceholder('Ej: 123456789012345678')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                            )
                        );
                    return interaction.showModal(modal).catch(() => {});
                }

                // Renombrar ticket (solo Staff)
                if (interaction.customId === 'tkt_btn_rename') {
                    if (!staff) {
                        return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede renombrar tickets.', ephemeral: true }).catch(() => {});
                    }
                    const modal = new ModalBuilder()
                        .setCustomId('tkt_modal_rename')
                        .setTitle('✏️ Renombrar canal del ticket')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('new_name')
                                    .setLabel('Nuevo nombre del canal')
                                    .setPlaceholder('Ej: soporte-1-pendiente')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                                    .setMaxLength(50)
                            )
                        );
                    return interaction.showModal(modal).catch(() => {});
                }

                // Cerrar ticket (Staff o el creador del ticket)
                if (interaction.customId === 'tkt_btn_close') {
                    const isOpener = ticket && ticket.openerId === interaction.user.id;
                    if (!staff && !isOpener) {
                        return interaction.reply({ content: '⛔ Solo el **Staff** o el creador del ticket pueden cerrarlo.', ephemeral: true }).catch(() => {});
                    }
                    const modal = new ModalBuilder()
                        .setCustomId('tkt_modal_close')
                        .setTitle('🔒 Cerrar Ticket y Guardar Log')
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('close_reason')
                                    .setLabel('Motivo / Resumen del cierre (opcional)')
                                    .setPlaceholder('Ej: Duda resuelta correctamente / Sanción aplicada')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setRequired(false)
                                    .setMaxLength(500)
                            )
                        );
                    return interaction.showModal(modal).catch(() => {});
                }
            }

            // D) MODAL AÑADIR USUARIO
            if (interaction.isModalSubmit() && interaction.customId === 'tkt_modal_adduser') {
                const rawId = interaction.fields.getTextInputValue('user_id').replace(/[<@!>]/g, '').trim();
                const member = await interaction.guild.members.fetch(rawId).catch(() => null);
                if (!member) {
                    return interaction.reply({ content: `❌ No se encontró ningún usuario con la ID \`${rawId}\` en este servidor.`, ephemeral: true }).catch(() => {});
                }
                await interaction.channel.permissionOverwrites.edit(member.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AttachFiles: true,
                    EmbedLinks: true
                }).catch(() => {});
                const vAdd = guildManager.resolveGuildVisuals(interaction.guild.id);
                const addEmbed = new EmbedBuilder()
                    .setColor(vAdd.color)
                    .setAuthor({ name: `GESTIÓN DE TICKET | ${vAdd.name}`, iconURL: vAdd.logoUrl })
                    .setDescription(`➕ <@${member.id}> ha sido añadido a este ticket por <@${interaction.user.id}>.`)
                    .setTimestamp();
                return interaction.reply({ embeds: [addEmbed] }).catch(() => {});
            }

            // E) MODAL RENOMBRAR CANAL
            if (interaction.isModalSubmit() && interaction.customId === 'tkt_modal_rename') {
                const newName = interaction.fields.getTextInputValue('new_name')
                    .toLowerCase()
                    .replace(/[^a-z0-9-_]/g, '-')
                    .replace(/-+/g, '-')
                    .slice(0, 50);
                if (!newName) {
                    return interaction.reply({ content: '⚠️ Nombre no válido.', ephemeral: true }).catch(() => {});
                }
                await interaction.channel.setName(newName).catch(() => {});
                const vRen = guildManager.resolveGuildVisuals(interaction.guild.id);
                const renEmbed = new EmbedBuilder()
                    .setColor(vRen.color)
                    .setAuthor({ name: `GESTIÓN DE TICKET | ${vRen.name}`, iconURL: vRen.logoUrl })
                    .setDescription(`✏️ Canal renombrado a **#${newName}** por <@${interaction.user.id}>.`)
                    .setTimestamp();
                return interaction.reply({ embeds: [renEmbed] }).catch(() => {});
            }

            // F) MODAL CERRAR TICKET -> GUARDA TRANSCRIPCIÓN INTERACTIVA EN MONGODB Y ENVÍA LOG
            if (interaction.isModalSubmit() && interaction.customId === 'tkt_modal_close') {
                await interaction.deferReply().catch(() => {});
                const closeReason = interaction.fields.getTextInputValue('close_reason')?.trim() || 'Ticket cerrado sin motivo especificado';
                const guild = interaction.guild;
                const channel = interaction.channel;

                const ticket = await fetchActiveTicket(guild.id, channel.id) || {
                    channelId: channel.id,
                    guildId: guild.id,
                    ticketCode: channel.name,
                    categoryKey: 'soporte',
                    categoryLabel: channel.parent?.name || 'Ticket',
                    number: 0,
                    openerId: interaction.user.id,
                    openerTag: interaction.user.username,
                    claimedById: '',
                    claimedByTag: '',
                    formFields: [],
                    openedAt: channel.createdAt || new Date()
                };

                const { formattedMsgs, participants } = await collectTicketMessages(channel, guild);
                const closedAt = new Date();
                const openedAt = new Date(ticket.openedAt || Date.now());
                const durationText = formatDuration(closedAt.getTime() - openedAt.getTime());
                const logId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

                const logDoc = {
                    logId,
                    guildId: guild.id,
                    ticketCode: ticket.ticketCode,
                    categoryKey: ticket.categoryKey,
                    categoryLabel: ticket.categoryLabel,
                    number: ticket.number || 0,
                    openerId: ticket.openerId,
                    openerTag: ticket.openerTag || 'Usuario',
                    claimedById: ticket.claimedById || '',
                    claimedByTag: ticket.claimedByTag || '',
                    closedById: interaction.user.id,
                    closedByTag: interaction.user.username || interaction.user.tag,
                    closeReason,
                    openedAt,
                    closedAt,
                    durationText,
                    totalMessages: formattedMsgs.length,
                    formFields: ticket.formFields || [],
                    participants,
                    messages: formattedMsgs
                };

                memoryTicketLogs.set(logId, logDoc);
                memoryActiveTickets.delete(channel.id);

                const models = getModelsForGuild(guild.id);
                if (models) {
                    await models.Log.create(logDoc).catch(err => console.error('⚠️ [TICKETS] Error guardando log en Mongo:', err.message));
                    await models.Active.deleteOne({ channelId: channel.id }).catch(() => {});
                }

                // Publicar tarjeta resumen con botones interactivos en el canal de logs de ESTE servidor
                const gCfg = guildManager.getGuildConfig(guild.id);
                const logsChannelId = gCfg.CHANNEL_TICKETS_LOGS_ID;
                if (logsChannelId) {
                    const logsCh = guild.channels.cache.get(logsChannelId) || await guild.channels.fetch(logsChannelId).catch(() => null);
                    if (logsCh && logsCh.isTextBased()) {
                        const logPayload = buildTicketLogSummaryPayload(guild, logDoc);
                        await logsCh.send(logPayload).catch(err => console.error('⚠️ [TICKETS] Error enviando log al canal:', err.message));
                    }
                }

                const vCls = guildManager.resolveGuildVisuals(guild.id);
                const closeEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({ name: `CIERRE DE TICKET | ${vCls.name}`, iconURL: vCls.logoUrl })
                    .setTitle('🔒 Ticket Cerrado')
                    .setDescription(
                        `🛡️ Cerrado por <@${interaction.user.id}>.\n` +
                        `> 📜 **Registro guardado:** \`${formattedMsgs.length}\` mensaje(s)${logsChannelId ? ` en <#${logsChannelId}>` : ''}.\n` +
                        `> ⏳ *Eliminando este canal en **5 segundos**...*`
                    )
                    .setFooter({ text: `${vCls.name} • Departamento de Atención y Soporte` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [closeEmbed] }).catch(() => {});
                guildManager.logGuild(guild, '🔒', `Ticket #${ticket.ticketCode} cerrado por ${interaction.user.username} (${formattedMsgs.length} mensajes)`);

                setTimeout(async () => {
                    await channel.delete(`Ticket cerrado por ${interaction.user.tag}: ${closeReason}`).catch(() => {});
                    if (typeof client.notifyTicketMonitor === 'function') {
                        client.notifyTicketMonitor(guild.id);
                    }
                }, 5000);
                return;
            }

            // G) BOTONES DEL VISOR INTERACTIVO DE LOGS (EDITA EL PROPIO REGISTRO EN EL SITIO + AUTO-RETORNO 2 MIN)
            if (interaction.isButton() && (
                interaction.customId.startsWith('tkt_log_view_') ||
                interaction.customId.startsWith('tkt_log_prev_') ||
                interaction.customId.startsWith('tkt_log_next_')
            )) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede inspeccionar los logs de tickets.', ephemeral: true }).catch(() => {});
                }
                await interaction.deferUpdate().catch(() => {});

                const rest = interaction.customId.replace(/^tkt_log_(view|prev|next)_/, '');
                const parts = rest.split('_');
                const logId = parts[0];
                const page = parseInt(parts[1], 10) || 0;
                const filterUserId = parts.slice(2).join('_') || 'all';

                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.followUp({ content: '⚠️ No se encontró el historial de este ticket en la base de datos.', ephemeral: true }).catch(() => {});
                }

                const payload = buildTranscriptViewerPayload(interaction.guild, logDoc, page, filterUserId);
                await interaction.editReply({
                    embeds: payload.embeds,
                    components: payload.components
                }).catch(e => console.error('❌ [TICKETS LOG VIEW]:', e.message));

                // Programar (o reiniciar) el auto-retorno a la tarjeta original tras 2 minutos
                scheduleLogRevert(interaction.message, interaction.guild, logDoc);
                return;
            }

            // H) FILTRO POR PERSONA DENTRO DEL VISOR DE LOGS (EDITA EN EL SITIO + REINICIA TEMPORIZADOR 2 MIN)
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tkt_log_filter_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el Staff puede filtrar logs.', ephemeral: true }).catch(() => {});
                }
                await interaction.deferUpdate().catch(() => {});
                const logId = interaction.customId.replace('tkt_log_filter_', '');
                const selectedUser = interaction.values[0] || 'all';
                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.followUp({ content: '⚠️ No se encontró el historial de este ticket.', ephemeral: true }).catch(() => {});
                }
                const payload = buildTranscriptViewerPayload(interaction.guild, logDoc, 0, selectedUser);
                await interaction.editReply({
                    embeds: payload.embeds,
                    components: payload.components
                }).catch(e => console.error('❌ [TICKETS LOG FILTER]:', e.message));

                scheduleLogRevert(interaction.message, interaction.guild, logDoc);
                return;
            }

            // I) BOTÓN "VER FORMULARIO INICIAL" (EDITA EL PROPIO REGISTRO EN EL SITIO + AUTO-RETORNO 2 MIN)
            if (interaction.isButton() && interaction.customId.startsWith('tkt_log_form_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede ver los formularios archivados.', ephemeral: true }).catch(() => {});
                }
                await interaction.deferUpdate().catch(() => {});
                const logId = interaction.customId.replace('tkt_log_form_', '');
                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.followUp({ content: '⚠️ No se encontró el formulario de este ticket.', ephemeral: true }).catch(() => {});
                }

                const v = guildManager.resolveGuildVisuals(interaction.guild.id);
                const logFields = (logDoc.formFields || []).length > 0
                    ? logDoc.formFields.map(f => ({
                        name: `📌 ${(f.label || 'Dato').slice(0, 240)}`,
                        value: `> ${(f.value || 'No especificado').slice(0, 980).replace(/\n/g, '\n> ')}`,
                        inline: false
                    }))
                    : [{ name: '📝 Respuestas Enviadas', value: '> *Sin datos de formulario registrados.*', inline: false }];

                const embed = new EmbedBuilder()
                    .setColor(v.color)
                    .setAuthor({ name: `FORMULARIO INICIAL • ${logDoc.ticketCode} | ${v.name}`, iconURL: v.logoUrl })
                    .setThumbnail(v.logoUrl)
                    .setTitle(`📋 Formulario enviado por ${logDoc.openerTag}`)
                    .setDescription(
                        `> 👤 **Usuario:** <@${logDoc.openerId}>\n` +
                        `> 📂 **Categoría:** \`${logDoc.categoryLabel}\`\n\u200B`
                    )
                    .addFields(...logFields)
                    .setFooter({ text: `${v.name} • Vuelve al registro automáticamente en 2 min` })
                    .setTimestamp();

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`tkt_log_view_${logDoc.logId}_0_all`)
                        .setLabel('Ver Conversación')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📖'),
                    new ButtonBuilder()
                        .setCustomId(`tkt_log_back_${logDoc.logId}`)
                        .setLabel('Volver al Registro')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('↩️')
                );

                await interaction.editReply({
                    embeds: [embed],
                    components: [backRow]
                }).catch(e => console.error('❌ [TICKETS LOG FORM]:', e.message));

                scheduleLogRevert(interaction.message, interaction.guild, logDoc);
                return;
            }

            // J) BOTÓN "VOLVER AL REGISTRO" MANUAL (SIN ESPERAR LOS 2 MIN)
            if (interaction.isButton() && interaction.customId.startsWith('tkt_log_back_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede usar este botón.', ephemeral: true }).catch(() => {});
                }
                await interaction.deferUpdate().catch(() => {});
                clearLogRevertTimer(interaction.message?.id);

                const logId = interaction.customId.replace('tkt_log_back_', '');
                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.followUp({ content: '⚠️ No se encontró el registro original.', ephemeral: true }).catch(() => {});
                }

                const summary = buildTicketLogSummaryPayload(interaction.guild, logDoc);
                return interaction.editReply({
                    embeds: summary.embeds,
                    components: summary.components
                }).catch(e => console.error('❌ [TICKETS LOG BACK]:', e.message));
            }
        } catch (err) {
            console.error('⚠️ [TICKETS interactionCreate Error]:', err.message);
        }
    });

    // 3. AUTO-SINCRONIZACIÓN EN TIEMPO REAL DE PERMISOS DE CATEGORÍAS
    // Si en el futuro modificas los permisos de cualquier categoría de tickets en Discord,
    // el bot actualiza automáticamente los permisos de TODOS los tickets abiertos dentro de esa categoría
    // conservando siempre al creador del ticket y a los usuarios añadidos manualmente.
    client.on('channelUpdate', async (oldChannel, newChannel) => {
        try {
            if (!newChannel || !newChannel.guild || newChannel.type !== ChannelType.GuildCategory) return;

            const catIds = new Set(Object.values(getGuildTicketCategories(newChannel.guild)).filter(Boolean));
            if (!catIds.has(newChannel.id)) return;

            // Solo actuar si realmente cambiaron los permisos de la categoría
            if (serializeOverwrites(oldChannel) === serializeOverwrites(newChannel)) return;

            const childTickets = newChannel.guild.channels.cache.filter(
                c => c.type === ChannelType.GuildText && c.parentId === newChannel.id
            );
            if (childTickets.size === 0) return;

            let synced = 0;
            for (const [, ticketCh] of childTickets) {
                try {
                    const activeDoc = await fetchActiveTicket(newChannel.guild.id, ticketCh.id);
                    let openerId = activeDoc?.openerId || '';
                    if (!openerId && ticketCh.topic) {
                        const match = ticketCh.topic.match(/\((\d{17,20})\)/);
                        if (match) openerId = match[1];
                    }

                    // Conservar todos los permisos individuales de usuarios ya presentes en el ticket (creador + añadidos)
                    const extraMembers = [];
                    for (const ow of ticketCh.permissionOverwrites.cache.values()) {
                        if (ow.type === OverwriteType.Member && ow.id !== client.user.id) {
                            extraMembers.push({
                                id: ow.id,
                                type: OverwriteType.Member,
                                allow: ow.allow.bitfield,
                                deny: ow.deny.bitfield
                            });
                        }
                    }

                    const { permissionOverwrites } = buildCategoryInheritedOverwrites(
                        newChannel.guild,
                        newChannel,
                        openerId,
                        client.user.id,
                        extraMembers
                    );

                    await ticketCh.permissionOverwrites.set(
                        permissionOverwrites,
                        'Auto-sincronización de permisos de categoría de tickets'
                    ).catch(() => {});
                    synced++;
                } catch (e) { }
            }

            if (synced > 0) {
                guildManager.logGuild(newChannel.guild, '🔐', `Permisos de categoría "${newChannel.name}" sincronizados en ${synced} ticket(s) abierto(s)`);
            }
        } catch (err) {
            console.error('⚠️ [TICKETS channelUpdate Error]:', err.message);
        }
    });
}

module.exports = {
    initTicketSystem,
    TICKET_TYPES,
    getGuildTicketCategories,
    ticketLogSchema
};
