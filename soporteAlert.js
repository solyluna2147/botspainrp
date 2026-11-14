const mongoose = require('mongoose');
const { Readable } = require('stream');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection
} = require('@discordjs/voice');

// Esquema para audios almacenados en MongoDB
const audioAlertSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    data: { type: Buffer, required: true },
    mimeType: { type: String, default: 'audio/mp3' },
    size: Number,
    updatedAt: { type: Date, default: Date.now }
});

const AudioAlert = mongoose.models.AudioAlert || mongoose.model('AudioAlert', audioAlertSchema);

// Esquema de configuración de BotSetting
const botSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const BotSetting = mongoose.models.BotSetting || mongoose.model('BotSetting', botSettingSchema);

// Canales configurados
const CANAL_ESPERA_ID = '1517530849334136846';
const CANALES_SOPORTE_IDS = [
    '1517530849334136847', // SOPORTE 1
    '1517530849334136848', // SOPORTE 2
    '1517530849334136849', // SOPORTE 3
    '1517530849334136850', // SOPORTE 4
    '1517530849334136851'  // SOPORTE 5
];

// Estado en memoria
let tiempoEsperaMinutos = 5; // Por defecto 5 minutos
let audioCache = null; // Buffer en memoria RAM para cero latencia
let isPlayingAlert = false;
let userJoinTimes = new Map(); // userId -> timestamp de entrada
let lastAlertPlayedAt = 0; // Para cooldown general
const COOLDOWN_ENTRE_ALERTAS_MS = 60 * 1000; // Mínimo 1 minuto entre avisos globales

/**
 * Carga o refresca el audio desde MongoDB a memoria RAM
 */
async function loadAudioFromDB() {
    try {
        const record = await AudioAlert.findOne({ name: 'espera_soporte' });
        if (record && record.data) {
            audioCache = record.data;
            console.log(`🔊 [SOPORTE ALERT] Audio cargado desde MongoDB en memoria (${record.size || audioCache.length} bytes).`);
        } else {
            console.warn('⚠️ [SOPORTE ALERT] No se encontró el audio "espera_soporte" en la BD.');
        }
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error cargando audio desde BD:', err.message);
    }
}

/**
 * Carga los minutos configurados desde la BD
 */
async function loadMinutesFromDB() {
    try {
        const setting = await BotSetting.findOne({ key: 'locucion_espera_minutos' });
        if (setting && typeof setting.value === 'number') {
            tiempoEsperaMinutos = setting.value;
            console.log(`⏱️ [SOPORTE ALERT] Minutos de espera configurados: ${tiempoEsperaMinutos} min.`);
        }
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error cargando minutos desde BD:', err.message);
    }
}

/**
 * Guarda los minutos configurados en MongoDB
 */
async function setMinutesInDB(minutes) {
    tiempoEsperaMinutos = minutes;
    await BotSetting.findOneAndUpdate(
        { key: 'locucion_espera_minutos' },
        { value: minutes },
        { upsert: true, returnDocument: 'after' }
    );
}

/**
 * Reproduce el audio en un canal de voz y se desconecta de inmediato al terminar
 */
async function playAlertInChannel(channel) {
    if (!audioCache) {
        await loadAudioFromDB();
        if (!audioCache) {
            console.warn('⚠️ [SOPORTE ALERT] No hay audio disponible para reproducir.');
            return false;
        }
    }

    if (isPlayingAlert) return false;
    isPlayingAlert = true;

    let connection = null;
    try {
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        // Esperar conexión lista
        await entersState(connection, VoiceConnectionStatus.Ready, 7000);

        // Pequeño margen de 350ms para que Discord abra el flujo de audio limpio
        await new Promise(res => setTimeout(res, 350));

        const player = createAudioPlayer();
        const stream = Readable.from(audioCache);
        const resource = createAudioResource(stream);

        connection.subscribe(player);
        player.play(resource);

        // Esperar a que termine de sonar
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve();
            }, 15000); // Máximo 15s por seguridad

            player.on(AudioPlayerStatus.Idle, () => {
                clearTimeout(timeout);
                resolve();
            });

            player.on('error', (err) => {
                console.error('❌ [SOPORTE ALERT] Error en player:', err.message);
                clearTimeout(timeout);
                resolve();
            });
        });

        // Desconexión limpia inmediata
        try {
            connection.destroy();
        } catch (e) { }

        lastAlertPlayedAt = Date.now();
        console.log(`✅ [SOPORTE ALERT] Locución reproducida con éxito en ${channel.name}.`);
        return true;
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error conectando o reproduciendo:', err.message);
        if (connection) {
            try { connection.destroy(); } catch (e) { }
        }
        return false;
    } finally {
        isPlayingAlert = false;
    }
}

/**
 * Busca si hay algún canal de soporte con staffs que no estén muteados ni ensordecidos
 */
function findAvailableSupportChannel(guild) {
    for (const channelId of CANALES_SOPORTE_IDS) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) continue;

        // Buscar miembros humanos en ese canal que NO estén muteados ni ensordecidos
        const activeMembers = channel.members.filter(member => {
            if (member.user.bot) return false;
            const vs = member.voice;
            if (!vs) return false;
            const isMuted = vs.mute || vs.selfMute;
            const isDeaf = vs.deaf || vs.selfDeaf;
            return !isMuted && !isDeaf;
        });

        if (activeMembers.size > 0) {
            return { channel, count: activeMembers.size };
        }
    }
    return null;
}

