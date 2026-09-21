require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActivityType,
    Partials
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. SERVIDOR EXPRESS PARA RENDER (24/7)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('🤖 Bot de Whitelist SPAIN RP activo y funcionando 24/7 en Render.');
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor web de Render escuchando en el puerto ${PORT}`);
});

// ==========================================
// 2. CONFIGURACIÓN DEL CLIENTE DISCORD
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences, // Necesario para detectar cuando los streamers inician directo
        GatewayIntentBits.DirectMessages,
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember
    ]
});

// ==========================================
// CONFIGURACIÓN DINÁMICA Y PERSISTENTE (CONFIG.JSON / .ENV)
// ==========================================
const OWNER_ID = '418558256840179722'; // ID exclusivo del Creador (acceso total a paneles y configuración)
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadDynamicConfig() {
    const defaults = {
        CHANNEL_SOLICITUDES_ID: process.env.CHANNEL_SOLICITUDES_ID || '',
        CHANNEL_APROBADOS_ID: process.env.CHANNEL_APROBADOS_ID || '1550880724930797610',
        CHANNEL_DENEGADOS_ID: process.env.CHANNEL_DENEGADOS_ID || '',
        CHANNEL_STATUS_ID: process.env.CHANNEL_STATUS_ID || '',
        CHANNEL_STREAM_PANEL_ID: process.env.CHANNEL_STREAM_PANEL_ID || '1551179786108280923',
        CHANNEL_STREAMERS_ID: process.env.CHANNEL_STREAMERS_ID || '1551179646865772644',
        CHANNEL_NORMATIVAS_ID: process.env.CHANNEL_NORMATIVAS_ID || '1517530848658849996',
        CHANNEL_TICKETS_ID: process.env.CHANNEL_TICKETS_ID || '1517530849334136844',
        CHANNEL_GENERAL_ID: process.env.CHANNEL_GENERAL_ID || '1517530849032016002',
        ROLE_STAFF_ID: process.env.ROLE_STAFF_ID || '1538191116610838691',
        ROLE_STREAMER_ID: process.env.ROLE_STREAMER_ID || '',
        FIVEM_SERVER_IP: process.env.FIVEM_SERVER_IP || '185.230.52.246:30120',
        FIVEM_CFX_CODE: process.env.FIVEM_CFX_CODE || '7b97gmr',
    };

    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            return { ...defaults, ...saved };
        } catch (e) {
            console.error('Error al leer config.json:', e);
        }
    }
    return defaults;
}

let botConfig = loadDynamicConfig();

function updateConfig(key, value) {
    botConfig[key] = value;
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf8');
        console.log(`💾 [CONFIG GUARDADA] ${key} = ${value}`);
    } catch (e) {
        console.error('Error al guardar config.json:', e);
    }
}

const streamerCooldowns = new Map();

// Configuración de Streamers Oficiales (ID Discord -> Datos del canal)
const STREAMERS_CONFIG = {
    // 'ID_DISCORD': { url: 'https://twitch.tv/canal', platform: 'Twitch', title: '🔥 Directo en SPAIN RP' }
};

const STREAMERS_FILE = path.join(__dirname, 'streamers.json');

function getStreamersData() {
    let data = { ...STREAMERS_CONFIG };
    if (fs.existsSync(STREAMERS_FILE)) {
        try {
            const saved = JSON.parse(fs.readFileSync(STREAMERS_FILE, 'utf8'));
            data = { ...data, ...saved };
        } catch (e) {
            console.error('Error al leer streamers.json:', e);
        }
    }
    return data;
}

function saveStreamer(userId, streamerObj) {
    const current = getStreamersData();
    current[userId] = streamerObj;
    try {
        fs.writeFileSync(STREAMERS_FILE, JSON.stringify(current, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar en streamers.json:', e);
    }
}

// Estado en memoria del servidor FiveM
let liveServerState = {
    online: true,
    players: 0,
    maxPlayers: 128,
    ping: 0,
    gametype: 'ESX Legacy',
    hostname: 'SPAIN RP 🇪🇸'
};

let liveStatusMessageRef = null;

// ==========================================
// SISTEMA DE RETROALIMENTACIÓN Y APRENDIZAJE CONTINUO DE IA (CONTRASTIVO & FORENSE)
// ==========================================
const AI_FEEDBACK_FILE = path.join(__dirname, 'ai_feedback.json');

// Mapeo temporal de formularios pendientes en memoria para asociar decisión del Staff (Aprobada / Denegada)
// Clave: applicantMention o sanitized username -> { text, aiScore, timestamp }
const pendingAuditsMap = new Map();

// Stopwords comunes en español para evitar falsos clichés
const SPANISH_STOP_WORDS = new Set([
    'de', 'la', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'no', 'una',
    'su', 'al', 'lo', 'como', 'mas', 'pero', 'sus', 'le', 'ya', 'o', 'este', 'si', 'porque', 'esta',
    'entre', 'cuando', 'muy', 'sin', 'sobre', 'tambien', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde',
    'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso', 'ante', 'ellos',
    'e', 'esto', 'mi', 'antes', 'algunos', 'que', 'q', 'es', 'era', 'fue', 'son', 'ser', 'ha', 'habia',
    'solicitud', 'whitelist', 'solicitante', 'aprobada', 'denegada', 'enviado', 'decidido', 'fecha', 'hora'
]);

// Función para extraer EXCLUSIVAMENTE las respuestas del usuario (sin encabezados ni datos de bot)
function extractCandidateAnswers(fullText) {
    if (!fullText) return '';
    let text = fullText;

    // Eliminar menciones, canales, roles y enlaces
    text = text.replace(/<@!?\d+>/g, ' ');
    text = text.replace(/<#\d+>/g, ' ');
    text = text.replace(/<@&\d+>/g, ' ');
    text = text.replace(/https?:\/\/\S+/gi, ' ');
    text = text.replace(/📋|🎭|❤️|💀|📖|🪪|👑|✅|❌|🟡|🟢|🔴|⚪|📊|📄|📝|⚠️/g, ' ');
    text = text.replace(/Nueva Solicitud de (?:📋 )?Whitelist/gi, ' ');
    text = text.replace(/Whitelist Solicitud (?:Pendiente|Aprobada|Denegada)/gi, ' ');
    text = text.replace(/ha enviado una solicitud para (?:📋 )?Whitelist/gi, ' ');
    text = text.replace(/Solicitante[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decidido Por[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decisión[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decidido El[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Enviada El[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Roles Concedidos[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Roles[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Estado[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/─{3,}/g, ' ');

    // Extraer secciones de preguntas clave
    const answers = [];
    const rolMatch = text.match(/(?:¿?QUÉ\s+ES\s+EL\s+ROL\??|DEFINICIÓN\s+DE\s+ROL)[:\s]*([\s\S]+?)(?=\n\s*(?:VALORACIÓN|VIDA\s+ÚNICA|HISTORIA|DATOS\s+OOC|$))/i);
    if (rolMatch && rolMatch[1].trim().length > 5) answers.push(rolMatch[1].trim());

    const vidaMatch = text.match(/(?:VALORACIÓN\s+DE\s+VIDA)[:\s]*([\s\S]+?)(?=\n\s*(?:VIDA\s+ÚNICA|HISTORIA|DATOS\s+OOC|$))/i);
    if (vidaMatch && vidaMatch[1].trim().length > 5) answers.push(vidaMatch[1].trim());

    const histMatch = text.match(/(?:HISTORIA\s+DE\s+TU\s+PERSONAJE|HISTORIA)[:\s]*([\s\S]+?)(?=\n\s*(?:DATOS\s+OOC|$))/i);
    if (histMatch && histMatch[1].trim().length > 10) answers.push(histMatch[1].trim());

    if (answers.length > 0) {
        return answers.join('\n\n').trim();
    }

    // Limpieza de etiquetas sueltas si no tenían saltos estructurados
    text = text.replace(/¿?QUÉ ES EL ROL\??/gi, ' ');
    text = text.replace(/VALORACIÓN DE VIDA/gi, ' ');
    text = text.replace(/VIDA ÚNICA - MUERTE PERMANENTE PKT/gi, ' ');
    text = text.replace(/HISTORIA DE TU PERSONAJE OBLIGATORIO/gi, ' ');
    text = text.replace(/DATOS OOC DEL JUGADOR OBLIGATORIO/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

function getAiFeedbackData() {
    const defaultData = {
        totalSamples: 0,
        approvedSamples: 0,
        deniedSamples: 0,
        learnedClichés: {},
        learnedHumanPatterns: {},
        deniedPhrasesCount: {},
        approvedPhrasesCount: {},
        samples: []
    };

    if (fs.existsSync(AI_FEEDBACK_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(AI_FEEDBACK_FILE, 'utf8'));
            return { ...defaultData, ...parsed };
        } catch (e) {
            console.error('Error al leer ai_feedback.json:', e);
        }
    }
    return defaultData;
}

function saveAiFeedbackData(data) {
    try {
        if (data.samples && data.samples.length > 100) {
            data.samples = data.samples.slice(-100);
        }
        fs.writeFileSync(AI_FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar ai_feedback.json:', e);
    }
}

// Extraer n-gramas filtrados para no capturar ruido ni stopwords
function extractInformativeNGrams(text, n = 3) {
    const clean = text.toLowerCase().replace(/[^\wáéíóúñ\s]/gi, ' ').trim();
    const words = clean.split(/\s+/).filter(w => w.length > 1);
    const ngrams = [];

    for (let i = 0; i <= words.length - n; i++) {
        const slice = words.slice(i, i + n);
        // Debe tener al menos 2 palabras que NO sean stopwords
        const nonStopCount = slice.filter(w => !SPANISH_STOP_WORDS.has(w)).length;
        if (nonStopCount >= 2) {
            ngrams.push(slice.join(' '));
        }
    }
    return ngrams;
}

// Función que registra el resultado final de un Staff (Aprobada / Denegada) y retroalimenta contrastivamente
function registerFeedbackOutcome(applicantKey, decisionType, text = '', shouldSave = true) {
    if (!applicantKey) return;

    const data = getAiFeedbackData();
    const isApproved = decisionType === 'APROBADA';
    const isDenied = decisionType === 'DENEGADA';

    let targetText = text;
    if (!targetText && pendingAuditsMap.has(applicantKey)) {
        targetText = pendingAuditsMap.get(applicantKey).text;
    }

    // Limpiar texto para aislar respuestas
    const candidateOnly = extractCandidateAnswers(targetText);
    if (!candidateOnly || candidateOnly.length < 20) return;

    data.totalSamples = (data.totalSamples || 0) + 1;
    if (isApproved) data.approvedSamples = (data.approvedSamples || 0) + 1;
    if (isDenied) data.deniedSamples = (data.deniedSamples || 0) + 1;

    if (!data.deniedPhrasesCount) data.deniedPhrasesCount = {};
    if (!data.approvedPhrasesCount) data.approvedPhrasesCount = {};
    if (!data.learnedClichés) data.learnedClichés = {};
    if (!data.learnedHumanPatterns) data.learnedHumanPatterns = {};

    const ngrams = [
        ...extractInformativeNGrams(candidateOnly, 3),
        ...extractInformativeNGrams(candidateOnly, 4)
    ];

    if (isDenied) {
        for (const phrase of ngrams) {
            data.deniedPhrasesCount[phrase] = (data.deniedPhrasesCount[phrase] || 0) + 1;
        }
    } else if (isApproved) {
        for (const phrase of ngrams) {
            data.approvedPhrasesCount[phrase] = (data.approvedPhrasesCount[phrase] || 0) + 1;
        }
    }

    // Recalcular patrones contrastivos: solo es cliché de IA si se repite en denegadas y NO en aprobadas
    for (const [phrase, dCount] of Object.entries(data.deniedPhrasesCount)) {
        const aCount = data.approvedPhrasesCount[phrase] || 0;
        if (dCount >= 2 && aCount === 0) {
            data.learnedClichés[phrase] = {
                count: dCount,
                weight: Math.min(6 + dCount * 2, 14) // Peso moderado acotado
            };
        } else {
            delete data.learnedClichés[phrase];
        }
    }

    for (const [phrase, aCount] of Object.entries(data.approvedPhrasesCount)) {
        if (aCount >= 2) {
            data.learnedHumanPatterns[phrase] = {
                count: aCount,
                weight: Math.min(4 + aCount * 2, 12)
            };
        }
    }

    data.samples.push({
        applicant: applicantKey,
        decision: decisionType,
        textPreview: candidateOnly.substring(0, 120),
        date: new Date().toISOString()
    });

    if (shouldSave) {
        saveAiFeedbackData(data);
        console.log(`🧠 [IA APRENDIZAJE] Calibrada decisión ${decisionType} para "${applicantKey}". Muestras: ${data.totalSamples}`);
    }
}

// Helper para obtener el estado en tiempo real del servidor FiveM
async function fetchFiveMServerStatus() {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
        const [dynamicRes, playersRes] = await Promise.all([
            fetch(`http://${botConfig.FIVEM_SERVER_IP}/dynamic.json`, { signal: controller.signal }),
            fetch(`http://${botConfig.FIVEM_SERVER_IP}/players.json`, { signal: controller.signal }).catch(() => null)
        ]);

        clearTimeout(timeoutId);
        const ping = Date.now() - startTime;

        if (!dynamicRes.ok) {
            liveServerState = { ...liveServerState, online: false, ping };
            return liveServerState;
        }

        const dynamicData = await dynamicRes.json();
        let playersCount = 0;
        if (typeof dynamicData.clients === 'number') {
            playersCount = dynamicData.clients;
        } else if (playersRes && playersRes.ok) {
            const playersList = await playersRes.json().catch(() => []);
            playersCount = Array.isArray(playersList) ? playersList.length : 0;
        }

        liveServerState = {
            online: true,
            players: playersCount,
            maxPlayers: dynamicData.sv_maxclients || '128',
            hostname: dynamicData.hostname || 'SPAIN RP 🇪🇸',
            gametype: dynamicData.gametype || 'Roleplay',
            mapname: dynamicData.mapname || 'San Andreas',
            ping
        };
        return liveServerState;
    } catch (err) {
        clearTimeout(timeoutId);
        liveServerState = { ...liveServerState, online: false, ping: 0 };
        return liveServerState;
    }
}

// Seguimiento de Uptime y Reinicios
let serverOnlineSince = Date.now();

function getUptimeString() {
    if (!serverOnlineSince) return '0 mins';
    const diffMs = Date.now() - serverOnlineSince;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours > 0) {
        return `${hours} hrs, ${mins} mins`;
    }
    return `${mins} mins`;
}

function getNextRestartString() {
    const now = new Date();
    const restarts = [6, 18];
    const nowHour = now.getHours() + now.getMinutes() / 60;
    let nextHour = restarts.find(h => h > nowHour);
    let diffHours;
    if (nextHour !== undefined) {
        diffHours = nextHour - nowHour;
    } else {
        diffHours = (24 - nowHour) + restarts[0];
    }
    const h = Math.floor(diffHours);
    const m = Math.floor((diffHours - h) * 60);
    return `in ${h} hrs, ${m} mins`;
}

// Función para construir el Embed de Estado del Servidor (Formato idéntico a txAdmin con Logo)
function buildStatusEmbed(state) {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const isOnline = state.online;

    if (isOnline && !serverOnlineSince) {
        serverOnlineSince = Date.now();
    } else if (!isOnline) {
        serverOnlineSince = null;
    }

    const embed = new EmbedBuilder()
        .setColor(isOnline ? 0x2ECC71 : 0xE74C3C)
        .setAuthor({
            name: 'SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user?.displayAvatarURL()
        })
        .setTitle('SPAIN RP')
        .addFields(
            {
                name: '▍ Estado',
                value: isOnline ? '`🟢 Encendido`' : '`🔴 Apagado`',
                inline: true
            },
            {
                name: '▍ Jugadores',
                value: `\`${state.players}/${state.maxPlayers}\``,
                inline: true
            },
            {
                name: '▍ F8 Comando',
                value: `\`cfx.re/join/${botConfig.FIVEM_CFX_CODE}\``,
                inline: false
            },
            {
                name: '▍ Reinicios',
                value: `\`${getNextRestartString()}\``,
                inline: true
            },
            {
                name: '▍ ON',
                value: `\`${getUptimeString()}\``,
                inline: true
            }
        )
        .setFooter({
            text: 'txAdmin 8.0.1 • Updated every minute',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user?.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(logoPath)) {
        embed.setThumbnail('attachment://logo.png');
    }

    return embed;
}

// Función para construir el botón de conectar a FiveM
function buildStatusActionRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('🚀 Conectar a SPAIN RP')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://cfx.re/join/${botConfig.FIVEM_CFX_CODE}`)
    );
}

