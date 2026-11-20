// ==========================================
// MÓDULO INDEPENDIENTE: DASHBOARDS EN VIVO DE SERVICIOS (VALLECAS RP)
// ==========================================
// Comandos disponibles (solo Staff):
//   - !panel-servicios  -> Estado general de todos los sistemas del bot (auto-actualiza cada 60s)
//   - !panel-locucion   -> Estado del sistema de locución, salas de soporte y motor de voz neuronal (auto-actualiza cada 30s)
//   - !panel-tickets    -> Monitor en tiempo real del asistente y categorías de tickets (auto-actualiza cada 60s)

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

const botSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const BotSetting = mongoose.models.BotSetting || mongoose.model('BotSetting', botSettingSchema);

const ROLE_STAFF_ID = '1538191116610838691';

// Canales de voz del sistema de locución
const CANAL_ESPERA_ID = '1517530849334136846';
const CANALES_SOPORTE_IDS = [
    '1517530849334136847',
    '1517530849334136848',
    '1517530849334136849',
    '1517530849334136850',
    '1517530849334136851'
];

// Categorías oficiales de tickets
const CATEGORIA_SOPORTE_ID = '1517530850131050641';
const CATEGORIA_APELACION_ID = '1517530850353352716';
const CATEGORIA_STREAMER_ID = '1517530850353352717';
const CATEGORIA_DONACIONES_ID = '1517530850353352718';

// Referencias persistentes de los paneles en vivo
const panelRefs = {
    servicios: null, // { channelId, messageId }
    locucion: null,  // { channelId, messageId }
    tickets: null    // { channelId, messageId }
};

// Caché ligero para cuota del motor de voz neuronal (se consulta cada 5 min para no saturar)
let voiceQuotaCache = {
    checkedAt: 0,
    available: false,
    used: 0,
    limit: 0
};

function getLogoAttachment() {
    const p = path.join(__dirname, 'assets', 'logo.png');
    if (fs.existsSync(p)) {
        return new AttachmentBuilder(p, { name: 'logo.png' });
    }
    return null;
}

function isMemberStaff(member) {
    if (!member || member.user.bot) return false;
    if (ROLE_STAFF_ID && member.roles.cache.has(ROLE_STAFF_ID)) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

function makeProgressBar(used, total, size = 10, mode = 'usage') {
    const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
    const filled = Math.round(pct * size);
    let fillChar;
    if (mode === 'health') {
        // En barras de salud/carga: alto = bien (verde), bajo = mal (rojo)
        fillChar = pct >= 0.8 ? '🟩' : (pct >= 0.5 ? '🟨' : '🟥');
    } else {
        // En barras de consumo (RAM/cuota): bajo = bien (verde), alto = alerta (rojo)
        fillChar = pct >= 0.85 ? '🟥' : (pct >= 0.6 ? '🟨' : '🟩');
    }
    return fillChar.repeat(filled) + '⬛'.repeat(size - filled);
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function fetchVoiceQuota(force = false) {
    const now = Date.now();
    if (!force && now - voiceQuotaCache.checkedAt < 5 * 60 * 1000) {
        return voiceQuotaCache;
    }

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) {
        voiceQuotaCache = { checkedAt: now, available: false, used: 0, limit: 0 };
        return voiceQuotaCache;
    }

    try {
        const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
            headers: { 'xi-api-key': key.trim() }
        });
        if (res.ok) {
            const data = await res.json();
            voiceQuotaCache = {
                checkedAt: now,
                available: true,
                used: Number(data.character_count || 0),
                limit: Number(data.character_limit || 10000)
            };
            return voiceQuotaCache;
        }
    } catch (e) { }

    voiceQuotaCache.checkedAt = now;
    return voiceQuotaCache;
}

