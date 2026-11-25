const mongoose = require('mongoose');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const guildManager = require('./guildManager');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior,
    getVoiceConnection,
    StreamType
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
const CANAL_SANCIONES_STAFF_ID = '1527076023785619599';
const CANAL_STAFF_AFK_ID = '1517530849502040109'; // Canal STAFF AFK
const CANAL_STAFF_ROL_ID = '1520092751964799037'; // Canal STAFF EN ROL
const CANAL_SALA_CHARLA_STAFF_ID = '1571147950812569771'; // Sala de charla de staffs
const CANALES_SOPORTE_IDS = [
    '1517530849334136847', // SOPORTE 1
    '1517530849334136848', // SOPORTE 2
    '1517530849334136849', // SOPORTE 3
    '1517530849334136850', // SOPORTE 4
    '1517530849334136851'  // SOPORTE 5
];

// Configuración de salas de voz por servidor (en Vallecas RP usa sus IDs intactas; en otros servidores lee de su DB)
function getVoiceConfigForGuild(guildId) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return {
            esperaId: CANAL_ESPERA_ID,
            sancionesTextId: CANAL_SANCIONES_STAFF_ID,
            afkId: CANAL_STAFF_AFK_ID,
            rolId: CANAL_STAFF_ROL_ID,
            charlaId: CANAL_SALA_CHARLA_STAFF_ID,
            soporteIds: CANALES_SOPORTE_IDS
        };
    }
    const cfg = guildManager.getGuildConfig(guildId);
    let soporteIds = [];
    if (Array.isArray(cfg.VOICE_SOPORTE_IDS)) {
        soporteIds = cfg.VOICE_SOPORTE_IDS.filter(Boolean);
    } else if (typeof cfg.VOICE_SOPORTE_IDS === 'string' && cfg.VOICE_SOPORTE_IDS.trim()) {
        soporteIds = cfg.VOICE_SOPORTE_IDS.split(/[\s,]+/).filter(Boolean);
    }
    return {
        esperaId: cfg.VOICE_ESPERA_ID || '',
        sancionesTextId: cfg.CHANNEL_INFORME_LOCUCION_ID || cfg.CHANNEL_SANCIONES_ID || '',
        afkId: cfg.VOICE_AFK_ID || '',
        rolId: cfg.VOICE_ROL_ID || '',
        charlaId: cfg.VOICE_CHARLA_ID || '',
        soporteIds
    };
}

// Rol de staff por defecto
let ROLE_STAFF_ID = '1538191116610838691';
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (cfg.ROLE_STAFF_ID) ROLE_STAFF_ID = cfg.ROLE_STAFF_ID;
    }
} catch (e) { }

// Estado global por defecto (usado como respaldo y para servidor principal)
let sistemaActivo = true; // Interruptor ON/OFF
let tiempoEsperaMinutos = 0.5; // Por defecto 30 segundos (0.5 min)

// Estado de voz y temporizadores 100% AISLADO POR SERVIDOR (evita que un servidor vacío resetee a otro)
const guildVoiceStates = new Map();
function getGuildState(guildId) {
    const key = String(guildId || 'default');
    if (!guildVoiceStates.has(key)) {
        guildVoiceStates.set(key, {
            isPlayingVoice: false,
            playbackToken: 0,
            activeAbortFn: null,
            lastDisconnectAt: 0,
            welcomePlayedForSession: false,
            sessionStartedAt: 0,
            userJoinTimes: new Map(), // userId -> { joinedAt, userTag, memberName }
            staffAlertCount: 0,
            sanctionReportSent: false,
            nextAlertTurn: 'STAFF',
            lastActionAt: 0,
            userWelcomeDebounceTimer: null,
            activeConnection: null,
            activePlayer: null,
            stopCurrentTour: false
        });
    }
    return guildVoiceStates.get(key);
}

// Configuración de tiempo y ON/OFF aislada por servidor
function getGuildLocucionSettings(guildId) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return {
            active: sistemaActivo,
            minutes: tiempoEsperaMinutos
        };
    }
    const cfg = guildManager.getGuildConfig(guildId);
    const active = typeof cfg.LOCUCION_ACTIVO === 'boolean' ? cfg.LOCUCION_ACTIVO : sistemaActivo;
    const rawMin = Number(cfg.LOCUCION_ESPERA_MINUTOS);
    const minutes = (!isNaN(rawMin) && rawMin > 0) ? rawMin : tiempoEsperaMinutos;
    return { active, minutes };
}

async function setGuildMinutes(guildId, minutes) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        await setMinutesInDB(minutes);
        return;
    }
    await guildManager.setGuildConfigKey(guildId, 'LOCUCION_ESPERA_MINUTOS', minutes);
}

async function setGuildActive(guildId, active) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        await setActiveInDB(active);
        return;
    }
    await guildManager.setGuildConfigKey(guildId, 'LOCUCION_ACTIVO', active);
}

// Memoria RAM para los 5 audios
let audioStaff1Cache = null; // Aviso 1 a staffs (espera_soporte)
let audioStaff2Cache = null; // Aviso 2 a staffs (aviso_2)
let audioUsuarioCache = null; // Audio bienvenida/espera usuarios (locucion_de_esperas)
let audioSancionCache = null; // Aviso 3 de sanción a staffs (sancion_staffs)
let audioSalaCharlaCache = null; // Locución especial para sala de charla de staffs (sala_de_staffs)

/**
 * Carga o refresca los 5 audios desde MongoDB a memoria RAM
 */
