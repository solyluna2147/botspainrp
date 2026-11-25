// ==========================================
// MÓDULO INDEPENDIENTE: CONSULTAS IA PARA STAFF (VALLECAS RP)
// ==========================================
// Canal exclusivo: 1571567304628506855
// Canal de aprendizaje compartido: 1571488286789079080
// Comandos de control para Staff:
//   - !consultas on / !consultas off / !consultas estado
//   - !limpiarconsultas

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const guildManager = require('./guildManager');
const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits
} = require('discord.js');

// ==========================================
// MODELOS DE MONGODB (COMPARTIDOS)
// ==========================================
const ticketKnowledgeSchema = new mongoose.Schema({
    guildId: { type: String, default: null, index: true },
    category: { type: String, required: true },
    keywords: [{ type: String }],
    questionPattern: { type: String, required: true },
    response: { type: String, required: true },
    addedBy: { type: String, default: 'Sistema' },
    createdAt: { type: Date, default: Date.now }
});

const TicketKnowledge = mongoose.models.TicketKnowledge || mongoose.model('TicketKnowledge', ticketKnowledgeSchema);

const normativaDocSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    pages: [{ pageNumber: Number, text: String }],
    updatedAt: { type: Date, default: Date.now }
});

const NormativaDoc = mongoose.models.NormativaDoc || mongoose.model('NormativaDoc', normativaDocSchema);

const botSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const BotSetting = mongoose.models.BotSetting || mongoose.model('BotSetting', botSettingSchema);

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================
let CANAL_CONSULTAS_ID = '1571567304628506855'; // Canal exclusivo Staff (Canal 1)
let CANAL_CONSULTAS_USERS_ID = '';             // Canal para Usuarios (Canal 2 secundario)
let CANAL_CONSULTAS_LOGS_ID = '';              // Canal de Logs de todas las consultas IA
const CANAL_APRENDIZAJE_ID = '1571488286789079080';
const ROLE_STAFF_ID = '1538191116610838691';

let consultasActivas = true;
let memoriaNormativaPages = []; // Caché en memoria RAM de Vallecas RP (servidor principal)
const guildNormativaCache = new Map(); // guildId -> string[] (caché aislada por servidor)

function splitNormativaIntoSections(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const clean = rawText.replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    // Dividir por encabezados numerados, líneas divisorias o bloques de ~1800 chars
    const byBlocks = clean.split(/(?:\n_{4,}\n|\n-{4,}\n|\n(?=(?:#{1,3}\s|[0-9]+\.\s+[A-ZÁÉÍÓÚÑ])))/g).map(s => s.trim()).filter(s => s.length > 25);
    if (byBlocks.length >= 2) return byBlocks;
    const chunks = [];
    for (let i = 0; i < clean.length; i += 1800) {
        chunks.push(clean.slice(i, i + 1800));
    }
    return chunks;
}

async function getGuildNormativaPages(guildId) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return memoriaNormativaPages;
    }
    const keyId = String(guildId);
    if (guildNormativaCache.has(keyId)) {
        return guildNormativaCache.get(keyId);
    }

    const pages = [];
    try {
        // 1. Cargar TODAS las normativas desde la DB dedicada de ESTE servidor (ej: vilacityrp_db -> normativadocs)
        const GuildNormativaModel = guildManager.getGuildModel(keyId, 'NormativaDoc', normativaDocSchema);
        const docs = await GuildNormativaModel.find({}).lean();
        for (const d of docs) {
            if (Array.isArray(d.pages) && d.pages.length > 0) {
                pages.push(...d.pages.map(p => p.text).filter(Boolean));
            } else if (d.content) {
                pages.push(...splitNormativaIntoSections(d.content));
            }
        }
    } catch (e) { }

    // 2. Respaldo desde archivos .txt dentro de la carpeta assets/<NombreDelServidor>/
    if (pages.length === 0) {
        try {
            const cfg = guildManager.getGuildConfig(keyId);
            const dir = guildManager.findGuildAssetsDir(keyId, cfg);
            if (dir && fs.existsSync(dir)) {
                for (const fname of ['normativa.txt', 'normativa_general.txt', 'normativa_ilegales.txt']) {
                    const fp = path.join(dir, fname);
                    if (fs.existsSync(fp)) {
                        pages.push(...splitNormativaIntoSections(fs.readFileSync(fp, 'utf8')));
                    }
                }
            }
        } catch (e) { }
    }

    guildNormativaCache.set(keyId, pages);
    return pages;
}

// ==========================================
// POOL DE MODELOS GROQ CON RESPALDO AUTOMÁTICO (600K TOKENS/DÍA GRATIS)
// ==========================================
const GROQ_MODELS = [
    { id: 'qwen/qwen3.8-27b', label: 'Núcleo IA 1 (Principal)', dailyLimit: 200000, dailyReqLimit: 1000 },
    { id: 'openai/gpt-oss-120b', label: 'Núcleo IA 2 (Respaldo 1)', dailyLimit: 200000, dailyReqLimit: 1000 },
    { id: 'openai/gpt-oss-20b', label: 'Núcleo IA 3 (Respaldo 2)', dailyLimit: 200000, dailyReqLimit: 1000 }
];

function getConfiguredApiKeys() {
    const keys = [];
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) {
        keys.push({ idx: 1, key: process.env.GROQ_API_KEY.trim(), label: 'Servidor 1 (Principal)' });
    }
    for (let i = 2; i <= 25; i++) {
        const val = process.env[`GROQ_API_KEY_${i}`];
        if (val && val.trim()) {
            keys.push({ idx: keys.length + 1, key: val.trim(), label: `Servidor ${keys.length + 1} (Respaldo)` });
        }
    }
    return keys;
}

function getSlotKey(keyIdx, modelId) {
    return keyIdx === 1 ? modelId : `k${keyIdx}:${modelId}`;
}

function getUtcDateKey() {
    return new Date().toISOString().slice(0, 10);
}

function createEmptyTokenStats() {
    const models = {};
    const keyCount = Math.max(1, getConfiguredApiKeys().length);
    for (let k = 1; k <= keyCount; k++) {
        for (const m of GROQ_MODELS) {
            models[getSlotKey(k, m.id)] = { tokensUsed: 0, requests: 0, exhausted: false };
        }
    }
    return {
        date: getUtcDateKey(),
        activeKeyIdx: 1,
        activeModel: GROQ_MODELS[0].id,
        lastQueryTokens: 0,
        perGuild: {}, // guildId -> { requests: 0, lastQueryTokens: 0 } (contador de consultas aislado por servidor)
        models
    };
}

let tokenStats = createEmptyTokenStats();
let tokensPanelRef = null; // { channelId, messageId }
let lastDailyResetPanelDate = ''; // Última fecha UTC (YYYY-MM-DD) en la que se auto-actualizó el panel al reiniciar cupos
const slotTpmCooldowns = new Map(); // slotKey -> timestamp (ms) hasta que pase el cooldown temporal por TPM
let keyRoundRobinCursor = 0; // Balanceador rotativo para repartir consultas simultáneas entre todos los núcleos

function ensureTodayTokenStats() {
    const today = getUtcDateKey();
    const keyCount = Math.max(1, getConfiguredApiKeys().length);
    if (!tokenStats || tokenStats.date !== today) {
        tokenStats = createEmptyTokenStats();
    } else {
        if (!tokenStats.models) tokenStats.models = {};
        if (!tokenStats.perGuild || typeof tokenStats.perGuild !== 'object') tokenStats.perGuild = {};
        if (!tokenStats.activeKeyIdx) tokenStats.activeKeyIdx = 1;
        for (let k = 1; k <= keyCount; k++) {
            for (const m of GROQ_MODELS) {
                const slot = getSlotKey(k, m.id);
                if (!tokenStats.models[slot]) {
                    tokenStats.models[slot] = { tokensUsed: 0, requests: 0, exhausted: false };
                }
            }
        }
    }
    return tokenStats;
}

async function saveTokenStats() {
    try {
        await BotSetting.findOneAndUpdate(
            { key: 'groq_tokens_stats' },
            { key: 'groq_tokens_stats', value: tokenStats },
            { upsert: true }
        );
    } catch (e) { }
}

function formatNum(n) {
    return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function makeProgressBar(used, total, size = 10) {
    const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
    const filled = Math.round(pct * size);
    const fillChar = pct >= 0.85 ? '🟥' : (pct >= 0.6 ? '🟨' : '🟩');
    return fillChar.repeat(filled) + '⬛'.repeat(size - filled);
}

function resolveTokensPanelLogo(guildId, client = null) {
    const vTok = guildManager.resolveGuildVisuals(guildId);
    if (vTok.config?.LOGO_URL && /^https?:\/\//i.test(vTok.config.LOGO_URL)) {
        return { vTok, logoUrl: vTok.config.LOGO_URL.trim(), files: [] };
    }
    const guild = (guildId && client?.guilds?.cache?.get(guildId)) || null;
    const guildIcon = guild?.iconURL?.({ size: 256, extension: 'png' });
    if (guildIcon) {
        return { vTok, logoUrl: guildIcon, files: [] };
    }
    return { vTok, logoUrl: vTok.logoUrl || undefined, files: vTok.files || [] };
}

function buildTokensPanelEmbed(guildId = null, client = null) {
    ensureTodayTokenStats();
    const { vTok, logoUrl } = resolveTokensPanelLogo(guildId, client);

    const apiKeys = getConfiguredApiKeys();
    const keyCount = Math.max(1, apiKeys.length);
    const perCycleLimit = GROQ_MODELS.reduce((acc, m) => acc + m.dailyLimit, 0);
    const totalLimit = perCycleLimit * keyCount;
    const activeCycleIdx = tokenStats.activeKeyIdx || 1;
    let totalUsed = 0;
    let totalReqs = 0;

    // Desglose por cada uno de los Núcleos/Ciclos configurados (1 por cada clave conectada -> 4 Núcleos)
    const nucleiLines = [];
    for (let k = 1; k <= keyCount; k++) {
        let cycleUsed = 0;
        let cycleReqs = 0;
        let cycleExhausted = true;
        for (const m of GROQ_MODELS) {
            const st = tokenStats.models[getSlotKey(k, m.id)] || { tokensUsed: 0, requests: 0, exhausted: false };
            cycleUsed += st.tokensUsed;
            cycleReqs += st.requests;
            if (!st.exhausted) cycleExhausted = false;
        }
        totalUsed += cycleUsed;
        totalReqs += cycleReqs;

        const rem = Math.max(0, perCycleLimit - cycleUsed);
        const pct = Math.min(100, Math.round((cycleUsed / perCycleLimit) * 100));
        const isCurrentCycle = activeCycleIdx === k;
        const statusDot = cycleExhausted ? '🔴' : (isCurrentCycle ? '🟢' : '🔵');
        const statusBadge = cycleExhausted
            ? '🔴 `Agotado hoy`'
            : (isCurrentCycle ? '🟢 `Activo ahora`' : '🔵 `En reserva`');
        const bar = makeProgressBar(cycleUsed, perCycleLimit, 10);
        const label = k === 1 ? 'Núcleo IA 1 (Principal)' : `Núcleo IA ${k} (Respaldo ${k - 1})`;

        if (keyCount > 6) {
            // Formato compacto elegante para muchos núcleos (ej. 13 núcleos = 7.800.000 tokens sin saturar el embed)
            const tag = cycleExhausted ? '`Agotado`' : (isCurrentCycle ? '`Activo`' : '`Reserva`');
            nucleiLines.push(
                `> ${statusDot} **${label}** ${tag} — \`${formatNum(cycleUsed)}\` / \`${formatNum(perCycleLimit)}\` (\`${pct}%\`) • \`${formatNum(cycleReqs)}\` cons.`
            );
        } else {
            nucleiLines.push(
                `**${label}** — ${statusBadge}\n` +
                `${bar} \`${pct}%\`\n` +
                `> 🪙 Usados: \`${formatNum(cycleUsed)}\` / \`${formatNum(perCycleLimit)}\` • Quedan: \`${formatNum(rem)}\` • Consultas: \`${formatNum(cycleReqs)}\``
            );
        }
    }

    const totalRemaining = Math.max(0, totalLimit - totalUsed);
    const totalPct = Math.min(100, Math.round((totalUsed / totalLimit) * 100));
    const totalBar = makeProgressBar(totalUsed, totalLimit, 12);

    const now = new Date();
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const nextResetTs = Math.floor(nextReset.getTime() / 1000);

    const activeNucleusName = activeCycleIdx === 1 ? `Núcleo IA 1/${keyCount} (Principal)` : `Núcleo IA ${activeCycleIdx}/${keyCount} (Respaldo)`;
    const isPrimary = !guildId || guildManager.isPrimaryGuild(guildId);
    const gCfgTok = guildManager.getGuildConfig(guildId);
    const staffIdTok = isPrimary ? CANAL_CONSULTAS_ID : (gCfgTok.CHANNEL_CONSULTAS_STAFF_ID || '');
    const usersIdTok = isPrimary ? CANAL_CONSULTAS_USERS_ID : (gCfgTok.CHANNEL_CONSULTAS_USERS_ID || '');
    const loadedSections = isPrimary
        ? (memoriaNormativaPages || []).length
        : ((guildNormativaCache.get(String(guildId)) || []).length);
    const staffChText = staffIdTok ? `<#${staffIdTok}>` : '`No configurado`';
    const usersChText = usersIdTok ? `<#${usersIdTok}>` : '`No configurado`';
    const serverName = vTok.name || 'VALLECAS RP';

    // Contador de consultas hoy y última consulta EXCLUSIVO de este servidor (mientras los tokens siguen siendo el pool global)
    const guildStatKey = guildId ? String(guildId) : 'primary';
    const guildTodayStats = tokenStats.perGuild?.[guildStatKey] || { requests: 0, lastQueryTokens: 0 };
    const guildReqsToday = Number(guildTodayStats.requests) || 0;
    const guildLastTokens = Number(guildTodayStats.lastQueryTokens) || 0;

    return new EmbedBuilder()
        .setColor(vTok.color)
        .setAuthor({
            name: `MONITOR DE TOKENS IA EN VIVO | ${serverName}`,
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle(`📊 CONSUMO Y LÍMITES DE IA (${serverName} AI)`)
        .setDescription(
            `🔌 **Núcleo activo:** \`${activeNucleusName}\`\n\n` +
            `🔄 **Cambio automático:** Activado *(si un núcleo se agota, salta al siguiente solo)*\n\n` +
            `📈 **TOTAL COMBINADO HOY (${tokenStats.date} UTC):**\n` +
            `${totalBar} \`${totalPct}%\`\n` +
            `> 🪙 **Gastados:** \`${formatNum(totalUsed)}\` / \`${formatNum(totalLimit)}\` tokens\n` +
            `> 🟢 **Disponibles:** \`${formatNum(totalRemaining)}\` tokens\n` +
            `> 💬 **Consultas hoy:** \`${formatNum(guildReqsToday)}\` *(Última: \`+${formatNum(guildLastTokens)}\` tokens)*\n\n` +
            `────────────────────────────\n\n` +
            `🧠 **NÚCLEOS IA (${keyCount} conectados):**\n` +
            `${nucleiLines.join(keyCount > 6 ? '\n' : '\n\n')}\n\n` +
            `────────────────────────────\n\n` +
            `⚙️ **SISTEMA Y CANALES ACTIVOS:**\n` +
            `> ⚡ **Servicio:** ${consultasActivas ? '🟢 `Activo y respondiendo`' : '🔴 `Pausado por Staff`'}\n` +
            `> 📚 **Normativa en memoria:** \`${loadedSections}\` secciones oficiales\n` +
            `> 🛡️ **Canal Staff:** ${staffChText}\n` +
            `> 👥 **Canal Usuarios:** ${usersChText}\n` +
            `> ⏳ **Próximo reinicio diario:** <t:${nextResetTs}:R> *(<t:${nextResetTs}:t>)*`
        )
        .setFooter({
            text: `${serverName} • Auto-actualización tras consulta y al reinicio diario`,
            iconURL: logoUrl
        })
        .setTimestamp();
}

function buildTokensPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_refresh_tokens_panel')
            .setLabel('Actualizar ahora')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    );
}

async function updateTokensPanel(client) {
    if (!client) return;
    const refsToUpdate = [];
    if (tokensPanelRef && tokensPanelRef.channelId && tokensPanelRef.messageId) {
        refsToUpdate.push({ ref: tokensPanelRef, guildId: null });
    }
    for (const guild of client.guilds.cache.values()) {
        if (guildManager.isPrimaryGuild(guild.id)) continue;
        const gCfg = guildManager.getGuildConfig(guild.id);
        if (gCfg.DASH_PANEL_TOKENS?.channelId && gCfg.DASH_PANEL_TOKENS?.messageId) {
            refsToUpdate.push({ ref: gCfg.DASH_PANEL_TOKENS, guildId: guild.id });
        }
    }

    for (const item of refsToUpdate) {
        try {
            const ch = client.channels.cache.get(item.ref.channelId) || await client.channels.fetch(item.ref.channelId).catch(() => null);
            if (!ch || !ch.isTextBased()) continue;
            const msg = await ch.messages.fetch(item.ref.messageId).catch(() => null);
            if (!msg) continue;

            const targetGId = item.guildId || ch.guild?.id;
            const embed = buildTokensPanelEmbed(targetGId, client);
            const usesAtt = JSON.stringify(embed.toJSON()).includes('attachment://');
            const editPayload = {
                embeds: [embed],
                components: [buildTokensPanelRow()]
            };
            if (!usesAtt) {
                editPayload.attachments = [];
            }
            await msg.edit(editPayload).catch(() => {});
        } catch (e) { }
    }
}

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

function getBannerAttachment() {
    const candidates = ['banner_consultas.png', 'consultas.png', 'panel_consultas.png'];
    for (const file of candidates) {
        const bannerPath = path.join(__dirname, 'assets', file);
        if (fs.existsSync(bannerPath)) {
            return new AttachmentBuilder(bannerPath, { name: 'banner_consultas.png' });
        }
    }
    return null;
}

function buildPanelConsultasRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_consulta_privada')
            .setLabel('Consulta Privada')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔒')
    );
}

