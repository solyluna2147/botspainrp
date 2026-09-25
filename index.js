require('dotenv').config();
const dns = require('dns');
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) { }

const {
    Client,
    Events,
    GatewayIntentBits,
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActivityType,
    Partials,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    StreamType,
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const play = require('play-dl');
const prism = require('prism-media');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');
const googleTTS = require('google-tts-api');
const ffmpegStatic = require('ffmpeg-static');
process.env.FFMPEG_PATH = ffmpegStatic;

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [ERROR NO CAPTURADO / UNHANDLED REJECTION]:', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error('🔥 [EXCEPCIÓN CRÍTICA / UNCAUGHT EXCEPTION]:', err);
});

// Función para purgar archivos temporales de audio sobrantes
function purgeTempAudioFiles() {
    try {
        const files = fs.readdirSync(__dirname);
        for (const file of files) {
            if ((file.startsWith('tts_') || file.startsWith('test_')) && file.endsWith('.mp3')) {
                const fullPath = path.join(__dirname, file);
                try {
                    fs.unlinkSync(fullPath);
                } catch (e) { }
            }
        }
    } catch (e) { }
}
purgeTempAudioFiles();
setInterval(purgeTempAudioFiles, 30 * 60 * 1000); // Cada 30 minutos

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
    console.log(`🚀 [WEB] Servidor web 24/7 activo en el puerto ${PORT}`);
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
        GatewayIntentBits.GuildVoiceStates, // Necesario para entrevistas de voz en vivo
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
// CONFIGURACIÓN DINÁMICA Y PERSISTENTE (CONFIG.JSON / MONGODB CLOUD)
// ==========================================
const mongoose = require('mongoose');
const OWNER_ID = '418558256840179722'; // ID exclusivo del Creador (acceso total a paneles y configuración)
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Esquemas Mongoose para MongoDB Atlas
const botSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const staffRatingSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    userId: String,
    userName: String,
    staffId: String,
    staffTag: String,
    rating: Number,
    comment: String,
    timestamp: String
});

const staffRatingDataSchema = new mongoose.Schema({
    docId: { type: String, default: 'main', unique: true },
    staffList: [String],
    stats: { type: Map, of: Object },
    ratings: [staffRatingSchema]
}, { timestamps: true });

const streamerSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    data: Object
}, { timestamps: true });

const aiFeedbackSchema = new mongoose.Schema({
    docId: { type: String, default: 'main', unique: true },
    data: Object
}, { timestamps: true });

const sancionSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    reporterId: String,
    reporterTag: String,
    targetId: String,
    targetTag: String,
    reason: String,
    punishment: String,
    involvedStaff: String,
    imageUrl: String,
    channelId: String,
    messageId: String,
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const eventoSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    reporterId: String,
    reporterTag: String,
    title: String,
    description: String,
    hora: String,
    lugar: String,
    organiza: String,
    ping: String,
    imageUrl: String,
    channelId: String,
    messageId: String,
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const BotSettingModel = mongoose.model('BotSetting', botSettingSchema);
const StaffRatingDataModel = mongoose.model('StaffRatingData', staffRatingDataSchema);
const StreamerModel = mongoose.model('Streamer', streamerSchema);
const AiFeedbackModel = mongoose.model('AiFeedback', aiFeedbackSchema);
const SancionModel = mongoose.model('Sancion', sancionSchema);
const EventoModel = mongoose.model('Evento', eventoSchema);

let isMongoConnected = false;

// Conectar a MongoDB Atlas si existe MONGODB_URI
if (process.env.MONGODB_URI) {
    try {
        const dns = require('dns');
        dns.setServers(['8.8.8.8', '1.1.1.1']);
    } catch (e) { }

    mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000
    }).then(async () => {
        isMongoConnected = true;
        console.log('🍃 [MONGODB ATLAS] Conexión establecida con éxito en la nube (SpainRP DB).');
        await syncDataFromMongo();
    }).catch(err => {
        console.warn('⚠️ [MONGODB ATLAS] No se pudo conectar a MongoDB. Se usarán archivos JSON locales:', err.message);
    });
}

