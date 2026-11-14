const mongoose = require('mongoose');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState
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

// Rol de staff por defecto
let ROLE_STAFF_ID = '1538191116610838691';
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg.ROLE_STAFF_ID) ROLE_STAFF_ID = cfg.ROLE_STAFF_ID;
    }
} catch (e) { }

// Estado en memoria
let sistemaActivo = true; // Interruptor ON/OFF
let tiempoEsperaMinutos = 5; // Por defecto 5 minutos para staffs
let audioStaffCache = null; // Audio para avisar a staffs
let audioUsuarioCache = null; // Audio de bienvenida/espera para usuarios
let isPlayingVoice = false; // Flag de conexión activa de voz
let userJoinTimes = new Map(); // userId -> timestamp de entrada a espera
let activeConnection = null; // Referencia a la conexión actual
let activePlayer = null; // Referencia al reproductor actual
let stopCurrentTour = false; // Flag para cancelar avisos si la sala queda vacía
let lastStaffAlertAt = 0; // Cooldown staffs
let lastUserRepeatAlertAt = 0; // Para el intervalo de 1 minuto en la sala de espera
let userWelcomeDebounceTimer = null; // Timer de 5s para bienvenida agrupada

/**
 * Carga o refresca los audios desde MongoDB a memoria RAM
 */
async function loadAudiosFromDB() {
    try {
        const [staffRec, userRec] = await Promise.all([
            AudioAlert.findOne({ name: 'espera_soporte' }),
            AudioAlert.findOne({ name: 'locucion_de_esperas' })
        ]);

        if (staffRec && staffRec.data) {
            audioStaffCache = staffRec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Staff cargado (${staffRec.size || audioStaffCache.length} bytes).`);
        }
        if (userRec && userRec.data) {
            audioUsuarioCache = userRec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Usuario cargado (${userRec.size || audioUsuarioCache.length} bytes).`);
        }
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error cargando audios desde BD:', err.message);
    }
}

/**
 * Carga los ajustes de configuración desde MongoDB
 */