function buildPanelConsultasEmbed(isStaffChannel = false, guildId = null) {
    const v = guildManager.resolveGuildVisuals(guildId, 'consultas');
    const logoUrl = v.logoUrl;
    const serverName = v.name || 'VALLECAS RP';
    const gCfg = guildManager.getGuildConfig(guildId);
    const cleanSecs = parseInt(gCfg.AI_AUTOCLEAN_SECONDS, 10) || 90;

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `SISTEMA DE CONSULTAS | ${serverName}`,
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('🧠 CONSULTAS DE LAS NORMATIVAS OFICIALES')
        .setDescription(
            `Bienvenido al **Canal Oficial de Consultas con Inteligencia Artificial** exclusivo de **${serverName}** 🇪🇸.\n\n` +
            `Este sistema resuelve al instante cualquier duda sobre **todas nuestras normativas oficiales** (general, ilegales, negocios, facciones, conceptos de rol, sanciones, zonas seguras y vehículos) con base 100% oficial.\n\n` +
            `💬 **Consulta Pública *(visible en el canal)***\n` +
            `> • Escribe tu duda directamente en este canal hablando normalmente y la IA te responderá al instante.\n` +
            `> • Pulsa **"🗑️ Cerrar / Borrar"** al terminar *(auto-borrado preventivo a los ${cleanSecs} segundos)*.\n\n` +
            `🔒 **Consulta Privada *(solo la ves tú)***\n` +
            `> • Pulsa el botón **"🔒 Consulta Privada"** de abajo, escribe tu duda y pulsa **Enviar**.\n` +
            `> • Recibirás la respuesta en modo privado dentro del canal (**nadie más verá tu pregunta ni la respuesta**; auto-borrado a los ${cleanSecs} segundos).\n\n` +
            `💡 *Este mensaje informativo es permanente.*`
        )
        .setFooter({
            text: `${serverName} • Sistema Oficial de Consultas`,
            iconURL: logoUrl
        })
        .setTimestamp();

    if (v.bannerUrl) {
        embed.setImage(v.bannerUrl);
    }

    return embed;
}