async function loadAudiosFromDB() {
    try {
        const [staff1Rec, staff2Rec, userRec, sancionRec, charlaRec] = await Promise.all([
            AudioAlert.findOne({ name: 'espera_soporte' }),
            AudioAlert.findOne({ name: 'aviso_2' }),
            AudioAlert.findOne({ name: 'locucion_de_esperas' }),
            AudioAlert.findOne({ name: 'sancion_staffs' }),
            AudioAlert.findOne({ name: 'sala_de_staffs' })
        ]);

        if (staff1Rec && staff1Rec.data) {
            audioStaff1Cache = staff1Rec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Staff 1 cargado (${staff1Rec.size || audioStaff1Cache.length} bytes).`);
        }
        if (staff2Rec && staff2Rec.data) {
            audioStaff2Cache = staff2Rec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Staff 2 cargado (${staff2Rec.size || audioStaff2Cache.length} bytes).`);
        }
        if (userRec && userRec.data) {
            audioUsuarioCache = userRec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Usuario cargado (${userRec.size || audioUsuarioCache.length} bytes).`);
        }
        if (sancionRec && sancionRec.data) {
            audioSancionCache = sancionRec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Sanción Staff cargado (${sancionRec.size || audioSancionCache.length} bytes).`);
        }
        if (charlaRec && charlaRec.data) {
            audioSalaCharlaCache = charlaRec.data;
            console.log(`🔊 [SOPORTE ALERT] Audio Sala Charla cargado (${charlaRec.size || audioSalaCharlaCache.length} bytes).`);
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
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const guildStaffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? ROLE_STAFF_ID : '');
    if (guildStaffRoleId && member.roles.cache.has(guildStaffRoleId)) return true;
    if (guildManager.isPrimaryGuild(gId) && member.roles.cache.has('1538191116610838691')) return true; // Rol ▬▬▬[STAFF]▬▬▬
    if (member.roles.cache.some(r => 
        r.name.includes('[STAFF]') || 
        r.name.includes('[MODERACION]') || 
        r.name.includes('[ADMINISTRACION]') || 
        r.name.includes('[CUPULA]') ||
        r.name.includes('Soporte') || 
        r.name.includes('Moderador') || 
        r.name.includes('Administrador')
    )) return true;
    if (member.permissions.has('Administrator') || member.permissions.has('ManageGuild') || member.permissions.has('ManageChannels')) return true;
    return false;
}

/**
 * Desconexión forzada y limpieza total de conexiones de voz fantasmas (aislado por servidor y protegido por token)
 */
async function forceCleanVoice(guild, expectedToken = null) {
    const state = getGuildState(guild?.id);
    // Si ya arrancó una sesión de voz más reciente, JAMÁS destruir la conexión nueva
    if (expectedToken !== null && state.playbackToken !== expectedToken) return;

    try {
        if (state.activePlayer) {
            try { state.activePlayer.stop(true); } catch (e) { }
            state.activePlayer = null;
        }
        if (state.activeConnection) {
            try {
                if (state.activeConnection.state.status !== VoiceConnectionStatus.Destroyed) {
                    state.activeConnection.destroy();
                }
            } catch (e) { }
            state.activeConnection = null;
        }
        if (guild) {
            const existing = getVoiceConnection(guild.id);
            if (existing) {
                try {
                    if (existing.state.status !== VoiceConnectionStatus.Destroyed) {
                        existing.destroy();
                    }
                } catch (e) { }
            }
            if (expectedToken !== null && state.playbackToken !== expectedToken) return;
            if (guild.members.me && guild.members.me.voice && guild.members.me.voice.channelId) {
                await guild.members.me.voice.disconnect().catch(() => {});
            }
        }
    } catch (e) { }

    if (expectedToken === null || state.playbackToken === expectedToken) {
        state.isPlayingVoice = false;
        state.lastDisconnectAt = Date.now();
    }
}

/**
 * Corta inmediatamente cualquier reproducción o conexión activa en este servidor sin dejar timers zombis
 */
function abortPlaybackImmediately(guild, reason = 'Desconexión forzada') {
    const state = getGuildState(guild?.id);
    const abortToken = ++state.playbackToken; // Invalida al instante cualquier sesión anterior en vuelo
    state.stopCurrentTour = true;

    if (state.userWelcomeDebounceTimer) {
        clearTimeout(state.userWelcomeDebounceTimer);
        state.userWelcomeDebounceTimer = null;
    }

    // Resolver inmediatamente cualquier promesa de reproducción en curso (elimina timeouts colgados)
    if (typeof state.activeAbortFn === 'function') {
        const fn = state.activeAbortFn;
        state.activeAbortFn = null;
        try { fn(); } catch (_) { }
    }

    forceCleanVoice(guild, abortToken).catch(() => {});
    guildManager.logGuild(guild, '⏹️', reason);
}

/**
 * Comprueba de forma infalible si la sala de espera está vacía de usuarios
 */
function isWaitRoomEmpty(guild) {
    if (!guild) return true;
    const vc = getVoiceConfigForGuild(guild.id);
    if (!vc.esperaId) return true;
    const waitChannel = guild.channels.cache.get(vc.esperaId);
    if (!waitChannel || !waitChannel.isVoiceBased()) return true;

    const count = waitChannel.members.filter(m => !m.user.bot).size;
    return count === 0;
}

/**
 * Formatea milisegundos a texto legible "X min Y s"
 */
function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    if (mins === 0) return `${secs} s`;
    return `${mins} min ${secs} s`;
}

/**
 * Calcula con precisión milimétrica la duración real del audio (en ms) según su tamaño
 */
function getAudioDurationMs(buffer) {
    if (!buffer) return 8000;
    const len = buffer.length;
    // Tamaños exactos de los 5 archivos MP3 de Vallecas RP (128-140 kbps):
    // sancion_staffs: 243,888 bytes (~14.2s)
    if (len >= 220000) return 15000;
    // locucion_de_esperas: 163,222 bytes (~9.1s)
    if (len >= 160000) return 10000;
    // sala_de_staffs: 158,207 bytes (~8.8s)
    if (len >= 155000) return 9800;
    // aviso_2: 153,191 bytes (~8.5s)
    if (len >= 140000) return 9500;
    // espera_soporte: 117,247 bytes (~6.3s)
    if (len >= 100000) return 7300;
    // Fallback proporcional a 16 KB/seg
    return Math.max(6000, Math.ceil((len / 16000) * 1000) + 1200);
}