async function loadSettingsFromDB() {
    try {
        const settingMin = await BotSetting.findOne({ key: 'locucion_espera_minutos' });
        if (settingMin && typeof settingMin.value === 'number') {
            tiempoEsperaMinutos = settingMin.value;
            console.log(`⏱️ [SOPORTE ALERT] Minutos de espera configurados: ${tiempoEsperaMinutos} min.`);
        }

        const settingActive = await BotSetting.findOne({ key: 'locucion_espera_activo' });
        if (settingActive && typeof settingActive.value === 'boolean') {
            sistemaActivo = settingActive.value;
            console.log(`🔘 [SOPORTE ALERT] Estado de la locución: ${sistemaActivo ? 'ACTIVADA' : 'DESACTIVADA'}.`);
        }
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error cargando ajustes desde BD:', err.message);
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
 * Guarda el estado activo/inactivo en MongoDB
 */
async function setActiveInDB(active) {
    sistemaActivo = active;
    await BotSetting.findOneAndUpdate(
        { key: 'locucion_espera_activo' },
        { value: active },
        { upsert: true, returnDocument: 'after' }
    );
}

/**
 * Determina si un miembro es Staff
 */
function isMemberStaff(member) {
    if (!member || member.user.bot) return false;
    if (ROLE_STAFF_ID && member.roles.cache.has(ROLE_STAFF_ID)) return true;
    if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild') || member.permissions.has('ManageChannels')) return true;
    return false;
}

/**
 * Corta inmediatamente cualquier reproducción o conexión activa
 */
function abortPlaybackImmediately(reason = 'Desconexión forzada') {
    stopCurrentTour = true;
    if (userWelcomeDebounceTimer) {
        clearTimeout(userWelcomeDebounceTimer);
        userWelcomeDebounceTimer = null;
    }
    if (activePlayer) {
        try { activePlayer.stop(true); } catch (e) { }
        activePlayer = null;
    }
    if (activeConnection) {
        try { activeConnection.destroy(); } catch (e) { }
        activeConnection = null;
    }
    isPlayingVoice = false;
    console.log(`⏹️ [SOPORTE ALERT] ${reason}.`);
}

/**
 * Comprueba si la sala de espera está vacía de usuarios
 */
function isWaitRoomEmpty(guild) {
    const waitChannel = guild.channels.cache.get(CANAL_ESPERA_ID);
    if (!waitChannel || !waitChannel.isVoiceBased()) return true;
    const count = waitChannel.members.filter(m => !m.user.bot).size;
    return count === 0;
}

/**
 * Reproduce un buffer de audio en un canal y se desconecta de inmediato
 */
async function playAudioBufferInChannel(channel, audioBuffer, label = 'Audio') {
    if (!audioBuffer) return false;
    if (isPlayingVoice) return false;

    isPlayingVoice = true;
    let connection = null;

    try {
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        activeConnection = connection;
        await entersState(connection, VoiceConnectionStatus.Ready, 7000);

        if (stopCurrentTour || isWaitRoomEmpty(channel.guild)) {
            try { connection.destroy(); } catch (e) { }
            activeConnection = null;
            return false;
        }

        await new Promise(res => setTimeout(res, 300));

        if (stopCurrentTour || isWaitRoomEmpty(channel.guild)) {
            try { connection.destroy(); } catch (e) { }
            activeConnection = null;
            return false;
        }

        const player = createAudioPlayer();
        activePlayer = player;
        const stream = Readable.from(audioBuffer);
        const resource = createAudioResource(stream);

        connection.subscribe(player);
        player.play(resource);

        await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(), 15000);

            player.on(AudioPlayerStatus.Idle, () => {
                clearTimeout(timeout);
                resolve();
            });

            player.on('error', (err) => {
                console.error(`❌ [SOPORTE ALERT] Error en player (${label}):`, err.message);
                clearTimeout(timeout);
                resolve();
            });
        });

        try { connection.destroy(); } catch (e) { }
        activeConnection = null;
        activePlayer = null;

        console.log(`✅ [SOPORTE ALERT] ${label} reproducido con éxito en ${channel.name}.`);
        return true;
    } catch (err) {
        console.error(`❌ [SOPORTE ALERT] Error conectando/reproduciendo (${label}):`, err.message);
        if (connection) {
            try { connection.destroy(); } catch (e) { }
        }
        activeConnection = null;
        activePlayer = null;
        return false;
    } finally {
        isPlayingVoice = false;
    }
}

/**
 * Lanza la locución a los usuarios en la sala de espera
 */
async function triggerUserWaitRoomAlert(guild, reason = 'Bienvenida') {
    if (!sistemaActivo) return;
    if (isPlayingVoice) return;
    if (!audioUsuarioCache) await loadAudiosFromDB();
    if (!audioUsuarioCache) return;

    const waitChannel = guild.channels.cache.get(CANAL_ESPERA_ID);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;
    if (waitChannel.members.filter(m => !m.user.bot).size === 0) return;

    console.log(`🎙️ [SOPORTE ALERT] Lanzando locución a sala de espera (${reason})...`);
    const success = await playAudioBufferInChannel(waitChannel, audioUsuarioCache, 'Locución Usuarios');
    if (success) {
        lastUserRepeatAlertAt = Date.now();
    }
}

/**
 * Planifica la locución de bienvenida con debounce de 5s:
 * Si entran varios seguidos, se espera 5s desde el último para reproducirlo a todos juntos.
 */
function scheduleUserWelcomeAlert(guild) {
    if (!sistemaActivo) return;
    if (userWelcomeDebounceTimer) {
        clearTimeout(userWelcomeDebounceTimer);
    }
    userWelcomeDebounceTimer = setTimeout(() => {
        userWelcomeDebounceTimer = null;
        triggerUserWaitRoomAlert(guild, 'Nueva entrada tras 5s');
    }, 5000);
}

/**
 * Analiza canales de soporte ordenados (1º preferencia sin silenciar, 2º silenciados que escuchan)
 */