async function loadConfig() {
    try {
        const config = await BotSetting.findOne({ key: 'consultas_ai_activo' });
        if (config !== null && config.value !== undefined) {
            consultasActivas = !!config.value;
        }

        // Cargar canales de consultas desde config.json o BotSetting
        const configPath = path.join(__dirname, 'config.json');
        if (fs.existsSync(configPath)) {
            try {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (cfg.CHANNEL_CONSULTAS_STAFF_ID) CANAL_CONSULTAS_ID = cfg.CHANNEL_CONSULTAS_STAFF_ID;
                if (cfg.CHANNEL_CONSULTAS_USERS_ID) CANAL_CONSULTAS_USERS_ID = cfg.CHANNEL_CONSULTAS_USERS_ID;
                if (cfg.CHANNEL_CONSULTAS_LOGS_ID) CANAL_CONSULTAS_LOGS_ID = cfg.CHANNEL_CONSULTAS_LOGS_ID;
            } catch (e) { }
        }

        const settingStaff = await BotSetting.findOne({ key: 'CHANNEL_CONSULTAS_STAFF_ID' });
        if (settingStaff && settingStaff.value) CANAL_CONSULTAS_ID = settingStaff.value;

        const settingUsers = await BotSetting.findOne({ key: 'CHANNEL_CONSULTAS_USERS_ID' });
        if (settingUsers && settingUsers.value) CANAL_CONSULTAS_USERS_ID = settingUsers.value;

        const settingLogs = await BotSetting.findOne({ key: 'CHANNEL_CONSULTAS_LOGS_ID' });
        if (settingLogs && settingLogs.value !== undefined) CANAL_CONSULTAS_LOGS_ID = settingLogs.value || '';

        // Cargar estadísticas de tokens y referencia del panel en vivo desde MongoDB
        const savedStats = await BotSetting.findOne({ key: 'groq_tokens_stats' });
        if (savedStats && savedStats.value && savedStats.value.date === getUtcDateKey()) {
            tokenStats = savedStats.value;
            ensureTodayTokenStats();
        }
        const savedPanel = await BotSetting.findOne({ key: 'groq_tokens_panel' });
        if (savedPanel && savedPanel.value && savedPanel.value.channelId && savedPanel.value.messageId) {
            tokensPanelRef = savedPanel.value;
        }
        const savedDailyReset = await BotSetting.findOne({ key: 'groq_tokens_last_daily_reset' });
        if (savedDailyReset && typeof savedDailyReset.value === 'string') {
            lastDailyResetPanelDate = savedDailyReset.value;
        }

        // Cargar las páginas de la normativa directamente desde MongoDB o localmente
        const docGeneral = await NormativaDoc.findOne({ key: 'normativa_general_2026' });
        if (docGeneral && docGeneral.pages && docGeneral.pages.length > 0) {
            memoriaNormativaPages = docGeneral.pages.map(p => p.text);
            console.log(`📚 [CONSULTAS AI] Cargadas ${memoriaNormativaPages.length} páginas de la normativa general desde MongoDB.`);
        } else {
            const localTxt = path.join(__dirname, 'normativa_vallecas_completa.txt');
            if (fs.existsSync(localTxt)) {
                const fullContent = fs.readFileSync(localTxt, 'utf8');
                memoriaNormativaPages = fullContent.split(/(?=VALLECAS RP\s*\n\|\s*NORMATIVA GENERAL OFICIAL)/i).map(p => p.trim());
            }
        }

        // Cargar la Normativa de Ilegales desde MongoDB (o respaldo local)
        const docIlegales = await NormativaDoc.findOne({ key: 'normativa_ilegales_2026' });
        if (docIlegales && docIlegales.pages && docIlegales.pages.length > 0) {
            if (!memoriaNormativaPages) memoriaNormativaPages = [];
            memoriaNormativaPages.push(...docIlegales.pages.map(p => p.text));
            console.log(`🔫 [CONSULTAS AI] Cargadas ${docIlegales.pages.length} secciones de la Normativa de Ilegales desde MongoDB.`);
        } else {
            const ilegalesTxt = path.join(__dirname, 'normativa_ilegales.txt');
            if (fs.existsSync(ilegalesTxt)) {
                const ilegalesContent = fs.readFileSync(ilegalesTxt, 'utf8');
                const ilegalesSections = ilegalesContent.split(/_{5,}|\n\n(?=[0-9]+\.\s+[A-ZÁÉÍÓÚÑ\s]+)/).map(s => s.trim()).filter(Boolean);
                if (ilegalesSections.length > 0) {
                    if (!memoriaNormativaPages) memoriaNormativaPages = [];
                    memoriaNormativaPages.push(...ilegalesSections);
                    console.log(`🔫 [CONSULTAS AI] Cargadas ${ilegalesSections.length} secciones de la Normativa de Ilegales desde archivo local.`);
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS IA] Error cargando config y normativa:', e.message);
    }
}

// Siglas y términos cortos de RP (2 letras) que NO deben filtrarse nunca
const SHORT_RP_TERMS = new Set([
    'rk', 'pk', 'ck', 'mg', 'pg', 'dm', 'hk', 'ic', 'zs', 'bh', 'bj', 'cj', 'ba', 'bd', 'pj', 'wl', 'rp', 'f8', 'ak', 'me', 'do'
]);

// Siglas RP que reciben máxima prioridad en la búsqueda por palabra completa
const PRIORITY_RP_TERMS = new Set([
    'rk', 'pk', 'pkt', 'ck', 'mg', 'pg', 'dm', 'rdm', 'vdm', 'hk', 'nvv', 'nvl',
    'ic', 'ooc', 'iooc', 'rde', 'zs', 'bh', 'bj', 'cj', 'ba', 'bd', 'f8', 'ems', 'lspd', 'cnp'
]);

// Diccionario inteligente de sinónimos, siglas RP y jerga FiveM / española
const JERGA_SINONIMOS = {
    'rk': ['rk', 'revenge kill', 'venganza', 'vengarse', 'vengarte', '24 horas', 'represalias'],
    'pk': ['pk', 'pkt', 'player kill', 'perdida de memoria', 'memoria', 'inconsciente', 'reanimado', 'reaniman'],
    'ck': ['ck', 'character kill', 'cadena perpetua', 'perpetua', 'muerte definitiva', 'multas', 'droga', 'matarle el pj', 'borrar pj'],
    'mg': ['mg', 'metagaming', 'metagame', 'informacion ooc', 'directo', 'twitch', 'tapado', 'reconocer'],
    'pg': ['pg', 'powergaming', 'powergame', 'imposible', 'irreal', 'montana', 'animaciones', 'cargar', 'bh', 'bunny hop'],
    'dm': ['dm', 'rdm', 'deathmatch', 'matar sin rol', 'matar', 'agredir', 'golpear', 'sin rol previo'],
    'vdm': ['vdm', 'vehicle deathmatch', 'atropell', 'embestir', 'embist', 'vehiculo como arma', 'vehiculos como arma', 'coche como arma'],
    'hk': ['hk', 'helikill', 'helicoptero', 'helico', 'helices', 'vehiculos aereos'],
    'nvv': ['nvv', 'nvl', 'no valoracion de vida', 'valorar vida', 'valorar la vida', 'valoracion de vida', 'no valorar', 'rendirte', 'apuntan'],
    'ic_ooc': ['ic', 'ooc', 'in character', 'out of character', 'fuera de personaje', 'dentro del personaje', 'iooc', 'faltas de respeto', 'insultar'],
    'evasion': ['evasion', 'evadir', 'combat log', 'f8', 'f8 quit', 'desconectarse', 'forzar reaparicion', 'coma', 'reanimacion'],
    'fairplay': ['fairplay', 'fair play', 'juego limpio', 'bug', 'bugs', 'ba', 'bug abuse', 'dupeo', 'desync', 'lagunas'],
    'comandos_rol': ['/me', '/do', 'tercera persona', 'mentir', 'pensamientos', 'sentimientos'],
    'negocio': ['local', 'tienda', 'negocio', 'empresa', 'comercio', 'badulaque', 'taller', 'mecanico', 'armeria', 'ammunation', 'discoteca', 'restaurante', 'cafeteria', 'jefe', 'empleado'],
    'cerrado': ['cerrado', 'cerrar', 'serrao', 'cerrao', 'inactivo', 'inactividad', 'abrir', 'abre', 'dias'],
    'robar': ['robo', 'robar', 'atraco', 'atracar', 'asaltar', 'asalto', 'botin', 'hurto', 'mangado', 'chafado', 'cj', 'car jacking', 'airdrop', 'drop'],
    'policia': ['lspd', 'cnp', 'cop', 'cops', 'agente', 'policia', 'policial', 'patrulla', 'persecucion', 'taser', 'cacheo', 'detencion', 'alerta', 'defcon', 'codigos'],
    'ems': ['ems', 'medico', 'hospital', 'ambulancia', 'reanimar', 'reanimacion', 'medikit', 'heridas', 'paciente', 'servicio'],
    'sancion': ['ban', 'baneo', 'jail', 'sancion', 'sanciones', 'strike', 'strikes', 'aviso', 'castigo', 'expulsion', 'permaban', 'gravedad', 'leve', 'grave'],
    'coche': ['coche', 'vehiculo', 'auto', 'moto', 'patrulla', 'conducir', 'disparar', 'blindado', 'torreta'],
    'arma': ['pistola', 'fusil', 'ak', 'escopeta', 'pesada', 'armamento', 'blanca', 'pipa', 'plomo', 'sns', 'smg', 'lanzacohetes'],
    'secuestro': ['secuestro', 'secuestrar', 'rapto', 'retener', 'rehen', 'rehenes', 'rescate'],
    'guerra': ['guerra', 'tiroteo', 'banda', 'bandas', 'mafia', 'mafias', 'pacto', 'alianza', 'barrio', 'cartel', 'carteles', 'ilegal', 'ilegales', 'limite', 'cupo', 'integrantes', 'sede', 'norte', 'organizacion'],
    'entorno': ['entorno', 'rde', 'rol de entorno', 'comisaria', 'zona segura', 'zs', 'evasion', 'campeo', 'caliente', '/911']
};

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countTermMatches(text, term) {
    if (!term) return 0;
    const escaped = escapeRegex(term);
    // Para siglas cortas (<= 3 letras) exigir límite de palabra exacta para evitar falsos positivos (ej: "ic" en "policia")
    const pattern = term.length <= 3
        ? new RegExp(`\\b${escaped}\\b`, 'g')
        : new RegExp(escaped, 'g');
    return (text.match(pattern) || []).length;
}

// Helper para buscar las páginas y secciones más relevantes de la normativa según la pregunta
function getRelevantNormativaSnippets(question, customPages = null) {
    let pagesSource = customPages;
    if (!pagesSource) {
        if (!memoriaNormativaPages || memoriaNormativaPages.length === 0) {
            memoriaNormativaPages = [];
            const localTxt = path.join(__dirname, 'normativa_vallecas_completa.txt');
            if (fs.existsSync(localTxt)) {
                const fullContent = fs.readFileSync(localTxt, 'utf8');
                memoriaNormativaPages.push(...fullContent.split(/(?=VALLECAS RP\s*\n\|\s*NORMATIVA GENERAL OFICIAL)/i).map(p => p.trim()));
            }
            const ilegalesTxt = path.join(__dirname, 'normativa_ilegales.txt');
            if (fs.existsSync(ilegalesTxt)) {
                const ilegalesContent = fs.readFileSync(ilegalesTxt, 'utf8');
                const ilegalesSections = ilegalesContent.split(/_{5,}|\n\n(?=[0-9]+\.\s+[A-ZÁÉÍÓÚÑ\s]+)/).map(s => s.trim()).filter(Boolean);
                memoriaNormativaPages.push(...ilegalesSections);
            }
        }
        pagesSource = memoriaNormativaPages;
    }
    if (!pagesSource || pagesSource.length === 0) return '';

    try {
        const stopWords = new Set([
            'para', 'como', 'pero', 'este', 'esta', 'esto', 'sobre', 'todo', 'toda', 'donde', 'cuando',
            'quien', 'porque', 'mucho', 'poco', 'tiempo', 'pasa', 'queda', 'hace', 'deha', 'nota', 'cosa',
            'que', 'cual', 'cuales', 'pone', 'algo', 'significa', 'quiere', 'decir', 'puede', 'puedo',
            'pueden', 'podria', 'debe', 'debo', 'hacer', 'tiene', 'tengo', 'tienen', 'normativa', 'norma',
            'normas', 'regla', 'reglas', 'vallecas', 'vilacity', 'server', 'servidor', 'aqui', 'duda',
            'pregunta', 'saber', 'hay', 'son', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'con',
            'sin', 'por', 'algun', 'alguna', 'cuanto', 'cuantos', 'cuanta', 'cuantas'
        ]);

        // Stemmer ligero de español para emparejar gerundios, participios, infinitivos y plurales
        // Ej: atropellando -> atropell, secuestrando -> secuestr, sanciones -> sancion, empleados -> emplead
        const spanishStem = (w) => {
            if (!w || w.length < 6) return w;
            return w
                .replace(/(amiento|imiento|aciones|iciones|adores|adoras)$/i, '')
                .replace(/(acion|icion|ando|iendo|arse|erse|irse|ados|adas|idos|idas|ado|ido|ar|er|ir)$/i, '')
                .replace(/(ciones|siones|ces)$/i, '')
                .replace(/(es|s)$/i, '');
        };

        const qClean = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const rawTokens = qClean.split(/[^a-z0-9]+/i).filter(Boolean);

        // Mantener palabras normales (>=3 chars sin stopwords) Y siglas RP de 2 letras (RK, HK, MG, PG, PK, CK, DM, IC, ZS...)
        const directWords = new Set(
            rawTokens.filter(w => SHORT_RP_TERMS.has(w) || (w.length >= 3 && !stopWords.has(w)))
        );

        // Raíces españolas de palabras largas (>=6 chars) para detectar cualquier conjugación/plural
        const stemWords = new Set();
        for (const w of directWords) {
            const st = spanishStem(w);
            if (st && st.length >= 4 && st !== w && !directWords.has(st)) {
                stemWords.add(st);
            }
        }

        // Expandir palabras clave con jerga y sinónimos (usando palabra completa para siglas cortas)
        const synonymWords = new Set();
        const matchedCategories = new Set();
        for (const [catKey, list] of Object.entries(JERGA_SINONIMOS)) {
            const matched = list.some(s => countTermMatches(qClean, s) > 0);
            if (matched) {
                matchedCategories.add(catKey);
                list.forEach(w => {
                    if (!directWords.has(w)) synonymWords.add(w);
                });
            }
        }

        // Detectar dominios de normativa mencionados en la pregunta para priorizar el documento exacto
        const wantsGeneral = matchedCategories.has('vdm') || matchedCategories.has('dm') || matchedCategories.has('pg')
            || matchedCategories.has('mg') || matchedCategories.has('rk') || matchedCategories.has('pk')
            || matchedCategories.has('ck') || matchedCategories.has('nvv') || matchedCategories.has('evasion')
            || matchedCategories.has('ic_ooc') || matchedCategories.has('comandos_rol') || matchedCategories.has('entorno')
            || /\b(general|zona segura|sancion|sanciones|ban|multa|cop bait|stream snip)\b/i.test(qClean);
        const wantsEms = matchedCategories.has('ems') || /\b(ems|medic|hospital|ambulanc|reanim|medikit)\b/i.test(qClean);
        const wantsPolicia = matchedCategories.has('policia') || /\b(polici|lspd|cnp|patrull|taser|cacheo|persecuc|deten|arrest|defcon)\b/i.test(qClean);
        const wantsNegocios = matchedCategories.has('negocio') || /\b(negoci|mecanic|taller|armeri|ammunation|badulaque|discotec|restauran|cafeter|emplead|encargad)\b/i.test(qClean);
        const wantsIlegales = matchedCategories.has('guerra') || matchedCategories.has('robar') || matchedCategories.has('secuestro')
            || /\b(ilegal|banda|mafia|cartel|organizacion|sede|norte|airdrop|drop|blindad|torreta|atraco|secuestr|rehen)\b/i.test(qClean);

        // Puntuación de relevancia por página
        const scored = pagesSource.map(page => {
            const pageLower = page.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const firstLine = pageLower.split('\n')[0] || '';
            let score = 0;

            // 1. Coincidencias directas con lo que preguntó el usuario (máxima prioridad)
            for (const word of directWords) {
                const occurrences = countTermMatches(pageLower, word);
                if (occurrences > 0) {
                    const baseWeight = PRIORITY_RP_TERMS.has(word) ? 14 : (word.length >= 5 ? 6 : 3);
                    score += baseWeight + Math.min(occurrences, 5) * 2;
                }
            }

            // 2. Coincidencias por raíz española (atropellando -> atropell -> atropellar)
            for (const st of stemWords) {
                const occurrences = countTermMatches(pageLower, st);
                if (occurrences > 0) {
                    score += 7 + Math.min(occurrences, 4) * 2;
                }
            }

            // 3. Coincidencias por sinónimos / expansión de siglas
            for (const word of synonymWords) {
                const occurrences = countTermMatches(pageLower, word);
                if (occurrences > 0) {
                    const baseWeight = PRIORITY_RP_TERMS.has(word) ? 10 : 3;
                    score += baseWeight + Math.min(occurrences, 4);
                }
            }

            // 4. Priorización por documento exacto cuando la pregunta pertenece a esa normativa
            if (score > 0) {
                if (wantsGeneral && firstLine.includes('normativa general')) score += 10;
                if (wantsEms && firstLine.includes('normativa de ems')) score += 12;
                if (wantsPolicia && firstLine.includes('normativa policial')) score += 12;
                if (wantsNegocios && firstLine.includes('normativa de negocios')) score += 12;
                if (wantsIlegales && firstLine.includes('normativa de ilegales')) score += 10;
            }

            // 5. Penalizar portadas e índices para priorizar siempre los artículos completos
            if ((pageLower.includes('indice general') || pageLower.includes('indice de contenidos') || pageLower.length < 320) && score > 0) {
                score = Math.max(1, score - 12);
            }

            return { page, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const cleanPage = (txt) => txt
            .replace(/VALLECAS RP\s*\r?\n\|\s*NORMATIVA GENERAL OFICIAL[\s\S]*?Documento de obligado cumplimiento/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Filtro dinámico de relevancia: envía solo las 2-4 páginas realmente relevantes (ahorra ~65% de tokens sin perder precisión)
        const topScore = scored[0]?.score || 0;
        const minRelevantScore = Math.max(4, Math.floor(topScore * 0.4));
        const selected = scored
            .filter((s, idx) => s.score > 0 && (idx < 2 || s.score >= minRelevantScore))
            .slice(0, 4);

        const bestMatches = selected
            .map(s => cleanPage(s.page))
            .join('\n---\n');
        return bestMatches.slice(0, 5200);
    } catch (e) {
        return '';
    }
}

/**
 * Formatea y embellece cualquier respuesta de la IA para Discord Embeds:
 * - Convierte tablas Markdown (| col | col |) que Discord NO renderiza en bloques limpios con viñetas y flechas
 * - Reemplaza separadores "---" por líneas divisorias elegantes "────────────────────────────"
 * - Reemplaza encabezados "# / ## / ###" por títulos con formato "emoji┃**Título**"
 */
function formatAiResponseForDiscord(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    const lines = rawText.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();

        // 1. Detectar bloque de tabla Markdown (| ... |) y convertirlo a lista Discord elegante
        if (trimmed.startsWith('|') && trimmed.endsWith('|') && (trimmed.match(/\|/g) || []).length >= 3) {
            const tableRows = [];
            while (i < lines.length) {
                const t = lines[i].trim();
                if (!t.startsWith('|') || !t.endsWith('|')) break;
                const cells = t.slice(1, -1).split('|').map(c => c.trim());
                tableRows.push(cells);
                i++;
            }

            // Filtrar fila separadora | :--- | :--- | y posible cabecera
            const isSepRow = (cells) => cells.every(c => /^:?-{2,}:?$/.test(c));
            let startIdx = 0;
            if (tableRows.length >= 2 && isSepRow(tableRows[1])) {
                startIdx = 2; // saltar cabecera + separador
            } else if (tableRows.length >= 1 && isSepRow(tableRows[0])) {
                startIdx = 1;
            }

            for (let r = startIdx; r < tableRows.length; r++) {
                const cells = tableRows[r].filter(Boolean);
                if (cells.length === 0) continue;
                const c0Clean = cells[0].replace(/^\*\*|\*\*$/g, '').trim();
                let dot = '•';
                if (/^leve$/i.test(c0Clean)) dot = '🟡';
                else if (/^grave$/i.test(c0Clean)) dot = '🟠';
                else if (/^muy\s*grave|permanente|extrema$/i.test(c0Clean)) dot = '🔴';

                if (cells.length === 1) {
                    out.push(`> ${dot} ${cells[0]}`);
                } else if (cells.length === 2) {
                    out.push(`> ${dot} **${c0Clean}** ➔ \`${cells[1].replace(/`/g, '')}\``);
                } else {
                    const mid = cells.slice(1, -1).join(' · ');
                    const last = cells[cells.length - 1].replace(/`/g, '');
                    out.push(`> ${dot} **${c0Clean}:** ${mid} ➔ \`${last}\``);
                }
            }
            continue;
        }

        // 2. Separadores Markdown (---, ***, ___) -> línea divisoria elegante
        if (/^[-*_]{3,}$/.test(trimmed)) {
            out.push('────────────────────────────');
            i++;
            continue;
        }

        // 3. Encabezados Markdown (# / ## / ###) -> formato emoji┃**Título**
        const headingMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
        if (headingMatch) {
            const hText = headingMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
            const hasLeadingEmoji = /^\p{Extended_Pictographic}/u.test(hText);
            out.push(hasLeadingEmoji ? `**${hText}**` : `📌┃**${hText}**`);
            i++;
            continue;
        }

        // 4. Convertir listas simples "- item" o "* item" en citas elegantes "> • item"
        if (/^[-*•]\s+/.test(trimmed)) {
            out.push(`> • ${trimmed.replace(/^[-*•]\s+/, '')}`);
            i++;
            continue;
        }

        out.push(lines[i]);
        i++;
    }

    return out
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/(────────────────────────────\n?){2,}/g, '────────────────────────────\n')
        .trim();
}

/**
 * Consulta la IA de Groq inyectando toda la base de conocimientos aprendida
 */
async function queryGroqAI(userQuestion, isUserMode = false, client = null, guildId = null) {
    const apiKeys = getConfiguredApiKeys();
    if (apiKeys.length === 0) return null;

    const isPrimary = !guildId || guildManager.isPrimaryGuild(guildId);
    const gVis = guildManager.resolveGuildVisuals(guildId);
    const serverName = gVis.name || 'VALLECAS RP';

    const qLower = userQuestion.toLowerCase();
    if (isPrimary && qLower.includes('anubis')) {
        const bromasAnubis = [
            'Creo que eso no es posible... De hecho, es más fácil que Siria deje las guerras a que consigas hablar con Anubis. Sigue soñando, compañero. 😂',
            '¿Hablar con Anubis? Tienes más probabilidades de tener una cena privada con el Papa en el Vaticano que de verle contestar al Discord. Búscate a otro Staff, crack. 💀',
            'Hablar con Anubis es como que te toque el Euromillones dos veces seguidas sin haber comprado boleto. Si tienes prisa, mejor reza un padrenuestro. 🍀',
            'Anubis es un ser mitológico que solo baja a la Tierra en año bisiesto si los astros se alinean. Sigue esperando sentado que de pie te vas a cansar. 🏛️',
            'He consultado los registros del universo y es más fácil encontrar agua líquida en el Sol que pillar a Anubis disponible. Inténtalo en otra reencarnación. ⏳',
            'Dicen las malas lenguas que Anubis solo habla con mortales cuando lluevan billetes de 500€ en Vallecas. Mejor búscate a otro moderador. 💸',
            'Espera sentado... De hecho, ponte cómodo, hazte unas palomitas y ponte una trilogía entera, porque la respuesta de Anubis va para largo. 🍿'
        ];
        return bromasAnubis[Math.floor(Math.random() * bromasAnubis.length)];
    }

    try {
        // 1. Fragmentos directos de la normativa EXCLUSIVA de este servidor
        const serverPages = await getGuildNormativaPages(guildId);
        const exactNormativaText = getRelevantNormativaSnippets(userQuestion, serverPages);

        // 2. Conocimientos específicos en MongoDB desde la DB dedicada de este servidor
        let knowledgeContext = '';
        try {
            const KnowledgeModel = isPrimary
                ? TicketKnowledge
                : guildManager.getGuildModel(guildId, 'TicketKnowledge', ticketKnowledgeSchema);
            const knowledgeFilter = isPrimary
                ? { $or: [{ guildId: null }, { guildId: '' }, { guildId: { $exists: false } }] }
                : {};
            const allKnowledge = await KnowledgeModel.find(knowledgeFilter).sort({ createdAt: -1 }).limit(40);
            if (allKnowledge && allKnowledge.length > 0) {
                const qNorm = userQuestion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const qTerms = qNorm.split(/[^a-z0-9]+/i).filter(w => SHORT_RP_TERMS.has(w) || w.length >= 3);
                const relevantKnowledge = allKnowledge
                    .filter(k => {
                        const txt = (k.response || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        return qTerms.some(t => countTermMatches(txt, t) > 0);
                    })
                    .slice(0, 10);

                const finalNotes = relevantKnowledge.length >= 4
                    ? relevantKnowledge
                    : [...relevantKnowledge, ...allKnowledge.filter(k => !relevantKnowledge.includes(k)).slice(0, 4 - relevantKnowledge.length)];

                if (finalNotes.length > 0) {
                    knowledgeContext = `\nNOTAS Y DIRECTRICES EXTRA DE ${serverName}:\n` +
                        finalNotes.map(k => `• ${k.response}`).join('\n').slice(0, 1500) + '\n';
                }
            }
        } catch (e) { }

        const customConciencia = gVis.config?.AI_CONCIENCIA
            ? `\nCONCIENCIA Y PERSONALIDAD PROPIA DE ${serverName}:\n${gVis.config.AI_CONCIENCIA}\n`
            : '';

        const roleLine = isUserMode
            ? `Eres la IA Oficial de ${serverName} (FiveM) para usuarios. Responde en español de España de forma exacta, clara, cercana y bien estructurada (citas de artículos, cifras exactas de dinero/policías/tiempos y excepciones si existen).`
            : `Eres la IA Asesora Oficial de ${serverName} (FiveM) para el Staff. Responde en español de España de forma ultra precisa, directa y completa (cita artículos exactos, cifras, tiempos, sanciones aplicables y excepciones).`;

        const rpFallback = !exactNormativaText
            ? `Todavía no se ha cargado el documento de normativa específica de ${serverName}. Responde con las definiciones reales estándar de FiveM Roleplay en español (PG = PowerGaming, MG = MetaGaming, RK = Revenge Kill, PK = Player Kill, CK = Character Kill, RDM/DM = Random Deathmatch, VDM = Vehicle Deathmatch, HK = Helicopter Kill, NVV = No Valorar Vida, CJ = Car Jacking, BH = Bunny Hop, BA = Bug Abuse, IOOC = Insultos OOC, ZS = Zona Segura) y aclara brevemente que para cifras o sanciones concretas de ${serverName} el Staff puede subir su normativa con !subirnormativa.`
            : exactNormativaText;

        const discordFormatRules =
            `\nFORMATO DISCORD: Prohibido tablas "| col |" y "---" o "#". Usa títulos "emoji┃**Título** *(Art. X)*", filas "> • **Dato:** detalle ➔ \`valor\`", backticks en sanciones/tiempos/comandos y "────────────────────────────" entre bloques.\n`;

        const antiErrorRules =
            `PRECISIÓN ABSOLUTA: Basa el 100% de tu respuesta SOLO en los fragmentos oficiales de abajo. Si algo está prohibido, empieza por "❌ **NO, está prohibido...**" citando normativa y artículo. No inventes cifras, excepciones ni artículos. Nunca menciones otro servidor.\n`;

        const systemPrompt =
            `${roleLine}${customConciencia}${antiErrorRules}${discordFormatRules}\n` +
            `Entiende jerga FiveM/faltas y siglas RP (RK, PK, CK, MG, PG, DM, VDM, HK, NVV, ZS, F8...). Normativa oficial de ${serverName}:\n\n` +
            rpFallback +
            knowledgeContext;

        ensureTodayTokenStats();

        // Construir cola de intentos con balanceo rotativo entre núcleos:
        // Prioriza el mejor modelo repartido en round-robin entre todos los servidores para soportar decenas de usuarios simultáneos sin chocar con límites TPM.
        const startOffset = apiKeys.length > 0 ? (keyRoundRobinCursor++ % apiKeys.length) : 0;
        const rotatedKeys = apiKeys.length > 1
            ? [...apiKeys.slice(startOffset), ...apiKeys.slice(0, startOffset)]
            : apiKeys;

        const allSlots = [];
        for (const modelCfg of GROQ_MODELS) {
            for (const keyObj of rotatedKeys) {
                allSlots.push({ keyObj, modelCfg, slotKey: getSlotKey(keyObj.idx, modelCfg.id) });
            }
        }
        const nowTs = Date.now();
        const notExhausted = allSlots.filter(s => !tokenStats.models[s.slotKey]?.exhausted);
        const readySlots = notExhausted.filter(s => (slotTpmCooldowns.get(s.slotKey) || 0) <= nowTs);
        const coolingSlots = notExhausted.filter(s => (slotTpmCooldowns.get(s.slotKey) || 0) > nowTs);
        const slotsToTry = readySlots.length > 0
            ? [...readySlots, ...coolingSlots]
            : (notExhausted.length > 0 ? notExhausted : allSlots);

        for (const { keyObj, modelCfg, slotKey } of slotsToTry) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${keyObj.key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelCfg.id,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userQuestion }
                        ],
                        max_tokens: 900,
                        temperature: 0.0
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const rawReply = data.choices?.[0]?.message?.content?.trim();
                    const reply = formatAiResponseForDiscord(rawReply);
                    if (reply && reply.length > 5) {
                        const usedTokens = data.usage?.total_tokens || Math.ceil((systemPrompt.length + userQuestion.length + reply.length) / 4);
                        const st = tokenStats.models[slotKey];
                        st.tokensUsed += usedTokens;
                        st.requests += 1;
                        st.exhausted = false;
                        tokenStats.activeKeyIdx = keyObj.idx;
                        tokenStats.activeModel = modelCfg.id;
                        tokenStats.lastQueryTokens = usedTokens;

                        const gStatKey = guildId ? String(guildId) : 'primary';
                        if (!tokenStats.perGuild || typeof tokenStats.perGuild !== 'object') tokenStats.perGuild = {};
                        if (!tokenStats.perGuild[gStatKey]) {
                            tokenStats.perGuild[gStatKey] = { requests: 0, lastQueryTokens: 0 };
                        }
                        tokenStats.perGuild[gStatKey].requests += 1;
                        tokenStats.perGuild[gStatKey].lastQueryTokens = usedTokens;

                        saveTokenStats();
                        updateTokensPanel(client);
                        return reply;
                    }
                } else if (res.status === 429) {
                    const errText = await res.text().catch(() => '');
                    const isDailyLimit = /per day|TPD|RPD|daily/i.test(errText);
                    if (isDailyLimit) {
                        tokenStats.models[slotKey].exhausted = true;
                        console.warn(`⚠️ [CONSULTAS AI] ${keyObj.label} / ${modelCfg.id} agotó su límite diario. Saltando al siguiente respaldo...`);
                    } else {
                        slotTpmCooldowns.set(slotKey, Date.now() + 25000);
                        console.warn(`⚠️ [CONSULTAS AI] Rate limit temporal (TPM) en ${keyObj.label} / ${modelCfg.id}. Enfriando 25s y saltando al siguiente...`);
                    }
                    saveTokenStats();
                    updateTokensPanel(client);
                    continue;
                } else {
                    console.error(`⚠️ [CONSULTAS AI Error ${keyObj.label} / ${modelCfg.id}]:`, res.status, await res.text().catch(() => ''));
                    continue;
                }
            } catch (netErr) {
                console.error(`⚠️ [CONSULTAS AI Net Error ${keyObj.label} / ${modelCfg.id}]:`, netErr.message);
            }
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS AI Error]:', e.message);
    }
    return null;
}

