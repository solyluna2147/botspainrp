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

// Rol de staff por defecto (obtenido de config.json)
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
let tiempoEsperaMinutos = 5; // Por defecto 5 minutos
let audioCache = null; // Buffer en memoria RAM para cero latencia
let isPlayingAlert = false;
let userJoinTimes = new Map(); // userId -> timestamp de entrada
let lastAlertPlayedAt = 0; // Para cooldown general
const COOLDOWN_ENTRE_ALERTAS_MS = 60 * 1000; // Mínimo 1 minuto entre rondas de aviso

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

        console.log(`✅ [SOPORTE ALERT] Locución reproducida con éxito en ${channel.name}.`);
        return true;
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error conectando o reproduciendo:', err.message);
        if (connection) {
            try { connection.destroy(); } catch (e) { }
        }
        return false;
    }
}

/**
 * Analiza los canales de soporte:
 * - Descarta canales con usuarios NO staff (ya están atendiendo / ocupados)
 * - Descarta staffs ensordecidos (no escuchan nada)
 * - Clasifica canales libres con staffs activos:
 *   - Prioridad 1: Canales con staffs sin silenciar (escuchan y pueden hablar)
 *   - Prioridad 2: Canales donde todos los staffs estén silenciados (al menos escuchan)
 */
function getEligibleSupportChannels(guild) {
    const listPriority1 = []; // Staffs 100% libres (ni ensordecidos ni silenciados)
    const listPriority2 = []; // Staffs silenciados pero no ensordecidos

    for (const channelId of CANALES_SOPORTE_IDS) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) continue;

        const members = channel.members.filter(m => !m.user.bot);
        if (members.size === 0) continue; // Canal vacío

        // 1. ¿Hay algún usuario que NO sea Staff?
        // Si hay alguien que no es staff, el canal está OCUPADO atendiendo un ticket/soporte.
        const hasNonStaff = members.some(m => !isMemberStaff(m));
        if (hasNonStaff) {
            // Canal ocupado atendiendo a un usuario -> NO molestar
            continue;
        }

        // 2. Solo hay staffs en el canal: filtramos según su estado de voz
        let hasUnmutedStaff = false;
        let hasHearingStaff = false;

        for (const [, staffMember] of members) {
            const vs = staffMember.voice;
            if (!vs) continue;

            const isDeaf = vs.deaf || vs.selfDeaf;
            if (isDeaf) {
                // Ensordecido: no escucha nada, se ignora este staff
                continue;
            }

            hasHearingStaff = true; // Al menos escucha

            const isMuted = vs.mute || vs.selfMute;
            if (!isMuted) {
                hasUnmutedStaff = true; // Ni muteado ni ensordecido
            }
        }

        if (hasUnmutedStaff) {
            listPriority1.push(channel);
        } else if (hasHearingStaff) {
            listPriority2.push(channel);
        }
    }

    // Si hay canales de Prioridad 1 (staffs ni muteados ni ensordecidos), se avisan esos
    // Si no hay ninguno de Prioridad 1 pero hay de Prioridad 2 (staffs silenciados que sí escuchan), se avisan esos
    if (listPriority1.length > 0) {
        return listPriority1;
    }
    return listPriority2;
}

/**
 * Verifica si algún usuario en espera ya superó el tiempo límite
 */
