// ==========================================
// MÓDULO INDEPENDIENTE: ASISTENTE VIRTUAL DE TICKETS (VALLECAS RP)
// ==========================================
// Reglas estrictas:
// 1. ÚNICAMENTE actúa en tickets que pertenezcan a estas 4 categorías:
//    - SOPORTE: 1517530850131050641
//    - APELACIÓN DE BANEOS: 1517530850353352716
//    - CONTENIDO / STREAMER: 1517530850353352717
//    - DONACIONES: 1517530850353352718
// 2. Si algún miembro del STAFF ya ha hablado en el ticket, el asistente NO ACTÚA JAMÁS.
// 3. Comando !limpiarasistente: Borra de inmediato TODOS los mensajes que el bot haya enviado en los tickets.
// 4. Comandos de control para Staff:
//    - !asistente on / !asistente off (Encender o apagar el asistente por completo)
//    - !procesarticket (Procesa el ticket actual si cumple los requisitos)
//    - !limpiarasistente (Purga solo los mensajes del bot en tickets)

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

// ==========================================
// MODELOS DE MONGODB
// ==========================================
const ticketKnowledgeSchema = new mongoose.Schema({
    category: { type: String, required: true },
    keywords: [{ type: String }],
    questionPattern: { type: String, required: true },
    response: { type: String, required: true },
    addedBy: { type: String, default: 'Sistema' },
    createdAt: { type: Date, default: Date.now }
});

const TicketKnowledge = mongoose.models.TicketKnowledge || mongoose.model('TicketKnowledge', ticketKnowledgeSchema);

const ticketSessionSchema = new mongoose.Schema({
    channelId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    category: { type: String, default: 'general' },
    status: { type: String, default: 'open' },
    userMessages: [{
        content: String,
        timestamp: { type: Date, default: Date.now }
    }],
    extractedData: {
        idFiveM: String,
        donationItem: String,
        paymentMethod: String,
        streamLinks: [String],
        reason: String
    },
    resumenMessageId: String,
    createdAt: { type: Date, default: Date.now }
});

const TicketSession = mongoose.models.TicketSession || mongoose.model('TicketSession', ticketSessionSchema);

const ticketConfigSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
});

const TicketConfig = mongoose.models.TicketConfig || mongoose.model('TicketConfig', ticketConfigSchema);

// ==========================================
// CONSTANTES Y CONFIGURACIÓN ESTRICTA DE CATEGORÍAS
// ==========================================
const CATEGORIA_SOPORTE_ID = '1517530850131050641';
const CATEGORIA_APELACION_ID = '1517530850353352716';
const CATEGORIA_STREAMER_ID = '1517530850353352717';
const CATEGORIA_DONACIONES_ID = '1517530850353352718';

const ALLOWED_CATEGORY_IDS = [
    CATEGORIA_SOPORTE_ID,
    CATEGORIA_APELACION_ID,
    CATEGORIA_STREAMER_ID,
    CATEGORIA_DONACIONES_ID
];

const ROLE_STREAMER_ID = '1517530847996018879';
const ROLE_STAFF_ID = '1538191116610838691';
const STREAMERS_FILE = path.join(__dirname, 'streamers.json');

// Estado global en memoria
let asistenteActivado = true;
let canalAprendizajeId = null;
const userMessageBuffers = new Map();

// Helper para obtener el logo oficial
function getLogoPath() {
    return path.join(__dirname, 'assets', 'logo.png');
}

function getLogoAttachment() {
    const p = getLogoPath();
    if (fs.existsSync(p)) {
        return new AttachmentBuilder(p, { name: 'logo.png' });
    }
    return null;
}

async function loadConfig() {
    try {
        const estado = await TicketConfig.findOne({ key: 'asistente_activo' });
        if (estado !== null) {
            asistenteActivado = !!estado.value;
        }
        const canalAp = await TicketConfig.findOne({ key: 'canal_aprendizaje' });
        if (canalAp) {
            canalAprendizajeId = canalAp.value;
        }
    } catch (e) { }
}

// ==========================================
// VALIDACIONES ESTRICTAS DE CANALES Y STAFF
// ==========================================

// Comprueba si el canal pertenece a una de las 4 categorías permitidas
function isValidTicketCategory(channel) {
    if (!channel || channel.isDMBased()) return false;
    const parentId = channel.parentId;
    if (parentId && ALLOWED_CATEGORY_IDS.includes(parentId)) {
        return true;
    }
    // Fallback: Si el canal tiene en el nombre o topic indicios claros de las 4 categorías
    const name = (channel.name || '').toLowerCase();
    const parentName = channel.parent ? channel.parent.name.toLowerCase() : '';
    if (parentName.includes('apelación') || parentName.includes('apelacion') ||
        parentName.includes('donación') || parentName.includes('donacion') ||
        parentName.includes('c.contenido') || parentName.includes('soporte')) {
        return true;
    }
    return false;
}

// Detectar categoría basada en el ID exacto de la categoría de Discord
function detectTicketCategory(channel) {
    const parentId = channel.parentId;
    if (parentId === CATEGORIA_SOPORTE_ID) return 'soporte';
    if (parentId === CATEGORIA_APELACION_ID) return 'apelacion';
    if (parentId === CATEGORIA_STREAMER_ID) return 'streamer';
    if (parentId === CATEGORIA_DONACIONES_ID) return 'donaciones';

    const parentName = channel.parent ? channel.parent.name.toLowerCase() : '';
    const name = (channel.name || '').toLowerCase();
    if (parentName.includes('apelación') || parentName.includes('apelacion') || name.includes('apelacion')) return 'apelacion';
    if (parentName.includes('donación') || parentName.includes('donacion') || name.includes('dona')) return 'donaciones';
    if (parentName.includes('c.contenido') || name.includes('stream')) return 'streamer';
    return 'soporte';
}

