const mongoose = require('mongoose');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior
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
let tiempoEsperaMinutos = 5; // Por defecto 5 minutos

// Memoria RAM para los 4 audios
let audioStaff1Cache = null; // Aviso 1 a staffs (espera_soporte)
let audioStaff2Cache = null; // Aviso 2 a staffs (aviso_2)
let audioUsuarioCache = null; // Audio bienvenida/espera usuarios (locucion_de_esperas)
let audioSancionCache = null; // Aviso 3 de sanción a staffs (sancion_staffs)

let isPlayingVoice = false;
let userJoinTimes = new Map(); // userId -> { joinedAt, userTag, memberName }
let staffAlertCount = 0; // Contador de avisos para la sesión de espera actual (1, 2, 3...)
let sanctionReportSent = false; // Flag para no duplicar informe del 3er aviso
let lastStaffAlertAt = 0;
let lastUserRepeatAlertAt = 0;
let userWelcomeDebounceTimer = null;
let activeConnection = null;
let activePlayer = null;
let stopCurrentTour = false;

/**
 * Carga o refresca los 4 audios desde MongoDB a memoria RAM
 */
async function loadAudiosFromDB() {
    try {
        const [staff1Rec, staff2Rec, userRec, sancionRec] = await Promise.all([
            AudioAlert.findOne({ name: 'espera_soporte' }),
            AudioAlert.findOne({ name: 'aviso_2' }),
            AudioAlert.findOne({ name: 'locucion_de_esperas' }),
            AudioAlert.findOne({ name: 'sancion_staffs' })
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
    return waitChannel.members.filter(m => !m.user.bot).size === 0;
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

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });
        activePlayer = player;
        connection.subscribe(player);

        const stream = Readable.from(audioBuffer);
        const resource = createAudioResource(stream);
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
 * Planifica la locución de bienvenida con debounce de 5s
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
 * Analiza canales de soporte libres con staffs disponibles:
 * - Descarta canales con personas no-staff (ocupados en soporte)
 * - Descarta staffs ensordecidos
 * - Retorna ordenados: 1º no-silenciados, 2º silenciados
 * - También devuelve la lista de miembros Staffs detectados
 */
function getOrderedSupportChannelsAndStaffs(guild) {
    const listPriority1 = [];
    const listPriority2 = [];
    const allAvailableStaffMembers = [];

    for (const channelId of CANALES_SOPORTE_IDS) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) continue;

        const members = channel.members.filter(m => !m.user.bot);
        if (members.size === 0) continue;

        // Si hay algún no-staff, está ocupado atendiendo
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
            allAvailableStaffMembers.push(staffMember);

            const isMuted = vs.mute || vs.selfMute;
            if (!isMuted) hasUnmutedStaff = true;
        }

        if (hasUnmutedStaff) {
            listPriority1.push(channel);
        } else if (hasHearingStaff) {
            listPriority2.push(channel);
        }
    }

    return {
        channels: [...listPriority1, ...listPriority2],
        staffMembers: allAvailableStaffMembers
    };
}

/**
 * Envía el informe detallado al canal de sanciones de staff con el diseño limpio y thumbnail superior
 */