function isMemberStaff(member) {
    if (!member || member.user.bot) return false;
    if (member.id === '418558256840179722' || member.id === '1308814761269395527') return true;
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? ROLE_STAFF_ID : '');
    if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

/**
 * Inicializador del módulo de Consultas IA
 */
function initConsultasAI(client) {
    loadConfig();

    // Auto-actualización diaria (1 sola vez al día) justo cuando se reinicia el cupo diario (00:00:05 UTC)
    const runDailyTokensPanelReset = async (reason = 'Reinicio diario 00:00 UTC') => {
        try {
            const todayUtc = getUtcDateKey();
            if (lastDailyResetPanelDate === todayUtc) return;

            ensureTodayTokenStats();
            await saveTokenStats();
            await updateTokensPanel(client);

            lastDailyResetPanelDate = todayUtc;
            await BotSetting.findOneAndUpdate(
                { key: 'groq_tokens_last_daily_reset' },
                { key: 'groq_tokens_last_daily_reset', value: todayUtc },
                { upsert: true }
            ).catch(() => {});

            console.log(`🔄 [CONSULTAS AI] Panel de tokens actualizado automáticamente por nuevo día (${todayUtc} UTC • ${reason}).`);
        } catch (e) {
            console.error('⚠️ [CONSULTAS AI] Error en auto-actualización diaria del panel de tokens:', e.message);
        }
    };

    const scheduleNextDailyTokensReset = () => {
        const now = new Date();
        // 00:00:05 UTC del día siguiente (5s de margen para asegurar cambio de fecha UTC limpio)
        const nextMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5));
        const msUntilReset = Math.max(5000, nextMidnightUtc.getTime() - now.getTime());

        setTimeout(async () => {
            await runDailyTokensPanelReset('Cambio de día automático');
            scheduleNextDailyTokensReset();
        }, msUntilReset);
    };

    // Sincroniza el recuento real de "Consultas hoy" de un servidor leyendo su propio canal de logs (desde 00:00 UTC de hoy)
    async function syncGuildCountFromLogChannel(guildId) {
        if (!guildId) return;
        try {
            ensureTodayTokenStats();
            const gChannels = getChannelsForGuild(guildId);
            if (!gChannels.logsId) return;
            const logCh = client.channels.cache.get(gChannels.logsId) || await client.channels.fetch(gChannels.logsId).catch(() => null);
            if (!logCh || !logCh.isTextBased()) return;

            const now = new Date();
            const todayUtcStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

            let logCount = 0;
            let newestTokens = 0;
            let newestTs = 0;
            let beforeId = undefined;

            for (let page = 0; page < 5; page++) {
                const fetched = await logCh.messages.fetch({ limit: 100, ...(beforeId ? { before: beforeId } : {}) }).catch(() => null);
                if (!fetched || fetched.size === 0) break;

                let reachedOlderDay = false;
                for (const m of fetched.values()) {
                    if (m.createdTimestamp < todayUtcStartMs) {
                        reachedOlderDay = true;
                        continue;
                    }
                    if (m.author?.id !== client.user?.id) continue;
                    const emb = m.embeds?.[0];
                    if (!emb || !emb.author?.name?.includes('LOG DE CONSULTA IA')) continue;

                    logCount++;
                    if (m.createdTimestamp >= newestTs) {
                        newestTs = m.createdTimestamp;
                        const tokMatch = (emb.description || '').match(/\+([\d.,]+)\s*tokens/i);
                        if (tokMatch) {
                            const parsed = parseInt(tokMatch[1].replace(/[.,]/g, ''), 10);
                            if (!isNaN(parsed) && parsed > 0) newestTokens = parsed;
                        }
                    }
                }

                if (reachedOlderDay || fetched.size < 100) break;
                beforeId = fetched.last()?.id;
                if (!beforeId) break;
            }

            const gKey = String(guildId);
            if (!tokenStats.perGuild || typeof tokenStats.perGuild !== 'object') tokenStats.perGuild = {};
            const cur = tokenStats.perGuild[gKey] || { requests: 0, lastQueryTokens: 0 };
            const updatedReqs = Math.max(Number(cur.requests) || 0, logCount);
            const updatedLast = (logCount > 0 && newestTokens > 0) ? newestTokens : (Number(cur.lastQueryTokens) || 0);

            if (updatedReqs !== cur.requests || updatedLast !== cur.lastQueryTokens) {
                tokenStats.perGuild[gKey] = { requests: updatedReqs, lastQueryTokens: updatedLast };
                await saveTokenStats();
            }
        } catch (e) { }
    }

    // Comprobar una vez al arrancar por si el reinicio ocurrió mientras el bot estaba reiniciando + programar 00:00:05 UTC
    const startDailyResetScheduler = () => {
        setTimeout(async () => {
            // Precargar la caché de normativas de todos los servidores secundarios y sincronizar el contador de consultas desde cada canal de logs
            for (const guild of client.guilds.cache.values()) {
                if (!guildManager.isPrimaryGuild(guild.id)) {
                    guildNormativaCache.delete(String(guild.id));
                    await getGuildNormativaPages(guild.id).catch(() => {});
                }
                await syncGuildCountFromLogChannel(guild.id).catch(() => {});
            }
            await runDailyTokensPanelReset('Verificación al arrancar');
            // Limpiar cualquier adjunto huérfano (logo gigante) y reflejar el recuento real de hoy en todos los paneles
            await updateTokensPanel(client).catch(() => {});
        }, 8000);
        scheduleNextDailyTokensReset();
    };
    if (client.isReady()) {
        startDailyResetScheduler();
    } else {
        client.once('ready', startDailyResetScheduler);
    }

    // Permite actualizar los canales en tiempo real cuando se usa !setcanal sin reiniciar el bot
    client.updateConsultasChannel = (key, channelId) => {
        if (key === 'CHANNEL_CONSULTAS_STAFF_ID' && channelId) {
            CANAL_CONSULTAS_ID = channelId;
            console.log(`🔄 [CONSULTAS AI] Canal Staff actualizado en vivo a: ${CANAL_CONSULTAS_ID}`);
        } else if (key === 'CHANNEL_CONSULTAS_USERS_ID') {
            CANAL_CONSULTAS_USERS_ID = channelId || '';
            console.log(`🔄 [CONSULTAS AI] Canal Usuarios actualizado en vivo a: ${CANAL_CONSULTAS_USERS_ID}`);
        } else if (key === 'CHANNEL_CONSULTAS_LOGS_ID') {
            CANAL_CONSULTAS_LOGS_ID = channelId || '';
            console.log(`🔄 [CONSULTAS AI] Canal Logs actualizado en vivo a: ${CANAL_CONSULTAS_LOGS_ID || 'Desactivado'}`);
        }
    };

    function getChannelsForGuild(guildId) {
        if (!guildId || guildManager.isPrimaryGuild(guildId)) {
            return {
                staffId: CANAL_CONSULTAS_ID,
                usersId: CANAL_CONSULTAS_USERS_ID,
                logsId: CANAL_CONSULTAS_LOGS_ID
            };
        }
        const cfg = guildManager.getGuildConfig(guildId);
        return {
            staffId: cfg.CHANNEL_CONSULTAS_STAFF_ID || '',
            usersId: cfg.CHANNEL_CONSULTAS_USERS_ID || '',
            logsId: cfg.CHANNEL_CONSULTAS_LOGS_ID || ''
        };
    }

    // Envía un registro limpio de cada consulta al canal de logs del servidor correspondiente (0 tokens consumidos)
    async function sendConsultaLog({ message, guild, channel, author, questionText, aiAnswer, isStaffChannel, isPrivateAiCommand, isPrivateModal }) {
        const targetGuild = guild || message?.guild;
        const targetChannel = channel || message?.channel;
        const targetAuthor = author || message?.author;
        if (!targetAuthor || !targetChannel) return;

        const gChannels = getChannelsForGuild(targetGuild?.id);
        if (!gChannels.logsId) return;
        try {
            const logCh = client.channels.cache.get(gChannels.logsId) || await client.channels.fetch(gChannels.logsId).catch(() => null);
            if (!logCh || !logCh.isTextBased()) return;

            const activeIdx = tokenStats.activeKeyIdx || 1;
            const lastToks = tokenStats.lastQueryTokens || 0;
            const userAvatar = targetAuthor.displayAvatarURL({ size: 128 });
            const origenTxt = isStaffChannel ? '🛡️ Consultas Staff' : '👥 Consultas Usuarios';
            const gVis = guildManager.resolveGuildVisuals(targetGuild?.id);
            const privateTag = isPrivateModal ? ' • 🔒 Consulta Privada' : (isPrivateAiCommand ? ' • 🔒 Privado (!ai)' : '');

            const safeQuestion = questionText.length > 900 ? questionText.slice(0, 897) + '...' : questionText;
            const safeAnswer = (aiAnswer || 'Sin respuesta (error temporal)').length > 1800
                ? aiAnswer.slice(0, 1797) + '...'
                : (aiAnswer || 'Sin respuesta (error temporal)');

            const logEmbed = new EmbedBuilder()
                .setColor(gVis.color)
                .setAuthor({
                    name: `LOG DE CONSULTA IA | ${targetAuthor.username}`,
                    iconURL: userAvatar
                })
                .setThumbnail(userAvatar)
                .setDescription(
                    `👤 **Usuario:** <@${targetAuthor.id}>\n` +
                    `📍 **Origen:** <#${targetChannel.id}> *(${origenTxt})*${privateTag}\n` +
                    `🔌 **Núcleo:** \`Núcleo IA ${activeIdx}\` • \`+${formatNum(lastToks)} tokens\`\n\n` +
                    `❓ **Pregunta realizada:**\n` +
                    `> ${safeQuestion.replace(/\n/g, '\n> ')}\n\n` +
                    `💡 **Respuesta del bot:**\n` +
                    `> ${safeAnswer.replace(/\n/g, '\n> ')}`
                )
                .setFooter({ text: `${gVis.name} • Registro Automático de Consultas IA` })
                .setTimestamp();

            await logCh.send({ embeds: [logEmbed] }).catch(() => {});
        } catch (e) {
            console.error('⚠️ [CONSULTAS AI LOG Error]:', e.message);
        }
    }

    console.log('🤖 [CONSULTAS AI] Sistema independiente cargado. Canal Staff:', CANAL_CONSULTAS_ID, '| Canal Usuarios:', CANAL_CONSULTAS_USERS_ID || 'No configurado');

    // Barrido automático multi-servidor cada 60s: garantiza que en TODOS los servidores (Vallecas, VilaCity, etc.)
    // cualquier consulta antigua (>90s) se auto-elimine incluso tras un reinicio de Railway, conservando el panel fijo.
    setInterval(async () => {
        try {
            const now = Date.now();
            for (const guild of client.guilds.cache.values()) {
                const gChs = getChannelsForGuild(guild.id);
                const gCfg = guildManager.getGuildConfig(guild.id);
                const maxAgeMs = Math.max(30, Number(gCfg.AI_AUTOCLEAN_SECONDS) || 90) * 1000;
                const channelIds = [gChs.staffId, gChs.usersId].filter(Boolean);

                for (const chId of channelIds) {
                    const ch = guild.channels.cache.get(chId);
                    if (!ch || !ch.isTextBased()) continue;
                    const fetched = await ch.messages.fetch({ limit: 30 }).catch(() => null);
                    if (!fetched || fetched.size === 0) continue;

                    for (const m of fetched.values()) {
                        if (m.pinned) continue;
                        if (now - m.createdTimestamp < maxAgeMs) continue;
                        const isPermanentPanel = m.author.id === client.user.id && m.embeds.some(e =>
                            e.title?.includes('CONSULTAS DE LA NORMATIVA OFICIAL') ||
                            e.title?.includes('CONSULTAS DE LAS NORMATIVAS OFICIALES') ||
                            e.title?.includes('DUDA SOBRE LA NORMATIVA') ||
                            e.title?.includes('ASESORÍA Y RESOLUCIÓN DE DUDAS') ||
                            e.title?.includes('RESOLUCIÓN DE DUDAS Y NORMATIVA OFICIAL')
                        );
                        if (!isPermanentPanel) {
                            await m.delete().catch(() => {});
                        }
                    }
                }
            }
        } catch (e) { }
    }, 60 * 1000);

    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot || !message.guild) return;

            const contentLower = message.content.trim().toLowerCase();
            const isStaff = isMemberStaff(message.member);

            // ==========================================
            // COMANDOS DE CONTROL (!consultas on/off/estado)
            // ==========================================
            if (contentLower === '!consultas on') {
                if (!isStaff) return;
                consultasActivas = true;
                await BotSetting.findOneAndUpdate({ key: 'consultas_ai_activo' }, { key: 'consultas_ai_activo', value: true }, { upsert: true });
                return message.reply('🟢 **Canal de Consultas IA ACTIVADO.** Los staffs pueden consultar dudas normalmente.');
            }

            if (contentLower === '!consultas off') {
                if (!isStaff) return;
                consultasActivas = false;
                await BotSetting.findOneAndUpdate({ key: 'consultas_ai_activo' }, { key: 'consultas_ai_activo', value: false }, { upsert: true });
                return message.reply('🔴 **Canal de Consultas IA DESACTIVADO.** Modo pausa.');
            }

            if (contentLower === '!consultas estado') {
                if (!isStaff) return;
                return message.reply(`ℹ️ El sistema de Consultas IA se encuentra: **${consultasActivas ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**.`);
            }

            if (contentLower === '!limpiarconsultas') {
                if (!isStaff) return;
                const gChs = getChannelsForGuild(message.guild?.id);
                if (message.channel.id !== gChs.staffId && message.channel.id !== gChs.usersId) {
                    return message.reply('❌ Este comando solo se puede usar en un canal de consultas.');
                }
                const msgs = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (msgs && msgs.size > 0) {
                    // Filtrar mensajes para no borrar nunca los paneles permanentes del bot
                    const msgsToDelete = msgs.filter(m => {
                        if (m.pinned) return false;
                        const isPanel = m.author.id === client.user.id && m.embeds.some(e =>
                            e.title?.includes('CONSULTAS DE LA NORMATIVA OFICIAL') ||
                            e.title?.includes('CONSULTAS DE LAS NORMATIVAS OFICIALES') ||
                            e.title?.includes('DUDA SOBRE LA NORMATIVA') ||
                            e.title?.includes('ASESORÍA Y RESOLUCIÓN DE DUDAS') ||
                            e.title?.includes('RESOLUCIÓN DE DUDAS Y NORMATIVA OFICIAL')
                        );
                        return !isPanel;
                    });
                    if (msgsToDelete.size > 0) {
                        await message.channel.bulkDelete(msgsToDelete, true).catch(() => {});
                    }
                }
                const temp = await message.channel.send('🧹 **Canal de consultas limpiado (el panel informativo permanente se conserva intacto).**');
                setTimeout(() => temp.delete().catch(() => {}), 4000);
                return;
            }

            // ==========================================
            // COMANDO PARA ENVIAR EL PANEL INFORMATIVO PERMANENTE: !panel-consultas / !panelconsultas
            // ==========================================
            if (['!panel-consultas', '!panelconsultas', '!panel-consulta', '!panelconsulta'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});

                const gId = message.guild?.id;
                const gChannels = getChannelsForGuild(gId);
                const isTargetStaff = (gChannels.staffId && message.channel.id === gChannels.staffId);

                const v = guildManager.resolveGuildVisuals(gId, 'consultas');
                const embed = buildPanelConsultasEmbed(isTargetStaff, gId);
                await message.channel.send({
                    embeds: [embed],
                    files: v.files,
                    components: [buildPanelConsultasRow()]
                }).catch(e => console.error('Error enviando panel consultas:', e));
                return;
            }

            // ==========================================
            // PANEL EN VIVO DE TOKENS IA: !panel-tokens / !tokens
            // ==========================================
            if (['!panel-tokens', '!paneltokens', '!tokens', '!ia-tokens', '!consultas tokens'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});

                const gId = message.guild?.id;
                await syncGuildCountFromLogChannel(gId).catch(() => {});
                const { files: tokFiles } = resolveTokensPanelLogo(gId, client);
                const embed = buildTokensPanelEmbed(gId, client);
                const sentPanel = await message.channel.send({
                    embeds: [embed],
                    files: tokFiles,
                    components: [buildTokensPanelRow()]
                }).catch(e => {
                    console.error('Error enviando panel de tokens:', e);
                    return null;
                });

                if (sentPanel && guildManager.isPrimaryGuild(gId)) {
                    tokensPanelRef = { channelId: sentPanel.channel.id, messageId: sentPanel.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'groq_tokens_panel' },
                        { key: 'groq_tokens_panel', value: tokensPanelRef },
                        { upsert: true }
                    ).catch(() => {});
                } else if (sentPanel) {
                    await guildManager.updateGuildConfig(gId, 'DASH_PANEL_TOKENS', { channelId: sentPanel.channel.id, messageId: sentPanel.id }, message.guild?.name).catch(() => {});
                }
                return;
            }

            // ==========================================
            // CONFIGURAR CANAL DE LOGS DE CONSULTAS: !logs-consultas [#canal | ID | off]
            // ==========================================
            if (contentLower === '!logs-consultas' || contentLower.startsWith('!logs-consultas ') || contentLower === '!logsconsultas' || contentLower.startsWith('!logsconsultas ')) {
                if (!isStaff) return;
                await message.delete().catch(() => {});

                const argsLog = message.content.trim().split(/\s+/);
                const param = (argsLog[1] || '').toLowerCase();

                if (param === 'off' || param === 'desactivar' || param === 'quitar') {
                    CANAL_CONSULTAS_LOGS_ID = '';
                    await BotSetting.findOneAndUpdate(
                        { key: 'CHANNEL_CONSULTAS_LOGS_ID' },
                        { key: 'CHANNEL_CONSULTAS_LOGS_ID', value: '' },
                        { upsert: true }
                    ).catch(() => {});
                    const offMsg = await message.channel.send('🔴 **Logs de Consultas IA desactivados.** Ya no se enviarán registros.');
                    setTimeout(() => offMsg.delete().catch(() => {}), 6000);
                    return;
                }

                const rawId = argsLog.slice(1).join(' ').match(/\d{17,20}/)?.[0];
                let targetCh = message.mentions.channels.first();
                if (!targetCh && rawId) {
                    targetCh = message.guild.channels.cache.get(rawId) || await client.channels.fetch(rawId).catch(() => null);
                }
                if (!targetCh) targetCh = message.channel;

                const gId = message.guild?.id;
                const vLog = guildManager.resolveGuildVisuals(gId);
                if (!gId || guildManager.isPrimaryGuild(gId)) {
                    CANAL_CONSULTAS_LOGS_ID = targetCh.id;
                    await BotSetting.findOneAndUpdate(
                        { key: 'CHANNEL_CONSULTAS_LOGS_ID' },
                        { key: 'CHANNEL_CONSULTAS_LOGS_ID', value: targetCh.id },
                        { upsert: true }
                    ).catch(() => {});
                } else {
                    await guildManager.updateGuildConfig(gId, 'CHANNEL_CONSULTAS_LOGS_ID', targetCh.id, message.guild?.name).catch(() => {});
                }

                const okEmbed = new EmbedBuilder()
                    .setColor(vLog.color)
                    .setTitle('📜 Canal de Logs de Consultas Configurado')
                    .setDescription(
                        `✅ Todas las consultas realizadas a la IA (tanto de **Staff** como de **Usuarios**) quedarán registradas automáticamente en <#${targetCh.id}> (\`${targetCh.id}\`).\n\n` +
                        `> ℹ️ *Consume **0 tokens** adicionales: simplemente guarda cada pregunta y respuesta del bot.*`
                    )
                    .setFooter({ text: `${vLog.name} • Logs de Consultas IA` })
                    .setTimestamp();

                const confMsg = await message.channel.send({ embeds: [okEmbed] }).catch(() => null);
                if (confMsg) setTimeout(() => confMsg.delete().catch(() => {}), 8000);
                return;
            }

            // ==========================================
            // COMANDOS MULTI-SERVIDOR DE NORMATIVA Y CONCIENCIA IA (AISLADOS POR SERVIDOR)
            // ==========================================
            // 1. !subirnormativa [general|ilegales] (adjuntando archivo .txt o pegando el texto)
            if (contentLower.startsWith('!subirnormativa') || contentLower.startsWith('!setnormativa')) {
                if (!isStaff) return;
                const gId = message.guild?.id;
                if (!gId) return;
                const parts = message.content.trim().split(/\s+/);
                const tipoArg = (parts[1] || 'general').toLowerCase();
                const isIlegales = ['ilegales', 'ilegal', 'bandas', 'mafias'].includes(tipoArg);
                const docKey = guildManager.isPrimaryGuild(gId)
                    ? (isIlegales ? 'normativa_ilegales_2026' : 'normativa_general_2026')
                    : `guild_${gId}_${isIlegales ? 'ilegales' : 'general'}`;

                let rawText = '';
                const att = message.attachments.first();
                if (att && att.url) {
                    try {
                        const r = await fetch(att.url);
                        if (r.ok) rawText = await r.text();
                    } catch (e) { }
                } else {
                    rawText = parts.slice(isIlegales || tipoArg === 'general' ? 2 : 1).join(' ').trim();
                }

                if (!rawText || rawText.length < 30) {
                    return message.reply('❌ **Uso:** escribe `!subirnormativa general` o `!subirnormativa ilegales` **adjuntando un archivo `.txt`** con la normativa de este servidor (o pegando el texto).');
                }

                const sections = splitNormativaIntoSections(rawText);
                const TargetNormativaModel = guildManager.isPrimaryGuild(gId)
                    ? NormativaDoc
                    : guildManager.getGuildModel(gId, 'NormativaDoc', normativaDocSchema);
                const targetKey = guildManager.isPrimaryGuild(gId)
                    ? docKey
                    : (isIlegales ? 'normativa_ilegales' : 'normativa_general');
                await TargetNormativaModel.findOneAndUpdate(
                    { key: targetKey },
                    { key: targetKey, content: rawText, pages: sections.map((t, idx) => ({ pageNumber: idx + 1, text: t })), updatedAt: new Date() },
                    { upsert: true }
                );

                // Recargar caché en RAM solo para este servidor
                if (guildManager.isPrimaryGuild(gId)) {
                    await loadConfig();
                } else {
                    guildNormativaCache.delete(String(gId));
                    await getGuildNormativaPages(gId);
                }

                const dbLabel = guildManager.getGuildDbName(gId) || 'spainrp_db';
                return message.reply(`✅ **Normativa \`${isIlegales ? 'Ilegales' : 'General'}\` guardada en la DB \`${dbLabel}\`** (\`${sections.length}\` secciones cargadas en la IA al instante).`);
            }

            // 2. !aprender <regla o dato> (guarda conocimiento exclusivo en la DB de este servidor)
            if (contentLower.startsWith('!aprender ')) {
                if (!isStaff) return;
                const gId = message.guild?.id;
                const nota = message.content.slice(10).trim();
                if (nota.length < 5) return message.reply('❌ **Uso:** `!aprender <regla o dato que quieres que la IA recuerde en este servidor>`');
                const TargetKnowledgeModel = guildManager.isPrimaryGuild(gId)
                    ? TicketKnowledge
                    : guildManager.getGuildModel(gId, 'TicketKnowledge', ticketKnowledgeSchema);
                await TargetKnowledgeModel.create({
                    guildId: guildManager.isPrimaryGuild(gId) ? null : String(gId),
                    category: 'normativa_extra',
                    keywords: [],
                    questionPattern: nota.slice(0, 120),
                    response: nota,
                    addedBy: message.author.username
                });
                const dbLabel = guildManager.getGuildDbName(gId) || 'spainrp_db';
                return message.reply(`🧠 **Aprendido en la DB \`${dbLabel}\`:**\n> ${nota}`);
            }

            // 3. !setconciencia <personalidad / instrucciones propias de la IA en este servidor>
            if (contentLower.startsWith('!setconciencia ')) {
                if (!isStaff) return;
                const gId = message.guild?.id;
                const conciencia = message.content.slice(15).trim();
                if (conciencia.length < 5) return message.reply('❌ **Uso:** `!setconciencia <tono, reglas de comportamiento o identidad de la IA en este servidor>`');
                await guildManager.setGuildConfigKey(gId, 'AI_CONCIENCIA', conciencia);
                return message.reply(`✨ **Conciencia/personalidad de la IA actualizada solo para este servidor:**\n> ${conciencia}`);
            }

            // ==========================================
            // ATENCIÓN DE CONSULTAS EN LOS CANALES (STAFF Y USUARIOS — MULTI-SERVIDOR)
            // ==========================================
            const gChannels = getChannelsForGuild(message.guild?.id);
            const isStaffChannel = Boolean(gChannels.staffId && message.channel.id === gChannels.staffId);
            const isUsersChannel = Boolean(gChannels.usersId && message.channel.id === gChannels.usersId);

            if (isStaffChannel || isUsersChannel) {
                // En el canal de Staff, solo permitimos al Staff
                if (isStaffChannel && !isStaff) {
                    await message.delete().catch(() => {});
                    const warn = await message.channel.send(`⛔ <@${message.author.id}>, este canal de consultas es exclusivo para el Staff. Si eres usuario, usa el canal de consultas de la comunidad.`);
                    setTimeout(() => warn.delete().catch(() => {}), 6000);
                    return;
                }

                if (!consultasActivas) {
                    await message.delete().catch(() => {});
                    const aviso = await message.channel.send(`⚠️ <@${message.author.id}>, el sistema de Consultas IA está actualmente desactivado por la Administración.`);
                    setTimeout(() => aviso.delete().catch(() => {}), 6000);
                    return;
                }

                // Detectar si el usuario quiere respuesta privada por MD usando el comando "!ai"
                const isPrivateAiCommand = message.content.toLowerCase().startsWith('!ai ');
                const questionText = isPrivateAiCommand 
                    ? message.content.slice(4).trim() 
                    : message.content.trim();

                if (questionText.length < 3) return;

                // Indicador visual de que la IA está procesando la consulta
                await message.channel.sendTyping().catch(() => {});

                // Consultar la IA adaptando el rol y la normativa EXCLUSIVA de este servidor
                const gId = message.guild?.id;
                const aiAnswer = await queryGroqAI(questionText, isUsersChannel, client, gId);

                // Registrar en el canal de logs de este servidor (0 tokens consumidos)
                sendConsultaLog({ message, questionText, aiAnswer, isStaffChannel, isPrivateAiCommand });

                const gVis = guildManager.resolveGuildVisuals(gId);
                const iconUrl = gVis.logoUrl;
                const replyFiles = gVis.files;

                // Diseño limpio y profesional adaptado a la marca y color de ESTE servidor
                const authorTitle = isStaffChannel
                    ? `ASESORÍA DE STAFF | ${gVis.name}`
                    : `CONSULTAS DE LA NORMATIVA | ${gVis.name}`;
                const embedColor = gVis.color;

                const safeAnswerDesc = (aiAnswer || 'Lo siento, no he podido obtener respuesta en este momento. Por favor, consulta directamente con la Administración o abre un ticket de soporte.').slice(0, 3550);

                const embed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setAuthor({
                        name: authorTitle,
                        iconURL: iconUrl
                    })
                    .setTitle('📋┃RESOLUCIÓN DE CONSULTA')
                    .setDescription(
                        `\u200B\n` +
                        `❓┃**Pregunta planteada**\n` +
                        `> *"${questionText.length > 200 ? questionText.slice(0, 197) + '...' : questionText}"*\n\n` +
                        `────────────────────────────\n\n` +
                        `💡┃**Respuesta Oficial**\n\n` +
                        `${safeAnswerDesc}\n\n` +
                        `────────────────────────────\n` +
                        (isPrivateAiCommand
                            ? `🔒 *Respuesta privada enviada por !ai (solo para tus ojos).*`
                            : `🗑️ *Pulsa el botón de abajo cuando termines de leer.*`)
                    )
                    .setThumbnail(iconUrl)
                    .setFooter({
                        text: `${gVis.name} • Base de Datos Oficial`,
                        iconURL: iconUrl
                    })
                    .setTimestamp();

                // ----------------------------------------------------
                // MODO 1: CON COMANDO !ai (100% PRIVADO Y OCULTO A LOS DEMÁS)
                // ----------------------------------------------------
                if (isPrivateAiCommand) {
                    // Borramos su comando en el canal para que nadie vea qué preguntó
                    await message.delete().catch(() => {});

                    try {
                        // Enviamos la respuesta por privado (MD) al usuario
                        await message.author.send({
                            embeds: [embed],
                            files: replyFiles
                        });
                    } catch (dmErr) {
                        // Si tiene los MD cerrados, avisar temporalmente
                        const notice = await message.channel.send(`⚠️ <@${message.author.id}>, tienes tus Mensajes Directos bloqueados. Habilítalos para recibir respuestas privadas de \`!ai\`.`);
                        setTimeout(() => notice.delete().catch(() => {}), 7000);
                    }
                    return;
                }

                // ----------------------------------------------------
                // MODO 2: ESCRIBIENDO NORMAL EN EL CANAL
                // ----------------------------------------------------
                // Botón interactivo para eliminar ambos mensajes (el del bot y el original del usuario)
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_cerrar_consulta_${message.author.id}_${message.id}`)
                        .setLabel('Cerrar / Borrar')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🗑️')
                );

                const responseMsg = await message.reply({
                    embeds: [embed],
                    files: replyFiles,
                    components: [row]
                }).catch(() => null);

                // Auto-borrado preventivo usando el tiempo configurado de cada servidor (por defecto 90 segundos)
                const autoCleanMs = Math.max(30, Number(gVis.config?.AI_AUTOCLEAN_SECONDS) || 90) * 1000;
                if (responseMsg) {
                    setTimeout(async () => {
                        await responseMsg.delete().catch(() => {});
                        await message.delete().catch(() => {});
                    }, autoCleanMs);
                }
            }

        } catch (err) {
            console.error('⚠️ [CONSULTAS AI messageCreate Error]:', err.message);
        }
    });

    const buildConsultasNoticeEmbed = (guild, { title, description, color = null }) => {
        const gVis = guildManager.resolveGuildVisuals(guild?.id);
        const httpsIcon = (gVis.config?.LOGO_URL && /^https?:\/\//i.test(gVis.config.LOGO_URL))
            ? gVis.config.LOGO_URL.trim()
            : (guild?.iconURL?.({ size: 256, extension: 'png' }) || undefined);
        return new EmbedBuilder()
            .setColor(color || gVis.color)
            .setAuthor({
                name: `SISTEMA DE CONSULTAS • ${gVis.name}`,
                ...(httpsIcon ? { iconURL: httpsIcon } : {})
            })
            .setTitle(title)
            .setDescription(description)
            .setFooter({
                text: `${gVis.name} • Solo tú puedes ver este aviso`,
                ...(httpsIcon ? { iconURL: httpsIcon } : {})
            })
            .setTimestamp();
    };

    // Evento: Botones y Modales del Sistema de Consultas IA
    client.on('interactionCreate', async (interaction) => {
        try {
            // 1. MODAL SUBMIT: Consulta Privada (respuesta 100% efímera "Solo tú puedes verlo")
            if (interaction.isModalSubmit() && interaction.customId === 'modal_consulta_privada') {
                const gId = interaction.guild?.id;
                const gChannels = getChannelsForGuild(gId);
                const isStaffChannel = Boolean(gChannels.staffId && interaction.channelId === gChannels.staffId);
                const isStaff = isMemberStaff(interaction.member);

                if (isStaffChannel && !isStaff) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⛔┃Acceso Exclusivo de Staff',
                            description: 'Este canal de consultas es exclusivo para el Staff. Usa el canal de consultas de la comunidad.',
                            color: 0xE74C3C
                        })],
                        ephemeral: true
                    });
                }

                if (!consultasActivas) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⚠️┃Sistema en Pausa',
                            description: 'El sistema de Consultas IA está actualmente desactivado por la Administración.',
                            color: 0xF39C12
                        })],
                        ephemeral: true
                    });
                }

                const questionText = interaction.fields.getTextInputValue('input_consulta_privada').trim();
                if (questionText.length < 3) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '❌┃Consulta Demasiado Corta',
                            description: 'Por favor escribe una consulta más detallada *(mínimo 3 caracteres)*.',
                            color: 0xE74C3C
                        })],
                        ephemeral: true
                    });
                }

                // Defer efímero: solo el usuario que pulsó el botón verá "pensando..." y la respuesta final
                await interaction.deferReply({ ephemeral: true });

                const isUsersMode = !isStaffChannel;
                const aiAnswer = await queryGroqAI(questionText, isUsersMode, client, gId);

                // Registrar en el canal de logs del servidor (0 tokens adicionales)
                sendConsultaLog({
                    guild: interaction.guild,
                    channel: interaction.channel,
                    author: interaction.user,
                    questionText,
                    aiAnswer,
                    isStaffChannel,
                    isPrivateModal: true
                });

                const gVis = guildManager.resolveGuildVisuals(gId);
                const httpsGuildIcon = interaction.guild?.iconURL({ size: 256, extension: 'png' });
                const iconUrl = httpsGuildIcon || gVis.logoUrl;
                const replyFiles = httpsGuildIcon ? [] : gVis.files;

                const authorTitle = isStaffChannel
                    ? `ASESORÍA DE STAFF | ${gVis.name}`
                    : `CONSULTAS DE LA NORMATIVA | ${gVis.name}`;
                const safeAnswerDesc = (aiAnswer || 'Lo siento, no he podido obtener respuesta en este momento. Por favor, consulta directamente con la Administración o abre un ticket de soporte.').slice(0, 3550);

                const autoCleanSecs = Math.min(840, Math.max(30, Number(gVis.config?.AI_AUTOCLEAN_SECONDS) || 90));
                const autoCleanMs = autoCleanSecs * 1000;

                const embed = new EmbedBuilder()
                    .setColor(gVis.color)
                    .setAuthor({
                        name: authorTitle,
                        iconURL: iconUrl
                    })
                    .setTitle('📋┃RESOLUCIÓN DE CONSULTA')
                    .setDescription(
                        `\u200B\n` +
                        `❓┃**Pregunta planteada**\n` +
                        `> *"${questionText.length > 200 ? questionText.slice(0, 197) + '...' : questionText}"*\n\n` +
                        `────────────────────────────\n\n` +
                        `💡┃**Respuesta Oficial**\n\n` +
                        `${safeAnswerDesc}\n\n` +
                        `────────────────────────────\n` +
                        `⏳ *Esta respuesta se eliminará automáticamente en ${autoCleanSecs} segundos.*`
                    )
                    .setThumbnail(iconUrl)
                    .setFooter({
                        text: `${gVis.name} • Solo tú puedes ver esta respuesta`,
                        iconURL: iconUrl
                    })
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [embed],
                    files: replyFiles
                }).catch(() => {});

                // Auto-borrado preventivo igual que en las consultas públicas (el token efímero permite borrar hasta 15 min)
                setTimeout(() => {
                    interaction.deleteReply().catch(() => {});
                }, autoCleanMs);
                return;
            }

            if (!interaction.isButton()) return;

            // Botón del panel fijo: abrir formulario de Consulta Privada
            if (interaction.customId === 'btn_consulta_privada') {
                const gId = interaction.guild?.id;
                const gChannels = getChannelsForGuild(gId);
                const isStaffChannel = Boolean(gChannels.staffId && interaction.channelId === gChannels.staffId);
                const isStaff = isMemberStaff(interaction.member);

                if (isStaffChannel && !isStaff) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⛔┃Acceso Exclusivo de Staff',
                            description: 'Este canal de consultas es exclusivo para el Staff. Usa el canal de consultas de la comunidad.',
                            color: 0xE74C3C
                        })],
                        ephemeral: true
                    });
                }

                if (!consultasActivas) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⚠️┃Sistema en Pausa',
                            description: 'El sistema de Consultas IA está actualmente desactivado por la Administración.',
                            color: 0xF39C12
                        })],
                        ephemeral: true
                    });
                }

                const modal = new ModalBuilder()
                    .setCustomId('modal_consulta_privada')
                    .setTitle('🔒 Consulta Privada — Normativa');

                const questionInput = new TextInputBuilder()
                    .setCustomId('input_consulta_privada')
                    .setLabel('¿Cuál es tu duda sobre las normativas?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Ej: ¿Se puede robar en zona segura? ¿Cuántos miembros puede tener una banda?')
                    .setMinLength(3)
                    .setMaxLength(800)
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(questionInput));
                await interaction.showModal(modal);
                return;
            }

            // Botón de actualización manual del Panel de Tokens IA
            if (interaction.customId === 'btn_refresh_tokens_panel') {
                const isStaff = isMemberStaff(interaction.member);
                if (!isStaff) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⛔┃Acceso Restringido',
                            description: 'Solo el equipo de **Staff** puede actualizar este panel.',
                            color: 0xE74C3C
                        })],
                        ephemeral: true
                    });
                }
                await interaction.deferUpdate().catch(() => {});
                await syncGuildCountFromLogChannel(interaction.guild?.id).catch(() => {});
                const embed = buildTokensPanelEmbed(interaction.guild?.id, client);
                const usesAtt = JSON.stringify(embed.toJSON()).includes('attachment://');
                const updatePayload = {
                    embeds: [embed],
                    components: [buildTokensPanelRow()]
                };
                if (!usesAtt) {
                    updatePayload.attachments = [];
                }
                await interaction.editReply(updatePayload).catch(() => {});
                return;
            }

            if (interaction.customId.startsWith('btn_cerrar_consulta_')) {
                const parts = interaction.customId.replace('btn_cerrar_consulta_', '').split('_');
                const targetUserId = parts[0];
                const originalMessageId = parts[1];
                
                // Solo el autor que preguntó o un staff/administrador puede pulsar el botón
                const isStaff = isMemberStaff(interaction.member);
                const isAllowed = interaction.user.id === targetUserId || isStaff;
                if (!isAllowed) {
                    return interaction.reply({
                        embeds: [buildConsultasNoticeEmbed(interaction.guild, {
                            title: '⛔┃Acción Restringida',
                            description: 'Solo la persona que hizo esta consulta o un miembro del **Staff** puede borrarla.',
                            color: 0xE74C3C
                        })],
                        ephemeral: true
                    });
                }

                // 1. Borrar el mensaje del bot
                await interaction.message.delete().catch(() => {});

                // 2. Borrar el mensaje original que escribió el Staff
                if (originalMessageId && interaction.channel) {
                    const originalMsg = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
                    if (originalMsg) {
                        await originalMsg.delete().catch(() => {});
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ [CONSULTAS AI interactionCreate Error]:', err.message);
        }
    });
}

module.exports = initConsultasAI;