async function checkWaitRoom(guild) {
    if (!sistemaActivo) return; // Si está desactivado, no hace nada
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

    for (const [userId] of waitingUsers) {
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

    // Obtener los canales elegibles para avisar
    const channelsToAlert = getEligibleSupportChannels(guild);
    if (!channelsToAlert || channelsToAlert.length === 0) {
        // Todos los canales están ocupados, vacíos o los staffs están ensordecidos
        return;
    }

    isPlayingAlert = true;
    let algunaAlertaReproducida = false;

    try {
        console.log(`📢 [SOPORTE ALERT] Usuario lleva más de ${tiempoEsperaMinutos}m esperando. Avisando en ${channelsToAlert.length} canal(es) de soporte disponibles...`);

        // Va canal por canal reproduciendo la locución
        for (const targetChannel of channelsToAlert) {
            const ok = await playAlertInChannel(targetChannel);
            if (ok) {
                algunaAlertaReproducida = true;
                // Pequeña pausa de 500ms entre canal y canal para que Discord no se sature
                await new Promise(r => setTimeout(r, 500));
            }
        }
    } finally {
        isPlayingAlert = false;
    }

    if (algunaAlertaReproducida) {
        lastAlertPlayedAt = Date.now();
        // Reseteamos el reloj para que no vuelva a sonar hasta que pase otro ciclo de minutos
        for (const [userId] of userJoinTimes) {
            userJoinTimes.set(userId, Date.now());
        }
    }
}

/**
 * Inicializador del sistema
 */
function initSoporteAlert(client) {
    // 1. Cargar datos iniciales desde MongoDB
    loadAudioFromDB();
    loadSettingsFromDB();

    // 2. Evento voiceStateUpdate para gestionar entradas/salidas de la sala de espera
    client.on('voiceStateUpdate', (oldState, newState) => {
        if (!sistemaActivo) return;
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

    // 4. Comando !locu
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim();
        if (content.toLowerCase().startsWith('!locu')) {
            // Verificar permisos (Administrador o gestionar servidor o rol Staff)
            const isStaff = isMemberStaff(message.member);

            if (!isStaff) {
                return message.reply({ content: '❌ No tienes permisos para configurar la locución de soporte.' });
            }

            const args = content.split(/\s+/);
            const subCmd = (args[1] || '').toLowerCase();

            // Opción 1: Activar
            if (subCmd === 'on' || subCmd === 'activar') {
                try {
                    await setActiveInDB(true);
                    return message.reply({ content: `🟢 **Locución ACTIVADA:** El bot avisará en los canales de soporte libres cuando alguien lleve **${tiempoEsperaMinutos} min** esperando.` });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            // Opción 2: Desactivar
            if (subCmd === 'off' || subCmd === 'desactivar') {
                try {
                    await setActiveInDB(false);
                    userJoinTimes.clear();
                    return message.reply({ content: '🔴 **Locución DESACTIVADA:** El bot ya no entrará a avisar a los canales de soporte.' });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            // Opción 3: Cambiar tiempo numérico (!locu 5)
            const nuevoTiempo = parseFloat(subCmd);
            if (!isNaN(nuevoTiempo) && nuevoTiempo > 0) {
                try {
                    await setMinutesInDB(nuevoTiempo);
                    for (const [userId] of userJoinTimes) {
                        userJoinTimes.set(userId, Date.now());
                    }

                    return message.reply({
                        content: `✅ **Tiempo de locución actualizado:** Ahora avisará tras **${nuevoTiempo} minutos** de espera (Estado: **${sistemaActivo ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**).`
                    });
                } catch (err) {
                    console.error(err);
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            // Por defecto: Mostrar estado actual y ayuda
            return message.reply({
                content: `ℹ️ **Panel de control de la locución:**\n` +
                    `• **Estado actual:** ${sistemaActivo ? '🟢 **ACTIVADO**' : '🔴 **DESACTIVADO**'}\n` +
                    `• **Tiempo de espera:** **${tiempoEsperaMinutos} minutos**\n\n` +
                    `**Comandos disponibles:**\n` +
                    `👉 \`!locu on\` ➔ Activa la locución\n` +
                    `👉 \`!locu off\` ➔ Desactiva la locución\n` +
                    `👉 \`!locu <minutos>\` ➔ Cambia el tiempo (ej: \`!locu 5\` o \`!locu 3\`)`
            });
        }
    });

    console.log('🛡️ [SOPORTE ALERT] Sistema independiente de alerta de soporte iniciado correctamente con lógica multi-canal y detección de canales ocupados.');
}

module.exports = initSoporteAlert;