async function sendSanctionReport(guild, { motivo, staffsInvolucrados, usuariosAfectados, tiempoEsperadoMs, avisosEmitidos, client }) {
    try {
        // Obtenemos el canal con fetch para asegurar disponibilidad total
        let canalSanciones = guild.channels.cache.get(CANAL_SANCIONES_STAFF_ID);
        if (!canalSanciones) {
            try {
                canalSanciones = await guild.channels.fetch(CANAL_SANCIONES_STAFF_ID);
            } catch (e) { }
        }
        if (!canalSanciones && client) {
            try {
                canalSanciones = await client.channels.fetch(CANAL_SANCIONES_STAFF_ID);
            } catch (e) { }
        }

        if (!canalSanciones) {
            console.error(`❌ [SOPORTE ALERT] No se pudo obtener el canal de sanciones (${CANAL_SANCIONES_STAFF_ID})`);
            return;
        }

        // Formato limpio con blockquotes (>) idéntico al de valoraciones
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

        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const files = [];
        let logoAttachment = null;
        if (fs.existsSync(logoPath)) {
            logoAttachment = new AttachmentBuilder(logoPath, { name: 'logo.png' });
            files.push(logoAttachment);
        }

        const iconUrl = logoAttachment ? 'attachment://logo.png' : (guild.iconURL() || undefined);

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setAuthor({
                name: 'SISTEMA DE CONTROL Y RENDIMIENTO | VALLECAS RP',
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
                `🛡️ **| Staffs Disponibles Notificados:**\n` +
                `${staffLines}\n\n` +
                `⏱️ **| Tiempo de Espera:** \`${formatDuration(tiempoEsperadoMs)}\` • 📢 **Avisos Emitidos:** \`${avisosEmitidos} avisos\`\n\n` +
                `⚖️ **Informe remitido automáticamente a la Administración de VALLECAS RP**`
            )
            .setFooter({
                text: 'VALLECAS RP • Supervisión de Soporte',
                iconURL: iconUrl
            })
            .setTimestamp();

        // Mención fuera del embed para que llegue la alerta sonora
        const mentionText = staffsInvolucrados.length > 0
            ? `🔔 **Atención Staffs en servicio:** ${staffsInvolucrados.map(s => `<@${s.id}>`).join(' ')}`
            : `🔔 **Aviso a Administración:**`;

        await canalSanciones.send({
            content: mentionText,
            embeds: [embed],
            files: files
        });

        console.log(`📋 [SOPORTE ALERT] Informe disciplinario publicado con éxito en el canal de sanciones.`);
    } catch (err) {
        console.error('❌ [SOPORTE ALERT] Error enviando informe a canal de sanciones:', err.message);
    }
}

/**
 * Chequeo periódico de la sala de espera
 */
async function checkWaitRoom(guild, client) {
    if (!sistemaActivo) return;
    if (isPlayingVoice) return;

    const waitChannel = guild.channels.cache.get(CANAL_ESPERA_ID);
    if (!waitChannel || !waitChannel.isVoiceBased()) return;

    const waitingUsers = waitChannel.members.filter(m => !m.user.bot);
    if (waitingUsers.size === 0) {
        userJoinTimes.clear();
        staffAlertCount = 0;
        sanctionReportSent = false;
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
    let maxWaitTime = 0;
    let usuarioHaSuperadoStaffTime = false;

    for (const [userId, member] of waitingUsers) {
        if (!userJoinTimes.has(userId)) {
            userJoinTimes.set(userId, {
                joinedAt: now,
                userTag: member.user.tag,
                memberName: member.displayName
            });
        } else {
            const data = userJoinTimes.get(userId);
            const timeInRoom = now - data.joinedAt;
            if (timeInRoom > maxWaitTime) maxWaitTime = timeInRoom;
            if (timeInRoom >= tiempoLimiteMs) {
                usuarioHaSuperadoStaffTime = true;
            }
        }
    }

    // 1. REPETICIÓN A USUARIOS CADA 1 MINUTO
    if (usuarioHaSuperadoStaffTime) {
        const timeSinceLastRepeat = now - lastUserRepeatAlertAt;
        if (timeSinceLastRepeat >= 60 * 1000 && !isPlayingVoice) {
            await triggerUserWaitRoomAlert(guild, 'Recordatorio 1min');
        }
    }

    // 2. AVISO A STAFFS (Solo si han pasado los minutos configurados desde el último aviso)
    const tiempoEntreAvisosMs = tiempoEsperaMinutos * 60 * 1000;
    const yaTocaAvisar = (lastStaffAlertAt === 0) || ((now - lastStaffAlertAt) >= tiempoEntreAvisosMs);

    if (usuarioHaSuperadoStaffTime && yaTocaAvisar) {
        const { channels, staffMembers } = getOrderedSupportChannelsAndStaffs(guild);
        if (channels.length > 0 && !isPlayingVoice) {
            stopCurrentTour = false;
            staffAlertCount++; // Incrementamos aviso (1, 2, 3...)
            let staffAlertOk = false;

            // Selección exacta de audios
            let audioToPlay = null;
            let audioLabel = '';

            if (staffAlertCount === 1) {
                if (!audioStaff1Cache) await loadAudiosFromDB();
                audioToPlay = audioStaff1Cache;
                audioLabel = 'Aviso Staff #1';
            } else if (staffAlertCount === 2) {
                if (!audioStaff2Cache) await loadAudiosFromDB();
                audioToPlay = audioStaff2Cache || audioStaff1Cache;
                audioLabel = 'Aviso Staff #2 (Último aviso)';
            } else {
                if (!audioSancionCache) await loadAudiosFromDB();
                audioToPlay = audioSancionCache || audioStaff2Cache || audioStaff1Cache;
                audioLabel = `Locución Sanción Staff (Aviso #${staffAlertCount})`;
            }

            console.log(`📢 [SOPORTE ALERT] Lanzando ${audioLabel} en ${channels.length} canal(es)...`);

            for (const targetChannel of channels) {
                if (stopCurrentTour || isWaitRoomEmpty(guild)) {
                    console.log('⏹️ [SOPORTE ALERT] Sala de espera vacía o atendida. Cancelando ronda a staffs.');
                    break;
                }

                const ok = await playAudioBufferInChannel(targetChannel, audioToPlay, audioLabel);
                if (ok) {
                    staffAlertOk = true;
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            if (staffAlertOk) {
                lastStaffAlertAt = Date.now();

                // Si es el 3er aviso y aún no se envió el informe de sanción, publicarlo INMEDIATAMENTE
                if (staffAlertCount >= 3 && !sanctionReportSent) {
                    sanctionReportSent = true;
                    const usuariosList = [];
                    for (const [uid, udata] of userJoinTimes) {
                        usuariosList.push({
                            id: uid,
                            tag: udata.userTag,
                            timeMs: now - udata.joinedAt
                        });
                    }

                    await sendSanctionReport(guild, {
                        motivo: 'El personal de soporte no acudió tras 2 avisos previos consecutivos. Se emitió la advertencia disciplinaria por voz.',
                        staffsInvolucrados: staffMembers,
                        usuariosAfectados: usuariosList,
                        tiempoEsperadoMs: maxWaitTime,
                        avisosEmitidos: staffAlertCount,
                        client: client
                    });
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
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const userId = newState.id;
        const member = newState.member || oldState.member;
        if (member && member.user && member.user.bot) return;

        // Entró al canal de espera
        if (newState.channelId === CANAL_ESPERA_ID && oldState.channelId !== CANAL_ESPERA_ID) {
            userJoinTimes.set(userId, {
                joinedAt: Date.now(),
                userTag: member ? member.user.tag : userId,
                memberName: member ? member.displayName : userId
            });
            const guild = newState.guild;
            scheduleUserWelcomeAlert(guild);
        }

        // Salió del canal de espera
        if (oldState.channelId === CANAL_ESPERA_ID && newState.channelId !== CANAL_ESPERA_ID) {
            const userData = userJoinTimes.get(userId);
            const timeWaitingMs = userData ? (Date.now() - userData.joinedAt) : 0;
            const guild = oldState.guild || newState.guild;

            userJoinTimes.delete(userId);

            // ¿Fue movido a un canal de soporte por un staff o abandonó/se desconectó?
            const fueAtendidoEnSoporte = CANALES_SOPORTE_IDS.includes(newState.channelId);

            if (!fueAtendidoEnSoporte) {
                // El usuario ABANDONÓ el canal de espera sin ser atendido
                const superoTiempo = timeWaitingMs >= (tiempoEsperaMinutos * 60 * 1000);
                if (staffAlertCount >= 1 || superoTiempo) {
                    console.log(`⚠️ [SOPORTE ALERT] Usuario ${userData ? userData.userTag : userId} abandonó la sala tras ${formatDuration(timeWaitingMs)} sin atención.`);

                    const { staffMembers } = getOrderedSupportChannelsAndStaffs(guild);
                    await sendSanctionReport(guild, {
                        motivo: 'El usuario se marchó de la sala de espera sin haber sido atendido tras esperar largo tiempo.',
                        staffsInvolucrados: staffMembers,
                        usuariosAfectados: [{
                            id: userId,
                            tag: userData ? userData.userTag : (member ? member.user.tag : userId),
                            timeMs: timeWaitingMs
                        }],
                        tiempoEsperadoMs: timeWaitingMs,
                        avisosEmitidos: staffAlertCount,
                        client: client
                    });
                }
            }

            // Si la sala de espera queda vacía, abortar reproducciones y resetear contadores
            if (guild && isWaitRoomEmpty(guild)) {
                staffAlertCount = 0;
                sanctionReportSent = false;
                if (isPlayingVoice || activeConnection) {
                    abortPlaybackImmediately('Sala de espera vacía. Desconectando bot');
                }
            }
        }
    });

    // 3. Chequeo periódico cada 5 segundos
    setInterval(() => {
        try {
            for (const [, guild] of client.guilds.cache) {
                checkWaitRoom(guild, client).catch(() => {});
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
                    return message.reply({ content: `🟢 **Locución ACTIVADA:** El sistema emitirá el Aviso #1, luego el Aviso #2, y el Aviso #3 disciplinario con reporte a <#${CANAL_SANCIONES_STAFF_ID}> si nadie atiende.` });
                } catch (e) {
                    return message.reply({ content: '❌ Error al guardar en la base de datos.' });
                }
            }

            if (subCmd === 'off' || subCmd === 'desactivar') {
                try {
                    await setActiveInDB(false);
                    userJoinTimes.clear();
                    staffAlertCount = 0;
                    sanctionReportSent = false;
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
                    `• **Secuencia de audios a Staff:**\n` +
                    `   1️⃣ **Aviso 1:** \`espera_soporte.mp3\` (Llamada inicial)\n` +
                    `   2️⃣ **Aviso 2:** \`aviso_2.mp3\` (Segundo y último aviso)\n` +
                    `   3️⃣ **Aviso 3:** \`sancion_staffs.mp3\` (Locución disciplinaria + informe en <#${CANAL_SANCIONES_STAFF_ID}>)\n\n` +
                    `**Comandos disponibles:**\n` +
                    `👉 \`!locu on\` ➔ Activa el sistema\n` +
                    `👉 \`!locu off\` ➔ Desactiva el sistema\n` +
                    `👉 \`!locu <minutos>\` ➔ Cambia el tiempo de aviso a staffs`
            });
        }
    });

    console.log('🛡️ [SOPORTE ALERT] Sistema completo activo: Mensajes con diseño limpio idéntico a valoraciones (sin banners, thumbnail superior).');
}

module.exports = initSoporteAlert;
