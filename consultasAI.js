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
        // 1. Cargar desde la DB dedicada de ESTE servidor (ej: vilacityrp_db -> normativadocs)
        const GuildNormativaModel = guildManager.getGuildModel(keyId, 'NormativaDoc', normativaDocSchema);
        const docs = await GuildNormativaModel.find({
            key: { $in: ['normativa_general', 'normativa_ilegales', `guild_${keyId}_general`, `guild_${keyId}_ilegales`, `guild_${keyId}_normativa`] }
        }).lean();
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
        models
    };
}

let tokenStats = createEmptyTokenStats();
let tokensPanelRef = null; // { channelId, messageId }

function ensureTodayTokenStats() {
    const today = getUtcDateKey();
    const keyCount = Math.max(1, getConfiguredApiKeys().length);
    if (!tokenStats || tokenStats.date !== today) {
        tokenStats = createEmptyTokenStats();
    } else {
        if (!tokenStats.models) tokenStats.models = {};
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

function buildTokensPanelEmbed(guildId = null) {
    ensureTodayTokenStats();
    const vTok = guildManager.resolveGuildVisuals(guildId);
    const logoUrl = vTok.logoUrl || undefined;

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
    const diffMs = Math.max(0, nextReset.getTime() - now.getTime());
    const resetH = Math.floor(diffMs / 3600000);
    const resetM = Math.floor((diffMs % 3600000) / 60000);

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
            `> 💬 **Consultas hoy:** \`${formatNum(totalReqs)}\` *(Última: \`+${formatNum(tokenStats.lastQueryTokens || 0)}\` tokens)*\n\n` +
            `────────────────────────────\n\n` +
            `🧠 **NÚCLEOS IA (${keyCount} conectados):**\n` +
            `${nucleiLines.join(keyCount > 6 ? '\n' : '\n\n')}\n\n` +
            `────────────────────────────\n\n` +
            `⚙️ **SISTEMA Y CANALES ACTIVOS:**\n` +
            `> ⚡ **Servicio:** ${consultasActivas ? '🟢 `Activo y respondiendo`' : '🔴 `Pausado por Staff`'}\n` +
            `> 📚 **Normativa en memoria:** \`${loadedSections}\` secciones oficiales\n` +
            `> 🛡️ **Canal Staff:** ${staffChText}\n` +
            `> 👥 **Canal Usuarios:** ${usersChText}\n` +
            `> ⏳ **Reinicio de cupos:** en \`${resetH}h ${resetM}m\``
        )
        .setFooter({
            text: `${serverName} • Se actualiza automáticamente tras cada consulta`,
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

            const embed = buildTokensPanelEmbed(item.guildId || ch.guild?.id);
            await msg.edit({
                embeds: [embed],
                components: [buildTokensPanelRow()]
            }).catch(() => {});
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
        .setTitle('🧠 CONSULTAS DE LA NORMATIVA OFICIAL')
        .setDescription(
            `Bienvenido al **Canal Oficial de Consultas con Inteligencia Artificial** exclusivo de **${serverName}** 🇪🇸.\n\n` +
            `Este sistema resuelve al instante cualquier duda sobre la normativa general, conceptos de rol, sanciones, zonas seguras, atracos, vehículos e ilegales con base 100% oficial.\n\n` +
            `📋 **¿Cómo realizar una consulta?**\n` +
            `> 1️⃣ **Tan solo escribe tu duda en este canal** hablando normalmente, sin necesidad de usar ningún comando.\n` +
            `> 2️⃣ La IA analizará la normativa oficial y te responderá en pocos segundos.\n` +
            `> 3️⃣ Una vez leída la respuesta, pulsa el botón **"🗑️ Cerrar / Borrar"** para mantener el canal limpio y ordenado.\n\n` +
            `💡 *El sistema cuenta con auto-borrado preventivo a los ${cleanSecs} segundos para que no se acumulen mensajes en el canal. Este mensaje informativo es permanente.*`
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
    'dm': ['dm', 'rdm', 'deathmatch', 'matar sin rol', 'golpear', 'sin rol previo'],
    'vdm': ['vdm', 'vehicle deathmatch', 'atropellar', 'atropello', 'vehiculo como arma'],
    'hk': ['hk', 'helikill', 'helicoptero', 'helico', 'helices', 'vdm', 'vehiculos aereos'],
    'nvv': ['nvv', 'nvl', 'no valoracion de vida', 'valorar vida', 'valoracion de vida', 'no valorar', 'rendirte', 'apuntan'],
    'ic_ooc': ['ic', 'ooc', 'in character', 'out of character', 'fuera de personaje', 'dentro del personaje', 'iooc', 'faltas de respeto', 'insultar'],
    'evasion': ['evasion', 'f8', 'f8 quit', 'desconectarse', 'forzar reaparicion', 'coma', 'reanimacion'],
    'fairplay': ['fairplay', 'fair play', 'juego limpio', 'bug', 'bugs', 'ba', 'bug abuse', 'dupeo', 'desync', 'lagunas'],
    'comandos_rol': ['/me', '/do', 'tercera persona', 'mentir', 'pensamientos', 'sentimientos'],
    'negocio': ['local', 'tienda', 'negocio', 'empresa', 'comercio', 'badulaque', 'taller', 'keli', 'propiedad'],
    'cerrado': ['cerrado', 'cerrar', 'serrao', 'cerrao', 'inactivo', 'inactividad', 'abrir', 'abre', 'dias'],
    'robar': ['robo', 'robar', 'atraco', 'atracar', 'asaltar', 'asalto', 'botin', 'hurto', 'mangado', 'chafado', 'cj', 'car jacking'],
    'policia': ['lspd', 'cnp', 'cop', 'cops', 'agente', 'policia', 'patrulla', 'maderos', 'nacional', 'pitufo', 'ems', 'medico', 'hospital'],
    'sancion': ['ban', 'baneo', 'jail', 'sancion', 'castigo', 'expulsion', 'permaban', 'sancionan', 'castigan'],
    'coche': ['coche', 'vehiculo', 'auto', 'moto', 'patrulla', 'conducir', 'disparar', 'buga'],
    'arma': ['pistola', 'fusil', 'ak', 'escopeta', 'pesada', 'armamento', 'blanca', 'pipa', 'plomo', 'sns', 'smg'],
    'secuestro': ['secuestro', 'secuestrar', 'rapto', 'retener', 'rehen', 'rehenes', 'rescate'],
    'guerra': ['guerra', 'tiroteo', 'bandas', 'mafias', 'pacto', 'alianza', 'barrio', 'cartel', 'carteles', 'ilegal', 'ilegales', 'limite', 'cupo', 'integrantes', 'alianzas'],
    'entorno': ['entorno', 'rde', 'rol de entorno', 'comisaria', 'zona segura', 'zs', 'evasion', 'campeo', 'caliente']
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
            'hacer', 'tiene', 'tengo', 'normativa', 'norma', 'normas', 'regla', 'reglas', 'vallecas',
            'server', 'servidor', 'aqui', 'duda', 'pregunta', 'saber', 'hay', 'son', 'del', 'las', 'los', 'una', 'uno'
        ]);
        const qClean = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const rawTokens = qClean.split(/[^a-z0-9]+/i).filter(Boolean);

        // Mantener palabras normales (>=3 chars sin stopwords) Y siglas RP de 2 letras (RK, HK, MG, PG, PK, CK, DM, IC, ZS...)
        const directWords = new Set(
            rawTokens.filter(w => SHORT_RP_TERMS.has(w) || (w.length >= 3 && !stopWords.has(w)))
        );

        // Expandir palabras clave con jerga y sinónimos (usando palabra completa para siglas cortas)
        const synonymWords = new Set();
        for (const [, list] of Object.entries(JERGA_SINONIMOS)) {
            const matched = list.some(s => countTermMatches(qClean, s) > 0);
            if (matched) {
                list.forEach(w => {
                    if (!directWords.has(w)) synonymWords.add(w);
                });
            }
        }

        // Puntuación de relevancia por página
        const scored = pagesSource.map(page => {
            const pageLower = page.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let score = 0;

            // 1. Coincidencias directas con lo que preguntó el usuario (máxima prioridad)
            for (const word of directWords) {
                const occurrences = countTermMatches(pageLower, word);
                if (occurrences > 0) {
                    const baseWeight = PRIORITY_RP_TERMS.has(word) ? 12 : (word.length >= 5 ? 5 : 3);
                    score += baseWeight + Math.min(occurrences, 5) * 2;
                }
            }

            // 2. Coincidencias por sinónimos / expansión de siglas
            for (const word of synonymWords) {
                const occurrences = countTermMatches(pageLower, word);
                if (occurrences > 0) {
                    const baseWeight = PRIORITY_RP_TERMS.has(word) ? 6 : 2;
                    score += baseWeight + Math.min(occurrences, 4);
                }
            }

            // Penalizar ligeramente la página del Índice General para priorizar el artículo completo
            if (pageLower.includes('indice general') && score > 0) {
                score = Math.max(1, score - 6);
            }

            return { page, score };
        });

        scored.sort((a, b) => b.score - a.score);
        // Tomar las 2 secciones más relevantes limpiando encabezados repetitivos para ahorrar tokens (~70% menos consumo)
        const cleanPage = (txt) => txt
            .replace(/VALLECAS RP\s*\r?\n\|\s*NORMATIVA GENERAL OFICIAL[\s\S]*?Documento de obligado cumplimiento/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const bestMatches = scored
            .slice(0, 4)
            .filter(s => s.score > 0)
            .map(s => cleanPage(s.page))
            .join('\n---\n');
        return bestMatches.slice(0, 5500);
    } catch (e) {
        return '';
    }
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

        const systemPrompt =
            `${roleLine}${customConciencia}\n` +
            `Entiende faltas de ortografía o jerga callejera. Si preguntan por siglas RP (RK, PK, CK, MG, PG, DM, VDM, HK, NVV, RDE, ZS, BH, CJ, BA, IOOC, etc.), defínelas correctamente y aplica únicamente las reglas de ${serverName} (NUNCA menciones otro servidor). Nunca inventes cifras: básate 100% en esta normativa oficial:\n` +
            rpFallback +
            knowledgeContext;

        ensureTodayTokenStats();

        // Construir cola de intentos: todos los (servidor, modelo) NO agotados hoy primero
        const allSlots = [];
        for (const keyObj of apiKeys) {
            for (const modelCfg of GROQ_MODELS) {
                allSlots.push({ keyObj, modelCfg, slotKey: getSlotKey(keyObj.idx, modelCfg.id) });
            }
        }
        const availableSlots = allSlots.filter(s => !tokenStats.models[s.slotKey]?.exhausted);
        const slotsToTry = availableSlots.length > 0 ? availableSlots : allSlots;

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
                        max_tokens: 450,
                        temperature: 0.15
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply && reply.length > 5) {
                        const usedTokens = data.usage?.total_tokens || Math.ceil((systemPrompt.length + userQuestion.length + reply.length) / 4);
                        const st = tokenStats.models[slotKey];
                        st.tokensUsed += usedTokens;
                        st.requests += 1;
                        st.exhausted = false;
                        tokenStats.activeKeyIdx = keyObj.idx;
                        tokenStats.activeModel = modelCfg.id;
                        tokenStats.lastQueryTokens = usedTokens;

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
                        console.warn(`⚠️ [CONSULTAS AI] Rate limit temporal (TPM) en ${keyObj.label} / ${modelCfg.id}. Saltando al siguiente...`);
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
    async function sendConsultaLog({ message, questionText, aiAnswer, isStaffChannel, isPrivateAiCommand }) {
        const gChannels = getChannelsForGuild(message.guild?.id);
        if (!gChannels.logsId) return;
        try {
            const logCh = client.channels.cache.get(gChannels.logsId) || await client.channels.fetch(gChannels.logsId).catch(() => null);
            if (!logCh || !logCh.isTextBased()) return;

            const activeIdx = tokenStats.activeKeyIdx || 1;
            const lastToks = tokenStats.lastQueryTokens || 0;
            const userAvatar = message.author.displayAvatarURL({ size: 128 });
            const origenTxt = isStaffChannel ? '🛡️ Consultas Staff' : '👥 Consultas Usuarios';
            const gVis = guildManager.resolveGuildVisuals(message.guild?.id);

            const safeQuestion = questionText.length > 900 ? questionText.slice(0, 897) + '...' : questionText;
            const safeAnswer = (aiAnswer || 'Sin respuesta (error temporal)').length > 1800
                ? aiAnswer.slice(0, 1797) + '...'
                : (aiAnswer || 'Sin respuesta (error temporal)');

            const logEmbed = new EmbedBuilder()
                .setColor(gVis.color)
                .setAuthor({
                    name: `LOG DE CONSULTA IA | ${message.author.username}`,
                    iconURL: userAvatar
                })
                .setThumbnail(userAvatar)
                .setDescription(
                    `👤 **Usuario:** <@${message.author.id}>\n` +
                    `📍 **Origen:** <#${message.channel.id}> *(${origenTxt})*${isPrivateAiCommand ? ' • 🔒 Privado' : ''}\n` +
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
                await message.channel.send({ embeds: [embed], files: v.files }).catch(e => console.error('Error enviando panel consultas:', e));
                return;
            }

            // ==========================================
            // PANEL EN VIVO DE TOKENS IA: !panel-tokens / !tokens
            // ==========================================
            if (['!panel-tokens', '!paneltokens', '!tokens', '!ia-tokens', '!consultas tokens'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});

                const gId = message.guild?.id;
                const vTokPanel = guildManager.resolveGuildVisuals(gId);
                const embed = buildTokensPanelEmbed(gId);
                const sentPanel = await message.channel.send({
                    embeds: [embed],
                    files: vTokPanel.files,
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

                const embed = new EmbedBuilder()
                    .setColor(embedColor)
                    .setAuthor({
                        name: authorTitle,
                        iconURL: iconUrl
                    })
                    .setTitle('📋 RESOLUCIÓN DE CONSULTA')
                    .setDescription(
                        `❓ **| Pregunta planteada:**\n` +
                        `> *"${questionText.length > 200 ? questionText.slice(0, 197) + '...' : questionText}"*\n\n` +
                        `💡 **| Respuesta de la IA:**\n` +
                        `> ${aiAnswer || 'Lo siento, no he podido obtener respuesta en este momento. Por favor, consulta directamente con la Administración o abre un ticket de soporte.'}\n\n` +
                        (isPrivateAiCommand 
                            ? `🔒 *Respuesta privada enviada por !ai (solo para tus ojos).*`
                            : `*(Pulsa el botón de abajo en cuanto hayas terminado de leer).*`)
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

    // Evento: Botón para borrar la consulta y el mensaje original del autor
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;

            // Botón de actualización manual del Panel de Tokens IA
            if (interaction.customId === 'btn_refresh_tokens_panel') {
                const isStaff = isMemberStaff(interaction.member);
                if (!isStaff) {
                    return interaction.reply({ content: '⛔ Solo el Staff puede actualizar este panel.', ephemeral: true });
                }
                const embed = buildTokensPanelEmbed(interaction.guild?.id);
                await interaction.update({
                    embeds: [embed],
                    components: [buildTokensPanelRow()]
                }).catch(() => {});
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
                        content: '⛔ Solo la persona que hizo esta consulta o un Staff puede borrarla.',
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