// Actualizador periódico del panel en el canal fijado
async function updateChannelStatusPanel() {
    const channelId = botConfig.CHANNEL_STATUS_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const state = await fetchFiveMServerStatus();
        const embed = buildStatusEmbed(state);
        const row = buildStatusActionRow();
        const files = [];

        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        if (fs.existsSync(logoPath)) {
            files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
        }

        if (liveStatusMessageRef) {
            await liveStatusMessageRef.edit({ embeds: [embed], components: [row] }).catch(() => {
                liveStatusMessageRef = null;
            });
        }

        if (!liveStatusMessageRef) {
            // Buscar si ya existía un mensaje anterior del bot en el canal
            const fetched = await channel.messages.fetch({ limit: 10 }).catch(() => null);
            const prevMsg = fetched ? fetched.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes('SPAIN RP')) : null;

            if (prevMsg) {
                liveStatusMessageRef = await prevMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
            } else {
                liveStatusMessageRef = await channel.send({ embeds: [embed], components: [row], files }).catch(() => null);
            }
        }
    } catch (e) {
        console.error('Error al actualizar el panel de estado:', e);
    }
}

// Función para construir el Embed del Panel de Streamers (con Logo y Banner oficial)
function buildStreamPanelEmbed() {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const imgDirectoPath = path.join(__dirname, 'assets', 'directo.png');

    const canalStreamers = `<#${botConfig.CHANNEL_STREAMERS_ID || '1551179646865772644'}>`;
    const canalTickets = `<#${botConfig.CHANNEL_TICKETS_ID || '1517530849334136844'}>`;
    const canalGeneral = `<#${botConfig.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6) // Morado elegante SPAIN RP
        .setAuthor({
            name: 'SISTEMA DE CREADORES | SPAIN RP 🇪🇸',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user?.displayAvatarURL()
        })
        .setThumbnail('attachment://logo.png')
        .setTitle('🟣 ¡PANEL DE NOTIFICACIÓN DE DIRECTOS!')
        .setDescription(
            `\u200B\n` +
            `✨ ¡Bienvenido al **Panel Oficial de Creadores y Streamers** de **SPAIN RP** 🇪🇸!\n\n` +
            `Si eres Creador de Contenido o Streamer oficial del servidor, puedes avisar a toda la comunidad cuando comiences directo en **Twitch, Kick o YouTube** con un solo clic.\n\n` +
            `📢 **| ¿Cómo publicar tu directo?**\n` +
            `> Haz clic en el botón inferior **\`🟣 Notificar Directo\`** ❗\n\n` +
            `📍 **| Canal de publicación oficial:**\n` +
            `> ${canalStreamers} ❗\n\n` +
            `⚠️ **| Normativas de los Streamers:**\n` +
            `> • Solo se permite **1 notificación por directo** *(Cooldown de 2 horas)*.\n` +
            `> • Debes estar transmitiendo contenido dentro de **SPAIN RP** 🇪🇸.\n\n` +
            `📁 **| ¿Quieres ser Streamer Oficial?**\n` +
            `> Abre un ticket de creadores en ${canalTickets} ❗\n\n` +
            `🌍 **| 𝗗𝗶𝘀𝗳𝗿𝘂𝘁𝗮 𝘆 𝗰𝗼𝗺𝗽𝗮𝗿𝘁𝗲 𝘁𝘂 𝗰𝗼𝗻𝘁𝗲𝗻𝗶𝗱𝗼,**\n` +
            `> ${canalGeneral} ❗\n\n` +
            `🇪🇸 **| ¡Disfruta y crece en SPAIN RP! |** 🇪🇸`
        )
        .setFooter({
            text: 'SPAIN RP • Creadores de Contenido Oficiales',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user?.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(imgDirectoPath)) {
        embed.setImage('attachment://directo.png');
    }

    return embed;
}

function buildStreamPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_notificar_directo')
            .setLabel('🟣 Notificar Directo')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📢')
    );
}

// Función para asegurar que el panel esté publicado en el canal asignado
async function ensureStreamPanel() {
    const channelId = botConfig.CHANNEL_STREAM_PANEL_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = buildStreamPanelEmbed();
        const row = buildStreamPanelRow();
        const files = [];

        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const imgDirectoPath = path.join(__dirname, 'assets', 'directo.png');

        if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
        if (fs.existsSync(imgDirectoPath)) files.push(new AttachmentBuilder(imgDirectoPath, { name: 'directo.png' }));

        const fetched = await channel.messages.fetch({ limit: 10 }).catch(() => null);
        const prevMsg = fetched ? fetched.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes('PANEL DE NOTIFICACIÓN DE DIRECTOS')) : null;

        if (prevMsg) {
            await prevMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
        } else {
            await channel.send({ embeds: [embed], components: [row], files }).catch(() => null);
        }
        console.log(`✅ [PANEL DIRECTOS] Panel de notificar directos verificado en canal #${channel.name} (${channelId})`);
    } catch (e) {
        console.error('Error al asegurar el panel de streams:', e);
    }
}

// ==========================================
// MOTOR DE AUDITORÍA Y DETECCIÓN MULTI-CAPA DE IA & CLICHÉS
// ==========================================
function buildProgressBar(percentage, length = 10) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// Cálculo de Riqueza Léxica (Type-Token Ratio ajustado por longitud de raíz)
function calculateLexicalRichness(words) {
    if (words.length === 0) return 0;
    const lowerWords = words.map(w => w.toLowerCase().replace(/[^\wáéíóúñ]/gi, ''));
    const uniqueWords = new Set(lowerWords);
    // TTR normalizado usando raíz cuadrada (Guiraud's R Index)
    return uniqueWords.size / Math.sqrt(words.length);
}

// Evaluación de Calidad Narrativa, Persona Gramatical y Extensión (Criterios de Staff de FiveM)
function evaluateFormQuality(fullText, words) {
    const qualityNotes = [];
    const lower = fullText.toLowerCase();

    // Extraer exclusivamente el fragmento de la historia para no confundir 'mi personaje' de las preguntas de normativa
    let storyText = lower;
    const histMatch = fullText.match(/(?:HISTORIA\s+DE\s+TU\s+PERSONAJE|HISTORIA)[:\s]*([\s\S]+?)(?=\n\s*(?:DATOS\s+OOC|$))/i);
    if (histMatch && histMatch[1].trim().length > 10) {
        storyText = histMatch[1].toLowerCase();
    }

    // 1. Detección de Persona Gramatical en la Historia
    const firstPersonMatches = storyText.match(/\b(me llamo|nací|naci|mi infancia|crecí|creci|tuve que|decidí|decidi|aprendí|aprendi|mis padres|fui|empecé|empece|vengo de|tengo \d+ años)\b/g) || [];
    const thirdPersonMatches = storyText.match(/\b(se llama|nació|nacio|su infancia|creció|crecio|tuvo que|decidió|decidio|aprendió|aprendi[oó]|sus padres|fue|empezó|empezo|decide trasladarse|decide mudarse|estuvo trabajando)\b/g) || [];

    let perspective = '3ª Persona (Recomendada)';
    if (firstPersonMatches.length > thirdPersonMatches.length && firstPersonMatches.length >= 2) {
        perspective = '1ª Persona (Revisar si normativas piden 3ª)';
        qualityNotes.push('Historia en 1ª persona ("Yo...")');
    } else if (thirdPersonMatches.length >= 2) {
        perspective = '3ª Persona (Correcta)';
    }

    // 2. Extensión de la Historia (Criterio de brevedad vs profundidad)
    let lengthRating = 'Adecuada';
    if (words.length < 35) {
        lengthRating = 'Muy Corta / Escasa';
        qualityNotes.push('Historia escasa (menos de 35 palabras)');
    } else if (words.length < 60) {
        lengthRating = 'Corta / Poco Detallada';
        qualityNotes.push('Pocos detalles de infancia/motivaciones');
    } else if (words.length > 250) {
        lengthRating = 'Extensa y Detallada';
    }

    // 3. Revisión de mención de Infancia / Orígenes
    const hasInfancia = /\b(infancia|niñez|pequeñ[oa]|colegio|escuela|padres|madre|padre|familia|orígenes|origenes|barrio|afueras|abuelos)\b/i.test(storyText);
    if (!hasInfancia && words.length < 80) {
        qualityNotes.push('No profundiza en infancia/origen');
    }

    return {
        perspective,
        lengthRating,
        wordCount: words.length,
        hasInfancia,
        qualityNotes
    };
}
async function analyzeTextForAI(text) {
    if (!text || typeof text !== 'string') {
        return {
            aiScore: 0,
            humanScore: 100,
            statusEmoji: '🟢',
            statusLabel: 'Texto Insuficiente / Sin Datos',
            wordCount: 0,
            detectedPatterns: [],
            summaryNote: 'No hay suficiente texto para auditar.'
        };
    }

    // Extraer exclusivamente el contenido de las respuestas del postulante
    const cleanText = extractCandidateAnswers(text).trim();
    const words = cleanText.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    if (wordCount < 10) {
        return {
            aiScore: 2,
            humanScore: 98,
            statusEmoji: '🟢',
            statusLabel: 'Texto Breve / Humano',
            wordCount,
            detectedPatterns: ['Longitud breve'],
            summaryNote: 'El texto es breve pero presenta lenguaje espontáneo.'
        };
    }

    // ----------------------------------------------------
    // CAPA 1: Banco de Clichés Arquetípicos de IA (ChatGPT / Claude / Gemini)
    // ----------------------------------------------------
    const hardAiClichés = [
        { regex: /desde (temprana edad|muy pequeñ[oa]|corta edad)/i, label: 'Apertura de ChatGPT ("Desde temprana edad...")', weight: 22 },
        { regex: /creci[oó] en (un barrio|un entorno|una familia) (humilde|conflictiv[oa]|marginal|complicad[oa]|carente)/i, label: 'Cliché de origen de IA ("Creció en un barrio humilde...")', weight: 24 },
        { regex: /forj(ar|ando|ó|aron) su (destino|car[aá]cter|propio camino|futuro)/i, label: 'Frase de destino ("Forjar su propio destino")', weight: 20 },
        { regex: /a pesar de las (dificultades|adversidades|circunstancias|tragedias|desaf[ií]os)/i, label: 'Conector de resiliencia de IA ("A pesar de las adversidades...")', weight: 20 },
        { regex: /(una mezcla|un balance|una combinaci[oó]n) de (determinaci[oó]n|valent[ií]a|respeto|lealtad|firmeza)/i, label: 'Estructura binaria típica de ChatGPT', weight: 24 },
        { regex: /marc[oó] un antes y un despu[eé]s/i, label: 'Expresión formuláica ("Marcó un antes y un después")', weight: 20 },
        { regex: /en busca de (un nuevo comienzo|nuevas oportunidades|un futuro mejor|redenci[oó]n|un cambio de aires|prosperidad)/i, label: 'Motivación cliché de IA ("En busca de un nuevo comienzo...")', weight: 20 },
        { regex: /con la determinaci[oó]n de/i, label: 'Frase de transición de IA ("Con la determinación de...")', weight: 16 },
        { regex: /guiad[oa] por (sus principios|sus valores|su moral|el c[oó]digo|su sentido de la justicia)/i, label: 'Moralismo estándar de IA', weight: 18 },
        { regex: /(firme convicci[oó]n|inquebrantable|resiliencia|perseverante|esp[ií]ritu indomable)/i, label: 'Vocabulario ensayístico de IA', weight: 18 },
        { regex: /encontrar su lugar en el mundo/i, label: 'Cliché existencial de IA', weight: 20 },
        { regex: /le ense[ñn][oó] el valor del (trabajo duro|esfuerzo|respeto|sacrificio)/i, label: 'Lección moral prefabricada', weight: 20 },
        { regex: /un faro de (esperanza|luz|justicia|integridad)/i, label: 'Metáfora estándar de IA', weight: 22 },
        { regex: /su vida dio un giro (de 180 grados|inesperado|dr[aá]stico)/i, label: 'Cliché narrativo de transición', weight: 18 },
        { regex: /marcar(on)? su infancia|dej[oó] una huella imborrable/i, label: 'Fórmula de trauma infantil de IA', weight: 18 },
        { regex: /hacerse un nombre en la ciudad/i, label: 'Cliché de objetivo en GTA RP generado por IA', weight: 20 }
    ];

    let hardClichéScore = 0;
    const hardDetectedPatterns = [];

    for (const item of hardAiClichés) {
        if (item.regex.test(cleanText)) {
            hardClichéScore += item.weight;
            hardDetectedPatterns.push(item.label);
        }
    }

    // CAPA 1.5: Patrones Aprendidos Contrastivamente del Historial
    const feedbackData = getAiFeedbackData();
    let learnedAiBonus = 0;
    let learnedHumanBonus = 0;
    const lowerClean = cleanText.toLowerCase();

    if (feedbackData.learnedClichés) {
        for (const [phrase, info] of Object.entries(feedbackData.learnedClichés)) {
            if (info.count >= 2 && lowerClean.includes(phrase)) {
                learnedAiBonus += Math.min(info.weight || 6, 12);
                if (hardDetectedPatterns.length < 3) {
                    hardDetectedPatterns.push(`Patrón IA histórico ("${phrase.slice(0, 25)}...")`);
                }
            }
        }
    }

    if (feedbackData.learnedHumanPatterns) {
        for (const [phrase, info] of Object.entries(feedbackData.learnedHumanPatterns)) {
            if (info.count >= 2 && lowerClean.includes(phrase)) {
                learnedHumanBonus += Math.min(info.weight || 5, 10);
            }
        }
    }

    // ----------------------------------------------------
    // CAPA 2: Métricas Lingüísticas de Burstiness y Uniformidad
    // ----------------------------------------------------
    const sentences = cleanText.split(/[.!?\n]+/).filter(s => s.trim().length > 0);
    let avgWordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : wordCount;
    let sentenceLengths = sentences.map(s => s.trim().split(/\s+/).length);

    let variance = 0;
    if (sentences.length > 1) {
        const sumSqDiff = sentenceLengths.reduce((acc, len) => acc + Math.pow(len - avgWordsPerSentence, 2), 0);
        variance = sumSqDiff / sentences.length;
    }

    let uniformityScore = 0;
    // La IA suele generar oraciones de longitud casi idéntica (16-24 palabras) con muy baja varianza
    if (sentences.length >= 3 && variance < 12 && avgWordsPerSentence >= 15 && avgWordsPerSentence <= 26 && hardDetectedPatterns.length > 0) {
        uniformityScore += 18;
        hardDetectedPatterns.push('Uniformidad de ritmo artificial');
    }

    // ----------------------------------------------------
    // CAPA 3: Detector de Rasgos y Fluidez Humana (FiveM & Rol España)
    // ----------------------------------------------------
    const humanMarkers = [
        // Jerga y modismos coloquiales de España y rol
        /(\b(ps|q|xq|pq|tmb|tb|dnd|ola|weno|bro|illo|chaval|pive|pibe|curro|currar|madero|placa|poli|pasta|guita|loco|pavo|tío|tio|nano|fui pa|me meti|tocho|rollo|coche|bici|moto|taller|badulaque|garito|faccion|mafia|atraco|robo|secuestro|tiroteo|ceder|esposar|esposas)\b)/i,
        // Expresiones de naturalidad y chat
        /(\b(jajaja|xd|xdxd|jejeje|wtf|la verdad|en plan|osea|o sea|bueno|pues nada|de una|a tope|salir adelante|ganarse la vida|montar un taller|comprar un coche)\b)/i,
        // Términos normativos y técnicos de FiveM escritos con naturalidad
        /(\b(ic|ooc|ck|pk|pkt|pg|mg|vdm|rdm|failrp|valoro|valorar vida|valorar mi vida|staff|clip|dni|inventario|legion|sandy|paleto|lspd|ems|mecanico|banda)\b)/i,
        // Signos de espontaneidad humana (mayúsculas completas, faltas ortográficas naturales, comas sin espacio)
        /[a-z]+,[a-z]+/i,
        /\.{2,3}\s*[a-z]/i,
        /\([^\)]+?\)/i
    ];

    let humanScoreBonus = learnedHumanBonus;
    for (const h of humanMarkers) {
        if (h.test(cleanText)) {
            humanScoreBonus += 12;
        }
    }

    // Si el texto está en mayúsculas o tiene alta varianza en frases -> típicamente humano
    if (cleanText === cleanText.toUpperCase() && cleanText.length > 30) {
        humanScoreBonus += 25; // Los postulantes humanos suelen escribir en mayúsculas
    }
    if (sentences.length >= 3 && variance > 30) {
        humanScoreBonus += 20; // Variabilidad natural
    }

    // ----------------------------------------------------
    // CAPA 4: Consulta a APIs Externas (Sapling, HuggingFace, Gemini)
    // ----------------------------------------------------
    const externalScores = [];

    // 1. Hugging Face Inference API (RoBERTa detector de OpenAI)
    const hfToken = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
    if (hfToken && hfToken.trim().length > 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500);
            const res = await fetch('https://router.huggingface.co/hf-inference/models/openai-community/roberta-base-openai-detector', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${hfToken.trim()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ inputs: cleanText.substring(0, 1000) }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && Array.isArray(data[0])) {
                    const fakeEntry = data[0].find(item => item.label && (item.label.toLowerCase().includes('fake') || item.label.toLowerCase().includes('label_1')));
                    if (fakeEntry && typeof fakeEntry.score === 'number') {
                        const score = Math.round(fakeEntry.score * 100);
                        externalScores.push({ name: 'HuggingFace', score, weight: 1.5 });
                        console.log(`🤗 [AUDITORÍA HUGGINGFACE] Score: ${score}%`);
                    }
                }
            } else {
                console.log(`⚠️ [AUDITORÍA HUGGINGFACE] Status HTTP ${res.status}`);
            }
        } catch (hfErr) {
            console.log(`⚠️ [AUDITORÍA HUGGINGFACE] Excepción: ${hfErr.message}`);
        }
    }

    // 2. Sapling AI Detector
    const saplingKey = process.env.SAPLING_API_KEY;
    if (saplingKey && saplingKey.trim().length > 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const res = await fetch('https://api.sapling.ai/api/v1/aidetect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: saplingKey.trim(),
                    text: cleanText
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (typeof data.score === 'number') {
                    const score = Math.round(data.score * 100);
                    externalScores.push({ name: 'Sapling AI', score, weight: 1.2 });
                    console.log(`🤖 [AUDITORÍA SAPLING] Score: ${score}%`);
                }
            } else {
                console.log(`⚠️ [AUDITORÍA SAPLING] Error HTTP ${res.status}`);
            }
        } catch (apiErr) {
            if (apiErr.name === 'AbortError') {
                console.log(`⏱️ [AUDITORÍA SAPLING] Tiempo de respuesta agotado (>6s)`);
            } else {
                console.log(`⚠️ [AUDITORÍA SAPLING] Excepción: ${apiErr.message}`);
            }
        }
    }

    // 3. Google Gemini AI (Análisis Forense con Gemini 3.6 Flash)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey.trim().length > 0 && geminiKey.startsWith('AIzaSy')) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const geminiPrompt = `Eres un auditor experto de Whitelist de FiveM. Determina de 0 a 100 la probabilidad de que este texto haya sido generado por una IA (ChatGPT/Claude). Si el texto tiene lenguaje coloquial, errores menores o es una historia simple escrita por una persona real, asigna un número bajo (entre 0 y 15). Si usa clichés de IA ("desde temprana edad", "barrio humilde", "forjar destino"), asigna entre 80 y 100. Responde SOLAMENTE con el número entero.\nTexto: "${cleanText.substring(0, 1000)}"`;

            const cleanKey = geminiKey.trim();
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${cleanKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: geminiPrompt }] }]
                }),
                signal: controller.signal
            }).catch(() => null);
            clearTimeout(timeoutId);

            if (res && res.ok) {
                const data = await res.json();
                const parts = data?.candidates?.[0]?.content?.parts || [];
                const fullTextResp = parts.map(p => p.text || '').join(' ').trim();
                const matchNum = fullTextResp.match(/\b\d{1,3}\b/);
                if (matchNum) {
                    const score = Math.min(Math.max(parseInt(matchNum[0], 10), 0), 100);
                    externalScores.push({ name: 'Gemini AI', score, weight: 1.5 });
                    console.log(`✨ [AUDITORÍA GEMINI] Score: ${score}%`);
                }
            }
        } catch (gemErr) {
            console.log(`⚠️ [AUDITORÍA GEMINI] Excepción: ${gemErr.message}`);
        }
    }

    // ----------------------------------------------------
    // CAPA 5: Calibración y Fusión del Ensemble
    // ----------------------------------------------------
    let rawScore = 5; // Base mínima

    if (hardDetectedPatterns.length > 0) {
        rawScore += hardClichéScore + uniformityScore + learnedAiBonus;
    }

    rawScore -= humanScoreBonus;

    if (hardDetectedPatterns.length >= 2) {
        rawScore = Math.max(rawScore, 85);
    } else if (hardDetectedPatterns.length === 1) {
        rawScore = Math.max(rawScore, 40);
    } else {
        rawScore = Math.min(rawScore, 10);
    }

    let localScore = Math.min(Math.max(Math.round(rawScore), 2), 98);
    let finalAiScore = localScore;

    if (externalScores.length > 0) {
        const hfEntry = externalScores.find(e => e.name.toLowerCase().includes('huggingface'));
        const saplingEntry = externalScores.find(e => e.name.toLowerCase().includes('sapling'));

        // Caso Humano Inequívoco: HuggingFace u otra API da <=10% Y no hay clichés duros
        if (hfEntry && hfEntry.score <= 10 && hardDetectedPatterns.length === 0) {
            finalAiScore = Math.min(hfEntry.score, localScore, 8);
        } else if ((hfEntry && hfEntry.score >= 75) || (saplingEntry && saplingEntry.score >= 75) || hardDetectedPatterns.length >= 2) {
            // Caso IA Inequívoco
            const maxScore = Math.max(
                hfEntry ? hfEntry.score : 0,
                saplingEntry ? saplingEntry.score : 0,
                localScore
            );
            finalAiScore = Math.min(Math.max(maxScore, 86), 98);
        } else {
            // Promedio ponderado
            let totalWeighted = localScore * 1.0;
            let totalWeight = 1.0;

            for (const ext of externalScores) {
                totalWeighted += ext.score * ext.weight;
                totalWeight += ext.weight;
            }

            finalAiScore = Math.round(totalWeighted / totalWeight);
        }

        finalAiScore = Math.min(Math.max(finalAiScore, 2), 98);
        console.log(`📊 [ENSEMBLE COMBINADO] Score final calibrado (${externalScores.length} APIs + Motor Local): ${finalAiScore}%`);
    }

    const aiScore = finalAiScore;
    const humanScore = 100 - aiScore;

    let statusEmoji = '🟢';
    let statusLabel = 'Texto Original Humano';
    let summaryNote = 'No se detectan patrones evidentes de IA. Lenguaje natural y variado.';

    if (aiScore >= 75) {
        statusEmoji = '🔴';
        statusLabel = 'Alta Probabilidad de IA (ChatGPT / Claude / Gemini)';
        summaryNote = 'Se detectan múltiples frases típicas y sintaxis característica de modelos de lenguaje.';
    } else if (aiScore >= 35) {
        statusEmoji = '🟡';
        statusLabel = 'Sospecha Media de IA / Paráfrasis';
        summaryNote = 'El texto combina giros comunes de IA con modificaciones. Se recomienda profundizar en entrevista.';
    }

    const quality = evaluateFormQuality(cleanText, words);

    return {
        aiScore,
        humanScore,
        statusEmoji,
        statusLabel,
        wordCount,
        sentenceCount: sentences.length,
        detectedPatterns: hardDetectedPatterns.slice(0, 4),
        summaryNote,
        quality
    };
}