/**
 * Reproduce un buffer de audio en un canal y se desconecta de inmediato (blindado con token único por sesión)
 */
async function playAudioBufferInChannel(channel, audioBuffer, label = 'Audio') {
    const guild = channel?.guild;
    const state = getGuildState(guild?.id);

    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        console.warn(`⚠️ [SOPORTE ALERT] Audio buffer para ${label} no está disponible o está vacío.`);
        return false;
    }
    if (state.isPlayingVoice) {
        return false;
    }

    const myToken = ++state.playbackToken;
    state.isPlayingVoice = true;
    state.stopCurrentTour = false;
    let connection = null;
    let tempAudioFile = null;

    const cleanupTempFile = () => {
        if (tempAudioFile) {
            try {
                if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
            } catch (e) { }
            tempAudioFile = null;
        }
    };

    try {
        // Respiro mínimo de 700ms tras una desconexión reciente para que Discord Voice no rechace/corte la reconexión
        const sinceDisconnect = Date.now() - (state.lastDisconnectAt || 0);
        if (sinceDisconnect < 700) {
            await new Promise(res => setTimeout(res, 700 - sinceDisconnect));
        }

        // Si mientras esperábamos se abortó o alguien salió y dejó vacía la espera, salir limpiamente
        if (state.playbackToken !== myToken || state.stopCurrentTour) {
            return false;
        }
        if (channel.members.filter(m => !m.user.bot).size === 0) {
            return false;
        }

        // Asegurar que no haya conexiones previas colgadas en este servidor
        const oldConn = getVoiceConnection(guild.id);
        if (oldConn) {
            try {
                if (oldConn.state.status !== VoiceConnectionStatus.Destroyed) {
                    oldConn.destroy();
                }
            } catch (e) { }
            await new Promise(res => setTimeout(res, 250));
            if (state.playbackToken !== myToken || state.stopCurrentTour) return false;
        }

        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        state.activeConnection = connection;

        // Esperar conexión Ready con timeout prudente
        await entersState(connection, VoiceConnectionStatus.Ready, 10000);

        if (state.playbackToken !== myToken || state.stopCurrentTour) {
            await forceCleanVoice(guild, myToken);
            return false;
        }

        // Pequeño retardo para asegurar handshake WebRTC de Discord (audio limpio desde el segundo 0)
        await new Promise(res => setTimeout(res, 450));

        if (state.playbackToken !== myToken || state.stopCurrentTour) {
            await forceCleanVoice(guild, myToken);
            return false;
        }

        tempAudioFile = path.join(__dirname, `locu_temp_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`);
        fs.writeFileSync(tempAudioFile, audioBuffer);

        const durationMs = getAudioDurationMs(audioBuffer);

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });
        state.activePlayer = player;
        connection.subscribe(player);

        // createAudioResource directo con la ruta del archivo para máxima compatibilidad con FFmpeg
        const resource = createAudioResource(tempAudioFile);
        player.play(resource);

        await new Promise((resolve) => {
            let hasStartedPlaying = false;
            let resolved = false;
            let idleFinishTimer = null;

            const finish = () => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                if (idleFinishTimer) clearTimeout(idleFinishTimer);
                if (state.activeAbortFn === finish) state.activeAbortFn = null;
                cleanupTempFile();
                resolve();
            };

            // Registrar aborto instantáneo para que si el usuario sale, esta promesa termine al instante sin dejar timeouts zombis
            state.activeAbortFn = finish;

            // Timeout garantizado: el audio suena íntegro durante toda su duración + 1.2s de cortesía
            const timeout = setTimeout(() => {
                finish();
            }, durationMs + 1200);

            player.on('stateChange', (oldState, newState) => {
                if (state.playbackToken !== myToken) {
                    finish();
                    return;
                }
                if (newState.status === AudioPlayerStatus.Playing) {
                    hasStartedPlaying = true;
                }
                if (newState.status === AudioPlayerStatus.Idle && hasStartedPlaying) {
                    if (resource.playbackDuration >= (durationMs - 1500)) {
                        idleFinishTimer = setTimeout(finish, 500);
                    }
                }
            });

            player.on('error', (err) => {
                console.error(`❌ [SOPORTE ALERT] Error en player (${label}):`, err.message);
                finish();
            });
        });

        // Si esta sesión fue abortada o reemplazada mientras sonaba, NO tocar la conexión de una sesión nueva
        if (state.playbackToken !== myToken || state.stopCurrentTour) {
            return false;
        }

        await forceCleanVoice(guild, myToken);
        guildManager.logGuild(guild, '🎙️', `${label} reproducido en ${channel.name}`);
        return true;
    } catch (err) {
        if (state.playbackToken === myToken) {
            console.error(`❌ [SOPORTE ALERT] Error conectando/reproduciendo (${label}):`, err.message);
            await forceCleanVoice(guild, myToken);
        }
        return false;
    } finally {
        cleanupTempFile();
        if (state.playbackToken === myToken) {
            state.isPlayingVoice = false;
        }
    }
}

/**
 * Lanza la locución de bienvenida una única vez por sesión de espera
 */
async function triggerUserWaitRoomAlert(guild, reason = 'Bienvenida') {
    const settings = getGuildLocucionSettings(guild?.id);
    if (!settings.active) return;
    const state = getGuildState(guild?.id);
    if (state.isPlayingVoice || state.welcomePlayedForSession) return;
    if (!audioUsuarioCache) await loadAudiosFromDB();
    if (!audioUsuarioCache) return;

    const vc = getVoiceConfigForGuild(guild?.id);
    if (!vc.esperaId) return;
    const waitChannel = guild.channels.cache.get(vc.esperaId);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;
    if (waitChannel.members.filter(m => !m.user.bot).size === 0) return;

    // Marcar la bienvenida como emitida para esta sesión (así si entran más usuarios luego, NO se repite)
    state.welcomePlayedForSession = true;
    const success = await playAudioBufferInChannel(waitChannel, audioUsuarioCache, `Locución Usuarios (${reason})`);
    if (success) {
        // Reiniciar el temporizador exactamente cuando termina la bienvenida para respetar al segundo el intervalo configurado
        state.lastActionAt = Date.now();
    } else if (isWaitRoomEmpty(guild)) {
        state.welcomePlayedForSession = false;
    }
}

