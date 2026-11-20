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
const CANAL_APRENDIZAJE_ID = '1571488286789079080';
const ROLE_STAFF_ID = '1538191116610838691';

let consultasActivas = true;
let memoriaNormativaPages = []; // Caché en memoria RAM de las 16 páginas completas

// ==========================================
// POOL DE MODELOS GROQ CON RESPALDO AUTOMÁTICO (600K TOKENS/DÍA GRATIS)
// ==========================================
const GROQ_MODELS = [
    { id: 'qwen/qwen3.8-27b', label: 'Núcleo IA 1 (Principal)', dailyLimit: 200000, dailyReqLimit: 1000 },
    { id: 'openai/gpt-oss-120b', label: 'Núcleo IA 2 (Respaldo 1)', dailyLimit: 200000, dailyReqLimit: 1000 },
    { id: 'openai/gpt-oss-20b', label: 'Núcleo IA 3 (Respaldo 2)', dailyLimit: 200000, dailyReqLimit: 1000 }
];

function getUtcDateKey() {
    return new Date().toISOString().slice(0, 10);
}

function createEmptyTokenStats() {
    const models = {};
    for (const m of GROQ_MODELS) {
        models[m.id] = { tokensUsed: 0, requests: 0, exhausted: false };
    }
    return {
        date: getUtcDateKey(),
        activeModel: GROQ_MODELS[0].id,
        lastQueryTokens: 0,
        models
    };
}

let tokenStats = createEmptyTokenStats();
let tokensPanelRef = null; // { channelId, messageId }