// Sincronizar datos de Mongo al iniciar
async function syncDataFromMongo() {
    if (!isMongoConnected) return;
    try {
        // 1. Config
        const settings = await BotSettingModel.find();
        for (const s of settings) {
            botConfig[s.key] = s.value;
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf8');

        // 2. Staff Ratings
        const staffDoc = await StaffRatingDataModel.findOne({ docId: 'main' });
        if (staffDoc) {
            const statsObj = {};
            if (staffDoc.stats) {
                staffDoc.stats.forEach((val, key) => { statsObj[key] = val; });
            }
            const dataToSave = {
                staffList: staffDoc.staffList || ['418558256840179722'],
                ratings: staffDoc.ratings || [],
                stats: statsObj
            };
            recalculateStaffRatings(dataToSave);
            fs.writeFileSync(STAFF_RATINGS_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
        } else {
            // Subir datos iniciales locales a Mongo si está vacío
            const localData = getStaffRatingsData();
            await StaffRatingDataModel.create({
                docId: 'main',
                staffList: localData.staffList,
                stats: localData.stats,
                ratings: localData.ratings
            }).catch(() => { });
        }

        // 3. Streamers (Fusión bidireccional entre local y Mongo)
        const streamers = await StreamerModel.find();
        let localStreamers = {};
        if (fs.existsSync(STREAMERS_FILE)) {
            try {
                localStreamers = JSON.parse(fs.readFileSync(STREAMERS_FILE, 'utf8'));
            } catch (e) { }
        }
        const mergedStreamers = { ...localStreamers };
        if (streamers.length > 0) {
            for (const st of streamers) {
                mergedStreamers[st.userId] = { ...(mergedStreamers[st.userId] || {}), ...st.data };
            }
        }
        for (const [uid, stData] of Object.entries(mergedStreamers)) {
            await StreamerModel.findOneAndUpdate({ userId: uid }, { userId: uid, data: stData }, { upsert: true }).catch(() => { });
        }
        fs.writeFileSync(STREAMERS_FILE, JSON.stringify(mergedStreamers, null, 2), 'utf8');
        console.log(`📺 [STREAMERS] Sincronizados ${Object.keys(mergedStreamers).length} streamers con la base de datos.`);

        // 4. Auto-aprendizaje de Whitelists (AI Feedback)
        const aiDoc = await AiFeedbackModel.findOne({ docId: 'main' });
        if (aiDoc && aiDoc.data) {
            aiFeedbackState = aiDoc.data;
            fs.writeFileSync(AI_FEEDBACK_FILE, JSON.stringify(aiDoc.data, null, 2), 'utf8');
            console.log(`🧠 [IA WHITELIST] Aprendizaje sincronizado desde la nube (${aiDoc.data.totalSamples || 0} solicitudes procesadas).`);
        } else if (fs.existsSync(AI_FEEDBACK_FILE)) {
            const localAi = JSON.parse(fs.readFileSync(AI_FEEDBACK_FILE, 'utf8'));
            aiFeedbackState = localAi;
            await AiFeedbackModel.create({ docId: 'main', data: localAi }).catch(() => { });
        }

        // 5. Historial de Eventos
        const eventosDb = await EventoModel.find().sort({ createdAt: -1 }).limit(500);
        if (eventosDb.length > 0) {
            fs.writeFileSync(EVENTOS_FILE, JSON.stringify(eventosDb, null, 2), 'utf8');
        }

        console.log('🔄 [MONGODB ATLAS] Datos sincronizados correctamente desde la nube.');
    } catch (e) {
        console.error('Error al sincronizar desde MongoDB:', e);
    }
}

function loadDynamicConfig() {
    const defaults = {
        CHANNEL_SOLICITUDES_ID: process.env.CHANNEL_SOLICITUDES_ID || '',
        CHANNEL_APROBADOS_ID: process.env.CHANNEL_APROBADOS_ID || '1550880724930797610',
        CHANNEL_DENEGADOS_ID: process.env.CHANNEL_DENEGADOS_ID || '',
        CHANNEL_ENTREVISTAS_ID: process.env.CHANNEL_ENTREVISTAS_ID || '1551179786108280923',
        CHANNEL_STATUS_ID: process.env.CHANNEL_STATUS_ID || '',
        CHANNEL_STREAM_PANEL_ID: process.env.CHANNEL_STREAM_PANEL_ID || '1551998229384536114',
        CHANNEL_STREAMERS_ID: process.env.CHANNEL_STREAMERS_ID || '1517530849032016006',
        CHANNEL_NORMATIVAS_ID: process.env.CHANNEL_NORMATIVAS_ID || '1517530848658849996',
        CHANNEL_TICKETS_ID: process.env.CHANNEL_TICKETS_ID || '1517530849334136844',
        CHANNEL_GENERAL_ID: process.env.CHANNEL_GENERAL_ID || '1517530849032016002',
        CHANNEL_VALORACION_PANEL_ID: process.env.CHANNEL_VALORACION_PANEL_ID || '1552087566776537148',
        CHANNEL_VALORACIONES_ID: process.env.CHANNEL_VALORACIONES_ID || '1552087605980561448',
        CHANNEL_SANCIONES_ID: process.env.CHANNEL_SANCIONES_ID || '',
        CHANNEL_SANCIONES_PANEL_ID: process.env.CHANNEL_SANCIONES_PANEL_ID || '',
        CHANNEL_EVENTOS_ID: process.env.CHANNEL_EVENTOS_ID || '',
        CHANNEL_EVENTOS_2_ID: process.env.CHANNEL_EVENTOS_2_ID || '',
        CHANNEL_EVENTOS_PANEL_ID: process.env.CHANNEL_EVENTOS_PANEL_ID || '',
        CHANNEL_BIENVENIDAS_ID: process.env.CHANNEL_BIENVENIDAS_ID || '',
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

async function updateConfig(key, value) {
    botConfig[key] = value;
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf8');
        console.log(`💾 [CONFIG GUARDADA] ${key} = ${value}`);
    } catch (e) {
        console.error('Error al guardar config.json:', e);
    }
    if (isMongoConnected) {
        try {
            await BotSettingModel.findOneAndUpdate({ key }, { key, value }, { upsert: true });
        } catch (e) {
            console.error('Error guardando en Mongo config:', e);
        }
    }
}

// ==========================================
// SISTEMA INDEPENDIENTE: VALORACIONES DE STAFF
// ==========================================
const STAFF_RATINGS_FILE = path.join(__dirname, 'staff_ratings.json');

function getStaffRatingsData() {
    if (fs.existsSync(STAFF_RATINGS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STAFF_RATINGS_FILE, 'utf8'));
            if (!data.staffList) data.staffList = ['418558256840179722'];
            if (!data.ratings) data.ratings = [];
            if (!data.stats) data.stats = {};
            return data;
        } catch (e) {
            console.error('Error al leer staff_ratings.json:', e);
        }
    }
    return { staffList: ['418558256840179722'], ratings: [], stats: {} };
}

function addStaffMemberToRating(staffId) {
    const data = getStaffRatingsData();
    if (!data.staffList.includes(staffId)) {
        data.staffList.push(staffId);
        try {
            fs.writeFileSync(STAFF_RATINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) { }
        if (isMongoConnected) {
            StaffRatingDataModel.findOneAndUpdate({ docId: 'main' }, { staffList: data.staffList }, { upsert: true }).catch(() => { });
        }
        return true;
    }
    return false;
}

function removeStaffMemberFromRating(staffId) {
    const data = getStaffRatingsData();
    const idx = data.staffList.indexOf(staffId);
    if (idx !== -1) {
        data.staffList.splice(idx, 1);
        try {
            fs.writeFileSync(STAFF_RATINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) { }
        if (isMongoConnected) {
            StaffRatingDataModel.findOneAndUpdate({ docId: 'main' }, { staffList: data.staffList }, { upsert: true }).catch(() => { });
        }
        return true;
    }
    return false;
}

function recalculateStaffRatings(data) {
    const newStats = {};
    for (const r of (data.ratings || [])) {
        const staffId = r.staffId || 'staff_general';
        if (!newStats[staffId]) {
            newStats[staffId] = {
                staffTag: r.staffTag || 'Staff',
                totalRatings: 0,
                sumRatings: 0,
                average: 0
            };
        }
        const s = newStats[staffId];
        s.staffTag = r.staffTag || s.staffTag;
        s.totalRatings += 1;
        s.sumRatings += Number(r.rating) || 0;
        s.average = Number((s.sumRatings / s.totalRatings).toFixed(1));
    }
    data.stats = newStats;
    return data;
}

function saveStaffRatingsData(data) {
    recalculateStaffRatings(data);
    try {
        fs.writeFileSync(STAFF_RATINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar staff_ratings.json:', e);
    }
    if (isMongoConnected) {
        StaffRatingDataModel.findOneAndUpdate(
            { docId: 'main' },
            {
                staffList: data.staffList,
                stats: data.stats,
                ratings: data.ratings
            },
            { upsert: true }
        ).catch(e => console.error('Error guardando ratings completos en Mongo:', e));
    }
}

function saveStaffRating({ userId, userName, staffId, staffTag, rating, comment }) {
    const data = getStaffRatingsData();
    const entry = {
        id: Date.now().toString(),
        userId,
        userName,
        staffId,
        staffTag,
        rating: Number(rating),
        comment: comment.trim(),
        timestamp: new Date().toISOString()
    };

    data.ratings.push(entry);

    if (staffId && !data.staffList.includes(staffId)) {
        data.staffList.push(staffId);
    }

    recalculateStaffRatings(data);

    try {
        fs.writeFileSync(STAFF_RATINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar staff_ratings.json:', e);
    }

    if (isMongoConnected) {
        StaffRatingDataModel.findOneAndUpdate(
            { docId: 'main' },
            {
                staffList: data.staffList,
                stats: data.stats,
                $push: { ratings: entry }
            },
            { upsert: true }
        ).catch(e => console.error('Error guardando rating en Mongo:', e));
    }

    const s = data.stats[staffId] || {
        staffTag,
        totalRatings: 1,
        sumRatings: Number(rating),
        average: Number(rating)
    };

    return { entry, stats: s };
}

function parseRatingFromMessage(msg) {
    let userMention = null;
    let userId = null;
    let userName = 'Usuario';
    let staffMention = null;
    let staffId = null;
    let staffTag = 'Staff';
    let numRating = null;
    let comment = '';
    const timestamp = (msg.createdAt || new Date()).toISOString();

    const fullContent = [
        msg.content || '',
        ...(msg.embeds || []).map(e => [
            e.title || '',
            e.description || '',
            e.author?.name || '',
            e.footer?.text || '',
            ...(e.fields || []).map(f => `${f.name}: ${f.value}`)
        ].join('\n'))
    ].join('\n');

    if (!fullContent) return null;

    // 1. Extraer Staff
    const staffIdMatch = fullContent.match(/Miembro del Staff Evaluado[^\n]*\n?>\s*<@!?(\d{17,20})>/i) ||
        fullContent.match(/Staff Evaluado[^\n]*\n?>\s*<@!?(\d{17,20})>/i) ||
        fullContent.match(/Staff[^\n]*:\s*<@!?(\d{17,20})>/i) ||
        fullContent.match(/<@!?(\d{17,20})>\s*!/i);

    if (staffIdMatch) {
        staffId = staffIdMatch[1];
    } else {
        // Si no hay mención directa con formato, buscar cualquier mención en el embed
        const allMentions = fullContent.match(/<@!?(\d{17,20})>/g);
        if (allMentions && allMentions.length >= 2) {
            // Normalmente la 1a es el usuario y la 2a el staff
            staffId = allMentions[1].replace(/[<@!>]/g, '');
        } else if (allMentions && allMentions.length === 1) {
            staffId = allMentions[0].replace(/[<@!>]/g, '');
        }
    }

    // 2. Extraer Usuario
    const userIdMatch = fullContent.match(/Usuario que Valora[^\n]*\n?>\s*<@!?(\d{17,20})>/i) ||
        fullContent.match(/Usuario[^\n]*\n?>\s*<@!?(\d{17,20})>/i);
    if (userIdMatch) {
        userId = userIdMatch[1];
    } else {
        const allMentions = fullContent.match(/<@!?(\d{17,20})>/g);
        if (allMentions && allMentions.length >= 2) {
            userId = allMentions[0].replace(/[<@!>]/g, '');
        }
    }

    // 3. Extraer Nota (1 al 10)
    const ratingMatch = fullContent.match(/Puntuaci[oó]n Otorgada[^\n]*\n?>\s*`?(\d{1,2})\/10`?/i) ||
        fullContent.match(/Puntuaci[oó]n[^\n]*:\s*`?(\d{1,2})\/10`?/i) ||
        fullContent.match(/`?(\d{1,2})\/10`?/i) ||
        fullContent.match(/Nota[^\n]*:\s*(\d{1,2})/i);

    if (ratingMatch) {
        numRating = parseInt(ratingMatch[1], 10);
    }

    // 4. Extraer Comentario
    const commentMatch = fullContent.match(/Opini[oó]n y Experiencia del Usuario[^\n]*\n?>\s*[\*"]*([\s\S]*?)[\*"]*\n\n📈/i) ||
        fullContent.match(/Opini[oó]n y Experiencia del Usuario[^\n]*\n?>\s*[\*"]*([\s\S]*?)[\*"]*(?:\n\n|\n>|$)/i) ||
        fullContent.match(/Comentario[^\n]*:\s*[\*"]*([^\n]+)/i);

    if (commentMatch) {
        comment = commentMatch[1].replace(/^[\*"\s]+|[\*"\s]+$/g, '').trim();
    }

    if (!staffId || !numRating || isNaN(numRating) || numRating < 1 || numRating > 10) {
        return null;
    }

    const member = msg.guild?.members?.cache?.get(staffId);
    if (member) staffTag = member.user?.tag || member.displayName;

    const userMember = userId ? msg.guild?.members?.cache?.get(userId) : null;
    if (userMember) userName = userMember.user?.tag || userMember.displayName;

    return {
        id: msg.id,
        userId: userId || 'unknown',
        userName,
        staffId,
        staffTag,
        rating: numRating,
        comment: comment || 'Sin comentario',
        timestamp
    };
}

async function syncStaffRatingsFromChannel(targetChannel = null) {
    try {
        const channelId = targetChannel?.id || botConfig.CHANNEL_VALORACIONES_ID;
        if (!channelId) return { success: false, error: 'Canal de valoraciones no configurado.' };

        const channel = targetChannel || await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return { success: false, error: 'No se pudo acceder al canal de valoraciones.' };

        console.log(`🔍 [SYNC VALORACIONES] Escaneando historial completo del canal #${channel.name} (${channel.id})...`);

        let allMessages = [];
        let lastId = null;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const messages = await channel.messages.fetch(options).catch(() => null);
            if (!messages || messages.size === 0) break;
            allMessages.push(...messages.values());
            lastId = messages.last().id;
            if (messages.size < 100) break;
        }

        console.log(`📋 [SYNC VALORACIONES] Total de mensajes obtenidos en el canal: ${allMessages.length}`);

        const currentData = getStaffRatingsData();
        const existingRatings = currentData.ratings || [];
        let importedCount = 0;

        for (const msg of allMessages) {
            const parsed = parseRatingFromMessage(msg);
            if (!parsed) continue;

            const isDuplicate = existingRatings.some(r => {
                if (r.id === parsed.id) return true;
                if (r.staffId === parsed.staffId && r.userId === parsed.userId && r.rating === parsed.rating && Math.abs(new Date(r.timestamp).getTime() - new Date(parsed.timestamp).getTime()) < 60000) {
                    return true;
                }
                return false;
            });

            if (!isDuplicate) {
                existingRatings.push(parsed);
                if (!currentData.staffList.includes(parsed.staffId)) {
                    currentData.staffList.push(parsed.staffId);
                }
                importedCount++;
            }
        }

        currentData.ratings = existingRatings;
        saveStaffRatingsData(currentData);

        // Actualizar automáticamente el panel de Tops si existe
        await updateStaffTopRankingPanel().catch(() => { });

        console.log(`✅ [SYNC VALORACIONES] Sincronización completada. ${importedCount} nuevas valoraciones añadidas al Top. Total en BD: ${existingRatings.length}`);
        return { success: true, importedCount, totalRatings: existingRatings.length, stats: currentData.stats };
    } catch (err) {
        console.error('Error al sincronizar valoraciones desde el canal:', err);
        return { success: false, error: err.message };
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
    const existing = current[userId] || {};

    const updatedProfile = {
        ...existing
    };

    if (streamerObj.twitchUrl) {
        updatedProfile.twitchUrl = streamerObj.twitchUrl;
        if (streamerObj.twitchTitle !== undefined) updatedProfile.twitchTitle = streamerObj.twitchTitle;
    }

    if (streamerObj.kickUrl) {
        updatedProfile.kickUrl = streamerObj.kickUrl;
        if (streamerObj.kickTitle !== undefined) updatedProfile.kickTitle = streamerObj.kickTitle;
    }

    if (streamerObj.tiktokUrl) {
        updatedProfile.tiktokUrl = streamerObj.tiktokUrl;
        if (streamerObj.tiktokTitle !== undefined) updatedProfile.tiktokTitle = streamerObj.tiktokTitle;
    }

    if (streamerObj.url) {
        const urlLower = streamerObj.url.toLowerCase();
        if (urlLower.includes('kick.com')) {
            updatedProfile.kickUrl = streamerObj.url;
            if (streamerObj.title) updatedProfile.kickTitle = streamerObj.title;
        } else if (urlLower.includes('tiktok.com')) {
            updatedProfile.tiktokUrl = streamerObj.url;
            if (streamerObj.title) updatedProfile.tiktokTitle = streamerObj.title;
        } else if (urlLower.includes('twitch.tv')) {
            updatedProfile.twitchUrl = streamerObj.url;
            if (streamerObj.title) updatedProfile.twitchTitle = streamerObj.title;
        } else {
            updatedProfile.url = streamerObj.url;
            updatedProfile.platform = streamerObj.platform || 'Twitch';
        }
    }

    if (streamerObj.name) updatedProfile.name = streamerObj.name;

    current[userId] = updatedProfile;
    try {
        fs.writeFileSync(STREAMERS_FILE, JSON.stringify(current, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar en streamers.json:', e);
    }

    if (isMongoConnected) {
        StreamerModel.findOneAndUpdate({ userId }, { userId, data: updatedProfile }, { upsert: true }).catch(() => { });
    }
}

function removeStreamer(userId) {
    const current = getStreamersData();
    if (current[userId]) {
        delete current[userId];
        try {
            fs.writeFileSync(STREAMERS_FILE, JSON.stringify(current, null, 2), 'utf8');
        } catch (e) {
            console.error('Error al eliminar de streamers.json:', e);
        }
        if (isMongoConnected) {
            StreamerModel.deleteOne({ userId }).catch(() => { });
        }
        return true;
    }
    return false;
}

function clearAllStreamers() {
    try {
        fs.writeFileSync(STREAMERS_FILE, JSON.stringify({}, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al limpiar streamers.json:', e);
        return false;
    }
    if (isMongoConnected) {
        StreamerModel.deleteMany({}).catch(() => { });
    }
    return true;
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

// Set en memoria para evitar reprocesar mensajes duplicados de Whitelist
const processedMessages = new Set();

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
    text = text.replace(/Nueva Solicitud de (?:📋 )?Whitelist[^\n\r]*/gi, ' ');
    text = text.replace(/Whitelist Solicitud (?:Pendiente|Aprobada|Denegada)[^\n\r]*/gi, ' ');
    text = text.replace(/ha enviado una solicitud para (?:📋 )?Whitelist[^\n\r]*/gi, ' ');
    text = text.replace(/Solicitante[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decidido Por[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decisión[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Decidido El[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Enviada El[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Roles Concedidos[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Roles[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/Estado[:\s*]+[^\n\r]+/gi, ' ');
    text = text.replace(/─{3,}/g, ' ');

    // Limpieza de etiquetas sueltas
    text = text.replace(/¿?QUÉ ES EL ROL\??/gi, ' ');
    text = text.replace(/DEFINICIÓN DE ROL/gi, ' ');
    text = text.replace(/VALORACIÓN DE VIDA/gi, ' ');
    text = text.replace(/VIDA ÚNICA - MUERTE PERMANENTE PKT/gi, ' ');
    text = text.replace(/HISTORIA DE TU PERSONAJE OBLIGATORIO/gi, ' ');
    text = text.replace(/HISTORIA DE TU PERSONAJE/gi, ' ');
    text = text.replace(/DATOS OOC DEL JUGADOR OBLIGATORIO/gi, ' ');
    text = text.replace(/DATOS OOC DEL JUGADOR/gi, ' ');
    text = text.replace(/\s+/g, ' ').trim();

    return text;
}

let aiFeedbackState = null;

function getAiFeedbackData() {
    if (aiFeedbackState) {
        return aiFeedbackState;
    }

    const defaultData = {
        totalSamples: 0,
        approvedSamples: 0,
        deniedSamples: 0,
        learnedClichés: {},
        learnedHumanPatterns: {},
        deniedPhrasesCount: {},
        approvedPhrasesCount: {},
        processedFormIds: {},
        samples: []
    };

    if (fs.existsSync(AI_FEEDBACK_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(AI_FEEDBACK_FILE, 'utf8'));
            aiFeedbackState = { ...defaultData, ...parsed, processedFormIds: parsed.processedFormIds || {} };
            return aiFeedbackState;
        } catch (e) {
            console.error('Error al leer ai_feedback.json:', e);
        }
    }
    aiFeedbackState = defaultData;
    return aiFeedbackState;
}

function saveAiFeedbackData(data) {
    aiFeedbackState = data;
    try {
        if (data.samples && data.samples.length > 500) {
            data.samples = data.samples.slice(-500);
        }
        fs.writeFileSync(AI_FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar ai_feedback.json:', e);
    }
    if (isMongoConnected) {
        AiFeedbackModel.findOneAndUpdate({ docId: 'main' }, { data }, { upsert: true }).catch(() => { });
    }
}

// Extraer n-gramas filtrados para no capturar ruido ni stopwords
function extractInformativeNGrams(text, n = 3) {
    const clean = text.toLowerCase().replace(/[^\wáéíóúñ\s]/gi, ' ').trim();
    const words = clean.split(/\s+/).filter(w => w.length > 1);
    const ngrams = [];

    for (let i = 0; i <= words.length - n; i++) {
        const slice = words.slice(i, i + n);
        // Debe tener al menos 1 palabra de contenido sustancial
        const nonStopCount = slice.filter(w => !SPANISH_STOP_WORDS.has(w)).length;
        if (nonStopCount >= 1) {
            ngrams.push(slice.join(' '));
        }
    }
    return ngrams;
}

// Función que registra el resultado final de un Staff (Aprobada / Denegada) y retroalimenta contrastivamente
function registerFeedbackOutcome(applicantKey, decisionType, text = '', shouldSave = true, formKey = null) {
    if (!applicantKey) return;

    const data = getAiFeedbackData();
    const isApproved = decisionType === 'APROBADA';
    const isDenied = decisionType === 'DENEGADA';

    if (formKey) {
        if (!data.processedFormIds) data.processedFormIds = {};
        if (data.processedFormIds[formKey]) return; // Ya aprendido, ignorar
        data.processedFormIds[formKey] = true;
    }

    let targetText = text;
    if (!targetText && pendingAuditsMap.has(applicantKey)) {
        targetText = pendingAuditsMap.get(applicantKey).text;
    }

    // Limpiar texto para aislar respuestas
    const candidateOnly = extractCandidateAnswers(targetText);
    if (!candidateOnly || candidateOnly.length < 15) return;

    data.totalSamples = (data.totalSamples || 0) + 1;
    if (isApproved) data.approvedSamples = (data.approvedSamples || 0) + 1;
    if (isDenied) data.deniedSamples = (data.deniedSamples || 0) + 1;

    if (!data.deniedPhrasesCount) data.deniedPhrasesCount = {};
    if (!data.approvedPhrasesCount) data.approvedPhrasesCount = {};
    if (!data.learnedClichés) data.learnedClichés = {};
    if (!data.learnedHumanPatterns) data.learnedHumanPatterns = {};

    const ngrams = [
        ...extractInformativeNGrams(candidateOnly, 2),
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

    data.samples.push({
        applicant: applicantKey,
        decision: decisionType,
        textPreview: candidateOnly.substring(0, 120),
        date: new Date().toISOString()
    });

    if (shouldSave) {
        rebuildContrastivePatterns(data);
        saveAiFeedbackData(data);
        console.log(`🧠 [IA APRENDIZAJE] Calibrada decisión ${decisionType} para "${applicantKey}". Muestras: ${data.totalSamples}`);
    }
}

// Recalcula y consolida clichés vs patrones humanos
function rebuildContrastivePatterns(data) {
    if (!data.learnedClichés) data.learnedClichés = {};
    if (!data.learnedHumanPatterns) data.learnedHumanPatterns = {};

    for (const [phrase, dCount] of Object.entries(data.deniedPhrasesCount || {})) {
        const aCount = data.approvedPhrasesCount?.[phrase] || 0;
        if (dCount >= 2 && aCount === 0) {
            data.learnedClichés[phrase] = {
                count: dCount,
                weight: Math.min(6 + dCount * 2, 14)
            };
        } else {
            delete data.learnedClichés[phrase];
        }
    }

    for (const [phrase, aCount] of Object.entries(data.approvedPhrasesCount || {})) {
        if (aCount >= 2) {
            data.learnedHumanPatterns[phrase] = {
                count: aCount,
                weight: Math.min(4 + aCount * 2, 12)
            };
        }
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

// Función para enviar la notificación personalizada del directo al canal de streamers
async function sendStreamerNotification({ userMention, streamUrl, streamTitle, platform = 'Twitch', avatarUrl = null }) {
    const channelId = botConfig.CHANNEL_STREAMERS_ID || '1517530849032016006';
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return { success: false, error: 'Canal de streamers no encontrado' };

    const normPlatform = (platform || 'Twitch').toLowerCase();
    const isKick = normPlatform.includes('kick') || (streamUrl && streamUrl.includes('kick.com'));
    const isTikTok = normPlatform.includes('tiktok') || (streamUrl && streamUrl.includes('tiktok.com'));
    const isTwitch = !isKick && !isTikTok;

    let bannerFileName = 'stream.png';
    let embedColor = 0x9B59B6; // Morado Twitch
    let platformDisplayName = 'Twitch';
    let buttonEmoji = '🟣';

    if (isKick) {
        bannerFileName = 'kick.png';
        embedColor = 0x53FC18; // Verde Neón Oficial de Kick
        platformDisplayName = 'Kick';
        buttonEmoji = '🟢';
    } else if (isTikTok) {
        bannerFileName = 'tiktok.png';
        embedColor = 0xFE2C55; // Rosa/Rojo TikTok
        platformDisplayName = 'TikTok LIVE';
        buttonEmoji = '⚫';
    }

    const bannerPath = path.join(__dirname, 'assets', bannerFileName);
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const files = [];

    if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: bannerFileName }));
    }
    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: `🔴 DIRECTO EN ${platformDisplayName.toUpperCase()} • SPAIN RP 🇪🇸`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTitle(`🔥 ¡${platformDisplayName} en Directo!`)
        .setDescription(
            `\u200B\n` +
            `👋 ¡Atención <@&${botConfig.ROLE_STREAMER_ID || ''}> y comunidad!\n\n` +
            `👤 **Creador de Contenido:**\n` +
            `> ${userMention} ❗\n\n` +
            `🎮 **Emisión y Rol:**\n` +
            `> **${streamTitle || 'Roleplay en directo en SPAIN RP 🇪🇸'}**\n\n` +
            `📺 **Plataforma:** \`${platformDisplayName}\`\n\n` +
            `🌐 **Enlace del Directo:**\n` +
            `> 🔗 **[Haz clic aquí para ver el directo](${streamUrl})**\n\n` +
            `🇪🇸 **¡Pásate a apoyar a nuestro creador y disfruta del mejor rol!** 🇪🇸`
        )
        .setFooter({
            text: `SPAIN RP • Notificaciones de ${platformDisplayName}`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (avatarUrl) {
        embed.setThumbnail(avatarUrl);
    } else if (fs.existsSync(logoPath)) {
        embed.setThumbnail('attachment://logo.png');
    }

    if (fs.existsSync(bannerPath)) {
        embed.setImage(`attachment://${bannerFileName}`);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(`Ver Directo en ${platformDisplayName}`)
            .setStyle(ButtonStyle.Link)
            .setURL(streamUrl)
            .setEmoji(buttonEmoji)
    );

    try {
        const pingText = botConfig.CHANNEL_GENERAL_ID ? `📢 ¡Nuevo directo en **${platformDisplayName}**! ${userMention}` : `📢 ${userMention}`;
        await channel.send({
            content: pingText,
            embeds: [embed],
            components: [row],
            files
        });
        console.log(`📡 [STREAM NOTIFICADO] Notificación de ${platformDisplayName} enviada para ${userMention}`);
        return { success: true };
    } catch (err) {
        console.error('Error al enviar mensaje de streamer:', err);
        return { success: false, error: err.message };
    }
}

// Función para construir el Embed del Panel de Streamers (con Logo y Banner oficial)
function buildStreamPanelEmbed() {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const imgPanelPath = path.join(__dirname, 'assets', 'panel_directos.png');

    const canalStreamers = `<#${botConfig.CHANNEL_STREAMERS_ID || '1517530849032016006'}>`;
    const canalTickets = `<#${botConfig.CHANNEL_TICKETS_ID || '1517530849334136844'}>`;
    const canalGeneral = `<#${botConfig.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    const embed = new EmbedBuilder()
        .setColor(0x9B59B6) // Morado elegante SPAIN RP
        .setAuthor({
            name: 'SISTEMA DE CREADORES | SPAIN RP 🇪🇸',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle('🟣 ¡PANEL DE NOTIFICACIÓN DE DIRECTOS!')
        .setDescription(
            `\u200B\n` +
            `✨ ¡Bienvenido al **Panel Oficial de Creadores y Streamers** de **SPAIN RP** 🇪🇸!\n\n` +
            `Si eres Creador de Contenido oficial del servidor, puedes avisar a toda la comunidad cuando comiences directo en **Twitch, Kick o TikTok** con un solo clic.\n\n` +
            `📢 **| ¿Cómo publicar tu directo?**\n` +
            `> Haz clic en el botón de tu plataforma:\n` +
            `> • 🟣 **\`Notificar Twitch\`** (Botón Morado) para emisiones en Twitch.\n` +
            `> • 🟢 **\`Notificar Kick\`** (Botón Verde) para emisiones en Kick.\n` +
            `> • ⚫ **\`Notificar TikTok\`** (Botón Rosa) para emisiones en TikTok LIVE.\n\n` +
            `📍 **| Canal de publicación oficial:**\n` +
            `> ${canalStreamers} ❗\n\n` +
            `⚠️ **| Normativas de los Streamers:**\n` +
            `> • Debes estar transmitiendo contenido dentro de **SPAIN RP** 🇪🇸.\n\n` +
            `📁 **| ¿Quieres ser Streamer Oficial?**\n` +
            `> Abre un ticket de creadores en ${canalTickets} ❗\n\n` +
            `🌍 **| 𝗗𝗶𝘀𝗳𝗿𝘂𝘁𝗮 𝘆 𝗰𝗼𝗺𝗽𝗮𝗿𝘁𝗲 𝘁𝘂 𝗰𝗼𝗻𝘁𝗲𝗻𝗶𝗱𝗼,**\n` +
            `> ${canalGeneral} ❗\n\n` +
            `🇪🇸 **| ¡Disfruta y crece en SPAIN RP! |** 🇪🇸`
        )
        .setFooter({
            text: 'SPAIN RP • Creadores de Contenido Oficiales',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(imgPanelPath)) {
        embed.setImage('attachment://panel_directos.png');
    }

    return embed;
}

function buildStreamPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_notificar_twitch')
            .setLabel('Notificar Twitch')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🟣'),
        new ButtonBuilder()
            .setCustomId('btn_notificar_kick')
            .setLabel('Notificar Kick')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🟢'),
        new ButtonBuilder()
            .setCustomId('btn_notificar_tiktok')
            .setLabel('Notificar TikTok')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⚫')
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
        const imgPanelPath = path.join(__dirname, 'assets', 'panel_directos.png');
        if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
        if (fs.existsSync(imgPanelPath)) files.push(new AttachmentBuilder(imgPanelPath, { name: 'panel_directos.png' }));

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

// Función para obtener el título real del directo en vivo (desde Twitch/TikTok o presencia de Discord)
async function fetchLiveStreamTitle(streamUrl, member = null, defaultTitle = null) {
    // 1. Si el usuario tiene actividad de Streaming / Rich Presence en Discord
    if (member && member.presence && member.presence.activities) {
        const streamAct = member.presence.activities.find(act =>
            act.type === ActivityType.Streaming ||
            (act.details && act.details.trim()) ||
            (act.state && act.state.trim())
        );
        if (streamAct) {
            const titleFound = streamAct.details || streamAct.state || streamAct.name;
            if (titleFound && titleFound.trim() && !titleFound.toLowerCase().includes('twitch.tv') && !titleFound.toLowerCase().includes('tiktok.com')) {
                return titleFound.trim();
            }
        }
    }

    // 2. Si es Twitch, consultar la API pública / oEmbed de Twitch para obtener el título exacto actual
    try {
        if (streamUrl && streamUrl.includes('twitch.tv')) {
            const match = streamUrl.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
            if (match && match[1]) {
                const channelName = match[1];
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);

                // Consulta rápida a oEmbed de Twitch para obtener el título del directo
                const oembedRes = await fetch(`https://www.twitch.tv/${channelName}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    signal: controller.signal
                }).catch(() => null);
                clearTimeout(timeoutId);

                if (oembedRes && oembedRes.ok) {
                    const html = await oembedRes.text().catch(() => '');
                    // Extraer meta og:description o twitter:title o title
                    const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                        html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
                    if (descMatch && descMatch[1] && !descMatch[1].toLowerCase().includes('twitch is the world\'s')) {
                        return descMatch[1].trim();
                    }

                    const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
                    if (titleMatch && titleMatch[1]) {
                        const rawTitle = titleMatch[1].replace(/\s*-\s*Twitch$/i, '').trim();
                        if (rawTitle && rawTitle.toLowerCase() !== channelName.toLowerCase()) {
                            return rawTitle;
                        }
                    }
                }
                return `🔴 Directo de ${channelName} | SPAIN RP 🇪🇸`;
            }
        }
    } catch (err) { }

    // 3. Si es TikTok, extraer nombre del creador
    try {
        if (streamUrl && streamUrl.includes('tiktok.com')) {
            const match = streamUrl.match(/@([a-zA-Z0-9_.]+)/i);
            if (match && match[1]) {
                const tiktokUser = match[1];
                return `🔴 LIVE de @${tiktokUser} | SPAIN RP 🇪🇸`;
            }
        }
    } catch (e) { }

    if (defaultTitle && defaultTitle.trim() && !defaultTitle.includes('Roleplay en directo en SPAIN RP')) {
        return defaultTitle.trim();
    }

    return '🔥 Roleplay en vivo en SPAIN RP 🇪🇸';
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
            localAiScore: 0,
            localHumanScore: 100,
            apiAiScore: null,
            apiHumanScore: null,
            statusEmoji: '🟢',
            statusLabel: 'Texto Insuficiente / Sin Datos',
            wordCount: 0,
            sentenceCount: 0,
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
            localAiScore: 2,
            localHumanScore: 98,
            apiAiScore: null,
            apiHumanScore: null,
            statusEmoji: '🟢',
            statusLabel: 'Texto Breve / Humano',
            wordCount,
            sentenceCount: 1,
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
        { regex: /hacerse un nombre en la ciudad/i, label: 'Cliché de objetivo en GTA RP generado por IA', weight: 20 },
        { regex: /no fue un camino f[aá]cil|el camino no fue f[aá]cil/i, label: 'Cliché narrativo de superación', weight: 18 },
        { regex: /aprendi[oó] a base de golpes|aprendi[oó] por las malas/i, label: 'Frase trillada de madurez de IA', weight: 16 },
        { regex: /cada obst[aá]culo lo convirti[oó] en/i, label: 'Retórica de autoayuda de IA', weight: 20 }
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

    // Requerir coincidencia sustancial para patrones aprendidos históricos
    if (feedbackData.learnedClichés) {
        for (const [phrase, info] of Object.entries(feedbackData.learnedClichés)) {
            // Solo considerar si la frase tiene longitud suficiente y no es una simple coincidencia de palabras comunes
            if (info.count >= 3 && phrase.length >= 15 && lowerClean.includes(phrase)) {
                learnedAiBonus += Math.min(info.weight || 4, 8);
                if (hardDetectedPatterns.length < 3) {
                    hardDetectedPatterns.push(`Patrón IA recurrente ("${phrase.slice(0, 22)}...")`);
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
    // CAPA 5: Calibración y Fusión del Ensemble (Motor Interno vs APIs)
    // ----------------------------------------------------
    let rawScore = 5; // Base mínima

    // Sumar peso de clichés duros y uniformidad artificial
    if (hardClichéScore > 0) {
        rawScore += hardClichéScore + uniformityScore;
    }
    rawScore += learnedAiBonus;

    // Restar bonificaciones por rasgos humanos auténticos
    rawScore -= humanScoreBonus;

    // Calibración final por presencia de clichés arquetípicos
    if (hardClichéScore >= 40) {
        rawScore = Math.max(rawScore, 85);
    } else if (hardClichéScore >= 20) {
        rawScore = Math.max(rawScore, 40);
    } else if (humanScoreBonus > 15 && hardClichéScore === 0) {
        rawScore = Math.min(rawScore, 8); // Claramente humano
    } else if (hardClichéScore === 0) {
        rawScore = Math.min(rawScore, 20);
    }

    let localAiScore = Math.min(Math.max(Math.round(rawScore), 2), 98);
    let localHumanScore = 100 - localAiScore;

    let apiAiScore = null;
    let apiHumanScore = null;
    let finalAiScore = localAiScore;

    if (externalScores.length > 0) {
        let totalApiWeighted = 0;
        let totalApiWeight = 0;
        for (const ext of externalScores) {
            totalApiWeighted += ext.score * ext.weight;
            totalApiWeight += ext.weight;
        }
        apiAiScore = Math.round(totalApiWeighted / totalApiWeight);
        apiHumanScore = 100 - apiAiScore;

        const hfEntry = externalScores.find(e => e.name.toLowerCase().includes('huggingface'));
        const saplingEntry = externalScores.find(e => e.name.toLowerCase().includes('sapling'));

        // Caso Humano Inequívoco: HuggingFace u otra API da <=10% Y no hay clichés duros
        if (hfEntry && hfEntry.score <= 10 && hardDetectedPatterns.length === 0) {
            finalAiScore = Math.min(hfEntry.score, localAiScore, 8);
        } else if ((hfEntry && hfEntry.score >= 75) || (saplingEntry && saplingEntry.score >= 75) || hardDetectedPatterns.length >= 2) {
            // Caso IA Inequívoco
            const maxScore = Math.max(
                hfEntry ? hfEntry.score : 0,
                saplingEntry ? saplingEntry.score : 0,
                localAiScore
            );
            finalAiScore = Math.min(Math.max(maxScore, 86), 98);
        } else {
            // Promedio equilibrado entre el motor interno del bot y las APIs
            let totalWeighted = (localAiScore * 1.5) + totalApiWeighted;
            let totalWeight = 1.5 + totalApiWeight;
            finalAiScore = Math.round(totalWeighted / totalWeight);
        }

        finalAiScore = Math.min(Math.max(finalAiScore, 2), 98);
        console.log(`📊 [AUDITORÍA IA COMBINADA] Local: ${localAiScore}% | API: ${apiAiScore}% | Final: ${finalAiScore}%`);
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
        localAiScore,
        localHumanScore,
        apiAiScore,
        apiHumanScore,
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

// ==========================================
// 8. SISTEMA INDEPENDIENTE: AUDITORÍA DE ENTREVISTAS POR VOZ (WHISPER AI)
// ==========================================

// Mapeo en memoria RAM de entrevistas de voz activas (100% efímero, 0 bytes en disco)
// Clave: guildId -> { targetUserId, targetMention, staffMention, channelId, voiceChannelId, startTime, transcripts: [], connection }
const activeVoiceInterviews = new Map();

// Mapeo independiente para sesiones de charla interactiva con la IA en canal de voz
// Clave: guildId -> { userId, userName, channelId, connection, player, isGenerating }
const activeVoiceChats = new Map();

// Helper para crear un Buffer WAV estándar en memoria RAM (44 bytes header) sin crear archivos en disco
function pcmToWavBuffer(pcmBuffer, sampleRate = 48000, numChannels = 1, bitDepth = 16) {
    const header = Buffer.alloc(44);
    const byteRate = (sampleRate * numChannels * bitDepth) / 8;
    const blockAlign = (numChannels * bitDepth) / 8;
    const dataLength = pcmBuffer.length;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);

    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);

    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
}

// Transcripción en streaming con Hugging Face Inference API (Modelo Whisper)
async function transcribeAudioBufferWithHF(wavBuffer) {
    const hfToken = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
    if (!hfToken) {
        console.warn('⚠️ [HF WHISPER] No se ha configurado HUGGINGFACE_API_KEY en las variables de entorno de Render.');
        return '';
    }
    if (!wavBuffer || wavBuffer.length < 2000) return '';

    // Modelos Whisper en Hugging Face (priorizando modelos abiertos y comunitarios sin bloqueo de cuota Pro)
    const endpoints = [
        'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo',
        'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3',
        'https://router.huggingface.co/hf-inference/models/openai/whisper-medium',
        'https://router.huggingface.co/hf-inference/models/openai/whisper-base',
        'https://router.huggingface.co/hf-inference/models/Systran/faster-whisper-large-v3'
    ];

    for (const url of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${hfToken.trim()}`,
                    'Content-Type': 'audio/wav'
                },
                body: wavBuffer,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const text = (data.text || '').trim();
                if (text) {
                    console.log(`🎙️ [HF WHISPER ÉXITO (${url.split('/').pop()})]: "${text}"`);
                    return text;
                }
            } else {
                const errBody = await res.text().catch(() => '');
                console.warn(`⚠️ [HF WHISPER HTTP ${res.status}] en ${url.split('/').pop()}: ${errBody.substring(0, 120)}`);
            }
        } catch (e) {
            console.warn(`⚠️ [HF WHISPER ERROR en ${url.split('/').pop()}]: ${e.message}`);
        }
    }
    return '';
}

// Generar respuesta 100% autónoma, contextual y fluida por IA para voz humana
async function generateAiVoiceChatResponse(userPrompt, history = []) {
    const geminiKey = process.env.GEMINI_API_KEY;
    const now = new Date();
    const timeString = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

    const cleanInput = (userPrompt || '').replace(/^(bot|oye bot|hola bot|mira bot|dime bot|escucha bot)[\s,:]*/i, '').trim();
    const lower = (userPrompt || '').toLowerCase();

    // 1. DICCIONARIO COMPLETO, EXTENSO Y VARIADO DE DEFINICIONES DE ROLEPLAY (Entonación 100% Humana de España)
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Concepto: VALORAR VIDA
    if (/\b(valorar|valoracion|valoro)\s*(la)?\s*vida\b/i.test(lower) || /\b(vida)\b/i.test(lower) && /\b(qu[eé]\s+es|explica|dime)\b/i.test(lower)) {
        return pickRandom([
            `¡Hombre, valorar vida es el pilar sagrado de todo el servidor! Significa que debes interpretar que tu personaje siente un miedo real a morir o sufrir daños graves. Por ejemplo, si vas por la calle y alguien te saca un arma o te encañona entre tres personas, no puedes ir de valiente, vacilarles ni intentar sacar tú una pipa, sino que tienes que cooperar, levantar las manos y hacer lo que te digan para salvar el pellejo.`,
            `Pues mira, valorar vida básicamente consiste en poner la integridad física de tu personaje por encima de cualquier orgullo o dinero. En la vida real nadie se arriesga a recibir un tiro por no entregar una cartera, pues en el rol igual: si estás en clara desventaja o bajo amenaza directa de muerte, debes acatar las órdenes y temer por tu vida porque solo tienes una.`,
            `¡Claro crack! Valorar vida es no hacerte el héroe de película. Si te están apuntando por la espalda o estás acorralado, tu instinto natural debe ser sobrevivir. No puedes sacar un arma de la nada cuando ya te tienen encañonado ni saltar de un coche a doscientos por hora porque tu personaje no es inmortal.`
        ]);
    }

    // Concepto: POWERGAMING (PG)
    if (/\b(pg|powergaming|power gaming|power-gaming)\b/i.test(lower)) {
        return pickRandom([
            `¡El Powergaming tiene dos vertientes muy claras! La primera es hacer cosas que serían físicamente imposibles en la vida real, como tirarte de un tercer piso y salir corriendo como si nada. Y la segunda es forzar el rol de otro jugador sin darle posibilidad de reaccionar, por ejemplo poner en un comando que le quitas la cartera de un puñetazo sin que la otra persona pueda defenderse.`,
            `Pues mira, Powergaming es cuando rompes las leyes de la física o abusas de las mecánicas del juego para tener ventaja. Si sufres un accidente frontal a ciento cincuenta kilómetros por hora contra un muro, tienes la obligación de rolear el choque y los dolores, no puedes seguir conduciendo como si tu coche fuera un tanque.`,
            `¡Básicamente crack, Powergaming es cualquier acción que no tenga coherencia humana real! Desde llevar cinco fusiles de asalto escondidos en el bolsillo hasta obligar a otro usuario a aceptar una acción tuya sin que pueda resistirse ni rolear su parte.`
        ]);
    }

    // Concepto: METAGAMING (MG)
    if (/\b(mg|metagaming|meta gaming|meta-gaming)\b/i.test(lower)) {
        return pickRandom([
            `¡Metagaming es uno de los fallos más sancionados en el servidor! Consiste en utilizar cualquier tipo de información que has obtenido fuera del juego, ya sea por canales de Discord, streams de Twitch o mensajes privados, para beneficiar a tu personaje dentro del juego cuando él realmente no tiene cómo saberlo.`,
            `Pues mira crack, si un amigo te dice por WhatsApp que la policía está haciendo una redada en el barrio y tú vas para allá preparado, estás cometiendo Metagaming porque tu personaje en el juego no ha recibido ninguna llamada ni mensaje dentro del rol. Toda información debe transmitirse exclusivamente mediante medios IC.`,
            `¡Exacto fenómeno! Metagaming es mezclar lo OOC con lo IC. Por ejemplo, ver el nombre que un jugador tiene arriba de su cabeza y llamarle por su nombre real sin haberle conocido antes en persona dentro del servidor.`
        ]);
    }

    // Concepto: VDM (Vehicle Deathmatch)
    if (/\b(vdm|vehicle deathmatch|atropellar|carkill|car kill)\b/i.test(lower)) {
        return pickRandom([
            `¡El VDM es utilizar cualquier vehículo, ya sea coche, moto o camión, como si fuera un arma letal para atropellar o embestir a otros jugadores o a sus vehículos sin un motivo de peso ni un rol previo que lo justifique!`,
            `Pues mira, el coche sirve para desplazarte por la ciudad, no para ir por las aceras llevándote a la gente por delante. Atropellar a alguien de forma intencionada para matarlo o quitarle ventaja en un tiroteo está totalmente prohibido en Spain RP.`,
            `¡Claro crack! El Vehicle Deathmatch es emplear tu vehículo de forma antideportiva para chocar, golpear o arrollar a otros usuarios. Los coches sufren averías y atropellar a alguien en la vida real tiene consecuencias penales gravísimas.`
        ]);
    }

    // Concepto: RDM (Random Deathmatch)
    if (/\b(rdm|random deathmatch|matar sin rol|deathmatch)\b/i.test(lower)) {
        return pickRandom([
            `¡El RDM consiste en agredir, disparar o matar a otro usuario de forma totalmente aleatoria, sin haber mediado palabra ni haber iniciado previamente una interacción de rol que justifique ese acto de violencia!`,
            `Pues mira, Spain RP no es un juego de disparos por equipos. No puedes llegar a una zona, sacar un arma y liarte a tiros con el primero que pase. Para llegar a la agresión física o armada debe existir un trasfondo, una discusión o un conflicto previo bien desarrollado.`,
            `¡Totalmente crack! RDM es asesinar sin motivo de rol. Todo tiroteo o agresión debe tener un motivo coherente dentro de la historia de tu personaje y una advertencia o diálogo que lo preceda.`
        ]);
    }

    // Concepto: PK (Player Kill)
    if (/\b(pk|player kill|playerkill)\b/i.test(lower) && !/\b(ck)\b/i.test(lower)) {
        return pickRandom([
            `¡El Player Kill o PK es la pérdida de memoria de los acontecimientos recientes cuando tu personaje queda inconsciente en un rol y es reanimado en el hospital! Tu personaje sigue vivo, pero olvida todo lo relacionado con esa escena, quién le disparó o por qué estaba allí.`,
            `Pues mira, existen dos tipos: el PK parcial, donde olvidas únicamente el tiroteo o situación concreta que te llevó al hospital; y el PK total, donde olvidas por completo a una banda, trabajo o grupo con el que tenías relación para desvincularte de ellos definitivamente.`,
            `¡Exacto crack! Al recibir un PK no pierdes tu personaje ni tu dinero, simplemente limpias la memoria de los hechos que provocaron tu muerte temporal para evitar rencores y venganzas sin sentido.`
        ]);
    }

    // Concepto: CK (Character Kill)
    if (/\b(ck|character kill|characterkill|muerte definitiva)\b/i.test(lower)) {
        return pickRandom([
            `¡El Character Kill o CK es la muerte absoluta, definitiva e irreversible de tu personaje! Su historia se cierra por completo, pierde todas sus propiedades y relaciones, y estás obligado a crearte un personaje nuevo desde cero con otra identidad.`,
            `Pues mira, un CK puede ser solicitado voluntariamente por ti cuando quieres terminar la historia de tu personaje, o puede ser solicitado por una facción oficial o la policía mediante un trámite administrativo con el Staff si existen motivos de peso suficientes.`,
            `¡Hombre, el CK es lo más drástico en el roleplay! Significa que tu personaje deja de existir para siempre en la ciudad de Spain RP y no puedes volver a utilizar ni su nombre ni su trasfondo.`
        ]);
    }

    // Concepto: IC / OOC
    if (/\b(ic|ooc|in character|out of character)\b/i.test(lower)) {
        return pickRandom([
            `¡Pues mira, IC significa "In Character", es decir, todo lo que tu personaje siente, dice y experimenta dentro del juego. Y OOC es "Out of Character", cuando hablas tú como persona real a través de los canales de texto habilitados fuera del rol!`,
            `¡La distinción es fundamental crack! Nunca debes mezclar lo que te pasa a ti en la vida real con lo que le pasa a tu personaje en el servidor. Si alguien te insulta dentro del rol es a tu personaje, no a ti de forma personal.`
        ]);
    }

    // Concepto: ROL DE ENTORNO
    if (/\b(entorno|rol de entorno|ambiente|npc|ciudad)\b/i.test(lower)) {
        return pickRandom([
            `¡El Rol de Entorno es la ambientación de la ciudad! Debes tener en cuenta que Los Santos es una metrópoli con millones de habitantes, cámaras de seguridad, tráfico constante y comisarías cerca, aunque en tu pantalla no veas a otros jugadores en ese momento.`,
            `Pues mira crack, cometer un secuestro o un tiroteo en plena Gran Vía o enfrente del banco central no es realista a menos que rolees la llamada a la policía o la presencia de testigos que alertarían a las autoridades de inmediato.`
        ]);
    }

    // Concepto: EVASIÓN DE ROL
    if (/\b(evasion|evadir|evasion de rol|desconexion|tirar de cable)\b/i.test(lower)) {
        return pickRandom([
            `¡Evasión de rol es desconectarte del juego, forzar un error, suicidarte o huir deliberadamente de una situación que no te favorece para evitar ser arrestado, robado o sancionado! Está castigado severamente por el Staff.`,
            `¡Totalmente crack! Aunque la situación en el rol sea desfavorable para ti, debes continuar el rol hasta el final con deportividad y respeto hacia los demás compañeros.`
        ]);
    }

    // Concepto: ZONA SEGURA / SAFEZONE
    if (/\b(safezone|safe zone|zona segura|hospital|comisaria)\b/i.test(lower)) {
        return pickRandom([
            `¡Una Zona Segura es un punto neurálgico del mapa, como los hospitales, las comisarías de policía o los garajes centrales, donde está estrictamente prohibido cometer cualquier acto delictivo, sacar armas, secuestrar o iniciar altercados!`,
            `Pues mira, si alguien está escapando de un tiroteo o persecución, no puede refugiarse en una Zona Segura para evitar que le atrapen, ya que eso se considera evasión de rol.`
        ]);
    }

    // Concepto: NULA VALORACIÓN DE VIDA (NVV)
    if (/\b(nvv|nula valoracion|nula vida)\b/i.test(lower)) {
        return pickRandom([
            `¡Nula valoración de vida es pasar olímpicamente del peligro cuando estás encañonado por varias personas armadas, vacilar a tus agresores, o negarte a levantar las manos actuando como si fueras de hierro!`,
            `¡Exacto fenómeno! Todo personaje debe comportarse con sensatez humana ante una situación de riesgo mortal evidente.`
        ]);
    }

    // Concepto: QUÉ ES EL ROLEPLAY / QUÉ ES EL ROL
    if (/\b(qu[eé]\s+es\s+(el\s+)?rol|qu[eé]\s+es\s+(el\s+)?roleplay)\b/i.test(lower)) {
        return pickRandom([
            `¡El Roleplay es el arte de crear un personaje con su propia psicología, historia de vida, virtudes y defectos, e interpretarlo dentro de un mundo virtual interactuando con los demás como si fuera una película interactiva en vivo!`,
            `Pues mira, no se trata de ganar o acumular dinero, sino de generar historias apasionantes, respetar las normativas y convivir con la comunidad de forma inmersiva y divertida.`
        ]);
    }

    // Concepto: QUÉ ES SPAIN RP
    if (/\b(spain rp|servidor|este server)\b/i.test(lower)) {
        return `¡Spain RP es una comunidad española de FiveM dedicada al rol serio y de calidad, con sistemas avanzados, economía equilibrada y un equipo de Staff comprometido con la mejor experiencia para todos!`;
    }

    // Preguntas de HORA o FECHA
    if (/\b(hora|qu[eé]\s+hora|tiempo)\b/i.test(lower)) {
        return `¡Pues mira, ahora mismo son exactamente las ${timeString} de la noche!`;
    }
    if (/\b(d[ií]a|fecha|hoy)\b/i.test(lower)) {
        return `¡Hoy estamos a ${dateString}!`;
    }

    // SALUDOS / ESTADO DE ÁNIMO
    if (/\b(c[oó]mo\s+est[aá]s|qu[eé]\s+tal|c[oó]mo\s+andas|c[oó]mo\s+te\s+va)\b/i.test(lower)) {
        return pickRandom([
            `¡De lujo crack! Aquí al pie del cañón en el Discord de Spain RP, ¿tú qué tal llevas el día por la ciudad?`,
            `¡Todo genial amigo! Listo para resolver cualquier duda de rol o normativa que tengas, dime qué necesitas.`,
            `¡Muy bien hombre! Con ganas de buen rol y de ayudar a la comunidad, ¿qué te cuentas?`
        ]);
    }

    if (/\b(hola|buenas|hey|qu[eé]\s+pasa|saludos)\b/i.test(lower)) {
        return pickRandom([
            `¡Muy buenas crack! ¿Qué duda tienes sobre las normativas de rol?`,
            `¡Hola amigo! Dime qué concepto necesitas repasar y te lo explico al detalle.`,
            `¡Qué pasa fenómeno! Te escucho alto y claro, cuéntame qué tienes en mente.`
        ]);
    }

    // DESPEDIDAS
    if (/\b(adi[oó]s|hasta luego|chao|me voy|buenas noches|nos vemos)\b/i.test(lower)) {
        return `¡Venga crack, un placer charlar contigo! ¡Que pases muy buena noche y disfruta mucho del rol en Spain RP!`;
    }

    // AGRADECIMIENTOS
    if (/\b(gracias|muchas gracias|te lo agradezco|crack|genio|m[aá]quina)\b/i.test(lower)) {
        return `¡De nada hombre, para eso estamos! ¡A darle duro a la ciudad y a disfrutar!`;
    }

    // 2. MOTOR LLM COMPLEMENTARIO (Google Gemini Flash) para preguntas abiertas
    if (geminiKey) {
        const geminiModels = ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
        for (const model of geminiModels) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);

                const systemPrompt = `Eres el asistente de voz de SPAIN RP en Discord. Hablas en español de España de forma 100% natural, coloquial, amigable y fluida (usa ¡!, expresiones como "¡Hombre!", "Pues mira,", "Básicamente...").
Hora actual: ${timeString}.
Responde de forma clara y hablada en 2 o 3 frases explicativas con ritmo humano.`;

                const contents = [
                    { role: 'user', parts: [{ text: `Instrucción: ${systemPrompt}` }] },
                    { role: 'model', parts: [{ text: '¡Entendido! Responderé de forma 100% humana y hablada en español de España con explicaciones ricas.' }] }
                ];

                if (history && history.length > 0) {
                    for (const h of history.slice(-4)) {
                        contents.push({
                            role: h.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: h.content }]
                        });
                    }
                }

                contents.push({ role: 'user', parts: [{ text: userPrompt }] });

                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents,
                        generationConfig: {
                            maxOutputTokens: 220,
                            temperature: 0.85
                        }
                    }),
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text && text.trim().length > 0) {
                        return text.trim();
                    }
                }
            } catch (e) { }
        }
    }

    // Respuesta inteligente contextual
    if (cleanInput.length > 5) {
        return `¡Entendido crack! Pues sobre "${cleanInput.substring(0, 35)}", la clave en Spain RP es mantener siempre la máxima inmersión y respetar el rol de todos los compañeros en la ciudad. ¡Dime si quieres que profundicemos en algún concepto en particular!`;
    }

    return `¡Te escucho perfectamente crack! Pregúntame sobre cualquier normativa como valorar vida, PG, MG o VDM y te lo explico con todo detalle.`;
}

// Reproducir audio TTS de alta fidelidad y velocidad natural directamente en el canal de voz
function playTtsResponseInVoice(text, connection, player) {
    return new Promise(async (resolve) => {
        if (!text || !connection || !player) return resolve();
        try {
            const cleanText = text.replace(/[*_~`#"]/g, '').trim().substring(0, 1000);
            if (!cleanText) return resolve();

            // 1. Voz Neuronal de Microsoft (Álvaro - Hombre Español natural con entonación humana y velocidad perfecta)
            try {
                const { EdgeTTS } = require('node-edge-tts');
                const tempFile = path.join(__dirname, `tts_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
                const tts = new EdgeTTS({
                    voice: 'es-ES-AlvaroNeural',
                    rate: '+15%', // Velocidad humana óptima (ágil, dinámica y sin lentitud)
                    pitch: '+1Hz', // Matiz tonal más cercano y expresivo
                    volume: '+0%'
                });

                await tts.ttsPromise(cleanText, tempFile);

                if (fs.existsSync(tempFile)) {
                    const resource = createAudioResource(fs.createReadStream(tempFile), {
                        inputType: StreamType.Arbitrary
                    });

                    let resolved = false;
                    const cleanupTempFile = () => {
                        try {
                            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                        } catch (e) { }
                    };

                    const onIdle = () => {
                        if (!resolved) {
                            resolved = true;
                            player.off(AudioPlayerStatus.Idle, onIdle);
                            setTimeout(cleanupTempFile, 1500);
                            resolve();
                        }
                    };

                    player.on(AudioPlayerStatus.Idle, onIdle);
                    player.play(resource);
                    console.log(`🔊 [VOZ NEURONAL ÁLVARO] Reproduciendo (${cleanText.substring(0, 60)}...)...`);

                    // Seguridad por si el evento Idle no salta
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            player.off(AudioPlayerStatus.Idle, onIdle);
                            cleanupTempFile();
                            resolve();
                        }
                    }, 35000);
                    return;
                }
            } catch (edgeErr) {
                console.error('Edge TTS error, usando fallback:', edgeErr.message);
            }

            // 2. Fallback con Google TTS
            const base64Audio = await googleTTS.getAudioBase64(cleanText.substring(0, 200), {
                lang: 'es',
                slow: false,
                timeout: 6000
            });

            const audioBuffer = Buffer.from(base64Audio, 'base64');
            const audioStream = Readable.from(audioBuffer);
            const resource = createAudioResource(audioStream, {
                inputType: StreamType.Arbitrary
            });

            player.play(resource);
            console.log(`🔊 [VOZ TTS] Reproduciendo respuesta de voz...`);
            setTimeout(resolve, 8000);
        } catch (err) {
            console.error('Error al reproducir TTS:', err.message);
            resolve();
        }
    });
}

// Control de procesos de música en streaming y colas activas
const activeMusicStreams = new Map();
const activeMusicQueues = new Map();

// Obtener o crear cola para un servidor
function getMusicQueue(guildId) {
    if (!activeMusicQueues.has(guildId)) {
        activeMusicQueues.set(guildId, {
            songs: [],
            isPlaying: false,
            textChannel: null,
            player: null,
            connection: null,
            lastNowPlayingMsg: null
        });
    }
    return activeMusicQueues.get(guildId);
}

// Función helper para obtener título y metadatos reales de YouTube
async function fetchYouTubeMetadata(target) {
    return new Promise((resolve) => {
        try {
            console.log(`🔎 [METADATOS YT] Obteniendo info de: "${target}"...`);
            const localBinary = path.join(__dirname, 'yt-dlp');
            let ytdlpBin = 'yt-dlp';
            let ytdlpArgs = [];

            if (fs.existsSync(localBinary)) {
                ytdlpBin = localBinary;
            } else if (process.platform === 'win32') {
                ytdlpBin = 'python';
                ytdlpArgs = ['-m', 'yt_dlp'];
            } else {
                ytdlpBin = 'python3';
                ytdlpArgs = ['-m', 'yt_dlp'];
            }

            const proc = spawn(ytdlpBin, [
                ...ytdlpArgs,
                '--extractor-args', 'youtube:player_client=android,ios,web',
                '--default-search', 'ytsearch1',
                '--no-playlist',
                '--print', '%(title)s|||%(duration_string)s|||%(uploader)s|||%(thumbnail)s|||%(webpage_url)s',
                target
            ]);
            let out = '';
            proc.stdout.on('data', d => out += d);
            proc.stderr.on('data', d => {
                const errStr = d.toString().trim();
                if (errStr && !errStr.includes('WARNING')) {
                    console.log(`⚠️ [YT-DLP INFO] ${errStr.substring(0, 100)}`);
                }
            });
            proc.on('close', (code) => {
                const parts = out.trim().split('|||');
                if (parts.length >= 2 && parts[0].trim()) {
                    const metaObj = {
                        title: parts[0].trim(),
                        duration: parts[1] ? parts[1].trim() : 'En directo',
                        uploader: parts[2] ? parts[2].trim() : 'YouTube',
                        thumbnail: parts[3] ? parts[3].trim() : null,
                        url: parts[4] ? parts[4].trim() : null
                    };
                    console.log(`✅ [METADATOS YT] Título: "${metaObj.title}" | Duración: ${metaObj.duration} | Canal: ${metaObj.uploader}`);
                    resolve(metaObj);
                } else {
                    console.log(`ℹ️ [METADATOS YT] Fallback a título directo: "${target}"`);
                    resolve({ title: target, duration: 'N/A', uploader: 'YouTube', thumbnail: null, url: null });
                }
            });
            setTimeout(() => {
                console.log(`⏱️ [METADATOS YT] Timeout superado, usando título directo.`);
                resolve({ title: target, duration: 'N/A', uploader: 'YouTube', thumbnail: null, url: null });
            }, 6000);
        } catch (e) {
            console.error('❌ [ERROR METADATOS YT]:', e.message);
            resolve({ title: target, duration: 'N/A', uploader: 'YouTube', thumbnail: null, url: null });
        }
    });
}

// Reproducir la siguiente canción en la cola
async function playNextInQueue(guildId) {
    const queue = activeMusicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) {
        if (queue) {
            queue.isPlaying = false;
            if (queue.lastNowPlayingMsg) {
                queue.lastNowPlayingMsg.delete().catch(() => { });
                queue.lastNowPlayingMsg = null;
            }
        }
        console.log(`⏹️ [COLA MÚSICA] Cola vacía en servidor: ${guildId}`);
        return;
    }

    const currentSong = queue.songs[0];
    queue.isPlaying = true;

    console.log(`📋 [COLA MÚSICA] Reproduciendo siguiente tema: "${currentSong.query}" (Restantes en cola: ${queue.songs.length - 1})`);

    // Obtener metadatos reales de YouTube para el Embed
    let meta = currentSong.meta;
    if (!meta) {
        meta = await fetchYouTubeMetadata(currentSong.cleanTarget || currentSong.query);
        currentSong.meta = meta;
    }

    const res = await playMusicInVoice(currentSong.cleanTarget || currentSong.query, queue.connection, queue.player, guildId);
    if (res && res.success) {
        if (queue.textChannel) {
            // Eliminar contenedor de la canción anterior si existía para mantener el chat limpio
            if (queue.lastNowPlayingMsg) {
                queue.lastNowPlayingMsg.delete().catch(() => { });
                queue.lastNowPlayingMsg = null;
            }

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const musicEmbed = new EmbedBuilder()
                .setColor(0x8A2BE2) // Morado / Violeta Eléctrico Premium
                .setAuthor({
                    name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setTitle(`🎶 ${meta.title || currentSong.query}`)
                .setDescription(
                    `👤 **Pedida por:** ${currentSong.requester}\n` +
                    `⏱️ **Duración:** \`${meta.duration}\`\n` +
                    `📺 **Canal:** \`${meta.uploader}\`\n` +
                    `📑 **En Cola:** \`${queue.songs.length - 1} canciones restantes\``
                )
                .setFooter({ text: 'SPAIN RP Music • Usa !skip para saltar | !stop para detener' })
                .setTimestamp();

            if (meta.url) {
                musicEmbed.setURL(meta.url);
            }
            if (meta.thumbnail) {
                musicEmbed.setThumbnail(meta.thumbnail);
            }

            queue.lastNowPlayingMsg = await queue.textChannel.send({ embeds: [musicEmbed], files }).catch((err) => {
                console.error('❌ [ERROR ENVIAR EMBED REPRODUCCIÓN]:', err.message);
                return null;
            });
            console.log(`✅ [EMBED ENVIADO] Contenedor de reproducción publicado en canal.`);
        }
    } else {
        console.error(`❌ [FALLO REPRODUCCIÓN]: No se pudo reproducir "${currentSong.query}". Mensaje: ${res?.message}`);
        if (queue.textChannel) {
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const errEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setAuthor({
                    name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setDescription(`❌ **No se pudo reproducir:** \`${currentSong.query}\`\n⏭️ *Saltando al siguiente tema en cola...*`);

            queue.textChannel.send({ embeds: [errEmbed], files })
                .then(m => setTimeout(() => m.delete().catch(() => { }), 3500))
                .catch(() => { });
        }
        queue.songs.shift();
        playNextInQueue(guildId);
    }
}

// Actualizar dinámicamente el Embed de la canción en reproducción (contador de cola en tiempo real)
async function updateNowPlayingEmbed(guildId) {
    const queue = activeMusicQueues.get(guildId);
    if (!queue || !queue.lastNowPlayingMsg || queue.songs.length === 0) return;

    const currentSong = queue.songs[0];
    const meta = currentSong.meta || { title: currentSong.query, duration: 'N/A', uploader: 'YouTube' };
    const remainingCount = Math.max(0, queue.songs.length - 1);

    const logoPath = path.join(__dirname, 'assets', 'logo.png');

    const musicEmbed = new EmbedBuilder()
        .setColor(0x8A2BE2) // Morado / Violeta Eléctrico Premium
        .setAuthor({
            name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTitle(`🎶 ${meta.title || currentSong.query}`)
        .setDescription(
            `👤 **Pedida por:** ${currentSong.requester}\n` +
            `⏱️ **Duración:** \`${meta.duration}\`\n` +
            `📺 **Canal:** \`${meta.uploader}\`\n` +
            `📑 **En Cola:** \`${remainingCount} canciones restantes\``
        )
        .setFooter({ text: 'SPAIN RP Music • Usa !skip para saltar | !stop para detener' })
        .setTimestamp();

    if (meta.url) musicEmbed.setURL(meta.url);
    if (meta.thumbnail) musicEmbed.setThumbnail(meta.thumbnail);

    await queue.lastNowPlayingMsg.edit({ embeds: [musicEmbed] }).catch((e) => {
        console.error('⚠️ [ERROR EDITAR EMBED EN COLA]:', e.message);
    });
    console.log(`📝 [EMBED EDITADO] Contenedor actualizado: ${remainingCount} canciones en cola`);
}

// Reproducir música o canciones en streaming en el canal de voz usando yt-dlp & FFmpeg
async function playMusicInVoice(query, connection, player, guildId) {
    return new Promise(async (resolve) => {
        try {
            // Detener cualquier proceso de música anterior en este servidor
            if (guildId && activeMusicStreams.has(guildId)) {
                const prev = activeMusicStreams.get(guildId);
                try { if (prev.ytdlp) prev.ytdlp.kill(); } catch (e) { }
                try { if (prev.ffmpeg) prev.ffmpeg.kill(); } catch (e) { }
                activeMusicStreams.delete(guildId);
            }

            let cleanTarget = query.trim();
            const isUrl = cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://');

            if (isUrl) {
                // Si es un enlace de YouTube, quitar parámetros de listas de reproducción para reproducir el vídeo individual
                if (cleanTarget.includes('youtube.com/watch') || cleanTarget.includes('youtu.be/')) {
                    cleanTarget = cleanTarget.split('&')[0];
                }
            } else {
                cleanTarget = cleanTarget.replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ').trim();
            }

            console.log(`🎵 [MÚSICA] Iniciando yt-dlp y FFmpeg para: "${cleanTarget}"...`);

            // Extraer el stream de audio directo mediante yt-dlp (Soporte 100% oficial y actualizado)
            const localBinary = path.join(__dirname, 'yt-dlp');
            let ytdlpBin = 'yt-dlp';
            let ytdlpArgs = [];

            if (fs.existsSync(localBinary)) {
                ytdlpBin = localBinary;
            } else if (process.platform === 'win32') {
                ytdlpBin = 'python';
                ytdlpArgs = ['-m', 'yt_dlp'];
            } else {
                ytdlpBin = 'python3';
                ytdlpArgs = ['-m', 'yt_dlp'];
            }

            const ytdlpProcess = spawn(ytdlpBin, [
                ...ytdlpArgs,
                '--extractor-args', 'youtube:player_client=android,ios,web',
                '--no-progress',
                '-f', 'ba/b',
                '--default-search', 'ytsearch1',
                '--no-playlist',
                '-o', '-',
                cleanTarget
            ]);

            const ffmpegProcess = spawn(ffmpegStatic, [
                '-i', 'pipe:0',
                '-analyzeduration', '0',
                '-loglevel', '0',
                '-f', 's16le',
                '-ar', '48000',
                '-ac', '2',
                'pipe:1'
            ]);

            if (guildId) {
                activeMusicStreams.set(guildId, { ytdlp: ytdlpProcess, ffmpeg: ffmpegProcess });
            }

            ytdlpProcess.stdout.pipe(ffmpegProcess.stdin);

            ffmpegProcess.stdin.on('error', () => { });
            ytdlpProcess.stdin.on('error', () => { });
            ytdlpProcess.stderr.on('data', (d) => {
                const msg = d.toString().trim();
                // Ocultar mensajes normales de porcentaje y avisos internos de YouTube
                if (msg && !msg.includes('WARNING') && !msg.includes('[download]') && !msg.includes('[youtube]') && !msg.includes('[info]')) {
                    console.log(`⚠️ [YT-DLP]: ${msg.substring(0, 100)}`);
                }
            });

            let streamStarted = false;
            ffmpegProcess.stdout.once('data', () => {
                streamStarted = true;
                const resource = createAudioResource(ffmpegProcess.stdout, {
                    inputType: StreamType.Raw
                });
                player.play(resource);
                console.log(`▶️ [MÚSICA REPRODUCIENDO] Stream de audio iniciado correctamente: "${cleanTarget}"`);
                resolve({ success: true, title: cleanTarget });
            });

            setTimeout(() => {
                if (!streamStarted) {
                    try { ytdlpProcess.kill(); } catch (e) { }
                    try { ffmpegProcess.kill(); } catch (e) { }
                    console.error(`⏱️ [MÚSICA TIMEOUT] No se recibió audio de YouTube tras 12s para: "${cleanTarget}"`);
                    resolve({ success: false, message: 'No se pudo cargar la canción en este momento.' });
                }
            }, 12000);

            ytdlpProcess.on('error', (err) => {
                console.error('❌ [ERROR PROCESO YT-DLP]:', err.message);
                if (!streamStarted) resolve({ success: false, message: 'Hubo un error al buscar la canción en YouTube.' });
            });
        } catch (err) {
            console.error('❌ [ERROR GENERAL STREAM MÚSICA]:', err);
            resolve({ success: false, message: 'Hubo un error al procesar el audio de YouTube.' });
        }
    });
}

// Evaluación de Calidad de Respuestas Orales
function evaluateVoiceInterviewContent(transcripts) {
    const fullText = transcripts.join(' ');
    const lower = fullText.toLowerCase();
    const words = fullText.split(/\s+/).filter(w => w.length > 0);

    // Detección de conceptos clave de rol y FiveM en la entrevista oral
    const conceptsFound = [];
    if (/\b(valorar|valoracion|valoro|vida|arma|apuntan|miedo)\b/i.test(lower)) conceptsFound.push('Valoración de Vida');
    if (/\b(ic|ooc|in character|out of character)\b/i.test(lower)) conceptsFound.push('Canales IC / OOC');
    if (/\b(entorno|llamar|policia|madero|denunciar|testigo)\b/i.test(lower)) conceptsFound.push('Rol de Entorno');
    if (/\b(pk|ck|muerte|memoria|olvidar|perdida)\b/i.test(lower)) conceptsFound.push('Concepto PK / CK');
    if (/\b(pg|powergaming|vdm|rdm|failrp)\b/i.test(lower)) conceptsFound.push('Normativa Anti-Rol');
    if (/\b(taller|mecanico|curro|repartidor|policia|banda|mafia)\b/i.test(lower)) conceptsFound.push('Historia / Oficio');

    let fluidezRating = '🟢 Fluida y Natural';
    if (words.length < 15) {
        fluidezRating = '🔴 Muy Escasa / Silenciosa';
    } else if (words.length < 40) {
        fluidezRating = '🟡 Breve / Respuestas cortas';
    }

    let recomendacion = '✅ Apto para ingresar (Respuestas coherentes)';
    if (conceptsFound.length < 2 && words.length < 30) {
        recomendacion = '⚠️ Dudoso / Se recomienda profundizar en preguntas';
    }

    return {
        wordCount: words.length,
        conceptsFound,
        fluidezRating,
        recomendacion,
        summaryText: fullText.length > 400 ? fullText.substring(0, 400) + '...' : fullText
    };
}

client.once(Events.ClientReady, async () => {
    try {
        console.log(`\n==================================================`);
        console.log(`🤖  SPAIN RP - SISTEMA DE WHITELIST Y AUDITORÍA  🤖`);
        console.log(`==================================================`);
        console.log(`🟢 [ESTADO]      Bot conectado como: ${client.user.tag}`);
        console.log(`👑 [CREADOR]     ID: ${OWNER_ID}`);
        console.log(`📥 [SOLICITUDES] ${botConfig.CHANNEL_SOLICITUDES_ID ? `<#${botConfig.CHANNEL_SOLICITUDES_ID}>` : 'Todos los canales'}`);
        console.log(`✅ [APROBADOS]   ${botConfig.CHANNEL_APROBADOS_ID ? `<#${botConfig.CHANNEL_APROBADOS_ID}>` : 'No configurado'}`);
        console.log(`🎙️ [ENTREVISTAS] ${botConfig.CHANNEL_ENTREVISTAS_ID ? `<#${botConfig.CHANNEL_ENTREVISTAS_ID}>` : 'No configurado'}`);
        console.log(`🎮 [FIVEM]       IP: ${botConfig.FIVEM_SERVER_IP} (CFX: ${botConfig.FIVEM_CFX_CODE})`);
        console.log(`==================================================\n`);

        // Función para actualizar la presencia del bot (siempre en estado Online 🟢)
        const updateBotPresence = async () => {
            try {
                const state = await fetchFiveMServerStatus();
                if (state && state.online) {
                    client.user.setPresence({
                        activities: [{
                            name: `${state.players}/${state.maxPlayers} Jugadores • SPAIN RP`,
                            type: ActivityType.Watching
                        }],
                        status: 'online'
                    });
                } else {
                    client.user.setPresence({
                        activities: [{
                            name: 'SPAIN RP 🇪🇸',
                            type: ActivityType.Playing
                        }],
                        status: 'online'
                    });
                }
            } catch (err) {
                client.user.setPresence({
                    activities: [{
                        name: 'SPAIN RP 🇪🇸',
                        type: ActivityType.Playing
                    }],
                    status: 'online'
                });
            }
        };

        // 1. Actualización inicial de presencia (en segundo plano)
        updateBotPresence().catch(() => { });

        // 2. Comprobar y actualizar jugadores cada 15 segundos
        setInterval(updateBotPresence, 15000);

        // 3. Actualizar el panel del canal cada 60 segundos
        if (botConfig.CHANNEL_STATUS_ID) {
            updateChannelStatusPanel().catch(() => { });
            setInterval(() => updateChannelStatusPanel().catch(() => { }), 60000);
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

        // 6. Auto-Sincronización inicial del canal de valoraciones con el panel de Tops
        setTimeout(async () => {
            try {
                console.log('⭐ [AUTO-SYNC] Ejecutando sincronización automática inicial de valoraciones y panel de Tops...');
                await syncStaffRatingsFromChannel();
            } catch (e) {
                console.error('Error en sync inicial de valoraciones:', e);
            }
        }, 5000);
    } catch (readyErr) {
        console.error('❌ Error en evento Ready:', readyErr);
    }
});

// Función de Auto-Calibración que lee el historial real de solicitudes en el canal (100 formularios recientes)
async function autoBootstrapChannelHistory() {
    try {
        const channelId = botConfig.CHANNEL_SOLICITUDES_ID || '1517530849661288455';
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        console.log(`🧠 [AUTO-CALIBRACIÓN] Escaneando las 100 WLs más recientes en #${channel.name} (${channelId})...`);

        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages || messages.size === 0) return;

        const allMessages = Array.from(messages.values());

        let learned = 0;
        for (const msg of allMessages) {
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
                const formKey = `${msg.id}_${decision}`;

                const currentAiData = getAiFeedbackData();
                if (currentAiData.processedFormIds && currentAiData.processedFormIds[formKey]) {
                    continue; // Ya aprendida previamente, no duplicar
                }

                registerFeedbackOutcome(userKey, decision, fullMsgText, false, formKey);
                learned++;
            }
        }

        const data = getAiFeedbackData();
        rebuildContrastivePatterns(data);
        saveAiFeedbackData(data);
        console.log(`✅ [AUTO-CALIBRACIÓN COMPLETADA] Formularios nuevos procesados: ${learned} de ${allMessages.length} leídos | Total en base: ${data.totalSamples || 0} | Clichés IA: ${Object.keys(data.learnedClichés || {}).length} | Patrones humanos: ${Object.keys(data.learnedHumanPatterns || {}).length}`);
    } catch (e) {
        console.error('⚠️ Error en autoBootstrapChannelHistory:', e.message);
    }
}

// ==========================================
// 3. FUNCIONES PARA ENVIAR NOTIFICACIONES
// ==========================================

async function sendApprovedNotification({ userMention, staffName = 'Equipo de Staff' }) {
    const targetChannelId = botConfig.CHANNEL_APROBADOS_ID || '1550880724930797610';
    const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
        console.error(`❌ [ERROR CANAL] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
        return null;
    });

    if (!targetChannel) {
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
            name: 'SISTEMA DE WHITELIST | SPAIN RP',
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
    const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
        console.error(`❌ [ERROR CANAL] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
        return null;
    });

    if (!targetChannel) {
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
            name: 'SISTEMA DE WHITELIST | SPAIN RP',
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
    const imgTiktokPath = path.join(__dirname, 'assets', 'tiktok.png');
    const imgKickPath = path.join(__dirname, 'assets', 'kick.png');
    const imgTwitchPath = path.join(__dirname, 'assets', 'stream.png');
    const files = [];

    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }

    const normPlatform = (platform || 'Twitch').toLowerCase();
    const isKick = normPlatform.includes('kick') || (streamUrl && streamUrl.includes('kick.com'));
    const isTikTok = !isKick && (normPlatform.includes('tiktok') || (streamUrl && streamUrl.includes('tiktok.com')));
    const isTwitch = !isKick && !isTikTok;

    // Adjuntar banner según plataforma (Kick: kick.png | TikTok: tiktok.png | Twitch: stream.png | General: directo.png)
    if (isKick && fs.existsSync(imgKickPath)) {
        files.push(new AttachmentBuilder(imgKickPath, { name: 'kick.png' }));
    } else if (isTikTok && fs.existsSync(imgTiktokPath)) {
        files.push(new AttachmentBuilder(imgTiktokPath, { name: 'tiktok.png' }));
    } else if (isTwitch && fs.existsSync(imgTwitchPath)) {
        files.push(new AttachmentBuilder(imgTwitchPath, { name: 'twitch.png' }));
    } else if (fs.existsSync(imgDirectoPath)) {
        files.push(new AttachmentBuilder(imgDirectoPath, { name: 'directo.png' }));
    }

    // Configuración visual por plataforma (Kick: Verde Neón | TikTok: Rosa Fucsia | Twitch: Morado)
    const platformColor = isKick ? 0x53FC18 : (isTikTok ? 0xFE2C55 : 0x9146FF);
    const platformEmoji = isKick ? '🟢' : (isTikTok ? '🌸' : '🟣');
    const platformName = isKick ? 'Kick' : (isTikTok ? 'TikTok LIVE' : 'Twitch');
    const platformButtonLabel = isKick ? '🟢 Ver Directo en Kick' : (isTikTok ? '🌸 Ver TikTok LIVE' : '🟣 Ver Directo en Twitch');
    const notificationHeadline = isKick
        ? `# 🟢 ¡${userMention} ESTÁ EN DIRECTO EN KICK!\n# ¡Entra a apoyar el stream en SPAIN RP!`
        : (isTikTok
            ? `# 🌸 ¡${userMention} ESTÁ EN DIRECTO EN TIKTOK!\n# ¡Entra al LIVE y apoya el stream en SPAIN RP!`
            : `# 🟣 ¡${userMention} ESTÁ EN DIRECTO EN TWITCH!\n# ¡Entra a apoyar el stream en SPAIN RP!`);

    const cleanTitle = streamTitle && streamTitle.trim() ? streamTitle.trim() : `Roleplay en vivo en SPAIN RP 🇪🇸 (${platformName})`;
    const validStreamUrl = streamUrl.startsWith('http') ? streamUrl : `https://${streamUrl}`;

    // Canales oficiales interactivos (<#ID>)
    const canalGeneral = `<#${process.env.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    const embedStream = new EmbedBuilder()
        .setColor(platformColor)
        .setAuthor({
            name: `SISTEMA DE DIRECTOS | SPAIN RP 🇪🇸 • ${platformName}`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(avatarUrl || (fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()))
        .setTitle(`${platformEmoji} ¡CREADOR EN DIRECTO EN ${platformName.toUpperCase()}!`)
        .setDescription(
            `\u200B\n` +
            `✨ ¡El creador de contenido **${userMention}** acaba de iniciar transmisión en vivo en **SPAIN RP** 🇪🇸!\n\n` +
            `🎮 **Título de la Transmisión:**\n` +
            `> 💬 *"${cleanTitle}"*\n\n` +
            `📺 **Plataforma:** \`${platformName}\`\n` +
            `🏙️ **Servidor:** **SPAIN RP** 🇪🇸\n\n` +
            `🔗 **| Entra al directo a dejar tu apoyo y follow:**\n` +
            `> ${validStreamUrl} ❗\n\n` +
            `🌍 **| Comenta el directo en la comunidad:**\n` +
            `> ${canalGeneral} ❗\n\n` +
            `🇪🇸 **| ¡Disfruta del mejor Roleplay en SPAIN RP! |** 🇪🇸\n\n` +
            `👤 **Streamer:** ${userMention}`
        )
        .setFooter({
            text: `SPAIN RP • Creadores de Contenido Oficiales (${platformName})`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (isKick && fs.existsSync(imgKickPath)) {
        embedStream.setImage('attachment://kick.png');
    } else if (isTikTok && fs.existsSync(imgTiktokPath)) {
        embedStream.setImage('attachment://tiktok.png');
    } else if (isTwitch && fs.existsSync(imgTwitchPath)) {
        embedStream.setImage('attachment://twitch.png');
    } else if (fs.existsSync(imgDirectoPath)) {
        embedStream.setImage('attachment://directo.png');
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(platformButtonLabel)
            .setStyle(ButtonStyle.Link)
            .setURL(validStreamUrl),
        new ButtonBuilder()
            .setLabel('🚀 Conectar a SPAIN RP')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://cfx.re/join/${botConfig.FIVEM_CFX_CODE}`)
    );

    try {
        const sentMsg = await targetChannel.send({
            content: notificationHeadline,
            embeds: [embedStream],
            components: [row],
            files: files
        });

        console.log(`[DIRECTO NOTIFICADO] Stream en ${platformName} publicado para ${userMention} en canal #${targetChannel.name} (${targetChannelId})`);
        return { success: true, channelId: targetChannelId, messageId: sentMsg.id };
    } catch (sendErr) {
        console.error(`❌ [ERROR PERMISOS EN CANAL DIRECTOS #${targetChannel.name}]:`, sendErr.message);
        if (sendErr.code === 50013) {
            console.error(`⚠️ El bot carece de permisos de "Enviar Mensajes", "Insertar Enlaces" o "Adjuntar Archivos" en el canal #${targetChannel.name} (${targetChannelId}). Revisa los permisos de rol del bot en Discord.`);
        }
        return { success: false, error: sendErr.message };
    }
}

// ==========================================
// CONSTRUCTORES: SISTEMA DE BIENVENIDAS OFICIALES (SPAIN RP)
// ==========================================
function buildWelcomeEmbed(member, guild) {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const bannerPath = path.join(__dirname, 'assets', 'banner_bienvenida.png');
    const files = [];

    let iconURL = client.user.displayAvatarURL();
    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
        iconURL = 'attachment://logo.png';
    }

    const user = member.user || member;
    const memberCount = guild?.memberCount || 0;
    const accountCreatedTimestamp = Math.floor(user.createdTimestamp / 1000);

    const canalNormativas = botConfig.CHANNEL_NORMATIVAS_ID ? `<#${botConfig.CHANNEL_NORMATIVAS_ID}>` : '`#normativas`';
    const canalSolicitudes = botConfig.CHANNEL_SOLICITUDES_ID ? `<#${botConfig.CHANNEL_SOLICITUDES_ID}>` : '`#solicitudes`';
    const canalTickets = botConfig.CHANNEL_TICKETS_ID ? `<#${botConfig.CHANNEL_TICKETS_ID}>` : '`#tickets`';
    const canalGeneral = botConfig.CHANNEL_GENERAL_ID ? `<#${botConfig.CHANNEL_GENERAL_ID}>` : '`#general`';

    const welcomeEmbed = new EmbedBuilder()
        .setColor(0xE74C3C) // Rojo carmesí España / Spain RP
        .setAuthor({
            name: '¡TE DAMOS LA BIENVENIDA A SPAIN RP!',
            iconURL: 'attachment://logo.png'
        })
        .setThumbnail('attachment://logo.png')
        .setDescription(
            `\u200B\n` +
            `➥ 𝗘𝘀𝗽𝗲𝗿𝗮𝗺𝗼𝘀 𝗾𝘂𝗲 𝗱𝗶𝘀𝗳𝗿𝘂𝘁𝗲𝘀 𝗱𝗲 𝗻𝘂𝗲𝘀𝘁𝗿𝗮 𝗰𝗼𝗺𝘂𝗻𝗶𝗱𝗮𝗱, 𝘁𝗼𝗱𝗼 𝗹𝗼 𝗾𝘂𝗲 𝗻𝗲𝗰𝗲𝘀𝗶𝘁𝗲𝘀 𝘀𝗮𝗯𝗲𝗿 𝗹𝗼 𝘁𝗲𝗻𝗱𝗿𝗮́𝘀 𝗲𝗻 𝗹𝗼𝘀 𝗿𝗲𝘀𝗽𝗲𝗰𝘁𝗶𝘃𝗼𝘀 𝗰𝗮𝗻𝗮𝗹𝗲𝘀 𝗰𝗼𝗿𝗿𝗲𝘀𝗽𝗼𝗻𝗱𝗶𝗲𝗻𝘁𝗲𝘀 ❗\n\n` +
            `👤 **Usuario:** <@${user.id}>\n` +
            `👥 **Miembro Nº:** \`#${memberCount}\` ciudadanos\n` +
            `📅 **Cuenta Creada:** <t:${accountCreatedTimestamp}:R>\n\n\n` +
            `📝 **| Puedes consultar nuestras,**\n` +
            `> ${canalNormativas} ❗\n\n` +
            `📋 **| Puedes realizar tu Whitelist en,**\n` +
            `> ${canalSolicitudes} ❗\n\n` +
            `📁 **| Si tienes alguna duda abre,**\n` +
            `> ${canalTickets} ❗\n\n` +
            `🌍 **| Disfruta y diviértete en,**\n` +
            `> ${canalGeneral} ❗\n\n\n` +
            `🇪🇸 **| ¡Disfruta de SPAIN RP! |** 🇪🇸\n`
        )
        .setFooter({
            text: 'SPAIN RP • Sistema de Bienvenidas',
            iconURL: iconURL
        })
        .setTimestamp();

    if (fs.existsSync(bannerPath)) {
        files.push(new AttachmentBuilder(bannerPath, { name: 'banner_bienvenida.png' }));
        welcomeEmbed.setImage('attachment://banner_bienvenida.png');
    }

    return { welcomeEmbed, files };
}

async function sendWelcomeMessage(member) {
    try {
        const guild = member.guild;
        const targetChannelId = botConfig.CHANNEL_BIENVENIDAS_ID;
        if (!targetChannelId) return;

        const targetChannel = guild.channels.cache.get(targetChannelId) ||
            await client.channels.fetch(targetChannelId).catch(() => null);

        if (!targetChannel) {
            console.error(`⚠️ [BIENVENIDAS] No se encontró el canal de bienvenidas (${targetChannelId}).`);
            return;
        }

        const { welcomeEmbed, files } = buildWelcomeEmbed(member, guild);

        await targetChannel.send({
            content: `❗ **Bienvenid@,** <@${member.id}> ❗`,
            embeds: [welcomeEmbed],
            files: files
        });

        console.log(`✨ [BIENVENIDA] Notificación de bienvenida enviada para ${member.user?.tag || member.id} en #${targetChannel.name}`);
    } catch (err) {
        console.error('❌ [BIENVENIDAS] Error al enviar mensaje de bienvenida:', err);
    }
}

// ==========================================
// CONSTRUCTORES: SISTEMA DE VALORACIÓN DE STAFF (MODO CONTENEDOR)
// ==========================================
function buildStaffTopRankingEmbed() {
    const ratingsData = getStaffRatingsData();
    const stats = ratingsData.stats || {};
    const staffList = Object.keys(stats).map(id => ({ id, ...stats[id] }));

    // Ordenar por promedio y luego por cantidad de valoraciones
    staffList.sort((a, b) => b.average - a.average || b.totalRatings - a.totalRatings);

    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const topsBannerPath = path.join(__dirname, 'assets', 'panel_tops.png');
    const files = [];
    if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    if (fs.existsSync(topsBannerPath)) files.push(new AttachmentBuilder(topsBannerPath, { name: 'panel_tops.png' }));

    let desc = '';
    if (staffList.length === 0) {
        desc = `\u200B\n📭 *Todavía no se han registrado valoraciones de Staff en el servidor.*`;
    } else {
        desc = `\u200B\n`;
        staffList.slice(0, 10).forEach((s, idx) => {
            const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `\`#${idx + 1}\``));
            desc += `${medal} <@${s.id}> • **${s.average}/10** ⭐\n\n` +
                `> 💬 **Reseñas:** \`${s.totalRatings}\` votos recibidos\n\n` +
                `────────────────────────────\n\n`;
        });
        // Quitar la última línea divisoria si termina en ella
        desc = desc.replace(/\n\n────────[^\n]*\n\n$/, '');
    }

    const topEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setAuthor({
            name: 'RANKING DE ATENCIÓN DE STAFF • SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle('🏆 Top Miembros del Equipo con Mejor Calificación')
        .setDescription(desc)
        .setFooter({ text: 'SPAIN RP • Actualizado automáticamente en tiempo real' })
        .setTimestamp();

    if (fs.existsSync(topsBannerPath)) {
        topEmbed.setImage('attachment://panel_tops.png');
    }

    return { topEmbed, files };
}

async function updateStaffTopRankingPanel() {
    try {
        const channelId = botConfig.CHANNEL_VALORACION_PANEL_ID;
        if (!channelId) return false;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return false;

        let targetMessage = null;
        if (botConfig.MESSAGE_TOP_STAFF_ID) {
            targetMessage = await channel.messages.fetch(botConfig.MESSAGE_TOP_STAFF_ID).catch(() => null);
        }

        // Si no se encuentra por ID guardada, buscar activamente en los mensajes del canal
        if (!targetMessage) {
            const fetched = await channel.messages.fetch({ limit: 25 }).catch(() => null);
            if (fetched) {
                targetMessage = fetched.find(m =>
                    m.author.id === client.user.id &&
                    m.embeds.some(e =>
                        (e.title && e.title.includes('Top Miembros del Equipo')) ||
                        (e.author?.name && e.author.name.includes('RANKING DE ATENCIÓN DE STAFF'))
                    )
                );
                if (targetMessage) {
                    updateConfig('MESSAGE_TOP_STAFF_ID', targetMessage.id);
                }
            }
        }

        if (!targetMessage) return false;

        const { topEmbed } = buildStaffTopRankingEmbed();
        await targetMessage.edit({ embeds: [topEmbed] }).catch(() => { });
        console.log(`🏆 [RANKING AUTO-UPDATE] Mensaje de Top Staff (${targetMessage.id}) en #${channel.name} actualizado con éxito.`);
        return true;
    } catch (e) {
        console.error('Error al actualizar panel de top staff:', e);
        return false;
    }
}

function buildStaffRatingPanelEmbed() {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const panelImgPath = path.join(__dirname, 'assets', 'panel_valoracion.png');

    const canalPublicacion = botConfig.CHANNEL_VALORACIONES_ID ? `<#${botConfig.CHANNEL_VALORACIONES_ID}>` : '`No configurado`';

    const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // Oro / Amarillo VIP
        .setAuthor({
            name: 'SISTEMA DE VALORACIONES • SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle('⭐ ¿CÓMO FUE TU EXPERIENCIA CON EL EQUIPO DE STAFF?')
        .setDescription(
            `\u200B\n` +
            `¡Bienvenido al sistema oficial de **Calidad y Atención al Usuario** de **SPAIN RP**!\n\n` +
            `Tu opinión es fundamental para seguir mejorando nuestro servidor. Si has recibido atención en soporte, tickets, reportes o dudas, puedes valorar la labor del Staff que te atendió.\n\n` +
            `📋 **¿Cómo valorar a un Staff?**\n` +
            `> 1️⃣ Haz clic en el botón **"⭐ Valorar a un Staff"** aquí abajo.\n` +
            `> 2️⃣ Elige al **Staff** en el menú desplegable con su nombre y foto.\n` +
            `> 3️⃣ Asigna tu puntuación del **1 al 10**.\n` +
            `> 4️⃣ Cuéntanos tu experiencia o comentario sobre la atención recibida.\n\n` +
            `📢 **Canal de publicación de valoraciones:**\n` +
            `> Las valoraciones se enviarán automáticamente a ${canalPublicacion} ❗\n\n` +
            `🇪🇸 **¡Gracias por ayudar a SPAIN RP!** 🇪🇸`
        )
        .setFooter({
            text: 'SPAIN RP • Departamento de Calidad y Atención al Usuario',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(panelImgPath)) {
        embed.setImage('attachment://panel_valoracion.png');
    }

    return embed;
}

function buildStaffRatingPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_abrir_valoracion_staff')
            .setLabel('⭐ Valorar a un Staff')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝')
    );
}

function buildStaffRatingCardEmbed({ userMention, userAvatar, staffMention, staffName, rating, comment, average, totalRatings }) {
    const numRating = Number(rating);
    const fullStars = Math.min(Math.max(Math.round(numRating / 2), 1), 5);
    const starString = '⭐'.repeat(fullStars) + '☆'.repeat(5 - fullStars);

    // Color del contenedor según la nota
    let embedColor = 0x2ECC71; // Verde (8-10 Excelente)
    let badgeText = '🟢 ATENCIÓN DESTACADA';
    if (numRating < 5) {
        embedColor = 0xE74C3C; // Rojo (< 5 Negativa)
        badgeText = '🔴 ATENCIÓN A REVISAR';
    } else if (numRating < 8) {
        embedColor = 0xF1C40F; // Amarillo (5-7 Aceptable)
        badgeText = '🟡 ATENCIÓN CORRECTA';
    }

    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const cardImgPath = path.join(__dirname, 'assets', 'valoracion_card.png');
    const panelImgPath = path.join(__dirname, 'assets', 'panel_valoracion.png');
    const files = [];

    if (fs.existsSync(logoPath)) {
        files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
    }
    if (fs.existsSync(cardImgPath)) {
        files.push(new AttachmentBuilder(cardImgPath, { name: 'valoracion_card.png' }));
    } else if (fs.existsSync(panelImgPath)) {
        files.push(new AttachmentBuilder(panelImgPath, { name: 'valoracion_card.png' }));
    }

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({
            name: 'SISTEMA DE VALORACIONES | SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail('attachment://logo.png')
        .setTitle(badgeText)
        .setDescription(
            `\u200B\n` +
            `✨ ¡Se ha registrado una nueva valoración para el Staff ${staffMention}!\n\n` +
            `👤 **Usuario que Valora:**\n` +
            `> ${userMention} ❗\n\n` +
            `🛡️ **Miembro del Staff Evaluado:**\n` +
            `> ${staffMention} ❗\n\n` +
            `📊 **| Puntuación Otorgada:**\n` +
            `> \`${numRating}/10\` (${starString})\n\n` +
            `💬 **| Opinión y Experiencia del Usuario:**\n` +
            `> *"${comment}"*\n\n` +
            `📈 **| Estadísticas Acumuladas del Staff:**\n` +
            `> ⭐ **Promedio General:** \`${average || numRating}/10\` • 📋 **Total:** \`${totalRatings || 1}\` valoraciones\n\n` +
            `🇪🇸 **¡Gracias por ayudar a SPAIN RP!** 🇪🇸`
        )
        .setFooter({
            text: 'SPAIN RP • Opiniones y Soporte',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(cardImgPath) || fs.existsSync(panelImgPath)) {
        embed.setImage('attachment://valoracion_card.png');
    }

    return { embed, files };
}

// ==========================================
// SISTEMA DE SANCIONES Y MODERACIÓN STAFF (SPAIN RP)
// ==========================================
const SANCIONES_FILE = path.join(__dirname, 'sanciones.json');
const pendingSancionesAwaitingImage = new Map(); // staffId -> { targetId, targetTag, reason, punishment, involvedStaff, channelId, expiresAt }

function getSancionesData() {
    if (fs.existsSync(SANCIONES_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SANCIONES_FILE, 'utf8'));
        } catch (e) {
            console.error('Error al leer sanciones.json:', e);
        }
    }
    return [];
}

async function saveSancionRecord(sancionObj) {
    const data = getSancionesData();
    // Clonar y guardar solo metadatos serializables (sin Buffers de AttachmentBuilder en JSON)
    const cleanRecord = {
        id: sancionObj.id,
        reporterId: sancionObj.reporterId,
        reporterTag: sancionObj.reporterTag,
        targetId: sancionObj.targetId,
        targetTag: sancionObj.targetTag,
        reason: sancionObj.reason,
        punishment: sancionObj.punishment,
        involvedStaff: sancionObj.involvedStaff,
        imageUrl: sancionObj.imageUrl,
        videoUrl: sancionObj.videoUrl,
        channelId: sancionObj.channelId,
        timestamp: new Date().toISOString()
    };

    data.push(cleanRecord);
    try {
        if (data.length > 500) {
            data.splice(0, data.length - 500);
        }
        fs.writeFileSync(SANCIONES_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar sanciones.json:', e);
    }
    if (isMongoConnected) {
        try {
            await SancionModel.create(cleanRecord);
        } catch (e) {
            console.error('Error guardando sancion en Mongo:', e);
        }
    }
}

function buildSancionesPanelEmbed() {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const bannerPath = path.join(__dirname, 'assets', 'panel_sanciones.png');
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C) // Rojo Moderación / Sanciones
        .setAuthor({
            name: 'SISTEMA DE SANCIONES • SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle('🚨 REGISTRO OFICIAL DE SANCIONES Y SANCIONADOS')
        .setDescription(
            `Bienvenido al **Panel Oficial de Registro de Sanciones** para el equipo de Staff de **SPAIN RP** 🇪🇸.\n\n` +
            `Este canal está destinado a mantener un control estricto, transparente y unificado de todas las faltas, advertencias y expulsiones aplicadas a usuarios en la comunidad.\n\n` +
            `📋 **¿Cómo registrar una nueva sanción?**\n` +
            `> 1️⃣ Pulsa el botón **"🚨 Registrar Sanción"** aquí abajo.\n` +
            `> 2️⃣ Rellena el formulario con la **ID del sancionado**, la **sanción/escenarios** y el **motivo**.\n` +
            `> 3️⃣ Envía la(s) **captura(s) o vídeo de prueba** en el chat cuando el bot te lo solicite.\n\n` +
            `💡 *El bot detectará automáticamente tu nombre de Staff y generará el expediente oficial con formato blindado.*`
        )
        .setFooter({
            text: 'SPAIN RP • Registro Interno Exclusivo de Moderación',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(bannerPath)) {
        embed.setImage('attachment://panel_sanciones.png');
    }

    return embed;
}

function buildSancionesPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_abrir_modal_sancion')
            .setLabel('🚨 Registrar Sanción')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('📝')
    );
}

function buildSancionCardEmbed({ id, reporterId, reporterTag, targetId, targetTag, reason, punishment, involvedStaff, imageUrl, imageAttachment, mediaFiles = [], videoUrl = null }) {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const files = [];
    if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

    const reporterMention = `<@${reporterId}>`;
    const targetMention = targetId ? `<@${targetId}>` : `\`${targetTag || 'Usuario'}\``;
    const staffImplicados = involvedStaff && involvedStaff.trim() ? involvedStaff : reporterMention;

    // Espaciador invisible de ancho completo para expandir la tarjeta al 100% de anchura en Discord
    const wideSpacer = '\u3000'.repeat(38);

    // Si hay un archivo de vídeo adjunto o enlace externo
    const videoFiles = Array.isArray(mediaFiles) ? mediaFiles.filter(f => f.name.endsWith('.mp4') || f.name.endsWith('.mov') || f.name.endsWith('.webm') || f.name.endsWith('.mkv') || f.name.endsWith('.avi')) : [];
    const imageFiles = Array.isArray(mediaFiles) ? mediaFiles.filter(f => !videoFiles.includes(f)) : [];

    let videoSection = '';
    if (videoUrl) {
        videoSection = `🎥 **Vídeo / Clip de Prueba:**\n> 🔗 [Ver Grabación de Prueba](${videoUrl})\n\n`;
    }

    const galleryUrl = `https://spainrp.es/sanciones/${id || Date.now()}`;
    const mainEmbed = new EmbedBuilder()
        .setColor(0xE74C3C) // Rojo fuego moderación
        .setAuthor({
            name: 'SISTEMA DE SANCIONES • SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setURL(galleryUrl)
        .setDescription(
            `**🚨 ACTA DISCIPLINARIA • EXPEDIENTE #${id || Date.now().toString().slice(-4)}**\n\n` +
            `Este expediente certifica la resolución disciplinaria oficial aplicada dentro de la comunidad de **SPAIN RP** 🇪🇸.\n\n` +
            `👤 **| Información del Reporte y Staff:**\n` +
            `> 👮 **Quien reporta:** ${reporterMention}\n` +
            `> 🎯 **A quien se reporta:** ${targetMention}\n` +
            `> ⚖️ **Sanción / Escenarios:** \`${punishment || 'Sanción Aplicada'}\`\n` +
            `> 🛡️ **Staff implicados:** ${staffImplicados}\n\n` +
            `📝 **| Breve explicación:**\n` +
            `> ${reason || 'Sin explicación adicional'}\n\n` +
            videoSection +
            `🇪🇸 **| ¡Gracias por ayudar a SPAIN RP! |** 🇪🇸`
        )
        .setFooter({
            text: 'SPAIN RP • Registro Oficial de Moderación',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    const embeds = [mainEmbed];

    // Adjuntar las fotos directamente al contenedor del acta dentro del MISMO mensaje
    if (Array.isArray(mediaFiles) && mediaFiles.length > 0) {
        if (imageFiles.length > 0) {
            imageFiles.forEach(f => files.push(f));
            mainEmbed.setImage(`attachment://${imageFiles[0].name}`);

            if (imageFiles.length > 1) {
                // Todas las fotos comparten exactamente la misma URL para unificarse en el visor y mosaico
                for (let i = 1; i < imageFiles.length && i < 10; i++) {
                    const extraEmbed = new EmbedBuilder()
                        .setURL(galleryUrl)
                        .setImage(`attachment://${imageFiles[i].name}`);
                    embeds.push(extraEmbed);
                }
            }
        }
    } else if (imageAttachment) {
        files.push(imageAttachment);
        mainEmbed.setImage(`attachment://${imageAttachment.name}`);
    } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        mainEmbed.setImage(imageUrl);
    }

    return { embeds, embed: mainEmbed, files, videoFiles };
}

// ==========================================
// SISTEMA DE EVENTOS OFICIALES (SPAIN RP)
// ==========================================
const EVENTOS_FILE = path.join(__dirname, 'eventos.json');
const pendingEventosAwaitingImage = new Map(); // staffId -> { id, reporterId, reporterTag, title, description, hora, lugar, organiza, ping, channelId, expiresAt }

function getEventosData() {
    if (fs.existsSync(EVENTOS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(EVENTOS_FILE, 'utf8'));
        } catch (e) {
            console.error('Error al leer eventos.json:', e);
        }
    }
    return [];
}

async function saveEventoRecord(eventoObj) {
    const data = getEventosData();
    const cleanRecord = {
        id: eventoObj.id,
        reporterId: eventoObj.reporterId,
        reporterTag: eventoObj.reporterTag,
        title: eventoObj.title,
        description: eventoObj.description,
        hora: eventoObj.hora,
        lugar: eventoObj.lugar,
        organiza: eventoObj.organiza,
        ping: eventoObj.ping,
        imageUrl: eventoObj.imageUrl,
        channelId: eventoObj.channelId,
        timestamp: new Date().toISOString()
    };

    data.push(cleanRecord);
    try {
        if (data.length > 500) {
            data.splice(0, data.length - 500);
        }
        fs.writeFileSync(EVENTOS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar eventos.json:', e);
    }
    if (isMongoConnected) {
        try {
            await EventoModel.create(cleanRecord);
        } catch (e) {
            console.error('Error guardando evento en Mongo:', e);
        }
    }
}

function buildEventosPanelEmbed() {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const bannerPath = path.join(__dirname, 'assets', 'panel_eventos.png');
    const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // Amarillo Oro / Dorado vibrante
        .setAuthor({
            name: 'SISTEMA DE EVENTOS | SPAIN RP',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle('🎉 GESTIÓN Y PUBLICACIÓN OFICIAL DE EVENTOS')
        .setDescription(
            `Bienvenido al **Panel Oficial de Publicación de Eventos** para el equipo de Staff de **SPAIN RP** 🇪🇸.\n\n` +
            `Este sistema permite anunciar quedadas, exhibiciones, carreras, fiestas y eventos especiales de la ciudad con una maquetación automática y diseño prémium.\n\n` +
            `📋 **¿Cómo publicar un nuevo evento?**\n` +
            `> 1️⃣ Pulsa el botón **"📢 Publicar Evento"** aquí abajo.\n` +
            `> 2️⃣ Pega todo el **texto con la información** (el bot detectará y maquetará el título, hora, lugar, organizador y actividades automáticamente).\n` +
            `> 3️⃣ Envía el **cartel / flyer / foto** en el chat cuando el bot te lo solicite.\n\n` +
            `💡 *El bot publicará el anuncio automáticamente en los canales oficiales de eventos con mención @everyone y formato de lujo.*`
        )
        .setFooter({
            text: 'SPAIN RP • Sistema Oficial de Eventos Staff',
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(bannerPath)) {
        embed.setImage('attachment://panel_eventos.png');
    }

    return embed;
}

function buildEventosPanelRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_abrir_modal_evento')
            .setLabel('Publicar Evento')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📢')
    );
}

function buildEventoCardEmbed({ id, reporterId, reporterTag, title, description, hora, lugar, organiza, ping, imageUrl, imageAttachment, mediaFiles = [] }) {
    const logoPath = path.join(__dirname, 'assets', 'logo.png');
    const files = [];
    if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

    const canalGeneral = `<#${botConfig.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

    // Procesar y reestructurar el texto libre que introduce el Staff de forma dinámica e inteligente
    const rawText = (description || '').trim();
    let extractedTitle = (title || '').trim();
    let extractedIntro = [];
    let extractedHora = (hora || '').trim();
    let extractedLugar = (lugar || '').trim();
    let extractedOrganiza = (organiza || '').trim();
    let extractedDressCode = '';
    let extractedFecha = '';
    let extractedPremio = '';
    let extractedPoints = [];
    let extractedOutro = [];
    let eventTitleClean = extractedTitle;

    if (rawText) {
        // Sanitizar menciones como @everyone, @here o roles para que no se dupliquen dentro del texto del embed
        let sanitizedText = rawText.replace(/@(everyone|here|<@&?\d+>)/gi, '').trim();
        let lines = sanitizedText.split('\n').map(l => l.trim()).filter(Boolean);

        // Si no se proporcionó título separado, detectar si la primera línea es un encabezado/título
        if (!extractedTitle && lines.length > 0) {
            const firstLine = lines[0];
            const isTitleCandidate = /^(?:[🚗🏎️🔥🏁🇯🇵👑⚡⭐🎉🥂💃🕺🎭🏆🥊🔫💰📍📌💎🍸]|\s)*(?:QUEDADA|EXHIBICI[OÓ]N|EVENTO|CARRERA|FIESTA|TORNEO|RUTA|ROBO|BATALLA|CONCENTRACI[OÓ]N|TEQU[IÍ]\-LA\-LA|DISCOTECA|GALA|INAUGURACI[OÓ]N|NOCHE|PRESENTA|B[UÚ]SQUEDA)/i.test(firstLine) ||
                (firstLine.length < 75 && !/^(?:hora|lugar|organiza|fecha|dress|c[oó]digo|¡|¿|\-|\•|\*)/i.test(firstLine) && !firstLine.includes('...'));

            if (isTitleCandidate) {
                extractedTitle = firstLine.replace(/^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+|[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ!?]+$/gi, '').trim();
                lines = lines.slice(1);
            }
        }

        eventTitleClean = extractedTitle || 'EVENTO OFICIAL DE LA COMUNIDAD';

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Ignorar repeticiones exactas del título o líneas vacías
            const cleanLineLower = line.toLowerCase().replace(/[^a-z0-9]/g, '');
            const titleLower = eventTitleClean.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanLineLower === titleLower && cleanLineLower.length > 5) {
                continue;
            }

            // Detectar si la línea es un campo de datos clave (clave: valor)
            const isHora = /^(?:[\p{Extended_Pictographic}\s])*(?:hora|horario)[:\s]+/ui.test(line) || /^(?:hora|horario)[:\s]+/i.test(line);
            const isLugar = /^(?:[\p{Extended_Pictographic}\s])*(?:lugar|ubicaci[oó]n|quedada|punto\s+de\s+salida|sitio)[:\s]+/ui.test(line);
            const isDestino = /^(?:[\p{Extended_Pictographic}\s])*(?:destino)[:\s]+/ui.test(line);
            const isPremio = /^(?:[\p{Extended_Pictographic}\s])*(?:premio|bote|recompensa)[:\s]+/ui.test(line);
            const isOrganiza = /^(?:[\p{Extended_Pictographic}\s])*(?:organiza|organizador|organizaci[oó]n)[:\s]+/ui.test(line);
            const isDress = /^(?:[\p{Extended_Pictographic}\s])*(?:dress\s*code|dresscode|vestimenta)[:\s]+/ui.test(line);
            const isFecha = /^(?:[\p{Extended_Pictographic}\s])*(?:fecha|d[ií]a)[:\s]+/ui.test(line);

            if (isHora) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:hora|horario)[:\s]*/ui, '').trim();
                if (!extractedHora && cleanVal) extractedHora = cleanVal;
            } else if (isLugar) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:lugar|ubicaci[oó]n|quedada|punto\s+de\s+salida|sitio)[:\s]*/ui, '').trim();
                if (!extractedLugar && cleanVal) extractedLugar = cleanVal;
            } else if (isDestino) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:destino)[:\s]*/ui, '').trim();
                if (cleanVal) extractedLugar = extractedLugar ? `${extractedLugar} ➔ ${cleanVal}` : cleanVal;
            } else if (isPremio) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:premio|bote|recompensa)[:\s]*/ui, '').trim();
                if (!extractedPremio && cleanVal) extractedPremio = cleanVal;
            } else if (isOrganiza) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:organiza|organizador|organizaci[oó]n)[:\s]*/ui, '').trim();
                if (!extractedOrganiza && cleanVal) extractedOrganiza = cleanVal;
            } else if (isDress) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:dress\s*code|dresscode|vestimenta)[:\s]*/ui, '').trim();
                if (!extractedDressCode && cleanVal) extractedDressCode = cleanVal;
            } else if (isFecha) {
                let cleanVal = line.replace(/^(?:[\p{Extended_Pictographic}\s])*(?:fecha|d[ií]a)[:\s]*/ui, '').trim();
                if (!extractedFecha && cleanVal) extractedFecha = cleanVal;
            } else if (/^(?:[📍📌]|\s)*(?:TEQU[IÍ]\-LA\-LA|TALLER|BAHAMA|CASINO|MAFIA|GANG|POLIC[IÍ]A|BENNYS)/i.test(line) && !extractedLugar) {
                extractedLugar = line.replace(/^(?:[📍📌🗺️]|\s)*/, '').trim();
            } else if (/^(?:[📅🗓️]|\s)*(?:LUNES|MARTES|MI[EÉ]RCOLES|JUEVES|VIERNES|S[AÁ]BADO|DOMINGO)\s+\d+/i.test(line) && !extractedFecha) {
                extractedFecha = line.replace(/^(?:[📅🗓️]|\s)*/, '').trim();
            } else if (/arranca el motor|prepara tu coche|prepara tu 4x4|re[uú]ne a tu gente|ven a presumir|no te lo pierdas|te esperamos|prepara tu m[aá]quina|que empiece la fiesta|que empiece la guerra|no faltes|salvar la noche|etiqueta a tu|ser[aá]s t[uú]|corre\.\s*esc[oó]ndete/i.test(line)) {
                // Llamada a la acción / Cierre del staff
                let cleanOutro = line.replace(/^[•\-\*🔥\s]+|[🔥\s]+$/gi, '').trim();
                if (cleanOutro) extractedOutro.push(cleanOutro);
            } else if (/^(?:[•\-\*]|\s)*(?:[\p{Extended_Pictographic}\s])*(?:¿QU[EÉ]\s+OS\s+ESPERA\??|¿DE\s+QU[EÉ]\s+BANDO\s+VAS\??|ACTIVIDADES|PREMIOS|PROGRAMA|REQUISITOS|DETALLES|NORMAS|REGLAS)/ui.test(line)) {
                // Es un subtítulo o encabezado de sección
                let headerText = line.replace(/^[•\-\*]\s*/, '').trim();
                extractedPoints.push(`**${headerText}**`);
            } else if (line.includes('.') && line.length > 20 && !line.includes(':') && !line.startsWith('•') && !line.startsWith('-')) {
                // Es una frase o lema narrativo completo (ej. "🔪 UNA ISLA. UN ASESINO. 50.000 €...") -> Pasa al texto de bienvenida / intro
                extractedIntro.push(line);
            } else if (/^(?:\p{Extended_Pictographic}|[•\-\*]|\d+\.)/u.test(line)) {
                // Línea con viñeta / regla / detalle puntual
                let pt = line.replace(/^[•\-\*]\s*/, '').trim();
                extractedPoints.push(pt);
            } else {
                extractedIntro.push(line);
            }
        }
    }

    if (!eventTitleClean) eventTitleClean = 'EVENTO OFICIAL DE LA COMUNIDAD';

    // Determinar emoji según temática del evento
    let titleEmojiLeft = '🎉🔥';
    let titleEmojiRight = '🔥✨';
    const combinedFullText = `${eventTitleClean} ${rawText}`.toLowerCase();
    if (combinedFullText.includes('coche') || combinedFullText.includes('motor') || combinedFullText.includes('carrera') || combinedFullText.includes('quedada') || combinedFullText.includes('taller') || combinedFullText.includes('pit stop')) {
        titleEmojiLeft = '🚗🔥';
        titleEmojiRight = '🔥🏁';
    } else if (combinedFullText.includes('tequ') || combinedFullText.includes('fiesta') || combinedFullText.includes('noche') || combinedFullText.includes('disco') || combinedFullText.includes('copa') || combinedFullText.includes('shot') || combinedFullText.includes('ángel') || combinedFullText.includes('demonio')) {
        titleEmojiLeft = '🍸🔥';
        titleEmojiRight = '🔥🥂';
    } else if (combinedFullText.includes('torneo') || combinedFullText.includes('boxeo') || combinedFullText.includes('lucha') || combinedFullText.includes('batalla') || combinedFullText.includes('superviviente') || combinedFullText.includes('asesino') || combinedFullText.includes('cacer') || combinedFullText.includes('isla')) {
        titleEmojiLeft = '🔪🔥';
        titleEmojiRight = '🔥🏆';
    } else if (combinedFullText.includes('robo') || combinedFullText.includes('atraco') || combinedFullText.includes('polic') || combinedFullText.includes('mafia')) {
        titleEmojiLeft = '💰🔥';
        titleEmojiRight = '🔥🔫';
    }

    // Construcción limpia y elegante con bloques Discord
    let descSections = [];
    descSections.push(`\u200B`);

    // 1. Introducción / Bienvenida al evento
    if (extractedIntro.length > 0) {
        descSections.push(extractedIntro.join('\n\n'));
    }

    // 2. Bloque de Datos (Fecha, Hora, Lugar, Premio, Organiza, Dress Code)
    let infoFields = [];
    if (extractedFecha) infoFields.push(`> 📅 **FECHA:** \`${extractedFecha}\``);
    if (extractedHora) infoFields.push(`> 🕐 **HORA:** \`${extractedHora}\``);
    if (extractedLugar) infoFields.push(`> 📍 **LUGAR:** ${extractedLugar}`);
    if (extractedPremio) infoFields.push(`> 💰 **PREMIO:** \`${extractedPremio}\``);
    if (extractedOrganiza) infoFields.push(`> 👑 **ORGANIZA:** ${extractedOrganiza}`);
    if (extractedDressCode) infoFields.push(`> 👔 **DRESS CODE:** ${extractedDressCode}`);

    if (infoFields.length > 0) {
        descSections.push(`\n📌 **| Información del Evento:**\n${infoFields.join('\n')}`);
    }

    // 3. Actividades / Puntos clave / Secciones de Detalles
    if (extractedPoints.length > 0) {
        let currentSectionHeader = '✨ **| Detalles y Actividades:**';
        let sectionsMap = [];
        let currentItems = [];

        for (let pt of extractedPoints) {
            if (pt.startsWith('**') && pt.endsWith('**')) {
                // Si ya teníamos items acumulados, guardamos la sección anterior
                if (currentItems.length > 0) {
                    sectionsMap.push({ header: currentSectionHeader, items: currentItems });
                    currentItems = [];
                }
                // Limpiar el texto del nuevo encabezado y asegurar formato idéntico: EMOJI **| TÍTULO:**
                let rawH = pt.replace(/^\*\*|\*\*$/g, '').trim();
                let emojiMatch = rawH.match(/^(\p{Extended_Pictographic}+)\s*(.*)$/u);
                if (emojiMatch) {
                    let em = emojiMatch[1];
                    let textH = emojiMatch[2].replace(/^\|\s*/, '').trim();
                    if (!textH.endsWith(':') && !textH.endsWith('?')) textH += ':';
                    currentSectionHeader = `${em} **| ${textH}**`;
                } else {
                    let textH = rawH.replace(/^\|\s*/, '').trim();
                    if (!textH.endsWith(':') && !textH.endsWith('?')) textH += ':';
                    currentSectionHeader = `✨ **| ${textH}**`;
                }
            } else {
                currentItems.push(pt);
            }
        }

        if (currentItems.length > 0) {
            sectionsMap.push({ header: currentSectionHeader, items: currentItems });
        }

        for (let sec of sectionsMap) {
            let itemsText = sec.items.map(p => `> • ${p}`).join('\n');
            descSections.push(`\n${sec.header}\n${itemsText}`);
        }
    }

    // 4. Frase de llamada a la acción
    if (extractedOutro.length > 0) {
        descSections.push(`\n🔥 ${extractedOutro.join('\n🔥 ')}`);
    } else {
        descSections.push(`\n🔥 ¡No faltes y ven a disfrutar del evento con toda la comunidad!`);
    }

    // 5. Cierre oficial
    descSections.push(`\n🌍 **| Comenta y comparte el evento con la comunidad:**\n> ${canalGeneral} ❗\n\n🇪🇸 **| ¡Disfruta de SPAIN RP! |** 🇪🇸`);

    const finalDescription = descSections.join('\n');

    const mainEmbed = new EmbedBuilder()
        .setColor(0xF1C40F) // Amarillo Oro / Dorado vibrante
        .setAuthor({
            name: `🎉 | SISTEMA DE EVENTOS | SPAIN RP 👑`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setThumbnail(fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL())
        .setTitle(`${titleEmojiLeft} ${eventTitleClean.toUpperCase()} ${titleEmojiRight}`)
        .setDescription(finalDescription)
        .setFooter({
            text: `SPAIN RP • Evento Oficial de la Comunidad`,
            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
        })
        .setTimestamp();

    const embeds = [mainEmbed];

    const imageFiles = Array.isArray(mediaFiles) ? mediaFiles.filter(f => !f.name.endsWith('.mp4') && !f.name.endsWith('.mov')) : [];

    if (imageFiles.length > 0) {
        imageFiles.forEach(f => files.push(f));
        mainEmbed.setImage(`attachment://${imageFiles[0].name}`);

        if (imageFiles.length > 1) {
            for (let i = 1; i < imageFiles.length && i < 10; i++) {
                const extraEmbed = new EmbedBuilder()
                    .setImage(`attachment://${imageFiles[i].name}`);
                embeds.push(extraEmbed);
            }
        }
    } else if (imageAttachment) {
        files.push(imageAttachment);
        mainEmbed.setImage(`attachment://${imageAttachment.name}`);
    } else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        mainEmbed.setImage(imageUrl);
    }

    return { embeds, embed: mainEmbed, files, pingText: ping || '@everyone' };
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

    if (!fullText.trim()) return;

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
                `🧠 **Motor Local:** 🤖 \`${analysis.localAiScore}% IA\` • 👤 \`${analysis.localHumanScore}% Humano\`` +
                (analysis.apiAiScore !== null ? ` | 🌐 **API:** \`${analysis.apiAiScore}% IA\`\n` : `\n`) +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.detectedPatterns && analysis.detectedPatterns.length > 0) {
                descText += `\n🔍 **Patrones:** \`${analysis.detectedPatterns.join(' • ')}\``;
            }

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
                    await msgToDelete.delete().catch(() => { });
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
                            await rMsg.delete().catch(() => { });
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
    // Si el mensaje es enviado por un usuario real (Staff / Admin)
    if (!message.author.bot) {
        // Comprobar si este Staff tiene una sanción pendiente de subir captura
        if (pendingSancionesAwaitingImage.has(message.author.id)) {
            const pending = pendingSancionesAwaitingImage.get(message.author.id);
            console.log(`\n🚨 [SANCIÓN PENDIENTE] Mensaje recibido de Staff ${message.author.tag} (${message.author.id})`);
            console.log(`   -> Adjuntos detectados: ${message.attachments.size} | Contenido de texto: "${message.content}"`);

            if (Date.now() < pending.expiresAt) {
                const attachments = Array.from(message.attachments.values());
                let imgUrl = null;
                let videoUrl = null;

                // Detectar si el texto contiene enlaces de vídeo (Medal, YouTube, Streamable, etc.)
                const videoLinkMatch = message.content.match(/https?:\/\/(?:www\.)?(?:medal\.tv|youtube\.com|youtu\.be|streamable\.com|twitch\.tv|kick\.com|tiktok\.com)\S+/i);
                if (videoLinkMatch) {
                    videoUrl = videoLinkMatch[0];
                    console.log(`   -> 🎥 Enlace de vídeo/clip detectado: ${videoUrl}`);
                } else if (message.content.match(/^https?:\/\/\S+/i)) {
                    imgUrl = message.content.trim();
                    console.log(`   -> 🔗 Captura detectada desde enlace web: ${imgUrl}`);
                }

                const isNoPhoto = message.content.toLowerCase().includes('sin foto') || message.content.toLowerCase().includes('nofoto');

                // Si mandó archivos, enlaces o escribió 'sin foto'
                if (attachments.length > 0 || imgUrl || videoUrl || isNoPhoto) {
                    const mediaFiles = [];
                    for (let i = 0; i < attachments.length; i++) {
                        const att = attachments[i];
                        const isVideo = att.name.endsWith('.mp4') || att.name.endsWith('.mov') || att.name.endsWith('.webm') || att.name.endsWith('.mkv') || att.name.endsWith('.avi');
                        const isLarge = (att.size || 0) > 24 * 1024 * 1024; // > 24MB

                        // Si es un vídeo de más de 25MB (Discord no deja al bot re-subirlo como bot), guardar su URL directa de Discord
                        if (isVideo && isLarge) {
                            videoUrl = att.url;
                            console.log(`   -> 🎥 Vídeo pesado detectado (${(att.size / (1024 * 1024)).toFixed(2)} MB). Se mantendrá enlace directo a Discord CDN: ${videoUrl}`);
                            continue;
                        }

                        try {
                            console.log(`   -> 📥 Descargando adjunto ${i + 1}/${attachments.length}: ${att.name} (${(att.size / (1024 * 1024)).toFixed(2)} MB)...`);
                            const res = await fetch(att.url);
                            if (res.ok) {
                                const arrayBuffer = await res.arrayBuffer();
                                const buffer = Buffer.from(arrayBuffer);
                                const ext = path.extname(att.name) || '.png';
                                const safeName = `prueba_${i + 1}${ext}`;
                                mediaFiles.push(new AttachmentBuilder(buffer, { name: safeName }));
                                console.log(`      ✅ Adjunto #${i + 1} (${safeName}) cargado en memoria (${buffer.length} bytes).`);
                            } else {
                                console.error(`      ❌ Error HTTP al descargar ${att.url}: ${res.status}`);
                            }
                        } catch (e) {
                            console.error(`      ❌ Error al descargar adjunto ${i + 1} (${att.name}):`, e.message);
                        }
                    }

                    pendingSancionesAwaitingImage.delete(message.author.id);

                    const sancionObj = {
                        id: pending.id,
                        reporterId: pending.reporterId,
                        reporterTag: pending.reporterTag,
                        targetId: pending.targetId,
                        targetTag: pending.targetTag,
                        reason: pending.reason,
                        punishment: pending.punishment,
                        involvedStaff: pending.involvedStaff || `<@${pending.reporterId}>`,
                        imageUrl: imgUrl,
                        mediaFiles,
                        videoUrl,
                        channelId: message.channel.id
                    };

                    await saveSancionRecord(sancionObj);

                    const { embeds, embed, files, videoFiles } = buildSancionCardEmbed(sancionObj);
                    const targetChannelId = (botConfig.CHANNEL_SANCIONES_ID && botConfig.CHANNEL_SANCIONES_ID.trim()) ? botConfig.CHANNEL_SANCIONES_ID.trim() : message.channel.id;
                    let targetChannel = message.guild.channels.cache.get(targetChannelId) ||
                        await client.channels.fetch(targetChannelId).catch(err => {
                            console.error(`⚠️ [SANCIONES] No se pudo obtener el canal #${targetChannelId}:`, err.message);
                            return null;
                        });

                    if (!targetChannel) targetChannel = message.channel;

                    console.log(`\n📢 [SANCIONES DESTINO] Publicando expediente #${pending.id} en canal: #${targetChannel.name} (${targetChannel.id}) [Configurado: ${botConfig.CHANNEL_SANCIONES_ID}]`);

                    let sentMessage = null;
                    if (targetChannel) {
                        try {
                            console.log(`   -> 🚀 Enviando contenedor oficial a #${targetChannel.name}...`);
                            sentMessage = await targetChannel.send({ embeds: embeds || [embed], files });
                            if (sentMessage && sentMessage.id) {
                                console.log(`✅ [SANCIÓN PUBLICADA] Expediente #${pending.id} enviado con éxito (Msg ID: ${sentMessage.id}) a #${targetChannel.name}.\n`);
                            }

                            // Si se adjuntaron vídeos de prueba, enviar primero el contenedor del título y luego el vídeo para que quede por encima
                            if (Array.isArray(videoFiles) && videoFiles.length > 0) {
                                console.log(`   -> 🎬 Reenviando ${videoFiles.length} vídeo(s) de prueba bajo el contenedor...`);
                                const videoEmbed = new EmbedBuilder()
                                    .setColor(0xE74C3C)
                                    .setDescription(
                                        `🎥 **Grabación de Prueba:**\n` +
                                        `> 📁 Vídeo de prueba adjunto correspondiente al **Expediente #${pending.id}**.`
                                    );

                                // 1. Enviar el contenedor de título primero
                                await targetChannel.send({
                                    embeds: [videoEmbed]
                                }).catch(e => console.error('Error al enviar contenedor de vídeo:', e));

                                // 2. Enviar el reproductor de vídeo justo debajo
                                await targetChannel.send({
                                    files: videoFiles
                                }).catch(e => console.error('Error al reenviar vídeo adjunto:', e));
                            }
                        } catch (sendErr) {
                            console.error(`❌ [ERROR ENVIAR SANCIÓN A DISCORD]:`, sendErr);
                            if (sendErr.code === 40005 || sendErr.message?.includes('Entity too large') || sendErr.message?.includes('Payload Too Large')) {
                                console.warn('⚠️ Archivos demasiado grandes para Discord. Enviando expediente con fotos y enlace...');
                                const fallbackEmbed = embeds[0];
                                sentMessage = await targetChannel.send({ embeds: [fallbackEmbed] }).catch(() => null);
                            }
                        }
                    }

                    // Borrar el mensaje original del Staff ÚNICAMENTE cuando el contenedor y el vídeo ya han sido entregados al 100%
                    if (sentMessage && sentMessage.id) {
                        if (!videoUrl || !videoUrl.includes('cdn.discordapp.com')) {
                            await message.delete().catch(() => { });
                        }
                    }

                    return;
                } else {
                    console.log('   ⚠️ El mensaje del staff no contenía una imagen válida ni "sin foto". Sigue esperando...');
                }
            } else {
                console.log('   ⏰ El tiempo de espera de 60s expiró para esta sanción.');
                pendingSancionesAwaitingImage.delete(message.author.id);
            }
        }

        // Comprobar si este Staff tiene un evento pendiente de subir cartel / flyer
        if (pendingEventosAwaitingImage.has(message.author.id)) {
            const pending = pendingEventosAwaitingImage.get(message.author.id);
            console.log(`\n🎉 [EVENTO PENDIENTE] Mensaje recibido de Staff ${message.author.tag} (${message.author.id})`);
            console.log(`   -> Adjuntos detectados: ${message.attachments.size} | Contenido de texto: "${message.content}"`);

            if (Date.now() < pending.expiresAt) {
                const attachments = Array.from(message.attachments.values());
                let imgUrl = null;

                if (message.content.match(/^https?:\/\/\S+/i)) {
                    imgUrl = message.content.trim();
                    console.log(`   -> 🔗 Flyer/Cartel detectado desde enlace web: ${imgUrl}`);
                }

                const isNoPhoto = message.content.toLowerCase().includes('sin foto') || message.content.toLowerCase().includes('nofoto') || message.content.toLowerCase().includes('sin cartel');

                if (attachments.length > 0 || imgUrl || isNoPhoto) {
                    const mediaFiles = [];
                    for (let i = 0; i < attachments.length; i++) {
                        const att = attachments[i];
                        try {
                            console.log(`   -> 📥 Descargando flyer ${i + 1}/${attachments.length}: ${att.name}...`);
                            const res = await fetch(att.url);
                            if (res.ok) {
                                const arrayBuffer = await res.arrayBuffer();
                                const buffer = Buffer.from(arrayBuffer);
                                const ext = path.extname(att.name) || '.png';
                                const safeName = `evento_${i + 1}${ext}`;
                                mediaFiles.push(new AttachmentBuilder(buffer, { name: safeName }));
                                console.log(`      ✅ Flyer #${i + 1} (${safeName}) cargado en memoria (${buffer.length} bytes).`);
                            }
                        } catch (e) {
                            console.error(`      ❌ Error al descargar adjunto de evento ${i + 1} (${att.name}):`, e.message);
                        }
                    }

                    pendingEventosAwaitingImage.delete(message.author.id);

                    const eventoObj = {
                        id: pending.id,
                        reporterId: pending.reporterId,
                        reporterTag: pending.reporterTag,
                        title: pending.title,
                        description: pending.description,
                        hora: pending.hora,
                        lugar: pending.lugar,
                        organiza: pending.organiza,
                        ping: pending.ping || '@everyone',
                        imageUrl: imgUrl,
                        mediaFiles,
                        channelId: message.channel.id
                    };

                    await saveEventoRecord(eventoObj);

                    const { embeds, embed, files, pingText } = buildEventoCardEmbed(eventoObj);
                    const primaryChanId = (botConfig.CHANNEL_EVENTOS_ID && botConfig.CHANNEL_EVENTOS_ID.trim()) ? botConfig.CHANNEL_EVENTOS_ID.trim() : message.channel.id;
                    const secondaryChanId = (botConfig.CHANNEL_EVENTOS_2_ID && botConfig.CHANNEL_EVENTOS_2_ID.trim()) ? botConfig.CHANNEL_EVENTOS_2_ID.trim() : null;

                    const targetChannels = [];
                    const primaryChan = message.guild.channels.cache.get(primaryChanId) || await client.channels.fetch(primaryChanId).catch(() => null);
                    if (primaryChan) targetChannels.push(primaryChan);
                    else targetChannels.push(message.channel);

                    if (secondaryChanId && secondaryChanId !== primaryChanId) {
                        const secChan = message.guild.channels.cache.get(secondaryChanId) || await client.channels.fetch(secondaryChanId).catch(() => null);
                        if (secChan) targetChannels.push(secChan);
                    }

                    console.log(`\n📢 [EVENTOS DESTINO] Publicando evento #${pending.id} en ${targetChannels.length} canal(es): ${targetChannels.map(c => `#${c.name}`).join(', ')}`);

                    let sentMessage = null;
                    for (const chan of targetChannels) {
                        try {
                            const sm = await chan.send({ content: pingText || '@everyone', embeds: embeds || [embed], files });
                            if (sm && sm.id) {
                                sentMessage = sm;
                                console.log(`✅ [EVENTO PUBLICADO] Evento #${pending.id} anunciado con éxito en #${chan.name} (${chan.id}).`);
                            }
                        } catch (sendErr) {
                            console.error(`❌ [ERROR ENVIAR EVENTO A DISCORD EN #${chan.name}]:`, sendErr);
                        }
                    }

                    if (sentMessage && sentMessage.id) {
                        await message.delete().catch(() => { });
                    }

                    return;
                } else {
                    console.log('   ⚠️ El mensaje del staff no contenía una imagen válida ni "sin foto". Sigue esperando...');
                }
            } else {
                console.log('   ⏰ El tiempo de espera de 60s expiró para este evento.');
                pendingEventosAwaitingImage.delete(message.author.id);
            }
        }

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
            '!scan-historial', '!escanear-historial', '!ia-stats', '!reset-ia',
            '!entrevista', '!entrevistar', '!iniciar-entrevista', '!fin-entrevista', '!terminar-entrevista',
            '!hablar', '!conversar', '!ia-voz', '!charlar', '!callar', '!salir-voz', '!desconectar-voz',
            '!play', '!p', '!reproducir', '!stop', '!parar', '!detener', '!skip', '!next', '!saltar', '!siguiente', '!queue', '!cola', '!playlist',
            '!tops', '!top-staff', '!ranking-staff', '!valoraciones', '!stats-staff', '!topstaff', '!panel-tops', '!fijar-tops',
            '!sync-valoraciones', '!syncvaloraciones', '!escanear-valoraciones', '!recuperar-valoraciones',
            '!panel-valoracion', '!panel-valoraciones', '!fijar-valoraciones',
            '!panel-sanciones', '!panelsanciones', '!enviar-panel-sanciones', '!sancionar', '!sancion', '!sanciones', '!historial',
            '!setcanal-sanciones', '!setcanal-sancion', '!canalsanciones', '!fijar-sanciones',
            '!setcanal-panel-sanciones', '!setcanal-panelsanciones', '!canalpanelsanciones', '!fijar-panel-sanciones',
            '!panel-evento', '!panel-eventos', '!panelevento', '!paneleventos', '!enviar-panel-eventos', '!evento', '!eventos',
            '!setcanal-eventos', '!setcanal-evento', '!canaleventos', '!fijar-eventos',
            '!setcanal-panel-eventos', '!setcanal-paneleventos', '!canalpaneleventos', '!fijar-panel-eventos',
            '!setcanal', '!fijar-canal', '!canal'
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
                await message.react('✅').catch(() => { });
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
                await message.react('❌').catch(() => { });
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
                        await repliedMsg.delete().catch(() => { });
                    }
                    await message.delete().catch(() => { });
                    return;
                }

                // Caso 2: Si pasa un número como argumento, ej: !borrar 3
                const count = parseInt(args[1], 10);
                if (!isNaN(count) && count > 0) {
                    const deleteCount = Math.min(count + 1, 100);
                    await message.channel.bulkDelete(deleteCount, true).catch(async () => {
                        await message.delete().catch(() => { });
                    });
                    return;
                }

                // Caso 3: Solo escribió !borrar sin responder -> Busca y borra el último mensaje del bot en el canal
                const fetchedMessages = await message.channel.messages.fetch({ limit: 15 }).catch(() => null);
                if (fetchedMessages) {
                    const lastBotMsg = fetchedMessages.find(m => m.id !== message.id && m.author.id === client.user.id);
                    if (lastBotMsg) {
                        await lastBotMsg.delete().catch(() => { });
                    }
                }
                await message.delete().catch(() => { });
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
                await message.delete().catch(() => { });
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
                    await message.delete().catch(() => { });
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
            const link = args.find(arg => arg.startsWith('http') || arg.includes('twitch.tv') || arg.includes('kick.com') || arg.includes('youtube.com') || arg.includes('tiktok.com'));

            if (!targetUser || !link) {
                return message.reply({
                    content: `❌ **Uso incorrecto:** \`!addstreamer @usuario <enlace_del_canal> [Título por defecto]\`\n📌 *Ejemplos:* \n• Kick: \`!addstreamer @usuario https://kick.com/canal Rol en Kick Spain RP\`\n• Twitch: \`!addstreamer @usuario https://twitch.tv/canal Rol en Spain RP\`\n• TikTok: \`!addstreamer @usuario https://www.tiktok.com/@canal/live Directo en TikTok\``
                });
            }

            const titleParts = args.filter(arg => !arg.includes(targetUser.id) && arg !== link && !arg.startsWith('!'));
            const defaultTitle = titleParts.length > 0 ? titleParts.join(' ') : 'Roleplay en directo en SPAIN RP 🇪🇸';

            let platform = 'Twitch';
            if (link.includes('kick.com')) platform = 'Kick';
            else if (link.includes('youtube.com') || link.includes('youtu.be')) platform = 'YouTube';
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
        // SISTEMA INDEPENDIENTE: PANEL DE VALORACIÓN DE STAFF (!panel-valoracion)
        // ----------------------------------------------------
        if (['!panel-valoracion', '!panel-valoraciones', '!fijar-valoraciones'].includes(command)) {
            await message.delete().catch(() => { });
            try {
                const targetChannel = message.channel;

                const embed = buildStaffRatingPanelEmbed();
                const row = buildStaffRatingPanelRow();
                const files = [];

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                const panelImgPath = path.join(__dirname, 'assets', 'panel_valoracion.png');
                if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                if (fs.existsSync(panelImgPath)) files.push(new AttachmentBuilder(panelImgPath, { name: 'panel_valoracion.png' }));

                await targetChannel.send({
                    embeds: [embed],
                    components: [row],
                    files
                });

                // Guardar automáticamente el canal donde se envió como canal del panel de valoraciones
                updateConfig('CHANNEL_VALORACION_PANEL_ID', targetChannel.id);
                console.log(`⭐ [PANEL VALORACIÓN] Panel de valoraciones publicado en #${targetChannel.name} (${targetChannel.id})`);
                return;
            } catch (err) {
                console.error('Error al publicar panel de valoraciones:', err);
                return;
            }
        }

        // ----------------------------------------------------
        // SISTEMA DE SANCIONES STAFF (!sancionar / !sanciones)
        // ----------------------------------------------------
        // COMANDO MANUAL: !sancionar @usuario <Sanción> <Motivo...> (con foto adjunta opcional)
        if (['!sancionar', '!sancion', '!warn', '!ban', '!permaban'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) return;

            const targetUser = message.mentions.users.first();
            const cleanArgs = args.slice(1).filter(a => !a.startsWith('<@'));

            if (!targetUser || cleanArgs.length < 2) {
                const helpMsg = await message.channel.send({
                    content: '⚠️ **Uso:** `!sancionar @usuario <Sanción/Escenario> <Breve explicación>` *(Puedes adjuntar la captura al enviar el mensaje)*\n📌 *Ejemplo:* `!sancionar @pepe Permaban Portaba un RPG en su inventario`'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 6000);
                return;
            }

            const punishment = cleanArgs[0];
            const reason = cleanArgs.slice(1).join(' ');
            const attachment = message.attachments.first();
            const imageUrl = attachment ? attachment.url : null;
            const sancionId = Date.now().toString().slice(-4);

            const sancionObj = {
                id: sancionId,
                reporterId: message.author.id,
                reporterTag: message.author.tag || message.author.username,
                targetId: targetUser.id,
                targetTag: targetUser.tag || targetUser.username,
                reason,
                punishment,
                involvedStaff: `<@${message.author.id}>`,
                imageUrl,
                channelId: message.channel.id
            };

            await saveSancionRecord(sancionObj);

            const { embed, files } = buildSancionCardEmbed(sancionObj);
            const targetChannelId = botConfig.CHANNEL_SANCIONES_ID || message.channel.id;
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => message.channel);

            await targetChannel.send({ embeds: [embed], files }).catch(e => console.error('Error al enviar sancion:', e));
            return;
        }

        // COMANDO: !sanciones @usuario / !historial @usuario
        if (['!sanciones', '!historial-sanciones', '!historial'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) return;

            const targetUser = message.mentions.users.first() || { id: args[1]?.replace(/[<@!>]/g, '') };
            if (!targetUser || !targetUser.id) {
                const helpMsg = await message.channel.send('⚠️ **Uso:** `!sanciones @usuario` o `!sanciones <ID>`').catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 5000);
                return;
            }

            const allSanciones = getSancionesData();
            const userSanciones = allSanciones.filter(s => s.targetId === targetUser.id);

            let desc = '';
            if (userSanciones.length === 0) {
                desc = `🟢 El usuario <@${targetUser.id}> (\`${targetUser.id}\`) **no tiene sanciones registradas** en el historial.`;
            } else {
                desc = `📋 **Total de sanciones acumuladas:** \`${userSanciones.length}\`\n\n`;
                userSanciones.slice(-5).reverse().forEach((s, idx) => {
                    desc += `**#${s.id || idx + 1} | ${s.punishment || 'Sanción'}**\n` +
                        `> 👮 **Staff:** <@${s.reporterId}>\n` +
                        `> 📝 **Motivo:** *"${s.reason || 'Sin motivo'}"*\n` +
                        (s.imageUrl ? `> 📸 [Ver Captura de Prueba](${s.imageUrl})\n` : '') +
                        `\n`;
                });
            }

            const histEmbed = new EmbedBuilder()
                .setColor(userSanciones.length > 0 ? 0xE74C3C : 0x2ECC71)
                .setTitle(`🚨 Historial Disciplinario • <@${targetUser.id}>`)
                .setDescription(desc)
                .setFooter({ text: 'SPAIN RP • Base de Datos de Moderación' })
                .setTimestamp();

            const histMsg = await message.channel.send({ embeds: [histEmbed] }).catch(() => null);
            if (histMsg) setTimeout(() => histMsg.delete().catch(() => { }), 20000);
            return;
        }

        // ==========================================
        // SISTEMA DE EVENTOS STAFF (!evento / !eventos)
        // ==========================================
        // COMANDO MANUAL: !evento <Título | Hora | Lugar | Organiza | Descripción> (con flyer adjunto opcional)
        if (['!evento', '!eventos', '!crearevento', '!anunciarevinto', '!anunciarevents'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) return;

            const fullText = args.slice(1).join(' ').trim();
            if (!fullText) {
                const helpMsg = await message.channel.send({
                    content: '⚠️ **Uso:** `!evento <Título> | <Hora> | <Lugar> | <Organiza> | <Descripción>` *(Adjunta el cartel al enviar el mensaje)*\n📌 *Ejemplo:* `!evento Quedada JDM | 18:00 | Taller Pit Stop | Taller Pit Stop | Gran exhibición de coches retro y japoneses!`'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 8000);
                return;
            }

            const parts = fullText.split('|').map(p => p.trim());
            const title = parts[0] || 'Evento Oficial SPAIN RP';
            const hora = parts[1] || '';
            const lugar = parts[2] || '';
            const organiza = parts[3] || 'Staff SPAIN RP';
            const description = parts.slice(4).join(' | ') || (parts.length === 1 ? parts[0] : '');

            const attachment = message.attachments.first();
            const imageUrl = attachment ? attachment.url : null;
            const eventoId = Date.now().toString().slice(-4);

            const eventoObj = {
                id: eventoId,
                reporterId: message.author.id,
                reporterTag: message.author.tag || message.author.username,
                title,
                description,
                hora,
                lugar,
                organiza,
                ping: '@everyone',
                imageUrl,
                channelId: message.channel.id
            };

            await saveEventoRecord(eventoObj);

            const { embeds, embed, files, pingText } = buildEventoCardEmbed(eventoObj);
            const targetChannelId = (botConfig.CHANNEL_EVENTOS_ID && botConfig.CHANNEL_EVENTOS_ID.trim()) ? botConfig.CHANNEL_EVENTOS_ID.trim() : message.channel.id;
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => message.channel);

            await targetChannel.send({ content: pingText || '@everyone', embeds: embeds || [embed], files }).catch(e => console.error('Error al enviar evento:', e));
            return;
        }

        // COMANDO: !tops / !top-staff / !ranking-staff / !panel-tops (Envía o actualiza el mensaje fijo que NUNCA se borra)
        if (['!tops', '!top-staff', '!ranking-staff', '!stats-staff', '!valoraciones', '!topstaff', '!panel-tops', '!fijar-tops'].includes(command)) {
            await message.delete().catch(() => { });
            try {
                // Sincronizar automáticamente cualquier valoración que falte por registrar en el canal de valoraciones
                await syncStaffRatingsFromChannel().catch(e => console.error('Error en syncStaffRatingsFromChannel durante !tops:', e));

                const targetChannel = message.channel;
                const { topEmbed, files } = buildStaffTopRankingEmbed();

                // Si ya existe un mensaje de tops guardado en este canal, editarlo en vez de duplicarlo
                let updatedExisting = false;
                if (botConfig.MESSAGE_TOP_STAFF_ID && botConfig.CHANNEL_VALORACION_PANEL_ID === targetChannel.id) {
                    try {
                        const existingMsg = await targetChannel.messages.fetch(botConfig.MESSAGE_TOP_STAFF_ID).catch(() => null);
                        if (existingMsg) {
                            await existingMsg.edit({ embeds: [topEmbed] }).catch(() => { });
                            updatedExisting = true;
                            console.log(`🏆 [PANEL TOP STAFF] Mensaje existente editado con éxito.`);
                        }
                    } catch (e) { }
                }

                // Si no existía o se ejecuta en otro canal, enviar el mensaje fijo permanente y registrarlo
                if (!updatedExisting) {
                    const sentMsg = await targetChannel.send({ embeds: [topEmbed], files });
                    updateConfig('CHANNEL_VALORACION_PANEL_ID', targetChannel.id);
                    updateConfig('MESSAGE_TOP_STAFF_ID', sentMsg.id);
                    console.log(`🏆 [PANEL TOP STAFF] Mensaje fijo permanente publicado en #${targetChannel.name} (Msg ID: ${sentMsg.id})`);
                }
                return;
            } catch (err) {
                console.error('Error al gestionar panel permanente de tops:', err);
                return;
            }
        }

        // COMANDO: !sync-valoraciones / !recuperar-valoraciones (Escanea todo el canal y sincroniza a fondo)
        if (['!sync-valoraciones', '!syncvaloraciones', '!escanear-valoraciones', '!recuperar-valoraciones'].includes(command)) {
            await message.delete().catch(() => { });
            try {
                const statusMsg = await message.channel.send('⏳ **Escaneando el canal de valoraciones para sincronizar el Top...**').catch(() => null);
                const syncRes = await syncStaffRatingsFromChannel();
                
                if (syncRes.success) {
                    await updateStaffTopRankingPanel().catch(() => { });
                    if (statusMsg) {
                        await statusMsg.edit(`✅ **Sincronización completada:**\n> 📥 Nuevas valoraciones importadas: \`${syncRes.importedCount}\`\n> 📊 Total de valoraciones registradas: \`${syncRes.totalRatings}\`\n> 🏆 El panel de Tops ha sido actualizado.`);
                        setTimeout(() => statusMsg.delete().catch(() => { }), 8000);
                    }
                } else {
                    if (statusMsg) {
                        await statusMsg.edit(`❌ **Error al sincronizar:** ${syncRes.error}`);
                        setTimeout(() => statusMsg.delete().catch(() => { }), 8000);
                    }
                }
                return;
            } catch (err) {
                console.error('Error en comando !sync-valoraciones:', err);
                return;
            }
        }

        // COMANDO: !addstaff @usuario / !delstaff @usuario / !staffs (Gestiona la lista de Staffs a valorar)
        if (['!addstaff', '!agregarstaff', '!nuevostaff'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first() || { id: args[0]?.replace(/[<@!>]/g, '') };
            if (!targetUser || !targetUser.id) {
                const helpMsg = await message.channel.send('⚠️ **Uso:** `!addstaff @usuario` o `!addstaff <ID>`').catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 5000);
                return;
            }

            addStaffMemberToRating(targetUser.id);
            const successMsg = await message.channel.send(`✅ Staff <@${targetUser.id}> añadido a la lista del menú de valoraciones.`).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 6000);
            return;
        }

        if (['!delstaff', '!eliminarstaff', '!quitarstaff'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first() || { id: args[0]?.replace(/[<@!>]/g, '') };
            if (!targetUser || !targetUser.id) {
                const helpMsg = await message.channel.send('⚠️ **Uso:** `!delstaff @usuario` o `!delstaff <ID>`').catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 5000);
                return;
            }

            removeStaffMemberFromRating(targetUser.id);
            const successMsg = await message.channel.send(`🗑️ Staff <@${targetUser.id}> retirado de la lista del menú de valoraciones.`).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 6000);
            return;
        }

        if (['!staffs', '!listastaff', '!stafflist'].includes(command)) {
            await message.delete().catch(() => { });
            const data = getStaffRatingsData();
            const staffList = data.staffList || [];

            let desc = '';
            if (staffList.length === 0) {
                desc = 'ℹ️ No hay Staffs registrados. Usa `!addstaff @usuario`';
            } else {
                staffList.forEach((sId, i) => {
                    desc += `> \`#${i + 1}\` <@${sId}> (\`${sId}\`)\n`;
                });
            }

            const staffListEmbed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle('🛡️ Lista de Staffs Valorables en el Menú')
                .setDescription(desc)
                .setFooter({ text: 'SPAIN RP • Usa !addstaff y !delstaff para configurar' });

            const listMsg = await message.channel.send({ embeds: [staffListEmbed] }).catch(() => null);
            if (listMsg) setTimeout(() => listMsg.delete().catch(() => { }), 15000);
            return;
        }
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
                    `🎵 \`!play <canción o URL>\` → Reproduce música de YouTube o la añade a la cola.\n` +
                    `⏹️ \`!stop\` → Detiene la música y vacía la cola de canciones.\n` +
                    `⏭️ \`!skip\` → Salta a la siguiente canción de la cola.\n` +
                    `📜 \`!queue\` o \`!cola\` → Muestra la lista de canciones en espera.\n` +
                    `⭐ \`!panel-valoracion\` → Publica el panel con el botón para que los usuarios valoren al Staff.\n` +
                    `🏆 \`!tops\` o \`!top-staff\` → Muestra el ranking con las mejores puntuaciones del equipo de Staff.\n` +
                    `🔄 \`!sync-valoraciones\` → Escanea el canal de valoraciones e importa al Top cualquier valoración faltante.\n` +
                    `🚨 \`!sancionar @usuario <sanción> <motivo>\` o \`!panel-sanciones\` → Sistema de sanciones de Staff.\n` +
                    `🎉 \`!evento <detalles>\` o \`!panel-eventos\` → Sistema de publicación de eventos con flyer oficial.\n` +
                    `🎙️ \`!hablar\` o \`!ia-voz\` → Conecta al bot al canal de voz para mantener conversación por voz con la IA en vivo.\n` +
                    `🎙️ \`!entrevista @usuario\` → Inicia la auditoría de WL Oral con transcripción y ficha de evaluación.\n` +
                    `🛑 \`!callar\` o \`!salir-voz\` → Desconecta al bot del canal de voz.\n` +
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
                // Borrar inmediatamente el comando del chat
                await msg.delete().catch(() => { });

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                const files = [];
                let iconURL = client.user.displayAvatarURL();
                if (fs.existsSync(logoPath)) {
                    files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
                    iconURL = 'attachment://logo.png';
                }

                const deniedEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({
                        name: 'ACCESO DENEGADO • SEGURIDAD SPAIN RP',
                        iconURL: iconURL
                    })
                    .setDescription(
                        `⛔ <@${msg.author.id}>, este comando de administración y configuración es de uso **exclusivo para el Propietario / Owner** del bot.\n\n` +
                        `> 🔒 *Tu solicitud ha sido bloqueada y registrada por el sistema de seguridad.*`
                    )
                    .setFooter({ text: 'SPAIN RP • Mensaje temporal (se auto-eliminará en 5s)' })
                    .setTimestamp();

                const sent = await msg.channel.send({ embeds: [deniedEmbed], files }).catch(() => null);
                if (sent) {
                    setTimeout(() => sent.delete().catch(() => { }), 5000);
                }
            } catch (err) { }
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
                    `📋 **CANALES DE WHITELIST & ENTREVISTAS:**\n` +
                    `> 📥 **Solicitudes:** ${formatChannel(botConfig.CHANNEL_SOLICITUDES_ID)}\n` +
                    `> ✅ **Aprobados:** ${formatChannel(botConfig.CHANNEL_APROBADOS_ID)}\n` +
                    `> ❌ **Denegados:** ${formatChannel(botConfig.CHANNEL_DENEGADOS_ID)}\n` +
                    `> 🎙️ **Fichas Entrevistas:** ${formatChannel(botConfig.CHANNEL_ENTREVISTAS_ID)}\n\n` +
                    `🟣 **CANALES DE STREAMERS:**\n` +
                    `> 🔘 **Panel Botón Directo:** ${formatChannel(botConfig.CHANNEL_STREAM_PANEL_ID)}\n` +
                    `> 📢 **Canal de Avisos Stream:** ${formatChannel(botConfig.CHANNEL_STREAMERS_ID)}\n\n` +
                    `🌐 **CANALES DEL SERVIDOR & ESTADO:**\n` +
                    `> 👋 **Bienvenidas:** ${formatChannel(botConfig.CHANNEL_BIENVENIDAS_ID)}\n` +
                    `> 📊 **Panel Estado FiveM:** ${formatChannel(botConfig.CHANNEL_STATUS_ID)}\n` +
                    `> 📜 **Normativas:** ${formatChannel(botConfig.CHANNEL_NORMATIVAS_ID)}\n` +
                    `> 🎫 **Tickets / Soporte:** ${formatChannel(botConfig.CHANNEL_TICKETS_ID)}\n` +
                    `> 💬 **General:** ${formatChannel(botConfig.CHANNEL_GENERAL_ID)}\n\n` +
                    `🚨 **CANALES DE MODERACIÓN & EVENTOS:**\n` +
                    `> ⚖️ **Sanciones:** ${formatChannel(botConfig.CHANNEL_SANCIONES_ID)}\n` +
                    `> 📋 **Panel Sanciones:** ${formatChannel(botConfig.CHANNEL_SANCIONES_PANEL_ID)}\n` +
                    `> 🎉 **Eventos Oficiales:** ${formatChannel(botConfig.CHANNEL_EVENTOS_ID)}\n` +
                    `> 📢 **Panel Eventos:** ${formatChannel(botConfig.CHANNEL_EVENTOS_PANEL_ID)}\n\n` +
                    `🛡️ **ROLES:**\n` +
                    `> 👑 **Staff WL:** ${formatRole(botConfig.ROLE_STAFF_ID)}\n` +
                    `> 🟣 **Streamer:** ${formatRole(botConfig.ROLE_STREAMER_ID)}\n\n` +
                    `🎮 **DATOS FIVEM:**\n` +
                    `> 📡 **IP/Puerto:** \`${botConfig.FIVEM_SERVER_IP || 'No definida'}\`\n` +
                    `> 🔗 **CFX Code:** \`${botConfig.FIVEM_CFX_CODE || 'No definido'}\`\n\n` +
                    `────────────────────────────\n` +
                    `⚙️ **¿CÓMO CAMBIAR LOS CANALES Y AJUSTES?**\n` +
                    `• \`!setcanal bienvenidas <#canal o ID>\` *(Avisos de bienvenida)*\n` +
                    `• \`!setcanal solicitudes <#canal o ID>\`\n` +
                    `• \`!setcanal aprobados <#canal o ID>\`\n` +
                    `• \`!setcanal denegados <#canal o ID>\`\n` +
                    `• \`!setcanal entrevistas <#canal o ID>\` *(Fichas de voz)*\n` +
                    `• \`!setcanal streampanel <#canal o ID>\` *(Donde va el botón)*\n` +
                    `• \`!setcanal streamaviso <#canal o ID>\` *(Donde se publica el directo)*\n` +
                    `• \`!setcanal status <#canal o ID>\` *(Panel de jugadores)*\n` +
                    `• \`!setcanal eventos <#canal o ID>\` *(Donde se publican los eventos)*\n` +
                    `• \`!setcanal paneleventos <#canal o ID>\` *(Donde va el botón de eventos)*\n` +
                    `• \`!setcanal sanciones <#canal o ID>\`\n` +
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
                        `📌 **Tipos disponibles:** \`bienvenidas\`, \`solicitudes\`, \`aprobados\`, \`denegados\`, \`entrevistas\`, \`streampanel\`, \`streamaviso\`, \`status\`, \`normativas\`, \`tickets\`, \`general\`, \`valoraciones\`, \`sanciones\`\n` +
                        `*Ejemplo:* \`!setcanal bienvenidas #bienvenida\``
                });
            }

            const channelIdMatch = rawTarget.trim().match(/<#(\d{17,20})>|^(\d{17,20})$/);
            const channelId = channelIdMatch ? (channelIdMatch[1] || channelIdMatch[2]) : rawTarget.trim().replace(/[^0-9]/g, '');

            if (!channelId || !/^\d{17,20}$/.test(channelId)) {
                return message.reply({ content: '❌ No se pudo detectar una ID numérica o canal válido de Discord.' });
            }

            const channelKeyMap = {
                'bienvenida': 'CHANNEL_BIENVENIDAS_ID',
                'bienvenidas': 'CHANNEL_BIENVENIDAS_ID',
                'welcome': 'CHANNEL_BIENVENIDAS_ID',
                'welcomes': 'CHANNEL_BIENVENIDAS_ID',
                'solicitudes': 'CHANNEL_SOLICITUDES_ID',
                'solicitud': 'CHANNEL_SOLICITUDES_ID',
                'aprobados': 'CHANNEL_APROBADOS_ID',
                'aprobado': 'CHANNEL_APROBADOS_ID',
                'denegados': 'CHANNEL_DENEGADOS_ID',
                'denegado': 'CHANNEL_DENEGADOS_ID',
                'entrevistas': 'CHANNEL_ENTREVISTAS_ID',
                'entrevista': 'CHANNEL_ENTREVISTAS_ID',
                'fichas': 'CHANNEL_ENTREVISTAS_ID',
                'fichas-voz': 'CHANNEL_ENTREVISTAS_ID',
                'voz': 'CHANNEL_ENTREVISTAS_ID',
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
                'general': 'CHANNEL_GENERAL_ID',
                'valpanel': 'CHANNEL_VALORACION_PANEL_ID',
                'valoracionpanel': 'CHANNEL_VALORACION_PANEL_ID',
                'panelvaloracion': 'CHANNEL_VALORACION_PANEL_ID',
                'valoraciones': 'CHANNEL_VALORACIONES_ID',
                'valoracion': 'CHANNEL_VALORACIONES_ID',
                'sanciones': 'CHANNEL_SANCIONES_ID',
                'sancion': 'CHANNEL_SANCIONES_ID',
                'eventos': 'CHANNEL_EVENTOS_ID',
                'evento': 'CHANNEL_EVENTOS_ID',
                'paneleventos': 'CHANNEL_EVENTOS_PANEL_ID',
                'panelevento': 'CHANNEL_EVENTOS_PANEL_ID',
                'panel-eventos': 'CHANNEL_EVENTOS_PANEL_ID',
                'panel-evento': 'CHANNEL_EVENTOS_PANEL_ID'
            };

            const configKey = channelKeyMap[tipo];
            if (!configKey) {
                return message.reply({
                    content: `❌ Tipo de canal no válido: \`${tipo}\`.\nOpciones: \`bienvenidas\`, \`solicitudes\`, \`aprobados\`, \`denegados\`, \`entrevistas\`, \`streampanel\`, \`streamaviso\`, \`status\`, \`normativas\`, \`tickets\`, \`general\`, \`valoraciones\`, \`sanciones\`, \`eventos\`, \`paneleventos\``
                });
            }

            updateConfig(configKey, channelId);

            // Si se cambió el canal del panel de directos, enviar el panel allí de inmediato
            if (configKey === 'CHANNEL_STREAM_PANEL_ID') {
                ensureStreamPanel().catch(() => { });
            }

            // Si se cambió el canal de estado, actualizar panel
            if (configKey === 'CHANNEL_STATUS_ID') {
                updateChannelStatusPanel().catch(() => { });
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
            if (botConfig.CHANNEL_STREAM_PANEL_ID) await ensureStreamPanel().catch(() => { });
            if (botConfig.CHANNEL_STATUS_ID) await updateChannelStatusPanel().catch(() => { });
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
                } catch (e) { }
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

            let testDesc1 = `👤 **Solicitante:** ${message.author}\n` +
                `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                `🧠 **Motor Local:** 🤖 \`${analysis.localAiScore}% IA\` • 👤 \`${analysis.localHumanScore}% Humano\`` +
                (analysis.apiAiScore !== null ? ` | 🌐 **API:** \`${analysis.apiAiScore}% IA\`\n` : `\n`) +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.detectedPatterns && analysis.detectedPatterns.length > 0) {
                testDesc1 += `\n🔍 **Patrones:** \`${analysis.detectedPatterns.join(' • ')}\``;
            }

            const testEmbed = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(testDesc1);

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
                } catch (e) { }
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
                `🧠 **Motor Local:** 🤖 \`${analysis.localAiScore}% IA\` • 👤 \`${analysis.localHumanScore}% Humano\`` +
                (analysis.apiAiScore !== null ? ` | 🌐 **API:** \`${analysis.apiAiScore}% IA\`\n` : `\n`) +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.detectedPatterns && analysis.detectedPatterns.length > 0) {
                testDesc += `\n🔍 **Patrones:** \`${analysis.detectedPatterns.join(' • ')}\``;
            }

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

            let simDesc = `👤 **Solicitante:** <@${mentionedUser.id}>\n` +
                `📊 **Probabilidad IA:** ${analysis.statusEmoji} \`${analysis.aiScore}%\` \`[${bar}]\`\n` +
                `🧠 **Motor Local:** 🤖 \`${analysis.localAiScore}% IA\` • 👤 \`${analysis.localHumanScore}% Humano\`` +
                (analysis.apiAiScore !== null ? ` | 🌐 **API:** \`${analysis.apiAiScore}% IA\`\n` : `\n`) +
                `📄 **Diagnóstico:** ${analysis.statusLabel}`;

            if (analysis.detectedPatterns && analysis.detectedPatterns.length > 0) {
                simDesc += `\n🔍 **Patrones:** \`${analysis.detectedPatterns.join(' • ')}\``;
            }

            // 3. Crear la tarjeta de auditoría compacta
            const embedAuditoria = new EmbedBuilder()
                .setColor(embedColor)
                .setAuthor({ name: 'AUDITORÍA DE WHITELIST • SPAIN RP', iconURL })
                .setDescription(simDesc);

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

        // ----------------------------------------------------
        // COMANDOS DE ENTREVISTAS DE VOZ POR IA: !entrevista / !fin-entrevista / !cancelar-entrevista
        // ----------------------------------------------------
        if (['!entrevista', '!entrevistar', '!iniciar-entrevista', '!audit-voz'].includes(command)) {
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) {
                return message.reply({ content: '❌ Solo los miembros de **Staff** o el **Creador** pueden iniciar entrevistas de voz.' });
            }

            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                return message.reply({
                    content: `🎙️ **Uso:** \`!entrevista @usuario\`\n*Debes estar dentro de un canal de voz con el postulante.*`
                });
            }

            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
                return message.reply({
                    content: '❌ **Debes estar conectado a un canal de voz** para iniciar la auditoría de la entrevista.'
                });
            }

            if (activeVoiceInterviews.has(message.guild.id)) {
                return message.reply({
                    content: '⚠️ **Ya hay una entrevista de voz activa en este servidor.**\nUsa `!fin-entrevista` para finalizarla antes de iniciar otra.'
                });
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });

                // Truco oficial de Discord Voice Gateway:
                // Para que Discord envíe los paquetes UDP entrantes de audio de los usuarios,
                // el bot debe enviar al menos 1 frame de silencio Opus periódicamente.
                const silencePlayer = createAudioPlayer();
                class SilenceStream extends Readable {
                    _read() {
                        this.push(Buffer.from([0xF8, 0xFF, 0xFE]));
                    }
                }
                const silenceResource = createAudioResource(new SilenceStream(), { inputType: StreamType.Opus });
                silencePlayer.play(silenceResource);
                connection.subscribe(silencePlayer);

                const session = {
                    targetUserId: targetUser.id,
                    targetMention: `<@${targetUser.id}>`,
                    targetTag: targetUser.tag || targetUser.username,
                    staffId: message.author.id,
                    staffMention: `<@${message.author.id}>`,
                    channelId: message.channel.id,
                    voiceChannelId: voiceChannel.id,
                    startTime: Date.now(),
                    transcripts: [],
                    connection,
                    silencePlayer
                };

                activeVoiceInterviews.set(message.guild.id, session);

                // Suscripción al stream de voz del usuario entrevistado
                const receiver = connection.receiver;
                // Control de streams activos por usuario para no duplicar suscripciones de voz
                const activeUserStreams = new Set();

                const handleUserSpeaking = (userId) => {
                    // Si habla el bot, ignorar
                    if (userId === client.user.id) return;

                    // Si se especificó el postulante, escuchar solo al postulante
                    if (userId !== targetUser.id && userId === message.author.id) {
                        return; // Ignora al entrevistador
                    }

                    // Evitar duplicar listeners sobre el mismo usuario si ya está emitiendo
                    if (activeUserStreams.has(userId)) return;
                    activeUserStreams.add(userId);

                    const opusStream = receiver.subscribe(userId, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: 1200
                        }
                    });

                    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
                    const pcmChunks = [];

                    opusStream.pipe(decoder);

                    decoder.on('data', (chunk) => {
                        pcmChunks.push(chunk);
                    });

                    decoder.on('end', async () => {
                        activeUserStreams.delete(userId);
                        if (pcmChunks.length === 0) return;
                        const pcmBuffer = Buffer.concat(pcmChunks);

                        // Filtrar ruidos cortos o respiraciones (< 8000 bytes ~ 0.2s)
                        if (pcmBuffer.length > 8000) {
                            const wavBuffer = pcmToWavBuffer(pcmBuffer, 48000, 1);
                            const text = await transcribeAudioBufferWithHF(wavBuffer);
                            if (text && text.trim().length > 1) {
                                const cleanText = text.trim();
                                console.log(`🎙️ [VOZ AUDITORÍA] "${cleanText}"`);
                                const active = activeVoiceInterviews.get(message.guild.id);
                                if (active && active.targetUserId === targetUser.id) {
                                    // Evitar insertar la misma frase duplicada si Whisper la capturó en cola
                                    if (active.transcripts.length === 0 || active.transcripts[active.transcripts.length - 1] !== cleanText) {
                                        active.transcripts.push(cleanText);
                                    }
                                }
                            }
                        }
                    });

                    decoder.on('error', () => {
                        activeUserStreams.delete(userId);
                    });
                    opusStream.on('error', () => {
                        activeUserStreams.delete(userId);
                    });
                };

                receiver.speaking.on('start', handleUserSpeaking);

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                const files = [];
                if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

                const startEmbed = new EmbedBuilder()
                    .setColor(0x3498DB) // Azul informativo
                    .setAuthor({
                        name: 'AUDITORÍA DE ENTREVISTAS POR VOZ • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setTitle('🎙️ Auditoría de Voz Iniciada en Tiempo Real')
                    .setDescription(
                        `👤 **Postulante:** <@${targetUser.id}>\n` +
                        `🛡️ **Entrevistador:** <@${message.author.id}>\n` +
                        `🔊 **Canal de Voz:** <#${voiceChannel.id}>\n\n` +
                        `⚡ *El bot está escuchando las respuestas del postulante en streaming en memoria RAM (0 MB guardados en disco).*`
                    )
                    .addFields(
                        {
                            name: '📋 ¿Cómo finalizar?',
                            value: 'Escribe **`!fin-entrevista`** cuando termines para recibir la tarjeta con la transcripción y el análisis de fluidez.'
                        },
                        {
                            name: '❌ ¿Cómo cancelar?',
                            value: 'Escribe **`!cancelar-entrevista`** o **`!salir-voz`** para salir del canal sin generar ficha.'
                        }
                    )
                    .setFooter({ text: 'SPAIN RP • Speech-to-Text Whisper AI 100% Gratuito' })
                    .setTimestamp();

                return message.reply({ embeds: [startEmbed], files });
            } catch (vErr) {
                console.error('Error al conectar a voz:', vErr);
                activeVoiceInterviews.delete(message.guild.id);
                return message.reply({ content: `❌ Error al conectar al canal de voz: ${vErr.message}` });
            }
        }

        // Finalizar entrevista y generar tarjeta con transcripción y análisis
        if (['!fin-entrevista', '!terminar-entrevista', '!stop-entrevista'].includes(command)) {
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) {
                return message.reply({ content: '❌ Solo los miembros de **Staff** o el **Creador** pueden finalizar entrevistas.' });
            }

            const session = activeVoiceInterviews.get(message.guild.id);
            if (!session) {
                return message.reply({ content: '❌ **No hay ninguna entrevista de voz activa en este momento.**' });
            }

            // Desconectar al bot de voz
            try {
                if (session.connection) session.connection.destroy();
            } catch (e) { }

            const durationSec = Math.round((Date.now() - session.startTime) / 1000);
            const durationMin = Math.floor(durationSec / 60);
            const durationRemainSec = durationSec % 60;
            const durationStr = `${durationMin}m ${durationRemainSec}s`;

            const evaluation = evaluateVoiceInterviewContent(session.transcripts);
            activeVoiceInterviews.delete(message.guild.id);

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const resultEmbed = new EmbedBuilder()
                .setColor(0x2ECC71) // Verde
                .setAuthor({
                    name: 'FICHA DE AUDITORÍA ORAL • SPAIN RP',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setTitle('🎙️ Resumen de Entrevista de Voz Completada')
                .setDescription(
                    `👤 **Postulante:** ${session.targetMention}\n` +
                    `🛡️ **Entrevistador:** <@${message.author.id}>\n` +
                    `⏱️ **Duración:** \`${durationStr}\`\n` +
                    `📊 **Fluidez Oral:** ${evaluation.fluidezRating}\n` +
                    `💡 **Veredicto Sugerido:** \`${evaluation.recomendacion}\``
                )
                .addFields(
                    {
                        name: '🔍 Conceptos de Rol Identificados en Voz',
                        value: evaluation.conceptsFound.length > 0 ? evaluation.conceptsFound.map(c => `• \`${c}\``).join('\n') : '`Ninguno detectado con claridad`',
                        inline: false
                    },
                    {
                        name: '📝 Transcripción de Respuestas Orales',
                        value: evaluation.summaryText && evaluation.summaryText.trim().length > 0
                            ? `>>> *"${evaluation.summaryText}"*`
                            : '*No se capturaron frases audibles suficientes o el micrófono del usuario estaba silenciado.*',
                        inline: false
                    }
                )
                .setFooter({ text: 'SPAIN RP • Ficha de auditoría 100% efímera (0 MB en disco)' })
                .setTimestamp();

            const targetFichasChannelId = botConfig.CHANNEL_ENTREVISTAS_ID;
            let targetChannel = message.channel;

            if (targetFichasChannelId) {
                const fetchedChan = await client.channels.fetch(targetFichasChannelId).catch(() => null);
                if (fetchedChan) {
                    targetChannel = fetchedChan;
                }
            }

            // Enviar el contenedor oficial con la ficha de auditoría oral
            const sentMsg = await targetChannel.send({
                content: `# 🎙️ ¡FICHA DE AUDITORÍA ORAL REGISTRADA!\n# Entrevista realizada a ${session.targetMention}`,
                embeds: [resultEmbed],
                files: files
            });

            // Si se envió a un canal de fichas diferente al chat actual, avisar al entrevistador
            if (targetFichasChannelId && targetFichasChannelId !== message.channel.id) {
                return message.reply({
                    content: `✅ **Entrevista de voz finalizada con éxito.**\n📋 La **Ficha de Auditoría Oral** ha sido registrada en el canal contenedor <#${targetFichasChannelId}>.`
                });
            }

            return;
        }

        // ----------------------------------------------------
        // SISTEMA INDEPENDIENTE: CONVERSACIÓN POR VOZ CON IA (!hablar, !conversar, !ia-voz)
        // ----------------------------------------------------
        if (['!hablar', '!conversar', '!ia-voz', '!charlar'].includes(command)) {
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) {
                return message.reply({ content: '❌ Solo los miembros de **Staff** o el **Creador** pueden iniciar conversaciones de voz con la IA.' });
            }

            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
                return message.reply({ content: '❌ **Debes estar conectado a un canal de voz** para hablar con la IA.' });
            }

            if (activeVoiceChats.has(message.guild.id) || activeVoiceInterviews.has(message.guild.id)) {
                return message.reply({ content: '⚠️ **El bot ya está ocupado en un canal de voz.** Usa `!callar` o `!salir-voz` para terminar la sesión actual.' });
            }

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: voiceChannel.guild.id,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                // Frame de silencio Opus para mantener activo el socket UDP bidireccional de Discord
                class SilenceStream extends Readable {
                    _read() {
                        this.push(Buffer.from([0xF8, 0xFF, 0xFE]));
                    }
                }
                const silenceResource = createAudioResource(new SilenceStream(), { inputType: StreamType.Opus });
                player.play(silenceResource);

                const chatSession = {
                    userId: message.author.id,
                    userName: message.author.username,
                    channelId: message.channel.id,
                    connection,
                    player,
                    isResponding: false,
                    lastInteraction: 0, // Control de ventana de conversación activa
                    history: []
                };

                activeVoiceChats.set(message.guild.id, chatSession);

                const receiver = connection.receiver;
                const activeStreams = new Set();

                const handleVoiceChat = (userId) => {
                    if (userId === client.user.id) return;
                    if (chatSession.isResponding) return; // Si la IA está hablando, ignorar para no interrumpirse
                    if (activeStreams.has(userId)) return;
                    activeStreams.add(userId);

                    // Detección ultrarrápida: 550 ms de silencio para responder de inmediato al callarte
                    const opusStream = receiver.subscribe(userId, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: 550
                        }
                    });

                    const decoder = new prism.opus.Decoder({ rate: 48000, channels: 1, frameSize: 960 });
                    const chunks = [];

                    opusStream.pipe(decoder);
                    decoder.on('data', (c) => chunks.push(c));

                    decoder.on('end', async () => {
                        activeStreams.delete(userId);
                        if (chunks.length === 0) return;
                        const pcm = Buffer.concat(chunks);
                        console.log(`🎙️ [VOZ DETECTADA] Paquete PCM recibido de usuario ${userId}: ${pcm.length} bytes`);

                        // Mínimo 16000 bytes (~0.35s) para descartar clicks/tos/respiraciones
                        if (pcm.length > 16000) {
                            const wav = pcmToWavBuffer(pcm, 48000, 1);
                            const userSaid = await transcribeAudioBufferWithHF(wav);

                            if (userSaid && userSaid.trim().length > 3) {
                                const cleanSaid = userSaid.trim();
                                console.log(`🗣️ [VOZ TRANSCRITA] "${cleanSaid}"`);
                                const lower = cleanSaid.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, '').trim();

                                // Descartar alucinaciones de Whisper comunes producidas por ruido/silencio
                                const noisePhrases = [
                                    'you', 'thank you', 'bye', 'bye bye', 'yeah', 'yes', 'no', 'subtitles by', 'amara.org',
                                    'silence', 'laughter', 'cough', 'music', 'unintelligible', 'thanks for watching',
                                    'subscribe', 'hola', 'goodbye', 'okay', 'ok'
                                ];
                                if (noisePhrases.includes(lower) || lower.length < 4) {
                                    return;
                                }

                                // Debe dirigirse directamente al Bot (ej: "Bot, qué es...", "Oye Bot...", "Bot dime...")
                                const hasBotTrigger = /\b(bot|boc|boot|botsito)\b/i.test(lower);
                                if (!hasBotTrigger) {
                                    return; // Silencio absoluto si no le preguntan a él directamente
                                }

                                // Obtener el nombre del usuario real que habló en la llamada
                                let speakerName = 'Usuario';
                                try {
                                    const member = await message.guild.members.fetch(userId).catch(() => null);
                                    if (member) speakerName = member.displayName || member.user.username;
                                } catch (e) { }

                                chatSession.isResponding = true;

                                // 1. DETECCIÓN DE COMANDOS DE MÚSICA POR VOZ (Parar / Play)
                                const isMusicStop = /\b(para|parar|para la musica|quita la musica|apaga la musica|silencio|stop|callate|mute|pausa|pausar|quita eso|ya|basta)\b/i.test(lower);
                                const isMusicPlay = !isMusicStop && /\b(pon|ponme|reproduce|reproducir|toca|musica de|cancion de|tema de|cancion|musica)\b/i.test(lower);

                                if (isMusicStop) {
                                    player.stop();
                                    const queue = activeMusicQueues.get(message.guild.id);
                                    if (queue) {
                                        queue.songs = [];
                                        queue.isPlaying = false;
                                        if (queue.lastNowPlayingMsg) {
                                            queue.lastNowPlayingMsg.delete().catch(() => { });
                                            queue.lastNowPlayingMsg = null;
                                        }
                                    }

                                    if (activeMusicStreams.has(message.guild.id)) {
                                        const prev = activeMusicStreams.get(message.guild.id);
                                        try { if (prev.ytdlp) prev.ytdlp.kill(); } catch (e) { }
                                        try { if (prev.ffmpeg) prev.ffmpeg.kill(); } catch (e) { }
                                        activeMusicStreams.delete(message.guild.id);
                                    }
                                    const confirmText = '¡Oído cocina! Paro la música ahora mismo crack.';
                                    console.log(`🤖 [VOZ IA RESPUESTA] "${confirmText}"`);
                                    await playTtsResponseInVoice(confirmText, connection, player);
                                    chatSession.isResponding = false;
                                    return;
                                }

                                if (isMusicPlay) {
                                    let songQuery = cleanSaid
                                        .replace(/^(bot|oye bot|hola bot|mira bot|dime bot|escucha bot)[\s,:]*/i, '')
                                        .replace(/^(ponme|pon|reproduce|reproducir|toca|cancion|musica de|cancion de|tema de|en youtube)[\s,:]*/i, '')
                                        .replace(/\b(en youtube|por favor|porfa|crack)\b/ig, '')
                                        .trim();

                                    if (songQuery.length > 2) {
                                        const confirmText = `¡Marchando! Te busco y pongo "${songQuery}" en un momento.`;
                                        console.log(`🤖 [VOZ IA RESPUESTA] "${confirmText}"`);
                                        await playTtsResponseInVoice(confirmText, connection, player);

                                        let cleanTarget = songQuery.trim();
                                        if (cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://')) {
                                            if (cleanTarget.includes('youtube.com/watch') || cleanTarget.includes('youtu.be/')) {
                                                cleanTarget = cleanTarget.split('&')[0];
                                            }
                                        }

                                        const queue = getMusicQueue(message.guild.id);
                                        queue.textChannel = message.channel;
                                        queue.connection = connection;
                                        queue.player = player;

                                        const songItem = {
                                            query: songQuery,
                                            cleanTarget,
                                            requester: speakerName ? `🎙️ **${speakerName}** (Voz)` : `<@${userId}>`,
                                            title: null,
                                            meta: null
                                        };

                                        if (queue.isPlaying) {
                                            const meta = await fetchYouTubeMetadata(cleanTarget);
                                            songItem.meta = meta;
                                            songItem.title = meta.title;
                                            queue.songs.push(songItem);

                                            // Actualizar el contenedor en reproducción con el nuevo conteo de canciones restantes
                                            await updateNowPlayingEmbed(message.guild.id);

                                            const logoPath = path.join(__dirname, 'assets', 'logo.png');
                                            const files = [];
                                            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

                                            const queueAddEmbed = new EmbedBuilder()
                                                .setColor(0x3498DB)
                                                .setAuthor({
                                                    name: 'COLA DE MÚSICA • SPAIN RP',
                                                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                                                })
                                                .setTitle(`📥 Añadida a la Cola (Posición #${queue.songs.length})`)
                                                .setDescription(`🎶 **Título:** \`${meta.title}\`\n⏱️ **Duración:** \`${meta.duration}\`\n👤 **Pedida por:** ${songItem.requester}`)
                                                .setTimestamp();
                                            if (meta.thumbnail) queueAddEmbed.setThumbnail(meta.thumbnail);

                                            if (queue.textChannel) {
                                                queue.textChannel.send({ embeds: [queueAddEmbed], files })
                                                    .then(m => setTimeout(() => m.delete().catch(() => { }), 4000))
                                                    .catch(() => { });
                                            }
                                        } else {
                                            queue.songs = [songItem];
                                            await playNextInQueue(message.guild.id);
                                        }

                                        chatSession.isResponding = false;
                                        return;
                                    }
                                }

                                // 2. CONVERSACIÓN GENERAL / ROLEPLAY POR VOZ
                                const aiReply = await generateAiVoiceChatResponse(cleanSaid, chatSession.history);
                                console.log(`🤖 [VOZ IA RESPUESTA] "${aiReply}"`);

                                chatSession.history.push({ role: 'user', content: cleanSaid });
                                chatSession.history.push({ role: 'assistant', content: aiReply });
                                if (chatSession.history.length > 8) chatSession.history = chatSession.history.slice(-8);

                                try {
                                    await playTtsResponseInVoice(aiReply, connection, player);
                                } finally {
                                    chatSession.isResponding = false;
                                }
                            }
                        }
                    });

                    decoder.on('error', () => activeStreams.delete(userId));
                    opusStream.on('error', () => activeStreams.delete(userId));
                };

                receiver.speaking.on('start', handleVoiceChat);

                const logoPath = path.join(__dirname, 'assets', 'logo.png');
                const files = [];
                if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

                const chatEmbed = new EmbedBuilder()
                    .setColor(0x9B59B6)
                    .setAuthor({
                        name: 'CONVERSACIÓN DE VOZ CON IA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setTitle('🎙️ Chat de Voz con IA Activado')
                    .setDescription(
                        `👤 **Usuario:** <@${message.author.id}>\n` +
                        `🔊 **Canal de Voz:** <#${voiceChannel.id}>\n\n` +
                        `💬 *Dile "Hola Bot..." para iniciar la conversación y a partir de ahí te responderá fluidamente en directo.*\n\n` +
                        `🛑 **Para finalizar:** Escribe **\`!callar\`** o **\`!salir-voz\`**.`
                    )
                    .setFooter({ text: 'SPAIN RP • Conversación Fluida con Microsoft Neural TTS & Gemini Flash' })
                    .setTimestamp();

                return message.reply({ embeds: [chatEmbed], files });
            } catch (err) {
                console.error('Error al iniciar conversación de voz:', err);
                activeVoiceChats.delete(message.guild.id);
                return message.reply({ content: `❌ Error al conectar al canal de voz: ${err.message}` });
            }
        }

        // ----------------------------------------------------
        // ----------------------------------------------------
        // COMANDOS DE MÚSICA DE TEXTO: !play, !stop, !skip, !queue
        // ----------------------------------------------------
        if (['!play', '!p', '!reproducir'].includes(command)) {
            console.log(`\n🎵 [COMANDO MÚSICA !play] Ejecutado por ${message.author.tag} (${message.author.id}) en #${message.channel.name}`);
            console.log(`📥 [INPUT CANCIÓN]: "${args.slice(1).join(' ')}"`);

            // 1. Eliminar el mensaje del usuario inmediatamente y reintentar por si Discord estaba resolviendo el preview
            message.delete().then(() => {
                console.log(`🗑️ [BORRADO EXITOSO] Mensaje de !play del usuario eliminado.`);
            }).catch((err) => {
                console.log(`⚠️ [BORRADO PENDIENTE/ERROR]: ${err.message}`);
            });
            setTimeout(() => message.delete().catch(() => { }), 800);

            // 2. Barrer y limpiar cualquier comando !play / !stop / !skip previo que haya quedado arriba
            try {
                message.channel.messages.fetch({ limit: 10 }).then(recentMsgs => {
                    if (recentMsgs) {
                        for (const [, rMsg] of recentMsgs) {
                            if (!rMsg.author.bot && (
                                rMsg.content.trim().startsWith('!play') ||
                                rMsg.content.trim().startsWith('!p ') ||
                                rMsg.content.trim().startsWith('!reproducir') ||
                                rMsg.content.trim().startsWith('!stop') ||
                                rMsg.content.trim().startsWith('!parar') ||
                                rMsg.content.trim().startsWith('!skip')
                            )) {
                                rMsg.delete().then(() => console.log(`🧹 [BARRIDO] Comando anterior eliminado: "${rMsg.content}"`)).catch(() => { });
                            }
                        }
                    }
                }).catch((err) => console.log('⚠️ [ERROR BARRIDO]:', err.message));
            } catch (e) { }

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const voiceChannel = message.member?.voice?.channel;
            if (!voiceChannel) {
                const noVoiceEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription(`❌ <@${message.author.id}>, **debes estar conectado a un canal de voz** para reproducir música.`);

                return message.channel.send({ embeds: [noVoiceEmbed], files })
                    .then(m => setTimeout(() => m.delete().catch(() => { }), 3500))
                    .catch(() => { });
            }

            const query = args.slice(1).join(' ').trim();
            if (!query) {
                const noQueryEmbed = new EmbedBuilder()
                    .setColor(0x3498DB)
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setTitle('🎵 Uso del Comando de Música')
                    .setDescription('📌 **Uso:** `!play <canción o enlace de YouTube>`\n*Ejemplo:* `!play JC Reyes Messi`');

                return message.channel.send({ embeds: [noQueryEmbed], files })
                    .then(m => setTimeout(() => m.delete().catch(() => { }), 5000))
                    .catch(() => { });
            }

            let connection = getVoiceConnection(message.guild.id);
            let player;

            const chatSession = activeVoiceChats.get(message.guild.id);
            if (chatSession) {
                connection = chatSession.connection;
                player = chatSession.player;
            }

            if (!connection) {
                try {
                    connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });
                    player = createAudioPlayer();
                    connection.subscribe(player);

                    activeVoiceChats.set(message.guild.id, {
                        userId: message.author.id,
                        userName: message.author.username,
                        channelId: message.channel.id,
                        connection,
                        player,
                        isResponding: false,
                        lastInteraction: 0,
                        history: []
                    });
                } catch (e) {
                    const connErr = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setDescription(`❌ Error al conectar al canal de voz: ${e.message}`);
                    return message.channel.send({ embeds: [connErr] }).then(m => setTimeout(() => m.delete().catch(() => { }), 3000)).catch(() => { });
                }
            } else if (!player) {
                player = createAudioPlayer();
                connection.subscribe(player);
            }

            const queue = getMusicQueue(message.guild.id);
            queue.textChannel = message.channel;
            queue.connection = connection;
            queue.player = player;

            // Manejar evento de finalización para avanzar en la cola
            player.removeAllListeners(AudioPlayerStatus.Idle);
            player.on(AudioPlayerStatus.Idle, () => {
                if (queue.isManualSkip) {
                    queue.isManualSkip = false;
                    console.log(`ℹ️ [IDLE CONTROLADO] Salto manual gestionado por comando.`);
                    return;
                }

                console.log(`🎵 [CANCIÓN TERMINADA] Avanzando cola de forma natural...`);
                if (queue.songs.length > 0) {
                    queue.songs.shift(); // Eliminar la que acaba de terminar
                    if (queue.songs.length > 0) {
                        playNextInQueue(message.guild.id);
                    } else {
                        queue.isPlaying = false;
                        if (queue.lastNowPlayingMsg) {
                            queue.lastNowPlayingMsg.delete().catch(() => { });
                            queue.lastNowPlayingMsg = null;
                        }
                    }
                }
            });

            // Limpiar URL si viene de YouTube
            let cleanTarget = query.trim();
            if (cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://')) {
                if (cleanTarget.includes('youtube.com/watch') || cleanTarget.includes('youtu.be/')) {
                    cleanTarget = cleanTarget.split('&')[0];
                }
            }

            const songItem = {
                query,
                cleanTarget,
                requester: `<@${message.author.id}>`,
                title: null,
                meta: null
            };

            if (queue.isPlaying) {
                // Obtener metadatos para la cola
                const meta = await fetchYouTubeMetadata(cleanTarget);
                songItem.meta = meta;
                songItem.title = meta.title;
                queue.songs.push(songItem);

                // Actualizar el contenedor en reproducción con el nuevo conteo de canciones restantes
                await updateNowPlayingEmbed(message.guild.id);

                const queueAddEmbed = new EmbedBuilder()
                    .setColor(0x3498DB) // Azul cola
                    .setAuthor({
                        name: 'COLA DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setTitle(`📥 Añadida a la Cola (Posición #${queue.songs.length})`)
                    .setDescription(`🎶 **Título:** \`${meta.title}\`\n⏱️ **Duración:** \`${meta.duration}\`\n👤 **Pedida por:** <@${message.author.id}>`)
                    .setTimestamp();

                if (meta.thumbnail) queueAddEmbed.setThumbnail(meta.thumbnail);

                const sentAdd = await message.channel.send({ embeds: [queueAddEmbed], files }).catch(() => null);
                if (sentAdd) {
                    setTimeout(() => sentAdd.delete().catch(() => { }), 4000);
                }
                return;
            } else {
                queue.songs = [songItem];
                const searchEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F) // Amarillo Buscando
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription(`🔎 **Buscando y preparando canción:** \`${cleanTarget.substring(0, 70)}\`...`);

                const searchMsg = await message.channel.send({ embeds: [searchEmbed], files }).catch(() => null);
                if (searchMsg) {
                    setTimeout(() => searchMsg.delete().catch(() => { }), 3000);
                }

                await playNextInQueue(message.guild.id);
                return;
            }
        }

        // COMANDO: !stop (Detiene la música y limpia la cola)
        if (['!stop', '!parar', '!detener'].includes(command)) {
            console.log(`\n⏹️ [COMANDO !stop] Ejecutado por ${message.author.tag} en #${message.channel.name}`);
            message.delete().then(() => console.log('🗑️ [BORRADO EXITOSO] Mensaje de !stop eliminado.')).catch(() => { });
            setTimeout(() => message.delete().catch(() => { }), 800);

            const queue = activeMusicQueues.get(message.guild.id);
            if (queue) {
                queue.isManualSkip = true;
                queue.songs = [];
                queue.isPlaying = false;
                if (queue.player) queue.player.stop();
                if (queue.lastNowPlayingMsg) {
                    queue.lastNowPlayingMsg.delete().catch(() => { });
                    queue.lastNowPlayingMsg = null;
                }
            }

            if (activeMusicStreams.has(message.guild.id)) {
                const prev = activeMusicStreams.get(message.guild.id);
                try { if (prev.ytdlp) prev.ytdlp.kill(); } catch (e) { }
                try { if (prev.ffmpeg) prev.ffmpeg.kill(); } catch (e) { }
                activeMusicStreams.delete(message.guild.id);
            }

            const chatSession = activeVoiceChats.get(message.guild.id);
            if (chatSession && chatSession.player) {
                chatSession.player.stop();
            }

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const stopEmbed = new EmbedBuilder()
                .setColor(0xE74C3C) // Rojo stop
                .setAuthor({
                    name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setDescription('⏹️ **Música detenida y cola de reproducción vaciada.**');

            const stopMsg = await message.channel.send({ embeds: [stopEmbed], files }).catch(() => null);
            if (stopMsg) {
                setTimeout(() => stopMsg.delete().catch(() => { }), 3000);
            }
            console.log('✅ [MÚSICA DETENIDA] Audio parado y cola vaciada.');
            return;
        }

        // COMANDO: !skip / !next (Salta a la siguiente canción)
        if (['!skip', '!next', '!saltar', '!siguiente'].includes(command)) {
            console.log(`\n⏭️ [COMANDO !skip] Ejecutado por ${message.author.tag} en #${message.channel.name}`);
            message.delete().then(() => console.log('🗑️ [BORRADO EXITOSO] Mensaje de !skip eliminado.')).catch(() => { });
            setTimeout(() => message.delete().catch(() => { }), 800);

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const queue = activeMusicQueues.get(message.guild.id);
            if (!queue || queue.songs.length === 0 || !queue.isPlaying) {
                const noPlayEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription('❌ **No hay ninguna canción reproduciéndose actualmente.**');

                return message.channel.send({ embeds: [noPlayEmbed], files })
                    .then(m => setTimeout(() => m.delete().catch(() => { }), 3000))
                    .catch(() => { });
            }

            queue.isManualSkip = true;
            const skippedSong = queue.songs.shift(); // Quitar la que estaba sonando
            console.log(`⏭️ [CANCIÓN SALTADA]: "${skippedSong.title || skippedSong.query}" | Restantes en cola: ${queue.songs.length}`);

            if (activeMusicStreams.has(message.guild.id)) {
                const prev = activeMusicStreams.get(message.guild.id);
                try { if (prev.ytdlp) prev.ytdlp.kill(); } catch (e) { }
                try { if (prev.ffmpeg) prev.ffmpeg.kill(); } catch (e) { }
                activeMusicStreams.delete(message.guild.id);
            }
            if (queue.player) queue.player.stop();

            if (queue.songs.length > 0) {
                const skipEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71) // Verde skip
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription(`⏭️ **Canción saltada:** \`${skippedSong.title || skippedSong.query}\`\n▶️ *Cargando siguiente tema (${queue.songs.length} restantes)...*`);

                const sentSkip = await message.channel.send({ embeds: [skipEmbed], files }).catch(() => null);
                if (sentSkip) {
                    setTimeout(() => sentSkip.delete().catch(() => { }), 3000);
                }
                await playNextInQueue(message.guild.id);
            } else {
                queue.isPlaying = false;
                if (queue.lastNowPlayingMsg) {
                    queue.lastNowPlayingMsg.delete().catch(() => { });
                    queue.lastNowPlayingMsg = null;
                }

                const skipEndEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6) // Gris
                    .setAuthor({
                        name: 'REPRODUCTOR DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription(`⏭️ **Canción saltada:** \`${skippedSong.title || skippedSong.query}\`\n⏹️ *No quedan más canciones en la cola.*`);

                const sentSkipEnd = await message.channel.send({ embeds: [skipEndEmbed], files }).catch(() => null);
                if (sentSkipEnd) {
                    setTimeout(() => sentSkipEnd.delete().catch(() => { }), 3000);
                }
            }
            return;
        }

        // COMANDO: !queue / !cola (Muestra las canciones en espera)
        if (['!queue', '!cola', '!playlist'].includes(command)) {
            await message.delete().catch(() => { });

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const queue = activeMusicQueues.get(message.guild.id);
            if (!queue || queue.songs.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setAuthor({
                        name: 'COLA DE MÚSICA • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription('📭 **La cola de música está vacía.** Usa `!play <canción>` para añadir temas.');

                return message.channel.send({ embeds: [emptyEmbed], files })
                    .then(m => setTimeout(() => m.delete().catch(() => { }), 4000))
                    .catch(() => { });
            }

            let queueDesc = '';
            queue.songs.slice(0, 10).forEach((s, idx) => {
                const songTitle = s.meta ? s.meta.title : (s.title || s.query);
                const songDuration = s.meta ? `\`(${s.meta.duration})\`` : '';
                queueDesc += `${idx === 0 ? '▶️ **[Sonando Ahora]**' : `\`#${idx + 1}\``} **${songTitle}** ${songDuration}\n> Pedida por: ${s.requester}\n\n`;
            });

            if (queue.songs.length > 10) {
                queueDesc += `*... y ${queue.songs.length - 10} canciones más en espera.*`;
            }

            const queueEmbed = new EmbedBuilder()
                .setColor(0x8A2BE2) // Violeta
                .setAuthor({
                    name: 'COLA DE REPRODUCCIÓN • SPAIN RP',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setTitle(`🎶 Lista de Espera (${queue.songs.length} temas)`)
                .setDescription(queueDesc)
                .setFooter({ text: 'Usa !skip para saltar al siguiente tema' })
                .setTimestamp();

            const sentQueue = await message.channel.send({ embeds: [queueEmbed], files }).catch(() => null);
            if (sentQueue) {
                setTimeout(() => sentQueue.delete().catch(() => { }), 12000);
            }
            return;
        }

        // COMANDO: !callar / !salir-voz (Desconecta al bot de voz)
        if (['!cancelar-entrevista', '!salir-voz', '!kick-voz', '!callar', '!desconectar-voz', '!leave'].includes(command)) {
            await message.delete().catch(() => { });

            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));

            const queue = activeMusicQueues.get(message.guild.id);
            if (queue) {
                queue.songs = [];
                queue.isPlaying = false;
                if (queue.player) queue.player.stop();
                if (queue.lastNowPlayingMsg) {
                    queue.lastNowPlayingMsg.delete().catch(() => { });
                    queue.lastNowPlayingMsg = null;
                }
                activeMusicQueues.delete(message.guild.id);
            }

            if (activeMusicStreams.has(message.guild.id)) {
                const prev = activeMusicStreams.get(message.guild.id);
                try { if (prev.ytdlp) prev.ytdlp.kill(); } catch (e) { }
                try { if (prev.ffmpeg) prev.ffmpeg.kill(); } catch (e) { }
                activeMusicStreams.delete(message.guild.id);
            }

            const chatSession = activeVoiceChats.get(message.guild.id);
            if (chatSession) {
                try { if (chatSession.connection) chatSession.connection.destroy(); } catch (e) { }
                activeVoiceChats.delete(message.guild.id);

                const leaveEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({
                        name: 'SISTEMA DE VOZ • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription('👋 **Sesión de voz y música finalizada. Bot desconectado.**');

                return message.channel.send({ embeds: [leaveEmbed], files }).then(m => setTimeout(() => m.delete().catch(() => { }), 3000)).catch(() => { });
            }

            const session = activeVoiceInterviews.get(message.guild.id);
            if (session) {
                try { if (session.connection) session.connection.destroy(); } catch (e) { }
                activeVoiceInterviews.delete(message.guild.id);

                const interviewCancelEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({
                        name: 'SISTEMA DE VOZ • SPAIN RP',
                        iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                    })
                    .setDescription('🛑 **Entrevista de voz cancelada y bot desconectado del canal.**');

                return message.channel.send({ embeds: [interviewCancelEmbed], files }).then(m => setTimeout(() => m.delete().catch(() => { }), 3000)).catch(() => { });
            } else {
                const connection = getVoiceConnection(message.guild.id);
                if (connection) {
                    connection.destroy();
                    const discEmbed = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setAuthor({
                            name: 'SISTEMA DE VOZ • SPAIN RP',
                            iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                        })
                        .setDescription('👋 **Bot desconectado del canal de voz.**');

                    return message.channel.send({ embeds: [discEmbed], files }).then(m => setTimeout(() => m.delete().catch(() => { }), 3000)).catch(() => { });
                }

                const notConnEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setDescription('ℹ️ El bot no está conectado a ningún canal de voz.');
                return message.channel.send({ embeds: [notConnEmbed] }).then(m => setTimeout(() => m.delete().catch(() => { }), 3000)).catch(() => { });
            }
        }

        // COMANDO: !notificarstream / !panelstream (Publica el Panel de Directos Oficial)
        if (['!notificarstream', '!panelstream', '!paneldirectos', '!streampanel'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) {
                const noPermsMsg = await message.channel.send('❌ Solo los miembros de **Staff** o el **Creador** pueden usar este comando.').catch(() => null);
                if (noPermsMsg) setTimeout(() => noPermsMsg.delete().catch(() => { }), 4000);
                return;
            }

            const embed = buildStreamPanelEmbed();
            const row = buildStreamPanelRow();
            const files = [];
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const imgPanelPath = path.join(__dirname, 'assets', 'panel_directos.png');
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            if (fs.existsSync(imgPanelPath)) files.push(new AttachmentBuilder(imgPanelPath, { name: 'panel_directos.png' }));

            await message.channel.send({
                embeds: [embed],
                components: [row],
                files
            });
            console.log(`🟣 [PANEL DIRECTOS] Panel enviado por ${message.author.tag} en #${message.channel.name}`);
            return;
        }

        // ==========================================
        // COMANDOS DE STREAMERS: !addtwitch / !addtiktok / !addstreamer
        // ==========================================
        if (['!addtwitch', '!agregartwitch', '!nuevotwitch', '!settwitch'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first();
            // Filtrar y buscar la URL o nombre de usuario
            const cleanArgs = args.filter(a => !a.startsWith('<@') && a !== command && !a.startsWith('!'));
            const urlArg = cleanArgs.find(a => a.startsWith('http') || a.includes('twitch.tv') || a.includes('.tv/')) || cleanArgs[0];

            if (!targetUser || !urlArg) {
                const helpMsg = await message.channel.send({
                    content: '🟣 **Uso correcto:** `!addtwitch @usuario <enlace_o_usuario_twitch> [título opcional]`\n*Ejemplo:* `!addtwitch @Alvin https://twitch.tv/alvin_0803`'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 6000);
                return;
            }

            let fullUrl = urlArg.startsWith('http') ? urlArg : `https://twitch.tv/${urlArg.replace(/^@/, '')}`;
            const customTitle = cleanArgs.filter(a => a !== urlArg).join(' ').trim();

            saveStreamer(targetUser.id, {
                twitchUrl: fullUrl,
                twitchTitle: customTitle || null,
                name: targetUser.username
            });

            const successEmbed = new EmbedBuilder()
                .setColor(0x9146FF) // Morado Twitch
                .setAuthor({
                    name: 'SISTEMA DE STREAMERS | TWITCH • SPAIN RP 🇪🇸',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle('🟣 ¡Canal de Twitch Registrado con Éxito!')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `✨ Se ha configurado el canal oficial de **Twitch** para el streamer.\n\n` +
                    `👤 **Streamer:** <@${targetUser.id}>\n` +
                    `📺 **Plataforma:** \`Twitch\`\n` +
                    `🔗 **Canal:** [${fullUrl}](${fullUrl})\n` +
                    (customTitle ? `🏷️ **Título por defecto:** *"${customTitle}"*\n` : '') +
                    `\n> 💡 *Al pulsar **"Notificar Twitch"** en el panel se publicará este canal.*`
                )
                .setFooter({ text: 'SPAIN RP • Creadores de Contenido Oficiales' })
                .setTimestamp();

            const successMsg = await message.channel.send({ embeds: [successEmbed] }).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 10000);
            return;
        }

        if (['!addtiktok', '!agregartiktok', '!nuevotiktok', '!settiktok'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first();
            const cleanArgs = args.filter(a => !a.startsWith('<@') && a !== command && !a.startsWith('!'));
            const urlArg = cleanArgs.find(a => a.startsWith('http') || a.includes('tiktok.com') || a.includes('.com/@')) || cleanArgs[0];

            if (!targetUser || !urlArg) {
                const helpMsg = await message.channel.send({
                    content: '🌸 **Uso correcto:** `!addtiktok @usuario <enlace_o_usuario_tiktok> [título opcional]`\n*Ejemplo:* `!addtiktok @Alvin https://www.tiktok.com/@alvin_armys`'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 6000);
                return;
            }

            let fullUrl = urlArg.startsWith('http') ? urlArg : `https://www.tiktok.com/@${urlArg.replace(/^@/, '')}`;
            const customTitle = cleanArgs.filter(a => a !== urlArg).join(' ').trim();

            saveStreamer(targetUser.id, {
                tiktokUrl: fullUrl,
                tiktokTitle: customTitle || null,
                name: targetUser.username
            });

            const successEmbed = new EmbedBuilder()
                .setColor(0xFE2C55) // Rosa TikTok
                .setAuthor({
                    name: 'SISTEMA DE STREAMERS | TIKTOK • SPAIN RP 🇪🇸',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle('🌸 ¡Canal de TikTok Registrado con Éxito!')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `✨ Se ha configurado el canal oficial de **TikTok LIVE** para el streamer.\n\n` +
                    `👤 **Streamer:** <@${targetUser.id}>\n` +
                    `📺 **Plataforma:** \`TikTok LIVE\`\n` +
                    `🔗 **Canal:** [${fullUrl}](${fullUrl})\n` +
                    (customTitle ? `🏷️ **Título por defecto:** *"${customTitle}"*\n` : '') +
                    `\n> 💡 *Al pulsar **"Notificar TikTok"** en el panel se publicará este canal.*`
                )
                .setFooter({ text: 'SPAIN RP • Creadores de Contenido Oficiales' })
                .setTimestamp();

            const successMsg = await message.channel.send({ embeds: [successEmbed] }).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 10000);
            return;
        }

        if (['!addkick', '!agregarkick', '!nuevokick', '!setkick'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first();
            const cleanArgs = args.filter(a => !a.startsWith('<@') && a !== command && !a.startsWith('!'));
            const urlArg = cleanArgs.find(a => a.startsWith('http') || a.includes('kick.com') || a.includes('.com/')) || cleanArgs[0];

            if (!targetUser || !urlArg) {
                const helpMsg = await message.channel.send({
                    content: '🟢 **Uso correcto:** `!addkick @usuario <enlace_o_usuario_kick> [título opcional]`\n*Ejemplo:* `!addkick @Alvin https://kick.com/alvin_rp`'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 6000);
                return;
            }

            let fullUrl = urlArg.startsWith('http') ? urlArg : `https://kick.com/${urlArg.replace(/^@/, '')}`;
            const customTitle = cleanArgs.filter(a => a !== urlArg).join(' ').trim();

            saveStreamer(targetUser.id, {
                kickUrl: fullUrl,
                kickTitle: customTitle || null,
                name: targetUser.username
            });

            const successEmbed = new EmbedBuilder()
                .setColor(0x53FC18) // Verde Kick
                .setAuthor({
                    name: 'SISTEMA DE STREAMERS | KICK • SPAIN RP 🇪🇸',
                    iconURL: client.user.displayAvatarURL()
                })
                .setTitle('🟢 ¡Canal de Kick Registrado con Éxito!')
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `✨ Se ha configurado el canal oficial de **Kick** para el streamer.\n\n` +
                    `👤 **Streamer:** <@${targetUser.id}>\n` +
                    `📺 **Plataforma:** \`Kick\`\n` +
                    `🔗 **Canal:** [${fullUrl}](${fullUrl})\n` +
                    (customTitle ? `🏷️ **Título por defecto:** *"${customTitle}"*\n` : '') +
                    `\n> 💡 *Al pulsar **"Notificar Kick"** en el panel se publicará este canal.*`
                )
                .setFooter({ text: 'SPAIN RP • Creadores de Contenido Oficiales' })
                .setTimestamp();

            const successMsg = await message.channel.send({ embeds: [successEmbed] }).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 10000);
            return;
        }

        // COMANDO GENERAL: !addstreamer @usuario <url_canal>
        if (['!addstreamer', '!agregarstreamer', '!nuevostreamer'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first();
            const remainingArgs = args.filter(a => !a.startsWith('<@'));

            if (!targetUser || remainingArgs.length === 0) {
                const helpMsg = await message.channel.send({
                    content: '⚠️ **Uso:**\n• `!addtwitch @usuario <url_twitch>` (Para Twitch)\n• `!addkick @usuario <url_kick>` (Para Kick)\n• `!addtiktok @usuario <url_tiktok>` (Para TikTok)\n• `!addstreamer @usuario <url>` (Detecta automáticamente)'
                }).catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 6000);
                return;
            }

            const rawInput = remainingArgs[0];
            let fullUrl = rawInput.startsWith('http') ? rawInput : (rawInput.includes('tiktok') ? `https://www.tiktok.com/@${rawInput.replace(/^@/, '')}` : (rawInput.includes('kick') ? `https://kick.com/${rawInput.replace(/^@/, '')}` : `https://twitch.tv/${rawInput.replace(/^@/, '')}`));
            let isTikTok = fullUrl.includes('tiktok.com');
            let isKick = fullUrl.includes('kick.com');
            let isTwitch = fullUrl.includes('twitch.tv') || (!isTikTok && !isKick);
            let platform = isTikTok ? 'TikTok' : (isKick ? 'Kick' : 'Twitch');

            saveStreamer(targetUser.id, {
                tiktokUrl: isTikTok ? fullUrl : undefined,
                kickUrl: isKick ? fullUrl : undefined,
                twitchUrl: isTwitch ? fullUrl : undefined,
                name: targetUser.username
            });

            const successMsg = await message.channel.send({
                content: `✅ **Streamer registrado:** <@${targetUser.id}> en \`${platform}\` -> <${fullUrl}>`
            }).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => { }), 6000);
            return;
        }

        // COMANDO: !delstreamer @usuario [twitch/tiktok/todo]
        if (['!delstreamer', '!eliminarstreamer', '!quitarstreamer'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetUser = message.mentions.users.first() || { id: args[0]?.replace(/[<@!>]/g, '') };
            if (!targetUser || !targetUser.id) {
                const helpMsg = await message.channel.send('⚠️ **Uso:** `!delstreamer @usuario`').catch(() => null);
                if (helpMsg) setTimeout(() => helpMsg.delete().catch(() => { }), 5000);
                return;
            }

            const removed = removeStreamer(targetUser.id);
            const msg = removed
                ? `🗑️ Streamer <@${targetUser.id}> eliminado de la base de datos de directos.`
                : `⚠️ El usuario <@${targetUser.id}> no estaba registrado.`;

            const resMsg = await message.channel.send(msg).catch(() => null);
            if (resMsg) setTimeout(() => resMsg.delete().catch(() => { }), 5000);
            return;
        }

        // COMANDO: !streamers (Lista de streamers registrados)
        if (['!streamers', '!listastreamers'].includes(command)) {
            await message.delete().catch(() => { });
            const streamers = getStreamersData();
            const keys = Object.keys(streamers);

            if (keys.length === 0) {
                const emptyMsg = await message.channel.send('ℹ️ No hay streamers registrados manualmente aún. Usa `!addtwitch`, `!addkick` o `!addtiktok`').catch(() => null);
                if (emptyMsg) setTimeout(() => emptyMsg.delete().catch(() => { }), 6000);
                return;
            }

            let desc = '';
            for (const uid of keys) {
                const st = streamers[uid] || {};
                let platformsText = [];
                if (st.twitchUrl) platformsText.push(`🟣 **Twitch:** [Ver Canal](${st.twitchUrl})`);
                if (st.kickUrl) platformsText.push(`🟢 **Kick:** [Ver Canal](${st.kickUrl})`);
                if (st.tiktokUrl) platformsText.push(`🌸 **TikTok:** [Ver LIVE](${st.tiktokUrl})`);
                if (st.url && !st.twitchUrl && !st.kickUrl && !st.tiktokUrl) {
                    if (st.url.includes('kick.com')) platformsText.push(`🟢 **Kick:** [Ver Canal](${st.url})`);
                    else if (st.url.includes('tiktok.com')) platformsText.push(`🌸 **TikTok:** [Ver LIVE](${st.url})`);
                    else if (st.url.includes('twitch.tv')) platformsText.push(`🟣 **Twitch:** [Ver Canal](${st.url})`);
                    else platformsText.push(`🔗 [${st.platform || 'Canal'}](${st.url})`);
                }
                if (platformsText.length === 0) {
                    platformsText.push(`🔗 *Canal configurado* (${st.name || 'Sin enlace directo'})`);
                }

                desc += `> 👤 <@${uid}>\n> ${platformsText.join('\n> ')}\n\n`;
            }

            const listEmbed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('🟣 Base de Datos de Creadores y Streamers (SPAIN RP)')
                .setDescription(desc)
                .setFooter({ text: 'SPAIN RP • Usa !addtwitch, !addkick o !addtiktok' })
                .setTimestamp();

            const listMsg = await message.channel.send({ embeds: [listEmbed] }).catch(() => null);
            if (listMsg) setTimeout(() => listMsg.delete().catch(() => { }), 20000);
            return;
        }

        // COMANDO: !limpiarstreamers / !limiarstreamers (Elimina todos los streamers registrados en el bot)
        if (['!limpiarstreamers', '!limiarstreamers', '!clearstreamers', '!borrarstreamers', '!vaciarstreamers'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const prevData = getStreamersData();
            const count = Object.keys(prevData).length;
            clearAllStreamers();

            const clearMsg = await message.channel.send({
                content: `🧹 **Lista de streamers vaciada con éxito:** Se han eliminado los **${count}** streamer(s) registrados en el bot.`
            }).catch(() => null);
            if (clearMsg) setTimeout(() => clearMsg.delete().catch(() => { }), 6000);
            console.log(`🧹 [STREAMERS] Lista de streamers vaciada por ${message.author.tag} (${count} eliminados).`);
            return;
        }

        // ====================================================
        // COMANDOS DE CONFIGURACIÓN DE CANAL PARA SANCIONES
        // ====================================================

        // 1. Configurar dónde se PUBLICAN los expedientes de sanciones oficiales
        if (['!setcanal-sanciones', '!setcanal-sancion', '!canalsanciones', '!fijar-sanciones'].includes(command) ||
            (['!setcanal', '!fijar-canal', '!canal'].includes(command) && ['sancion', 'sanciones', 'expedientes', 'logs-sanciones'].includes(args[1]?.toLowerCase()))) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            // Extraer posible ID o mención de cualquier argumento
            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_SANCIONES_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('🚨 Canal de Publicación de Sanciones Configurado')
                .setDescription(`✅ Los expedientes de sanciones y actas disciplinarias se publicarán ahora en: <#${targetChannel.id}> (\`${targetChannel.id}\`)`)
                .setFooter({ text: 'SPAIN RP • Configuración Oficial de Moderación' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal de publicaciones de sanciones fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        // 2. Configurar dónde se fija o envía el PANEL para que el Staff registre sanciones
        if (['!setcanal-panel-sanciones', '!setcanal-panelsanciones', '!canalpanelsanciones', '!fijar-panel-sanciones'].includes(command) ||
            (['!setcanal', '!fijar-canal', '!canal'].includes(command) && ['panel-sancion', 'panel-sanciones', 'panelsanciones', 'panelsancion', 'formulario-sanciones'].includes(args[1]?.toLowerCase()))) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_SANCIONES_PANEL_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('📋 Canal del Panel de Sanciones Configurado')
                .setDescription(`✅ El canal asignado para el Panel interactivo de Sanciones es: <#${targetChannel.id}> (\`${targetChannel.id}\`)\n\n💡 *Puedes enviar el panel allí escribiendo **\`!panel-sanciones\`**.*`)
                .setFooter({ text: 'SPAIN RP • Configuración Oficial de Moderación' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal del panel de sanciones fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        // 3. COMANDO: !panel-sanciones / !panelsanciones / !enviar-panel-sanciones (Envía el panel interactivo al canal actual o especificado)
        if (['!panel-sanciones', '!panelsanciones', '!enviar-panel-sanciones'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) return;

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }

            if (!targetChannel) targetChannel = message.channel;

            const embed = buildSancionesPanelEmbed();
            const row = buildSancionesPanelRow();
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const bannerPath = path.join(__dirname, 'assets', 'panel_sanciones.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            if (fs.existsSync(bannerPath)) files.push(new AttachmentBuilder(bannerPath, { name: 'panel_sanciones.png' }));

            await targetChannel.send({
                embeds: [embed],
                components: [row],
                files
            }).catch(e => console.error('Error al enviar panel de sanciones:', e));

            console.log(`🚨 [PANEL SANCIONES] Panel interactivo de sanciones enviado con éxito a #${targetChannel.name} por ${message.author.tag}`);
            return;
        }

        // ====================================================
        // COMANDOS DE CONFIGURACIÓN DE CANAL PARA EVENTOS
        // ====================================================

        // 1. Configurar dónde se PUBLICAN los eventos oficiales (Canal 1 Principal)
        if (['!setcanal-eventos', '!setcanal-evento', '!canaleventos', '!fijar-eventos'].includes(command) ||
            (['!setcanal', '!fijar-canal', '!canal'].includes(command) && ['evento', 'eventos', 'anuncios-eventos', 'canal-eventos', 'eventos1', 'evento1'].includes(args[1]?.toLowerCase()))) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_EVENTOS_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0x00E5FF)
                .setTitle('🎉 Canal Principal de Eventos Configurado')
                .setDescription(`✅ Los anuncios oficiales de eventos se publicarán ahora en el **Canal 1**: <#${targetChannel.id}> (\`${targetChannel.id}\`)`)
                .setFooter({ text: 'SPAIN RP • Configuración Oficial de Eventos' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal 1 de eventos fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        // 1.2 Configurar el SEGUNDO CANAL donde se duplican los eventos oficiales (Canal 2 Secundario)
        if (['!setcanal-eventos2', '!setcanal-evento2', '!canaleventos2', '!fijar-eventos2'].includes(command) ||
            (['!setcanal', '!fijar-canal', '!canal'].includes(command) && ['evento2', 'eventos2', 'anuncios-eventos2', 'canal-eventos2', 'segundo-eventos'].includes(args[1]?.toLowerCase()))) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_EVENTOS_2_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0x00E5FF)
                .setTitle('🎉 Segundo Canal de Eventos Configurado (Dual-Channel)')
                .setDescription(`✅ Los anuncios de eventos se enviarán **también** al **Canal 2**: <#${targetChannel.id}> (\`${targetChannel.id}\`)\n\n*(Ahora cada evento se publicará a la vez en ambos canales).*`)
                .setFooter({ text: 'SPAIN RP • Publicación Simultánea de Eventos' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal 2 de eventos fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        // 2. Configurar dónde se fija o envía el PANEL para que el Staff publique eventos
        if (['!setcanal-panel-eventos', '!setcanal-paneleventos', '!canalpaneleventos', '!fijar-panel-eventos'].includes(command) ||
            (['!setcanal', '!fijar-canal', '!canal'].includes(command) && ['panel-evento', 'panel-eventos', 'paneleventos', 'panelevento', 'formulario-eventos'].includes(args[1]?.toLowerCase()))) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_EVENTOS_PANEL_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0x00E5FF)
                .setTitle('📋 Canal del Panel de Eventos Configurado')
                .setDescription(`✅ El canal asignado para el Panel interactivo de Eventos es: <#${targetChannel.id}> (\`${targetChannel.id}\`)\n\n💡 *Puedes enviar el panel allí escribiendo **\`!panel-eventos\`**.*`)
                .setFooter({ text: 'SPAIN RP • Configuración Oficial de Eventos' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal del panel de eventos fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        // 3. COMANDO: !panel-eventos / !paneleventos / !enviar-panel-eventos (Envía el panel interactivo de eventos)
        if (['!panel-eventos', '!panel-evento', '!paneleventos', '!panelevento', '!enviar-panel-eventos'].includes(command)) {
            await message.delete().catch(() => { });
            const hasStaff = await isStaffMember(message.member, message.guild, message.author.id);
            if (!hasStaff) return;

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }

            if (!targetChannel) targetChannel = message.channel;

            const embed = buildEventosPanelEmbed();
            const row = buildEventosPanelRow();
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const bannerPath = path.join(__dirname, 'assets', 'panel_eventos.png');
            const files = [];
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            if (fs.existsSync(bannerPath)) files.push(new AttachmentBuilder(bannerPath, { name: 'panel_eventos.png' }));

            await targetChannel.send({
                embeds: [embed],
                components: [row],
                files
            }).catch(e => console.error('Error al enviar panel de eventos:', e));

            console.log(`🎉 [PANEL EVENTOS] Panel interactivo de eventos enviado con éxito a #${targetChannel.name} por ${message.author.tag}`);
            return;
        }

        // ====================================================
        // COMANDOS DE BIENVENIDAS: !setcanal-bienvenidas / !test-bienvenida
        // ====================================================
        if (['!setcanal-bienvenidas', '!setcanal-bienvenida', '!canal-bienvenidas', '!fijar-bienvenidas'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const rawChannelId = args.slice(1).join(' ').match(/\d{17,20}/)?.[0];
            let targetChannel = message.mentions.channels.first();

            if (!targetChannel && rawChannelId) {
                targetChannel = message.guild.channels.cache.get(rawChannelId) ||
                    await client.channels.fetch(rawChannelId).catch(() => null);
            }
            if (!targetChannel) targetChannel = message.channel;

            await updateConfig('CHANNEL_BIENVENIDAS_ID', targetChannel.id);

            const confEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('👋 Canal de Bienvenidas Configurado')
                .setDescription(`✅ Los mensajes de bienvenida con contenedor y banner se publicarán en: <#${targetChannel.id}> (\`${targetChannel.id}\`)\n\n💡 *Puedes probar cómo queda escribiendo **\`!test-bienvenida\`**.*`)
                .setFooter({ text: 'SPAIN RP • Sistema Oficial de Bienvenidas' })
                .setTimestamp();

            const confMsg = await message.channel.send({ embeds: [confEmbed] }).catch(() => null);
            if (confMsg) setTimeout(() => confMsg.delete().catch(() => { }), 8000);
            console.log(`🔧 [CONFIG] Canal de bienvenidas fijado en #${targetChannel.name || targetChannel.id} (${targetChannel.id}) por ${message.author.tag}`);
            return;
        }

        if (['!bpruebas', '!test-bienvenida', '!probar-bienvenida', '!test-welcome', '!pbienvenida', '!bp'].includes(command)) {
            await message.delete().catch(() => { });
            if (message.author.id !== OWNER_ID) {
                return sendDeniedAccessMessage(message);
            }

            const targetMember = message.mentions.members.first() || message.member;
            const { welcomeEmbed, files } = buildWelcomeEmbed(targetMember, message.guild);

            await message.channel.send({
                content: `❗ **Bienvenid@,** <@${targetMember.id}> ❗ *(Mensaje de prueba)*`,
                embeds: [welcomeEmbed],
                files: files
            }).catch(e => console.error('Error al probar mensaje de bienvenida:', e));

            console.log(`✨ [TEST BIENVENIDA] Prueba de bienvenida enviada en #${message.channel.name} por ${message.author.tag}`);
            return;
        }
    }

    // Si se envía un mensaje en el canal oficial de valoraciones (incluso por otros bots/admins), auto-sincronizar y actualizar el Top
    if (botConfig.CHANNEL_VALORACIONES_ID && message.channel.id === botConfig.CHANNEL_VALORACIONES_ID) {
        const parsed = parseRatingFromMessage(message);
        if (parsed) {
            const currentData = getStaffRatingsData();
            const existingRatings = currentData.ratings || [];
            const isDuplicate = existingRatings.some(r => r.id === parsed.id || (r.staffId === parsed.staffId && r.userId === parsed.userId && r.rating === parsed.rating && Math.abs(new Date(r.timestamp).getTime() - new Date(parsed.timestamp).getTime()) < 60000));
            if (!isDuplicate) {
                existingRatings.push(parsed);
                if (!currentData.staffList.includes(parsed.staffId)) {
                    currentData.staffList.push(parsed.staffId);
                }
                currentData.ratings = existingRatings;
                saveStaffRatingsData(currentData);
                await updateStaffTopRankingPanel().catch(() => { });
                console.log(`⭐ [VALORACIÓN EN VIVO] Valoración registrada para Staff ${parsed.staffTag} (${parsed.rating}/10). Panel de Tops actualizado.`);
            }
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
            const imgPanelPath = path.join(__dirname, 'assets', 'panel_directos.png');
            if (fs.existsSync(logoPath)) files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            if (fs.existsSync(imgPanelPath)) files.push(new AttachmentBuilder(imgPanelPath, { name: 'panel_directos.png' }));

            await interaction.channel.send({
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

    // ----------------------------------------------------
    // SELECTOR DE STAFF: ABRIR MODAL DIRECTAMENTE AL ELEGIR
    // ----------------------------------------------------
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_staff_to_rate') {
        const targetStaffId = interaction.values[0];

        // Obtener nombre desde la caché local de forma instantánea (0ms)
        const cachedMember = interaction.guild?.members?.cache?.get(targetStaffId);
        const staffDisplayName = cachedMember ? (cachedMember.displayName || cachedMember.user.username) : 'Staff';

        const modal = new ModalBuilder()
            .setCustomId(`modal_valorar_staff_${targetStaffId}`)
            .setTitle(`⭐ Valorar a ${staffDisplayName}`.slice(0, 45));

        const ratingInput = new TextInputBuilder()
            .setCustomId('input_staff_rating')
            .setLabel('Puntuación del 1 al 10')
            .setPlaceholder('Escribe tu puntuación: 10, 9, 8...')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(2);

        const commentInput = new TextInputBuilder()
            .setCustomId('input_staff_comment')
            .setLabel('Opinión sobre la atención recibida')
            .setPlaceholder('Describe cómo te atendió, rapidez, amabilidad o trato recibido...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(800);

        modal.addComponents(
            new ActionRowBuilder().addComponents(ratingInput),
            new ActionRowBuilder().addComponents(commentInput)
        );

        return interaction.showModal(modal).catch(err => {
            console.error('Error al mostrar modal de valoraciones:', err);
        });
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
    // BOTONES: NOTIFICAR DIRECTO (TWITCH / KICK / TIKTOK / GENERAL)
    // ----------------------------------------------------
    if (['btn_notificar_directo', 'btn_notificar_twitch', 'btn_notificar_kick', 'btn_notificar_tiktok'].includes(interaction.customId)) {
        // Responder a Discord DE INMEDIATO (dentro de los 3 segundos reglamentarios de la API de Discord)
        await interaction.deferReply({ ephemeral: true }).catch(() => { });

        try {
            const userId = interaction.user.id;
            let requestedPlatform = null;
            if (interaction.customId === 'btn_notificar_kick') requestedPlatform = 'Kick';
            else if (interaction.customId === 'btn_notificar_tiktok') requestedPlatform = 'TikTok';
            else if (interaction.customId === 'btn_notificar_twitch') requestedPlatform = 'Twitch';

            const streamersData = getStreamersData();
            let streamerInfo = streamersData[userId] || {};

            let targetStreamUrl = null;
            let activePlatform = requestedPlatform || 'Twitch';

            // 1. Buscar en perfil guardado según la plataforma solicitada
            if (requestedPlatform === 'Kick') {
                targetStreamUrl = streamerInfo.kickUrl || (streamerInfo.url && streamerInfo.url.includes('kick.com') ? streamerInfo.url : null);
            } else if (requestedPlatform === 'TikTok') {
                targetStreamUrl = streamerInfo.tiktokUrl || (streamerInfo.url && streamerInfo.url.includes('tiktok.com') ? streamerInfo.url : null);
            } else if (requestedPlatform === 'Twitch') {
                targetStreamUrl = streamerInfo.twitchUrl || (streamerInfo.url && (streamerInfo.url.includes('twitch.tv') || (!streamerInfo.url.includes('kick.com') && !streamerInfo.url.includes('tiktok.com'))) ? streamerInfo.url : null);
            } else {
                targetStreamUrl = streamerInfo.url || streamerInfo.kickUrl || streamerInfo.twitchUrl || streamerInfo.tiktokUrl;
                activePlatform = streamerInfo.platform || 'Twitch';
            }

            // 2. Si no tiene URL específica para la plataforma pulsada, comprobar su presencia activa en Discord
            if (!targetStreamUrl) {
                const streamingActivity = interaction.member?.presence?.activities?.find(act =>
                    act.type === ActivityType.Streaming ||
                    (act.url && (act.url.includes('twitch.tv') || act.url.includes('kick.com') || act.url.includes('youtube.com') || act.url.includes('tiktok.com')))
                );

                if (streamingActivity && streamingActivity.url) {
                    if (requestedPlatform === 'Kick' && streamingActivity.url.includes('kick.com')) {
                        targetStreamUrl = streamingActivity.url;
                    } else if (requestedPlatform === 'TikTok' && streamingActivity.url.includes('tiktok.com')) {
                        targetStreamUrl = streamingActivity.url;
                    } else if (requestedPlatform === 'Twitch' && (streamingActivity.url.includes('twitch.tv') || (!streamingActivity.url.includes('kick.com') && !streamingActivity.url.includes('tiktok.com')))) {
                        targetStreamUrl = streamingActivity.url;
                    } else if (!requestedPlatform) {
                        targetStreamUrl = streamingActivity.url;
                        if (streamingActivity.url.includes('kick.com')) activePlatform = 'Kick';
                        else if (streamingActivity.url.includes('tiktok.com')) activePlatform = 'TikTok';
                    }
                }
            }

            // 3. Si sigue sin tener canal específico para esa plataforma pero tiene nombre de usuario
            if (!targetStreamUrl) {
                const platMsg = requestedPlatform ? ` de **${requestedPlatform}**` : '';
                return interaction.editReply({
                    content: `❌ **No tienes un canal${platMsg} registrado en el bot.**\n\n📌 Para poder notificar en **${requestedPlatform || 'esta plataforma'}**, un Administrador debe añadir tu canal con:\n\`!addstreamer @${interaction.user.username} <enlace_${(requestedPlatform || 'twitch').toLowerCase()}>\`\n💬 *Si eres streamer oficial, contacta con Administración.*`
                }).catch(() => { });
            }

            // Obtener el título en tiempo real desde la plataforma (Twitch/Kick/TikTok/Discord) o título guardado
            const defaultPlatformTitle = requestedPlatform === 'Kick' ? streamerInfo.kickTitle : (requestedPlatform === 'TikTok' ? streamerInfo.tiktokTitle : (requestedPlatform === 'Twitch' ? streamerInfo.twitchTitle : streamerInfo.title));
            const liveTitle = await fetchLiveStreamTitle(targetStreamUrl, interaction.member, defaultPlatformTitle || streamerInfo.title);

            // Enviar notificación personalizada al canal oficial de streams
            const result = await sendStreamerNotification({
                userMention: `<@${userId}>`,
                streamUrl: targetStreamUrl,
                streamTitle: liveTitle,
                platform: activePlatform,
                avatarUrl: interaction.user.displayAvatarURL({ dynamic: true })
            });

            const targetChannelId = botConfig.CHANNEL_STREAMERS_ID || '1517530849032016006';

            if (result && result.success) {
                let platEmoji = '🟣';
                if (activePlatform.toLowerCase().includes('kick')) platEmoji = '🟢';
                else if (activePlatform.toLowerCase().includes('tiktok')) platEmoji = '⚫';

                return interaction.editReply({
                    content: `✅ **¡Tu directo de ${activePlatform} ${platEmoji} ha sido anunciado con éxito en <#${targetChannelId}>!**\n🏷️ **Título:** \`"${liveTitle}"\`\n🔗 **Canal:** <${targetStreamUrl}>\n¡Mucho éxito en tu transmisión! 🚀`
                }).catch(() => { });
            } else {
                return interaction.editReply({
                    content: `❌ Hubo un error al publicar el anuncio en el canal <#${targetChannelId}>. Verifica permisos del bot.`
                }).catch(() => { });
            }
        } catch (err) {
            console.error('Error al procesar botón de stream:', err);
            return interaction.editReply({
                content: '⚠️ Ocurrió un problema al enviar la notificación. Por favor inténtalo de nuevo.'
            }).catch(() => { });
        }
    }

    // ----------------------------------------------------
    // BOTÓN: ABRIR SELECTOR DE STAFF PARA VALORAR
    // ----------------------------------------------------
    if (interaction.customId === 'btn_abrir_valoracion_staff') {
        const ratingsData = getStaffRatingsData();
        const staffIds = ratingsData.staffList || ['418558256840179722'];

        const options = [];
        for (const sId of staffIds) {
            let label = `Staff (${sId})`;
            let description = 'Equipo de Staff • SPAIN RP';
            const member = interaction.guild?.members?.cache?.get(sId);
            if (member) {
                label = member.displayName || member.user.username;
                description = `@${member.user.tag || member.user.username}`;
            }

            options.push({
                label: label.slice(0, 100),
                description: description.slice(0, 100),
                value: sId,
                emoji: '🛡️'
            });
        }

        if (options.length === 0) {
            options.push({
                label: 'Staff General',
                description: 'Valoración para el equipo de soporte',
                value: '418558256840179722',
                emoji: '🛡️'
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_staff_to_rate')
            .setPlaceholder('🛡️ Elige al miembro de Staff que te atendió...')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({
            content: '👤 **Selecciona en el menú al Staff que deseas valorar:**',
            components: [row],
            ephemeral: true
        }).catch(() => { });

        // Auto-eliminar el selector efímero tras 6 segundos (así si cancela o no hace nada, desaparece solo de inmediato)
        setTimeout(() => {
            interaction.deleteReply().catch(() => { });
        }, 6000);
        return;
    }

    // ----------------------------------------------------
    // BOTÓN: ABRIR MODAL DE REGISTRAR SANCIÓN STAFF
    // ----------------------------------------------------
    if (interaction.customId === 'btn_abrir_modal_sancion') {
        const hasStaff = await isStaffMember(interaction.member, interaction.guild, interaction.user.id);
        if (!hasStaff) {
            return interaction.reply({
                content: '❌ Solo los miembros del equipo de **Staff** pueden registrar sanciones.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_sancion_staff')
            .setTitle('SISTEMA DE SANCIONES');

        const inputTarget = new TextInputBuilder()
            .setCustomId('input_sancion_target')
            .setLabel('👤 Usuario Sancionado (@mención o ID)')
            .setPlaceholder('Ej: 1294687324545880127 o @usuario')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputPunishment = new TextInputBuilder()
            .setCustomId('input_sancion_punishment')
            .setLabel('⚖️ Sanción / Escenarios')
            .setPlaceholder('Ej: Permaban / Ban 7 días / Warn 1 / Mute')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const inputReason = new TextInputBuilder()
            .setCustomId('input_sancion_reason')
            .setLabel('📝 Breve Explicación de los Hechos')
            .setPlaceholder('Ej: Portaba un RPG en su inventario...')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(inputTarget),
            new ActionRowBuilder().addComponents(inputPunishment),
            new ActionRowBuilder().addComponents(inputReason)
        );

        return interaction.showModal(modal);
    }

    // ----------------------------------------------------
    // BOTÓN: ABRIR MODAL DE PUBLICAR EVENTO STAFF
    // ----------------------------------------------------
    if (interaction.customId === 'btn_abrir_modal_evento') {
        const hasStaff = await isStaffMember(interaction.member, interaction.guild, interaction.user.id);
        if (!hasStaff) {
            return interaction.reply({
                content: '❌ Solo los miembros del equipo de **Staff** pueden publicar eventos.',
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_evento_staff')
            .setTitle('PUBLICAR EVENTO');

        const inputDescription = new TextInputBuilder()
            .setCustomId('input_evento_desc')
            .setLabel('📝 Mensaje del Evento')
            .setPlaceholder('Pega aquí todo el texto del evento tal cual. El bot lo reestructurará automáticamente.')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(inputDescription)
        );

        return interaction.showModal(modal);
    }

    // ----------------------------------------------------
    // BOTÓN: VER TOP / RANKING DE STAFF
    // ----------------------------------------------------
    if (interaction.customId === 'btn_ver_top_staff') {
        const ratingsData = getStaffRatingsData();
        const stats = ratingsData.stats || {};
        const staffList = Object.keys(stats).map(id => ({ id, ...stats[id] }));

        staffList.sort((a, b) => b.average - a.average || b.totalRatings - a.totalRatings);

        let desc = '';
        if (staffList.length === 0) {
            desc = '📭 *Todavía no se han registrado valoraciones de Staff en el servidor.*';
        } else {
            staffList.slice(0, 10).forEach((s, idx) => {
                const medal = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : (idx === 2 ? '🥉' : `\`#${idx + 1}\``));
                const fullStars = Math.min(Math.max(Math.round(s.average / 2), 1), 5);
                const stars = '⭐'.repeat(fullStars);
                desc += `${medal} <@${s.id}> • **${s.average}/10** ${stars}\n> 💬 Reseñas: \`${s.totalRatings}\` votos recibidos\n\n`;
            });
        }

        const topEmbed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🏆 Ranking de Atención de Staff • SPAIN RP')
            .setDescription(desc)
            .setFooter({ text: 'SPAIN RP • Calidad de Soporte' })
            .setTimestamp();

        return interaction.reply({ embeds: [topEmbed], ephemeral: true });
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

// Manejo de envío de Modales (Formularios)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    // ----------------------------------------------------
    // PROCESAMIENTO: MODAL VALORACIÓN DE STAFF
    // ----------------------------------------------------
    if (interaction.customId.startsWith('modal_valorar_staff')) {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });

        try {
            const rawRating = interaction.fields.getTextInputValue('input_staff_rating').trim();
            const comment = interaction.fields.getTextInputValue('input_staff_comment').trim();

            // Extraer staffId del customId (ej: modal_valorar_staff_123456789)
            let staffId = interaction.customId.replace('modal_valorar_staff_', '');
            if (staffId === 'modal_valorar_staff') staffId = null;

            // Si vino del formato anterior con input de texto
            if (!staffId && interaction.fields.fields.has('input_staff_target')) {
                const rawStaff = interaction.fields.getTextInputValue('input_staff_target').trim();
                const idMatch = rawStaff.match(/^<@!?(\d{17,20})>$/) || rawStaff.match(/^(\d{17,20})$/);
                if (idMatch) staffId = idMatch[1];
                else {
                    const members = await interaction.guild.members.fetch({ query: rawStaff, limit: 1 }).catch(() => null);
                    const found = members?.first();
                    if (found) staffId = found.id;
                    else staffId = rawStaff.toLowerCase().replace(/[^a-z0-9]/g, '_');
                }
            }

            // Validar puntuación numérica
            const numRating = parseInt(rawRating, 10);
            if (isNaN(numRating) || numRating < 1 || numRating > 10) {
                return interaction.editReply({
                    content: '❌ **Puntuación inválida:** Debes indicar un número entero del **1 al 10** (por ejemplo `10` o `8`).'
                }).catch(() => { });
            }

            // Obtener datos del staff
            let staffTag = 'Staff';
            let staffMention = `<@${staffId}>`;

            if (staffId && /^\d+$/.test(staffId)) {
                try {
                    const member = await interaction.guild.members.fetch(staffId).catch(() => null);
                    if (member) {
                        staffTag = member.user.tag || member.displayName;
                        staffMention = `<@${member.id}>`;
                    }
                } catch (e) { }
            }

            // Evitar auto-valoraciones
            if (staffId === interaction.user.id) {
                await interaction.editReply({
                    content: '⚠️ **No puedes valorarte a ti mismo.** La valoración debe ser para otro miembro del equipo de Staff.'
                }).catch(() => { });
                setTimeout(() => {
                    interaction.deleteReply().catch(() => { });
                }, 3000);
                return;
            }

            // Guardar en la base de datos persistente
            const { entry, stats } = saveStaffRating({
                userId: interaction.user.id,
                userName: interaction.user.tag || interaction.user.username,
                staffId: staffId || 'staff_general',
                staffTag,
                rating: numRating,
                comment
            });

            // Construir la tarjeta contenedor oficial con banner y logo
            const { embed: cardEmbed, files: cardFiles } = buildStaffRatingCardEmbed({
                userMention: `<@${interaction.user.id}>`,
                userAvatar: interaction.user.displayAvatarURL({ dynamic: true }),
                staffMention,
                staffName: staffTag,
                rating: numRating,
                comment,
                average: stats.average,
                totalRatings: stats.totalRatings
            });

            // Canal destino
            const targetChannelId = botConfig.CHANNEL_VALORACIONES_ID || interaction.channelId;
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);

            if (targetChannel) {
                await targetChannel.send({
                    embeds: [cardEmbed],
                    files: cardFiles
                }).catch((err) => {
                    console.error('Error al publicar valoración en el canal:', err);
                    return null;
                });
            }

            // Actualizar automáticamente el panel fijo de Tops si está configurado en el canal
            updateStaffTopRankingPanel().catch(() => { });

            await interaction.editReply({
                content: `✅ **¡Tu valoración ha sido enviada con éxito!**\n⭐ Puntuación: \`${numRating}/10\` para ${staffMention}.\nMuchas gracias por ayudarnos a mejorar el servidor.`
            }).catch(() => { });

            // Auto-eliminar el mensaje efímero de confirmación en 3 segundos
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 3000);

            // Eliminar el mensaje anterior que contenía el selector si es accesible
            try {
                if (interaction.message && interaction.message.deletable) {
                    await interaction.message.delete().catch(() => { });
                }
            } catch (e) { }
            return;
        } catch (err) {
            console.error('Error al procesar modal de valoración de staff:', err);
            await interaction.editReply({
                content: '❌ Ocurrió un error al procesar tu valoración. Inténtalo de nuevo.'
            }).catch(() => { });
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 3000);
            return;
        }
    }

    // ----------------------------------------------------
    // PROCESAMIENTO: MODAL REGISTRAR SANCIÓN STAFF
    // ----------------------------------------------------
    if (interaction.customId === 'modal_sancion_staff') {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });

        try {
            const rawTarget = interaction.fields.getTextInputValue('input_sancion_target').trim();
            const punishment = interaction.fields.getTextInputValue('input_sancion_punishment').trim();
            const reason = interaction.fields.getTextInputValue('input_sancion_reason').trim();
            const involvedStaff = `<@${interaction.user.id}>`;
            let imageUrl = '';

            let targetId = null;
            let targetTag = rawTarget;
            const idMatch = rawTarget.match(/^<@!?(\d{17,20})>$/) || rawTarget.match(/^(\d{17,20})$/);
            if (idMatch) {
                targetId = idMatch[1];
                try {
                    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
                    if (member) targetTag = member.user.tag || member.displayName;
                } catch (e) { }
            }

            const sancionId = Date.now().toString().slice(-4);

            // Si no proporcionó enlace de imagen, poner al Staff en estado de espera para que la adjunte en el chat
            if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
                pendingSancionesAwaitingImage.set(interaction.user.id, {
                    id: sancionId,
                    reporterId: interaction.user.id,
                    reporterTag: interaction.user.tag || interaction.user.username,
                    targetId,
                    targetTag,
                    reason,
                    punishment,
                    involvedStaff,
                    channelId: interaction.channelId,
                    expiresAt: Date.now() + 60000 // 60 segundos
                });

                console.log(`\n⏳ [SANCIÓN EN ESPERA DE FOTO] Staff ${interaction.user.tag} (${interaction.user.id}) ha rellenado el formulario #${sancionId}. Esperando captura en el chat...`);

                await interaction.editReply({
                    content: `📸 **¡Datos del expediente #${sancionId} registrados!**\n\n` +
                        `👉 **Ahora pega o sube la captura de prueba en este chat** en los próximos **60 segundos** para publicarla automáticamente.\n` +
                        `*(Si no tienes captura, escribe \`sin foto\` y se publicará sin imagen).*`
                }).catch(() => { });

                setTimeout(() => {
                    interaction.deleteReply().catch(() => { });
                }, 15000);
                return;
            }

            // Si proporcionó enlace de imagen, publicar el acta directamente
            const sancionObj = {
                id: sancionId,
                reporterId: interaction.user.id,
                reporterTag: interaction.user.tag || interaction.user.username,
                targetId,
                targetTag,
                reason,
                punishment,
                involvedStaff: involvedStaff || `<@${interaction.user.id}>`,
                imageUrl,
                channelId: interaction.channelId
            };

            await saveSancionRecord(sancionObj);

            const { embeds, embed, files } = buildSancionCardEmbed(sancionObj);
            const targetChannelId = botConfig.CHANNEL_SANCIONES_ID || interaction.channelId;
            const targetChannel = await client.channels.fetch(targetChannelId).catch(() => interaction.channel);

            await targetChannel.send({ embeds: embeds || [embed], files }).catch(e => console.error('Error al enviar sancion:', e));

            await interaction.editReply({
                content: `✅ **Expediente de sanción #${sancionId} registrado y publicado con éxito.**`
            }).catch(() => { });

            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 3000);
            return;
        } catch (err) {
            console.error('Error al procesar modal de sancion:', err);
            await interaction.editReply({
                content: '❌ Ocurrió un error al procesar el acta de sanción.'
            }).catch(() => { });
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 3000);
            return;
        }
    }

    // ----------------------------------------------------
    // PROCESAMIENTO: MODAL PUBLICAR EVENTO STAFF
    // ----------------------------------------------------
    if (interaction.customId === 'modal_evento_staff') {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });

        try {
            const description = interaction.fields.getTextInputValue('input_evento_desc').trim();
            const eventoId = Date.now().toString().slice(-4);

            pendingEventosAwaitingImage.set(interaction.user.id, {
                id: eventoId,
                reporterId: interaction.user.id,
                reporterTag: interaction.user.tag || interaction.user.username,
                title: '',
                description,
                ping: '@everyone',
                channelId: interaction.channelId,
                expiresAt: Date.now() + 60000 // 60 segundos
            });

            console.log(`\n⏳ [EVENTO EN ESPERA DE FLYER] Staff ${interaction.user.tag} (${interaction.user.id}) ha rellenado el formulario de evento #${eventoId}. Esperando cartel en el chat...`);

            await interaction.editReply({
                content: `🚗 **¡Mensaje del evento registrado!**\n\n` +
                    `👉 **Ahora pega o sube el cartel / flyer / foto del evento en este chat** en los próximos **60 segundos** para publicarlo automáticamente.\n` +
                    `*(Si no tienes cartel, escribe \`sin foto\` y se publicará de inmediato).*`
            }).catch(() => { });

            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 15000);
            return;
        } catch (err) {
            console.error('Error al procesar modal de evento:', err);
            await interaction.editReply({
                content: '❌ Ocurrió un error al procesar el evento.'
            }).catch(() => { });
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 3000);
            return;
        }
    }
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
// EVENTO: BIENVENIDAS DE NUEVOS MIEMBROS (guildMemberAdd)
// ==========================================
client.on('guildMemberAdd', async (member) => {
    try {
        if (!member || member.user.bot) return;
        await sendWelcomeMessage(member);
    } catch (err) {
        console.error('❌ Error en evento guildMemberAdd:', err);
    }
});

// ==========================================
// 7. CONSOLA DE COMANDOS INTERACTIVA DESDE CMD / TERMINAL
const readline = require('readline');

if (process.stdin.isTTY) {
    try {
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
                            await msg.delete().catch(() => { });
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
                                        await msg.delete().catch(() => { });
                                        count++;
                                    }
                                }
                            }
                            console.log(`✅ [CMD] Eliminados ${count} mensajes en #${channel.name}`);
                        }
                    } catch (e) { }
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

            // Estado de entrevistas de voz activas
            if (['entrevistas', 'voz', 'voice'].includes(input)) {
                console.log(`\n🎙️ [CMD VOZ] Entrevistas de voz activas: ${activeVoiceInterviews.size}`);
                activeVoiceInterviews.forEach((session, guildId) => {
                    const dur = Math.round((Date.now() - session.startTime) / 1000);
                    console.log(`  -> Guild ${guildId} | Postulante: ${session.targetTag} (${session.targetUserId}) | Duración: ${dur}s | Frases capturadas: ${session.transcripts.length}`);
                });
                console.log('');
                return;
            }

            // Desconectar forzosamente al bot de canales de voz
            if (['salir-voz', 'desconectar-voz', 'kick-voz'].includes(input)) {
                activeVoiceInterviews.forEach((session, gId) => {
                    try { if (session.connection) session.connection.destroy(); } catch (e) { }
                });
                activeVoiceInterviews.clear();
                console.log('👋 [CMD] Bot desconectado de todos los canales de voz.\n');
                return;
            }

            // Ayuda
            if (['ayuda', 'help', '?'].includes(input)) {
                console.log('\n📋 [COMANDOS DISPONIBLES EN LA TERMINAL / CMD]:');
                console.log('  • limpiar        -> Borra todos los mensajes que el bot envió en el canal de solicitudes');
                console.log('  • limpiar-todo   -> Borra mensajes del bot en solicitudes y aprobados');
                console.log('  • scan           -> Vuelve a escanear el historial para calibrar la IA');
                console.log('  • stats          -> Muestra las estadísticas de aprendizaje del bot');
                console.log('  • entrevistas    -> Muestra si hay entrevistas de voz activas');
                console.log('  • salir-voz      -> Desconecta al bot de cualquier canal de voz');
                console.log('  • salir          -> Apaga el bot de forma segura\n');
                return;
            }

            if (['salir', 'exit', 'stop'].includes(input)) {
                console.log('👋 [CMD] Apagando el bot...');
                client.destroy();
                process.exit(0);
            }
        });
    } catch (e) { }
}

// Iniciar sesión en Discord
const tokenToUse = (process.env.DISCORD_TOKEN || '').trim();
if (!tokenToUse) {
    console.error('❌ [ERROR CRÍTICO] La variable de entorno DISCORD_TOKEN no está configurada en Render.');
} else {
    console.log('🔑 [DISCORD] Conectando a la API de Discord...');
    client.login(tokenToUse).then(() => {
        console.log('✅ [DISCORD] Sesión iniciada con éxito en la API de Discord.');
    }).catch(err => {
        console.error('❌ [ERROR LOGIN DISCORD]:', err.message);
    });
}