/**
 * Planifica la locución de bienvenida a los 4 segundos del último usuario que entre,
 * con un tope máximo de 12s desde el primero para agrupar entradas seguidas sin retrasarlo de más.
 * Si ya sonó la bienvenida en esta sesión, NO la vuelve a lanzar aunque entren más personas.
 */
function scheduleUserWelcomeAlert(guild) {
    const settings = getGuildLocucionSettings(guild?.id);
    if (!settings.active) return;
    const state = getGuildState(guild?.id);

    // Si ya sonó la bienvenida para la gente que está esperando, NO repetir por nuevas entradas
    if (state.welcomePlayedForSession || state.isPlayingVoice) return;

    if (state.userWelcomeDebounceTimer) {
        clearTimeout(state.userWelcomeDebounceTimer);
        state.userWelcomeDebounceTimer = null;
    }

    const now = Date.now();
    if (!state.sessionStartedAt) state.sessionStartedAt = now;
    const elapsedSinceFirst = now - state.sessionStartedAt;
    const maxWaitLeft = Math.max(500, 12000 - elapsedSinceFirst);
    const delayMs = Math.min(4000, maxWaitLeft);

    state.userWelcomeDebounceTimer = setTimeout(() => {
        state.userWelcomeDebounceTimer = null;
        triggerUserWaitRoomAlert(guild, 'Bienvenida 4s');
    }, delayMs);
}

/**
 * Detecta qué canal de staff debe recibir la alerta de refuerzo con estricta jerarquía de prioridad:
 *
 * PRIORIDAD 1 (Absoluta): Canales de soporte 1 al 5 donde haya staffs libres (sin ciudadanos).
 * PRIORIDAD 2: Sala de staffs (únicamente si NO hay staffs libres en soportes 1 al 5).
 * PRIORIDAD 3: Staff en rol (únicamente si NO hay staffs ni en soportes 1 al 5 ni en sala de staffs).
 *
 * Retorna null si no hay ningún staff disponible o si todos los soportes están ocupados atendiendo a ciudadanos.
 */
function getTargetStaffChannel(guild) {
    if (!guild) return null;
    const vc = getVoiceConfigForGuild(guild.id);

    // -------------------------------------------------------------
    // PRIORIDAD 1: Canales de SOPORTE (Soporte Libre)
    // -------------------------------------------------------------
    const freeSupportChannels = [];
    for (const channelId of vc.soporteIds) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) continue;

        const members = channel.members.filter(m => !m.user.bot);
        if (members.size === 0) continue;

        const staffsInChannel = members.filter(m => isMemberStaff(m));
        if (staffsInChannel.size === 0) continue;

        const hasNonStaff = members.some(m => !isMemberStaff(m));
        if (hasNonStaff) {
            // Canal ocupado atendiendo a un ciudadano. Respetar y no interrumpir.
            continue;
        }

        const hearingStaffs = staffsInChannel.filter(m => m.voice && !m.voice.deaf && !m.voice.selfDeaf);
        if (hearingStaffs.size > 0) {
            freeSupportChannels.push({
                channel,
                staffs: hearingStaffs,
                hasUnmuted: hearingStaffs.some(m => !m.voice.mute && !m.voice.selfMute)
            });
        }
    }

    // Si hay canales de soporte libres con staff, SE PRIORIZA SIEMPRE SOPORTE (ordenando por los que no están muteados)
    if (freeSupportChannels.length > 0) {
        freeSupportChannels.sort((a, b) => (b.hasUnmuted ? 1 : 0) - (a.hasUnmuted ? 1 : 0));
        return {
            channel: freeSupportChannels[0].channel,
            type: 'SOPORTE_LIBRE',
            staffs: freeSupportChannels[0].staffs
        };
    }

    // -------------------------------------------------------------
    // PRIORIDAD 2: SALA DE STAFFS (Solo si NO hay soportes libres)
    // -------------------------------------------------------------
    const charlaChannel = vc.charlaId ? guild.channels.cache.get(vc.charlaId) : null;
    const staffsEnCharla = (charlaChannel && charlaChannel.isVoiceBased())
        ? charlaChannel.members.filter(m => isMemberStaff(m) && m.voice && !m.voice.deaf && !m.voice.selfDeaf)
        : null;

    if (staffsEnCharla && staffsEnCharla.size > 0) {
        return {
            channel: charlaChannel,
            type: 'SALA_STAFFS',
            staffs: staffsEnCharla
        };
    }

    // -------------------------------------------------------------
    // PRIORIDAD 3: STAFF EN ROL (Solo si NO hay en soporte ni en sala de staffs)
    // -------------------------------------------------------------
    const rolChannel = vc.rolId ? guild.channels.cache.get(vc.rolId) : null;
    const staffsEnRol = (rolChannel && rolChannel.isVoiceBased())
        ? rolChannel.members.filter(m => isMemberStaff(m) && m.voice && !m.voice.deaf && !m.voice.selfDeaf)
        : null;

    if (staffsEnRol && staffsEnRol.size > 0) {
        return {
            channel: rolChannel,
            type: 'STAFF_EN_ROL',
            staffs: staffsEnRol
        };
    }

    // No hay staffs libres disponibles (o están todos ocupados atendiendo a ciudadanos)
    return null;
}

/**
 * Envía el informe detallado al canal de sanciones de staff con el diseño limpio y thumbnail superior
 */