// Función para obtener en tiempo real el título de la transmisión en directo (Twitch / Kick / YouTube / Discord Rich Presence)
async function fetchLiveStreamTitle(streamUrl, member = null, fallbackTitle = '') {
    // 1. Prioridad: Presencia en vivo de Discord (si el streamer tiene Discord vinculado con Twitch/Kick o modo Streaming de OBS)
    if (member && member.presence && Array.isArray(member.presence.activities)) {
        const streamActivity = member.presence.activities.find(act =>
            act.type === ActivityType.Streaming ||
            (act.url && (act.url.includes('twitch.tv') || act.url.includes('kick.com') || act.url.includes('youtube.com')))
        );
        if (streamActivity) {
            const title = streamActivity.details || streamActivity.state || streamActivity.name;
            if (title && title.trim().length > 0 && !['twitch', 'streaming', 'directo'].includes(title.toLowerCase())) {
                console.log(`📡 [STREAM TITLE DISCORD] Obtenido desde presencia de Discord: "${title}"`);
                return title.trim();
            }
        }
    }

    if (!streamUrl) {
        return fallbackTitle || '🔥 Roleplay en directo en SPAIN RP 🇪🇸';
    }

    // 2. Consulta en vivo para Twitch
    if (streamUrl.includes('twitch.tv')) {
        try {
            const match = streamUrl.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
            if (match && match[1]) {
                const twitchUser = match[1];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);

                const res = await fetch(`https://decapi.me/twitch/title/${twitchUser}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const titleText = (await res.text()).trim();
                    if (titleText && !titleText.toLowerCase().includes('user not found') && !titleText.toLowerCase().includes('channel not found') && !titleText.toLowerCase().includes('error')) {
                        console.log(`📡 [STREAM TITLE TWITCH] Obtenido para ${twitchUser}: "${titleText}"`);
                        return titleText;
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ Error al consultar título de Twitch en vivo:', err.message);
        }
    }

    // 3. Consulta en vivo para Kick
    if (streamUrl.includes('kick.com')) {
        try {
            const match = streamUrl.match(/kick\.com\/([a-zA-Z0-9_-]+)/i);
            if (match && match[1]) {
                const kickUser = match[1];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);

                const res = await fetch(`https://kick.com/api/v2/channels/${kickUser}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const sessionTitle = data?.livestream?.session_title || data?.previous_livestreams?.[0]?.session_title;
                    if (sessionTitle && sessionTitle.trim().length > 0) {
                        console.log(`📡 [STREAM TITLE KICK] Obtenido para ${kickUser}: "${sessionTitle}"`);
                        return sessionTitle.trim();
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ Error al consultar título de Kick en vivo:', err.message);
        }
    }

    // 4. Consulta para YouTube (oEmbed)
    if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);

            const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(streamUrl)}&format=json`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                if (data && data.title) {
                    console.log(`📡 [STREAM TITLE YOUTUBE] Obtenido: "${data.title}"`);
                    return data.title.trim();
                }
            }
        } catch (err) {
            console.error('⚠️ Error al consultar título de YouTube:', err.message);
        }
    }

    // 5. Título de reserva si está offline o no se pudo consultar
    return fallbackTitle || '🔥 Roleplay en directo en SPAIN RP 🇪🇸';
}

// Helper para verificar si un miembro tiene permisos de Staff (independientemente de cuántos otros roles tenga)
async function isStaffMember(member, guild = null, userId = null) {
    if (!member && guild && userId) {
        member = await guild.members.fetch(userId).catch(() => null);
    }
    if (!member) return false;

    // El Creador siempre tiene permisos absolutos
    if (member.id === OWNER_ID || userId === OWNER_ID) {
        return true;
    }

    // Si tiene permisos de administrador en el servidor
    if (member.permissions && member.permissions.has('Administrator')) {
        return true;
    }

    const staffRoleId = botConfig.ROLE_STAFF_ID;

    // Comprobar si el ID del rol de Staff está presente en su lista de roles
    if (member.roles && member.roles.cache) {
        if (member.roles.cache.has(staffRoleId)) return true;
    }

    // Comprobación de respaldo en array raw de roles
    if (member.roles && Array.isArray(member.roles) && member.roles.includes(staffRoleId)) {
        return true;
    }
    if (member._roles && Array.isArray(member._roles) && member._roles.includes(staffRoleId)) {
        return true;
    }

    return false;
}

// Set para evitar procesar dos veces el mismo mensaje
const processedMessages = new Set();

client.once('ready', async () => {
    console.log(`✅ Bot conectado exitosamente como: ${client.user.tag}`);
    console.log(`👑 Creador / Owner ID: ${OWNER_ID}`);
    console.log(`📌 Canal de Solicitudes (Whitelist): ${botConfig.CHANNEL_SOLICITUDES_ID || 'Todos los canales'}`);
    console.log(`📌 Canal de Resultados (Aprobados): ${botConfig.CHANNEL_APROBADOS_ID || 'No configurado'}`);
    console.log(`📌 Canal de Estado FiveM: ${botConfig.CHANNEL_STATUS_ID || 'No configurado'}`);
    console.log(`📌 Canal Botón Stream: ${botConfig.CHANNEL_STREAM_PANEL_ID}`);
    console.log(`📌 Canal Avisos Stream: ${botConfig.CHANNEL_STREAMERS_ID}`);
    console.log(`🎮 Servidor FiveM IP: ${botConfig.FIVEM_SERVER_IP} (Código: ${botConfig.FIVEM_CFX_CODE})`);

    // Comprobación de acceso a los canales en el servidor
    try {
        const guilds = client.guilds.cache;
        guilds.forEach(guild => {
            console.log(`🏰 Servidor conectado: ${guild.name} (${guild.id})`);
            const chSolicitudes = guild.channels.cache.get(botConfig.CHANNEL_SOLICITUDES_ID);
            const chAprobados = guild.channels.cache.get(botConfig.CHANNEL_APROBADOS_ID);
            const chStatus = guild.channels.cache.get(botConfig.CHANNEL_STATUS_ID);
            const chStreamPanel = guild.channels.cache.get(botConfig.CHANNEL_STREAM_PANEL_ID);
            const chStreamAviso = guild.channels.cache.get(botConfig.CHANNEL_STREAMERS_ID);

            console.log(`   -> Canal Solicitudes: ${chSolicitudes ? `✅ #${chSolicitudes.name}` : '❌ NO ENCONTRADO O SIN PERMISO'}`);
            console.log(`   -> Canal Aprobados: ${chAprobados ? `✅ #${chAprobados.name}` : '❌ NO ENCONTRADO O SIN PERMISO'}`);
            if (botConfig.CHANNEL_STATUS_ID) console.log(`   -> Canal Estado: ${chStatus ? `✅ #${chStatus.name}` : '❌ NO ENCONTRADO'}`);
            console.log(`   -> Canal Botón Stream: ${chStreamPanel ? `✅ #${chStreamPanel.name}` : '❌ NO ENCONTRADO'}`);
            console.log(`   -> Canal Avisos Stream: ${chStreamAviso ? `✅ #${chStreamAviso.name}` : '❌ NO ENCONTRADO'}`);
        });
    } catch (e) {
        console.error('Error al listar canales del servidor:', e);
    }

    // Función para actualizar la presencia del bot exclusivamente con los jugadores en tiempo real
    const updateBotPresence = async () => {
        const state = await fetchFiveMServerStatus();
        if (state.online) {
            client.user.setPresence({
                activities: [{
                    name: `${state.players}/${state.maxPlayers} Jugadores`,
                    type: ActivityType.Watching
                }],
                status: 'online'
            });
        } else {
            client.user.setPresence({
                activities: [{
                    name: 'Servidor en Mantenimiento',
                    type: ActivityType.Watching
                }],
                status: 'dnd'
            });
        }
    };

    // 1. Actualización inicial de presencia
    await updateBotPresence();

    // 2. Comprobar y actualizar jugadores cada 15 segundos
    setInterval(updateBotPresence, 15000);

    // 3. Actualizar el panel del canal cada 60 segundos
    if (botConfig.CHANNEL_STATUS_ID) {
        await updateChannelStatusPanel();
        setInterval(updateChannelStatusPanel, 60000);
    }

    // 4. Registrar Slash Commands (/admin, /config, etc.) para mensajes efímeros ("Solo tú puedes verlo")
    try {
        if (client.application) {
            await client.application.commands.set([
                {
                    name: 'admin',
                    description: '👑 Panel de configuración exclusivo del Creador (Solo tú puedes verlo)'
                },
                {
                    name: 'config',
                    description: '👑 Panel de configuración exclusivo del Creador (Solo tú puedes verlo)'
                },
                {
                    name: 'notificarstream',
                    description: '📢 Publica el panel con el botón de Notificar Directo'
                },
                {
                    name: 'estado',
                    description: '🌐 Muestra el estado en tiempo real del servidor FiveM'
                }
            ]);
            console.log('✅ Slash Commands (/admin, /config, etc.) registrados exitosamente.');
        }
    } catch (e) {
        console.error('Error al registrar Slash Commands:', e.message);
    }

    // 5. Auto-Calibración en background usando el historial del canal de Whitelist
    setTimeout(autoBootstrapChannelHistory, 3000);
});

// Función de Auto-Calibración que lee el historial real de solicitudes en el canal
async function autoBootstrapChannelHistory() {
    try {
        const channelId = botConfig.CHANNEL_SOLICITUDES_ID || '1517530849661288455';
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        console.log(`🧠 [AUTO-CALIBRACIÓN] Escaneando historial de WLs en #${channel.name} (${channelId})...`);
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages || messages.size === 0) return;

        let learned = 0;
        for (const [, msg] of messages) {
            let fullMsgText = `${msg.content || ''}\n`;
            if (msg.embeds && msg.embeds.length > 0) {
                for (const embed of msg.embeds) {
                    fullMsgText += `${embed.title || ''}\n${embed.description || ''}\n`;
                    if (embed.fields) {
                        for (const f of embed.fields) fullMsgText += `${f.name}: ${f.value}\n`;
                    }
                }
            }

            const isAprob = /Decisi[oó]n[:\s*]+Aprobada|Whitelist Solicitud Aprobada|¡?WHITELIST APROBADA!?/i.test(fullMsgText);
            const isDeneg = /Decisi[oó]n[:\s*]+Denegada|Whitelist Solicitud Denegada|¡?WHITELIST DENEGADA!?/i.test(fullMsgText);

            if (isAprob || isDeneg) {
                const decision = isAprob ? 'APROBADA' : 'DENEGADA';
                const userMatch = fullMsgText.match(/<@!?(\d{17,20})>/) || fullMsgText.match(/Solicitante[:\s*]+@?([^\n\r]+)/i);
                const userKey = userMatch ? (userMatch[1] ? `<@${userMatch[1]}>` : `@${userMatch[1]}`) : `Hist_${msg.id}`;

                registerFeedbackOutcome(userKey, decision, fullMsgText, false);
                learned++;
            }
        }

        const data = getAiFeedbackData();
        saveAiFeedbackData(data);
        console.log(`✅ [AUTO-CALIBRACIÓN COMPLETADA] Formularios analizados: ${learned} | Clichés IA únicos: ${Object.keys(data.learnedClichés || {}).length} | Patrones humanos: ${Object.keys(data.learnedHumanPatterns || {}).length}`);
    } catch (e) {
        console.error('⚠️ Error en autoBootstrapChannelHistory:', e.message);
    }
}