function getOrderedSupportChannels(guild) {
    const listPriority1 = [];
    const listPriority2 = [];

    for (const channelId of CANALES_SOPORTE_IDS) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) continue;

        const members = channel.members.filter(m => !m.user.bot);
        if (members.size === 0) continue;

        // Si hay algún no-staff, el canal está ocupado
        const hasNonStaff = members.some(m => !isMemberStaff(m));
        if (hasNonStaff) continue;

        let hasUnmutedStaff = false;
        let hasHearingStaff = false;

        for (const [, staffMember] of members) {
            const vs = staffMember.voice;
            if (!vs) continue;
            const isDeaf = vs.deaf || vs.selfDeaf;
            if (isDeaf) continue; // Ensordecido -> no escucha

            hasHearingStaff = true;
            const isMuted = vs.mute || vs.selfMute;
            if (!isMuted) hasUnmutedStaff = true;
        }

        if (hasUnmutedStaff) {
            listPriority1.push(channel);
        } else if (hasHearingStaff) {
            listPriority2.push(channel);
        }
    }

    return [...listPriority1, ...listPriority2];
}

/**
 * Chequeo periódico de la sala de espera (Staffs y repetición a usuarios de 1 min)
 */
async function checkWaitRoom(guild) {
    if (!sistemaActivo) return;
    if (isPlayingVoice) return;

    const waitChannel = guild.channels.cache.get(CANAL_ESPERA_ID);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;

    const waitingUsers = waitChannel.members.filter(m => !m.user.bot);
    if (waitingUsers.size === 0) {
        userJoinTimes.clear();
        return;
    }

    // Limpiar usuarios que salieron
    for (const [userId] of userJoinTimes) {
        if (!waitingUsers.has(userId)) {
            userJoinTimes.delete(userId);
        }
    }

    const now = Date.now();
    const tiempoLimiteMs = tiempoEsperaMinutos * 60 * 1000;
    let usuarioHaSuperadoStaffTime = false;

    for (const [userId] of waitingUsers) {
        if (!userJoinTimes.has(userId)) {
            userJoinTimes.set(userId, now);
        } else {
            const timeInRoom = now - userJoinTimes.get(userId);
            if (timeInRoom >= tiempoLimiteMs) {
                usuarioHaSuperadoStaffTime = true;
            }
        }
    }

    // 1. REPETICIÓN A USUARIOS CADA 1 MINUTO:
    // Si ya ha pasado el tiempo de locución de staffs (o ya se avisó a staffs) y siguen esperando,
    // se les reproduce la locución de espera en intervalos de 1 minuto para amenizar la espera.
    if (usuarioHaSuperadoStaffTime) {
        const timeSinceLastRepeat = now - lastUserRepeatAlertAt;
        if (timeSinceLastRepeat >= 60 * 1000 && !isPlayingVoice) {
            await triggerUserWaitRoomAlert(guild, 'Recordatorio 1min');
        }
    }

    // 2. AVISO A LOS CANALES DE STAFFS
    if (usuarioHaSuperadoStaffTime && (now - lastStaffAlertAt >= 30 * 1000)) {
        const channelsToAlert = getOrderedSupportChannels(guild);
        if (channelsToAlert.length > 0 && !isPlayingVoice) {
            stopCurrentTour = false;
            let staffAlertOk = false;

            console.log(`📢 [SOPORTE ALERT] Usuario superó ${tiempoEsperaMinutos}m. Avisando en ${channelsToAlert.length} canal(es) de soporte del tirón...`);

            for (const targetChannel of channelsToAlert) {
                if (stopCurrentTour || isWaitRoomEmpty(guild)) {
                    console.log('⏹️ [SOPORTE ALERT] Sala de espera vacía o atendida. Cancelando ronda a staffs.');
                    break;
                }

                if (!audioStaffCache) await loadAudiosFromDB();
                const ok = await playAudioBufferInChannel(targetChannel, audioStaffCache, 'Aviso Staff');
                if (ok) {
                    staffAlertOk = true;
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            if (staffAlertOk) {
                lastStaffAlertAt = Date.now();
                // Reseteamos el reloj para que no vuelva a sonar a staffs hasta que vuelva a cumplirse el ciclo
                for (const [userId] of userJoinTimes) {
                    userJoinTimes.set(userId, Date.now());
                }
            }
        }
    }
}

/**
 * Inicializador del sistema
 */
function initSoporteAlert(client) {
    // 1. Cargar audios y configuración inicial desde MongoDB
    loadAudiosFromDB();
    loadSettingsFromDB();

    // 2. Evento voiceStateUpdate para gestionar entradas y salidas
    client.on('voiceStateUpdate', (oldState, newState) => {
        const userId = newState.id;
        const member = newState.member || oldState.member;
        if (member && member.user && member.user.bot) return;

        // Entró al canal de espera
        if (newState.channelId === CANAL_ESPERA_ID && oldState.channelId !== CANAL_ESPERA_ID) {
            userJoinTimes.set(userId, Date.now());
            // Programar locución tras 5 segundos (agrupa si entran varios seguidos)
            const guild = newState.guild;
            scheduleUserWelcomeAlert(guild);
        }

        // Salió del canal de espera (o fue movido/atendido a un soporte)
        if (oldState.channelId === CANAL_ESPERA_ID && newState.channelId !== CANAL_ESPERA_ID) {
            userJoinTimes.delete(userId);

            const guild = oldState.guild || newState.guild;
            if (guild && isWaitRoomEmpty(guild)) {
                if (isPlayingVoice || activeConnection) {
                    abortPlaybackImmediately('Sala de espera vacía (usuario atendido/salido). Desconectando bot');
                }
            }
        }
    });

    // 3. Chequeo periódico cada 5 segundos
    setInterval(() => {
        try {
            for (const [, guild] of client.guilds.cache) {
                checkWaitRoom(guild).catch(() => {});
            }
        } catch (e) { }
    }, 5 * 1000);

    // 4. Comandos !locu
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim();
        if (content.toLowerCase().startsWith('!locu')) {
            const isStaff = isMemberStaff(message.member);
            if (!isStaff) {
                return message.reply({ content: '❌ No tienes permisos para configurar la locución de soporte.' });
            }

            const args = content.split(/\s+/);
            const subCmd = (args[1] || '').toLowerCase();

            if (subCmd === 'on' || subCmd === 'activar') {
                try {
                    await setActiveInDB(true);
                    return message.reply({ content: `🟢 **Locución ACTIVADA:** El sistema avisará en los canales de soporte libres cuando alguien lleve **${tiempoEsperaMinutos} min** esperando y reproducirá la locución de espera a los usuarios.` });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            if (subCmd === 'off' || subCmd === 'desactivar') {
                try {
                    await setActiveInDB(false);
                    userJoinTimes.clear();
                    abortPlaybackImmediately('Locución desactivada manualmente');
                    return message.reply({ content: '🔴 **Locución DESACTIVADA:** El bot ya no entrará a avisar a los canales ni a la sala de espera.' });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            const nuevoTiempo = parseFloat(subCmd);
            if (!isNaN(nuevoTiempo) && nuevoTiempo > 0) {
                try {
                    await setMinutesInDB(nuevoTiempo);
                    for (const [userId] of userJoinTimes) {
                        userJoinTimes.set(userId, Date.now());
                    }

                    return message.reply({
                        content: `✅ **Tiempo de aviso a staffs actualizado:** Ahora avisará tras **${nuevoTiempo} minutos** de espera (Estado: **${sistemaActivo ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**).`
                    });
                } catch (err) {
                    console.error(err);
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            return message.reply({
                content: `ℹ️ **Panel de control de la locución:**\n` +
                    `• **Estado actual:** ${sistemaActivo ? '🟢 **ACTIVADO**' : '🔴 **DESACTIVADO**'}\n` +
                    `• **Tiempo de aviso a staffs:** **${tiempoEsperaMinutos} minutos**\n` +
                    `• **Locución a usuarios en espera:** Activa (tras 5s de entrar y cada 1 min si superan el tiempo)\n\n` +
                    `**Comandos disponibles:**\n` +
                    `👉 \`!locu on\` ➔ Activa el sistema\n` +
                    `👉 \`!locu off\` ➔ Desactiva el sistema\n` +
                    `👉 \`!locu <minutos>\` ➔ Cambia el tiempo de aviso a staffs`
            });
        }
    });

    console.log('🛡️ [SOPORTE ALERT] Sistema completo activo: locución a usuarios en espera + locución a staffs afinada.');
}

module.exports = initSoporteAlert;