/**
 * Verifica si algún usuario en espera ya superó el tiempo límite
 */
async function checkWaitRoom(guild) {
    if (isPlayingAlert) return;
    if (Date.now() - lastAlertPlayedAt < COOLDOWN_ENTRE_ALERTAS_MS) return;

    const waitChannel = guild.channels.cache.get(CANAL_ESPERA_ID);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;

    const waitingUsers = waitChannel.members.filter(m => !m.user.bot);
    if (waitingUsers.size === 0) {
        userJoinTimes.clear();
        return;
    }

    // Limpiar usuarios que ya no estén en el canal
    for (const [userId] of userJoinTimes) {
        if (!waitingUsers.has(userId)) {
            userJoinTimes.delete(userId);
        }
    }

    const now = Date.now();
    const tiempoLimiteMs = tiempoEsperaMinutos * 60 * 1000;
    let usuarioHaSuperado = false;

    for (const [userId, member] of waitingUsers) {
        if (!userJoinTimes.has(userId)) {
            userJoinTimes.set(userId, now);
        } else {
            const timeInRoom = now - userJoinTimes.get(userId);
            if (timeInRoom >= tiempoLimiteMs) {
                usuarioHaSuperado = true;
                break;
            }
        }
    }

    if (!usuarioHaSuperado) return;

    // Buscar canal con staff activo
    const target = findAvailableSupportChannel(guild);
    if (!target) {
        // No hay staff disponible (o todos están muteados/ensordecidos)
        return;
    }

    console.log(`📢 [SOPORTE ALERT] Usuario lleva más de ${tiempoEsperaMinutos}m esperando. Avisando en ${target.channel.name} (${target.count} staffs activos)...`);
    const success = await playAlertInChannel(target.channel);
    if (success) {
        // Reseteamos el reloj del usuario para que no vuelva a sonar hasta que pase otro ciclo de minutos
        for (const [userId] of userJoinTimes) {
            userJoinTimes.set(userId, Date.now());
        }
    }
}

/**
 * Inicializador del sistema
 */
function initSoporteAlert(client) {
    // 1. Cargar datos iniciales
    loadAudioFromDB();
    loadMinutesFromDB();

    // 2. Evento voiceStateUpdate para gestionar entradas/salidas de la sala de espera
    client.on('voiceStateUpdate', (oldState, newState) => {
        const userId = newState.id;
        if (newState.member && newState.member.user.bot) return;

        // Entró al canal de espera
        if (newState.channelId === CANAL_ESPERA_ID && oldState.channelId !== CANAL_ESPERA_ID) {
            userJoinTimes.set(userId, Date.now());
        }

        // Salió del canal de espera
        if (oldState.channelId === CANAL_ESPERA_ID && newState.channelId !== CANAL_ESPERA_ID) {
            userJoinTimes.delete(userId);
        }
    });

    // 3. Intervalo de chequeo periódico cada 10 segundos
    setInterval(() => {
        try {
            for (const [, guild] of client.guilds.cache) {
                checkWaitRoom(guild).catch(() => {});
            }
        } catch (e) { }
    }, 10 * 1000);

    // 4. Comando !locu <minutos>
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim();
        if (content.toLowerCase().startsWith('!locu')) {
            // Verificar permisos (Administrador o gestionar canales / servidor)
            const isStaff = message.member.permissions.has('Administrator') ||
                message.member.permissions.has('ManageGuild') ||
                message.member.permissions.has('ManageChannels');

            if (!isStaff) {
                return message.reply({ content: '❌ No tienes permisos para configurar la locución de soporte.' });
            }

            const args = content.split(/\s+/);
            const nuevoTiempo = parseFloat(args[1]);

            if (isNaN(nuevoTiempo) || nuevoTiempo <= 0) {
                return message.reply({
                    content: `ℹ️ **Configuración actual:** La locución suena cuando un usuario lleva **${tiempoEsperaMinutos} minutos** esperando.\n👉 Usa \`!locu <minutos>\` para cambiarlo (ej: \`!locu 5\` o \`!locu 3\`).`
                });
            }

            try {
                await setMinutesInDB(nuevoTiempo);
                // Si cambiaron el tiempo, refrescamos el timestamp de los que ya están en espera
                for (const [userId] of userJoinTimes) {
                    userJoinTimes.set(userId, Date.now());
                }

                return message.reply({
                    content: `✅ **Tiempo de locución actualizado:** Ahora la locución sonará si un usuario pasa más de **${nuevoTiempo} minutos** en la sala de espera.`
                });
            } catch (err) {
                console.error(err);
                return message.reply({ content: '❌ Ocurrió un error al guardar la configuración en la base de datos.' });
            }
        }
    });

    console.log('🛡️ [SOPORTE ALERT] Sistema independiente de alerta de soporte iniciado correctamente.');
}

module.exports = initSoporteAlert;

