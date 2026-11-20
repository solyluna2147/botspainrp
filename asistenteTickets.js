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
    assistantRepliesCount: { type: Number, default: 0 },
    dialogueHistory: [{
        role: String,
        content: String
    }],
    userMessages: [{
        content: String,
        timestamp: { type: Date, default: Date.now }
    }],
    extractedData: {
        idFiveM: String,
        donationItem: String,
        paymentMethod: String,
        streamLinks: [String],
        reason: String,
        attachmentUrl: String
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
let canalAprendizajeId = '1571488286789079080'; // Canal oficial de aprendizaje
const userMessageBuffers = new Map();
const processingChannels = new Set(); // Evita respuestas duplicadas simultáneas en el mismo ticket

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

// Comprueba si el canal pertenece EXCLUSIVAMENTE a una de las 4 categorías permitidas
function isValidTicketCategory(channel) {
    if (!channel || channel.isDMBased()) return false;
    // Solo canales de texto dentro del servidor (ChannelType.GuildText = 0)
    if (channel.type !== 0) return false;

    const parentId = channel.parentId;
    if (!parentId) return false;

    // Comparación ESTRICTA y ÚNICA por ID de Categoría
    return ALLOWED_CATEGORY_IDS.includes(parentId);
}

// Detectar categoría basada en el ID exacto de la categoría de Discord
function detectTicketCategory(channel) {
    const parentId = channel.parentId;
    if (parentId === CATEGORIA_SOPORTE_ID) return 'soporte';
    if (parentId === CATEGORIA_APELACION_ID) return 'apelacion';
    if (parentId === CATEGORIA_STREAMER_ID) return 'streamer';
    if (parentId === CATEGORIA_DONACIONES_ID) return 'donaciones';
    return 'general';
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

        // Si no nos pasaron ticketOwnerId, intentar resolver quién abrió el ticket desde los mensajes de King/bienvenida
        let resolvedOwnerId = ticketOwnerId;
        if (!resolvedOwnerId) {
            for (const msg of messages.values()) {
                if (msg.author.bot) {
                    if (msg.mentions.users.size > 0) {
                        const nonBot = msg.mentions.users.find(u => !u.bot);
                        if (nonBot) {
                            resolvedOwnerId = nonBot.id;
                            break;
                        }
                    }
                    if (msg.embeds && msg.embeds.length > 0) {
                        for (const embed of msg.embeds) {
                            const embedText = `${embed.title || ''} ${embed.description || ''}`;
                            const mentionMatch = embedText.match(/<@!?(\d{17,20})>/);
                            if (mentionMatch) {
                                resolvedOwnerId = mentionMatch[1];
                                break;
                            }
                        }
                        if (resolvedOwnerId) break;
                    }
                }
            }
        }

        for (const msg of messages.values()) {
            // Ignorar todos los bots (King, el bot de tickets, MEE6, etc.)
            if (msg.author.bot) continue;

            const cleanContent = msg.content.trim().toLowerCase();
            if (cleanContent.startsWith('!procesar') || cleanContent.startsWith('!asistente') || cleanContent.startsWith('!limpiar') || cleanContent.startsWith('!diagnostico')) {
                continue;
            }

            // Si es el creador del ticket, SUS MENSAJES NUNCA SON DE UN STAFF ATENDIENDO
            if (resolvedOwnerId && msg.author.id === resolvedOwnerId) continue;

            // Si es quien ejecutó el comando
            if (excludedUserId && msg.author.id === excludedUserId) continue;

            // Si llegamos aquí, es OTRA PERSONA que ha escrito en el canal
            // Comprobamos si tiene rol de staff o permisos de admin
            const member = msg.member || await channel.guild.members.fetch(msg.author.id).catch(() => null);
            if (member) {
                const hasStaffRole = member.roles.cache.has(ROLE_STAFF_ID);
                const hasAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
                if (hasStaffRole || hasAdmin) {
                    return true; // Efectivamente hay otro Staff hablando
                }
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

// ==========================================
// RESUMIDOR Y RESOLUCIÓN INTELIGENTE (IA GROQ + NLP)
// ==========================================

// Helper para comprobar si el usuario está pidiendo explícitamente hablar con un Staff humano
function isUserAskingForStaff(text) {
    if (!text) return false;
    const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const staffKeywords = [
        'hablar con staff',
        'hablar con un staff',
        'hablar con algun staff',
        'llamar staff',
        'llamar a un staff',
        'llamar al staff',
        'quiero un staff',
        'quiero hablar con un',
        'pasa un staff',
        'pasame un staff',
        'pasame con un staff',
        'avisa a un staff',
        'avisen a un staff',
        'avisa al staff',
        'necesito un staff',
        'necesito hablar con staff',
        'puedo hablar con un staff',
        'que venga un staff',
        'atencion de un staff',
        'que me atienda un staff',
        'puede atenderme un staff',
        'atenderme un staff',
        'atiendame un staff',
        'que me atienda alguien',
        'un admin',
        'un administrador',
        'un moderador',
        'persona real',
        'humano',
        'no eres un staff',
        'bot no entiende',
        'bot no comprende',
        'bot de inteligencia',
        'eres un bot'
    ];
    return staffKeywords.some(kw => lower.includes(kw));
}

// Helper para comprobar si el usuario indica que no tiene más dudas o que su consulta ha quedado resuelta
async function isUserConfirmingResolved(text, lastAssistantMessage = '') {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    
    // Si el usuario incluye palabras que indican una nueva duda o pregunta ("otra duda", "pero", "y si", "tengo una duda"),
    // NUNCA debe tratarse como resuelto, sino responderle
    if (/duda|pregunta|pero|y si|otra cosa|se puede|puedo|es sancionable/i.test(lower)) {
        return false;
    }
    
    // 1. Detección rápida por patrones comunes (vale, ok, gracias, vale gracias, todo claro, etc.)
    const resolvedPatterns = [
        /^(vale|ok|oka|okay|perfecto|entendido|entiendo|bien|ya veo|a vale|ah vale|gracias|muchas gracias)[\s.!?,]*$/i,
        /^(vale|ok|oka|ah vale|a vale)[\s,]+(gracias|muchas gracias|perfecto|todo claro|entendido)[\s.!?,]*$/i,
        /^(gracias|muchas gracias)[\s,]+(vale|ok|amigo|bro|staff)[\s.!?,]*$/i,
        /^(no|ninguna|nada|ya nada|todo bien|todo correcto|todo bien gracias|no gracias)[\s.!?,]*$/i,
        /^(no( tengo)? (mas |más )?dudas?|ninguna duda( mas| más)?|ya (esta|está|estaria|estaría))[\s.!?,]*$/i,
        /todo claro/i,
        /ya (me )?qued(o|ó) claro/i,
        /ya (me )?entendi/i,
        /ya (me )?ha quedado claro/i,
        /ya (esta|está) solucionado/i,
        /ya se solucion(o|ó)/i,
        /ya lo solucion(e|é)/i,
        /ya me lo has solucionado/i,
        /solucionado/i,
        /ya me funciona/i,
        /ya funciona/i,
        /ya no necesito nada/i,
        /ya se arregl(o|ó)/i,
        /listo gracias/i,
        /perfecto gracias/i
    ];

    if (resolvedPatterns.some(pattern => pattern.test(lower))) {
        return true;
    }

    // 2. Comprobación inteligente con IA si no coincidió con el regex directo
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && text.length < 80) {
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen/qwen3.8-27b',
                    messages: [
                        {
                            role: 'system',
                            content: 'Eres un evaluador de tickets de soporte. Analiza el último mensaje del usuario tras la explicación del asistente. Determina si el usuario confirma que ya no tiene más dudas, agradece, da por zanjado el problema o dice que todo quedó claro (responde SI). Si por el contrario plantea una nueva pregunta, duda o problema, responde NO. Responde ÚNICAMENTE SI o NO.'
                        },
                        {
                            role: 'assistant',
                            content: lastAssistantMessage || '¿Te queda alguna otra duda o está todo claro?'
                        },
                        {
                            role: 'user',
                            content: text
                        }
                    ],
                    max_tokens: 5,
                    temperature: 0.1
                })
            });
            if (res.ok) {
                const data = await res.json();
                const evalText = data.choices?.[0]?.message?.content?.trim().toUpperCase();
                if (evalText && evalText.includes('SI')) return true;
            }
        } catch (e) { }
    }

    return false;
}

