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
const guildManager = require('./guildManager');
const ticketSystem = require('./ticketSystem');

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
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? ROLE_STAFF_ID : '');
    if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

function getGuildVoiceIds(guildId) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return { esperaId: CANAL_ESPERA_ID, soporteIds: CANALES_SOPORTE_IDS };
    }
    const gCfg = guildManager.getGuildConfig(guildId);
    const soporteIds = Array.isArray(gCfg.VOICE_SOPORTE_IDS) ? gCfg.VOICE_SOPORTE_IDS : [];
    return { esperaId: gCfg.VOICE_ESPERA_ID || '', soporteIds };
}

function getGuildTicketCats(guildId) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return {
            soporte: CATEGORIA_SOPORTE_ID,
            apelacion: CATEGORIA_APELACION_ID,
            streamer: CATEGORIA_STREAMER_ID,
            donaciones: CATEGORIA_DONACIONES_ID
        };
    }
    const gCfg = guildManager.getGuildConfig(guildId);
    return {
        soporte: gCfg.CAT_TICKET_SOPORTE_ID || '',
        apelacion: gCfg.CAT_TICKET_APELACION_ID || '',
        streamer: gCfg.CAT_TICKET_STREAMER_ID || '',
        donaciones: gCfg.CAT_TICKET_DONACIONES_ID || ''
    };
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
async function buildServiciosEmbed(client, guildId = null) {
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

    const vSrv = guildManager.resolveGuildVisuals(guildId);
    const srvLogoUrl = vSrv.logoUrl || logoUrl;
    const embed = new EmbedBuilder()
        .setColor(vSrv.color)
        .setAuthor({
            name: `MONITOR DE SERVICIOS EN VIVO | ${vSrv.name}`,
            iconURL: srvLogoUrl
        })
        .setThumbnail(srvLogoUrl)
        .setTitle(`🖥️ ESTADO GENERAL DEL SISTEMA (${vSrv.name} CORE)`)
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
            text: `${vSrv.name} • Auto-actualización cada 60s`,
            iconURL: srvLogoUrl
        })
        .setTimestamp();

    return { embed, files: vSrv.files, logoAttachment: vSrv.files[0] || null };
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

    // Contar usuarios esperando y staffs en salas de soporte en tiempo real (aislado por servidor)
    const { esperaId, soporteIds } = getGuildVoiceIds(guild?.id);
    let usersWaiting = 0;
    let staffsInSupport = 0;
    let botInVoice = false;
    try {
        if (guild) {
            if (esperaId) {
                const esperaCh = guild.channels.cache.get(esperaId) || await guild.channels.fetch(esperaId).catch(() => null);
                if (esperaCh && esperaCh.members) {
                    usersWaiting = esperaCh.members.filter(m => !m.user.bot).size;
                    if (esperaCh.members.has(client.user.id)) botInVoice = true;
                }
            }
            for (const supId of soporteIds) {
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

    const vLoc = guildManager.resolveGuildVisuals(guild?.id);
    const locLogoUrl = vLoc.logoUrl || logoUrl;
    const embed = new EmbedBuilder()
        .setColor(vLoc.color)
        .setAuthor({
            name: `MONITOR DE LOCUCIÓN Y VOZ EN VIVO | ${vLoc.name}`,
            iconURL: locLogoUrl
        })
        .setThumbnail(locLogoUrl)
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
            text: `${vLoc.name} • Actualización en tiempo real`,
            iconURL: locLogoUrl
        })
        .setTimestamp();

    return { embed, files: vLoc.files, logoAttachment: vLoc.files[0] || null };
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
    let closedLogsCount = 0;

    const gId = guild?.id;
    const isPrimary = !gId || guildManager.isPrimaryGuild(gId);

    try {
        if (mongoose.models.TicketConfig) {
            const aSet = await mongoose.models.TicketConfig.findOne({ key: 'asistente_activo' });
            if (aSet && aSet.value !== undefined) asistenteOn = !!aSet.value;
        }
        if (isPrimary) {
            if (mongoose.models.TicketSession) {
                [totalSummarized, totalSolved] = await Promise.all([
                    mongoose.models.TicketSession.countDocuments({ status: 'summarized' }),
                    mongoose.models.TicketSession.countDocuments({ status: 'solved' })
                ]);
            }
            if (mongoose.models.TicketKnowledge) {
                knowledgeCount = await mongoose.models.TicketKnowledge.countDocuments({});
            }
        } else if (mongoose.connection.readyState === 1) {
            const GuildSessionModel = guildManager.getGuildModel(gId, 'TicketSession', new mongoose.Schema({ status: String }, { strict: false }));
            const GuildKnowledgeModel = guildManager.getGuildModel(gId, 'TicketKnowledge', new mongoose.Schema({ response: String }, { strict: false }));
            const GuildLogModel = guildManager.getGuildModel(gId, 'AdvTicketLog', ticketSystem.ticketLogSchema);
            [totalSummarized, totalSolved, knowledgeCount, closedLogsCount] = await Promise.all([
                GuildSessionModel.countDocuments({ status: 'summarized' }).catch(() => 0),
                GuildSessionModel.countDocuments({ status: 'solved' }).catch(() => 0),
                GuildKnowledgeModel.countDocuments({}).catch(() => 0),
                GuildLogModel.countDocuments({}).catch(() => 0)
            ]);
        }
    } catch (e) { }

    let totalOpen = 0;
    let breakdownLines = '';

    if (isPrimary) {
        const cats = getGuildTicketCats(gId);
        let cSoporte = 0, cApelacion = 0, cStreamer = 0, cDonaciones = 0;
        if (guild) {
            const textChannels = guild.channels.cache.filter(c => c.type === 0);
            if (cats.soporte) cSoporte = textChannels.filter(c => c.parentId === cats.soporte).size;
            if (cats.apelacion) cApelacion = textChannels.filter(c => c.parentId === cats.apelacion).size;
            if (cats.streamer) cStreamer = textChannels.filter(c => c.parentId === cats.streamer).size;
            if (cats.donaciones) cDonaciones = textChannels.filter(c => c.parentId === cats.donaciones).size;
        }
        totalOpen = cSoporte + cApelacion + cStreamer + cDonaciones;
        breakdownLines =
            `> 🛠️ **Soporte:** \`${cSoporte}\` abierto(s)\n` +
            `> 🔨 **Apelaciones de Baneo:** \`${cApelacion}\` abierto(s)\n` +
            `> 🎬 **Creadores de Contenido:** \`${cStreamer}\` abierto(s)\n` +
            `> 💎 **Donaciones:** \`${cDonaciones}\` abierto(s)`;
    } else {
        const advCats = ticketSystem.getGuildTicketCategories(guild);
        const textChannels = guild ? guild.channels.cache.filter(c => c.type === 0) : null;
        const lines = [];
        for (const t of ticketSystem.TICKET_TYPES) {
            const catId = advCats[t.key];
            const count = (textChannels && catId)
                ? textChannels.filter(c => c.parentId === catId).size
                : 0;
            totalOpen += count;
            lines.push(`> ${t.emoji} **${t.label}:** \`${count}\` abierto(s)`);
        }
        breakdownLines = lines.join('\n');
    }

    const vTk = guildManager.resolveGuildVisuals(gId);
    const tkLogoUrl = vTk.logoUrl || logoUrl;

    const historyLines = isPrimary
        ? (
            `> 📨 **Resúmenes preparados al Staff:** \`${totalSummarized}\`\n` +
            `> ✅ **Resueltos por el Asistente:** \`${totalSolved}\`\n` +
            `> 🧠 **Base de conocimiento:** \`${knowledgeCount}\` entradas`
        )
        : (
            `> 🔒 **Tickets cerrados (Logs):** \`${closedLogsCount}\`\n` +
            `> 📨 **Resúmenes preparados al Staff:** \`${totalSummarized}\`\n` +
            `> ✅ **Resueltos por el Asistente:** \`${totalSolved}\`\n` +
            `> 🧠 **Base de conocimiento:** \`${knowledgeCount}\` entradas`
        );

    const embed = new EmbedBuilder()
        .setColor(vTk.color)
        .setAuthor({
            name: `MONITOR DE TICKETS EN VIVO | ${vTk.name}`,
            iconURL: tkLogoUrl
        })
        .setThumbnail(tkLogoUrl)
        .setTitle('🎫 ASISTENTE VIRTUAL Y COLA DE TICKETS')
        .setDescription(
            `🤖 **Asistente de Tickets:** ${asistenteOn ? '🟢 `ACTIVADO`' : '🔴 `PAUSADO`'}\n\n` +
            `📂 **Tickets abiertos ahora mismo:** \`${totalOpen}\` en total\n\n` +
            `📋 **DESGLOSE POR CATEGORÍA (EN VIVO):**\n` +
            `${breakdownLines}\n\n` +
            `────────────────────────────\n\n` +
            `📈 **HISTÓRICO DEL ASISTENTE Y TICKETS:**\n` +
            `${historyLines}`
        )
        .setFooter({
            text: `${vTk.name} • Actualización en tiempo real`,
            iconURL: tkLogoUrl
        })
        .setTimestamp();

    return { embed, files: vTk.files, logoAttachment: vTk.files[0] || null };
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

async function editPanelByRef(client, type, ref) {
    if (!ref || !ref.channelId || !ref.messageId) return;
    try {
        const ch = client.channels.cache.get(ref.channelId) || await client.channels.fetch(ref.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;
        const msg = await ch.messages.fetch(ref.messageId).catch(() => null);
        if (!msg) return;

        let built;
        let btnId;
        if (type === 'servicios') {
            built = await buildServiciosEmbed(client, ch.guild?.id);
            btnId = 'btn_dash_refresh_servicios';
        } else if (type === 'locucion') {
            built = await buildLocucionEmbed(client, ch.guild, false);
            btnId = 'btn_dash_refresh_locucion';
        } else {
            built = await buildTicketsEmbed(ch.guild);
            btnId = 'btn_dash_refresh_tickets';
        }

        await msg.edit({
            embeds: [built.embed],
            components: [buildRefreshRow(btnId)]
        }).catch(() => {});
    } catch (e) { }
}

async function editSavedPanel(client, type, targetGuildId = null) {
    const cfgKey = type === 'servicios'
        ? 'DASH_PANEL_SERVICIOS'
        : (type === 'locucion' ? 'DASH_PANEL_LOCUCION' : 'DASH_PANEL_TICKETS');

    if (targetGuildId) {
        if (guildManager.isPrimaryGuild(targetGuildId)) {
            await editPanelByRef(client, type, panelRefs[type]);
        } else {
            const gCfg = guildManager.getGuildConfig(targetGuildId);
            await editPanelByRef(client, type, gCfg[cfgKey]);
        }
        return;
    }

    // Actualizar Vallecas RP (principal)
    await editPanelByRef(client, type, panelRefs[type]);

    // Actualizar TODOS los servidores secundarios que tengan este panel fijado
    for (const guild of client.guilds.cache.values()) {
        if (guildManager.isPrimaryGuild(guild.id)) continue;
        const gCfg = guildManager.getGuildConfig(guild.id);
        if (gCfg[cfgKey]) {
            await editPanelByRef(client, type, gCfg[cfgKey]);
        }
    }
}

const debounceTimers = new Map();
function schedulePanelUpdate(client, type, delayMs = 2000, guildId = null) {
    const timerKey = `${type}:${guildId || 'all'}`;
    if (debounceTimers.has(timerKey)) clearTimeout(debounceTimers.get(timerKey));
    debounceTimers.set(timerKey, setTimeout(() => {
        debounceTimers.delete(timerKey);
        if (client.isReady()) editSavedPanel(client, type, guildId);
    }, delayMs));
}

module.exports = function initStatusDashboards(client) {
    loadPanelRefs();
    console.log('📊 [DASHBOARDS] Sistema de paneles en tiempo real multi-servidor cargado (!panel-servicios, !panel-locucion, !panel-tickets).');

    // Actualización INSTANTÁNEA de !panel-locucion cuando alguien entra o sale de salas de soporte / espera (en cualquier servidor)
    client.on('voiceStateUpdate', (oldState, newState) => {
        const gId = newState.guild?.id || oldState.guild?.id;
        if (!gId) return;
        const { esperaId, soporteIds } = getGuildVoiceIds(gId);
        const watched = new Set([esperaId, ...soporteIds].filter(Boolean));
        if (watched.has(oldState.channelId) || watched.has(newState.channelId)) {
            schedulePanelUpdate(client, 'locucion', 1500, gId);
        }
    });

    // Hook directo para que ticketSystem.js refresque el Monitor al abrir/cerrar un ticket
    client.notifyTicketMonitor = (guildId) => {
        schedulePanelUpdate(client, 'tickets', 1000, guildId);
    };

    const getAllWatchedTicketCats = (guild) => {
        const legacyCats = getGuildTicketCats(guild.id);
        const advCats = ticketSystem.getGuildTicketCategories(guild);
        return new Set([
            legacyCats.soporte, legacyCats.apelacion, legacyCats.streamer, legacyCats.donaciones,
            ...Object.values(advCats)
        ].filter(Boolean));
    };

    // Actualización INSTANTÁNEA de !panel-tickets cuando se abre o cierra un ticket (en cualquier servidor)
    client.on('channelCreate', (channel) => {
        if (!channel || channel.type !== 0 || !channel.guild) return;
        if (getAllWatchedTicketCats(channel.guild).has(channel.parentId)) {
            schedulePanelUpdate(client, 'tickets', 1500, channel.guild.id);
        }
    });
    client.on('channelDelete', (channel) => {
        if (!channel || channel.type !== 0 || !channel.guild) return;
        if (getAllWatchedTicketCats(channel.guild).has(channel.parentId)) {
            schedulePanelUpdate(client, 'tickets', 1500, channel.guild.id);
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
                const gId = message.guild.id;
                const { embed, files } = await buildServiciosEmbed(client, gId);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: files || [],
                    components: [buildRefreshRow('btn_dash_refresh_servicios')]
                }).catch(() => null);

                if (sent && guildManager.isPrimaryGuild(gId)) {
                    panelRefs.servicios = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_servicios' },
                        { key: 'dashboard_panel_servicios', value: panelRefs.servicios },
                        { upsert: true }
                    ).catch(() => {});
                } else if (sent) {
                    await guildManager.updateGuildConfig(gId, 'DASH_PANEL_SERVICIOS', { channelId: sent.channel.id, messageId: sent.id }, message.guild.name).catch(() => {});
                }
                return;
            }

            // 2. !panel-locucion
            if (['!panel-locucion', '!panellocucion', '!panel-voz', '!panelvoz'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});
                const gId = message.guild.id;
                const { embed, files } = await buildLocucionEmbed(client, message.guild, true);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: files || [],
                    components: [buildRefreshRow('btn_dash_refresh_locucion')]
                }).catch(() => null);

                if (sent && guildManager.isPrimaryGuild(gId)) {
                    panelRefs.locucion = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_locucion' },
                        { key: 'dashboard_panel_locucion', value: panelRefs.locucion },
                        { upsert: true }
                    ).catch(() => {});
                } else if (sent) {
                    await guildManager.updateGuildConfig(gId, 'DASH_PANEL_LOCUCION', { channelId: sent.channel.id, messageId: sent.id }, message.guild.name).catch(() => {});
                }
                return;
            }

            // 3. !panel-tickets
            if (['!panel-tickets', '!paneltickets', '!panel-tickets-monitor', '!monitortickets'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});
                const gId = message.guild.id;
                const { embed, files } = await buildTicketsEmbed(message.guild);
                const sent = await message.channel.send({
                    embeds: [embed],
                    files: files || [],
                    components: [buildRefreshRow('btn_dash_refresh_tickets')]
                }).catch(() => null);

                if (sent && guildManager.isPrimaryGuild(gId)) {
                    panelRefs.tickets = { channelId: sent.channel.id, messageId: sent.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'dashboard_panel_tickets' },
                        { key: 'dashboard_panel_tickets', value: panelRefs.tickets },
                        { upsert: true }
                    ).catch(() => {});
                } else if (sent) {
                    await guildManager.updateGuildConfig(gId, 'DASH_PANEL_TICKETS', { channelId: sent.channel.id, messageId: sent.id }, message.guild.name).catch(() => {});
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
                built = await buildServiciosEmbed(client, interaction.guild?.id);
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

    // Cargar módulo independiente de Verificación Multi-Servidor (verificacion.js)
    try {
        const initVerificacion = require('./verificacion');
        initVerificacion(client);
    } catch (verErr) {
        console.error('⚠️ [VERIFICACIÓN] Error inicializando módulo:', verErr.message);
    }

    // Cargar módulo independiente de Sistema Avanzado de Tickets Multi-Servidor (ticketSystem.js)
    try {
        ticketSystem.initTicketSystem(client);
    } catch (tktErr) {
        console.error('⚠️ [TICKETS AVANZADOS] Error inicializando módulo:', tktErr.message);
    }
};