async function loadPanelRefs() {
    try {
        const [pServ, pLoc, pTick] = await Promise.all([
            BotSetting.findOne({ key: 'dashboard_panel_servicios' }),
            BotSetting.findOne({ key: 'dashboard_panel_locucion' }),
            BotSetting.findOne({ key: 'dashboard_panel_tickets' })
        ]);
        if (pServ?.value?.channelId && pServ?.value?.messageId) panelRefs.servicios = pServ.value;
        if (pLoc?.value?.channelId && pLoc?.value?.messageId) panelRefs.locucion = pLoc.value;
        if (pTick?.value?.channelId && pTick?.value?.messageId) panelRefs.tickets = pTick.value;
    } catch (e) { }
}

// ==========================================
// 1. DASHBOARD GENERAL DE SERVICIOS (!panel-servicios)
// ==========================================
async function buildServiciosEmbed(client) {
    const logoAttachment = getLogoAttachment();
    const logoUrl = logoAttachment ? 'attachment://logo.png' : undefined;

    const dbConnected = mongoose.connection.readyState === 1;
    const ping = Math.max(0, Math.round(client.ws.ping || 0));
    const uptimeStr = formatUptime(process.uptime());
    const ramMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const ramLimitMb = 512;
    const ramPct = Math.min(100, Math.round((ramMb / ramLimitMb) * 100));
    const ramBar = makeProgressBar(ramMb, ramLimitMb, 10);

    // Consultar interruptores reales en BD
    let consultasOn = true;
    let asistenteOn = true;
    let locucionOn = true;
    try {
        const [cSet, lSet] = await Promise.all([
            BotSetting.findOne({ key: 'consultas_ai_activo' }),
            BotSetting.findOne({ key: 'soporte_alert_activo' })
        ]);
        if (cSet && cSet.value !== undefined) consultasOn = !!cSet.value;
        if (lSet && lSet.value !== undefined) locucionOn = !!lSet.value;

        if (mongoose.models.TicketConfig) {
            const aSet = await mongoose.models.TicketConfig.findOne({ key: 'asistente_activo' });
            if (aSet && aSet.value !== undefined) asistenteOn = !!aSet.value;
        }
    } catch (e) { }

    const aiCoreReady = !!process.env.GROQ_API_KEY;
    const voiceCoreReady = !!process.env.ELEVENLABS_API_KEY;
    const antiAiReady = !!(process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || process.env.SAPLING_API_KEY);

    const services = [
        dbConnected,
        aiCoreReady && consultasOn,
        asistenteOn,
        locucionOn,
        antiAiReady,
        true // Directos & Eventos
    ];
    const okCount = services.filter(Boolean).length;
    const healthBar = makeProgressBar(okCount, services.length, 12, 'health');
    const healthPct = Math.round((okCount / services.length) * 100);

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({
            name: 'MONITOR DE SERVICIOS EN VIVO | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('🖥️ ESTADO GENERAL DEL SISTEMA (VALLECAS CORE)')
        .setDescription(
            `⚡ **Salud global:** ${okCount === services.length ? '🟢 `Todos los servicios operativos`' : '🟡 `Algunos servicios pausados`'}\n` +
            `${healthBar} \`${healthPct}%\` (\`${okCount}/${services.length}\` activos)\n\n` +
            `📡 **RENDIMIENTO DEL BOT:**\n` +
            `> 🟢 **Estado:** \`Online\` • **Latencia:** \`${ping} ms\` • **Activo:** \`${uptimeStr}\`\n` +
            `> 💾 **Memoria:** ${ramBar} \`${ramMb} MB\` (\`${ramPct}%\`)\n` +
            `> 🗄️ **Base de Datos:** ${dbConnected ? '🟢 `Conectada`' : '🔴 `Desconectada`'}\n\n` +
            `────────────────────────────\n\n` +
            `⚙️ **MÓDULOS Y SERVICIOS DEL SERVIDOR:**\n` +
            `> 🧠 **Consultas de Normativa IA:** ${aiCoreReady ? (consultasOn ? '🟢 `Operativo`' : '🔴 `Pausado`') : '🔴 `Sin conexión`'}\n` +
            `> 🎫 **Asistente Virtual de Tickets:** ${asistenteOn ? '🟢 `Operativo`' : '🔴 `Pausado`'}\n` +
            `> 🎙️ **Sistema de Locución y Soporte:** ${locucionOn ? '🟢 `Operativo`' : '🔴 `Pausado`'}\n` +
            `> 🎤 **Motor de Voz Neuronal:** ${voiceCoreReady ? '🟢 `Neuronal Activo`' : '🟡 `Modo Estándar`'}\n` +
            `> 🛡️ **Auditoría Anti-IA (Whitelist):** ${antiAiReady ? '🟢 `Operativo`' : '🟡 `Modo Local`'}\n` +
            `> 📢 **Eventos, Directos y Sanciones:** 🟢 \`Operativo\``
        )
        .setFooter({
            text: 'VALLECAS RP • Auto-actualización cada 60s',
            iconURL: logoUrl
        })
        .setTimestamp();

    return { embed, logoAttachment };
}

// ==========================================
// 2. DASHBOARD DE LOCUCIÓN Y VOZ (!panel-locucion)
// ==========================================
async function buildLocucionEmbed(client, guild, forceQuota = false) {
    const logoAttachment = getLogoAttachment();
    const logoUrl = logoAttachment ? 'attachment://logo.png' : undefined;

    let locucionOn = true;
    let intervaloMin = 0.5;
    let audioStatuses = [];

    try {
        const [activoSet, tiempoSet] = await Promise.all([
            BotSetting.findOne({ key: 'soporte_alert_activo' }),
            BotSetting.findOne({ key: 'soporte_alert_tiempo' })
        ]);
        if (activoSet && activoSet.value !== undefined) locucionOn = !!activoSet.value;
        if (tiempoSet && tiempoSet.value !== undefined) intervaloMin = Number(tiempoSet.value) || 0.5;

        const audioNames = [
            { key: 'espera_soporte', emoji: '🔔', label: 'Aviso Staff 1 (Espera)' },
            { key: 'aviso_2', emoji: '⏰', label: 'Aviso Staff 2 (Recordatorio)' },
            { key: 'locucion_de_esperas', emoji: '👋', label: 'Locución Usuarios (Bienvenida)' },
            { key: 'sancion_staffs', emoji: '🚨', label: 'Aviso 3 (Sanción Staff)' },
            { key: 'sala_de_staffs', emoji: '💬', label: 'Locución Sala de Charla' }
        ];

        if (mongoose.models.AudioAlert) {
            const docs = await mongoose.models.AudioAlert.find({}, { name: 1, size: 1 }).lean();
            const foundMap = new Map(docs.map(d => [d.name, d.size || 1]));
            audioStatuses = audioNames.map(a => ({
                emoji: a.emoji,
                label: a.label,
                loaded: foundMap.has(a.key)
            }));
        } else {
            audioStatuses = audioNames.map(a => ({ emoji: a.emoji, label: a.label, loaded: false }));
        }
    } catch (e) { }

    // Contar usuarios esperando y staffs en salas de soporte en tiempo real
    let usersWaiting = 0;
    let staffsInSupport = 0;
    let botInVoice = false;
    try {
        if (guild) {
            const esperaCh = guild.channels.cache.get(CANAL_ESPERA_ID) || await guild.channels.fetch(CANAL_ESPERA_ID).catch(() => null);
            if (esperaCh && esperaCh.members) {
                usersWaiting = esperaCh.members.filter(m => !m.user.bot).size;
                if (esperaCh.members.has(client.user.id)) botInVoice = true;
            }
            for (const supId of CANALES_SOPORTE_IDS) {
                const supCh = guild.channels.cache.get(supId);
                if (supCh && supCh.members) {
                    staffsInSupport += supCh.members.filter(m => !m.user.bot).size;
                    if (supCh.members.has(client.user.id)) botInVoice = true;
                }
            }
        }
    } catch (e) { }

    const loadedCount = audioStatuses.filter(a => a.loaded).length;
    const totalAudios = audioStatuses.length || 5;
    const audioBar = makeProgressBar(loadedCount, totalAudios, 10, 'health');
    const audioPct = Math.round((loadedCount / totalAudios) * 100);
    const audioLines = audioStatuses.map(a => `> ${a.emoji} **${a.label}:** ${a.loaded ? '🟢 `Activo`' : '🔴 `Inactivo`'}`).join('\n');

    // Cuota del motor de voz neuronal (sin mencionar proveedor)
    const quota = await fetchVoiceQuota(forceQuota);
    let voiceBlock = `> 🟡 **Motor de Voz Neuronal:** \`Modo Estándar\``;
    if (quota.available && quota.limit > 0) {
        const rem = Math.max(0, quota.limit - quota.used);
        const qPct = Math.min(100, Math.round((quota.used / quota.limit) * 100));
        const qBar = makeProgressBar(quota.used, quota.limit, 10, 'usage');
        voiceBlock =
            `**Motor de Voz Neuronal (Entrevistas)** — 🟢 \`Operativo\`\n` +
            `${qBar} \`${qPct}%\`\n` +
            `> 🔊 Usados: \`${quota.used.toLocaleString('es-ES')}\` / \`${quota.limit.toLocaleString('es-ES')}\` car. • Quedan: \`${rem.toLocaleString('es-ES')}\``;
    }

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({
            name: 'MONITOR DE LOCUCIÓN Y VOZ EN VIVO | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('🎙️ SISTEMA DE LOCUCIÓN Y SALAS DE SOPORTE')
        .setDescription(
            `🔊 **Estado del sistema:** ${locucionOn ? '🟢 `ACTIVADO`' : '🔴 `PAUSADO`'} • **Intervalo:** \`${Math.round(intervaloMin * 60)}s\`\n\n` +
            `🎧 **Actividad actual:** ${botInVoice ? '🔊 `Reproduciendo locución`' : '🟢 `En guardia (Listo)`'}\n\n` +
            `👥 **SALAS DE SOPORTE EN TIEMPO REAL:**\n` +
            `> ⏳ **En Espera de Soporte:** \`${usersWaiting}\` usuario(s)\n` +
            `> 🛡️ **En Salas de Soporte (1-5):** \`${staffsInSupport}\` miembro(s)\n\n` +
            `────────────────────────────\n\n` +
            `🎵 **AUDIOS DEL SISTEMA (${loadedCount}/${totalAudios}):**\n` +
            `${audioBar} \`${audioPct}%\`\n` +
            `${audioLines}\n\n` +
            `────────────────────────────\n\n` +
            `${voiceBlock}`
        )
        .setFooter({
            text: 'VALLECAS RP • Actualización en tiempo real',
            iconURL: logoUrl
        })
        .setTimestamp();

    return { embed, logoAttachment };
}

// ==========================================
// 3. DASHBOARD DE TICKETS (!panel-tickets)
// ==========================================
async function buildTicketsEmbed(guild) {
    const logoAttachment = getLogoAttachment();
    const logoUrl = logoAttachment ? 'attachment://logo.png' : undefined;

    let asistenteOn = true;
    let totalSummarized = 0;
    let totalSolved = 0;
    let knowledgeCount = 0;

    try {
        if (mongoose.models.TicketConfig) {
            const aSet = await mongoose.models.TicketConfig.findOne({ key: 'asistente_activo' });
            if (aSet && aSet.value !== undefined) asistenteOn = !!aSet.value;
        }
        if (mongoose.models.TicketSession) {
            [totalSummarized, totalSolved] = await Promise.all([
                mongoose.models.TicketSession.countDocuments({ status: 'summarized' }),
                mongoose.models.TicketSession.countDocuments({ status: 'solved' })
            ]);
        }
        if (mongoose.models.TicketKnowledge) {
            knowledgeCount = await mongoose.models.TicketKnowledge.countDocuments({});
        }
    } catch (e) { }

    let cSoporte = 0, cApelacion = 0, cStreamer = 0, cDonaciones = 0;
    if (guild) {
        const textChannels = guild.channels.cache.filter(c => c.type === 0);
        cSoporte = textChannels.filter(c => c.parentId === CATEGORIA_SOPORTE_ID).size;
        cApelacion = textChannels.filter(c => c.parentId === CATEGORIA_APELACION_ID).size;
        cStreamer = textChannels.filter(c => c.parentId === CATEGORIA_STREAMER_ID).size;
        cDonaciones = textChannels.filter(c => c.parentId === CATEGORIA_DONACIONES_ID).size;
    }

    const totalOpen = cSoporte + cApelacion + cStreamer + cDonaciones;

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({
            name: 'MONITOR DE TICKETS EN VIVO | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('🎫 ASISTENTE VIRTUAL Y COLA DE TICKETS')
        .setDescription(
            `🤖 **Asistente de Tickets:** ${asistenteOn ? '🟢 `ACTIVADO`' : '🔴 `PAUSADO`'}\n\n` +
            `📂 **Tickets abiertos ahora mismo:** \`${totalOpen}\` en total\n\n` +
            `📋 **DESGLOSE POR CATEGORÍA (EN VIVO):**\n` +
            `> 🛠️ **Soporte:** \`${cSoporte}\` abierto(s)\n` +
            `> 🔨 **Apelaciones de Baneo:** \`${cApelacion}\` abierto(s)\n` +
            `> 🎬 **Creadores de Contenido:** \`${cStreamer}\` abierto(s)\n` +
            `> 💎 **Donaciones:** \`${cDonaciones}\` abierto(s)\n\n` +
            `────────────────────────────\n\n` +
            `📈 **HISTÓRICO DEL ASISTENTE:**\n` +
            `> 📨 **Resúmenes preparados al Staff:** \`${totalSummarized}\`\n` +
            `> ✅ **Resueltos por el Asistente:** \`${totalSolved}\`\n` +
            `> 🧠 **Base de conocimiento:** \`${knowledgeCount}\` entradas`
        )
        .setFooter({
            text: 'VALLECAS RP • Actualización en tiempo real',
            iconURL: logoUrl
        })
        .setTimestamp();

    return { embed, logoAttachment };
}

function buildRefreshRow(customId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(customId)
            .setLabel('Actualizar ahora')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );
}

async function editSavedPanel(client, type) {
    const ref = panelRefs[type];
    if (!ref || !ref.channelId || !ref.messageId) return;
    try {
        const ch = client.channels.cache.get(ref.channelId) || await client.channels.fetch(ref.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;
        const msg = await ch.messages.fetch(ref.messageId).catch(() => null);
        if (!msg) return;

        let built;
        let btnId;
        if (type === 'servicios') {
            built = await buildServiciosEmbed(client);
            btnId = 'btn_dash_refresh_servicios';
        } else if (type === 'locucion') {
            built = await buildLocucionEmbed(client, ch.guild, false);
            btnId = 'btn_dash_refresh_locucion';
        } else {
            built = await buildTicketsEmbed(ch.guild);
            btnId = 'btn_dash_refresh_tickets';
        }

        // Al editar, NO re-subimos logo.png (3.5 MB) para ahorrar tráfico en Railway; Discord conserva el adjunto existente
        await msg.edit({
            embeds: [built.embed],
            components: [buildRefreshRow(btnId)]
        }).catch(() => {});
    } catch (e) { }
}

const debounceTimers = new Map();
function schedulePanelUpdate(client, type, delayMs = 2000) {
    if (debounceTimers.has(type)) clearTimeout(debounceTimers.get(type));
    debounceTimers.set(type, setTimeout(() => {
        debounceTimers.delete(type);
        if (client.isReady()) editSavedPanel(client, type);
    }, delayMs));
}

module.exports = function initStatusDashboards(client) {
    loadPanelRefs();
    console.log('📊 [DASHBOARDS] Sistema de paneles en tiempo real cargado (!panel-servicios, !panel-locucion, !panel-tickets).');

    const watchedVoiceIds = new Set([CANAL_ESPERA_ID, ...CANALES_SOPORTE_IDS]);
    const watchedTicketCats = new Set([
        CATEGORIA_SOPORTE_ID,
        CATEGORIA_APELACION_ID,
        CATEGORIA_STREAMER_ID,
        CATEGORIA_DONACIONES_ID
    ]);

    // Actualización INSTANTÁNEA de !panel-locucion cuando alguien entra o sale de salas de soporte / espera
    client.on('voiceStateUpdate', (oldState, newState) => {
        if (watchedVoiceIds.has(oldState.channelId) || watchedVoiceIds.has(newState.channelId)) {
            schedulePanelUpdate(client, 'locucion', 1500);
        }
    });

    // Actualización INSTANTÁNEA de !panel-tickets cuando se abre o cierra un ticket
    client.on('channelCreate', (channel) => {
        if (channel && channel.type === 0 && watchedTicketCats.has(channel.parentId)) {
            schedulePanelUpdate(client, 'tickets', 2000);
        }
    });
    client.on('channelDelete', (channel) => {
        if (channel && channel.type === 0 && watchedTicketCats.has(channel.parentId)) {
            schedulePanelUpdate(client, 'tickets', 1500);
        }
    });

    // Respaldo periódico cada 60s (actualiza RAM, latencia, uptime y sincroniza todo sin rate limits)
    setInterval(() => {
        if (!client.isReady()) return;
        editSavedPanel(client, 'servicios');
        editSavedPanel(client, 'locucion');
        editSavedPanel(client, 'tickets');
    }, 60 * 1000);

    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot || !message.guild) return;
            const contentLower = message.content.trim().toLowerCase();
            if (!contentLower.startsWith('!')) return;

            const isStaff = isMemberStaff(message.member);

            // 1. !panel-servicios
            if (['!panel-servicios', '!panelservicios', '!servicios', '!panel-bot'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});
                const { embed, logoAttachment } = await buildServiciosEmbed(client);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [buildRefreshRow('btn_dash_refresh_servicios')]
                }).catch(() => null);

                if (sent) {
                    panelRefs.servicios = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_servicios' },
                        { key: 'dashboard_panel_servicios', value: panelRefs.servicios },
                        { upsert: true }
                    ).catch(() => {});
                }
                return;
            }

            // 2. !panel-locucion
            if (['!panel-locucion', '!panellocucion', '!panel-voz', '!panelvoz'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});
                const { embed, logoAttachment } = await buildLocucionEmbed(client, message.guild, true);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [buildRefreshRow('btn_dash_refresh_locucion')]
                }).catch(() => null);

                if (sent) {
                    panelRefs.locucion = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_locucion' },
                        { key: 'dashboard_panel_locucion', value: panelRefs.locucion },
                        { upsert: true }
                    ).catch(() => {});
                }
                return;
            }

            // 3. !panel-tickets
            if (['!panel-tickets', '!paneltickets', '!panel-tickets-monitor', '!monitortickets'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});
                const { embed, logoAttachment } = await buildTicketsEmbed(message.guild);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [buildRefreshRow('btn_dash_refresh_tickets')]
                }).catch(() => null);

                if (sent) {
                    panelRefs.tickets = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_tickets' },
                        { key: 'dashboard_panel_tickets', value: panelRefs.tickets },
                        { upsert: true }
                    ).catch(() => {});
                }
                return;
            }
        } catch (err) {
            console.error('⚠️ [DASHBOARDS messageCreate Error]:', err.message);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;
            const id = interaction.customId;
            if (!id.startsWith('btn_dash_refresh_')) return;

            if (!isMemberStaff(interaction.member)) {
                return interaction.reply({ content: '⛔ Solo el Staff puede actualizar este panel.', ephemeral: true });
            }

            let built;
            if (id === 'btn_dash_refresh_servicios') {
                built = await buildServiciosEmbed(client);
            } else if (id === 'btn_dash_refresh_locucion') {
                built = await buildLocucionEmbed(client, interaction.guild, true);
            } else if (id === 'btn_dash_refresh_tickets') {
                built = await buildTicketsEmbed(interaction.guild);
            } else {
                return;
            }

            await interaction.update({
                embeds: [built.embed],
                components: [buildRefreshRow(id)]
            }).catch(() => {});
        } catch (err) {
            console.error('⚠️ [DASHBOARDS interactionCreate Error]:', err.message);
        }
    });
};