// ==========================================
// 3. FUNCIONES PARA ENVIAR NOTIFICACIONES
// ==========================================

async function sendApprovedNotification({ userMention, staffName = 'Equipo de Staff' }) {
    const targetChannelId = botConfig.CHANNEL_APROBADOS_ID || '1550880724930797610';
    console.log(`📤 [INTENTO DE ENVÍO APROBADO] Buscando canal de resultados con ID: ${targetChannelId}`);

    const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
        console.error(`❌ [ERROR FETCH CANAL] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
        return null;
    });

    if (!targetChannel) {
        console.error(`❌ [ERROR CANAL] El bot no encuentra el canal ${targetChannelId}. Verifica permisos.`);
        throw new Error(`No se pudo acceder al canal con ID ${targetChannelId}`);
    }

    const imgPngPath = path.join(__dirname, 'assets', 'aprobado.png');
    const imgGifPath = path.join(__dirname, 'assets', 'aprobado.gif');
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const files = [];

    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }

    const canalNormativas = `<#${botConfig.CHANNEL_NORMATIVAS_ID || '1517530848658849996'}>`;
    const canalTickets = `<#${botConfig.CHANNEL_TICKETS_ID || '1517530849334136844'}>`;
    const canalGeneral = `<#${botConfig.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    const embedAprobado = new EmbedBuilder()
        .setColor(0x2ECC71) // Verde esmeralda brillante
        .setAuthor({
            name: 'SISTEMA DE WHITELIST | SPAIN RP \uD83C\uDDEA\uD83C\uDDF8',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail('attachment://logo.png')
        .setTitle('🎉 ¡WHITELIST APROBADA!')
        .setDescription(
            `\u200B\n` +
            `✨ ¡Enhorabuena **${userMention}**! Tu solicitud de Whitelist ha sido aprobada con éxito por el equipo de Staff.\n\n` +
            `🏙️ Ya puedes acceder al servidor y formar parte de la comunidad de **SPAIN RP** \uD83C\uDDEA\uD83C\uDDF8.\n\n` +
            `📝 **| Puedes consultar nuestras,**\n` +
            `> ${canalNormativas} ❗\n\n` +
            `📁 **| Si tienes dudas abre un,**\n` +
            `> ${canalTickets} ❗\n\n` +
            `🌍 **| 𝗗𝗶𝘀𝗳𝗿𝘂𝘁𝗮 𝘆 𝗱𝗶𝘃𝗶𝗲𝗿𝘁𝗲𝘁𝗲,**\n` +
            `> ${canalGeneral} ❗\n\n` +
            `\uD83C\uDDEA\uD83C\uDDF8 **| ¡Disfruta de SPAIN RP! |** \uD83C\uDDEA\uD83C\uDDF8\n\n` +
            `👤 **Solicitante:** ${userMention}\n` +
            `🛡️ **Decidido Por:** ${staffName}`
        )
        .setFooter({
            text: 'SPAIN RP • ¡Bienvenido a la ciudad!',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(imgPngPath)) {
        const attachment = new AttachmentBuilder(imgPngPath, { name: 'aprobado.png' });
        embedAprobado.setImage('attachment://aprobado.png');
        files.push(attachment);
    } else if (fs.existsSync(imgGifPath)) {
        const attachment = new AttachmentBuilder(imgGifPath, { name: 'aprobado.gif' });
        embedAprobado.setImage('attachment://aprobado.gif');
        files.push(attachment);
    }

    const sentMsg = await targetChannel.send({
        content: `# 🎉 ¡Enhorabuena ${userMention}!\n# ¡Tu Whitelist ha sido aprobada!`,
        embeds: [embedAprobado],
        files: files
    });

    console.log(`[WL APROBADA] Notificación enviada para ${userMention}`);
    return { success: true, channelId: targetChannelId, messageId: sentMsg.id };
}