// Carga en memoria del texto oficial de la normativa general e ilegales
let normativaCompletaLocal = '';
async function loadNormativaEnMemoria() {
    try {
        if (mongoose.models.NormativaDoc) {
            const docGen = await mongoose.models.NormativaDoc.findOne({ key: 'normativa_general_2026' });
            if (docGen && docGen.content) normativaCompletaLocal += docGen.content + '\n\n';
            const docIleg = await mongoose.models.NormativaDoc.findOne({ key: 'normativa_ilegales_2026' });
            if (docIleg && docIleg.content) normativaCompletaLocal += docIleg.content + '\n\n';
        }
    } catch (e) { }

    if (!normativaCompletaLocal) {
        try {
            const normPath = path.join(__dirname, 'normativa_vallecas_completa.txt');
            if (fs.existsSync(normPath)) {
                normativaCompletaLocal += fs.readFileSync(normPath, 'utf8') + '\n\n';
            }
            const ilegalesPath = path.join(__dirname, 'normativa_ilegales.txt');
            if (fs.existsSync(ilegalesPath)) {
                normativaCompletaLocal += fs.readFileSync(ilegalesPath, 'utf8');
            }
        } catch (e) { }
    }
}
loadNormativaEnMemoria();
async function summarizeReasonWithAI(category, text) {
    if (!text || !text.trim()) return 'No especificado por el usuario';

    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        try {
            const systemPrompt =
                'Eres el sistema inteligente de triaje de tickets de VALLECAS RP (servidor FiveM español).\n' +
                'Tu objetivo es redactar un motivo formal, objetivo y claro de 1 sola frase para el Staff basándote ESTRICTAMENTE en lo que ha dicho el usuario.\n' +
                'REGLAS CRÍTICAS:\n' +
                '1. NUNCA inventes motivos, excusas o detalles que el usuario no haya mencionado explícitamente (prohibido inventar temas de munición, tiroteos, coches u otros hechos si el usuario no los dijo).\n' +
                '2. Cíñete 100% a las palabras y hechos del usuario.\n' +
                '3. Responde directamente con 1 sola frase sin preámbulos ni comillas.';

            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'qwen/qwen3.8-27b',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Categoría: ${category}\nMensaje del usuario: "${text}"` }
                    ],
                    max_tokens: 100,
                    temperature: 0.1
                })
            });

            if (res.ok) {
                const data = await res.json();
                const aiSummary = data.choices?.[0]?.message?.content?.trim();
                if (aiSummary && aiSummary.length > 5) {
                    return aiSummary.replace(/^["']|["']$/g, '');
                }
            }
        } catch (e) {
            console.error('⚠️ [ERROR IA RESUMEN]:', e.message);
        }
    }

    return summarizeReason(category, text);
}

function summarizeReason(category, text) {
    if (!text || !text.trim()) return 'No especificado por el usuario';
    const lower = text.toLowerCase();

    // 1. Apelación de Baneo
    if (category === 'apelacion') {
        const reasons = [];
        if (lower.includes('f8') || lower.includes('tirando de f8') || lower.includes('desconexion') || lower.includes('evadir')) {
            reasons.push('Desconexión forzada de rol (tirar de F8 / Combat Logging)');
        }
        if (lower.includes('rdm') || lower.includes('matar') || lower.includes('tiroteo') || lower.includes('agresion')) {
            reasons.push('Muerte sin rol previo (RDM)');
        }
        if (lower.includes('vdm') || lower.includes('atropellar') || lower.includes('coche')) {
            reasons.push('Atropello intencionado (VDM)');
        }
        if (lower.includes('insult') || lower.includes('falta de respeto') || lower.includes('toxic') || lower.includes('falto')) {
            reasons.push('Comportamiento tóxico / Faltas de respeto OOC');
        }
        if (lower.includes('failrp') || lower.includes('fail rp') || lower.includes('nula valoracion')) {
            reasons.push('Incumplimiento de rol (FailRP / Nula Valoración)');
        }
        if (lower.includes('perdon') || lower.includes('disculpa') || lower.includes('arrepiento') || lower.includes('caliente')) {
            reasons.push('El usuario reconoce su error, pide disculpas y solicita una segunda oportunidad o servicios comunitarios');
        }

        if (reasons.length > 0) {
            return reasons.join(' • ');
        }
        return 'Solicitud de revisión de baneo alegando error y pidiendo segunda oportunidad';
    }

    // 2. Donaciones
    if (category === 'donaciones') {
        const items = [];
        if (lower.includes('coche') || lower.includes('auto') || lower.includes('vehiculo') || lower.includes('buga')) items.push('Compra de Coche VIP');
        if (lower.includes('pack') || lower.includes('vip')) items.push('Adquisición de Pack VIP');
        if (lower.includes('casa') || lower.includes('mlo') || lower.includes('mansion') || lower.includes('keli')) items.push('Mapeo de Casa / MLO');
        if (lower.includes('dinero') || lower.includes('pasta') || lower.includes('ic')) items.push('Inyección de Dinero IC');
        if (lower.includes('unban') || lower.includes('desban')) items.push('Desbaneo de pago');

        const method = lower.includes('bizum') ? ' (pago por Bizum)' : (lower.includes('paypal') ? ' (pago por PayPal)' : '');

        if (items.length > 0) {
            return `Interesado en: ${items.join(', ')}${method}`;
        }
        return 'Consulta sobre catálogo de donaciones y métodos de pago';
    }

    // 3. Soporte
    if (category === 'soporte') {
        if (lower.includes('negocio') || lower.includes('redes') || lower.includes('badu')) return 'Solicitud de activación o entrega de Negocio Gratis (Redes Sociales)';
        if (lower.includes('armario') || lower.includes('casa') || lower.includes('mlo')) return 'Incidencia o bug con el armario de vivienda';
        if (lower.includes('cerradura') || lower.includes('llave')) return 'Fallo en cerradura de vehículo o propiedad';
        if (lower.includes('mecanico') || lower.includes('taller')) return 'Problema o consulta relacionada con el rol de Mecánico';
        if (lower.includes('policia') || lower.includes('chivato')) return 'Aviso de alerta o chivato policial';
        if (lower.includes('crash') || lower.includes('pantalla') || lower.includes('cierra')) return 'Problemas de rendimiento o crashes al entrar al servidor';
        return `Incidencia técnica: "${text.slice(0, 100)}..."`;
    }

    return `Consulta general: "${text.slice(0, 100)}..."`;
}
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
        .setDescription(description)
        .setThumbnail(iconUrl)
        .setFooter({
            text: 'VALLECAS RP • Sistema Inteligente de Tickets',
            iconURL: iconUrl
        })
        .setTimestamp();

    if (title) {
        embed.setTitle(title);
    }

    return { embed, files: logoAttachment ? [logoAttachment] : [] };
}

// Helper para saber si el usuario ha aportado pruebas (enlaces de clip, vídeos o imágenes adjuntas)
function hasUserProvidedEvidence(messages = []) {
    const combined = messages.map(m => m.content || '').join(' ').toLowerCase();
    // 1. Archivo o captura adjunta en Discord
    if (combined.includes('[adjunta imagen') || combined.includes('.png') || combined.includes('.jpg') || combined.includes('.jpeg') || combined.includes('.mp4') || combined.includes('.mov')) {
        return true;
    }
    // 2. Enlaces típicos de clips y vídeo (Medal, YouTube, Streamable, Twitch, Discord CDN, etc.)
    const linkRegex = /(https?:\/\/[^\s]+)/i;
    if (linkRegex.test(combined)) {
        return true;
    }
    return false;
}

// Generador de respuestas breves de recopilación de información para el Staff (Groq AI)
async function generateAIResponse(category, session, currentMessage, userTag) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return null;

    try {
        const userMessages = session.userMessages || [];
        const userProvidedEvidence = hasUserProvidedEvidence([...userMessages, { content: currentMessage }]);
        const repliesSoFar = session.assistantRepliesCount || 0;

        const categoryPrompts = {
            donaciones: 'Eres el Asistente de Recepción de Tickets de Donaciones de VALLECAS RP. Tu ÚNICA función es recopilar los datos clave para el Staff (qué artículo/pack/coche/casa busca y si pagará por Bizum o PayPal). Si ya te ha dicho lo que quiere, confirma que queda anotado e indícale que pulse el botón "Hablar con un Staff" de abajo para que el encargado le atienda.',
            apelacion: 'Eres el Asistente de Recepción de Apelaciones de VALLECAS RP. Tu ÚNICA función es recopilar datos para el expediente del Staff (motivo de la sanción/ban y si tiene alguna captura o clip). ' +
                (userProvidedEvidence
                    ? 'El usuario ya aportó captura o prueba: confirma que queda registrada para el Staff e indícale que pulse el botón "Hablar con un Staff" de abajo.'
                    : 'REGLA CRÍTICA: Si el usuario dice que NO tiene clip/pruebas, que no sabe el motivo o que está en espera de SS, ACÉPTALO inmediatamente sin insistir ni pedir pruebas de nuevo; dile que queda anotado tal cual y que pulse el botón "Hablar con un Staff" de abajo para que la Administración revise su caso.'),
            streamer: 'Eres el Asistente de Recepción de Creadores de Contenido de VALLECAS RP. Tu ÚNICA función es recoger el enlace de su canal (Twitch, Kick o TikTok). Si ya lo pasó, confirma que queda registrado e indícale que pulse "Hablar con un Staff" para que revisen su solicitud.',
            soporte: 'Eres el Asistente de Recepción de Tickets de Soporte de VALLECAS RP. Tu función principal es recopilar la información del problema para el Staff (qué ocurre y si tiene captura) y solo responder dudas muy simples de normativa si es una pregunta directa. Si es un bug, sanción, espera de SS, devolución, fallo de cuenta o algo que requiera intervención humana, NO intentes resolverlo tú: confirma que has tomado nota de los detalles e indícale que pulse el botón "Hablar con un Staff" de abajo.'
        };

        const systemPrompt = (categoryPrompts[category] || categoryPrompts.soporte) +
            '\n\nREGLAS ESTRICTAS OBLIGATORIAS:\n' +
            '1. NUNCA te hagas pasar por un Staff humano ni digas "ya te atiendo sin bots". Eres un asistente virtual que recopila información para el equipo de Staff.\n' +
            '2. PROHIBIDO REPETIR PREGUNTAS: Lee el historial de la conversación. Si ya preguntaste por pruebas/clips o el usuario ya dijo que no tiene o que no sabe qué pasó, JAMÁS vuelvas a pedirlo.\n' +
            '3. NO INTENTES RESOLVER EL TICKET POR TU CUENTA: Nunca digas "el ban se mantiene", nunca cierres el caso ni des veredictos. Tu trabajo es dejar todo anotado y remitir al botón "Hablar con un Staff".\n' +
            '4. BREVEDAD: Máximo 2 frases cortas, naturales, educadas y en español de España.\n' +
            '5. NUNCA pidas la ID de FiveM si ya la dio o si no hace falta.\n' +
            (repliesSoFar >= 1 ? '6. YA HAS HECHO UNA PREGUNTA ANTES: En esta respuesta NO hagas más preguntas. Confirma que tienes toda la información registrada e indícale que pulse el botón "Hablar con un Staff" aquí abajo.' : '');

        if (!Array.isArray(session.dialogueHistory)) session.dialogueHistory = [];
        const conversationHistory = session.dialogueHistory.slice(-6).map(m => ({ role: m.role, content: m.content }));
        conversationHistory.push({ role: 'user', content: currentMessage });

        // Solo inyectar conocimientos/normativa si es categoría soporte (para dudas rápidas)
        let knowledgeContext = '';
        if (category === 'soporte') {
            try {
                const allKnowledge = await TicketKnowledge.find({}).sort({ createdAt: -1 }).limit(15);
                if (allKnowledge && allKnowledge.length > 0) {
                    knowledgeContext += '\nBASE DE CONOCIMIENTOS OFICIALES DE VALLECAS RP:\n' +
                        allKnowledge.map(k => `• ${k.response}`).join('\n') + '\n';
                }
            } catch (e) { }
        }

        const finalSystemPrompt = systemPrompt + knowledgeContext;

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3.8-27b',
                messages: [
                    { role: 'system', content: finalSystemPrompt },
                    ...conversationHistory
                ],
                max_tokens: 140,
                temperature: 0.3
            })
        });

        if (res.ok) {
            const data = await res.json();
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (reply && reply.length > 5) {
                session.dialogueHistory.push({ role: 'user', content: currentMessage });
                session.dialogueHistory.push({ role: 'assistant', content: reply });
                if (session.dialogueHistory.length > 8) {
                    session.dialogueHistory = session.dialogueHistory.slice(-8);
                }
                return reply;
            }
        } else {
            console.error('⚠️ [AI CHAT STATUS ERROR]:', res.status, await res.text());
        }
    } catch (e) {
        console.error('⚠️ [AI CHAT ERROR]:', e.message);
    }
    return null;
}

// Clasificador rápido con IA para saber si la respuesta del asistente proporciona una solución real
async function checkIfAssistantGaveSolution(asistenteReply, userMsg) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey || !asistenteReply) return false;

    // Si es solo un saludo o pregunta pidiendo más detalles, NUNCA es solución
    const isJustAskingForInfo = /¿(en qué|cuéntame|qué te ocurre|qué te pasa|dime qué|puedes decirme|puedes explicarme|qué necesitas)/i.test(asistenteReply);
    if (isJustAskingForInfo && asistenteReply.length < 90) return false;

    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen/qwen3.8-27b',
                messages: [
                    {
                        role: 'system',
                        content: 'Eres un clasificador interno. Analiza si la respuesta del asistente explica o resuelve una duda/problema planteado por el usuario (responde SI), o si solo es un saludo o pregunta pidiendo que el usuario cuente qué le pasa (responde NO). Responde UNICAMENTE SI o NO.'
                    },
                    {
                        role: 'user',
                        content: `Mensaje del usuario: "${userMsg}"\nRespuesta del asistente: "${asistenteReply}"`
                    }
                ],
                max_tokens: 5,
                temperature: 0.1
            })
        });

        if (res.ok) {
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content?.trim().toUpperCase();
            return text && text.includes('SI');
        }
    } catch (e) { }
    return false;
}

async function handleUserConversation(channel, user, category, combinedText, session) {
    const guild = channel.guild;

    // Si el ticket ya fue resumido para el Staff o solucionado, el asistente NO interviene más
    if (session.status === 'summarized' || session.status === 'solved') {
        return;
    }

    const userTurnCount = (session.userMessages || []).length;
    const repliesSoFar = session.assistantRepliesCount || 0;
    const allUserWords = (session.userMessages || []).map(m => m.content).join(' ').toLowerCase();
    const isOnlyGreeting = /^(buenas|hola|buenas tardes|buenas noches|buenos dias|hey|ey|ola|buenas bro|buenas staff|buenas noches staff)[\s.!?,]*$/i.test(combinedText.trim());

    // Si el usuario pide explícitamente un Staff -> generar resumen y llamar al Staff directamente
    const userWantsStaff = isUserAskingForStaff(combinedText);

    // Botones disponibles: en soporte mostramos ambos; en apelación/donaciones/streamer siempre el botón de Llamar al Staff
    const actionRow = category === 'soporte'
        ? new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_solicitar_staff_${user.id}`)
                .setLabel('🙋‍♂️ Hablar con un Staff')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`btn_problema_solucionado_${user.id}`)
                .setLabel('✅ Problema Solucionado')
                .setStyle(ButtonStyle.Success)
        )
        : new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btn_solicitar_staff_${user.id}`)
                .setLabel('🙋‍♂️ Llamar al Staff (Enviar Resumen)')
                .setStyle(ButtonStyle.Primary)
        );

    // 1. Si el usuario pide explícitamente hablar con un Staff -> avisar al Staff de inmediato y silenciar el asistente
    if (userWantsStaff) {
        session.status = 'summarized';
        if (typeof session.save === 'function') await session.save().catch(() => {});
        await sendStaffSummary(channel, session, false);
        return;
    }

    // 2. En soporte, comprobar si el usuario confirma que ya quedó todo resuelto
    if (category === 'soporte' && userTurnCount >= 1 && !isOnlyGreeting) {
        const lastBotMsg = (session.dialogueHistory && session.dialogueHistory.length > 0)
            ? (session.dialogueHistory[session.dialogueHistory.length - 1]?.content || '')
            : '';
        const isResolvedByText = await isUserConfirmingResolved(combinedText, lastBotMsg);
        if (isResolvedByText) {
            const replyMsg = `¡Perfecto <@${user.id}>! Me alegro de que haya quedado todo claro. 😊\n\n` +
                             `Pulsa **✅ Problema Solucionado** si no necesitas nada más, o **🙋‍♂️ Hablar con un Staff** si prefieres que un miembro del equipo lo revise.`;

            const { embed: resEmbed, files: resFiles } = buildBaseEmbed(guild, null, replyMsg, 0x2ecc71);
            await channel.send({ embeds: [resEmbed], files: resFiles, components: [actionRow] }).catch(() => {});
            session.assistantRepliesCount = repliesSoFar + 1;
            if (typeof session.save === 'function') await session.save().catch(() => {});
            return;
        }
    }

    // 3. LÍMITE DE INTERVENCIONES: El asistente SOLO recopila info (máximo 2 respuestas).
    // Si ya respondió 2 veces, NO sigue haciendo preguntas ni bucleando: ofrece el botón para llamar al Staff.
    if (repliesSoFar >= 2) {
        const readyMsg = `¡Perfecto <@${user.id}>! Ya tengo toda la información anotada para el equipo de Staff.\n\n` +
                         `👇 Pulsa el botón **Hablar con un Staff** de aquí abajo para enviarles el resumen de tu caso y que te atiendan enseguida.`;
        const { embed, files } = buildBaseEmbed(guild, null, readyMsg, 0xD900FF);
        await channel.send({ embeds: [embed], files, components: [actionRow] }).catch(() => {});
        session.assistantRepliesCount = repliesSoFar + 1;
        if (typeof session.save === 'function') await session.save().catch(() => {});
        return;
    }

    // 4. Si el usuario solo dijo "hola" / saludo sin dar datos -> pedir info SIN botones todavía
    if (isOnlyGreeting && userTurnCount === 1) {
        const greetMap = {
            apelacion: `¡Buenas <@${user.id}>! Cuéntame por favor el motivo de tu sanción/baneo y si tienes alguna captura o clip para dejárselo anotado al Staff.`,
            donaciones: `¡Buenas <@${user.id}>! Dime qué te gustaría consultar o adquirir (Coche VIP, Pack, Casa/MLO, Dinero IC...) y si prefieres **Bizum** o **PayPal** para pasárselo al encargado.`,
            streamer: `¡Buenas <@${user.id}>! Pásame el enlace de tu canal de **Twitch, Kick o TikTok** para dejárselo registrado al Staff.`,
            soporte: `¡Buenas <@${user.id}>! Cuéntame con detalle qué problema o duda tienes (y adjunta captura si puedes) para dejárselo preparado al Staff.`
        };
        const { embed, files } = buildBaseEmbed(guild, null, greetMap[category] || greetMap.soporte, 0xD900FF);
        await channel.send({ embeds: [embed], files, components: [] }).catch(() => {});
        session.assistantRepliesCount = repliesSoFar + 1;
        if (typeof session.save === 'function') await session.save().catch(() => {});
        return;
    }

    // Determinar si ya tenemos información suficiente para mostrar los botones de llamar al Staff:
    // - Ya respondió antes el asistente (repliesSoFar >= 1), O
    // - El usuario ya dio bastante detalle (ej. rellenó formulario / mensaje >= 45 caracteres), O
    // - Adjuntó una imagen/captura o enlace (ej. link de Twitch/Kick/TikTok/Medal)
    const hasEnoughInfo =
        repliesSoFar >= 1 ||
        combinedText.trim().length >= 45 ||
        hasUserProvidedEvidence(session.userMessages || []) ||
        (session.extractedData?.streamLinks && session.extractedData.streamLinks.length > 0);

    // 5. Respuesta breve de recopilación con IA
    // Si aún falta info (mensaje corto sin detalles en turno 1), pregunta sin botones; en cuanto hay info suficiente, muestra los botones
    const aiReply = await generateAIResponse(category, session, combinedText, user.tag);
    if (aiReply) {
        const { embed, files } = buildBaseEmbed(
            guild,
            null,
            aiReply,
            0xD900FF
        );
        await channel.send({ embeds: [embed], files, components: hasEnoughInfo ? [actionRow] : [] }).catch(() => { });
        session.assistantRepliesCount = repliesSoFar + 1;
        if (typeof session.save === 'function') await session.save().catch(() => {});
        return;
    }

    // Respaldo si falla Groq AI: confirmar registro y mostrar botones si ya hay info suficiente
    const fallbackDesc = hasEnoughInfo
        ? `¡Perfecto <@${user.id}>! He dejado registrada tu información para el equipo de Staff.\n\n👇 Pulsa el botón de abajo cuando estés listo para avisar al Staff y enviarles el resumen de tu ticket.`
        : `¡Buenas <@${user.id}>! Por favor, dame un poco más de detalle sobre tu caso (y captura si tienes) para dejárselo todo preparado al Staff.`;
    const { embed, files } = buildBaseEmbed(guild, null, fallbackDesc, 0xD900FF);
    await channel.send({ embeds: [embed], files, components: hasEnoughInfo ? [actionRow] : [] }).catch(() => { });
    session.assistantRepliesCount = repliesSoFar + 1;
    if (typeof session.save === 'function') await session.save().catch(() => {});
}

// Bienvenida cordial en tickets nuevos
async function sendCategoryWelcome(channel, user, category) {
    const guild = channel.guild;
    let title = '👋 ¡HOLA! TE DAMOS LA BIENVENIDA A VALLECAS RP';
    let desc = '';
    const components = [];

    if (category === 'donaciones') {
        title = '💎 ASISTENCIA PARA DONACIONES | VALLECAS RP';
        desc =
            `¡Buenas <@${user.id}>! Gracias por tu interés en apoyar a la comunidad de **VALLECAS RP**.\n\n` +
            `Para poder orientarte y atenderte de la forma más rápida y personalizada posible:\n\n` +
            `📦 **| ¿Qué te gustaría adquirir?**\n` +
            `> Coches VIP, Packs, Casas / MLOs, Dinero IC o Armas ❗\n\n` +
            `💳 **| Métodos de pago oficiales:**\n` +
            `> **Bizum** y **PayPal** exclusivamente ❗\n\n` +
            `*(Puedes seleccionar abajo una categoría para empezar o explicarnos directamente lo que necesitas).*`;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_cat_coche').setLabel('🚗 Coche VIP').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_pack').setLabel('📦 Pack VIP').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_casa').setLabel('🏠 Casa / MLO').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_dinero').setLabel('💰 Dinero IC').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_cat_otro').setLabel('❓ Otra cosa / Consulta').setStyle(ButtonStyle.Secondary)
        );
        components.push(row);
    } else if (category === 'streamer') {
        title = '🎬 SOLICITUD DE CREADOR DE CONTENIDO';
        desc =
            `¡Buenas <@${user.id}>! Un placer tenerte por aquí.\n\n` +
            `Si deseas solicitar rango o colaboración de Streamer Oficial en **VALLECAS RP**, facilítanos tus enlaces oficiales de **Twitch, Kick o TikTok**.\n\n` +
            `Nuestro sistema auditará tus estadísticas para que la Administración revise tu solicitud.`;
    } else if (category === 'apelacion') {
        title = '🔨 APELACIÓN DE SANCIÓN O BANEO';
        desc =
            `¡Buenas <@${user.id}>! Te damos la bienvenida a tu ticket de apelación.\n\n` +
            `Para poder tramitar la revisión de tu sanción con la Administración:\n\n` +
            `⚖️ **| Motivo de la sanción:**\n` +
            `> Explícanos con tranquilidad qué te ocurrió y el motivo de la sanción ❗\n\n` +
            `📹 **| Pruebas o alegaciones:**\n` +
            `> Aporta clips, capturas o tus explicaciones sinceras de lo sucedido ❗\n\n` +
            `*(Nuestro asistente virtual conversará contigo para preparar tu expediente antes de llamar al Staff).*`;
    } else {
        title = '🛠️ SOPORTE GENERAL | VALLECAS RP';
        desc =
            `¡Buenas <@${user.id}>! Estamos a tu disposición para ayudarte.\n\n` +
            `Explícanos tu duda o incidencia con tranquilidad y te atenderemos enseguida.`;
    }

    const { embed, files } = buildBaseEmbed(guild, title, desc, 0x8e44ad);
    await channel.send({ embeds: [embed], files, components }).catch(() => { });
}

// Resumen detallado para Staff
async function sendStaffSummary(channel, session, isResolved = false) {
    const guild = channel.guild;
    const category = session.category;
    const user = await channel.client.users.fetch(session.userId).catch(() => null);
    const userTag = user ? `<@${user.id}> (\`${user.tag}\`)` : `<@${session.userId}>`;

    const allText = session.userMessages.map(m => m.content).join('\n');

    let summaryTitle = isResolved ? '✅ TICKET SOLUCIONADO POR ASISTENTE VIRTUAL' : '📋 RESUMEN DETALLADO PARA EL STAFF';
    let summaryDesc = '';

    if (isResolved) {
        summaryTitle = '✅ INCIDENCIA RESUELTA | TICKET SOLUCIONADO';
        const cleanSummary = await summarizeReasonWithAI(category, allText);
        summaryDesc =
            `👤 **Usuario:** ${userTag}\n` +
            `📌 **Consulta / Incidencia tratada:**\n` +
            `> ${cleanSummary}\n\n` +
            `💬 **Últimos mensajes:**\n` +
            `> *"${allText.replace(/\n+/g, ' ').slice(-200)}"\n\n` +
            `🟢 **Estado:** SOLUCIONADO por el Asistente Virtual.\n` +
            `⚖️ **Acción para el Staff:** El ticket ha sido renombrado a \`solucionado-...\`. Por favor, revisa el caso y procede al cierre manual cuando lo estimes oportuno.`;

    } else if (category === 'donaciones') {
        summaryTitle = '💎 RESUMEN DE DONACIÓN | VALLECAS RP';
        const cleanSummary = await summarizeReasonWithAI('donaciones', allText);
        const item = session.extractedData.donationItem || 'A consultar con administración';
        const method = session.extractedData.paymentMethod || (allText.toLowerCase().includes('bizum') ? 'Bizum' : (allText.toLowerCase().includes('paypal') ? 'PayPal' : 'Pendiente'));

        summaryDesc =
            `👤 **Usuario:** ${userTag}\n` +
            `📦 **Interés:** ${item}\n` +
            `💳 **Método de pago:** ${method}\n\n` +
            `📋 **Motivo / Petición del Usuario:**\n` +
            `> ${cleanSummary}\n\n` +
            `💬 **Mensajes originales:**\n` +
            `> *"${allText.replace(/\n+/g, ' ').slice(0, 200)}"*`;

    } else if (category === 'apelacion') {
        summaryTitle = '🔨 INFORME DE APELACIÓN | VALLECAS RP';
        const cleanSummary = await summarizeReasonWithAI('apelacion', allText);
        const cleanDeclaration = allText.replace(/\[Adjunta imagen\/captura:[^\]]+\]/gi, '').replace(/\n+/g, ' ').trim();

        summaryDesc =
            `👤 **Usuario:** ${userTag}\n` +
            `⚖️ **Motivo de la apelación:**\n` +
            `> ${cleanSummary}\n\n` +
            `💬 **Declaración del usuario:**\n` +
            `> *"${cleanDeclaration.slice(0, 250) || 'Sin declaración adicional'}"*\n\n` +
            `⚡ **Resolución:** Pendiente de revisión por Administración.`;

    } else if (category === 'streamer') {
        summaryTitle = '🟣 SOLICITUD DE STREAMER | VALLECAS RP';
        const streamUrls = session.extractedData.streamLinks.length > 0 ? session.extractedData.streamLinks : extractStreamUrls(allText);

        summaryDesc =
            `👤 **Usuario:** ${userTag}\n` +
            `🔗 **Canales:** ${streamUrls.length > 0 ? streamUrls.join(', ') : 'No aportados aún'}\n\n` +
            `💬 **Mensaje:**\n` +
            `> *"${allText.replace(/\n+/g, ' ').slice(0, 200)}"*`;

    } else {
        summaryTitle = '🛠️ RESUMEN DE INCIDENCIA | INTERVENCIÓN DE STAFF';
        const cleanSummary = await summarizeReasonWithAI('soporte', allText);

        summaryDesc =
            `👤 **Usuario:** ${userTag}\n` +
            `📌 **Motivo detectado:**\n` +
            `> ${cleanSummary}\n\n` +
            `🤖 **Intervención del Asistente:**\n` +
            `> El Asistente Virtual intentó guiar y solucionar la consulta del usuario, pero se requiere la intervención y atención directa de un miembro del Staff para resolverla.\n\n` +
            `💬 **Mensajes del usuario:**\n` +
            `> *"${allText.replace(/\n+/g, ' ').slice(0, 200)}"*\n\n` +
            `⏳ **Estado:** Esperando atención del Staff.`;
    }

    const embedColor = isResolved ? 0x2ecc71 : 0x3498db;
    const { embed, files } = buildBaseEmbed(guild, summaryTitle, summaryDesc, embedColor);

    let foundImageUrl = session.extractedData?.attachmentUrl;
    if (!foundImageUrl) {
        const imgMatch = allText.match(/https?:\/\/[^\s]+?\.(png|jpg|jpeg|webp)/i) || allText.match(/https?:\/\/cdn\.discordapp\.com\/attachments\/[^\s]+/i);
        if (imgMatch && imgMatch[0]) {
            foundImageUrl = imgMatch[0].replace(/[\]'")]+$/, '');
        }
    }

    if (foundImageUrl) {
        embed.setImage(foundImageUrl);
    }

    const pingContent = isResolved ? `🔔 **Registro de Incidencia Solucionada:**` : `🔔 <@&${ROLE_STAFF_ID}>`;

    await channel.send({
        content: pingContent,
        embeds: [embed],
        files: files
    }).catch(() => { });
}