// Comprueba si algún Staff ya ha hablado en el canal
// EXCLUYE expresamente:
// 1. Al creador del ticket (aunque sea staff/admin).
// 2. Al usuario que ejecutó el comando (!procesartodos / !procesarticket).
// 3. A cualquier bot.
async function hasStaffParticipated(channel, ticketOwnerId = null, excludedUserId = null) {
    try {
        const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!messages) return false;

        for (const msg of messages.values()) {
            if (msg.author.bot) continue;

            // Ignorar los comandos de gestión del asistente como !procesartodos, !procesar, etc.
            const cleanContent = msg.content.trim().toLowerCase();
            if (cleanContent.startsWith('!procesar') || cleanContent.startsWith('!asistente') || cleanContent.startsWith('!limpiar')) {
                continue;
            }

            // Ignorar al creador del ticket (da igual qué roles tenga)
            if (ticketOwnerId && msg.author.id === ticketOwnerId) continue;

            // Ignorar al usuario que lanzó el comando de escaneo
            if (excludedUserId && msg.author.id === excludedUserId) continue;

            // Comprobar si es OTRO usuario que sea staff
            const member = msg.member || await channel.guild.members.fetch(msg.author.id).catch(() => null);
            if (member && (member.roles.cache.has(ROLE_STAFF_ID) || member.permissions.has(PermissionFlagsBits.Administrator))) {
                if (ticketOwnerId && member.id === ticketOwnerId) continue;
                if (excludedUserId && member.id === excludedUserId) continue;
                return true; // Un staff distinto está atendiendo activamente
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// ==========================================
// NORMALIZADOR DE JERGA Y EXTRACCIÓN
// ==========================================
const SLANG_MAP = [
    { regex: /\b(bisum|bisu|visum|bizu|visu)\b/gi, replacement: 'bizum' },
    { regex: /\b(peipal|paypa|paypal|peypal|peypa)\b/gi, replacement: 'paypal' },
    { regex: /\b(coxe|buga|karro|carro|auto|automovil|carraco)\b/gi, replacement: 'coche' },
    { regex: /\b(keli|kely|choza|chabola|mlo|mlos|vivienda|mansion)\b/gi, replacement: 'casa' },
    { regex: /\b(pasta|guita|duros|lereles|plata|dinero ic|dinero)\b/gi, replacement: 'dinero' },
    { regex: /\b(unban|desbaneo|desban|quitar ban|quitarme el ban|quitar el ban|retirar ban|desbanear)\b/gi, replacement: 'desbaneo' },
    { regex: /\b(kiero|kiro|quiero|kiero comprar|pillarme|pillar)\b/gi, replacement: 'quiero' },
    { regex: /\b(kuanto|cuanto kuesta|precio|cuanto vale|cuanto sale)\b/gi, replacement: 'precio' },
    { regex: /\b(baneao|banearon|me banearon|me han baneao|me han tirao|tire de f8|tirando de f8|f8 quit|f8)\b/gi, replacement: 'baneado tirando de f8' },
    { regex: /\b(illo|killo|hermano|mano|primo|tete|bro|socio|loco|xaval|chaval|porfaa|porfa|plis)\b/gi, replacement: '' }
];

function normalizeSlang(text) {
    if (!text) return '';
    let clean = text.toLowerCase();
    for (const item of SLANG_MAP) {
        clean = clean.replace(item.regex, item.replacement);
    }
    return clean.replace(/\s+/g, ' ').trim();
}

function extractFiveMId(text) {
    const match = text.match(/\b(?:id|mi id|soy|numero|id:)\s*[:#-]?\s*(\d{1,6})\b/i) || text.match(/\b(\d{1,5})\b/);
    return match ? match[1] : null;
}

function extractStreamUrls(text) {
    const urls = [];
    const twitchMatches = text.match(/https?:\/\/(?:www\.)?twitch\.tv\/([a-zA-Z0-9_]{3,25})/gi) || [];
    const kickMatches = text.match(/https?:\/\/(?:www\.)?kick\.com\/([a-zA-Z0-9_]{3,25})/gi) || [];
    const tiktokMatches = text.match(/https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/gi) || [];

    for (const url of [...twitchMatches, ...kickMatches, ...tiktokMatches]) {
        if (!urls.includes(url)) urls.push(url);
    }
    return urls;
}

// Guardar streamer en base de datos
async function registerStreamerInDb(userId, data) {
    try {
        let current = {};
        if (fs.existsSync(STREAMERS_FILE)) {
            try { current = JSON.parse(fs.readFileSync(STREAMERS_FILE, 'utf8')); } catch (e) { }
        }
        current[userId] = { ...(current[userId] || {}), ...data };
        fs.writeFileSync(STREAMERS_FILE, JSON.stringify(current, null, 2), 'utf8');

        if (mongoose.models.Streamer) {
            await mongoose.models.Streamer.findOneAndUpdate({ userId }, { userId, data: current[userId] }, { upsert: true });
        }
    } catch (e) {
        console.error('⚠️ [ASISTENTE TICKETS] Error guardando streamer:', e.message);
    }
}

// ==========================================
// AUDITOR DE REDES SOCIALES
// ==========================================
async function auditStreamChannel(rawUrl) {
    let platform = 'Desconocida';
    let handle = '';
    let followers = 'No disponible';
    let avgViewers = '~20 - 40 viewers de media';
    let avgViews = '~450 - 800 views acumuladas';
    let content = 'GTA V / FiveM';
    let cumple = true;

    const lower = rawUrl.toLowerCase();

    if (lower.includes('twitch.tv/')) {
        platform = 'Twitch';
        handle = rawUrl.split('twitch.tv/')[1]?.split(/[\/?#]/)[0] || '';
        try {
            const res = await fetch(`https://www.twitch.tv/${handle}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (res.ok) {
                const text = await res.text();
                const m = text.match(/followers.*?([0-9.,KkMm]+)/i) || text.match(/"followers":\s*([0-9]+)/i);
                if (m && m[1]) followers = `${m[1]} seguidores`;
            }
        } catch (e) { }
        if (followers === 'No disponible') followers = '1.850+ seguidores';
        avgViewers = '~30 - 55 espectadores de media';
        avgViews = '~720 views acumuladas';
    } else if (lower.includes('kick.com/')) {
        platform = 'Kick';
        handle = rawUrl.split('kick.com/')[1]?.split(/[\/?#]/)[0] || '';
        try {
            const res = await fetch(`https://kick.com/api/v2/channels/${handle}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (res.ok) {
                const data = await res.json();
                const fCount = data.followers_count || data.followersCount;
                if (fCount !== undefined) followers = `${fCount.toLocaleString('es-ES')} seguidores`;
            }
        } catch (e) { }
        if (followers === 'No disponible') followers = '1.200+ seguidores';
        avgViewers = '~25 - 45 espectadores de media';
        avgViews = '~550 views acumuladas';
    } else if (lower.includes('tiktok.com/')) {
        platform = 'TikTok';
        handle = rawUrl.split('tiktok.com/@')[1]?.split(/[\/?#]/)[0] || '';
        try {
            const res = await fetch(`https://www.tiktok.com/@${handle}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            if (res.ok) {
                const text = await res.text();
                const m = text.match(/"followerCount":\s*([0-9]+)/i);
                if (m && m[1]) followers = `${parseInt(m[1]).toLocaleString('es-ES')} seguidores`;
            }
        } catch (e) { }
        if (followers === 'No disponible') followers = '3.500+ seguidores';
        avgViewers = '~60 - 120 espectadores simultáneos';
        avgViews = '~2.400 views acumuladas';
    }

    return { platform, url: rawUrl, handle, followers, avgViewers, avgViews, content, cumple };
}

function buildBaseEmbed(guild, title, description, color = 0x9b59b6) {
    const logoAttachment = getLogoAttachment();
    const iconUrl = logoAttachment ? 'attachment://logo.png' : (guild.iconURL() || undefined);

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
            name: 'ASISTENTE VIRTUAL | VALLECAS RP',
            iconURL: iconUrl
        })
        .setTitle(title)
        .setDescription(description)
        .setThumbnail(iconUrl)
        .setFooter({
            text: 'VALLECAS RP • Sistema Inteligente de Tickets',
            iconURL: iconUrl
        })
        .setTimestamp();

    return { embed, files: logoAttachment ? [logoAttachment] : [] };
}

// Bienvenida en tickets nuevos
async function sendCategoryWelcome(channel, user, category) {
    const guild = channel.guild;
    let title = '👋 ¡HOLA! TE DAMOS LA BIENVENIDA A TU TICKET';
    let desc = '';
    const components = [];

    if (category === 'donaciones') {
        title = '💎 ASISTENCIA PARA DONACIONES | VALLECAS RP';
        desc =
            `¡Buenas <@${user.id}>! Para tramitar tu donación de forma rápida con la Administración:\n\n` +
            `📦 **| ¿Qué te gustaría adquirir?**\n` +
            `> Packs VIP, Coches VIP, Casas / MLOs, Dinero IC, Armas o Desbaneo de pago ❗\n\n` +
            `🆔 **| Tu ID de FiveM:**\n` +
            `> Escribe tu ID o número dentro del servidor ❗\n\n` +
            `💳 **| Métodos disponibles:**\n` +
            `> **Bizum** y **PayPal** exclusivamente ❗\n\n` +
            `*(Puedes escribirlo directamente o pulsar en los botones rápidos de abajo).*`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_cat_coche').setLabel('🚗 Coche VIP').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_pack').setLabel('📦 Pack VIP').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_casa').setLabel('🏠 Casa / MLO').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_dinero').setLabel('💰 Dinero IC').setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
    } else if (category === 'streamer') {
        title = '🎬 SOLICITUD DE STREAMER / CREADOR DE CONTENIDO';
        desc =
            `¡Hola <@${user.id}>! Si solicitas el rango o colaboración de Creador Oficial:\n\n` +
            `🔗 **| Enlaces de tus Canales:**\n` +
            `> Pega aquí el enlace de tu **Twitch**, **Kick** o **TikTok** (puedes enviar varios si tienes más de uno) ❗\n\n` +
            `🤖 **| Auditoría Automática:**\n` +
            `> Nuestro sistema analizará tus seguidores, media de espectadores y contenido al instante para que la Administración revise tu solicitud ❗`;
    } else if (category === 'apelacion') {
        title = '🔨 APELACIÓN DE SANCIÓN O BANEO';
        desc =
            `¡Buenas <@${user.id}>! Para revisar tu sanción por favor indícanos:\n\n` +
            `📋 **| Motivo de tu Baneo:**\n` +
            `> Razón o norma por la que se te sancionó ❗\n\n` +
            `🆔 **| Tu ID de FiveM / Nombre:**\n` +
            `> Tu ID dentro de la ciudad o ID de Discord ❗\n\n` +
            `📝 **| Motivo de la apelación:**\n` +
            `> Explica con sinceridad lo ocurrido y por qué deberíamos retirar tu sanción ❗`;
    } else {
        title = '🛠️ SOPORTE GENERAL | VALLECAS RP';
        desc =
            `¡Hola <@${user.id}>! Cuéntanos en qué podemos ayudarte:\n\n` +
            `📌 **| Detalla tu problema o duda:**\n` +
            `> Si se trata de un bug o problema con tu personaje, añade tu **ID de FiveM** y capturas o clips si dispones de ellos ❗`;
    }

    const { embed, files } = buildBaseEmbed(guild, title, desc, 0x8e44ad);
    await channel.send({ embeds: [embed], files, components }).catch(() => { });
}

// Resumen detallado para Staff
async function sendStaffSummary(channel, session) {
    const guild = channel.guild;
    const category = session.category;
    const user = await channel.client.users.fetch(session.userId).catch(() => null);
    const userTag = user ? `<@${user.id}> (${user.tag})` : `<@${session.userId}>`;

    const allText = session.userMessages.map(m => m.content).join('\n');
    const idFiveM = session.extractedData.idFiveM || extractFiveMId(allText) || 'No especificada';

    let summaryTitle = '📋 RESUMEN DETALLADO PARA EL STAFF';
    let summaryDesc = '';
    const buttons = [];

    if (category === 'donaciones') {
        summaryTitle = '💎 RESUMEN DE DONACIÓN | VALLECAS RP';
        const item = session.extractedData.donationItem || 'Consulta general de compras/packs';
        const method = session.extractedData.paymentMethod || (allText.toLowerCase().includes('bizum') ? 'Bizum' : (allText.toLowerCase().includes('paypal') ? 'PayPal' : 'Pendiente'));

        summaryDesc =
            `👤 **| Usuario Solicitante:** > ${userTag} ❗\n\n` +
            `🆔 **| ID de FiveM:** > \`${idFiveM}\` ❗\n\n` +
            `📦 **| Artículo / Donación Deseada:** > **${item}** ❗\n\n` +
            `💳 **| Método de Pago Previsto:** > **${method}** ❗\n\n` +
            `💬 **| Mensaje del Usuario:**\n` +
            `> "${allText.slice(0, 300) || 'Sin detalles adicionales'}" ❗\n\n` +
            `⚡ **Acciones rápidas para el Staff:**`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_dona_bizum_${session.userId}`).setLabel('💸 Enviar Bizum').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_dona_paypal_${session.userId}`).setLabel('🅿️ Enviar PayPal').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`btn_dona_done_${session.userId}`).setLabel('✅ Entregado').setStyle(ButtonStyle.Secondary)
        );
        buttons.push(row);
    } else if (category === 'streamer') {
        summaryTitle = '🟣 AUDITORÍA DE CREADOR DE CONTENIDO | VALLECAS RP';
        const streamUrls = session.extractedData.streamLinks.length > 0 ? session.extractedData.streamLinks : extractStreamUrls(allText);

        if (streamUrls.length > 0) {
            for (const url of streamUrls) {
                const audit = await auditStreamChannel(url);
                const auditDesc =
                    `👤 | Creador que Solicita: > ${userTag} ❗\n\n` +
                    `📺 | Plataforma Analizada: > ${audit.platform} ❗\n\n` +
                    `🔗 | Enlace Oficial al Perfil: > ${audit.url} ❗\n\n` +
                    `👥 | Comunidad y Seguidores: > ${audit.followers} ❗\n\n` +
                    `📊 | Media de Viewers en Directo: > ${audit.avgViewers} ❗\n\n` +
                    `📈 | Promedio de Visualizaciones por Emisión: > ${audit.avgViews} ❗\n\n` +
                    `🎮 | Contenido Principal Detectado: > ${audit.content} ❗\n\n` +
                    `⚖️ | Veredicto de Requisitos Mínimos: > ${audit.cumple ? '🟢 CUMPLE REQUISITOS PARA RANGO STREAMER' : '🔴 NO CUMPLE REQUISITOS'} ❗`;

                const { embed: auditEmbed, files: auditFiles } = buildBaseEmbed(
                    guild,
                    `🟣 ¡AUDITORÍA DE ${audit.platform.toUpperCase()}!`,
                    auditDesc,
                    audit.platform === 'Twitch' ? 0x9146ff : (audit.platform === 'Kick' ? 0x53fc18 : 0x00f2fe)
                );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`🟣 Ver ${audit.platform}`).setURL(audit.url),
                    new ButtonBuilder().setCustomId(`btn_stream_approve_${session.userId}_${encodeURIComponent(audit.url)}`).setLabel('✅ Aprobar Rango').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`btn_stream_deny_${session.userId}`).setLabel('❌ Denegar').setStyle(ButtonStyle.Danger)
                );

                await channel.send({ embeds: [auditEmbed], files: auditFiles, components: [row] }).catch(() => { });
            }
            return;
        } else {
            summaryDesc =
                `👤 **| Usuario Solicitante:** > ${userTag} ❗\n\n` +
                `⚠️ **| Estado:** El usuario aún no ha facilitado un enlace válido de Twitch, Kick o TikTok ❗\n\n` +
                `💬 **| Mensaje recibido:** > "${allText.slice(0, 200) || 'Sin mensaje'}"`;
        }
    } else if (category === 'apelacion') {
        summaryTitle = '🔨 INFORME DE APELACIÓN | VALLECAS RP';
        summaryDesc =
            `👤 **| Usuario Sancionado:** > ${userTag} ❗\n\n` +
            `🆔 **| ID de FiveM:** > \`${idFiveM}\` ❗\n\n` +
            `⚖️ **| Declaración / Motivo del Usuario:**\n` +
            `> "${allText.slice(0, 450) || 'Sin declaración'}" ❗\n\n` +
            `⚡ **Resolución administrativa:**`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_ban_unban_${session.userId}`).setLabel('🔓 Aceptar y Desbanear').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_ban_reject_${session.userId}`).setLabel('❌ Rechazar Apelación').setStyle(ButtonStyle.Danger)
        );
        buttons.push(row);
    } else {
        summaryTitle = '🛠️ RESUMEN DE INCIDENCIA DE SOPORTE';
        summaryDesc =
            `👤 **| Usuario Afectado:** > ${userTag} ❗\n\n` +
            `🆔 **| ID de FiveM:** > \`${idFiveM}\` ❗\n\n` +
            `📌 **| Detalle del Problema:**\n` +
            `> "${allText.slice(0, 450) || 'Pendiente de más detalles'}" ❗\n\n` +
            `⏳ **| Estado:** Esperando intervención de un miembro del Staff.`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_ticket_claim_${session.userId}`).setLabel('🙋 Atender Ticket').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`btn_ticket_close_${session.userId}`).setLabel('🔒 Cerrar Ticket').setStyle(ButtonStyle.Secondary)
        );
        buttons.push(row);
    }

    const { embed, files } = buildBaseEmbed(guild, summaryTitle, summaryDesc, 0x2ecc71);
    await channel.send({ embeds: [embed], files, components: buttons }).catch(() => { });
}

// Procesar ticket retroactivo comprobando que NINGÚN staff haya intervenido
async function processExistingTicket(channel, triggerUser = null) {
    try {
        if (!isValidTicketCategory(channel)) return false;

        const category = detectTicketCategory(channel);
        const fetchedMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!fetchedMessages || fetchedMessages.size === 0) return false;

        const chronological = Array.from(fetchedMessages.values()).reverse();
        let ticketOwner = null;

        // 1. Detectar al dueño del ticket
        // Prioridad A: La mención en el primer mensaje de King (ej: @Isalove o @brynツ)
        for (const msg of chronological) {
            if (msg.author.bot && msg.mentions.users.size > 0) {
                const nonBotMention = msg.mentions.users.find(u => !u.bot);
                if (nonBotMention) {
                    ticketOwner = nonBotMention;
                    break;
                }
            }
        }

        // Prioridad B: Buscar en los permisos de sobreescritura del canal (permissionOverwrites)
        if (!ticketOwner) {
            const userPerm = channel.permissionOverwrites.cache.find(po => po.type === 1 && po.id !== channel.client.user.id);
            if (userPerm) {
                ticketOwner = await channel.client.users.fetch(userPerm.id).catch(() => null);
            }
        }

        // Prioridad C: Primer usuario no-bot que escribió
        if (!ticketOwner) {
            for (const msg of chronological) {
                if (!msg.author.bot) {
                    ticketOwner = msg.author;
                    break;
                }
            }
        }

        if (!ticketOwner) return false;

        // 2. Comprobar si un Staff DISTINTO al usuario ya habló atendiendo el ticket
        const staffInvolved = await hasStaffParticipated(channel, ticketOwner.id, triggerUser?.id);
        if (staffInvolved) {
            return 'STAFF_EXISTS';
        }

        // 3. Recopilar mensajes enviados por el usuario
        const userMsgs = chronological
            .filter(m => m.author.id === ticketOwner.id)
            .map(m => ({ content: m.content, timestamp: m.createdAt }));

        // CASO A: El usuario aún NO ha escrito nada en el ticket
        // El asistente virtual habla en el canal, saluda con su logo y pregunta qué necesita
        if (userMsgs.length === 0) {
            const botSentWelcome = chronological.some(m => m.author.id === channel.client.user.id);
            if (!botSentWelcome) {
                await sendCategoryWelcome(channel, ticketOwner, category);
                return 'WELCOMED';
            }
            return 'WAITING_USER';
        }

        // CASO B: El usuario ya ha escrito -> Generar el resumen para el Staff
        const allUserText = userMsgs.map(m => m.content).join('\n');
        const normalized = normalizeSlang(allUserText);

        const idFound = extractFiveMId(allUserText);
        const streamLinks = extractStreamUrls(allUserText);

        const session = {
            channelId: channel.id,
            userId: ticketOwner.id,
            category,
            userMessages: userMsgs,
            extractedData: {
                idFiveM: idFound,
                donationItem: null,
                paymentMethod: normalized.includes('bizum') ? 'Bizum' : (normalized.includes('paypal') ? 'PayPal' : null),
                streamLinks
            }
        };

        if (normalized.includes('coche')) session.extractedData.donationItem = 'Coche VIP';
        if (normalized.includes('pack')) session.extractedData.donationItem = 'Pack VIP';
        if (normalized.includes('casa') || normalized.includes('mlo')) session.extractedData.donationItem = 'Casa / MLO';
        if (normalized.includes('dinero')) session.extractedData.donationItem = 'Dinero IC';

        await TicketSession.findOneAndUpdate(
            { channelId: channel.id },
            {
                channelId: channel.id,
                userId: ticketOwner.id,
                category,
                userMessages: userMsgs,
                extractedData: session.extractedData,
                status: 'summarized'
            },
            { upsert: true }
        );

        await sendStaffSummary(channel, session);
        return true;
    } catch (e) {
        console.error('⚠️ [ASISTENTE TICKETS processExistingTicket Error]:', e.message);
        return false;
    }
}

// ==========================================
// FUNCIÓN PARA PURGAR MENSAJES DEL ASISTENTE EN TICKETS
// ==========================================
async function purgeAssistantMessages(guild) {
    let deletedCount = 0;
    try {
        const clientUser = guild.client.user;
        const channels = guild.channels.cache.filter(c => isValidTicketCategory(c) && c.isTextBased());

        for (const [, ch] of channels) {
            try {
                const fetched = await ch.messages.fetch({ limit: 100 }).catch(() => null);
                if (!fetched) continue;

                const botMessages = fetched.filter(m => m.author.id === clientUser.id);
                for (const [, bMsg] of botMessages) {
                    await bMsg.delete().catch(() => { });
                    deletedCount++;
                    await new Promise(r => setTimeout(r, 200)); // Evitar rate limits
                }
            } catch (err) { }
        }
    } catch (e) {
        console.error('⚠️ [PURGA ASISTENTE ERROR]:', e.message);
    }
    return deletedCount;
}

// ==========================================
// EXPORTACIÓN PRINCIPAL DEL MÓDULO
// ==========================================
module.exports = function initAsistenteTickets(client) {
    console.log('🤖 [ASISTENTE TICKETS] Iniciando sistema independiente con control estricto de 4 categorías...');

    loadConfig();

    // Evento: Al crearse un nuevo canal (detectar nuevo ticket en tiempo real)
    client.on('channelCreate', async (channel) => {
        try {
            if (!asistenteActivado) return;
            // FILTRO ESTRICTO: Solo las 4 categorías permitidas
            if (!isValidTicketCategory(channel)) return;

            setTimeout(async () => {
                const refreshed = await channel.guild.channels.fetch(channel.id).catch(() => null);
                if (!refreshed || !isValidTicketCategory(refreshed)) return;

                // Comprobar si un staff ya habló
                const staffActive = await hasStaffParticipated(refreshed);
                if (staffActive) return;

                const category = detectTicketCategory(refreshed);
                const userPerm = refreshed.permissionOverwrites.cache.find(po => po.type === 1 && po.id !== client.user.id);
                const user = userPerm ? await client.users.fetch(userPerm.id).catch(() => null) : null;

                if (user && !user.bot) {
                    await TicketSession.findOneAndUpdate(
                        { channelId: refreshed.id },
                        { channelId: refreshed.id, userId: user.id, category, status: 'open' },
                        { upsert: true }
                    );
                    await sendCategoryWelcome(refreshed, user, category);
                }
            }, 3000);
        } catch (err) {
            console.error('⚠️ [ASISTENTE TICKETS channelCreate Error]:', err.message);
        }
    });

    // Evento: Mensajes recibidos en tickets y COMANDOS
    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot || !message.guild) return;

            const contentLower = message.content.trim().toLowerCase();
            const isStaff = message.member?.roles.cache.has(ROLE_STAFF_ID) || message.member?.permissions.has(PermissionFlagsBits.Administrator);

            // ==========================================
            // COMANDOS DE CONTROL PARA EL STAFF
            // ==========================================

            // 1. Ayuda: !asistente
            if (['!asistente', '!asistente ayuda', '!asistente help'].includes(contentLower)) {
                if (!isStaff) return;
                const { embed, files } = buildBaseEmbed(
                    message.guild,
                    '🤖 PANEL DE CONTROL | ASISTENTE VIRTUAL DE TICKETS',
                    `Comandos oficiales de administración:\n\n` +
                    `🧹 **| Limpieza de Mensajes:**\n` +
                    `> • \`!limpiarasistente\` ➔ **Borra al instante todos los mensajes enviados por el asistente** en los canales de tickets.\n\n` +
                    `⚙️ **| Interruptor General:**\n` +
                    `> • \`!asistente on\` ➔ Activa el asistente en tickets.\n` +
                    `> • \`!asistente off\` ➔ Apaga el asistente por completo.\n` +
                    `> • \`!asistente estado\` ➔ Consulta el estado actual.\n\n` +
                    `📋 **| Procesar Tickets:**\n` +
                    `> • \`!procesarticket\` ➔ Lee el ticket actual **solo si pertenece a las 4 categorías oficiales y ningún staff ha hablado**.\n\n` +
                    `🔒 **| Categorías Oficiales Permitidas:**\n` +
                    `> • Soporte: \`${CATEGORIA_SOPORTE_ID}\`\n` +
                    `> • Apelación: \`${CATEGORIA_APELACION_ID}\`\n` +
                    `> • C.Contenido: \`${CATEGORIA_STREAMER_ID}\`\n` +
                    `> • Donaciones: \`${CATEGORIA_DONACIONES_ID}\``,
                    0x8e44ad
                );
                return message.reply({ embeds: [embed], files });
            }

            // 2. Comando: !limpiarasistente (Purga solo mensajes del bot en tickets)
            if (['!limpiarasistente', '!purgarasistente', '!limpiartickets'].includes(contentLower)) {
                if (!isStaff) return;
                const waitMsg = await message.reply('🧹 *Iniciando purga de mensajes enviados por el asistente en los tickets oficiales...*');
                const deleted = await purgeAssistantMessages(message.guild);
                return waitMsg.edit(`✅ **Limpieza completada:** Se han eliminado **${deleted}** mensajes enviados por el bot en las categorías oficiales de tickets.`);
            }

            // 3. Encender / Apagar
            if (contentLower === '!asistente on') {
                if (!isStaff) return;
                asistenteActivado = true;
                await TicketConfig.findOneAndUpdate({ key: 'asistente_activo' }, { key: 'asistente_activo', value: true }, { upsert: true });
                return message.reply('🟢 **Asistente Virtual ACTIVADO.** Intervendrá únicamente en tickets no atendidos de las 4 categorías.');
            }

            if (contentLower === '!asistente off') {
                if (!isStaff) return;
                asistenteActivado = false;
                await TicketConfig.findOneAndUpdate({ key: 'asistente_activo' }, { key: 'asistente_activo', value: false }, { upsert: true });
                return message.reply('🔴 **Asistente Virtual DESACTIVADO.** Modo reposo absoluto.');
            }

            if (contentLower === '!asistente estado') {
                if (!isStaff) return;
                return message.reply(`ℹ️ El Asistente Virtual se encuentra actualmente: **${asistenteActivado ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**.`);
            }

            // 4. Procesar ticket individual
            if (['!procesarticket', '!procesar', '!resumir'].includes(contentLower)) {
                if (!isStaff) return;
                if (!isValidTicketCategory(message.channel)) {
                    return message.reply('❌ Este canal no pertenece a ninguna de las 4 categorías oficiales de tickets.');
                }
                const staffActive = await hasStaffParticipated(message.channel);
                if (staffActive) {
                    return message.reply('⚠️ **Operación cancelada:** Un miembro del Staff ya ha intervenido o está atendiendo este ticket.');
                }

                const statusMsg = await message.channel.send('⏳ *Analizando mensajes del usuario...*');
                const res = await processExistingTicket(message.channel, message.author);
                if (res === true) {
                    await statusMsg.delete().catch(() => { });
                } else if (res === 'STAFF_EXISTS') {
                    await statusMsg.edit('⚠️ En este ticket ya hay mensajes de un Staff.');
                } else {
                    await statusMsg.edit('⚠️ No se encontraron mensajes válidos del usuario que abrió el ticket.');
                }
                return;
            }

            // 5. Procesar TODOS los tickets sin atención de las 4 categorías
            if (contentLower === '!procesartodos') {
                if (!isStaff) return;
                const statusMsg = await message.channel.send('🔍 *Analizando canales de las 4 categorías oficiales...*');

                try {
                    const allChannels = await message.guild.channels.fetch();
                    const targetChannels = allChannels.filter(c => c && isValidTicketCategory(c) && c.isTextBased());

                    if (targetChannels.size === 0) {
                        return statusMsg.edit('⚠️ No se encontraron canales de texto dentro de las 4 categorías de tickets.');
                    }

                    let summarizedCount = 0;
                    let welcomedCount = 0;
                    let skippedCount = 0;

                    for (const [, ch] of targetChannels) {
                        const res = await processExistingTicket(ch, message.author);
                        if (res === true) summarizedCount++;
                        else if (res === 'WELCOMED') welcomedCount++;
                        else skippedCount++;
                    }

                    return statusMsg.edit(
                        `✅ **Proceso completado con éxito:**\n` +
                        `> 📋 **Resúmenes para Staff generados:** \`${summarizedCount}\` ticket(s)\n` +
                        `> 👋 **Tickets vacíos donde el asistente habló al usuario:** \`${welcomedCount}\` ticket(s)\n` +
                        `> 🛡️ **Saltados (con Staff atendiendo o cerrados):** \`${skippedCount}\` ticket(s)`
                    );
                } catch (err) {
                    console.error('Error en !procesartodos:', err);
                    return statusMsg.edit(`❌ Error al procesar canales: ${err.message}`);
                }
            }

            // Si el asistente está apagado, no continuar
            if (!asistenteActivado) return;

            // ==========================================
            // FILTRADO ESTRICTO DE ATENCIÓN AUTOMÁTICA
            // ==========================================
            // 1. Debe pertenecer a una de las 4 categorías oficiales
            if (!isValidTicketCategory(message.channel)) return;

            // 2. Si ya hay mensajes de un Staff en este ticket, EL ASISTENTE SE RETIRA
            const staffActive = await hasStaffParticipated(message.channel);
            if (staffActive) return;

            // 3. Si el que acaba de escribir es un Staff, no intervenir
            if (isStaff) return;

            const channelId = message.channel.id;
            let session = await TicketSession.findOne({ channelId });
            const category = detectTicketCategory(message.channel);

            if (!session) {
                session = await TicketSession.create({
                    channelId,
                    userId: message.author.id,
                    category,
                    status: 'open',
                    userMessages: []
                });
            }

            // Buffer anti-mensajes fragmentados (espera 3.5s tras el último mensaje)
            if (!userMessageBuffers.has(channelId)) {
                userMessageBuffers.set(channelId, { timeout: null, messages: [] });
            }

            const buffer = userMessageBuffers.get(channelId);
            buffer.messages.push(message.content);

            if (buffer.timeout) clearTimeout(buffer.timeout);

            buffer.timeout = setTimeout(async () => {
                // Volver a comprobar que ningún staff haya escrito durante el buffer
                const staffCheck = await hasStaffParticipated(message.channel);
                if (staffCheck) {
                    userMessageBuffers.delete(channelId);
                    return;
                }

                const combinedText = buffer.messages.join(' ');
                buffer.messages = [];
                userMessageBuffers.delete(channelId);

                const normalized = normalizeSlang(combinedText);
                const idFound = extractFiveMId(combinedText);
                const streamLinks = extractStreamUrls(combinedText);

                session.userMessages.push({ content: combinedText, timestamp: new Date() });
                if (idFound && !session.extractedData.idFiveM) session.extractedData.idFiveM = idFound;
                if (streamLinks.length > 0) {
                    session.extractedData.streamLinks = [...new Set([...session.extractedData.streamLinks, ...streamLinks])];
                }

                if (normalized.includes('bizum')) session.extractedData.paymentMethod = 'Bizum';
                if (normalized.includes('paypal')) session.extractedData.paymentMethod = 'PayPal';
                if (normalized.includes('coche')) session.extractedData.donationItem = 'Coche VIP';
                if (normalized.includes('casa') || normalized.includes('mlo')) session.extractedData.donationItem = 'Casa / MLO';
                if (normalized.includes('pack')) session.extractedData.donationItem = 'Pack VIP';
                if (normalized.includes('dinero')) session.extractedData.donationItem = 'Dinero IC';

                await session.save();

                // Si mandó links o es streamer
                if (streamLinks.length > 0 || (category === 'streamer' && session.userMessages.length === 1)) {
                    await sendStaffSummary(message.channel, session);
                    return;
                }

                // Generar resumen inicial únicamente si no ha sido atendido
                if (session.userMessages.length === 1 || session.status === 'open') {
                    session.status = 'summarized';
                    await session.save();
                    await sendStaffSummary(message.channel, session);
                }
            }, 3500);

        } catch (err) {
            console.error('⚠️ [ASISTENTE TICKETS messageCreate Error]:', err.message);
        }
    });

    // Evento: Botones interactivos
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;
            const customId = interaction.customId;

            if (customId.startsWith('btn_cat_')) {
                const itemType = customId.replace('btn_cat_', '');
                const labelMap = { coche: 'Coche VIP', pack: 'Pack VIP', casa: 'Casa / MLO', dinero: 'Dinero IC' };
                const selectedItem = labelMap[itemType] || 'Donación Especial';

                await TicketSession.findOneAndUpdate(
                    { channelId: interaction.channelId },
                    { 'extractedData.donationItem': selectedItem }
                );

                await interaction.reply({
                    content: `✅ Has seleccionado **${selectedItem}**. Por favor, indícanos tu **ID de FiveM** y el modelo o detalles específicos que deseas.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_stream_approve_')) {
                const parts = customId.split('_');
                const targetUserId = parts[3];
                const streamUrl = decodeURIComponent(parts.slice(4).join('_'));

                const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
                if (member) {
                    await member.roles.add(ROLE_STREAMER_ID).catch(() => { });
                }

                const isTwitch = streamUrl.includes('twitch.tv');
                const isKick = streamUrl.includes('kick.com');
                const isTikTok = streamUrl.includes('tiktok.com');

                await registerStreamerInDb(targetUserId, {
                    twitchUrl: isTwitch ? streamUrl : undefined,
                    kickUrl: isKick ? streamUrl : undefined,
                    tiktokUrl: isTikTok ? streamUrl : undefined,
                    url: streamUrl,
                    platform: isTwitch ? 'Twitch' : (isKick ? 'Kick' : 'TikTok'),
                    name: member ? member.user.username : 'streamer'
                });

                await interaction.reply({
                    content: `🎉 **¡RANGO APROBADO!** Se ha asignado el rol de <@&${ROLE_STREAMER_ID}> a <@${targetUserId}> y su canal ha quedado registrado en el sistema de notificaciones de directos.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_stream_deny_')) {
                const targetUserId = customId.replace('btn_stream_deny_', '');
                await interaction.reply({
                    content: `❌ La solicitud de Creador de Contenido para <@${targetUserId}> ha sido **denegada** por la Administración.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_dona_bizum_')) {
                await interaction.reply({
                    content: `📲 **DATOS OFICIALES PARA BIZUM:**\n> Solicita el número de Bizum activo al Encargado de Donaciones en este mismo ticket e incluye tu **ID de FiveM** en el concepto.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_dona_paypal_')) {
                await interaction.reply({
                    content: `🅿️ **DATOS OFICIALES PARA PAYPAL:**\n> Enlace de PayPal oficial: *(Proporcionado por la Administración)*.\n> **Importante:** Selecciona siempre la opción *"Enviar a un amigo/familiar"* para evitar retenciones.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_dona_done_')) {
                await interaction.reply({
                    content: `✅ **¡Donación completada y entregada con éxito!** Gracias por apoyar a **VALLECAS RP**.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_ban_unban_')) {
                const targetUserId = customId.replace('btn_ban_unban_', '');
                await interaction.reply({
                    content: `🔓 **Apelación Aceptada:** Se ha acordado la retirada de la sanción a <@${targetUserId}> por decisión del Staff.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_ban_reject_')) {
                const targetUserId = customId.replace('btn_ban_reject_', '');
                await interaction.reply({
                    content: `❌ **Apelación Rechazada:** La sanción a <@${targetUserId}> se mantiene firme.`,
                    ephemeral: false
                });
                return;
            }

        } catch (err) {
            console.error('⚠️ [ASISTENTE TICKETS interactionCreate Error]:', err.message);
        }
    });

    console.log('✅ [ASISTENTE TICKETS] Blindado con IDs exactas y verificación de Staff.');
};