async function sendDeniedNotification({ userMention, staffName = 'Equipo de Staff' }) {
    const targetChannelId = (botConfig.CHANNEL_DENEGADOS_ID || botConfig.CHANNEL_APROBADOS_ID) || '1550880724930797610';
    console.log(`📤 [INTENTO DE ENVÍO DENEGADO] Buscando canal de resultados con ID: ${targetChannelId}`);

    const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
        console.error(`❌ [ERROR FETCH CANAL] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
        return null;
    });

    if (!targetChannel) {
        console.error(`❌ [ERROR CANAL] El bot no encuentra el canal ${targetChannelId}. Verifica permisos.`);
        throw new Error(`No se pudo acceder al canal con ID ${targetChannelId}`);
    }

    const imgPngPath = path.join(__dirname, 'assets', 'denegado.png');
    const imgGifPath = path.join(__dirname, 'assets', 'denegado.gif');
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const files = [];

    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }

    const canalNormativas = `<#${botConfig.CHANNEL_NORMATIVAS_ID || '1517530848658849996'}>`;
    const canalTickets = `<#${botConfig.CHANNEL_TICKETS_ID || '1518087100275097671'}>`;

    const embedDenegado = new EmbedBuilder()
        .setColor(0xE74C3C) // Rojo carmesí
        .setAuthor({
            name: 'SISTEMA DE WHITELIST | SPAIN RP \uD83C\uDDEA\uD83C\uDDF8',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail('attachment://logo.png')
        .setTitle('❌ ¡WHITELIST DENEGADA!')
        .setDescription(
            `\u200B\n` +
            `⚠️ Hola **${userMention}**, lamentamos informarte que tu solicitud de Whitelist ha sido denegada por el equipo de Staff de **SPAIN RP** \uD83C\uDDEA\uD83C\uDDF8.\n\n` +
            `📖 Te recomendamos repasar los conceptos de rol y la normativa antes de volver a postularte.\n\n` +
            `📝 **| Puedes repasar la normativa en,**\n` +
            `> ${canalNormativas} ❗\n\n` +
            `📁 **| Si tienes alguna duda consulta en,**\n` +
            `> ${canalTickets} ❗\n\n` +
            `\uD83C\uDDEA\uD83C\uDDF8 **| SPAIN RP • Sistema de Whitelist |** \uD83C\uDDEA\uD83C\uDDF8\n\n` +
            `👤 **Solicitante:** ${userMention}\n` +
            `🛡️ **Decidido Por:** ${staffName}`
        )
        .setFooter({
            text: 'SPAIN RP • Sistema de Whitelist',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(imgPngPath)) {
        const attachment = new AttachmentBuilder(imgPngPath, { name: 'denegado.png' });
        embedDenegado.setImage('attachment://denegado.png');
        files.push(attachment);
    } else if (fs.existsSync(imgGifPath)) {
        const attachment = new AttachmentBuilder(imgGifPath, { name: 'denegado.gif' });
        embedDenegado.setImage('attachment://denegado.gif');
        files.push(attachment);
    }

    const sentMsg = await targetChannel.send({
        content: `# ⚠️ ¡Atención ${userMention}!\n# Tu solicitud ha sido denegada.`,
        embeds: [embedDenegado],
        files: files
    });

    console.log(`[WL DENEGADA] Notificación enviada para ${userMention}`);
    return { success: true, channelId: targetChannelId, messageId: sentMsg.id };
}

async function sendStreamerNotification({ userMention, streamUrl, streamTitle, platform = 'Twitch', avatarUrl = null }) {
    const targetChannelId = botConfig.CHANNEL_STREAMERS_ID;
    if (!targetChannelId) return;

    const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
        console.error(`❌ [ERROR FETCH CANAL STREAMERS] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
        return null;
    });

    if (!targetChannel) {
        console.error(`❌ [ERROR CANAL] No se encontró el canal de streamers (${targetChannelId}).`);
        return null;
    }

    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const imgDirectoPath = path.join(__dirname, 'assets', 'directo.png');
    const files = [];

    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }

    if (fs.existsSync(imgDirectoPath)) {
        files.push(new AttachmentBuilder(imgDirectoPath, { name: 'directo.png' }));
    }

    const cleanTitle = streamTitle && streamTitle.trim() ? streamTitle.trim() : 'Roleplay en vivo en SPAIN RP \uD83C\uDDEA\uD83C\uDDF8';
    const validStreamUrl = streamUrl.startsWith('http') ? streamUrl : `https://${streamUrl}`;

    // Canales oficiales interactivos (<#ID>)
    const canalGeneral = `<#${process.env.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    const embedStream = new EmbedBuilder()
        .setColor(0x9146FF) // Morado Twitch brillante
        .setAuthor({
            name: 'SISTEMA DE DIRECTOS | SPAIN RP \uD83C\uDDEA\uD83C\uDDF8',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(avatarUrl || (fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()))
        .setTitle('🟣 ¡CREADOR EN DIRECTO!')
        .setDescription(
            `\u200B\n` +
            `✨ ¡El creador de contenido **${userMention}** acaba de iniciar transmisión en vivo en **SPAIN RP** \uD83C\uDDEA\uD83C\uDDF8!\n\n` +
            `🎮 **Título de la Transmisión:**\n` +
            `> 💬 *"${cleanTitle}"*\n\n` +
            `📺 **Plataforma:** \`${platform}\`\n` +
            `🏙️ **Servidor:** **SPAIN RP** \uD83C\uDDEA\uD83C\uDDF8\n\n` +
            `🔗 **| Entra al directo a dejar tu apoyo y follow:**\n` +
            `> ${validStreamUrl} ❗\n\n` +
            `🌍 **| Comenta el directo en la comunidad:**\n` +
            `> ${canalGeneral} ❗\n\n` +
            `\uD83C\uDDEA\uD83C\uDDF8 **| ¡Disfruta del mejor Roleplay en SPAIN RP! |** \uD83C\uDDEA\uD83C\uDDF8\n\n` +
            `👤 **Streamer:** ${userMention}`
        )
        .setFooter({
            text: 'SPAIN RP • Creadores de Contenido Oficiales',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(imgDirectoPath)) {
        embedStream.setImage('attachment://directo.png');
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('🟣 Ver Directo en Vivo')
            .setStyle(ButtonStyle.Link)
            .setURL(validStreamUrl),
        new ButtonBuilder()
            .setLabel('🚀 Conectar a SPAIN RP')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://cfx.re/join/${botConfig.FIVEM_CFX_CODE}`)
    );

    const sentMsg = await targetChannel.send({
        content: `# 🟣 ¡${userMention} ESTÁ EN DIRECTO!\n# ¡Entra a apoyar el stream en SPAIN RP!`,
        embeds: [embedStream],
        components: [row],
        files: files
    });

    console.log(`[DIRECTO NOTIFICADO] Stream publicado para ${userMention} en canal ${targetChannelId}`);
    return { success: true, channelId: targetChannelId, messageId: sentMsg.id };
}

// ==========================================
// 4. PROCESAMIENTO DE SOLICITUDES DEL BOT KING
// ==========================================
async function handleWhitelistMessage(message, source = 'DESCONOCIDO') {
    if (!message) return;

    // Si el mensaje es parcial (sucede con messageUpdate de Discord), obtener el mensaje completo con sus embeds
    if (message.partial) {
        try {
            message = await message.fetch();
        } catch (error) {
            console.error('[DEBUG FETCH ERROR]', error);
            return;
        }
    }

    // Si el mensaje viene del propio bot, ignorar
    if (message.author && message.author.id === client.user.id) return;

    console.log(`\n==============================================`);
    console.log(`📡 [DEBUG EVENTO] Origen: ${source}`);
    console.log(`📌 Canal ID: ${message.channel ? message.channel.id : 'N/A'} (#${message.channel ? message.channel.name : 'N/A'})`);
    console.log(`👤 Autor: ${message.author ? `${message.author.tag} (${message.author.id}) [Bot: ${message.author.bot}]` : 'N/A'}`);
    console.log(`💬 Contenido de texto: "${message.content || ''}"`);
    console.log(`📦 Cantidad de Embeds: ${message.embeds ? message.embeds.length : 0}`);

    if (message.embeds && message.embeds.length > 0) {
        message.embeds.forEach((emb, i) => {
            console.log(`   [Embed #${i + 1}] Título: "${emb.title || ''}"`);
            console.log(`   [Embed #${i + 1}] Descripción: "${emb.description || ''}"`);
            if (emb.fields && emb.fields.length > 0) {
                emb.fields.forEach(f => console.log(`      -> Campo [${f.name}]: "${f.value}"`));
            }
        });
    }

    // Obtener todo el contenido (texto + todos los embeds y sus campos)
    let fullText = `${message.content || ''}\n`;

    if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            fullText += `${embed.title || ''}\n${embed.description || ''}\n`;
            if (embed.fields && embed.fields.length > 0) {
                for (const field of embed.fields) {
                    fullText += `${field.name}: ${field.value}\n`;
                }
            }
            if (embed.footer && embed.footer.text) {
                fullText += `${embed.footer.text}\n`;
            }
        }
    }

    if (!fullText.trim()) {
        console.log(`❌ [DEBUG] Mensaje vacío, ignorando.`);
        console.log(`==============================================\n`);
        return;
    }

    // 1. Detectar si es una NUEVA SOLICITUD PENDIENTE (para auditarla con IA)
    const isPendiente = /Nueva Solicitud de (?:📋 )?Whitelist/i.test(fullText) ||
        /Nueva Solicitud/i.test(fullText) ||
        /Whitelist Solicitud Pendiente/i.test(fullText) ||
        /Solicitud Pendiente/i.test(fullText) ||
        /ha enviado una solicitud para (?:📋 )?Whitelist/i.test(fullText) ||
        /Estado[:\s*]+Pendiente/i.test(fullText) ||
        /Decisi[oó]n[:\s*]+Pendiente/i.test(fullText);

    // Si es una solicitud pendiente nueva, ejecutar la auditoría de IA
    if (isPendiente) {
        const cacheKeyPendiente = `${message.id}_PENDIENTE_AUDIT`;
        if (!processedMessages.has(cacheKeyPendiente)) {
            processedMessages.add(cacheKeyPendiente);

            // Extraer solicitante
            let applicantMention = 'Postulante';
            const userMatch = fullText.match(/<@!?(\d{17,20})>\s+ha enviado/i) ||
                fullText.match(/Solicitante[:\s*]+<@!?(\d{17,20})>/i) ||
                fullText.match(/<@!?(\d{17,20})>/);

            if (userMatch) {
                applicantMention = `<@${userMatch[1]}>`;
            } else if (message.mentions && message.mentions.users && message.mentions.users.size > 0) {
                const firstUser = message.mentions.users.find(u => !u.bot && u.id !== client.user.id);
                if (firstUser) applicantMention = `<@${firstUser.id}>`;
            }

            // Extraer texto a auditar (Historia del Personaje y respuestas de rol)
            const sections = [];
            const histMatch = fullText.match(/HISTORIA[^\n\r:]*[:\n\r]+([\s\S]+?)(?=\n\s*(?:🪪|DATOS\s+OOC|🎭|❤️|💀|────────────────|Solicitante|Decisión|hoy\s+a\s+las|$))/i);
            if (histMatch && histMatch[1].trim().length > 10) {
                sections.push(histMatch[1].trim());
            }
            const rolMatch = fullText.match(/(?:¿?QUÉ\s+ES\s+EL\s+ROL\??|DEFINICIÓN\s+DE\s+ROL)[^\n\r:]*[:\n\r]+([\s\S]+?)(?=\n\s*(?:❤️|VALORACIÓN|💀|📖|HISTORIA|🪪|DATOS|────────────────|$))/i);
            if (rolMatch && rolMatch[1].trim().length > 10) {
                sections.push(rolMatch[1].trim());
            }
            const vidaMatch = fullText.match(/VALORACIÓN\s+DE\s+VIDA[^\n\r:]*[:\n\r]+([\s\S]+?)(?=\n\s*(?:💀|VIDA\s+ÚNICA|📖|HISTORIA|🪪|DATOS|────────────────|$))/i);
            if (vidaMatch && vidaMatch[1].trim().length > 10) {
                sections.push(vidaMatch[1].trim());
            }

            let textToAudit = sections.length > 0 ? sections.join('\n\n') : fullText;

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            let iconURL = client.user.displayAvatarURL();
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                iconURL = 'attachment://logo.png';
            }

            // 1. Enviar mensaje instantáneo de "Analizando Whitelist..."
            const loadingEmbed = new EmbedBuilder()
                .setColor(0x3498DB) // Azul informativo
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(
                    `👤 **Solicitante:** ${applicantMention}\n` +
                    `⚙️ **Estado:** \`🔄 Analizando respuestas y narrativa con IA...\`\n` +
                    `⏳ *Consultando modelos de lenguaje y comprobando normativas...*`
                );

            const sentAuditMsg = await message.channel.send({
                embeds: [loadingEmbed],
                files
            }).catch(e => {
                console.error('Error al enviar tarjeta de análisis preliminar:', e);
                return null;
            });

            console.log(`🤖 [AUDITORÍA EN VIVO] Analizando formulario entrante de ${applicantMention}...`);
            const analysis = await analyzeTextForAI(textToAudit);
            const bar = buildProgressBar(analysis.aiScore, 10);

            let embedColor = 0x2ECC71; // Verde
            if (analysis.aiScore >= 75) embedColor = 0xE74C3C; // Rojo
            else if (analysis.aiScore >= 40) embedColor = 0xF1C40F; // Amarillo

            let descText = `👤 **Solicitante:** ${applicantMention}\n` +
                `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.quality && analysis.quality.qualityNotes && analysis.quality.qualityNotes.length > 0) {
                descText += `\n📝 **Revisión Narrativa:** ⚠️ \`${analysis.quality.qualityNotes.join(' • ')}\``;
            }

            const finalAuditEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(descText);

            // 2. Editar el mensaje original con el resultado final
            if (sentAuditMsg) {
                await sentAuditMsg.edit({
                    embeds: [finalAuditEmbed]
                }).catch(e => console.error('Error al editar tarjeta de auditoría final:', e));
            }

            // Guardar en el mapa de pendientes para asociar retroalimentación y borrar cuando el Staff decida
            const auditInfo = {
                text: textToAudit,
                aiScore: analysis.aiScore,
                auditMessageId: sentAuditMsg ? sentAuditMsg.id : null,
                channelId: message.channel.id,
                timestamp: Date.now()
            };

            pendingAuditsMap.set(applicantMention, auditInfo);
            pendingAuditsMap.set(message.id, auditInfo);
        }
    }

    // 2. Detectar si la decisión es Aprobada o Denegada (Resultados)
    const isAprobada = /Decisi[oó]n[:\s*]+Aprobada/i.test(fullText) ||
        /Whitelist Solicitud Aprobada/i.test(fullText) ||
        /¡?WHITELIST APROBADA!?/i.test(fullText) ||
        /Solicitud Aprobada/i.test(fullText) ||
        /WL ha sido aprobada/i.test(fullText) ||
        /Tu Whitelist ha sido aprobada/i.test(fullText) ||
        /ha sido Aprobada/i.test(fullText) ||
        /Aprobada/i.test(fullText) ||
        /Estado[:\s*]+Aprobad[ao]/i.test(fullText);

    const isDenegada = /Decisi[oó]n[:\s*]+Denegada/i.test(fullText) ||
        /Whitelist Solicitud Denegada/i.test(fullText) ||
        /¡?WHITELIST DENEGADA!?/i.test(fullText) ||
        /Solicitud Denegada/i.test(fullText) ||
        /WL ha sido denegada/i.test(fullText) ||
        /Tu Whitelist ha sido denegada/i.test(fullText) ||
        /ha sido Denegada/i.test(fullText) ||
        /Denegada/i.test(fullText) ||
        /Estado[:\s*]+Denegad[ao]/i.test(fullText);

    if (!isAprobada && !isDenegada) {
        return;
    }

    console.log(`✅ [DEBUG] Decisión identificada: ${isAprobada ? 'APROBADA' : 'DENEGADA'}`);

    const decisionType = isAprobada ? 'APROBADA' : 'DENEGADA';
    const cacheKey = `${message.id}_${decisionType}`;

    if (processedMessages.has(cacheKey)) {
        return; // Ya se notificó anteriormente
    }

    // 2. Extraer el solicitante (El usuario de Discord)
    let userMention = null;

    // A) Patrón exacto de King: "La solicitud de Whitelist de ... ha sido Aprobada/Denegada"
    const kingResponseMatch = fullText.match(/La solicitud de (?:📋 )?Whitelist de ([^\n\r]+?) ha sido (?:Aprobada|Denegada)/i);
    if (kingResponseMatch) {
        const rawUser = kingResponseMatch[1].trim();
        // Extraer mención si hay <@123...> o @nombre
        const idMatch = rawUser.match(/<@!?(\d{17,20})>/);
        if (idMatch) {
            userMention = `<@${idMatch[1]}>`;
        } else {
            const cleanName = rawUser.replace(/^[^\w@]+/, '').trim();
            userMention = cleanName.startsWith('@') ? cleanName : `@${cleanName}`;
        }
    }

    // B) Si el mensaje tiene menciones directas
    if (!userMention && message.mentions && message.mentions.users && message.mentions.users.size > 0) {
        const realUser = message.mentions.users.find(u => !u.bot && u.id !== client.user.id);
        if (realUser) {
            userMention = `<@${realUser.id}>`;
        }
    }

    // C) Buscar si en el texto hay una mención con ID de Discord <@1234567890...>
    if (!userMention) {
        const mentionMatch = fullText.match(/<@!?(\d{17,20})>/);
        if (mentionMatch) {
            userMention = `<@${mentionMatch[1]}>`;
        }
    }

    // D) Si viene en formato Solicitante: ...
    if (!userMention) {
        const solicitanteMatch = fullText.match(/Solicitante[:\s*]+@?([^\n\r]+)/i) ||
            fullText.match(/@([^\s\n]+)\s+ha enviado/i);
        if (solicitanteMatch) {
            userMention = `@${solicitanteMatch[1].trim()}`;
        } else {
            userMention = 'Postulante';
        }
    }

    // 3. Extraer el Staff que tomó la decisión (Decidido Por o Autor del mensaje si es Staff)
    let staffName = 'Equipo de Staff';
    const staffMatch = fullText.match(/Decidido Por[:\s*]+([^\n\r]+)/i);
    if (staffMatch) {
        staffName = staffMatch[1].trim();
    } else if (message.author && !message.author.bot) {
        staffName = `<@${message.author.id}>`;
    }

    // Retroalimentar el motor de IA con la decisión real del Staff
    registerFeedbackOutcome(userMention, decisionType, fullText);

    // 4. ELIMINAR AUTOMÁTICAMENTE LA TARJETA DE AUDITORÍA DE IA AL RESOLVERSE LA WL
    try {
        const pendingData = pendingAuditsMap.get(userMention) || pendingAuditsMap.get(message.id);
        if (pendingData && pendingData.auditMessageId) {
            const auditChan = await client.channels.fetch(pendingData.channelId || message.channel.id).catch(() => null);
            if (auditChan) {
                const msgToDelete = await auditChan.messages.fetch(pendingData.auditMessageId).catch(() => null);
                if (msgToDelete) {
                    await msgToDelete.delete().catch(() => {});
                    console.log(`🗑️ [AUDITORÍA LIMPIA] Tarjeta de auditoría eliminada tras la decisión (${decisionType}) de ${userMention}.`);
                }
            }
            pendingAuditsMap.delete(userMention);
            pendingAuditsMap.delete(message.id);
        } else {
            // Si no estaba en el mapa directo, buscar en los últimos mensajes del canal el embed de auditoría de este usuario
            const recentMsgs = await message.channel.messages.fetch({ limit: 10 }).catch(() => null);
            if (recentMsgs) {
                for (const [, rMsg] of recentMsgs) {
                    if (rMsg.author.id === client.user.id && rMsg.embeds.length > 0) {
                        const embedAuthor = rMsg.embeds[0].author?.name || '';
                        const embedDesc = rMsg.embeds[0].description || '';
                        if (embedAuthor.includes('AUDITORÍA') && (embedDesc.includes(userMention) || embedDesc.includes(message.id))) {
                            await rMsg.delete().catch(() => {});
                            console.log(`🗑️ [AUDITORÍA LIMPIA] Tarjeta de auditoría previa encontrada y eliminada.`);
                            break;
                        }
                    }
                }
            }
        }
    } catch (cleanErr) {
        console.error('Error al limpiar mensaje de auditoría:', cleanErr);
    }

    // 5. Enviar notificación usando la función reutilizable
    try {
        if (isAprobada) {
            await sendApprovedNotification({ userMention, staffName });
            processedMessages.add(cacheKey);
        } else if (isDenegada) {
            await sendDeniedNotification({ userMention, staffName });
            processedMessages.add(cacheKey);
        }
    } catch (error) {
        console.error('Error al enviar la notificación al canal de resultados:', error);
    }
}

// ==========================================
// 5. EVENTOS DE MENSAJES Y COMANDOS MANUALES
// ==========================================

client.on('messageCreate', async (message) => {
    console.log(`📥 [MSG RECIBIDO] Canal: #${message.channel ? message.channel.name : 'N/A'} (${message.channel ? message.channel.id : 'N/A'}) | Autor: ${message.author ? message.author.tag : 'N/A'}`);

    // Si el mensaje es enviado por un usuario real (Staff / Admin)
    if (!message.author.bot) {
        const content = message.content.trim();
        const args = content.split(/\s+/);
        const command = args[0].toLowerCase();

        const botCommands = [
            '!aprobar', '!aprobado', '!wl-aprobar', '!wlaprobar',
            '!denegar', '!denegado', '!wl-denegar', '!wldenegar',
            '!borrar', '!delete', '!clear', '!purge',
            '!estado', '!status', '!servidor',
            '!fijar-estado', '!panel-estado',
            '!stream', '!directo', '!streamer',
            '!addstreamer', '!setstreamer',
            '!panel-stream', '!panel-directos',
            '!wl-ayuda', '!wl-comandos', '!comandos-wl',
            '!test-ia', '!analizar-ia', '!check-ia', '!auditoria-ia',
            '!simular', '!simular-pendiente',
            '!scan-historial', '!escanear-historial', '!ia-stats', '!reset-ia'
        ];

        if (botCommands.includes(command)) {
            // Verificar si el usuario tiene el rol de Staff o permisos de Administrador
            const hasStaffPermission = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaffPermission) {
                console.log(`⛔ [ACCESO DENEGADO] ${message.author.tag} (${message.author.id}) intentó ejecutar '${command}' sin tener el rol de Staff (${ROLE_STAFF_ID}).`);
                return; // Ignorar el comando de forma silenciosa para evitar spam de usuarios sin permisos
            }
        }

        // ----------------------------------------------------
        // COMANDO MANUAL: !aprobar @usuario / !aprobado @usuario
        // ----------------------------------------------------
        if (['!aprobar', '!aprobado', '!wl-aprobar', '!wlaprobar'].includes(command)) {
            let targetMention = null;

            // 1. Buscar mención directa
            const mentionedUser = message.mentions.users.find(u => u.id !== client.user.id);
            if (mentionedUser) {
                targetMention = `<@${mentionedUser.id}>`;
            } else if (args[1]) {
                // 2. Comprobar si se pasó una ID o texto
                const idMatch = args[1].match(/^<@!?(\d{17,20})>$/) || args[1].match(/^(\d{17,20})$/);
                if (idMatch) {
                    targetMention = `<@${idMatch[1]}>`;
                } else {
                    targetMention = args.slice(1).join(' ');
                }
            }

            if (!targetMention) {
                return message.reply({
                    content: `❌ **Uso incorrecto:** Debes mencionar a un usuario o poner su ID.\n📌 *Ejemplo:* \`!aprobar @usuario\` o \`!aprobar 123456789012345678\``
                });
            }

            const staffMention = `<@${message.author.id}>`;

            try {
                await sendApprovedNotification({
                    userMention: targetMention,
                    staffName: staffMention
                });

                // Solo reaccionar para confirmar internamente sin enviar mensajes extra en el chat
                await message.react('✅').catch(() => {});
                return;
            } catch (err) {
                console.error('Error al enviar la WL Aprobada manualmente:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO MANUAL: !denegar @usuario / !denegado @usuario
        // ----------------------------------------------------
        if (['!denegar', '!denegado', '!wl-denegar', '!wldenegar'].includes(command)) {
            let targetMention = null;

            // 1. Buscar mención directa
            const mentionedUser = message.mentions.users.find(u => u.id !== client.user.id);
            if (mentionedUser) {
                targetMention = `<@${mentionedUser.id}>`;
            } else if (args[1]) {
                // 2. Comprobar si se pasó una ID o texto
                const idMatch = args[1].match(/^<@!?(\d{17,20})>$/) || args[1].match(/^(\d{17,20})$/);
                if (idMatch) {
                    targetMention = `<@${idMatch[1]}>`;
                } else {
                    targetMention = args.slice(1).join(' ');
                }
            }

            if (!targetMention) {
                return;
            }

            const staffMention = `<@${message.author.id}>`;

            try {
                await sendDeniedNotification({
                    userMention: targetMention,
                    staffName: staffMention
                });

                // Solo reaccionar para confirmar internamente sin enviar mensajes extra en el chat
                await message.react('❌').catch(() => {});
                return;
            } catch (err) {
                console.error('Error al enviar la WL Denegada manualmente:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO: !borrar (Elimina mensajes o el mensaje respondido)
        // ----------------------------------------------------
        if (['!borrar', '!delete', '!clear', '!purge'].includes(command)) {
            try {
                // Caso 1: Si el usuario respondió a un mensaje específico con !borrar
                if (message.reference && message.reference.messageId) {
                    const repliedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (repliedMsg) {
                        await repliedMsg.delete().catch(() => {});
                    }
                    await message.delete().catch(() => {});
                    return;
                }

                // Caso 2: Si pasa un número como argumento, ej: !borrar 3
                const count = parseInt(args[1], 10);
                if (!isNaN(count) && count > 0) {
                    const deleteCount = Math.min(count + 1, 100);
                    await message.channel.bulkDelete(deleteCount, true).catch(async () => {
                        await message.delete().catch(() => {});
                    });
                    return;
                }

                // Caso 3: Solo escribió !borrar sin responder -> Busca y borra el último mensaje del bot en el canal
                const fetchedMessages = await message.channel.messages.fetch({ limit: 15 }).catch(() => null);
                if (fetchedMessages) {
                    const lastBotMsg = fetchedMessages.find(m => m.id !== message.id && m.author.id === client.user.id);
                    if (lastBotMsg) {
                        await lastBotMsg.delete().catch(() => {});
                    }
                }
                await message.delete().catch(() => {});
                return;
            } catch (err) {
                console.error('Error al ejecutar comando !borrar:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO: !estado / !status (Muestra el estado en tiempo real)
        // ----------------------------------------------------
        if (['!estado', '!status', '!servidor'].includes(command)) {
            try {
                const state = await fetchFiveMServerStatus();
                const embed = buildStatusEmbed(state);
                const row = buildStatusActionRow();
                const files = [];

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                if (fs.existsSync(logoPath)) {
                    files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                }

                return message.channel.send({ embeds: [embed], components: [row], files });
            } catch (err) {
                console.error('Error al enviar estado del servidor:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO: !fijar-estado / !panel-estado (Crea el panel auto-actualizable)
        // ----------------------------------------------------
        if (['!fijar-estado', '!panel-estado'].includes(command)) {
            try {
                await message.delete().catch(() => {});
                const state = await fetchFiveMServerStatus();
                const embed = buildStatusEmbed(state);
                const row = buildStatusActionRow();
                const files = [];

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                if (fs.existsSync(logoPath)) {
                    files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                }

                liveStatusMessageRef = await message.channel.send({ embeds: [embed], components: [row], files });
                console.log(`📌 [PANEL FIJADO] Panel de estado fijado en canal #${message.channel.name} (${message.channel.id})`);
                return;
            } catch (err) {
                console.error('Error al fijar panel de estado:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO: !stream / !directo (Publica anuncio de streamer)
        // ----------------------------------------------------
        if (['!stream', '!directo', '!streamer'].includes(command)) {
            try {
                // Formato: !stream @usuario <enlace> [título...]  O  !stream <enlace> [título...]
                let targetUser = message.mentions.users.first();
                let filteredArgs = args.slice(1);

                if (targetUser) {
                    filteredArgs = filteredArgs.filter(arg => !arg.includes(targetUser.id));
                } else {
                    targetUser = message.author;
                }

                let urlArg = filteredArgs.find(arg => arg.startsWith('http') || arg.includes('twitch.tv') || arg.includes('kick.com') || arg.includes('youtube.com') || arg.includes('tiktok.com'));
                
                // Si no pone URL, usamos una URL por defecto para pruebas
                if (!urlArg) {
                    urlArg = 'https://twitch.tv/spainrp';
                }

                const titleArgs = filteredArgs.filter(arg => arg !== urlArg);
                let streamTitle = titleArgs.length > 0 ? titleArgs.join(' ') : null;

                if (!streamTitle) {
                    const targetMember = message.guild?.members.cache.get(targetUser.id) || null;
                    streamTitle = await fetchLiveStreamTitle(urlArg, targetMember, '🔥 Patrullaje y Rol en Directo | SPAIN RP 🇪🇸');
                }

                let platform = 'Twitch';
                if (urlArg.includes('kick.com')) platform = 'Kick';
                else if (urlArg.includes('youtube.com') || urlArg.includes('youtu.be')) platform = 'YouTube';
                else if (urlArg.includes('tiktok.com')) platform = 'TikTok';

                const res = await sendStreamerNotification({
                    userMention: `<@${targetUser.id}>`,
                    streamUrl: urlArg,
                    streamTitle,
                    platform,
                    avatarUrl: targetUser.displayAvatarURL({ dynamic: true })
                });

                if (res && res.success) {
                    await message.delete().catch(() => {});
                }
                return;
            } catch (err) {
                console.error('Error al ejecutar comando !stream:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO: !addstreamer / !setstreamer (Registra un streamer)
        // ----------------------------------------------------
        if (['!addstreamer', '!setstreamer'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const link = args.find(arg => arg.startsWith('http') || arg.includes('twitch.tv') || arg.includes('kick.com') || arg.includes('youtube.com'));

            if (!targetUser || !link) {
                return message.reply({
                    content: `❌ **Uso incorrecto:** \`!addstreamer @usuario <enlace_del_canal> [Título por defecto]\`\n📌 *Ejemplo:* \`!addstreamer @pepe https://twitch.tv/pepe Rol de Policía en Spain RP\``
                });
            }

            const titleParts = args.filter(arg => !arg.includes(targetUser.id) && arg !== link && !arg.startsWith('!'));
            const defaultTitle = titleParts.length > 0 ? titleParts.join(' ') : 'Roleplay en directo en SPAIN RP \uD83C\uDDEA\uD83C\uDDF8';

            let platform = 'Twitch';
            if (link.includes('kick.com')) platform = 'Kick';
            else if (link.includes('youtube.com')) platform = 'YouTube';
            else if (link.includes('tiktok.com')) platform = 'TikTok';

            saveStreamer(targetUser.id, {
                url: link,
                platform,
                title: defaultTitle,
                name: targetUser.username
            });

            return message.reply({
                content: `✅ **Streamer registrado con éxito:** <@${targetUser.id}>\n📺 **Canal:** ${link}\n🎮 **Plataforma:** \`${platform}\``
            });
        }

        // ----------------------------------------------------
        // COMANDO: !notificarstream / !panel-stream / !panelstream (Publica el panel con el botón manualmente)
        // ----------------------------------------------------
        if (['!notificarstream', '!notificar-stream', '!panel-stream', '!panelstream', '!panel-directos', '!stream-panel'].includes(command)) {
            try {
                await message.delete().catch(() => {});

                // Si se menciona un canal como argumento, enviarlo allí; sino, en el canal actual
                const targetChannel = message.mentions.channels.first() || message.channel;

                const embed = buildStreamPanelEmbed();
                const row = buildStreamPanelRow();
                const files = [];

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                const imgDirectoPath = path.join(__dirname, 'assets', 'directo.png');

                if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                if (fs.existsSync(imgDirectoPath)) files.push(new AttachmentBuilder(imgDirectoPath, { name: 'directo.png' }));

                await targetChannel.send({
                    content: `# 🟣 ¡PANEL OFICIAL DE DIRECTOS!\n# ¡Avisa a toda la comunidad de tu transmisión!`,
                    embeds: [embed],
                    components: [row],
                    files
                });
                console.log(`📌 [PANEL DIRECTOS] Panel enviado manualmente en canal #${targetChannel.name}`);
                return;
            } catch (err) {
                console.error('Error al enviar panel de directos:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // COMANDO DE AYUDA: !wl-ayuda / !wl-comandos
        // ----------------------------------------------------
        if (['!wl-ayuda', '!wl-comandos', '!comandos-wl'].includes(command)) {
            return message.reply({
                content: `📖 **COMANDOS DEL BOT DE WHITELIST Y SERVIDOR:**\n\n` +
                    `✅ \`!aprobar @usuario\` o \`!aprobado @usuario\` → Envía el anuncio oficial de Whitelist Aprobada.\n` +
                    `❌ \`!denegar @usuario\` o \`!denegado @usuario\` → Envía el anuncio oficial de Whitelist Denegada.\n` +
                    `🗑️ \`!borrar\` → Borra el mensaje anterior del bot (o responde a un mensaje con \`!borrar\` para borrarlo).\n` +
                    `🟣 \`!notificarstream\` o \`!panel-stream\` → Publica el panel con el botón de **📢 🟣 Notificar Directo**.\n` +
                    `➕ \`!addstreamer @usuario <link>\` → Registra un streamer oficial para el botón de notificar.\n` +
                    `🟣 \`!stream @usuario <link> [título]\` → Publica el anuncio oficial de streamer en directo.\n` +
                    `🌐 \`!estado\` o \`!status\` → Muestra el estado en tiempo real, jugadores y ping de FiveM.\n` +
                    `📌 \`!fijar-estado\` → Publica el panel de estado en vivo que se auto-actualiza cada 60s.\n` +
                    `🤖 \`!test-ia <texto>\` → Audita cualquier texto o responde a un mensaje para medir la probabilidad de IA / ChatGPT.\n` +
                    `🧪 \`!simular @usuario [ia|humano]\` → Crea una solicitud interactiva de prueba con auditoría de IA en vivo.\n` +
                    `🧠 \`!ia-stats\` → Muestra los patrones aprendidos y estadísticas de retroalimentación de IA.\n` +
                    `🔄 \`!scan-historial [50]\` → Escanea y aprende automáticamente de los formularios históricos del canal.\n` +
                    (message.author.id === OWNER_ID ? `👑 \`!admin\` o \`!config\` → **Panel Exclusivo del Creador** (configuración de canales en vivo).\n` : '')
            });
        }

        // ====================================================
        // 👑 COMANDOS EXCLUSIVOS DEL CREADOR (OWNER_ID: 418558256840179722)
        // ====================================================

        // Función para manejar intentos no autorizados de comandos con prefijo !
        async function sendDeniedAccessMessage(msg) {
            try {
                // Borrar inmediatamente el comando del chat público para que no quede rastro
                await msg.delete().catch(() => {});

                // Enviar aviso privado (DM) para que nadie en el canal lo vea
                await msg.author.send({
                    content: '⛔ **Acceso denegado:** Los comandos de administración son exclusivos del **Creador del Bot**.'
                }).catch(() => {});
            } catch (err) {}
        }

        // Función para construir el Embed y Archivos del Panel de Control de Admin
        function buildAdminEmbed(authorId) {
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            }

            const formatChannel = (id) => id ? `<#${id}> \`(${id})\`` : '`🔴 No configurado`';
            const formatRole = (id) => id ? `<@&${id}> \`(${id})\`` : '`🔴 No configurado`';

            const adminEmbed = new EmbedBuilder()
                .setColor(0x9B59B6) // Púrpura Admin
                .setAuthor({
                    name: 'PANEL DE CONTROL DEL CREADOR | SPAIN RP 🇪🇸',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
                .setTitle('👑 Panel de Configuración de Canales y Servidor')
                .setDescription(
                    `Hola <@${authorId}>, desde aquí puedes ver y gestionar cualquier canal, rol o IP del bot.\n\n` +
                    `📋 **CANALES DE WHITELIST:**\n` +
                    `> 📥 **Solicitudes:** ${formatChannel(botConfig.CHANNEL_SOLICITUDES_ID)}\n` +
                    `> ✅ **Aprobados:** ${formatChannel(botConfig.CHANNEL_APROBADOS_ID)}\n` +
                    `> ❌ **Denegados:** ${formatChannel(botConfig.CHANNEL_DENEGADOS_ID)}\n\n` +
                    `🟣 **CANALES DE STREAMERS:**\n` +
                    `> 🔘 **Panel Botón Directo:** ${formatChannel(botConfig.CHANNEL_STREAM_PANEL_ID)}\n` +
                    `> 📢 **Canal de Avisos Stream:** ${formatChannel(botConfig.CHANNEL_STREAMERS_ID)}\n\n` +
                    `🌐 **CANALES DEL SERVIDOR & ESTADO:**\n` +
                    `> 📊 **Panel Estado FiveM:** ${formatChannel(botConfig.CHANNEL_STATUS_ID)}\n` +
                    `> 📜 **Normativas:** ${formatChannel(botConfig.CHANNEL_NORMATIVAS_ID)}\n` +
                    `> 🎫 **Tickets / Soporte:** ${formatChannel(botConfig.CHANNEL_TICKETS_ID)}\n` +
                    `> 💬 **General:** ${formatChannel(botConfig.CHANNEL_GENERAL_ID)}\n\n` +
                    `🛡️ **ROLES:**\n` +
                    `> 👑 **Staff WL:** ${formatRole(botConfig.ROLE_STAFF_ID)}\n` +
                    `> 🟣 **Streamer:** ${formatRole(botConfig.ROLE_STREAMER_ID)}\n\n` +
                    `🎮 **DATOS FIVEM:**\n` +
                    `> 📡 **IP/Puerto:** \`${botConfig.FIVEM_SERVER_IP || 'No definida'}\`\n` +
                    `> 🔗 **CFX Code:** \`${botConfig.FIVEM_CFX_CODE || 'No definido'}\`\n\n` +
                    `────────────────────────────\n` +
                    `⚙️ **¿CÓMO CAMBIAR LOS CANALES Y AJUSTES?**\n` +
                    `• \`!setcanal solicitudes <#canal o ID>\`\n` +
                    `• \`!setcanal aprobados <#canal o ID>\`\n` +
                    `• \`!setcanal denegados <#canal o ID>\`\n` +
                    `• \`!setcanal streampanel <#canal o ID>\` *(Donde va el botón)*\n` +
                    `• \`!setcanal streamaviso <#canal o ID>\` *(Donde se publica el directo)*\n` +
                    `• \`!setcanal status <#canal o ID>\` *(Panel de jugadores)*\n` +
                    `• \`!setcanal normativas <#canal o ID>\`\n` +
                    `• \`!setcanal tickets <#canal o ID>\`\n` +
                    `• \`!setcanal general <#canal o ID>\`\n` +
                    `• \`!setrol staff <@rol o ID>\`\n` +
                    `• \`!setrol streamer <@rol o ID>\`\n` +
                    `• \`!setip <ip:puerto>\` *(Ej: 185.230.52.246:30120)*\n` +
                    `• \`!setcfx <codigo>\` *(Ej: 7b97gmr)*\n` +
                    `• \`!reiniciar-paneles\` *(Vuelve a enviar los paneles automáticos)*`
                )
                .setFooter({
                    text: 'SPAIN RP • Configuración Exclusiva del Creador',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setTimestamp();

            return { adminEmbed, files };
        }

        // 1. PANEL DE ADMINISTRACIÓN Y CONFIGURACIÓN (!admin, !config)
        if (['!admin', '!panel-admin', '!config', '!ajustes'].includes(command)) {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            try {
                const { adminEmbed, files } = buildAdminEmbed(message.author.id);
                return message.reply({ embeds: [adminEmbed], files });
            } catch (err) {
                console.error('Error al mostrar panel admin:', err);
                return message.reply({ content: `❌ Error al abrir el panel admin: ${err.message}` });
            }
        }

        // 2. COMANDO PARA CAMBIAR CANALES (!setcanal <tipo> <#canal o ID>)
        if (command === '!setcanal') {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const tipo = (args[1] || '').toLowerCase();
            const rawTarget = args[2];

            if (!tipo || !rawTarget) {
                return message.reply({
                    content: `❌ **Uso:** \`!setcanal <tipo> <#canal o ID>\`\n` +
                        `📌 **Tipos disponibles:** \`solicitudes\`, \`aprobados\`, \`denegados\`, \`streampanel\`, \`streamaviso\`, \`status\`, \`normativas\`, \`tickets\`, \`general\`\n` +
                        `*Ejemplo:* \`!setcanal aprobados #wl-aprobados\``
                });
            }

            const channelIdMatch = rawTarget.match(/<#(\d+)>|(\d+)/);
            const channelId = channelIdMatch ? (channelIdMatch[1] || channelIdMatch[2]) : null;

            if (!channelId) {
                return message.reply({ content: '❌ No se pudo detectar un canal o ID válido.' });
            }

            const channelKeyMap = {
                'solicitudes': 'CHANNEL_SOLICITUDES_ID',
                'solicitud': 'CHANNEL_SOLICITUDES_ID',
                'aprobados': 'CHANNEL_APROBADOS_ID',
                'aprobado': 'CHANNEL_APROBADOS_ID',
                'denegados': 'CHANNEL_DENEGADOS_ID',
                'denegado': 'CHANNEL_DENEGADOS_ID',
                'streampanel': 'CHANNEL_STREAM_PANEL_ID',
                'panelstream': 'CHANNEL_STREAM_PANEL_ID',
                'panel-stream': 'CHANNEL_STREAM_PANEL_ID',
                'streamaviso': 'CHANNEL_STREAMERS_ID',
                'streamers': 'CHANNEL_STREAMERS_ID',
                'streamer': 'CHANNEL_STREAMERS_ID',
                'directos': 'CHANNEL_STREAMERS_ID',
                'status': 'CHANNEL_STATUS_ID',
                'estado': 'CHANNEL_STATUS_ID',
                'normativas': 'CHANNEL_NORMATIVAS_ID',
                'tickets': 'CHANNEL_TICKETS_ID',
                'ticket': 'CHANNEL_TICKETS_ID',
                'general': 'CHANNEL_GENERAL_ID'
            };

            const configKey = channelKeyMap[tipo];
            if (!configKey) {
                return message.reply({
                    content: `❌ Tipo de canal no válido: \`${tipo}\`.\nOpciones: \`solicitudes\`, \`aprobados\`, \`denegados\`, \`streampanel\`, \`streamaviso\`, \`status\`, \`normativas\`, \`tickets\`, \`general\``
                });
            }

            updateConfig(configKey, channelId);

            // Si se cambió el canal del panel de directos, enviar el panel allí de inmediato
            if (configKey === 'CHANNEL_STREAM_PANEL_ID') {
                ensureStreamPanel().catch(() => {});
            }

            // Si se cambió el canal de estado, actualizar panel
            if (configKey === 'CHANNEL_STATUS_ID') {
                updateChannelStatusPanel().catch(() => {});
            }

            return message.reply({
                content: `✅ **Canal actualizado con éxito:**\n⚙️ **Ajuste:** \`${configKey}\`\n📍 **Nuevo Canal:** <#${channelId}> (\`${channelId}\`)`
            });
        }

        // 3. COMANDO PARA CAMBIAR ROLES (!setrol <tipo> <@rol o ID>)
        if (command === '!setrol') {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const tipo = (args[1] || '').toLowerCase();
            const rawTarget = args[2];

            if (!tipo || !rawTarget) {
                return message.reply({
                    content: `❌ **Uso:** \`!setrol <staff|streamer> <@rol o ID>\`\n*Ejemplo:* \`!setrol staff @Staff WL\``
                });
            }

            const roleIdMatch = rawTarget.match(/<@&(\d+)>|(\d+)/);
            const roleId = roleIdMatch ? (roleIdMatch[1] || roleIdMatch[2]) : null;

            if (!roleId) {
                return message.reply({ content: '❌ No se pudo detectar un rol o ID válido.' });
            }

            let configKey = '';
            if (['staff', 'admin', 'moderador'].includes(tipo)) configKey = 'ROLE_STAFF_ID';
            else if (['streamer', 'streamers', 'creador'].includes(tipo)) configKey = 'ROLE_STREAMER_ID';
            else {
                return message.reply({ content: '❌ Tipo de rol inválido. Usa `staff` o `streamer`.' });
            }

            updateConfig(configKey, roleId);

            return message.reply({
                content: `✅ **Rol actualizado con éxito:**\n⚙️ **Ajuste:** \`${configKey}\`\n🛡️ **Nuevo Rol:** <@&${roleId}> (\`${roleId}\`)`
            });
        }

        // 4. COMANDO PARA CAMBIAR IP DEL SERVIDOR FIVEM (!setip <ip:puerto>)
        if (command === '!setip') {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const newIp = args[1];
            if (!newIp) {
                return message.reply({ content: '❌ **Uso:** `!setip <ip:puerto>` (Ej: `!setip 185.230.52.246:30120`)' });
            }

            updateConfig('FIVEM_SERVER_IP', newIp);
            return message.reply({
                content: `✅ **IP de FiveM actualizada:** \`${newIp}\`\nEl bot empezará a consultar los datos de esta IP automáticamente.`
            });
        }

        // 5. COMANDO PARA CAMBIAR CÓDIGO CFX (!setcfx <codigo>)
        if (command === '!setcfx') {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const newCfx = args[1];
            if (!newCfx) {
                return message.reply({ content: '❌ **Uso:** `!setcfx <codigo>` (Ej: `!setcfx 7b97gmr`)' });
            }

            updateConfig('FIVEM_CFX_CODE', newCfx);
            return message.reply({
                content: `✅ **Código CFX actualizado:** \`${newCfx}\``
            });
        }

        // 6. COMANDO PARA REINICIAR / REENVIAR PANELES (!reiniciar-paneles)
        if (['!reiniciar-paneles', '!recargar-paneles'].includes(command)) {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            await message.reply({ content: '🔄 **Reenviando y actualizando paneles automáticos...**' });
            if (botConfig.CHANNEL_STREAM_PANEL_ID) await ensureStreamPanel().catch(() => {});
            if (botConfig.CHANNEL_STATUS_ID) await updateChannelStatusPanel().catch(() => {});
            return;
        }

        // ----------------------------------------------------
        // COMANDO DE TESTING: !test-ia <texto> / !analizar-ia (Audita cualquier texto para el Staff)
        // ----------------------------------------------------
        if (['!test-ia', '!analizar-ia', '!check-ia', '!auditoria-ia'].includes(command)) {
            let textToAnalyze = args.slice(1).join(' ').trim();

            // Si respondió a un mensaje con !test-ia, analizar el texto del mensaje respondido
            if (!textToAnalyze && message.reference && message.reference.messageId) {
                try {
                    const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                    if (repliedMsg) {
                        textToAnalyze = repliedMsg.content || '';
                        if (repliedMsg.embeds && repliedMsg.embeds.length > 0) {
                            textToAnalyze += ' ' + repliedMsg.embeds.map(e => `${e.title || ''} ${e.description || ''}`).join(' ');
                        }
                    }
                } catch (e) {}
            }

            if (!textToAnalyze) {
                return message.reply({
                    content: `🤖 **Uso:** \`!test-ia <texto>\` o responde a un mensaje con \`!test-ia\``
                });
            }

            const analysis = await analyzeTextForAI(textToAnalyze);
            const bar = buildProgressBar(analysis.aiScore, 10);

            let embedColor = 0x2ECC71; // Verde (Humano)
            if (analysis.aiScore >= 75) embedColor = 0xE74C3C; // Rojo (IA)
            else if (analysis.aiScore >= 40) embedColor = 0xF1C40F; // Amarillo (Duda)

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            let iconURL = client.user.displayAvatarURL();
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                iconURL = 'attachment://logo.png';
            }

            const testEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(
                    `👤 **Solicitante:** ${message.author}\n` +
                    `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                    `📄 **Diagnóstico:** ${analysis.statusLabel}`
                );

            return message.reply({ embeds: [testEmbed], files });
        }

        // ----------------------------------------------------
        // COMANDO DE TESTING: !test-ia (Audita automáticamente sin rellenar nada o con texto propio)
        // ----------------------------------------------------
        if (['!test-ia', '!analizar-ia', '!check-ia', '!auditoria-ia'].includes(command)) {
            let textToAnalyze = args.slice(1).join(' ').trim();

            // Si respondió a un mensaje con !test-ia, analizar el texto del mensaje respondido
            if (!textToAnalyze && message.reference && message.reference.messageId) {
                try {
                    const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                    if (repliedMsg) {
                        textToAnalyze = repliedMsg.content || '';
                        if (repliedMsg.embeds && repliedMsg.embeds.length > 0) {
                            textToAnalyze += ' ' + repliedMsg.embeds.map(e => `${e.title || ''} ${e.description || ''}`).join(' ');
                        }
                    }
                } catch (e) {}
            }

            // Si no escribió ningún texto, usar historia de prueba automática
            if (!textToAnalyze) {
                textToAnalyze = 'Desde temprana edad creció en un barrio humilde forjando su propio destino a pesar de las adversidades en busca de un nuevo comienzo y de nuevas oportunidades.';
            }

            const analysis = await analyzeTextForAI(textToAnalyze);
            const bar = buildProgressBar(analysis.aiScore, 10);

            let embedColor = 0x2ECC71; // Verde (Humano)
            if (analysis.aiScore >= 75) embedColor = 0xE74C3C; // Rojo (IA)
            else if (analysis.aiScore >= 40) embedColor = 0xF1C40F; // Amarillo (Duda)

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            let iconURL = client.user.displayAvatarURL();
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                iconURL = 'attachment://logo.png';
            }

            let testDesc = `👤 **Solicitante:** ${message.author}\n` +
                `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.quality && analysis.quality.qualityNotes && analysis.quality.qualityNotes.length > 0) {
                testDesc += `\n📝 **Revisión Narrativa:** ⚠️ \`${analysis.quality.qualityNotes.join(' • ')}\``;
            }

            const testEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(testDesc);

            return message.reply({ embeds: [testEmbed], files });
        }

        // ----------------------------------------------------
        // COMANDO DE TESTING: !simular (Simula la Solicitud de WL completa + Tarjeta de Auditoría de IA)
        // ----------------------------------------------------
        if (message.content.startsWith('!simular-pendiente') || message.content.startsWith('!simular')) {
            const mentionedUser = message.mentions.users.first() || message.author;
            const isHumanMode = message.content.toLowerCase().includes('humano') || message.content.toLowerCase().includes('real');

            let sampleRole = isHumanMode
                ? 'HACER DE VIDA REAL EN POCAS PALABRAS E INTERPRETAR A MI PERSONAJE'
                : 'Interpretar un personaje ficticio siguiendo situaciones de la vida real con coherencia y respeto al entorno de la ciudad.';

            let sampleVida = isHumanMode
                ? 'VALORAR MI VIDA HACER COMO QUE ME DA MIEDO Y LLEVAR EL ROL BIEN Y NO HACER LOCURAS'
                : 'Poner la integridad de mi personaje por encima de cualquier posesión material, cooperando si me apuntan con un arma de fuego.';

            let sampleHistory = isHumanMode
                ? 'ME LLAMO JOSE VENGO DE UNA FAMILIA HUMILDE EN MI CIUDAD PERO AL CABO DE LOS AÑOS TUVE QUE APRENDER A GANARME LA VIDA YO SOLO JUNTO A MIS HERMANOS PORQUE NO HABIA CURRO Y DECIDIMOS MUDARNOS PARA EMPRENDER EN TALLERES Y SALIR ADELANTE CON RESPETO.'
                : 'Desde temprana edad, creció en un barrio humilde y conflictivo de la ciudad. A pesar de las adversidades y dificultades que la vida le tenía preparadas, siempre supo que debía forjar su propio destino con una mezcla de determinación y resiliencia en busca de un nuevo comienzo y de nuevas oportunidades.';

            // 1. Crear el Embed de la Solicitud de Whitelist (Estilo King / Formulario)
            const embedSolicitudWL = new EmbedBuilder()
                .setColor(0xF1C40F) // Amarillo Pendiente
                .setTitle('📋 Whitelist Solicitud Pendiente')
                .setDescription(
                    `**Solicitante:** <@${mentionedUser.id}> ha enviado una solicitud para 📋 **Whitelist**.\n\n` +
                    `🎭 **¿QUÉ ES EL ROL?**\n${sampleRole}\n\n` +
                    `❤️ **VALORACIÓN DE VIDA**\n${sampleVida}\n\n` +
                    `💀 **VIDA ÚNICA - MUERTE PERMANENTE PKT**\nSI ENTIENDO\n\n` +
                    `📖 **HISTORIA DE TU PERSONAJE OBLIGATORIO**\n${sampleHistory}\n\n` +
                    `🪪 **DATOS OOC DEL JUGADOR OBLIGATORIO**\nJOSE 19 AÑOS ESPAÑA\n\n` +
                    `────────────────────────────\n` +
                    `**Solicitante:** <@${mentionedUser.id}>\n` +
                    `**Decisión:** \`🟡 Pendiente\`\n` +
                    `**Enviada El:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString().slice(0, 5)}`
                );

            // 2. Analizar la historia con las 4 capas de IA
            const analysis = await analyzeTextForAI(sampleHistory);
            const bar = buildProgressBar(analysis.aiScore, 10);

            let embedColor = 0x2ECC71; // Verde
            if (analysis.aiScore >= 75) embedColor = 0xE74C3C; // Rojo
            else if (analysis.aiScore >= 40) embedColor = 0xF1C40F; // Amarillo

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            let iconURL = client.user.displayAvatarURL();
            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                iconURL = 'attachment://logo.png';
            }

            // 3. Crear la tarjeta de auditoría compacta
            const embedAuditoria = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(
                    `👤 **Solicitante:** <@${mentionedUser.id}>\n` +
                    `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                    `📄 **Diagnóstico:** ${analysis.statusLabel}`
                );

            // Enviar ÚNICAMENTE la tarjeta de auditoría
            await message.channel.send({
                embeds: [embedAuditoria],
                files
            });
            return;
        }

        // ----------------------------------------------------
        // COMANDO DE RETROALIMENTACIÓN: !ia-stats (Muestra estadísticas de aprendizaje)
        // ----------------------------------------------------
        if (['!ia-stats', '!stats-ia', '!aprendizaje-ia'].includes(command)) {
            const data = getAiFeedbackData();
            const totalCliches = Object.keys(data.learnedClichés || {}).length;
            const totalHuman = Object.keys(data.learnedHumanPatterns || {}).length;

            return message.reply({
                content: `🧠 **ESTADÍSTICAS DEL MOTOR DE APRENDIZAJE Y RETROALIMENTACIÓN DE IA:**\n\n` +
                    `📊 **Muestras procesadas:** \`${data.totalSamples || 0}\`\n` +
                    `✅ **WLs Aprobadas analizadas:** \`${data.approvedSamples || 0}\`\n` +
                    `❌ **WLs Denegadas / IA analizadas:** \`${data.deniedSamples || 0}\`\n` +
                    `🤖 **Patrones/Clichés de IA aprendidos:** \`${totalCliches}\`\n` +
                    `👤 **Patrones de lenguaje humano aprendidos:** \`${totalHuman}\`\n\n` +
                    `✨ *El bot calibra automáticamente su puntuación con cada solicitud decidida por el Staff.*`
            });
        }

        // ----------------------------------------------------
        // COMANDO DE RETROALIMENTACIÓN: !scan-historial [limite] (Aprende del historial existente)
        // ----------------------------------------------------
        if (['!scan-historial', '!escanear-historial', '!aprender-historial'].includes(command)) {
            const targetChannel = message.mentions.channels.first() || message.channel;
            const limit = Math.min(parseInt(args[1], 10) || 50, 100);

            const statusMsg = await message.reply({
                content: `🔄 **Escaneando las últimas \`${limit}\` WLs en <#${targetChannel.id}> para auto-calibración...**`
            });

            try {
                const messages = await targetChannel.messages.fetch({ limit });
                let learnedCount = 0;

                for (const [, msg] of messages) {
                    let fullMsgText = `${msg.content || ''}\n`;
                    if (msg.embeds && msg.embeds.length > 0) {
                        for (const embed of msg.embeds) {
                            fullMsgText += `${embed.title || ''}\n${embed.description || ''}\n`;
                            if (embed.fields) {
                                for (const f of embed.fields) fullMsgText += `${f.name}: ${f.value}\n`;
                            }
                        }
                    }

                    const isAprob = /Aprobada|¡?WHITELIST APROBADA!?/i.test(fullMsgText);
                    const isDeneg = /Denegada|¡?WHITELIST DENEGADA!?/i.test(fullMsgText);

                    if (isAprob || isDeneg) {
                        const decision = isAprob ? 'APROBADA' : 'DENEGADA';
                        const userMatch = fullMsgText.match(/<@!?(\d{17,20})>/) || fullMsgText.match(/Solicitante[:\s*]+@?([^\n\r]+)/i);
                        const userKey = userMatch ? (userMatch[1] ? `<@${userMatch[1]}>` : `@${userMatch[1]}`) : `Historial_${msg.id}`;
                        
                        registerFeedbackOutcome(userKey, decision, fullMsgText);
                        learnedCount++;
                    }
                }

                const data = getAiFeedbackData();
                return statusMsg.edit({
                    content: `✅ **¡Auto-calibración completada con éxito!**\n\n` +
                        `📥 **Mensajes analizados:** \`${learnedCount}\` formularios históricos.\n` +
                        `🤖 **Total patrones de IA calibrados:** \`${Object.keys(data.learnedClichés || {}).length}\`\n` +
                        `👤 **Total patrones humanos calibrados:** \`${Object.keys(data.learnedHumanPatterns || {}).length}\`\n` +
                        `🚀 *El motor ahora clasifica con precisión quirúrgica basada en el historial de SPAIN RP.*`
                });
            } catch (err) {
                console.error('Error al escanear historial:', err);
                return statusMsg.edit({
                    content: `❌ Hubo un error al escanear el canal: ${err.message}`
                });
            }
        }

        // ----------------------------------------------------
        // COMANDO DE RETROALIMENTACIÓN: !reset-ia (Reinicia la memoria de aprendizaje)
        // ----------------------------------------------------
        if (command === '!reset-ia') {
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            saveAiFeedbackData({
                totalSamples: 0,
                approvedSamples: 0,
                deniedSamples: 0,
                learnedClichés: {},
                learnedHumanPatterns: {},
                samples: []
            });

            return message.reply({ content: '🧹 **Memoria de aprendizaje de IA reiniciada a valores base de fábrica.**' });
        }
    }

    if (message.author.id === client.user.id) return;
    await handleWhitelistMessage(message, 'messageCreate');
});

// Manejo de interacciones (Botones y Slash Commands)
client.on('interactionCreate', async (interaction) => {
    // ----------------------------------------------------
    // MANEJO DE SLASH COMMANDS (/admin, /config, etc.) -> 100% EFÍMERO ("Solo tú puedes verlo")
    // ----------------------------------------------------
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (['admin', 'config'].includes(commandName)) {
            if (interaction.user.id !== OWNER_ID) {
                return interaction.reply({
                    content: '⛔ **Acceso denegado:** Este comando y panel son exclusivos del **Creador del Bot**.',
                    ephemeral: true
                });
            }

            const { adminEmbed, files } = buildAdminEmbed(interaction.user.id);
            return interaction.reply({
                embeds: [adminEmbed],
                files: files,
                ephemeral: true
            });
        }

        if (commandName === 'notificarstream') {
            const hasStaff = await isStaffMember(interaction.member, interaction.guild, interaction.user.id);
            if (!hasStaff) {
                return interaction.reply({
                    content: '❌ Solo los miembros de **Staff** o el **Creador** pueden usar este comando.',
                    ephemeral: true
                });
            }

            const embed = buildStreamPanelEmbed();
            const row = buildStreamPanelRow();
            const files = [];
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const imgDirectoPath = path.join(__dirname, 'assets', 'directo.png');
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            if (fs.existsSync(imgDirectoPath)) files.push(new AttachmentBuilder(imgDirectoPath, { name: 'directo.png' }));

            await interaction.channel.send({
                content: `# 🟣 ¡PANEL OFICIAL DE DIRECTOS!\n# ¡Avisa a toda la comunidad de tu transmisión!`,
                embeds: [embed],
                components: [row],
                files
            });
            return interaction.reply({ content: '✅ Panel de directos enviado.', ephemeral: true });
        }

        if (commandName === 'estado') {
            const state = await fetchFiveMServerStatus();
            const embed = buildStatusEmbed(state);
            const row = buildStatusActionRow();
            const files = [];
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            return interaction.reply({ embeds: [embed], components: [row], files, ephemeral: true });
        }
    }

    if (!interaction.isButton()) return;

    // ----------------------------------------------------
    // BOTÓN: ABRIR PANEL DE CONTROL ADMIN (!admin trigger) -> EFÍMERO ("Solo tú puedes verlo")
    // ----------------------------------------------------
    if (interaction.customId === 'btn_open_admin_panel') {
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: '⛔ **Acceso denegado:** Este comando y panel son exclusivos del **Creador del Bot**.',
                ephemeral: true
            });
        }

        const { adminEmbed, files } = buildAdminEmbed(interaction.user.id);
        return interaction.reply({
            embeds: [adminEmbed],
            files: files,
            ephemeral: true
        });
    }

    // ----------------------------------------------------
    // BOTÓN: NOTIFICAR DIRECTO
    // ----------------------------------------------------
    if (interaction.customId === 'btn_notificar_directo') {
        const userId = interaction.user.id;
        const streamersData = getStreamersData();
        let streamerInfo = streamersData[userId];

        // Si no está registrado por ID, verificar si tiene actividad de stream activa en Discord
        if (!streamerInfo) {
            const streamingActivity = interaction.member?.presence?.activities?.find(act =>
                act.type === ActivityType.Streaming ||
                (act.url && (act.url.includes('twitch.tv') || act.url.includes('kick.com') || act.url.includes('youtube.com') || act.url.includes('tiktok.com')))
            );

            if (streamingActivity && streamingActivity.url) {
                let platform = 'Twitch';
                if (streamingActivity.url.includes('kick.com')) platform = 'Kick';
                else if (streamingActivity.url.includes('youtube.com')) platform = 'YouTube';
                else if (streamingActivity.url.includes('tiktok.com')) platform = 'TikTok';

                streamerInfo = {
                    url: streamingActivity.url,
                    platform: platform,
                    title: streamingActivity.details || streamingActivity.name || 'Roleplay en directo en SPAIN RP 🇪🇸'
                };
            }
        }

        if (!streamerInfo) {
            return interaction.reply({
                content: `❌ **No tienes un canal de Streamer registrado en el bot.**\n\n📌 Para usar este botón, un Administrador debe añadir tu canal con \`!addstreamer @usuario <enlace>\` o debes tener tu stream activo en tu estado de Discord.\n💬 *Si eres streamer oficial, contacta con Administración.*`,
                ephemeral: true
            });
        }

        // Cooldown anti-spam de 2 horas por streamer
        const lastNotified = streamerCooldowns.get(userId);
        const cooldownTime = 2 * 60 * 60 * 1000;
        if (lastNotified && (Date.now() - lastNotified < cooldownTime)) {
            const remainingMs = cooldownTime - (Date.now() - lastNotified);
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            return interaction.reply({
                content: `⏳ **Ya has notificado tu directo recientemente.**\nPor favor, espera **${remainingMinutes} minutos** antes de volver a enviar otro aviso a la comunidad.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        // Obtener el título en tiempo real desde la plataforma (Twitch/Kick/YouTube/Discord)
        const liveTitle = await fetchLiveStreamTitle(streamerInfo.url, interaction.member, streamerInfo.title);

        // Enviar notificación al canal oficial de streams
        const result = await sendStreamerNotification({
            userMention: `<@${userId}>`,
            streamUrl: streamerInfo.url,
            streamTitle: liveTitle,
            platform: streamerInfo.platform || (streamerInfo.url.includes('kick.com') ? 'Kick' : 'Twitch'),
            avatarUrl: interaction.user.displayAvatarURL({ dynamic: true })
        });

        const targetChannelId = botConfig.CHANNEL_STREAMERS_ID || '1551179646865772644';

        if (result && result.success) {
            streamerCooldowns.set(userId, Date.now());
            return interaction.editReply({
                content: `✅ **¡Tu directo ha sido anunciado con éxito en <#${targetChannelId}>!**\n🏷️ **Título detectado:** \`"${liveTitle}"\`\n¡Mucho éxito en tu transmisión! 🚀`
            });
        } else {
            return interaction.editReply({
                content: `❌ Hubo un error al publicar el anuncio en el canal <#${targetChannelId}>. Verifica permisos del bot.`
            });
        }
    }

    // ----------------------------------------------------
    // BOTONES DEL SIMULADOR DE WHITELIST
    // ----------------------------------------------------
    const [action, type, targetUserId] = interaction.customId.split('_');
    if (type !== 'wl') return;

    const hasStaffPermission = await isStaffMember(interaction.member, interaction.guild, interaction.user.id);
    if (!hasStaffPermission) {
        return interaction.reply({
            content: '❌ Solo los miembros con el rol de **Staff** pueden utilizar estos botones.',
            ephemeral: true
        });
    }

    const targetUserMention = `<@${targetUserId}>`;
    const staffMention = `<@${interaction.user.id}>`;
    const isApproval = action === 'aprobar';

    // 1. Actualizar el contenedor original de la solicitud (como hace el bot King)
    const updatedEmbed = new EmbedBuilder()
        .setColor(isApproval ? 0x2ECC71 : 0xE74C3C)
        .setTitle(isApproval ? '📋 Whitelist Solicitud Aprobada' : '📋 Whitelist Solicitud Denegada')
        .setDescription(
            `**Solicitante:** ${targetUserMention} ha enviado una solicitud para 📋 **Whitelist**.\n\n` +
            `🎭 **¿QUÉ ES EL ROL?**\nEs interpretar un personaje ficticio siguiendo situaciones de la vida real.\n\n` +
            `❤️ **VALORACIÓN DE VIDA**\nSi me apuntan con un arma colaboro en todo sin objeciones.\n\n` +
            `────────────────────────────\n` +
            `**Solicitante:** ${targetUserMention}\n` +
            `**Decidido Por:** ${staffMention}\n` +
            `**Decisión:** ${isApproval ? 'Aprobada' : 'Denegada'}\n` +
            `**Decidido El:** ${new Date().toLocaleDateString()}\n` +
            `${isApproval ? '**Roles Concedidos:** @🟩 | WL' : '**Roles:** Sin cambios'}`
        );

    // Desactivar botones una vez decidido
    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_done_1')
            .setLabel(isApproval ? 'Aprobada por ' + interaction.user.username : 'Denegada por ' + interaction.user.username)
            .setStyle(isApproval ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(true)
    );

    await interaction.update({
        embeds: [updatedEmbed],
        components: [disabledRow]
    });

    // 2. Procesar el mensaje actualizado para que envíe el contenedor al canal de aprobados
    const message = await interaction.message.fetch();
    await handleWhitelistMessage(message, 'interactionSimulator');
});

// Cuando el bot oficial de solicitudes edita el mensaje (Envío instantáneo)
client.on('messageUpdate', async (oldMessage, newMessage) => {
    console.log(`✏️ [MSG EDITADO] Canal: #${newMessage.channel ? newMessage.channel.name : 'N/A'} (${newMessage.channel ? newMessage.channel.id : 'N/A'}) | Autor: ${newMessage.author ? newMessage.author.tag : 'N/A'}`);

    if (newMessage.author && newMessage.author.id === client.user.id) return;
    await handleWhitelistMessage(newMessage, 'messageUpdate (instantáneo)');
});

// ==========================================
// 6. DETECCIÓN AUTOMÁTICA DE STREAMERS (PRESENCE UPDATE)
// ==========================================
client.on('presenceUpdate', async (oldPresence, newPresence) => {
    try {
        if (!newPresence || !newPresence.user || newPresence.user.bot) return;

        // Buscar si el usuario tiene una actividad de Streaming
        const streamingActivity = newPresence.activities.find(act =>
            act.type === ActivityType.Streaming ||
            (act.url && (act.url.includes('twitch.tv') || act.url.includes('kick.com') || act.url.includes('youtube.com')))
        );

        if (!streamingActivity) return;

        // Comprobar si ya estaba streameando antes para no repetir el aviso
        const oldStreamingActivity = oldPresence?.activities?.find(act =>
            act.type === ActivityType.Streaming ||
            (act.url && (act.url.includes('twitch.tv') || act.url.includes('kick.com') || act.url.includes('youtube.com')))
        );

        if (oldStreamingActivity && oldStreamingActivity.url === streamingActivity.url) {
            return; // Ya estaba en directo con el mismo stream
        }

        // Anti-spam Cooldown: 3 horas por streamer
        const userId = newPresence.userId;
        const lastNotified = streamerCooldowns.get(userId);
        if (lastNotified && Date.now() - lastNotified < 3 * 60 * 60 * 1000) {
            return;
        }

        // Si se configuró un rol de streamer específico, comprobar que el usuario lo tenga
        if (ROLE_STREAMER_ID) {
            const member = newPresence.member || await newPresence.guild.members.fetch(userId).catch(() => null);
            if (!member || !member.roles.cache.has(ROLE_STREAMER_ID)) {
                return;
            }
        }

        const streamUrl = streamingActivity.url || `https://twitch.tv/${streamingActivity.name || ''}`;
        const streamTitle = streamingActivity.details || streamingActivity.name || 'Roleplay en directo en SPAIN RP \uD83C\uDDEA\uD83C\uDDF8';

        // Detectar plataforma
        let platform = 'Twitch';
        if (streamUrl.includes('kick.com')) platform = 'Kick';
        else if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) platform = 'YouTube';
        else if (streamUrl.includes('tiktok.com')) platform = 'TikTok';

        const userMention = `<@${userId}>`;
        const avatarUrl = newPresence.user.displayAvatarURL({ dynamic: true });

        const result = await sendStreamerNotification({
            userMention,
            streamUrl,
            streamTitle,
            platform,
            avatarUrl
        });

        if (result && result.success) {
            streamerCooldowns.set(userId, Date.now());
        }
    } catch (err) {
        console.error('Error en presenceUpdate de streamers:', err);
    }
});

// ==========================================
// 7. CONSOLA DE COMANDOS INTERACTIVA DESDE CMD / TERMINAL
// ==========================================
const readline = require('readline');

if (process.stdin.isTTY || process.env.NODE_ENV !== 'production') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', async (line) => {
        const input = line.trim().toLowerCase();
        if (!input) return;

        // Comando para borrar mensajes del bot en el canal de WL
        if (['limpiar', 'limpiar-wl', 'clear-wl', 'borrar-wl', 'borrar-bot', 'clean', 'cls'].includes(input)) {
            console.log('\n🧹 [CMD] Buscando y eliminando todos los mensajes enviados por el bot en el canal de Whitelist...');
            try {
                const channelId = botConfig.CHANNEL_SOLICITUDES_ID || '1517530849661288455';
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    console.log(`❌ [CMD] No se pudo acceder al canal de solicitudes (${channelId}).`);
                    return;
                }

                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (!messages || messages.size === 0) {
                    console.log('ℹ️ [CMD] No hay mensajes en el canal.');
                    return;
                }

                let deletedCount = 0;
                for (const [, msg] of messages) {
                    if (msg.author.id === client.user.id) {
                        await msg.delete().catch(() => {});
                        deletedCount++;
                    }
                }

                console.log(`✅ [CMD] ¡Se han eliminado con éxito ${deletedCount} mensajes del bot en #${channel.name}!\n`);
            } catch (err) {
                console.error('❌ [CMD] Error al limpiar mensajes:', err.message);
            }
            return;
        }

        // Comando para limpiar en solicitudes y aprobados
        if (['limpiar-todo', 'clear-all', 'borrar-todo'].includes(input)) {
            console.log('\n🧹 [CMD] Limpiando mensajes del bot en todos los canales de Whitelist...');
            const channelsToClean = [
                botConfig.CHANNEL_SOLICITUDES_ID || '1517530849661288455',
                botConfig.CHANNEL_APROBADOS_ID || '1550880724930797610'
            ].filter(Boolean);

            for (const cId of channelsToClean) {
                try {
                    const channel = await client.channels.fetch(cId).catch(() => null);
                    if (channel) {
                        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                        let count = 0;
                        if (messages) {
                            for (const [, msg] of messages) {
                                if (msg.author.id === client.user.id) {
                                    await msg.delete().catch(() => {});
                                    count++;
                                }
                            }
                        }
                        console.log(`✅ [CMD] Eliminados ${count} mensajes en #${channel.name}`);
                    }
                } catch (e) {}
            }
            console.log('✨ [CMD] Limpieza global completada.\n');
            return;
        }

        // Estadísticas de IA en tiempo real
        if (['stats', 'ia-stats', 'estado-ia'].includes(input)) {
            const data = getAiFeedbackData();
            console.log(`\n📊 [CMD STATS IA] Muestras totales: ${data.totalSamples || 0} | Aprobadas: ${data.approvedSamples || 0} | Denegadas: ${data.deniedSamples || 0}`);
            console.log(`🤖 Clichés IA calibrados: ${Object.keys(data.learnedClichés || {}).length} | Patrones humanos: ${Object.keys(data.learnedHumanPatterns || {}).length}\n`);
            return;
        }

        // Re-escanear historial bajo demanda
        if (['scan', 'escanear'].includes(input)) {
            console.log('\n🔄 [CMD] Iniciando escaneo de calibración histórica...');
            await autoBootstrapChannelHistory();
            return;
        }

        // Ayuda
        if (['ayuda', 'help', '?'].includes(input)) {
            console.log('\n📋 [COMANDOS DISPONIBLES EN LA TERMINAL / CMD]:');
            console.log('  • limpiar      -> Borra todos los mensajes que el bot envió en el canal de solicitudes');
            console.log('  • limpiar-todo -> Borra mensajes del bot en solicitudes y aprobados');
            console.log('  • scan         -> Vuelve a escanear el historial para calibrar la IA');
            console.log('  • stats        -> Muestra las estadísticas de aprendizaje del bot');
            console.log('  • salir        -> Apaga el bot de forma segura\n');
            return;
        }

        if (['salir', 'exit', 'stop'].includes(input)) {
            console.log('👋 [CMD] Apagando el bot...');
            client.destroy();
            process.exit(0);
        }
    });
}

// Iniciar sesión en Discord
client.login(process.env.DISCORD_TOKEN);