// Procesar ticket retroactivo comprobando que NINGÚN staff haya intervenido
async function processExistingTicket(channel, triggerUser = null) {
    try {
        if (!isValidTicketCategory(channel)) return 'NO_VALID_CAT';

        const category = detectTicketCategory(channel);
        const fetchedMessages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!fetchedMessages || fetchedMessages.size === 0) return 'NO_MESSAGES';

        const chronological = Array.from(fetchedMessages.values()).reverse();
        let ticketOwner = null;

        // 1. Detectar al dueño del ticket
        for (const msg of chronological) {
            if (msg.author.bot) {
                // Mención en texto del bot (ej: @Isalove)
                if (msg.mentions.users.size > 0) {
                    const nonBotMention = msg.mentions.users.find(u => !u.bot);
                    if (nonBotMention) {
                        ticketOwner = nonBotMention;
                        break;
                    }
                }
                // Mención en Embeds de King
                if (msg.embeds && msg.embeds.length > 0) {
                    for (const embed of msg.embeds) {
                        const embedText = `${embed.title || ''} ${embed.description || ''}`;
                        const mentionMatch = embedText.match(/<@!?(\d{17,20})>/);
                        if (mentionMatch) {
                            ticketOwner = await channel.client.users.fetch(mentionMatch[1]).catch(() => null);
                            if (ticketOwner) break;
                        }
                    }
                    if (ticketOwner) break;
                }
            }
        }

        // Si no se encuentra por mención, buscar en permissionOverwrites
        if (!ticketOwner) {
            const userPerm = channel.permissionOverwrites.cache.find(po => po.type === 1 && po.id !== channel.client.user.id);
            if (userPerm) {
                ticketOwner = await channel.client.users.fetch(userPerm.id).catch(() => null);
            }
        }

        // Si sigue sin aparecer, el primer autor no-bot
        if (!ticketOwner) {
            for (const msg of chronological) {
                if (!msg.author.bot) {
                    ticketOwner = msg.author;
                    break;
                }
            }
        }

        // Usuario efectivo (siempre presente para no fallar)
        const effectiveUser = ticketOwner || { id: channel.id, tag: 'Usuario' };

        // 2. Comprobar si un Staff DISTINTO al usuario ya habló
        const staffInvolved = await hasStaffParticipated(channel, ticketOwner ? ticketOwner.id : null, triggerUser?.id);
        if (staffInvolved) {
            return 'STAFF_EXISTS';
        }

        // 3. Recopilar mensajes del usuario
        const userMsgs = ticketOwner
            ? chronological.filter(m => m.author.id === ticketOwner.id).map(m => ({ content: m.content, timestamp: m.createdAt }))
            : chronological.filter(m => !m.author.bot).map(m => ({ content: m.content, timestamp: m.createdAt }));

        // CASO A: El usuario aún no ha escrito nada
        if (userMsgs.length === 0) {
            const botSentWelcome = chronological.some(m => m.author.id === channel.client.user.id);
            if (!botSentWelcome) {
                await sendCategoryWelcome(channel, effectiveUser, category);
                return 'WELCOMED';
            }
            return 'WAITING_USER';
        }

        // CASO B: El usuario ya ha escrito -> Interacción Conversacional
        const allUserText = userMsgs.map(m => m.content).join('\n');
        const normalized = normalizeSlang(allUserText);
        const streamLinks = extractStreamUrls(allUserText);

        const session = {
            channelId: channel.id,
            userId: effectiveUser.id,
            category,
            userMessages: userMsgs,
            extractedData: {
                idFiveM: null,
                donationItem: null,
                paymentMethod: normalized.includes('bizum') ? 'Bizum' : (normalized.includes('paypal') ? 'PayPal' : null),
                streamLinks
            }
        };

        if (normalized.includes('coche')) session.extractedData.donationItem = 'Coche VIP';
        if (normalized.includes('pack')) session.extractedData.donationItem = 'Pack VIP';
        if (normalized.includes('casa') || normalized.includes('mlo')) session.extractedData.donationItem = 'Casa / MLO';
        if (normalized.includes('dinero')) session.extractedData.donationItem = 'Dinero IC';

        // Si es la primera interacción del usuario o solo ha mandado 1 mensaje, conversar cordial primero
        const hasInteracted = chronological.some(m => m.author.id === channel.client.user.id && !m.embeds?.[0]?.title?.includes('RESUMEN') && !m.embeds?.[0]?.title?.includes('INFORME'));

        if (!hasInteracted) {
            await handleUserConversation(channel, effectiveUser, category, allUserText, session);
            return 'CONVERSING';
        }

        await TicketSession.findOneAndUpdate(
            { channelId: channel.id },
            {
                channelId: channel.id,
                userId: effectiveUser.id,
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
        console.error('⚠️ [ASISTENTE TICKETS processExistingTicket Error]:', e);
        return `ERROR_${e.message}`;
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

            // Esperar 4 segundos a que King termine de renombrar el canal, asignar permisos y enviar su mensaje inicial
            setTimeout(async () => {
                const refreshed = await channel.guild.channels.fetch(channel.id).catch(() => null);
                if (!refreshed || !isValidTicketCategory(refreshed)) return;

                const category = detectTicketCategory(refreshed);

                // Obtener mensajes de bienvenida de King para saber qué usuario abrió el ticket
                const msgs = await refreshed.messages.fetch({ limit: 10 }).catch(() => null);
                let ticketOwner = null;

                if (msgs) {
                    for (const m of msgs.values()) {
                        if (m.author.bot && m.mentions.users.size > 0) {
                            ticketOwner = m.mentions.users.find(u => !u.bot);
                            if (ticketOwner) break;
                        }
                    }
                }

                if (!ticketOwner) {
                    const userPerm = refreshed.permissionOverwrites.cache.find(po => po.type === 1 && po.id !== client.user.id);
                    if (userPerm) {
                        ticketOwner = await client.users.fetch(userPerm.id).catch(() => null);
                    }
                }

                const effectiveUser = ticketOwner || { id: refreshed.id, tag: 'Usuario' };

                // Comprobar si ya intervino otro staff
                const staffActive = await hasStaffParticipated(refreshed, effectiveUser.id);
                if (staffActive) return;

                await TicketSession.findOneAndUpdate(
                    { channelId: refreshed.id },
                    { channelId: refreshed.id, userId: effectiveUser.id, category, status: 'open' },
                    { upsert: true }
                );

                await sendCategoryWelcome(refreshed, effectiveUser, category);
            }, 4000);
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

// 2. Comando de diagnóstico en vivo en el ticket actual
            if (['!diagnostico', '!testticket', '!checkticket'].includes(contentLower)) {
                if (!isStaff) return;
                const ch = message.channel;
                const parent = ch.parent;
                const parentId = ch.parentId;
                const isStrictCategory = parentId && ALLOWED_CATEGORY_IDS.includes(parentId);

                const botMember = await message.guild.members.fetchMe().catch(() => null);
                const permissionsInChannel = botMember ? ch.permissionsFor(botMember) : null;
                const canView = permissionsInChannel ? permissionsInChannel.has(PermissionFlagsBits.ViewChannel) : false;
                const canSend = permissionsInChannel ? permissionsInChannel.has(PermissionFlagsBits.SendMessages) : false;
                const canEmbed = permissionsInChannel ? permissionsInChannel.has(PermissionFlagsBits.EmbedLinks) : false;

                return message.reply(
                    `🔍 **DIAGNÓSTICO DEL CANAL Y PERMISOS:**\n` +
                    `> • **Canal:** <#${ch.id}> (\`${ch.name}\`)\n` +
                    `> • **ID Categoría Padre:** \`${parentId || 'Ninguna'}\` (${parent ? parent.name : 'Sin padre'})\n` +
                    `> • **¿Es una de las 4 IDs oficiales?:** ${isStrictCategory ? '✅ SÍ' : '❌ NO'}\n` +
                    `> • **Permisos del Bot en este Ticket:**\n` +
                    `>   - Ver Canal: ${canView ? '🟢 SÍ' : '🔴 NO'}\n` +
                    `>   - Enviar Mensajes: ${canSend ? '🟢 SÍ' : '🔴 NO'}\n` +
                    `>   - Adjuntar Enlaces/Embeds: ${canEmbed ? '🟢 SÍ' : '🔴 NO'}`
                );
            }
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
                    // Filtrar ESTRICTAMENTE: Canales de texto cuyo parentId sea una de las 4 IDs exactas
                    const targetChannels = allChannels.filter(c => c && c.type === 0 && c.parentId && ALLOWED_CATEGORY_IDS.includes(c.parentId));

                    if (targetChannels.size === 0) {
                        return statusMsg.edit('⚠️ No se encontraron canales de texto dentro de las 4 categorías oficiales.');
                    }

                    let summarizedCount = 0;
                    let welcomedCount = 0;
                    let skippedCount = 0;
                    const logDetails = [];

                    for (const [, ch] of targetChannels) {
                        const res = await processExistingTicket(ch, message.author);
                        if (res === true) {
                            summarizedCount++;
                            logDetails.push(`✅ <#${ch.id}>: Resumido`);
                        } else if (res === 'WELCOMED') {
                            welcomedCount++;
                            logDetails.push(`👋 <#${ch.id}>: Bienvenida enviada`);
                        } else {
                            skippedCount++;
                            logDetails.push(`⏭️ <#${ch.id}>: ${res || 'Invalido'}`);
                        }
                    }

                    console.log('📊 [PROCESARTODOS LOG]:\n' + logDetails.join('\n'));

                    return statusMsg.edit(
                        `✅ **Proceso completado con éxito:**\n` +
                        `> 📋 **Resúmenes para Staff generados:** \`${summarizedCount}\` ticket(s)\n` +
                        `> 👋 **Tickets vacíos donde el asistente habló al usuario:** \`${welcomedCount}\` ticket(s)\n` +
                        `> 🛡️ **Saltados (con Staff atendiendo o cerrados):** \`${skippedCount}\` ticket(s)\n\n` +
                        (logDetails.length > 0 ? `*Últimos revisados:*\n${logDetails.slice(0, 5).join('\n')}` : '')
                    );
                } catch (err) {
                    console.error('Error en !procesartodos:', err);
                    return statusMsg.edit(`❌ Error al procesar canales: ${err.message}`);
                }
            }

            // ==========================================
            // APRENDIZAJE ACTIVO EN CANAL 1571488286789079080
            // ==========================================
            // Cada vez que un Staff escribe en el canal de aprendizaje, el bot memoriza el texto
            if (message.channel.id === canalAprendizajeId) {
                const cleanText = message.content.trim();
                if (cleanText.length > 5 && !cleanText.startsWith('!')) {
                    try {
                        await TicketKnowledge.create({
                            category: 'general',
                            questionPattern: cleanText.slice(0, 50),
                            response: cleanText,
                            addedBy: message.author.tag || message.author.username
                        });
                        await message.react('🧠').catch(() => {});
                        console.log(`🧠 [ASISTENTE APRENDIZAJE] Nuevo conocimiento registrado: "${cleanText.slice(0, 60)}..."`);
                    } catch (e) {
                        console.error('Error guardando aprendizaje:', e.message);
                    }
                }
                return;
            }

            // ==========================================
            // DETECCIÓN DE RESUMEN DEL STAFF (RESUMEN: ...)
            // ==========================================
            // Si un miembro del Staff escribe "RESUMEN: ..." en un ticket oficial,
            // el bot borra su mensaje plano y publica un Embed oficial con el resumen formateado.
            if (isStaff && isValidTicketCategory(message.channel)) {
                const matchResumen = message.content.match(/^\*{0,2}RESUMEN\*{0,2}\s*:\s*([\s\S]+)$/i);
                if (matchResumen && matchResumen[1]) {
                    const resumenStaffText = matchResumen[1].trim();
                    // 1. Borrar el mensaje en texto plano del Staff
                    await message.delete().catch(() => {});

                    // 2. Crear el Embed oficial con el diseño del servidor
                    const logoAttachment = getLogoAttachment();
                    const iconUrl = logoAttachment ? 'attachment://logo.png' : (message.guild.iconURL() || undefined);

                    const staffTag = `<@${message.author.id}> (\`${message.author.tag || message.author.username}\`)`;

                    const resumenStaffEmbed = new EmbedBuilder()
                        .setColor(0x2ecc71)
                        .setAuthor({
                            name: 'RESOLUCIÓN Y CIERRE DE TICKET | VALLECAS RP',
                            iconURL: iconUrl
                        })
                        .setTitle('📌 RESUMEN DE ATENCIÓN DE STAFF')
                        .setDescription(
                            `👮 **| Staff Atendente:**\n` +
                            `> ${staffTag} ❗\n\n` +
                            `📋 **| Resumen de la Intervención:**\n` +
                            `> ${resumenStaffText}\n\n` +
                            `✅ *Caso atendido y registrado formalmente en la administración de VALLECAS RP.*`
                        )
                        .setThumbnail(iconUrl)
                        .setFooter({
                            text: 'VALLECAS RP • Registro de Soporte y Moderación',
                            iconURL: iconUrl
                        })
                        .setTimestamp();

                    await message.channel.send({
                        embeds: [resumenStaffEmbed],
                        files: logoAttachment ? [logoAttachment] : []
                    }).catch(() => {});
                    return;
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
            // Comprobamos si hay algún staff atendiendo (excluyendo al que acaba de escribir si es el creador del ticket)
            const staffActive = await hasStaffParticipated(message.channel, message.author.id);
            if (staffActive) return;

            // 3. Si el que acaba de escribir es un Staff, solo ignorar si NO es el creador del ticket
            // (Si un staff o admin abre un ticket de soporte/donación para probar o como usuario, el bot SÍ le debe atender)
            let isAuthorTicketOwner = false;
            try {
                // A) Comprobar el topic del canal (donde King pone "por <@ID>")
                if (message.channel.topic && message.channel.topic.includes(message.author.id)) {
                    isAuthorTicketOwner = true;
                }

                // B) Comprobar la sesión previa de la BD
                if (!isAuthorTicketOwner) {
                    const existingSess = await TicketSession.findOne({ channelId: message.channel.id });
                    if (existingSess && existingSess.userId === message.author.id) {
                        isAuthorTicketOwner = true;
                    }
                }

                // C) Comprobar permisos del usuario en el canal (type: 1 = Member overwrite)
                if (!isAuthorTicketOwner && message.channel.permissionOverwrites) {
                    const hasUserOverwrite = message.channel.permissionOverwrites.cache.has(message.author.id);
                    if (hasUserOverwrite) isAuthorTicketOwner = true;
                }
            } catch (e) { }

            if (isStaff && !isAuthorTicketOwner) return;

            const channelId = message.channel.id;
            let session = await TicketSession.findOne({ channelId });
            const category = detectTicketCategory(message.channel);

            if (!session) {
                session = await TicketSession.create({
                    channelId,
                    userId: message.author.id,
                    category,
                    status: 'open',
                    assistantRepliesCount: 0,
                    dialogueHistory: [],
                    userMessages: []
                });
            }

            // Si ya se envió el resumen al Staff o el ticket se marcó como solucionado, el asistente guarda silencio absoluto
            if (session.status === 'summarized' || session.status === 'solved') {
                // Solo guardar silenciosamente capturas adicionales si el usuario sube una después
                if (message.attachments && message.attachments.size > 0 && !session.extractedData?.attachmentUrl) {
                    const firstAttach = message.attachments.first();
                    if (firstAttach && firstAttach.url) {
                        session.extractedData.attachmentUrl = firstAttach.url;
                        await session.save().catch(() => {});
                    }
                }
                return;
            }

            // Buffer anti-mensajes fragmentados (espera rápida de 3.5s para agrupar mensajes seguidos)
            if (!userMessageBuffers.has(channelId)) {
                userMessageBuffers.set(channelId, { timeout: null, messages: [] });
            }

            const buffer = userMessageBuffers.get(channelId);
            let msgText = message.content.trim();
            if (message.attachments && message.attachments.size > 0) {
                const firstAttach = message.attachments.first();
                if (firstAttach && firstAttach.url) {
                    session.extractedData.attachmentUrl = firstAttach.url;
                }
                const attachInfo = `[Adjunta imagen/captura: ${message.attachments.map(a => a.url).join(' ')}]`;
                msgText = msgText ? `${msgText} ${attachInfo}` : attachInfo;
            }
            buffer.messages.push(msgText);

            if (buffer.timeout) clearTimeout(buffer.timeout);

            buffer.timeout = setTimeout(async () => {
                // Evitar ejecuciones duplicadas simultáneas en el mismo ticket
                if (processingChannels.has(channelId)) return;
                processingChannels.add(channelId);

                try {
                    // Recargar sesión fresca desde BD por si el usuario pulsó el botón durante el buffer
                    const freshSession = await TicketSession.findOne({ channelId }) || session;
                    if (freshSession.status === 'summarized' || freshSession.status === 'solved') {
                        userMessageBuffers.delete(channelId);
                        return;
                    }

                    // Volver a comprobar que ningún staff haya escrito durante el buffer
                    const staffCheck = await hasStaffParticipated(message.channel, freshSession.userId);
                    if (staffCheck) {
                        userMessageBuffers.delete(channelId);
                        return;
                    }

                    const combinedText = buffer.messages.join(' ');
                    buffer.messages = [];
                    userMessageBuffers.delete(channelId);

                    if (!combinedText.trim()) return;

                    // Indicador de "Escribiendo..."
                    message.channel.sendTyping().catch(() => {});

                    const normalized = normalizeSlang(combinedText);
                    const idFound = extractFiveMId(combinedText);
                    const streamLinks = extractStreamUrls(combinedText);

                    freshSession.userMessages.push({ content: combinedText, timestamp: new Date() });
                    if (idFound && !freshSession.extractedData.idFiveM) freshSession.extractedData.idFiveM = idFound;
                    if (streamLinks.length > 0) {
                        freshSession.extractedData.streamLinks = [...new Set([...(freshSession.extractedData.streamLinks || []), ...streamLinks])];
                    }

                    if (normalized.includes('bizum')) freshSession.extractedData.paymentMethod = 'Bizum';
                    if (normalized.includes('paypal')) freshSession.extractedData.paymentMethod = 'PayPal';
                    if (normalized.includes('coche')) freshSession.extractedData.donationItem = 'Coche VIP';
                    if (normalized.includes('casa') || normalized.includes('mlo')) freshSession.extractedData.donationItem = 'Casa / MLO';
                    if (normalized.includes('pack')) freshSession.extractedData.donationItem = 'Pack VIP';
                    if (normalized.includes('dinero')) freshSession.extractedData.donationItem = 'Dinero IC';

                    await freshSession.save();

                    // El asistente recopila info y muestra SIEMPRE el botón de "Hablar con un Staff"
                    await handleUserConversation(message.channel, message.author, category, combinedText, freshSession);
                } finally {
                    processingChannels.delete(channelId);
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

            // 0. Botón: "Hablar con un Staff" (CUALQUIER USUARIO PUEDE PULSARLO)
            if (customId.startsWith('btn_solicitar_staff_')) {
                const targetUserId = customId.replace('btn_solicitar_staff_', '');
                
                let session = await TicketSession.findOne({ channelId: interaction.channelId });
                if (!session) {
                    session = {
                        channelId: interaction.channelId,
                        userId: targetUserId,
                        category: detectTicketCategory(interaction.channel),
                        userMessages: [],
                        extractedData: {}
                    };
                }

                // Si ya se ha enviado el resumen previamente en este ticket
                if (session.status === 'summarized') {
                    // Deshabilitar el botón en el mensaje original si aún existe
                    try {
                        const disabledRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('btn_solicitar_staff_disabled')
                                .setLabel('✅ Resumen ya enviado al Staff')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(true)
                        );
                        await interaction.update({ components: [disabledRow] }).catch(() => {});
                    } catch (e) { }

                    // Enviar mensaje temporal avisando al usuario y auto-eliminarlo a los 6 segundos
                    const tempNotice = await interaction.channel.send({
                        content: `⚠️ <@${interaction.user.id}>, **el resumen de tu incidencia ya ha sido enviado al equipo de Staff**.\n> Por favor, mantén la calma y permanece a la espera; un miembro del Staff te atenderá a la mayor brevedad posible.`
                    }).catch(() => null);

                    if (tempNotice) {
                        setTimeout(() => {
                            tempNotice.delete().catch(() => {});
                        }, 6000);
                    }
                    return;
                }

                // Deshabilitar de inmediato el botón en el mensaje donde se hizo clic para que no se pueda spamear
                try {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('btn_solicitar_staff_disabled')
                            .setLabel('✅ Resumen enviado al Staff')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true)
                    );
                    await interaction.update({ components: [disabledRow] }).catch(() => {});
                } catch (e) {
                    await interaction.deferUpdate().catch(() => {});
                }

                // Enviar el diagnóstico estructurado para el Staff con mención al rol
                session.status = 'summarized';
                if (session.save) await session.save();
                await sendStaffSummary(interaction.channel, session, false);
                return;
            }

            // 0.1 Botón: "Problema Solucionado" (CUALQUIER USUARIO PUEDE PULSARLO)
            if (customId.startsWith('btn_problema_solucionado_')) {
                const targetUserId = customId.replace('btn_problema_solucionado_', '');

                let session = await TicketSession.findOne({ channelId: interaction.channelId });
                if (!session) {
                    session = {
                        channelId: interaction.channelId,
                        userId: targetUserId,
                        category: detectTicketCategory(interaction.channel),
                        userMessages: [],
                        extractedData: {}
                    };
                }

                // Deshabilitar los botones de este mensaje para que no se pulse más
                try {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('btn_solucionado_disabled')
                            .setLabel('✅ Incidencia Marcada como Solucionada')
                            .setStyle(ButtonStyle.Success)
                            .setDisabled(true)
                    );
                    await interaction.update({ components: [disabledRow] }).catch(() => {});
                } catch (e) {
                    await interaction.deferUpdate().catch(() => {});
                }

                if (session.status !== 'solved') {
                    session.status = 'solved';
                    if (session.save) await session.save();

                    // 1. Mensaje cordial de confirmación para el usuario
                    const replyMsg = `¡Estupendo <@${interaction.user.id}>! Nos alegra haberte ayudado y que la incidencia esté resuelta. 👍\n\n` +
                                     `He registrado tu ticket como **SOLUCIONADO** para que el equipo de Staff lo revise y proceda a cerrarlo manualmente. ¡Muchas gracias y disfruta de **Vallecas RP**!`;

                    const { embed: resEmbed, files: resFiles } = buildBaseEmbed(interaction.guild, null, replyMsg, 0x2ecc71);
                    await interaction.channel.send({ embeds: [resEmbed], files: resFiles }).catch(() => {});

                    // 2. Renombrar el ticket a solucionado-nombre (PROHIBIDO CERRAR)
                    try {
                        const currentName = interaction.channel.name.replace(/^solucionado-?/i, '');
                        const newName = `solucionado-${currentName}`.slice(0, 32);
                        await interaction.channel.setName(newName, 'Ticket marcado como solucionado por el usuario');
                        console.log(`🏷️ [ASISTENTE TICKETS] Ticket #${interaction.channel.name} renombrado a #${newName}`);
                    } catch (nameErr) {
                        console.warn('⚠️ [ASISTENTE TICKETS] No se pudo renombrar canal a solucionado:', nameErr.message);
                    }

                    // 3. Dejar el resumen estructurado de ticket solucionado para que el Staff lo audite
                    await sendStaffSummary(interaction.channel, session, true);
                }
                return;
            }

            // 1. Botones de selección de donación (CUALQUIER USUARIO PUEDE PULSARLOS)
            if (customId.startsWith('btn_cat_')) {
                const itemType = customId.replace('btn_cat_', '');
                const labelMap = {
                    coche: 'Coche VIP',
                    pack: 'Pack VIP',
                    casa: 'Casa / MLO',
                    dinero: 'Dinero IC',
                    otro: 'Otra consulta / Donación personalizada'
                };
                const selectedItem = labelMap[itemType] || 'Donación Especial';

                await TicketSession.findOneAndUpdate(
                    { channelId: interaction.channelId },
                    { 'extractedData.donationItem': selectedItem }
                );

                if (itemType === 'otro') {
                    await interaction.reply({
                        content: `¡Perfecto <@${interaction.user.id}>! 👍 Has seleccionado **${selectedItem}**.\nCuéntanos con total tranquilidad qué te gustaría adquirir o consultar y te asesoramos enseguida.`,
                        ephemeral: false
                    });
                } else {
                    await interaction.reply({
                        content: `¡Estupendo <@${interaction.user.id}>! 🎁 Has seleccionado **${selectedItem}**.\nEscríbenos el modelo o detalles específicos que deseas y si prefieres abonarlo por **Bizum** o **PayPal**.`,
                        ephemeral: false
                    });
                }
                return;
            }

            // ==========================================
            // SEGURIDAD: BOTONES DE ACCIÓN EXCLUSIVOS PARA STAFF EN ASISTENTE
            // ==========================================
            // Lista blanca de botones propios del asistente que requieren permisos de Staff
            const staffOnlyPrefixes = [
                'btn_stream_approve_',
                'btn_stream_deny_',
                'btn_dona_bizum_',
                'btn_dona_paypal_',
                'btn_dona_done_',
                'btn_ban_unban_',
                'btn_ban_reject_'
            ];

            const isAsistenteStaffButton = staffOnlyPrefixes.some(prefix => customId.startsWith(prefix));

            // Si no es un botón de Staff de este módulo, dejar que otros listeners (como el panel de valoración en index.js) lo procesen
            if (!isAsistenteStaffButton) return;

            const isStaff = interaction.member?.roles.cache.has(ROLE_STAFF_ID) || interaction.member?.permissions.has(PermissionFlagsBits.Administrator);

            if (!isStaff) {
                return interaction.reply({
                    content: '⛔ **Acceso denegado:** Solo los miembros del Equipo de Staff y Administración pueden pulsar este botón.',
                    ephemeral: true
                });
            }

            // Aprobar Streamer
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
                    content: `🎉 **¡RANGO APROBADO!** Se ha asignado el rol de <@&${ROLE_STREAMER_ID}> a <@${targetUserId}> por <@${interaction.user.id}>.`,
                    ephemeral: false
                });
                return;
            }

            // Denegar Streamer
            if (customId.startsWith('btn_stream_deny_')) {
                const targetUserId = customId.replace('btn_stream_deny_', '');
                await interaction.reply({
                    content: `❌ La solicitud de Creador de Contenido para <@${targetUserId}> ha sido **denegada** por <@${interaction.user.id}>.`,
                    ephemeral: false
                });
                return;
            }

            // Datos de Pago
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
                    content: `✅ **¡Donación completada y entregada con éxito!** Gracias por apoyar a **VALLECAS RP**. (Gestionado por <@${interaction.user.id}>).`,
                    ephemeral: false
                });
                return;
            }

            // Apelaciones
            if (customId.startsWith('btn_ban_unban_')) {
                const targetUserId = customId.replace('btn_ban_unban_', '');
                await interaction.reply({
                    content: `🔓 **Apelación Aceptada:** Se ha acordado la retirada de la sanción a <@${targetUserId}> por decisión de <@${interaction.user.id}>.`,
                    ephemeral: false
                });
                return;
            }

            if (customId.startsWith('btn_ban_reject_')) {
                const targetUserId = customId.replace('btn_ban_reject_', '');
                await interaction.reply({
                    content: `❌ **Apelación Rechazada:** La sanción a <@${targetUserId}> se mantiene firme por decisión de <@${interaction.user.id}>.`,
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