function ensureTodayTokenStats() {
    const today = getUtcDateKey();
    if (!tokenStats || tokenStats.date !== today) {
        tokenStats = createEmptyTokenStats();
    } else {
        if (!tokenStats.models) tokenStats.models = {};
        for (const m of GROQ_MODELS) {
            if (!tokenStats.models[m.id]) {
                tokenStats.models[m.id] = { tokensUsed: 0, requests: 0, exhausted: false };
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

function makeProgressBar(used, total, size = 10) {
    const pct = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
    const filled = Math.round(pct * size);
    const fillChar = pct >= 0.85 ? '🟥' : (pct >= 0.6 ? '🟨' : '🟩');
    return fillChar.repeat(filled) + '⬛'.repeat(size - filled);
}

function buildTokensPanelEmbed() {
    ensureTodayTokenStats();
    const logoAttachment = getLogoAttachment();
    const logoUrl = logoAttachment ? 'attachment://logo.png' : undefined;

    const totalLimit = GROQ_MODELS.reduce((acc, m) => acc + m.dailyLimit, 0);
    let totalUsed = 0;
    let totalReqs = 0;

    const modelLines = GROQ_MODELS.map(m => {
        const st = tokenStats.models[m.id] || { tokensUsed: 0, requests: 0, exhausted: false };
        totalUsed += st.tokensUsed;
        totalReqs += st.requests;
        const remaining = Math.max(0, m.dailyLimit - st.tokensUsed);
        const pct = Math.min(100, Math.round((st.tokensUsed / m.dailyLimit) * 100));
        const isCurrent = tokenStats.activeModel === m.id;
        const statusBadge = st.exhausted
            ? '🔴 **Agotado hoy**'
            : (isCurrent ? '🟢 **Activo ahora**' : '🔵 **En reserva**');
        const bar = makeProgressBar(st.tokensUsed, m.dailyLimit, 10);

        return (
            `**${m.label}** — ${statusBadge}\n` +
            `${bar} \`${pct}%\`\n` +
            `> 🪙 Usados: \`${st.tokensUsed.toLocaleString('es-ES')}\` / \`${m.dailyLimit.toLocaleString('es-ES')}\` • Quedan: \`${remaining.toLocaleString('es-ES')}\` • Consultas: \`${st.requests}\``
        );
    }).join('\n\n');

    const totalRemaining = Math.max(0, totalLimit - totalUsed);
    const totalPct = Math.min(100, Math.round((totalUsed / totalLimit) * 100));
    const totalBar = makeProgressBar(totalUsed, totalLimit, 12);

    const activeModelCfg = GROQ_MODELS.find(m => m.id === tokenStats.activeModel) || GROQ_MODELS[0];

    return new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({
            name: 'MONITOR DE TOKENS IA EN VIVO | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('📊 CONSUMO Y LÍMITES DE IA (VALLECAS AI)')
        .setDescription(
            `🤖 **Motor activo:** \`${activeModelCfg.label}\`\n\n` +
            `🔄 **Cambio automático:** Activado *(si un núcleo se agota, salta al siguiente solo)*\n\n` +
            `📈 **TOTAL COMBINADO HOY (${tokenStats.date} UTC):**\n` +
            `${totalBar} \`${totalPct}%\`\n` +
            `> 🪙 **Gastados:** \`${totalUsed.toLocaleString('es-ES')}\` / \`${totalLimit.toLocaleString('es-ES')}\` tokens\n` +
            `> 🟢 **Disponibles:** \`${totalRemaining.toLocaleString('es-ES')}\` tokens\n` +
            `> 💬 **Consultas hoy:** \`${totalReqs}\` *(Última: \`+${(tokenStats.lastQueryTokens || 0).toLocaleString('es-ES')}\` tokens)*\n\n` +
            `────────────────────────────\n\n` +
            `${modelLines}`
        )
        .setFooter({
            text: 'VALLECAS RP • Se actualiza automáticamente tras cada consulta (Reset 00:00 UTC)',
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
    if (!client || !tokensPanelRef || !tokensPanelRef.channelId || !tokensPanelRef.messageId) return;
    try {
        const ch = client.channels.cache.get(tokensPanelRef.channelId) || await client.channels.fetch(tokensPanelRef.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;
        const msg = await ch.messages.fetch(tokensPanelRef.messageId).catch(() => null);
        if (!msg) return;

        const embed = buildTokensPanelEmbed();
        // Sin re-subir logo.png al editar para ahorrar tráfico de red
        await msg.edit({
            embeds: [embed],
            components: [buildTokensPanelRow()]
        }).catch(() => {});
    } catch (e) { }
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

function buildPanelConsultasEmbed() {
    const logoAttachment = getLogoAttachment();
    const bannerAttachment = getBannerAttachment();
    const logoUrl = logoAttachment ? 'attachment://logo.png' : undefined;

    const embed = new EmbedBuilder()
        .setColor(0xD900FF) // Morado Magenta VALLECAS RP
        .setAuthor({
            name: 'SISTEMA DE CONSULTAS | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('🧠 CONSULTAS DE LA NORMATIVA OFICIAL')
        .setDescription(
            `Bienvenido al **Canal Oficial de Consultas con Inteligencia Artificial** exclusivo de **VALLECAS RP** 🇪🇸.\n\n` +
            `Este sistema resuelve al instante cualquier duda sobre la normativa general, conceptos de rol, sanciones, zonas seguras, atracos, vehículos e ilegales con base 100% oficial.\n\n` +
            `📋 **¿Cómo realizar una consulta?**\n` +
            `> 1️⃣ **Tan solo escribe tu duda en este canal** hablando normalmente, sin necesidad de usar ningún comando.\n` +
            `> 2️⃣ La IA analizará la normativa oficial y te responderá en pocos segundos.\n` +
            `> 3️⃣ Una vez leída la respuesta, pulsa el botón **"🗑️ Cerrar / Borrar"** para mantener el canal limpio y ordenado.\n\n` +
            `💡 *El sistema cuenta con auto-borrado preventivo a los 90 segundos para que no se acumulen mensajes en el canal. Este mensaje informativo es permanente.*`
        )
        .setFooter({
            text: 'VALLECAS RP • Sistema Oficial de Consultas',
            iconURL: logoUrl
        })
        .setTimestamp();

    if (bannerAttachment) {
        embed.setImage('attachment://banner_consultas.png');
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
            } catch (e) { }
        }

        const settingStaff = await BotSetting.findOne({ key: 'CHANNEL_CONSULTAS_STAFF_ID' });
        if (settingStaff && settingStaff.value) CANAL_CONSULTAS_ID = settingStaff.value;

        const settingUsers = await BotSetting.findOne({ key: 'CHANNEL_CONSULTAS_USERS_ID' });
        if (settingUsers && settingUsers.value) CANAL_CONSULTAS_USERS_ID = settingUsers.value;

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
function getRelevantNormativaSnippets(question) {
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
    if (!memoriaNormativaPages || memoriaNormativaPages.length === 0) return '';

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
        const scored = memoriaNormativaPages.map(page => {
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
            .slice(0, 2)
            .filter(s => s.score > 0)
            .map(s => cleanPage(s.page))
            .join('\n---\n');
        return bestMatches.slice(0, 2600);
    } catch (e) {
        return '';
    }
}

/**
 * Consulta la IA de Groq inyectando toda la base de conocimientos aprendida
 */
async function queryGroqAI(userQuestion, isUserMode = false, client = null) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return null;

    const qLower = userQuestion.toLowerCase();
    if (qLower.includes('anubis')) {
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
        // 1. Fragmentos directos del texto original del PDF de la normativa
        const exactNormativaText = getRelevantNormativaSnippets(userQuestion);

        // 2. Conocimientos específicos en MongoDB (solo los que realmente coinciden con la pregunta, para no gastar tokens inútiles)
        let knowledgeContext = '';
        try {
            const allKnowledge = await TicketKnowledge.find({}).sort({ createdAt: -1 }).limit(30);
            if (allKnowledge && allKnowledge.length > 0) {
                const qNorm = userQuestion.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const qTerms = qNorm.split(/[^a-z0-9]+/i).filter(w => SHORT_RP_TERMS.has(w) || w.length >= 4);
                const relevantKnowledge = allKnowledge
                    .filter(k => {
                        const txt = (k.response || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        return qTerms.some(t => countTermMatches(txt, t) > 0);
                    })
                    .slice(0, 4);

                if (relevantKnowledge.length > 0) {
                    knowledgeContext = '\nNOTAS EXTRA:\n' +
                        relevantKnowledge.map(k => `• ${k.response}`).join('\n').slice(0, 700) + '\n';
                }
            }
        } catch (e) { }

        const roleLine = isUserMode
            ? 'Eres la IA Oficial de VALLECAS RP (FiveM) para usuarios. Responde en español de España, claro, cercano y en 1-2 párrafos breves.'
            : 'Eres la IA Asesora Oficial de VALLECAS RP (FiveM) para el Staff. Responde en español de España, directo, citando artículos/cifras/sanciones en 1-2 párrafos breves.';

        const systemPrompt =
            `${roleLine}\n` +
            `Entiende faltas de ortografía o jerga. Si preguntan siglas RP (RK, PK, CK, MG, PG, DM, VDM, HK, NVV, RDE, ZS, BH, CJ, BA, IOOC), defínelas y explica qué aplica en Vallecas RP. Básate 100% en esta normativa:\n` +
            (exactNormativaText ? exactNormativaText : 'Normativa general vigente.') +
            knowledgeContext;

        ensureTodayTokenStats();

        // Ordenar modelos: primero los NO agotados hoy; si todos están marcados como agotados, reintentarlos igualmente
        const availableModels = GROQ_MODELS.filter(m => !tokenStats.models[m.id]?.exhausted);
        const modelsToTry = availableModels.length > 0 ? availableModels : GROQ_MODELS;

        for (const modelCfg of modelsToTry) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelCfg.id,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userQuestion }
                        ],
                        max_tokens: 240,
                        temperature: 0.3
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply && reply.length > 5) {
                        const usedTokens = data.usage?.total_tokens || Math.ceil((systemPrompt.length + userQuestion.length + reply.length) / 4);
                        const st = tokenStats.models[modelCfg.id];
                        st.tokensUsed += usedTokens;
                        st.requests += 1;
                        st.exhausted = false;
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
                        tokenStats.models[modelCfg.id].exhausted = true;
                        console.warn(`⚠️ [CONSULTAS AI] Modelo ${modelCfg.id} agotó su límite diario. Cambiando automáticamente al siguiente respaldo...`);
                    } else {
                        console.warn(`⚠️ [CONSULTAS AI] Rate limit temporal (TPM) en ${modelCfg.id}. Saltando al siguiente modelo...`);
                    }
                    saveTokenStats();
                    updateTokensPanel(client);
                    continue; // Saltar inmediatamente al siguiente modelo de respaldo
                } else {
                    console.error(`⚠️ [CONSULTAS AI Groq Error ${modelCfg.id}]:`, res.status, await res.text().catch(() => ''));
                    continue;
                }
            } catch (netErr) {
                console.error(`⚠️ [CONSULTAS AI Net Error ${modelCfg.id}]:`, netErr.message);
            }
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS AI Error]:', e.message);
    }
    return null;
}

function isMemberStaff(member) {
    if (!member || member.user.bot) return false;
    if (ROLE_STAFF_ID && member.roles.cache.has(ROLE_STAFF_ID)) return true;
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
        }
    };

    console.log('🤖 [CONSULTAS AI] Sistema independiente cargado. Canal Staff:', CANAL_CONSULTAS_ID, '| Canal Usuarios:', CANAL_CONSULTAS_USERS_ID || 'No configurado');

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
                if (message.channel.id !== CANAL_CONSULTAS_ID && message.channel.id !== CANAL_CONSULTAS_USERS_ID) {
                    return message.reply('❌ Este comando solo se puede usar en un canal de consultas.');
                }
                const msgs = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (msgs && msgs.size > 0) {
                    // Filtrar mensajes para no borrar nunca los paneles permanentes del bot
                    const msgsToDelete = msgs.filter(m => {
                        const isPanel = m.author.id === client.user.id && m.embeds.some(e => 
                            e.title?.includes('CONSULTAS DE LA NORMATIVA OFICIAL') ||
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

                const isTargetStaff = (message.channel.id === CANAL_CONSULTAS_ID);
                const embed = buildPanelConsultasEmbed(isTargetStaff);
                const files = [];
                const logoAtt = getLogoAttachment();
                const bannerAtt = getBannerAttachment();
                if (logoAtt) files.push(logoAtt);
                if (bannerAtt) files.push(bannerAtt);

                await message.channel.send({
                    embeds: [embed],
                    files
                }).catch(e => console.error('Error enviando panel consultas:', e));
                return;
            }

            // ==========================================
            // PANEL EN VIVO DE TOKENS IA: !panel-tokens / !tokens
            // ==========================================
            if (['!panel-tokens', '!paneltokens', '!tokens', '!ia-tokens', '!consultas tokens'].includes(contentLower)) {
                if (!isStaff) return;
                await message.delete().catch(() => {});

                const embed = buildTokensPanelEmbed();
                const logoAtt = getLogoAttachment();
                const sentPanel = await message.channel.send({
                    embeds: [embed],
                    files: logoAtt ? [logoAtt] : [],
                    components: [buildTokensPanelRow()]
                }).catch(e => {
                    console.error('Error enviando panel de tokens:', e);
                    return null;
                });

                if (sentPanel) {
                    tokensPanelRef = { channelId: sentPanel.channel.id, messageId: sentPanel.id };
                    await BotSetting.findOneAndUpdate(
                        { key: 'groq_tokens_panel' },
                        { key: 'groq_tokens_panel', value: tokensPanelRef },
                        { upsert: true }
                    ).catch(() => {});
                }
                return;
            }

            // ==========================================
            // ATENCIÓN DE CONSULTAS EN LOS CANALES (STAFF Y USUARIOS)
            // ==========================================
            const isStaffChannel = (message.channel.id === CANAL_CONSULTAS_ID);
            const isUsersChannel = (CANAL_CONSULTAS_USERS_ID && message.channel.id === CANAL_CONSULTAS_USERS_ID);

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

                // Consultar la IA adaptando el rol según si es canal de usuarios o canal de staff (con respaldo automático y actualización del panel de tokens)
                const aiAnswer = await queryGroqAI(questionText, isUsersChannel, client);

                const logoAttachment = getLogoAttachment();
                const iconUrl = logoAttachment ? 'attachment://logo.png' : (message.guild.iconURL() || undefined);

                // Diseño limpio y profesional adaptado al contexto
                const authorTitle = isStaffChannel
                    ? 'ASESORÍA DE STAFF | VALLECAS RP'
                    : 'CONSULTAS DE LA NORMATIVA | VALLECAS RP';
                const embedColor = 0xD900FF; // Morado Magenta VALLECAS RP

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
                        text: 'VALLECAS RP • Base de Datos Oficial',
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
                            files: logoAttachment ? [logoAttachment] : []
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
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [row]
                }).catch(() => null);

                // Auto-borrado preventivo a los 90 segundos para que no queden mensajes olvidados
                if (responseMsg) {
                    setTimeout(async () => {
                        await responseMsg.delete().catch(() => {});
                        await message.delete().catch(() => {});
                    }, 90 * 1000);
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
                const embed = buildTokensPanelEmbed();
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