async function sendSanctionReport(guild, { motivo, staffsInvolucrados, targetChannelId, usuariosAfectados, tiempoEsperadoMs, avisosEmitidos, client }) {
    try {
        const vc = getVoiceConfigForGuild(guild?.id);
        if (!vc.sancionesTextId) return;
        let canalSanciones = guild.channels.cache.get(vc.sancionesTextId);
        if (!canalSanciones) {
            try {
                canalSanciones = await guild.channels.fetch(vc.sancionesTextId);
            } catch (e) { }
        }
        if (!canalSanciones && client) {
            try {
                canalSanciones = await client.channels.fetch(vc.sancionesTextId);
            } catch (e) { }
        }

        if (!canalSanciones) {
            console.error(`❌ [SOPORTE ALERT] No se pudo obtener el canal de sanciones (${CANAL_SANCIONES_STAFF_ID})`);
            return;
        }

        const staffLines = staffsInvolucrados.length > 0
            ? staffsInvolucrados.map(s => `> <@${s.id}> ❗ \`(${s.user ? s.user.tag : s.id})\``).join('\n')
            : '> ⚠️ *Ningún staff disponible con audio activo*';

        const userLines = usuariosAfectados.length > 0
            ? usuariosAfectados.map(u => `> <@${u.id}> ❗ \`(${u.tag})\` • Espera: \`${formatDuration(u.timeMs)}\``).join('\n')
            : '> • *Usuarios no identificados*';

        const isAbandono = motivo.includes('ABANDONÓ');
        const badgeTitle = isAbandono 
            ? '🔴 USUARIO ABANDONÓ POR FALTA DE ATENCIÓN'
            : '⚠️ LLAMADAS DE SOPORTE DESATENDIDAS (3er AVISO)';
        const embedColor = isAbandono ? 0xE74C3C : 0xE67E22;

        const v = guildManager.resolveGuildVisuals(guild?.id);
        const files = [...v.files];
        const iconUrl = v.logoUrl || guild.iconURL() || undefined;
        const serverName = v.name || 'VALLECAS RP';

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: `SISTEMA DE CONTROL Y RENDIMIENTO | ${serverName}`,
                iconURL: iconUrl
            })
            .setTitle(badgeTitle)
            .setThumbnail(iconUrl)
            .setDescription(
                `\u200B\n` +
                `📌 **| Motivo del Informe:**\n` +
                `> ${motivo}\n\n` +
                `👤 **| Usuario(s) Afectado(s):**\n` +
                `${userLines}\n\n` +
                `🛡️ **| Staffs Sancionados:**\n` +
                `${staffLines}\n\n` +
                `⏱️ **| Tiempo de Espera:** \`${formatDuration(tiempoEsperadoMs)}\` • 📢 **Avisos Emitidos:** \`${avisosEmitidos} avisos\`\n\n` +
                `⚖️ **Informe remitido automáticamente a la Administración de ${serverName}**`
            )
            .setFooter({
                text: `${serverName} • Supervisión de Soporte`,
                iconURL: iconUrl
            })
            .setTimestamp();

        const mentionText = staffsInvolucrados.length > 0
            ? `🔔 **Atención Staffs sancionados:** ${staffsInvolucrados.map(s => `<@${s.id}>`).join(' ')}`
            : `🔔 **Aviso a Administración:**`;

        await canalSanciones.send({
            content: mentionText,
            embeds: [embed],
            files: files
        });

        guildManager.logGuild(guild, '📋', 'Informe disciplinario de soporte publicado');

        // Mover a los staffs al canal de STAFF AFK ÚNICAMENTE si ya se han emitido los 3 avisos completos
        // Y SOLO a los staffs presentes en el canal concreto donde sonó el 3er aviso
        const esTercerAvisoDisciplinario = avisosEmitidos >= 3;
        if (esTercerAvisoDisciplinario && staffsInvolucrados && staffsInvolucrados.length > 0) {
            for (const staffMember of staffsInvolucrados) {
                try {
                    if (staffMember.voice && staffMember.voice.channelId) {
                        // Comprobación de canal: NUNCA mover a un staff que esté en otro canal (como soporte atendiendo)
                        if (vc.afkId && (!targetChannelId || staffMember.voice.channelId === targetChannelId)) {
                            await staffMember.voice.setChannel(vc.afkId, 'Movido a STAFF AFK tras cumplirse los 3 avisos de soporte');
                            guildManager.logGuild(guild, '🔀', `Staff ${staffMember.user ? staffMember.user.username : staffMember.id} movido a STAFF AFK tras 3 avisos`);
                        }
                    }
                } catch (moveErr) {
                    console.error(`⚠️ [SOPORTE ALERT] No se pudo mover a ${staffMember.id} a AFK:`, moveErr.message);
                }
            }
        }
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error enviando informe a canal de sanciones:', err.message);
    }
}

/**
 * Chequeo periódico de la sala de espera y ciclo alternado de locuciones (100% aislado por servidor)
 */
