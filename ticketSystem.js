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
    PermissionFlagsBits
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
            { id: 'f1', label: 'Asunto o resumen del problema', placeholder: 'Ej: Problema con el inventario / duda normativa', style: TextInputStyle.Short, required: true, maxLength: 120 },
            { id: 'f2', label: 'ID de FiveM / Nombre IC (opcional)', placeholder: 'Ej: ID 45 / Carlos Mendoza', style: TextInputStyle.Short, required: false, maxLength: 80 },
            { id: 'f3', label: 'Explica detalladamente tu duda o problema', placeholder: 'Describe todo lo que ha ocurrido para poder ayudarte rápido...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
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
            { id: 'f1', label: 'Jugador(es) reportado(s) (ID / Discord)', placeholder: 'Ej: ID 128 o @usuario', style: TextInputStyle.Short, required: true, maxLength: 150 },
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
            { id: 'f3', label: 'ID de FiveM y detalles adicionales', placeholder: 'Indica tu ID y cualquier duda sobre tu donación...', style: TextInputStyle.Paragraph, required: false, maxLength: 800 }
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
            { id: 'f2', label: 'Usuario de Twitch / ID de FiveM', placeholder: 'Ej: twitch.tv/miusuario | ID 34', style: TextInputStyle.Short, required: true, maxLength: 120 },
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
            { id: 'f1', label: 'Nombre IC del personaje (y tipo: Voluntario/Forzado)', placeholder: 'Ej: Marcos Vega — CK Voluntario', style: TextInputStyle.Short, required: true, maxLength: 150 },
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
            { id: 'f2', label: 'ID de FiveM / Nombre de Steam o Discord', placeholder: 'Ej: ID 77 / MiUsuario', style: TextInputStyle.Short, required: true, maxLength: 100 },
            { id: 'f3', label: 'Motivo de la apelación y pruebas (si tienes)', placeholder: 'Explica tu versión de los hechos con respeto y claridad...', style: TextInputStyle.Paragraph, required: true, maxLength: 1000 }
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

function isGuildStaff(member) {
    if (!member || member.user?.bot) return false;
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? '1538191116610838691' : '');
    if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
    if (gCfg.ROLE_DIRECTIVA_ID && member.roles?.cache?.has(gCfg.ROLE_DIRECTIVA_ID)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
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
                { upsert: true, new: true }
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
function buildTicketPanelPayload(guild) {
    const v = guildManager.resolveGuildVisuals(guild?.id, 'tickets');
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `Soporte · ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle(`🎟️ Soporte · ${serverName}`)
        .setDescription(
            `¿Necesitas ayuda del staff? Elige el tipo de ticket en el menú de abajo y rellena el formulario.\n` +
            `Se abrirá un canal privado solo para ti y el equipo que lleva ese tema.\n\u200B`
        )
        .addFields(
            ...TICKET_TYPES.map(t => ({
                name: `${t.emoji} ${t.label}`,
                value: t.description,
                inline: true
            })),
            {
                name: '\u200B',
                value: `⚠️ **Abre solo un ticket por tema y no menciones al staff: ya les avisa el bot.**`,
                inline: false
            }
        )
        .setFooter({
            text: `${serverName} • Sistema Oficial de Tickets`,
            iconURL: iconUrl
        })
        .setTimestamp();

    if (v.bannerUrl) {
        embed.setImage(v.bannerUrl);
    }

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

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(menu)],
        files: [...v.files]
    };
}

function buildTicketWelcomeEmbed(guild, ticketData) {
    const v = guildManager.resolveGuildVisuals(guild?.id);
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;
    const tType = TICKET_TYPE_MAP.get(ticketData.categoryKey);
    const openedTs = Math.floor(new Date(ticketData.openedAt || Date.now()).getTime() / 1000);

    const formLines = (ticketData.formFields || [])
        .filter(f => f.value && f.value.trim())
        .map(f => `**${f.label}:**\n> ${f.value.trim().replace(/\n/g, '\n> ')}`)
        .join('\n\n');

    const claimedLine = ticketData.claimedById
        ? `🟢 **Atendido por:** <@${ticketData.claimedById}>`
        : `🟡 **Estado:** \`Esperando a un miembro del Staff\``;

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `${(tType?.label || ticketData.categoryLabel).toUpperCase()} | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle(`${tType?.emoji || '🎟️'} Ticket #${ticketData.ticketCode}`)
        .setDescription(
            `👋 Hola <@${ticketData.openerId}>, tu ticket de **${tType?.label || ticketData.categoryLabel}** ha sido abierto correctamente.\n` +
            `Un miembro del equipo de Staff te atenderá lo antes posible. *(Puedes subir capturas o pruebas directamente en este chat)*.\n\n` +
            `👤 **Usuario:** <@${ticketData.openerId}> (\`${ticketData.openerId}\`)\n` +
            `📅 **Abierto:** <t:${openedTs}:F> (<t:${openedTs}:R>)\n` +
            `${claimedLine}\n\n` +
            `────────────────────────────\n` +
            `📋 **DATOS DEL FORMULARIO:**\n\n` +
            `${formLines || '> *Sin datos adicionales.*'}`
        )
        .setFooter({
            text: `${serverName} • Expediente ${ticketData.ticketCode}`,
            iconURL: iconUrl
        })
        .setTimestamp();

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
            .map(p => `> ${p.isStaff ? '🛡️' : '👤'} <@${p.userId}> (\`${p.userTag}\`) — **${p.count}** msg(s)`)
            .join('\n')
        : '> *No hubo mensajes de usuarios en el ticket.*';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `REGISTRO DE TICKET CERRADO | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle(`${tType?.emoji || '📁'} Expediente cerrado: #${logDoc.ticketCode}`)
        .setDescription(
            `📂 **Categoría:** \`${logDoc.categoryLabel}\`\n` +
            `👤 **Abierto por:** <@${logDoc.openerId}> (\`${logDoc.openerTag}\`)\n` +
            `🙋 **Reclamado por:** ${logDoc.claimedById ? `<@${logDoc.claimedById}> (\`${logDoc.claimedByTag}\`)` : '`Sin reclamar`'}\n` +
            `🔒 **Cerrado por:** <@${logDoc.closedById}> (\`${logDoc.closedByTag}\`)\n\n` +
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
            `🔎 **Vista:** \`${filterLabel}\` • 💬 **Mostrando:** \`${filtered.length}\` mensaje(s)\n` +
            `────────────────────────────\n\n` +
            body
        )
        .setFooter({
            text: `${serverName} • Página ${safePage + 1} de ${totalPages} • Log ${logDoc.logId}`
        })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tkt_log_view_${logDoc.logId}_${Math.max(0, safePage - 1)}_${filterUserId}`)
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
            .setDisabled(safePage <= 0),
        new ButtonBuilder()
            .setCustomId(`tkt_log_page_info`)
            .setLabel(`Página ${safePage + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`tkt_log_view_${logDoc.logId}_${Math.min(totalPages - 1, safePage + 1)}_${filterUserId}`)
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➡️')
            .setDisabled(safePage >= totalPages - 1)
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

    return { embeds: [embed], components };
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
                    console.log(`🎟️ [TICKETS] Panel de soporte publicado en #${message.channel.name} (${message.guild.name}).`);
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

                const embed = new EmbedBuilder()
                    .setColor(v.color)
                    .setAuthor({ name: `CONFIGURACIÓN DE TICKETS | ${v.name}`, iconURL: v.logoUrl })
                    .setTitle('🎟️ Estado y Categorías del Sistema de Tickets')
                    .setDescription(
                        `📜 **Canal de Logs:** ${gCfg.CHANNEL_TICKETS_LOGS_ID ? `<#${gCfg.CHANNEL_TICKETS_LOGS_ID}>` : '❌ Sin configurar (`!setlogs-tickets #canal`)'}\n` +
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

            // A) MENÚ DESPLEGABLE: ABRIR MODAL PERSONALIZADO DEL TIPO DE TICKET
            if (interaction.isStringSelectMenu() && interaction.customId === 'tkt_open_select') {
                const selectedKey = interaction.values[0];
                const tType = TICKET_TYPE_MAP.get(selectedKey);
                if (!tType) return;

                // Comprobar si el usuario ya tiene un ticket abierto en ESTA misma categoría
                const cats = getGuildTicketCategories(interaction.guild);
                const targetCatId = cats[selectedKey];
                const models = getModelsForGuild(interaction.guild.id);
                let existingOpen = null;
                if (models) {
                    const userActives = await models.Active.find({ guildId: interaction.guild.id, openerId: interaction.user.id, categoryKey: selectedKey }).lean().catch(() => []);
                    for (const act of userActives) {
                        const stillExists = interaction.guild.channels.cache.get(act.channelId);
                        if (stillExists) {
                            existingOpen = stillExists;
                            break;
                        } else {
                            await models.Active.deleteOne({ channelId: act.channelId }).catch(() => {});
                        }
                    }
                }

                if (existingOpen) {
                    return interaction.reply({
                        content: `⚠️ **Ya tienes un ticket abierto de ${tType.emoji} ${tType.label}:** <#${existingOpen.id}>.\n*Por favor, utiliza ese canal o espera a que se cierre antes de abrir otro del mismo tema.*`,
                        ephemeral: true
                    }).catch(() => {});
                }

                if (!targetCatId) {
                    return interaction.reply({
                        content: `⚠️ La categoría para **${tType.label}** aún no está configurada en este servidor. Avisa a la Administración.`,
                        ephemeral: true
                    }).catch(() => {});
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

                // Permisos privados estrictos
                const permissionOverwrites = [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }
                ];

                const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(guild.id) ? '1538191116610838691' : '');
                const directivaRoleId = gCfg.ROLE_DIRECTIVA_ID || '';

                if (catKey === 'directiva' && directivaRoleId && guild.roles.cache.has(directivaRoleId)) {
                    permissionOverwrites.push({
                        id: directivaRoleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ManageMessages
                        ]
                    });
                } else if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
                    permissionOverwrites.push({
                        id: staffRoleId,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ManageMessages
                        ]
                    });
                }

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
                    formFields,
                    openedAt: new Date()
                };

                const { embed, files } = buildTicketWelcomeEmbed(guild, ticketData);
                const pingRole = (catKey === 'directiva' && directivaRoleId)
                    ? `<@&${directivaRoleId}>`
                    : (staffRoleId ? `<@&${staffRoleId}>` : '');

                const welcomeMsg = await channel.send({
                    content: `🔔 <@${interaction.user.id}> ${pingRole}`.trim(),
                    embeds: [embed],
                    components: [buildTicketControlRow(false)],
                    files
                }).catch(() => null);

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

                const vOk = guildManager.resolveGuildVisuals(guild.id);
                const okEmbed = new EmbedBuilder()
                    .setColor(vOk.color)
                    .setTitle(`${tType.emoji} ¡Ticket abierto correctamente!`)
                    .setDescription(`✅ Tu ticket **#${ticketCode}** ha sido creado en <#${channel.id}>.\n> *Haz clic en el canal para hablar con el equipo de Staff.*`)
                    .setFooter({ text: `${vOk.name} • Sistema Avanzado de Tickets` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [okEmbed] }).catch(() => {});
                setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
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

                    await interaction.channel.send({
                        content: `🙋 **Ticket reclamado:** <@${interaction.user.id}> se encargará de atender este ticket.`
                    }).catch(() => {});
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
                return interaction.reply({ content: `✅ <@${member.id}> ha sido añadido a este ticket por <@${interaction.user.id}>.` }).catch(() => {});
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
                return interaction.reply({ content: `✏️ Canal renombrado a **#${newName}** por <@${interaction.user.id}>.` }).catch(() => {});
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

                await interaction.editReply({
                    content: `🔒 **Ticket cerrado por <@${interaction.user.id}>.**\n> 📜 Registro guardado (${formattedMsgs.length} mensajes)${logsChannelId ? ` en <#${logsChannelId}>` : ''}.\n> ⏳ *Eliminando este canal en **5 segundos**...*`
                }).catch(() => {});

                setTimeout(async () => {
                    await channel.delete(`Ticket cerrado por ${interaction.user.tag}: ${closeReason}`).catch(() => {});
                    if (typeof client.notifyTicketMonitor === 'function') {
                        client.notifyTicketMonitor(guild.id);
                    }
                }, 5000);
                return;
            }

            // G) BOTONES DEL VISOR INTERACTIVO DE LOGS (SIN DESCARGAR .TXT)
            if (interaction.isButton() && interaction.customId.startsWith('tkt_log_view_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede inspeccionar los logs de tickets.', ephemeral: true }).catch(() => {});
                }
                const rest = interaction.customId.replace('tkt_log_view_', '');
                const parts = rest.split('_');
                const logId = parts[0];
                const page = parseInt(parts[1], 10) || 0;
                const filterUserId = parts.slice(2).join('_') || 'all';

                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.reply({ content: '⚠️ No se encontró el historial de este ticket en la base de datos.', ephemeral: true }).catch(() => {});
                }

                const payload = buildTranscriptViewerPayload(interaction.guild, logDoc, page, filterUserId);

                // Si el botón viene del mensaje efímero del visor -> actualizar en el sitio; si viene del canal de logs -> responder efímero
                if (interaction.message.flags?.has(64)) {
                    return interaction.update(payload).catch(() => {});
                }
                return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
            }

            // H) FILTRO POR PERSONA DENTRO DEL VISOR DE LOGS
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('tkt_log_filter_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el Staff puede filtrar logs.', ephemeral: true }).catch(() => {});
                }
                const logId = interaction.customId.replace('tkt_log_filter_', '');
                const selectedUser = interaction.values[0] || 'all';
                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.reply({ content: '⚠️ No se encontró el historial de este ticket.', ephemeral: true }).catch(() => {});
                }
                const payload = buildTranscriptViewerPayload(interaction.guild, logDoc, 0, selectedUser);
                return interaction.update(payload).catch(() => {});
            }

            // I) BOTÓN "VER FORMULARIO INICIAL" EN EL CANAL DE LOGS
            if (interaction.isButton() && interaction.customId.startsWith('tkt_log_form_')) {
                if (!isGuildStaff(interaction.member)) {
                    return interaction.reply({ content: '⛔ Solo el equipo de **Staff** puede ver los formularios archivados.', ephemeral: true }).catch(() => {});
                }
                const logId = interaction.customId.replace('tkt_log_form_', '');
                const logDoc = await fetchTicketLog(interaction.guild.id, logId);
                if (!logDoc) {
                    return interaction.reply({ content: '⚠️ No se encontró el formulario de este ticket.', ephemeral: true }).catch(() => {});
                }

                const v = guildManager.resolveGuildVisuals(interaction.guild.id);
                const fieldsText = (logDoc.formFields || []).length > 0
                    ? logDoc.formFields.map(f => `**${f.label}:**\n> ${(f.value || 'No especificado').replace(/\n/g, '\n> ')}`).join('\n\n')
                    : '*Sin datos de formulario registrados.*';

                const embed = new EmbedBuilder()
                    .setColor(v.color)
                    .setAuthor({ name: `FORMULARIO INICIAL • #${logDoc.ticketCode} | ${v.name}`, iconURL: v.logoUrl })
                    .setTitle(`📋 Formulario enviado por ${logDoc.openerTag}`)
                    .setDescription(
                        `👤 **Usuario:** <@${logDoc.openerId}> (\`${logDoc.openerId}\`)\n` +
                        `📂 **Categoría:** \`${logDoc.categoryLabel}\`\n\n` +
                        `────────────────────────────\n\n` +
                        fieldsText
                    )
                    .setFooter({ text: `${v.name} • Log ${logDoc.logId}` })
                    .setTimestamp();

                return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
            }
        } catch (err) {
            console.error('⚠️ [TICKETS interactionCreate Error]:', err.message);
        }
    });
}

module.exports = {
    initTicketSystem,
    TICKET_TYPES,
    getGuildTicketCategories,
    ticketLogSchema
};