async function checkWaitRoom(guild, client) {
    if (!guild) return;
    const settings = getGuildLocucionSettings(guild.id);
    const state = getGuildState(guild.id);
    if (!settings.active || state.isPlayingVoice) return;

    const vc = getVoiceConfigForGuild(guild.id);
    if (!vc.esperaId) return;
    const waitChannel = guild.channels.cache.get(vc.esperaId);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;

    const waitingUsers = waitChannel.members.filter(m => !m.user.bot);
    if (waitingUsers.size === 0) {
        if (state.userJoinTimes.size > 0 || state.staffAlertCount > 0 || state.lastActionAt > 0 || state.welcomePlayedForSession) {
            state.userJoinTimes.clear();
            state.staffAlertCount = 0;
            state.sanctionReportSent = false;
            state.nextAlertTurn = 'STAFF';
            state.lastActionAt = 0;
            state.welcomePlayedForSession = false;
            state.sessionStartedAt = 0;
        }
        return;
    }

    // Limpiar usuarios que salieron
    for (const [userId] of state.userJoinTimes) {
        if (!waitingUsers.has(userId)) {
            state.userJoinTimes.delete(userId);
        }
    }

    const now = Date.now();
    // Respetar el tiempo exacto configurado con !locu <minutos> (mínimo 5s para evitar bucles instantáneos)
    const intervalMs = Math.max(5000, Math.round(settings.minutes * 60 * 1000));
    let maxWaitTime = 0;

    for (const [userId, member] of waitingUsers) {
        if (!state.userJoinTimes.has(userId)) {
            state.userJoinTimes.set(userId, {
                joinedAt: now,
                userTag: member.user.tag,
                memberName: member.displayName
            });
        } else {
            const data = state.userJoinTimes.get(userId);
            const timeInRoom = now - data.joinedAt;
            if (timeInRoom > maxWaitTime) maxWaitTime = timeInRoom;
        }
    }

    // Si hay una bienvenida de 3s pendiente, esperar a que se ejecute primero
    if (state.userWelcomeDebounceTimer) return;

    // Si el bot arrancó y ya había gente en espera sin lastActionAt registrado, arrancar el contador desde ahora
    if (state.lastActionAt === 0) {
        if (maxWaitTime >= intervalMs) {
            state.lastActionAt = now - intervalMs;
        } else {
            return;
        }
    }

    // Comprobar si ya se cumplió exactamente el intervalo configurado (ej: 30s con !locu 0.5)
    if (now - state.lastActionAt < intervalMs) return;

    const target = getTargetStaffChannel(guild);

    // CASO 1: Si no hay staffs disponibles ni en soporte libre ni en sala de staffs
    // (Por ejemplo, todos los staffs están ocupados atendiendo a ciudadanos, o no hay nadie)
    if (!target) {
        if (!audioUsuarioCache) await loadAudiosFromDB();
        const ok = await playAudioBufferInChannel(waitChannel, audioUsuarioCache, 'Locución Espera Usuarios');
        if (ok) {
            state.lastActionAt = Date.now();
        }
        return;
    }

    // CASO 2: Hay canal de staffs para alertar -> Alternancia estricta STAFF <-> USUARIOS respetando siempre el intervalo
    if (state.nextAlertTurn === 'STAFF') {
        state.stopCurrentTour = false;
        state.staffAlertCount++; // Aviso 1, 2, 3...
        let audioToPlay = null;
        let audioLabel = '';

        if (state.staffAlertCount === 1) {
            if (target.type === 'SALA_STAFFS' || target.type === 'STAFF_EN_ROL') {
                if (!audioSalaCharlaCache) await loadAudiosFromDB();
                audioToPlay = audioSalaCharlaCache;
                audioLabel = `Aviso #1 ${target.channel.name} (Especial)`;
            } else {
                if (!audioStaff1Cache) await loadAudiosFromDB();
                audioToPlay = audioStaff1Cache;
                audioLabel = 'Aviso #1 Soporte';
            }
        } else if (state.staffAlertCount === 2) {
            if (!audioStaff2Cache) await loadAudiosFromDB();
            audioToPlay = audioStaff2Cache || audioStaff1Cache;
            audioLabel = `Aviso #2 (${target.channel.name})`;
        } else {
            if (!audioSancionCache) await loadAudiosFromDB();
            audioToPlay = audioSancionCache || audioStaff2Cache || audioStaff1Cache;
            audioLabel = `Aviso #3 Sanción (${target.channel.name})`;
        }

        const ok = await playAudioBufferInChannel(target.channel, audioToPlay, audioLabel);

        if (ok) {
            state.lastActionAt = Date.now();
            state.nextAlertTurn = 'USER'; // El siguiente turno le tocará al usuario en espera

            // Si es el 3er aviso: mover a los staffs de ESE MISMO CANAL a AFK y enviar informe
            if (state.staffAlertCount >= 3 && !state.sanctionReportSent) {
                state.sanctionReportSent = true;

                // OBTENER ÚNICAMENTE LOS STAFFS PRESENTES EN EL CANAL DONDE SE EMITIÓ EL 3er AVISO
                const currentStaffsInTarget = target.channel.members.filter(m => !m.user.bot && isMemberStaff(m));
                const staffsArray = Array.from(currentStaffsInTarget.values());

                const usuariosList = [];
                for (const [uid, udata] of state.userJoinTimes) {
                    usuariosList.push({
                        id: uid,
                        tag: udata.userTag,
                        timeMs: now - udata.joinedAt
                    });
                }

                await sendSanctionReport(guild, {
                    motivo: `El personal de ${target.channel.name} no acudió tras 2 avisos previos consecutivos. Se emitió la advertencia disciplinaria por voz.`,
                    staffsInvolucrados: staffsArray,
                    targetChannelId: target.channel.id, // ID exacto del canal donde sonó el aviso
                    usuariosAfectados: usuariosList,
                    tiempoEsperadoMs: maxWaitTime,
                    avisosEmitidos: state.staffAlertCount,
                    client: client
                });
            }
        }
    } else {
        // TURNO USUARIO: Recordatorio en la sala de espera
        if (!audioUsuarioCache) await loadAudiosFromDB();
        const ok = await playAudioBufferInChannel(waitChannel, audioUsuarioCache, 'Locución Espera Usuarios');
        if (ok) {
            state.lastActionAt = Date.now();
            state.nextAlertTurn = 'STAFF'; // Siguiente turno volverá a avisar a staffs
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

    // 2. Limpieza de conexiones de voz huérfanas al arrancar
    client.once('ready', () => {
        for (const [, guild] of client.guilds.cache) {
            forceCleanVoice(guild).catch(() => {});
        }
    });

    // 3. Auto-mantenimiento preventivo cada 1 minuto (limpia sockets de voz colgados por servidor)
    setInterval(() => {
        try {
            for (const [, guild] of client.guilds.cache) {
                const state = getGuildState(guild.id);
                if (!state.isPlayingVoice && isWaitRoomEmpty(guild)) {
                    forceCleanVoice(guild).catch(() => {});
                }
            }
        } catch (e) { }
    }, 60 * 1000);

    // 4. Evento voiceStateUpdate para gestionar entradas y salidas (multi-servidor aislado)
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const userId = newState.id;
        const member = newState.member || oldState.member;
        if (member && member.user && member.user.bot) return;

        const guild = newState.guild || oldState.guild;
        if (!guild) return;
        const vc = getVoiceConfigForGuild(guild.id);
        if (!vc.esperaId) return;
        const state = getGuildState(guild.id);
        const settings = getGuildLocucionSettings(guild.id);

        // Entró al canal de espera
        if (newState.channelId === vc.esperaId && oldState.channelId !== vc.esperaId) {
            const wasEmpty = state.userJoinTimes.size === 0;
            state.userJoinTimes.set(userId, {
                joinedAt: Date.now(),
                userTag: member ? member.user.tag : userId,
                memberName: member ? member.displayName : userId
            });
            if (wasEmpty) {
                state.lastActionAt = Date.now();
                state.sessionStartedAt = Date.now();
                state.welcomePlayedForSession = false;
                state.nextAlertTurn = 'STAFF';
                state.staffAlertCount = 0;
                state.sanctionReportSent = false;
            }
            // Solo planificar/agrupar bienvenida si aún NO sonó en esta sesión de espera
            if (!state.welcomePlayedForSession && !state.isPlayingVoice) {
                scheduleUserWelcomeAlert(guild);
            }
        }

        // Salió del canal de espera
        if (oldState.channelId === vc.esperaId && newState.channelId !== vc.esperaId) {
            const userData = state.userJoinTimes.get(userId);
            const timeWaitingMs = userData ? (Date.now() - userData.joinedAt) : 0;
            const prevAlertCount = state.staffAlertCount;

            state.userJoinTimes.delete(userId);

            // 1. Si la sala de espera de ESTE servidor queda vacía, cortar y limpiar AL INSTANTE (antes de cualquier await)
            if (isWaitRoomEmpty(guild)) {
                state.staffAlertCount = 0;
                state.sanctionReportSent = false;
                state.nextAlertTurn = 'STAFF';
                state.lastActionAt = 0;
                state.welcomePlayedForSession = false;
                state.sessionStartedAt = 0;
                abortPlaybackImmediately(guild, 'Sala de espera vacía. Desconectando bot');
            }

            // 2. ¿Fue movido a un canal de soporte por un staff o abandonó/se desconectó?
            const fueAtendidoEnSoporte = vc.soporteIds.includes(newState.channelId);

            if (!fueAtendidoEnSoporte) {
                // El usuario ABANDONÓ el canal de espera sin ser atendido
                const superoTiempo = timeWaitingMs >= (settings.minutes * 60 * 1000);
                if (prevAlertCount >= 1 || superoTiempo) {
                    guildManager.logGuild(guild, '⚠️', `Usuario ${userData ? userData.userTag : userId} abandonó espera tras ${formatDuration(timeWaitingMs)} sin atención`);

                    const target = getTargetStaffChannel(guild);
                    const staffsList = target ? Array.from(target.staffs.values()) : [];
                    sendSanctionReport(guild, {
                        motivo: 'El usuario se marchó de la sala de espera sin haber sido atendido tras esperar largo tiempo.',
                        staffsInvolucrados: staffsList,
                        targetChannelId: null, // No mover a nadie porque solo es reporte de abandono
                        usuariosAfectados: [{
                            id: userId,
                            tag: userData ? userData.userTag : (member ? member.user.tag : userId),
                            timeMs: timeWaitingMs
                        }],
                        tiempoEsperadoMs: timeWaitingMs,
                        avisosEmitidos: prevAlertCount,
                        client: client
                    }).catch(() => {});
                }
            }
        }
    });

    // 5. Chequeo periódico cada 1 segundo (precisión exacta de los intervalos configurados con !locu)
    setInterval(() => {
        try {
            for (const [, guild] of client.guilds.cache) {
                checkWaitRoom(guild, client).catch(() => {});
            }
        } catch (e) { }
    }, 1000);

    // 6. Comandos !locu, !setvoz y !vervoz (multi-servidor)
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;

        const content = message.content.trim();
        const lower = content.toLowerCase();

        // Comandos !setvoz / !vervoz para configurar salas de voz en cualquier servidor (ej. VilaCityRP)
        if (lower === '!vervoz' || lower.startsWith('!setvoz')) {
            const isOwnerOrAdmin = message.author.id === '1308814761269395527' || message.author.id === '418558256840179722' || message.member?.permissions?.has('Administrator');
            if (!isOwnerOrAdmin) return message.reply('❌ Solo Administradores pueden configurar las salas de voz.');

            const parts = content.split(/\s+/);
            const cmd = parts[0].toLowerCase();

            if (cmd === '!vervoz') {
                const vc = getVoiceConfigForGuild(message.guild.id);
                const v = guildManager.resolveGuildVisuals(message.guild.id);
                const fmt = (id) => id ? `<#${id}> (\`${id}\`)` : '`No configurado`';
                const sopList = vc.soporteIds.length ? vc.soporteIds.map(id => `<#${id}>`).join(', ') : '`Ninguna`';
                const emb = new EmbedBuilder()
                    .setColor(v.color)
                    .setTitle(`🎙️ Salas de Voz de Locución • ${v.name}`)
                    .setDescription(
                        `⏳ **Espera de Soporte:** ${fmt(vc.esperaId)}\n` +
                        `🛡️ **Salas de Soporte:** ${sopList}\n` +
                        `💬 **Sala de Charla Staff:** ${fmt(vc.charlaId)}\n` +
                        `💤 **Staff AFK:** ${fmt(vc.afkId)}\n` +
                        `🎭 **Staff En Rol:** ${fmt(vc.rolId)}\n` +
                        `📋 **Canal Informes (texto):** ${fmt(vc.sancionesTextId)}`
                    )
                    .setTimestamp();
                return message.reply({ embeds: [emb] });
            }

            const tipo = (parts[1] || '').toLowerCase();
            const ids = parts.slice(2).map(x => x.replace(/[<#>]/g, '').trim()).filter(x => /^\d{17,20}$/.test(x));
            if (!tipo || ids.length === 0) {
                return message.reply(
                    '❌ **Uso de `!setvoz`:**\n' +
                    '> `!setvoz espera <ID_VOZ>`\n' +
                    '> `!setvoz soporte <ID1> <ID2> <ID3>...`\n' +
                    '> `!setvoz charla <ID_VOZ>`\n' +
                    '> `!setvoz afk <ID_VOZ>`\n' +
                    '> `!setvoz rol <ID_VOZ>`\n' +
                    '> `!setvoz informe <#canal_texto o ID>`'
                );
            }

            const gId = message.guild.id;
            if (tipo === 'espera') {
                await guildManager.setGuildConfigKey(gId, 'VOICE_ESPERA_ID', ids[0]);
                return message.reply(`✅ **Canal de Espera de Soporte** guardado solo para este servidor: <#${ids[0]}>`);
            }
            if (['soporte', 'soportes', 'salas'].includes(tipo)) {
                await guildManager.setGuildConfigKey(gId, 'VOICE_SOPORTE_IDS', ids);
                return message.reply(`✅ **${ids.length} Sala(s) de Soporte** guardadas solo para este servidor: ${ids.map(id => `<#${id}>`).join(', ')}`);
            }
            if (tipo === 'charla') {
                await guildManager.setGuildConfigKey(gId, 'VOICE_CHARLA_ID', ids[0]);
                return message.reply(`✅ **Sala de Charla Staff** guardada solo para este servidor: <#${ids[0]}>`);
            }
            if (tipo === 'afk') {
                await guildManager.setGuildConfigKey(gId, 'VOICE_AFK_ID', ids[0]);
                return message.reply(`✅ **Canal Staff AFK** guardado solo para este servidor: <#${ids[0]}>`);
            }
            if (tipo === 'rol') {
                await guildManager.setGuildConfigKey(gId, 'VOICE_ROL_ID', ids[0]);
                return message.reply(`✅ **Canal Staff En Rol** guardado solo para este servidor: <#${ids[0]}>`);
            }
            if (['informe', 'informes', 'sanciones'].includes(tipo)) {
                await guildManager.setGuildConfigKey(gId, 'CHANNEL_INFORME_LOCUCION_ID', ids[0]);
                return message.reply(`✅ **Canal de Informes de Locución** guardado solo para este servidor: <#${ids[0]}>`);
            }
            return message.reply('❌ Tipo no válido. Usa: `espera`, `soporte`, `charla`, `afk`, `rol` o `informe`.');
        }

        if (lower.startsWith('!locu')) {
            const isStaff = isMemberStaff(message.member);
            if (!isStaff) {
                return message.reply({ content: '❌ No tienes permisos para configurar la locución de soporte.' });
            }

            const gId = message.guild.id;
            const vc = getVoiceConfigForGuild(gId);
            const state = getGuildState(gId);
            const settings = getGuildLocucionSettings(gId);
            const args = content.split(/\s+/);
            const subCmd = (args[1] || '').toLowerCase();
            const fmtCh = (id) => id ? `<#${id}>` : '`No configurado`';

            if (subCmd === 'on' || subCmd === 'activar') {
                try {
                    await setGuildActive(gId, true);
                    return message.reply({ content: `🟢 **Locución ACTIVADA:** El sistema está activo para soportes, sala de charla (${fmtCh(vc.charlaId)}) y reporte en ${fmtCh(vc.sancionesTextId)}.` });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            if (subCmd === 'off' || subCmd === 'desactivar') {
                try {
                    await setGuildActive(gId, false);
                    state.userJoinTimes.clear();
                    state.staffAlertCount = 0;
                    state.sanctionReportSent = false;
                    state.nextAlertTurn = 'STAFF';
                    state.lastActionAt = 0;
                    state.welcomePlayedForSession = false;
                    state.sessionStartedAt = 0;
                    abortPlaybackImmediately(message.guild, 'Locución desactivada manualmente');
                    return message.reply({ content: '🔴 **Locución DESACTIVADA:** El bot ya no entrará a avisar a los canales ni a la sala de espera en este servidor.' });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            const nuevoTiempo = parseFloat(subCmd.replace(',', '.'));
            if (!isNaN(nuevoTiempo) && nuevoTiempo > 0) {
                try {
                    await setGuildMinutes(gId, nuevoTiempo);
                    const secs = Math.round(nuevoTiempo * 60);
                    return message.reply({
                        content: `✅ **Tiempo de aviso actualizado:** Bienvenida a los **4s** y todas las locuciones cada **${nuevoTiempo} minutos (${secs}s)** (Estado: **${settings.active ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**).`
                    });
                } catch (err) {
                    console.error(err);
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            const curSecs = Math.round(settings.minutes * 60);
            return message.reply({
                content: `ℹ️ **Panel de control de la locución:**\n` +
                    `• **Estado actual:** ${settings.active ? '🟢 **ACTIVADO**' : '🔴 **DESACTIVADO**'}\n` +
                    `• **Bienvenida inicial:** **4 segundos** tras detectar entrada\n` +
                    `• **Intervalo de avisos:** **${settings.minutes} minutos (${curSecs}s)**\n` +
                    `• **Sala de charla staff:** ${fmtCh(vc.charlaId)}\n` +
                    `• **Canal de informes:** ${fmtCh(vc.sancionesTextId)}\n\n` +
                    `**Comandos disponibles:**\n` +
                    `👉 \`!locu on\` ➔ Activa el sistema\n` +
                    `👉 \`!locu off\` ➔ Desactiva el sistema\n` +
                    `👉 \`!locu <minutos>\` ➔ Cambia el tiempo de aviso *(ej: \`!locu 0.5\` = 30s)*`
            });
        }
    });

    console.log('🛡️ [SOPORTE ALERT] Sistema robusto blindado: desconexión limpia forzada + mantenimiento preventivo de 10 min.');
}

module.exports = initSoporteAlert;
