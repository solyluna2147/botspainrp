// ==========================================
// MÓDULO INDEPENDIENTE: ASISTENTE INFORMATIVO POR DM (VALLECAS RP)
// ==========================================
// Actúa ÚNICAMENTE por Mensajes Directos (DM) al bot.
// - Si alguien pregunta qué puede hacer / qué sistemas tiene / funciones -> envía el catálogo completo.
// - Permite conversar con IA sobre cualquier sistema, función o duda del bot.
// - Confidencialidad estricta: NUNCA revela proveedores, APIs, modelos ni tecnología interna.

const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const GROQ_MODELS = [
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
];

// Memoria de conversación por usuario en DM (se limpia tras 30 min de inactividad)
const dmHistories = new Map(); // userId -> { messages: [{role, content}], lastAt: number }
const dmCooldown = new Map();  // userId -> timestamp (anti-spam suave 2s)

function getLogoAttachment() {
    const p = path.join(__dirname, 'assets', 'logo.png');
    if (fs.existsSync(p)) {
        return new AttachmentBuilder(p, { name: 'logo.png' });
    }
    return null;
}

function getConfiguredApiKeys() {
    const keys = [];
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim()) {
        keys.push(process.env.GROQ_API_KEY.trim());
    }
    for (let i = 2; i <= 25; i++) {
        const val = process.env[`GROQ_API_KEY_${i}`];
        if (val && val.trim()) keys.push(val.trim());
    }
    return keys;
}

// Base de conocimiento oficial y completa del bot (enfoque comercial/personalizable para cualquier servidor FiveM RP)
const BOT_CAPABILITIES_KNOWLEDGE = `
CATÁLOGO COMPLETO DE SISTEMAS DEL BOT TODO-EN-UNO PARA SERVIDORES DE FIVEM RP:
(Todos los sistemas son 100% personalizables con el nombre, logo, colores, banners, canales, roles y normativa propia de cada servidor.)

1. CONSULTAS DE NORMATIVA CON INTELIGENCIA ARTIFICIAL:
- Doble canal independiente: uno exclusivo para el equipo de Staff y otro abierto para todos los Usuarios/Ciudadanos de tu servidor.
- Funciona simplemente escribiendo la duda hablando normalmente, sin comandos.
- Se entrena al 100% con la Normativa General y la Normativa de Ilegales de tu servidor, reconociendo todas las siglas de Roleplay (RK, PK, CK, MG, PG, DM, VDM, HK, NVV, RDE, ZS, etc.) y se actualiza al instante desde un canal de aprendizaje privado para tu Staff.
- Incluye botón de borrado rápido, auto-limpieza automática para mantener el canal impecable, sistema multi-núcleo con respaldo automático sin caídas y registro completo en un canal privado de logs.

2. ASISTENTE VIRTUAL INTELIGENTE DE TICKETS:
- Actúa automáticamente en tus categorías de tickets (Soporte, Apelaciones de Baneo, Creadores de Contenido y Donaciones) mientras ningún Staff haya intervenido todavía.
- Recopila la información clave del usuario (motivo, capturas/pruebas, método de pago, artículos VIP, enlaces de canal) con botones interactivos.
- Envía un resumen estructurado con aviso al Staff y se silencia automáticamente en cuanto un Staff entra o es llamado.
- Transforma automáticamente los cierres del Staff ("RESUMEN: ...") en un embed oficial de registro y memoriza nuevas directrices desde el canal de aprendizaje.

3. SISTEMA DE LOCUCIÓN Y AVISOS DE SOPORTE POR VOZ:
- Detecta al instante cuando un usuario entra en el canal de voz de Espera de Soporte.
- Reproduce una locución de bienvenida personalizada para el usuario en espera.
- Recorre las salas de soporte y la sala de charla de Staff emitiendo avisos sonoros periódicos (Aviso 1, Aviso 2 recordatorio y Aviso 3 de sanción), respetando a los Staffs que estén en canales de AFK o En Rol.
- Si tras el 3er aviso ningún Staff acude a atender al usuario, genera y envía automáticamente un informe oficial para la Administración.

4. SISTEMA DE WHITELIST Y AUDITORÍA ANTI-IA:
- Auditoría inteligente Anti-IA multicapa para revisar solicitudes escritas y detectar respuestas copiadas o generadas artificialmente.
- Publicación automática con diseño prémium y banners personalizados de Whitelist Aprobada y Whitelist Denegada.

5. EXPEDIENTES Y SISTEMA DISCIPLINARIO DE SANCIONES:
- Panel interactivo para emitir sanciones oficiales, adjuntar pruebas visuales, registrar expedientes y consultar el historial disciplinario completo de cualquier ciudadano.

6. ASCENSOS Y DESCENSOS AUTOMÁTICOS DE STAFF:
- Vigila en tiempo real los cambios de rango dentro de la jerarquía completa de tu equipo de Staff (totalmente configurable con tus propios roles).
- Publica automáticamente los anuncios oficiales en los canales de Ascensos y Descensos, agrupándolos en un mismo anuncio elegante si se producen varios cambios seguidos.

7. VALORACIONES CIUDADANAS Y RANKING TOP STAFF:
- Panel interactivo donde los usuarios eligen al Staff que les atendió, lo puntúan con estrellas y dejan su reseña.
- Ranking Top Staff auto-actualizable en tiempo real con medias, estadísticas y gestión completa del equipo.

8. STREAMERS, CREADORES DE CONTENIDO Y DIRECTOS EN VIVO:
- Detección automática cuando un streamer oficial inicia directo y panel interactivo con botón para anunciar directos de Twitch, Kick y TikTok con diseño visual personalizado por plataforma.
- Auditoría automática de canales de Twitch, Kick y TikTok (seguidores, media de espectadores y visualizaciones) para solicitudes de rango Streamer.

9. GESTIÓN Y PUBLICACIÓN OFICIAL DE EVENTOS:
- Panel interactivo para el Staff con formulario inteligente: pega la información del evento y el bot maqueta automáticamente título, fecha, hora, lugar, organizador, código de vestimenta, premios y cartel/flyer con diseño de lujo.
- Publicación simultánea en doble canal oficial de eventos.

10. PANEL DE PLANTILLAS Y POSTULACIONES:
- Menú selector interactivo de plantillas oficiales de postulación (facciones, organizaciones, negocios, staff, etc.) listo para enviar directamente a los tickets.

11. BIENVENIDAS PERSONALIZADAS Y ESTADO EN VIVO DE FIVEM:
- Bienvenidas automáticas con tu banner oficial, contador de miembros y accesos directos a los canales clave de tu servidor.
- Panel auto-actualizable en vivo de tu servidor FiveM mostrando jugadores conectados en tiempo real, estado online/offline, IP y código de conexión directa.

12. DASHBOARDS DE MONITORIZACIÓN EN TIEMPO REAL Y PANEL MAESTRO:
- Paneles en vivo para el equipo de administración: Estado General de Servicios, Monitor de Locución y Salas de Soporte (actualizado al instante al entrar/salir de voz), Monitor de Cola de Tickets en vivo y Monitor de Núcleos y Consumo de IA.
- Panel maestro de configuración para cambiar canales, roles, IP, textos y paneles en segundos sin tocar código.
`;

// Detectar si el usuario pide específicamente el catálogo completo del bot ("qué puedes hacer", "qué sistemas tienes", etc.)
function isAskingForFullCatalog(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (clean.length > 95) return false;

    const catalogPatterns = [
        /^(catalogo|sistemas|funciones)[\s!?.]*$/,
        /que\s+(puedes|sabes|eres\s+capaz\s+de)\s+(hacer|realizar|ofrecer)/,
        /que\s+(tienes|haces|sistemas|funciones|cosas|modulos|servicios)/,
        /cuales\s+son\s+tus\s+(funciones|sistemas|servicios|comandos)/,
        /para\s+que\s+sirves/,
        /todo\s+lo\s+que\s+(puedes|haces|tienes)/,
        /dime\s+(todo|tus\s+funciones|tus\s+sistemas|que\s+haces)/,
        /explicame\s+(que\s+haces|todo|tus\s+sistemas)/
    ];
    return catalogPatterns.some(rx => rx.test(clean));
}

function buildCatalogEmbeds() {
    const logoAtt = getLogoAttachment();
    const logoUrl = logoAtt ? 'attachment://logo.png' : undefined;

    const embed1 = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({
            name: 'ASISTENTE INTELIGENTE',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('✨ ¿QUÉ PUEDO HACER POR TU SERVIDOR?')
        .setDescription(
            `¡Hola! Soy un **Asistente Inteligente avanzado para servidores de FiveM Roleplay**, **100% personalizable** con tu logo, colores, banners, roles, canales y tu propia normativa.\n\n` +
            `### 🧠 INTELIGENCIA ARTIFICIAL Y ATENCIÓN\n` +
            `📚 **1. Consultas de Normativa con IA**\n` +
            `> • Canales independientes para **Usuarios** y **Staff**, entrenados con la normativa de tu servidor *(General, Ilegales y siglas RP)*.\n` +
            `> • Responde al instante con solo hablar *(sin comandos)*, con auto-limpieza a los 90s, botón de cierre, respaldo multi-núcleo y **canal privado de logs**.\n\n` +
            `🎫 **2. Asistente Virtual Inteligente de Tickets**\n` +
            `> • Atiende **Soporte, Apelaciones, Creadores y Donaciones** mientras no haya entrado un Staff.\n` +
            `> • Recopila motivo, capturas, método de pago o enlaces, envía un **resumen estructurado al Staff** y se silencia al instante.\n` +
            `> • Formatea automáticamente los cierres del Staff (\`RESUMEN:\`) y aprende nuevas directrices desde tu **canal de aprendizaje**.\n\n` +
            `🎙️ **3. Locución y Avisos de Soporte por Voz**\n` +
            `> • Detecta usuarios en **Espera de Soporte** y les reproduce una locución de bienvenida automática.\n` +
            `> • Avisa por voz al Staff en **Salas de Soporte y Sala de Charla** *(Aviso 1, 2 y 3)* respetando salas AFK/En Rol, con **informe automático** si nadie atiende.`
        );

    const embed2 = new EmbedBuilder()
        .setColor(0xD900FF)
        .setDescription(
            `### 🛡️ WHITELIST, MODERACIÓN Y EQUIPO STAFF\n` +
            `📋 **4. Whitelist y Auditoría Anti-IA**\n` +
            `> • **Detector Anti-IA multicapa** para identificar formularios copiados o hechos con inteligencia artificial.\n` +
            `> • Anuncios automáticos con diseño prémium y banners personalizados de **Whitelist Aprobada** y **Denegada**.\n\n` +
            `⚖️ **5. Expedientes y Sistema de Sanciones**\n` +
            `> • Panel interactivo para emitir sanciones con pruebas, guardar expedientes y consultar el historial disciplinario de cualquier jugador.\n\n` +
            `📈 **6. Ascensos y Descensos Automáticos de Staff**\n` +
            `> • Detecta al instante cualquier cambio en la jerarquía de rangos de tu Staff y publica los anuncios oficiales agrupados automáticamente.\n\n` +
            `⭐ **7. Valoraciones Ciudadanas y Ranking Top Staff**\n` +
            `> • Panel con menú para valorar a tu equipo con estrellas y reseña + **Ranking Top Staff** auto-actualizable en tiempo real.`
        );

    const embed3 = new EmbedBuilder()
        .setColor(0xD900FF)
        .setDescription(
            `### 🎉 COMUNIDAD, SERVIDOR Y MONITORIZACIÓN\n` +
            `🟣 **8. Streamers y Directos en Vivo**\n` +
            `> • Panel y avisos de directos para **Twitch, Kick y TikTok** con diseño personalizado y auditoría automática de canales.\n\n` +
            `🎊 **9. Gestión y Publicación de Eventos**\n` +
            `> • Formulario inteligente que maqueta título, hora, lugar, organizador, premios y cartel con formato de lujo en doble canal.\n\n` +
            `📑 **10. Panel de Plantillas y Postulaciones**\n` +
            `> • Selector interactivo de plantillas oficiales listo para enviar directamente a los tickets de tu servidor.\n\n` +
            `👋 **11. Bienvenidas Oficiales y Estado en Vivo de FiveM**\n` +
            `> • Bienvenidas con tu banner y accesos rápidos + panel en tiempo real con jugadores conectados, IP y código de conexión.\n\n` +
            `🖥️ **12. Dashboards en Tiempo Real y Panel Maestro**\n` +
            `> • Monitores en vivo de **Servicios**, **Locución/Salas**, **Cola de Tickets** y **Núcleos IA**, más panel de configuración instantánea para adaptar todo a tu servidor.\n\n` +
            `💬 **¿Quieres saber cómo funciona algún sistema en concreto para tu servidor?**\n` +
            `*Pregúntame directamente por aquí lo que quieras y te lo explico al detalle.*`
        )
        .setFooter({
            text: 'Asistente Inteligente • 100% Personalizable para tu Servidor',
            iconURL: logoUrl
        })
        .setTimestamp();

    return {
        embeds: [embed1, embed2, embed3],
        files: logoAtt ? [logoAtt] : [],
        components: [buildOpenDemosButtonRow()]
    };
}

// ==========================================
// SISTEMA INTERACTIVO DE PRUEBAS / DEMOS EN VIVO (SOLO POR DM • 0 TOKENS)
// Replica el diseño EXACTO de cada panel, botón, modal y mensaje real del bot,
// adaptado de forma genérica a "TU SERVIDOR RP" y con etiquetas (Tag Staff) / (Tag Usuario).
// ==========================================

function buildDemoStreamNotification({ platform, user, streamUrl, streamTitle }) {
    const isKick = platform === 'Kick';
    const isTikTok = platform === 'TikTok';
    const platformColor = isKick ? 0x53FC18 : (isTikTok ? 0xFE2C55 : 0x9146FF);
    const platformEmoji = isKick ? '🟢' : (isTikTok ? '🌸' : '🟣');
    const platformName = isKick ? 'Kick' : (isTikTok ? 'TikTok LIVE' : 'Twitch');
    const platformButtonLabel = isKick ? '🟢 Ver Directo en Kick' : (isTikTok ? '🌸 Ver TikTok LIVE' : '🟣 Ver Directo en Twitch');

    const userMention = user ? `<@${user.id}>` : '`(Tag Streamer)`';
    const avatarUrl = user ? user.displayAvatarURL({ dynamic: true }) : undefined;

    let validStreamUrl = (streamUrl || '').trim();
    if (!validStreamUrl) {
        validStreamUrl = isKick ? 'https://kick.com/tucanal' : (isTikTok ? 'https://www.tiktok.com/@tucanal/live' : 'https://twitch.tv/tucanal');
    } else if (!/^https?:\/\//i.test(validStreamUrl)) {
        validStreamUrl = `https://${validStreamUrl}`;
    }

    const cleanTitle = (streamTitle && streamTitle.trim())
        ? streamTitle.trim()
        : `Roleplay en vivo en TU SERVIDOR RP 🇪🇸 (${platformName})`;

    const notificationHeadline = isKick
        ? `# 🟢 ¡${userMention} ESTÁ EN DIRECTO EN KICK!\n# ¡Entra a apoyar el stream en TU SERVIDOR RP!`
        : (isTikTok
            ? `# 🌸 ¡${userMention} ESTÁ EN DIRECTO EN TIKTOK!\n# ¡Entra al LIVE y apoya el stream en TU SERVIDOR RP!`
            : `# 🟣 ¡${userMention} ESTÁ EN DIRECTO EN TWITCH!\n# ¡Entra a apoyar el stream en TU SERVIDOR RP!`);

    const embedStream = new EmbedBuilder()
        .setColor(platformColor)
        .setAuthor({ name: `SISTEMA DE DIRECTOS | TU SERVIDOR RP 🇪🇸 • ${platformName}` })
        .setTitle(`${platformEmoji} ¡CREADOR EN DIRECTO EN ${platformName.toUpperCase()}!`)
        .setDescription(
            `\u200B\n` +
            `✨ ¡El creador de contenido **${userMention}** acaba de iniciar transmisión en vivo en **TU SERVIDOR RP** 🇪🇸!\n\n` +
            `🎮 **Título de la Transmisión:**\n` +
            `> 💬 *"${cleanTitle}"*\n\n` +
            `📺 **Plataforma:** \`${platformName}\`\n` +
            `🏙️ **Servidor:** **TU SERVIDOR RP** 🇪🇸\n\n` +
            `🔗 **| Entra al directo a dejar tu apoyo y follow:**\n` +
            `> ${validStreamUrl} ❗\n\n` +
            `🌍 **| Comenta el directo en la comunidad:**\n` +
            `> \`#general\` ❗\n\n` +
            `🇪🇸 **| ¡Disfruta del mejor Roleplay en TU SERVIDOR RP! |** 🇪🇸\n\n` +
            `👤 **Streamer:** ${userMention}\n` +
            `🌍 **Notificación:** \`@everyone\``
        )
        .setFooter({ text: `TU SERVIDOR RP • Creadores de Contenido Oficiales (${platformName})` })
        .setTimestamp();

    if (avatarUrl) embedStream.setThumbnail(avatarUrl);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel(platformButtonLabel)
            .setStyle(ButtonStyle.Link)
            .setURL(validStreamUrl),
        new ButtonBuilder()
            .setLabel('🚀 Conectar a TU SERVIDOR RP')
            .setStyle(ButtonStyle.Link)
            .setURL('https://cfx.re/')
    );

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu')
            .setLabel('Probar otro sistema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎮')
    );

    return {
        content: notificationHeadline,
        embeds: [embedStream],
        components: [row, navRow]
    };
}

function buildDemoEventoCard({ title, fechaHora, lugarPremio, detalles }) {
    const cleanTitle = (title || 'GRAN TORNEO DE DRIFT NOCTURNO').trim().toUpperCase();
    const cleanFecha = (fechaHora || 'Sábado 21 de Noviembre • 22:30 (Hora España)').trim();
    const cleanLugarPremio = (lugarPremio || 'Puerto Industrial / Premio: 250.000$ IC + Vehículo Exclusivo').trim();
    const cleanDetalles = (detalles || 'Inscripción gratuita en el punto de encuentro\nMúsica en vivo y cobertura de streamers\nPremios para el Top 3 de la noche')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => `> • ${l}`)
        .join('\n');

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({ name: '🎉 | SISTEMA DE EVENTOS | TU SERVIDOR RP 👑' })
        .setTitle(`🔥 ${cleanTitle} 🔥`)
        .setDescription(
            `\u200B\n` +
            `¡Prepárate para vivir uno de los mejores eventos de la ciudad en **TU SERVIDOR RP**!\n\n` +
            `📌 **| Información del Evento:**\n` +
            `> 📅 **FECHA / HORA:** \`${cleanFecha}\`\n` +
            `> 📍 **LUGAR / PREMIO:** ${cleanLugarPremio}\n` +
            `> 👑 **ORGANIZA:** \`(Tag Staff)\` — Equipo de Eventos\n\n` +
            `✨ **| Detalles y Actividades:**\n` +
            `${cleanDetalles}\n\n` +
            `🔥 ¡No faltes y ven a disfrutar del evento con toda la comunidad!\n\n` +
            `🌍 **| Comenta y comparte el evento con la comunidad:**\n` +
            `> \`#general\` ❗\n\n` +
            `🇪🇸 **| ¡Disfruta de TU SERVIDOR RP! |** 🇪🇸`
        )
        .setFooter({ text: 'TU SERVIDOR RP • Evento Oficial de la Comunidad' })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_demo_evento_modal')
            .setLabel('Probar con otro texto')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📢'),
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu')
            .setLabel('Probar otro sistema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎮')
    );

    return {
        content: `\`@everyone\` *(Así se publica automáticamente en tus canales oficiales de eventos)*`,
        embeds: [embed],
        components: [navRow]
    };
}

function buildDemoValoracionCard({ user, staffName, rating, comment }) {
    const numRating = Math.min(Math.max(parseInt(rating, 10) || 10, 1), 10);
    const fullStars = Math.min(Math.max(Math.round(numRating / 2), 1), 5);
    const starString = '⭐'.repeat(fullStars) + '☆'.repeat(5 - fullStars);

    let embedColor = 0x2ECC71;
    let badgeText = '🟢 ATENCIÓN DESTACADA';
    if (numRating < 5) {
        embedColor = 0xE74C3C;
        badgeText = '🔴 ATENCIÓN A REVISAR';
    } else if (numRating < 8) {
        embedColor = 0xF1C40F;
        badgeText = '🟡 ATENCIÓN CORRECTA';
    }

    const userMention = user ? `<@${user.id}>` : '`(Tag Usuario)`';
    const cleanStaff = (staffName && staffName.trim()) ? staffName.trim() : '`(Tag Staff)`';
    const cleanComment = (comment && comment.trim()) ? comment.trim() : 'Atención súper rápida, amable y me resolvió el problema al instante.';

    const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setAuthor({ name: 'SISTEMA DE VALORACIONES | TU SERVIDOR RP' })
        .setTitle(badgeText)
        .setDescription(
            `\u200B\n` +
            `✨ ¡Se ha registrado una nueva valoración para el Staff **${cleanStaff}**!\n\n` +
            `👤 **Usuario que Valora:**\n` +
            `> ${userMention} ❗\n\n` +
            `🛡️ **Miembro del Staff Evaluado:**\n` +
            `> ${cleanStaff} ❗\n\n` +
            `📊 **| Puntuación Otorgada:**\n` +
            `> \`${numRating}/10\` (${starString})\n\n` +
            `💬 **| Opinión y Experiencia del Usuario:**\n` +
            `> *"${cleanComment}"*\n\n` +
            `📈 **| Estadísticas Acumuladas del Staff:**\n` +
            `> ⭐ **Promedio General:** \`${numRating}.0/10\` • 📋 **Total:** \`25\` valoraciones\n\n` +
            `🇪🇸 **¡Gracias por ayudar a TU SERVIDOR RP!** 🇪🇸`
        )
        .setFooter({ text: 'TU SERVIDOR RP • Opiniones y Soporte' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_demo_val_top')
            .setLabel('Ver Ranking Top Staff')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🏆'),
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu')
            .setLabel('Probar otro sistema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎮')
    );

    return { embeds: [embed], components: [row] };
}

function buildDemoTopStaffEmbed() {
    const desc =
        `\u200B\n` +
        `🥇 \`(Tag Staff 1)\` • **9.9/10** ⭐\n\n` +
        `> 💬 **Reseñas:** \`42\` votos recibidos\n\n` +
        `────────────────────────────\n\n` +
        `🥈 \`(Tag Staff 2)\` • **9.6/10** ⭐\n\n` +
        `> 💬 **Reseñas:** \`31\` votos recibidos\n\n` +
        `────────────────────────────\n\n` +
        `🥉 \`(Tag Staff 3)\` • **9.4/10** ⭐\n\n` +
        `> 💬 **Reseñas:** \`24\` votos recibidos\n\n` +
        `────────────────────────────\n\n` +
        `\`#4\` \`(Tag Staff 4)\` • **9.1/10** ⭐\n\n` +
        `> 💬 **Reseñas:** \`18\` votos recibidos`;

    return new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({ name: 'RANKING DE ATENCIÓN DE STAFF • TU SERVIDOR RP' })
        .setTitle('🏆 Top Miembros del Equipo con Mejor Calificación')
        .setDescription(desc)
        .setFooter({ text: 'TU SERVIDOR RP • Actualizado automáticamente en tiempo real' })
        .setTimestamp();
}

function buildDemoSancionCard({ user, target, punishment, reason }) {
    const expId = String(Math.floor(1000 + Math.random() * 9000));
    const reporterMention = user ? `<@${user.id}>` : '`(Tag Staff)`';
    const targetDisplay = (target && target.trim()) ? target.trim() : '`(Tag Usuario)`';
    const cleanPunishment = (punishment && punishment.trim()) ? punishment.trim() : 'Ban temporal — 3 días / 1 Warn';
    const cleanReason = (reason && reason.trim()) ? reason.trim() : 'Combat Logging (desconexión en medio de un rol activo con policía).';

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({ name: 'SISTEMA DE SANCIONES • TU SERVIDOR RP' })
        .setDescription(
            `**🚨 ACTA DISCIPLINARIA • EXPEDIENTE #${expId}**\n\n` +
            `Este expediente certifica la resolución disciplinaria oficial aplicada dentro de la comunidad de **TU SERVIDOR RP** 🇪🇸.\n\n` +
            `👤 **| Información del Reporte y Staff:**\n` +
            `> 👮 **Quien reporta:** ${reporterMention}\n` +
            `> 🎯 **A quien se reporta:** ${targetDisplay}\n` +
            `> ⚖️ **Sanción / Escenarios:** \`${cleanPunishment}\`\n` +
            `> 🛡️ **Staff implicados:** ${reporterMention} • \`(Tag Staff)\`\n\n` +
            `📝 **| Breve explicación:**\n` +
            `> ${cleanReason}\n\n` +
            `🇪🇸 **| ¡Gracias por ayudar a TU SERVIDOR RP! |** 🇪🇸`
        )
        .setFooter({ text: 'TU SERVIDOR RP • Registro Oficial de Moderación' })
        .setTimestamp();

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_demo_sancion_modal')
            .setLabel('Crear otra sanción de prueba')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🚨'),
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu')
            .setLabel('Probar otro sistema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🎮')
    );

    return { embeds: [embed], components: [navRow] };
}

const DEMO_PLANTILLAS = {
    negocio: {
        emoji: '💼',
        nombre: 'Postulación Negocio',
        contenido:
            `• **Nombre IC y OOC:**\n` +
            `• **Edad OOC y horas en FiveM:**\n` +
            `• **Nombre y ubicación del negocio:**\n` +
            `• **Tipo de actividad y rol que aportará a la ciudad:**\n` +
            `• **Número de empleados iniciales y horarios de apertura:**`
    },
    mafia: {
        emoji: '💀',
        nombre: 'Postulación Mafia',
        contenido:
            `• **Nombre de la Organización:**\n` +
            `• **Historia y trasfondo completo:**\n` +
            `• **Jerarquía interna (Jefe, Subjefe, Miembros — con IDs):**\n` +
            `• **Vestimenta oficial y color de vehículos:**\n` +
            `• **Objetivos IC y qué rol aportaréis a TU SERVIDOR RP:**`
    },
    banda: {
        emoji: '🏴‍☠️',
        nombre: 'Postulación Banda',
        contenido:
            `• **Nombre de la Banda y Barrio solicitado:**\n` +
            `• **Historia del grupo y valores callejeros:**\n` +
            `• **Listado de integrantes (mínimo 5):**\n` +
            `• **Código de vestimenta y color identificativo:**`
    },
    staff: {
        emoji: '🛡️',
        nombre: 'Postulación Staff',
        contenido:
            `• **Edad OOC y disponibilidad horaria:**\n` +
            `• **Experiencia previa moderando en FiveM RP:**\n` +
            `• **¿Cómo actuarías ante un reporte de RDM sin clip?**\n` +
            `• **¿Por qué quieres formar parte del equipo de TU SERVIDOR RP?**`
    },
    streamer: {
        emoji: '🎥',
        nombre: 'Postulación Streamer',
        contenido:
            `• **Plataforma principal (Twitch / Kick / TikTok):**\n` +
            `• **Enlace a tu canal:**\n` +
            `• **Media de espectadores y frecuencia de directos:**\n` +
            `• **¿Qué tipo de contenido grabarás en TU SERVIDOR RP?**`
    }
};

const DEMO_SYSTEMS = {
    streamers: {
        emoji: '🟣',
        label: 'Streamers y Directos en Vivo',
        shortDesc: 'Panel real interactivo con Twitch, Kick y TikTok + prueba con tu propia URL',
        explainTitle: '🟣 SISTEMA DE STREAMERS Y DIRECTOS EN VIVO',
        explainText:
            `Este sistema permite a los creadores de contenido de **tu servidor** anunciar sus directos en **Twitch, Kick o TikTok** con un solo clic.\n\n` +
            `• **Panel fijo con 3 botones reales:** Twitch (morado), Kick (verde) y TikTok (rosa).\n` +
            `• **Formulario interactivo:** el streamer introduce su enlace y título (o el bot los detecta en automático) y publica el anuncio con diseño prémium y botón directo al stream.\n\n` +
            `👇 Pulsa **Ver Prueba** para abrir el **Panel Real** y probar a enviar tu propio directo con la URL que quieras.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'SISTEMA DE CREADORES | TU SERVIDOR RP 🇪🇸' })
                .setTitle('🟣 ¡PANEL DE NOTIFICACIÓN DE DIRECTOS!')
                .setDescription(
                    `\u200B\n` +
                    `✨ ¡Bienvenido al **Panel Oficial de Creadores y Streamers** de **TU SERVIDOR RP** 🇪🇸!\n\n` +
                    `Si eres Creador de Contenido oficial del servidor, puedes avisar a toda la comunidad cuando comiences directo en **Twitch, Kick o TikTok** con un solo clic.\n\n` +
                    `📢 **| ¿Cómo publicar tu directo?**\n` +
                    `> Haz clic en el botón de tu plataforma:\n` +
                    `> • 🟣 **\`Notificar Twitch\`** (Botón Morado) para emisiones en Twitch.\n` +
                    `> • 🟢 **\`Notificar Kick\`** (Botón Verde) para emisiones en Kick.\n` +
                    `> • ⚫ **\`Notificar TikTok\`** (Botón Rosa) para emisiones en TikTok LIVE.\n\n` +
                    `📍 **| Canal de publicación oficial:**\n` +
                    `> \`#directos\` ❗\n\n` +
                    `⚠️ **| Normativas de los Streamers:**\n` +
                    `> • Debes estar transmitiendo contenido dentro de **TU SERVIDOR RP** 🇪🇸.\n\n` +
                    `📁 **| ¿Quieres ser Streamer Oficial?**\n` +
                    `> Abre un ticket de creadores en \`#tickets\` ❗\n\n` +
                    `🌍 **| 𝗗𝗶𝘀𝗳𝗿𝘂𝘁𝗮 𝘆 𝗰𝗼𝗺𝗽𝗮𝗿𝘁𝗲 𝘁𝘂 𝗰𝗼𝗻𝘁𝗲𝗻𝗶𝗱𝗼,**\n` +
                    `> \`#general\` ❗\n\n` +
                    `🇪🇸 **| ¡Disfruta y crece en TU SERVIDOR RP! |** 🇪🇸`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Creadores de Contenido Oficiales' })
                .setTimestamp();

            const streamButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_stream_Twitch')
                    .setLabel('Notificar Twitch')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🟣'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_stream_Kick')
                    .setLabel('Notificar Kick')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🟢'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_stream_TikTok')
                    .setLabel('Notificar TikTok')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('⚫')
            );

            return {
                content: `✨ **Panel real de Directos** — ¡Pulsa cualquier botón (Twitch, Kick o TikTok) para meter una URL de prueba y ver el anuncio real que genera el bot!`,
                embeds: [panelEmbed],
                components: [
                    streamButtons,
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('dm_demo_open_menu').setLabel('Volver al Menú').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
                    )
                ]
            };
        }
    },
    eventos: {
        emoji: '🎉',
        label: 'Gestión y Publicación de Eventos',
        shortDesc: 'Panel real con formulario para crear tu propio evento de prueba',
        explainTitle: '🎉 SISTEMA DE EVENTOS OFICIALES',
        explainText:
            `Permite a tu equipo de Staff anunciar quedadas, carreras, fiestas o torneos en **tu servidor** sin perder tiempo maquetando textos.\n\n` +
            `• El Staff pulsa **📢 Publicar Evento**, rellena los datos y sube el cartel/flyer.\n` +
            `• El bot maqueta automáticamente todo con diseño prémium y lo publica en doble canal oficial.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Panel Real de Eventos** y rellenar uno tú mismo.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'SISTEMA DE EVENTOS | TU SERVIDOR RP' })
                .setTitle('🎉 GESTIÓN Y PUBLICACIÓN OFICIAL DE EVENTOS')
                .setDescription(
                    `Bienvenido al **Panel Oficial de Publicación de Eventos** para el equipo de Staff de **TU SERVIDOR RP** 🇪🇸.\n\n` +
                    `Este sistema permite anunciar quedadas, exhibiciones, carreras, fiestas y eventos especiales de la ciudad con una maquetación automática y diseño prémium.\n\n` +
                    `📋 **¿Cómo publicar un nuevo evento?**\n` +
                    `> 1️⃣ Pulsa el botón **"📢 Publicar Evento"** aquí abajo.\n` +
                    `> 2️⃣ Introduce la información del evento *(el bot maquetará el título, hora, lugar, organizador y actividades automáticamente)*.\n` +
                    `> 3️⃣ Envía el **cartel / flyer / foto** en el chat cuando el bot te lo solicite.\n\n` +
                    `💡 *El bot publicará el anuncio automáticamente en los canales oficiales de eventos con mención @everyone y formato de lujo.*`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Sistema Oficial de Eventos Staff' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_evento_modal')
                    .setLabel('Publicar Evento')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📢'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_evento_quick')
                    .setLabel('Ver Ejemplo Ya Relleno')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⚡'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Menú')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );

            return {
                content: `✨ **Panel real de Eventos** — Pulsa **📢 Publicar Evento** para rellenarlo tú mismo o **⚡ Ver Ejemplo Ya Relleno**:`,
                embeds: [panelEmbed],
                components: [row]
            };
        }
    },
    valoraciones: {
        emoji: '⭐',
        label: 'Valoraciones y Top Staff',
        shortDesc: 'Panel real interactivo para valorar a un Staff + Ranking Top Staff',
        explainTitle: '⭐ VALORACIONES CIUDADANAS Y TOP STAFF',
        explainText:
            `Motiva a tu equipo de Staff y mide la satisfacción de tus jugadores en tiempo real.\n\n` +
            `• Los usuarios pulsan **⭐ Valorar a un Staff**, eligen al Staff, le ponen nota del **1 al 10** y dejan su opinión.\n` +
            `• El bot publica una tarjeta con color dinámico *(verde/amarillo/rojo)* y actualiza al instante el **Ranking Top Staff**.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Panel Real**, probar a valorar a un Staff y ver el **Top Staff**.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'SISTEMA DE VALORACIONES • TU SERVIDOR RP' })
                .setTitle('⭐ ¿CÓMO FUE TU EXPERIENCIA CON EL EQUIPO DE STAFF?')
                .setDescription(
                    `\u200B\n` +
                    `¡Bienvenido al sistema oficial de **Calidad y Atención al Usuario** de **TU SERVIDOR RP**!\n\n` +
                    `Tu opinión es fundamental para seguir mejorando nuestro servidor. Si has recibido atención en soporte, tickets, reportes o dudas, puedes valorar la labor del Staff que te atendió.\n\n` +
                    `📋 **¿Cómo valorar a un Staff?**\n` +
                    `> 1️⃣ Haz clic en el botón **"⭐ Valorar a un Staff"** aquí abajo.\n` +
                    `> 2️⃣ Elige al **Staff** en el menú desplegable con su nombre y foto.\n` +
                    `> 3️⃣ Asigna tu puntuación del **1 al 10**.\n` +
                    `> 4️⃣ Cuéntanos tu experiencia o comentario sobre la atención recibida.\n\n` +
                    `📢 **Canal de publicación de valoraciones:**\n` +
                    `> Las valoraciones se enviarán automáticamente a \`#valoraciones\` ❗\n\n` +
                    `🇪🇸 **¡Gracias por ayudar a TU SERVIDOR RP!** 🇪🇸`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Departamento de Calidad y Atención al Usuario' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_val_modal')
                    .setLabel('⭐ Valorar a un Staff')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_val_top')
                    .setLabel('Ver Ranking Top Staff')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🏆'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Menú')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );

            return {
                content: `✨ **Panel real de Valoraciones** — Pulsa **⭐ Valorar a un Staff** para rellenar una reseña de prueba o **🏆 Ver Ranking Top Staff**:`,
                embeds: [panelEmbed],
                components: [row]
            };
        }
    },
    sanciones: {
        emoji: '⚖️',
        label: 'Sanciones y Expedientes',
        shortDesc: 'Panel real disciplinario con formulario para generar un Acta oficial',
        explainTitle: '⚖️ SISTEMA DISCIPLINARIO Y EXPEDIENTES',
        explainText:
            `Lleva un control impecable de todas las sanciones de **tu servidor**.\n\n` +
            `• Panel con botón para emitir sanciones en segundos con el sancionado, castigo, motivo y captura/vídeo de prueba.\n` +
            `• Guarda automáticamente el expediente oficial y permite consultar el **historial disciplinario completo**.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Panel Real de Sanciones** y generar un Acta de prueba.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'SISTEMA DE SANCIONES • TU SERVIDOR RP' })
                .setTitle('🚨 REGISTRO OFICIAL DE SANCIONES Y SANCIONADOS')
                .setDescription(
                    `Bienvenido al **Panel Oficial de Registro de Sanciones** para el equipo de Staff de **TU SERVIDOR RP** 🇪🇸.\n\n` +
                    `Este canal está destinado a mantener un control estricto, transparente y unificado de todas las faltas, advertencias y expulsiones aplicadas a usuarios en la comunidad.\n\n` +
                    `📋 **¿Cómo registrar una nueva sanción?**\n` +
                    `> 1️⃣ Pulsa el botón **"🚨 Registrar Sanción"** aquí abajo.\n` +
                    `> 2️⃣ Rellena el formulario con la **ID del sancionado**, la **sanción/escenarios** y el **motivo**.\n` +
                    `> 3️⃣ Envía la(s) **captura(s) o vídeo de prueba** en el chat cuando el bot te lo solicite.\n\n` +
                    `💡 *El bot detectará automáticamente tu nombre de Staff y generará el expediente oficial con formato blindado.*`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Registro Interno Exclusivo de Moderación' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_sancion_modal')
                    .setLabel('🚨 Registrar Sanción')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('📝'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Volver al Menú')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );

            return {
                content: `✨ **Panel real de Sanciones** — Pulsa **🚨 Registrar Sanción** para rellenar los datos y ver el Acta Disciplinaria real:`,
                embeds: [panelEmbed],
                components: [row]
            };
        }
    },
    plantillas: {
        emoji: '📑',
        label: 'Plantillas y Postulaciones',
        shortDesc: 'Panel real con selector desplegable interactivo de plantillas oficiales',
        explainTitle: '📑 PANEL DE PLANTILLAS Y POSTULACIONES',
        explainText:
            `Agiliza las postulaciones a facciones, bandas, mafias, negocios o Staff en **tu servidor**.\n\n` +
            `• El Staff elige la plantilla en el menú desplegable y la envía directamente al ticket del usuario con un solo comando.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Panel Real de Plantillas** y abrir el selector.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'CENTRO DE POSTULACIONES • TU SERVIDOR RP' })
                .setTitle('📋 SISTEMA DE PLANTILLAS DE POSTULACIÓN')
                .setDescription(
                    `\u200B\n` +
                    `¡Bienvenido al panel central de **Plantillas de Postulaciones Oficiales** de **TU SERVIDOR RP**!\n\n` +
                    `Aquí el equipo de Staff puede obtener instantáneamente el formato oficial y limpio de cualquier postulación para enviarlo a los usuarios o tickets de soporte.\n\n` +
                    `📌 **Plantillas Disponibles en el Sistema:**\n` +
                    `> 💼 **Postulación Negocio** *(Apertura de comercios y locales)*\n` +
                    `> 💀 **Postulación Mafia** *(Organizaciones y jerarquías)*\n` +
                    `> 🏴‍☠️ **Postulación Banda** *(Bandas callejeras y territorios)*\n` +
                    `> 🛡️ **Postulación Staff** *(Ingreso al equipo de moderación)*\n` +
                    `> 🎥 **Streamer** *(Postulaciones de creadores de contenido)*\n\n` +
                    `⚡ **Instrucciones para Staff:**\n` +
                    `> 1️⃣ Haz clic en el botón **"📋 Seleccionar Plantilla"** abajo.\n` +
                    `> 2️⃣ Elige la plantilla deseada en el selector desplegable.\n` +
                    `> 3️⃣ El bot te la entregará y podrás reenviarla con \`!enviar <ID_TICKET>\`.\n\n` +
                    `🇪🇸 **| TU SERVIDOR RP • Calidad y Organización |** 🇪🇸`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Gestión de Postulaciones y Formularios' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_plantilla_open')
                    .setLabel('📋 Seleccionar Plantilla')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📂'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Volver al Menú')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );

            return {
                content: `✨ **Panel real de Plantillas** — Pulsa **📋 Seleccionar Plantilla** para probar el selector desplegable:`,
                embeds: [panelEmbed],
                components: [row]
            };
        }
    },
    consultas: {
        emoji: '🧠',
        label: 'Consultas de Normativa con IA',
        shortDesc: 'Panel fijo de consultas + respuesta real de la IA con botón de cierre',
        explainTitle: '🧠 CONSULTAS DE NORMATIVA CON INTELIGENCIA ARTIFICIAL',
        explainText:
            `Tus usuarios y tu Staff pueden preguntar cualquier duda sobre **la normativa de tu servidor** hablando normalmente, sin comandos.\n\n` +
            `• **Doble canal:** uno exclusivo para Staff y otro abierto para todos los Usuarios.\n` +
            `• Reconoce todas las siglas RP (\`RK\`, \`MG\`, \`PG\`, \`CK\`, \`VDM\`, \`HK\`...), se auto-limpia a los 90s y registra todo en tu **canal privado de logs**.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Panel Fijo** y una **Resolución Real de Consulta**.`,
        buildDemo: () => {
            const panelEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'CONSULTAS DE LA NORMATIVA | TU SERVIDOR RP' })
                .setTitle('📚 ¿TIENES ALGUNA DUDA SOBRE LA NORMATIVA?')
                .setDescription(
                    `¡Bienvenido al canal oficial de **Consultas Inteligentes** de **TU SERVIDOR RP**!\n\n` +
                    `💬 **¿Cómo funciona?**\n` +
                    `> • Simplemente **escribe tu duda directamente en este canal** hablando de forma normal *(sin comandos)*.\n` +
                    `> • Nuestra Inteligencia Artificial revisará al instante la **Normativa General**, la **Normativa de Ilegales** y todas las actualizaciones del servidor para darte una respuesta exacta.\n\n` +
                    `⚡ **Consejos rápidos:**\n` +
                    `> • Puedes preguntar por siglas RP (\`RK\`, \`MG\`, \`PG\`, \`PK\`, \`CK\`, \`VDM\`...), atracos, bandas, zonas seguras o sanciones.\n` +
                    `> • Tu pregunta y la respuesta se limpiarán automáticamente a los **90 segundos** *(o al pulsar el botón 🗑️ Cerrar / Borrar)* para mantener el canal siempre impecable.`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Sistema Inteligente de Normativa 24/7' })
                .setTimestamp();

            const replyEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'CONSULTAS DE LA NORMATIVA | TU SERVIDOR RP' })
                .setTitle('📋 RESOLUCIÓN DE CONSULTA')
                .setDescription(
                    `❓ **| Pregunta planteada:**\n` +
                    `> *"¿Qué es el RK y cuánto tiempo hay que esperar?"*\n\n` +
                    `💡 **| Respuesta de la IA:**\n` +
                    `> El **Revenge Kill (RK)** consiste en volver a vengarte de quien te acaba de abatir/matar, lo cual está **totalmente prohibido** por la normativa. Una vez caes abatido pierdes el recuerdo del rol y no puedes buscar venganza contra esa persona.\n\n` +
                    `*(Se auto-eliminará en 90s o puedes pulsar el botón de abajo).*`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Base de Datos Oficial de Normativa' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_consulta_close')
                    .setLabel('Cerrar / Borrar')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🗑️'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎮')
            );

            return {
                content: `✨ **Diseño real del Panel Permanente + Respuesta de la IA** *(prueba a pulsar 🗑️ Cerrar / Borrar)*:`,
                embeds: [panelEmbed, replyEmbed],
                components: [row]
            };
        }
    },
    tickets: {
        emoji: '🎫',
        label: 'Asistente Virtual de Tickets',
        shortDesc: 'Atención previa en tickets + botones reales para llamar al Staff',
        explainTitle: '🎫 ASISTENTE VIRTUAL INTELIGENTE DE TICKETS',
        explainText:
            `Atiende automáticamente tus tickets de **Soporte, Apelaciones, Creadores y Donaciones** mientras no haya entrado ningún Staff.\n\n` +
            `• Recopila motivo, capturas, método de pago o enlaces sin hacer perder tiempo a tu equipo.\n` +
            `• Muestra los botones **🙋‍♂️ Llamar al Staff** y **✅ Problema Solucionado**, envía el **informe resumido** y se silencia al instante.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el mensaje real del asistente y pulsar **🙋‍♂️ Llamar al Staff** para ver el resumen.`,
        buildDemo: () => {
            const triageEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'ASISTENTE VIRTUAL | TU SERVIDOR RP' })
                .setDescription(
                    `¡Hola \`(Tag Usuario)\`! He recogido los detalles de tu apelación y la captura del error.\n\n` +
                    `Si ya has aportado toda la información necesaria, pulsa **🙋‍♂️ Llamar al Staff** para que el equipo reciba tu informe estructurado y revise tu caso cuanto antes.`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Asistente Virtual de Tickets' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_ticket_call')
                    .setLabel('Llamar al Staff')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🙋‍♂️'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_ticket_solve')
                    .setLabel('Problema Solucionado')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Menú')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('⬅️')
            );

            return {
                content: `✨ **Interfaz real dentro de un Ticket** — Pulsa **🙋‍♂️ Llamar al Staff** para ver el informe que le llega a tu equipo:`,
                embeds: [triageEmbed],
                components: [row]
            };
        }
    },
    locucion: {
        emoji: '🎙️',
        label: 'Locución y Avisos de Soporte por Voz',
        shortDesc: 'Monitor real en vivo de salas de soporte y avisos automáticos por voz',
        explainTitle: '🎙️ SISTEMA DE LOCUCIÓN Y ALERTAS DE SOPORTE POR VOZ',
        explainText:
            `Garantiza que ningún usuario se quede esperando solo en soporte de voz en **tu servidor**.\n\n` +
            `• Reproduce una **locución de bienvenida** al usuario cuando entra en Espera de Soporte.\n` +
            `• Recorre las **Salas de Soporte y Sala de Charla** avisando por voz al Staff *(Aviso 1, Aviso 2 y Aviso 3)*, respetando siempre canales de **AFK** o **En Rol**.\n` +
            `• Si nadie atiende tras el 3er aviso, envía un **informe automático** a Administración.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Dashboard en Vivo** y un **Informe de Incidencia**.`,
        buildDemo: () => {
            const monitorEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'MONITOR DE LOCUCIÓN EN VIVO | TU SERVIDOR RP' })
                .setTitle('🎙️ SISTEMA DE LOCUCIÓN Y SALAS DE SOPORTE')
                .setDescription(
                    `🔊 **Estado del sistema:** 🟢 \`ACTIVADO\` • **Intervalo:** \`30s\`\n\n` +
                    `🎧 **Actividad actual:** 🔊 \`Reproduciendo aviso en sala\`\n\n` +
                    `👥 **SALAS DE SOPORTE EN TIEMPO REAL:**\n` +
                    `> ⏳ **En Espera de Soporte:** \`2\` usuario(s)\n` +
                    `> 🛡️ **En Salas de Soporte:** \`3\` miembro(s)\n\n` +
                    `🎵 **AUDIOS DEL SISTEMA (5/5):**\n` +
                    `🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩 \`100%\`\n` +
                    `> 🔔 **Aviso Staff 1 (Espera):** 🟢 \`Activo\`\n` +
                    `> ⏰ **Aviso Staff 2 (Recordatorio):** 🟢 \`Activo\`\n` +
                    `> 👋 **Locución Usuarios (Bienvenida):** 🟢 \`Activo\`\n` +
                    `> 🚨 **Aviso 3 (Sanción Staff):** 🟢 \`Activo\`\n` +
                    `> 💬 **Locución Sala de Charla:** 🟢 \`Activo\``
                )
                .setFooter({ text: 'TU SERVIDOR RP • Actualización instantánea al entrar/salir de voz' })
                .setTimestamp();

            const alertEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setAuthor({ name: 'ALERTA DE ADMINISTRACIÓN | TU SERVIDOR RP' })
                .setTitle('🚨 INFORME: SOPORTE NO ATENDIDO TRAS 3 AVISOS')
                .setDescription(
                    `👤 **Usuario en espera:** \`(Tag Usuario)\`\n` +
                    `👮 **Staffs conectados en salas de soporte:** \`(Tag Staff 1)\`, \`(Tag Staff 2)\`\n` +
                    `⏱️ **Tiempo de espera sin atención:** \`3 minutos\` *(3 avisos sonoros emitidos)*`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Control Automático de Calidad' })
                .setTimestamp();

            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎮')
            );

            return {
                embeds: [monitorEmbed, alertEmbed],
                components: [navRow]
            };
        }
    },
    whitelist: {
        emoji: '📋',
        label: 'Whitelist y Detector Anti-IA',
        shortDesc: 'Diseño real de Whitelist Aprobada, Denegada e Informe Anti-IA',
        explainTitle: '📋 SISTEMA DE WHITELIST Y DETECTOR ANTI-IA',
        explainText:
            `Protege la calidad del roleplay de **tu servidor** filtrando automáticamente solicitudes copiadas o generadas con IA.\n\n` +
            `• **Auditoría Anti-IA multicapa:** analiza cada formulario y muestra el porcentaje real de IA vs Humano.\n` +
            `• **Anuncios oficiales:** publica automáticamente la **Whitelist Aprobada** o **Denegada** con diseño prémium.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el anuncio real de **Whitelist Aprobada** (y botones para ver Denegada y Anti-IA).`,
        buildDemo: (user) => {
            const userMention = user ? `<@${user.id}>` : '`(Tag Usuario)`';
            const embedAprobado = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setAuthor({ name: 'SISTEMA DE WHITELIST | TU SERVIDOR RP' })
                .setTitle('🎉 ¡WHITELIST APROBADA!')
                .setDescription(
                    `\u200B\n` +
                    `✨ ¡Enhorabuena **${userMention}**! Tu solicitud de Whitelist ha sido aprobada con éxito por el equipo de Staff.\n\n` +
                    `🏙️ Ya puedes acceder al servidor y formar parte de la comunidad de **TU SERVIDOR RP** 🇪🇸.\n\n` +
                    `📝 **| Puedes consultar nuestras,**\n` +
                    `> \`#normativas\` ❗\n\n` +
                    `📁 **| Si tienes dudas abre un,**\n` +
                    `> \`#tickets\` ❗\n\n` +
                    `🌍 **| 𝗗𝗶𝘀𝗳𝗿𝘂𝘁𝗮 𝘆 𝗱𝗶𝘃𝗶𝗲𝗿𝘁𝗲𝘁𝗲,**\n` +
                    `> \`#general\` ❗\n\n` +
                    `🇪🇸 **| ¡Disfruta de TU SERVIDOR RP! |** 🇪🇸\n\n` +
                    `👤 **Solicitante:** ${userMention}\n` +
                    `🛡️ **Decidido Por:** \`(Tag Staff)\``
                )
                .setFooter({ text: 'TU SERVIDOR RP • ¡Bienvenido a la ciudad!' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_wl_denegada')
                    .setLabel('Ver Ejemplo Denegada')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🚫'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_wl_antiia')
                    .setLabel('Ver Informe Anti-IA')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🧠'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎮')
            );

            return {
                content: `# 🎉 ¡Enhorabuena ${userMention}!\n# ¡Tu Whitelist ha sido aprobada!`,
                embeds: [embedAprobado],
                components: [row]
            };
        }
    },
    ascensos: {
        emoji: '📈',
        label: 'Ascensos y Descensos de Staff',
        shortDesc: 'Diseño real exacto de anuncios automáticos agrupados de rango',
        explainTitle: '📈 ASCENSOS Y DESCENSOS AUTOMÁTICOS',
        explainText:
            `Olvídate de redactar anuncios cada vez que subes o bajas de rango a un Staff en **tu servidor**.\n\n` +
            `• Detecta al instante el cambio de rol dentro de tu jerarquía configurada.\n` +
            `• Si asciendes o bajas a varios Staffs seguidos, **los agrupa automáticamente** en un único anuncio limpio a ancho completo.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver los embeds reales exactos de **Ascensos** y **Descensos**.`,
        buildDemo: () => {
            const ascEmbed = new EmbedBuilder()
                .setColor(0xE67E22)
                .setAuthor({ name: 'SISTEMA DE ADMINISTRACIÓN | TU SERVIDOR RP' })
                .setDescription(
                    `\`(Tag Staff 1)\` *Asciendes de* **\`@🔎┃Soporte\`** *a* **\`@🔰┃Moderador\`**\n` +
                    `\`(Tag Staff 2)\` *Asciendes de* **\`@🔰┃Moderador\`** *a* **\`@⚡┃Administrador\`**`
                );

            const descEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setAuthor({ name: 'SISTEMA DE ADMINISTRACIÓN | TU SERVIDOR RP' })
                .setDescription(
                    `\`(Tag Staff 3)\` *Desciendes de* **\`@🔰┃Moderador\`** *a* **\`@🔎┃Soporte\`**`
                );

            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎮')
            );

            return {
                content: `✨ **Diseño real exacto de Ascensos (naranja) y Descensos (rojo)** *(100% automático al cambiar el rol en Discord)*:`,
                embeds: [ascEmbed, descEmbed],
                components: [navRow]
            };
        }
    },
    bienvenidas_fivem: {
        emoji: '👋',
        label: 'Bienvenidas y Estado FiveM',
        shortDesc: 'Bienvenida real personalizada con tu perfil + panel FiveM en vivo',
        explainTitle: '👋 BIENVENIDAS Y ESTADO EN VIVO DE FIVEM',
        explainText:
            `Causa una primera impresión impecable desde que un usuario entra al Discord de **tu servidor**.\n\n` +
            `• **Bienvenidas:** banner personalizado, contador de miembros, fecha de cuenta y accesos directos a tus canales clave.\n` +
            `• **Estado FiveM:** panel auto-actualizable con jugadores conectados, estado online/offline y código CFX.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver cómo te daría la **Bienvenida real a ti** + el **Estado FiveM**.`,
        buildDemo: (user) => {
            const userMention = user ? `<@${user.id}>` : '`(Tag Usuario)`';
            const createdTs = user ? Math.floor(user.createdTimestamp / 1000) : Math.floor(Date.now() / 1000 - 86400 * 365);

            const welcomeEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: '¡TE DAMOS LA BIENVENIDA A TU SERVIDOR RP!' })
                .setDescription(
                    `\u200B\n` +
                    `➥ 𝗘𝘀𝗽𝗲𝗿𝗮𝗺𝗼𝘀 𝗾𝘂𝗲 𝗱𝗶𝘀𝗳𝗿𝘂𝘁𝗲𝘀 𝗱𝗲 𝗻𝘂𝗲𝘀𝘁𝗿𝗮 𝗰𝗼𝗺𝘂𝗻𝗶𝗱𝗮𝗱, 𝘁𝗼𝗱𝗼 𝗹𝗼 𝗾𝘂𝗲 𝗻𝗲𝗰𝗲𝘀𝗶𝘁𝗲𝘀 𝘀𝗮𝗯𝗲𝗿 𝗹𝗼 𝘁𝗲𝗻𝗱𝗿𝗮́𝘀 𝗲𝗻 𝗹𝗼𝘀 𝗿𝗲𝘀𝗽𝗲𝗰𝘁𝗶𝘃𝗼𝘀 𝗰𝗮𝗻𝗮𝗹𝗲𝘀 𝗰𝗼𝗿𝗿𝗲𝘀𝗽𝗼𝗻𝗱𝗶𝗲𝗻𝘁𝗲𝘀 ❗\n\n` +
                    `👤 **Usuario:** ${userMention}\n` +
                    `👥 **Miembro Nº:** \`#1.248\` ciudadanos\n` +
                    `📅 **Cuenta Creada:** <t:${createdTs}:R>\n\n` +
                    `📝 **| Puedes consultar nuestras,**\n` +
                    `> \`#normativas\` ❗\n\n` +
                    `📋 **| Puedes realizar tu Whitelist en,**\n` +
                    `> \`#solicitudes\` ❗\n\n` +
                    `📁 **| Si tienes alguna duda abre,**\n` +
                    `> \`#tickets\` ❗\n\n` +
                    `🌍 **| Disfruta y diviértete en,**\n` +
                    `> \`#general\` ❗\n\n` +
                    `🇪🇸 **| ¡Disfruta de TU SERVIDOR RP! |** 🇪🇸`
                )
                .setFooter({ text: 'TU SERVIDOR RP • Sistema de Bienvenidas' })
                .setTimestamp();

            if (user) welcomeEmbed.setThumbnail(user.displayAvatarURL({ dynamic: true }));

            const fivemEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'ESTADO DEL SERVIDOR | TU SERVIDOR RP' })
                .setTitle('🌐 ESTADO EN VIVO — TU SERVIDOR RP')
                .setDescription(
                    `📡 **Estado:** 🟢 \`ONLINE\`\n` +
                    `👥 **Jugadores conectados:** \`118 / 200\`\n` +
                    `🟩🟩🟩🟩🟩🟩⬛⬛⬛⬛ \`59%\`\n\n` +
                    `🔗 **Conexión directa:** \`connect cfx.re/join/tucodigo\``
                )
                .setFooter({ text: 'TU SERVIDOR RP • Actualizado automáticamente en tiempo real' })
                .setTimestamp();

            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎮')
            );

            return {
                content: `❗ **Bienvenid@,** ${userMention} ❗`,
                embeds: [welcomeEmbed, fivemEmbed],
                components: [navRow]
            };
        }
    },
    dashboards: {
        emoji: '🖥️',
        label: 'Dashboards de Monitorización',
        shortDesc: 'Paneles reales en vivo de Servicios, Cola de Tickets y Consumo IA',
        explainTitle: '🖥️ DASHBOARDS DE CONTROL EN TIEMPO REAL',
        explainText:
            `Controla la salud completa de **tu servidor y tu bot** desde paneles en vivo en tu canal privado de administración.\n\n` +
            `• **Monitor de Servicios:** latencia, RAM, uptime y estado de cada módulo.\n` +
            `• **Monitor de Núcleos IA, Locución y Tickets:** todo actualizado en tiempo real con botón de refresco manual.\n\n` +
            `👇 Pulsa **Ver Prueba** para ver el **Dashboard Real de Servicios** y los botones a los demás monitores.`,
        buildDemo: () => {
            const dashEmbed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({ name: 'MONITOR DE SERVICIOS EN VIVO | TU SERVIDOR RP' })
                .setTitle('🖥️ ESTADO GENERAL DEL SISTEMA')
                .setDescription(
                    `⚡ **Salud global:** 🟢 \`Todos los servicios operativos\`\n` +
                    `🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩 \`100%\` (\`6/6\` activos)\n\n` +
                    `📡 **RENDIMIENTO DEL SERVIDOR:**\n` +
                    `> 🟢 **Estado:** \`Online\` • **Latencia:** \`15 ms\` • **RAM:** \`98 MB\` • **Activo:** \`14d 6h\`\n\n` +
                    `⚙️ **MÓDULOS OPERATIVOS:**\n` +
                    `> 🧠 **Consultas IA:** 🟢 \`Operativo\`\n` +
                    `> 🎫 **Asistente de Tickets:** 🟢 \`Operativo\`\n` +
                    `> 🎙️ **Locución y Soporte:** 🟢 \`Operativo\`\n` +
                    `> 📢 **Eventos, Directos y Sanciones:** 🟢 \`Operativo\``
                )
                .setFooter({ text: 'TU SERVIDOR RP • Monitorización 24/7 en tiempo real' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dm_demo_dash_tickets')
                    .setLabel('Ver Monitor Tickets')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎫'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_dash_ia')
                    .setLabel('Ver Monitor IA')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚡'),
                new ButtonBuilder()
                    .setCustomId('dm_demo_open_menu')
                    .setLabel('Probar otro sistema')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🎮')
            );

            return {
                embeds: [dashEmbed],
                components: [row]
            };
        }
    }
};

function buildOpenDemosButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu_new')
            .setLabel('🎮 Ver Pruebas / Demos en Vivo')
            .setStyle(ButtonStyle.Primary)
    );
}

// Helper estilo bot de Telegram: edita SIEMPRE el mismo mensaje limpiando texto/adjuntos previos
async function updateDemoMessage(interaction, payload) {
    const cleanPayload = {
        content: payload.content !== undefined ? payload.content : '',
        embeds: payload.embeds || [],
        components: payload.components || [],
        files: payload.files || [],
        attachments: []
    };
    try {
        if (typeof interaction.update === 'function') {
            await interaction.update(cleanPayload);
            return;
        }
    } catch (e) { }
    // Respaldo seguro por si el tipo de interacción no soporta update()
    await interaction.reply(cleanPayload).catch(() => {});
}

function buildDemoMenuPayload() {
    const logoAtt = getLogoAttachment();
    const logoUrl = logoAtt ? 'attachment://logo.png' : undefined;

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({ name: 'ZONA DE PRUEBAS EN VIVO', iconURL: logoUrl })
        .setThumbnail(logoUrl)
        .setTitle('🎮 PRUEBA VISUALMENTE CADA SISTEMA')
        .setDescription(
            `Selecciona abajo **cualquier sistema** para ver primero cómo funciona y luego pulsar **👁️ Ver Prueba** para probar el **panel real interactivo** con sus botones y formularios.\n\n` +
            `✨ *Todo es **100% personalizable** con el nombre, logo, banners, colores y normativa de **tu servidor**.*\n` +
            `📩 *Si quieres tener este bot en tu servidor, escribe directamente por DM a <@1308814761269395527>.*`
        )
        .setFooter({ text: 'Elige un sistema en el menú desplegable de abajo', iconURL: logoUrl })
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId('dm_demo_select')
        .setPlaceholder('👇 Elige un sistema para ver su explicación y prueba real...')
        .addOptions(
            Object.entries(DEMO_SYSTEMS).map(([key, sys]) => ({
                label: sys.label,
                description: sys.shortDesc.slice(0, 100),
                value: key,
                emoji: sys.emoji
            }))
        );

    return {
        embeds: [embed],
        files: logoAtt ? [logoAtt] : [],
        components: [new ActionRowBuilder().addComponents(menu)]
    };
}

function buildDemoExplainPayload(sysKey) {
    const sys = DEMO_SYSTEMS[sysKey];
    if (!sys) return null;
    const logoAtt = getLogoAttachment();
    const logoUrl = logoAtt ? 'attachment://logo.png' : undefined;

    const embed = new EmbedBuilder()
        .setColor(0xD900FF)
        .setAuthor({ name: 'EXPLICACIÓN DEL SISTEMA', iconURL: logoUrl })
        .setThumbnail(logoUrl)
        .setTitle(sys.explainTitle)
        .setDescription(sys.explainText)
        .setFooter({ text: 'Pulsa "Ver Prueba" para abrir el diseño real interactivo', iconURL: logoUrl })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`dm_demo_run_${sysKey}`)
            .setLabel('Ver Prueba')
            .setStyle(ButtonStyle.Success)
            .setEmoji('👁️'),
        new ButtonBuilder()
            .setCustomId('dm_demo_open_menu')
            .setLabel('Ver otro sistema')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋')
    );

    return {
        embeds: [embed],
        files: logoAtt ? [logoAtt] : [],
        components: [row]
    };
}

function isAskingForDemoMenu(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (clean.length > 140) return false;
    return /\b(prueba|pruebas|demo|demos|ejemplo|ejemplos|muestra|muestrame|mostrarme|ensename|ensenarme|ver\s+como\s+(funciona|se\s+ve|se\s+veria|queda|quedaria)|como\s+se\s+(ve|veria)|como\s+(queda|quedaria))\b/.test(clean);
}

function detectSpecificDemoKey(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/\b(streamer|streamers|directo|directos|twitch|kick|tiktok)\b/.test(clean)) return 'streamers';
    if (/\b(evento|eventos)\b/.test(clean)) return 'eventos';
    if (/\b(consulta|consultas|normativa)\b/.test(clean)) return 'consultas';
    if (/\b(ticket|tickets)\b/.test(clean)) return 'tickets';
    if (/\b(locucion|soporte\s+por\s+voz|avisos\s+de\s+voz|salas\s+de\s+soporte)\b/.test(clean)) return 'locucion';
    if (/\b(whitelist|wl|anti\s*ia)\b/.test(clean)) return 'whitelist';
    if (/\b(sancion|sanciones|expediente|expedientes)\b/.test(clean)) return 'sanciones';
    if (/\b(valoracion|valoraciones|top\s*staff|ranking)\b/.test(clean)) return 'valoraciones';
    if (/\b(ascenso|ascensos|descenso|descensos)\b/.test(clean)) return 'ascensos';
    if (/\b(bienvenida|bienvenidas|estado\s+fivem|jugadores)\b/.test(clean)) return 'bienvenidas_fivem';
    if (/\b(dashboard|dashboards|monitor|servicios)\b/.test(clean)) return 'dashboards';
    if (/\b(plantilla|plantillas|postulacion|postulaciones)\b/.test(clean)) return 'plantillas';
    return null;
}

// Consulta gratuita en tiempo real del clima (sin necesidad de API Key)
async function fetchLiveWeatherContext(userMessage) {
    const clean = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!/\b(tiempo|clima|llueve|llover|lluvia|temperatura|grados|calor|frio|sol|nublado|pronostico)\b/.test(clean)) {
        return '';
    }

    // Extraer ciudad si el usuario dice "en Madrid", "de Barcelona", etc.
    let city = 'Madrid';
    const cityMatch = userMessage.match(/\b(?:en|de|para)\s+([A-ZÁÉÍÓÚÑa-záéíóúñ][A-ZÁÉÍÓÚÑa-záéíóúñ\s-]{1,28}?)(?=[?.!,]|$|\s+(?:hoy|mañana|ahora|esta|este))/i);
    if (cityMatch && cityMatch[1]) {
        const candidate = cityMatch[1].trim();
        if (!/^(hoy|manana|mañana|ahora|general|españa)$/i.test(candidate)) {
            city = candidate;
        }
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=es`, {
            headers: { 'User-Agent': 'VallecasRP-Bot/1.0' },
            signal: controller.signal
        });
        clearTimeout(timer);

        if (res.ok) {
            const data = await res.json();
            const curr = data.current_condition?.[0];
            const area = data.nearest_area?.[0]?.areaName?.[0]?.value || city;
            const today = data.weather?.[0];
            if (curr) {
                const desc = curr.lang_es?.[0]?.value || curr.weatherDesc?.[0]?.value || 'Despejado';
                return (
                    `\nDATOS METEOROLÓGICOS EN TIEMPO REAL (${area}):\n` +
                    `- Estado actual: ${desc}\n` +
                    `- Temperatura actual: ${curr.temp_C}°C (sensación térmica: ${curr.FeelsLikeC}°C)\n` +
                    `- Humedad: ${curr.humidity}% | Viento: ${curr.windspeedKmph} km/h\n` +
                    (today ? `- Mínima/Máxima hoy: ${today.mintempC}°C / ${today.maxtempC}°C\n` : '')
                );
            }
        }
    } catch (e) { }
    return '';
}

async function queryDmAI(userId, userMessage) {
    const apiKeys = getConfiguredApiKeys();
    if (apiKeys.length === 0) return null;

    // Recuperar o crear historial del usuario en DM
    const now = Date.now();
    let entry = dmHistories.get(userId);
    if (!entry || now - entry.lastAt > 30 * 60 * 1000) {
        entry = { messages: [], lastAt: now };
        dmHistories.set(userId, entry);
    }
    entry.lastAt = now;

    // Fecha, hora actual en España y clima en vivo si pregunta por el tiempo
    const fechaHoraEs = new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date());

    const weatherContext = await fetchLiveWeatherContext(userMessage);

    const systemPrompt =
        'Eres un Asistente de Inteligencia Artificial completo y todoterreno por Mensaje Directo (DM) en Discord.\n' +
        `FECHA Y HORA ACTUAL EN ESPAÑA: ${fechaHoraEs}.\n` +
        weatherContext + '\n' +
        'TUS CAPACIDADES (PUEDES HABLAR DE ABSOLUTAMENTE TODO):\n' +
        '1. ASISTENTE TODOTERRENO (TIPO CHATGPT): Puedes ayudar y conversar sobre CUALQUIER tema de la vida cotidiana y profesional: trabajo, currículums, estudios, electrónica, hardware, informática, programación, coches, salud/deporte general, cocina, redacción de textos, traducciones, matemáticas, consejos personales, el tiempo de hoy, curiosidades, historia, ciencia, etc.\n' +
        '2. EXPERTO ABSOLUTO EN FIVEM Y SERVIDORES DE ROLEPLAY: Dominas al máximo todo sobre FiveM / Cfx.re: normativas oficiales de Cfx.re / Rockstar (PLA/TOS, monetización permitida y prohibida, Tebex, marcas reales/lore-friendly), licencias Keymaster y niveles de Patreon/Cfx (Element Club Argentum/Aurum/Platinum, límites de slots, OneSync Infinity, EUP/ropa streaming), configuración de servidores (server.cfg, permisos ACE, txAdmin, artefactos), frameworks (ESX, QBCore, QBox, ox_lib, ox_inventory), optimización de rendimiento (resmon, ms, MLOs, vehículos, caché) y programación de scripts (Lua, JS, HTML/CSS/NUI).\n' +
        '3. ASISTENTE COMERCIAL DEL BOT: Si el usuario pregunta específicamente por los sistemas o funciones de este bot de Discord, explica con claridad y atractivo todo lo que puede hacer por SU servidor (100% personalizable a su logo, colores, banners, canales, roles y normativa) basándote en el catálogo de abajo.\n\n' +
        'REGLAS ESTRICTAS:\n' +
        '1. CREADOR, DUEÑO Y CONTACTO POR DM: Si alguien pregunta quién te creó, quién es tu dueño, quién es <@1308814761269395527>, si puede hablarle por DM o cómo contactar con él:\n' +
        '   - Menciona SIEMPRE a <@1308814761269395527> y di claramente que es el único dueño, creador y desarrollador de este bot y de todos sus sistemas de inteligencia artificial.\n' +
        '   - Si preguntan si pueden hablarle por DM o cómo contactarle, responde SIEMPRE QUE SÍ con entusiasmo: explícales que solo tienen que hacer clic sobre su mención (<@1308814761269395527>) para abrir chat privado y escribirle directamente por DM (sin revelar datos personales privados, solo facilitando el contacto por Discord).\n' +
        '   - PROHIBIDO decir "no puedo darte su tag", "no puedo confirmar si tiene los DM abiertos" ni poner excusas para contactar con él.\n' +
        '2. NUNCA menciones el nombre de ningún servidor concreto (como Vallecas RP) ni cifras fijas de rangos; si hablas del bot, habla en segunda persona ("tu servidor", "tu equipo de Staff").\n' +
        '3. NUNCA menciones entrevistas orales ni whitelist por voz.\n' +
        '4. NUNCA reveles qué inteligencia artificial, proveedor, API, modelo, base de datos, hosting o tecnología interna usa este bot. PROHIBIDO mencionar: Groq, Qwen, OpenAI, GPT, ChatGPT, ElevenLabs, Gemini, Claude, HuggingFace, Sapling, MongoDB, Railway, Render, API Keys, wttr.in o código interno del bot.\n' +
        '5. Si alguien pregunta qué IA eres o cómo estás hecho, responde amablemente que funcionas con **tecnología de inteligencia artificial propia desarrollada a medida por <@1308814761269395527>** y que los detalles internos son confidenciales.\n' +
        '6. NUNCA dibujes ejemplos falsos en texto plano (como "[ VER DIRECTO ]" o mockups escritos) cuando alguien pida ver cómo funciona o cómo se ve un sistema del bot: invítale a pulsar el botón **"🎮 Ver Pruebas / Demos en Vivo"** justo debajo para abrir los paneles interactivos reales.\n' +
        '7. Responde siempre en español de España, de forma natural, clara, útil y bien estructurada (sin enrollarte innecesariamente, pero dando respuestas completas y precisas cuando el tema lo requiera).\n\n' +
        BOT_CAPABILITIES_KNOWLEDGE;

    const historyMessages = entry.messages.slice(-12);
    const payloadMessages = [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: userMessage }
    ];

    for (const apiKey of apiKeys) {
        for (const modelId of GROQ_MODELS) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: payloadMessages,
                        max_tokens: 900,
                        temperature: 0.45
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply && reply.length > 5) {
                        entry.messages.push({ role: 'user', content: userMessage });
                        entry.messages.push({ role: 'assistant', content: reply });
                        if (entry.messages.length > 14) {
                            entry.messages = entry.messages.slice(-14);
                        }
                        return reply;
                    }
                } else if (res.status === 429) {
                    continue;
                } else {
                    continue;
                }
            } catch (e) {
                continue;
            }
        }
    }
    return null;
}

function isAskingToClearChat(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (clean.length > 90) return false;
    const clearPatterns = [
        /^!(limpiar|borrar|clear|vaciar|limpiar-chat|borrar-chat|cleardm|limpiardm)(\s+.*)?$/,
        /\b(borra|borrar|elimina|eliminar|limpia|limpiar|vacia|vaciar)\b.*\b(chat|dm|mensajes|conversacion|todo|historial)\b/,
        /\b(puedes|podrias|quiero\s+que)\b.*\b(borrar|eliminar|limpiar|vaciar)\b.*\b(chat|dm|mensajes|conversacion|todo)\b/
    ];
    return clearPatterns.some(rx => rx.test(clean));
}

function buildClearChatConfirmPayload() {
    const embed = new EmbedBuilder()
        .setColor(0xE74C3C)
        .setAuthor({ name: 'LIMPIEZA DE CHAT POR DM' })
        .setTitle('🧹 ¿ESTÁS SEGURO DE BORRAR EL CHAT?')
        .setDescription(
            `Esta acción eliminará **todos los mensajes enviados por mí** en este chat privado y reiniciará la memoria de nuestra conversación.\n\n` +
            `ℹ️ *Por privacidad de Discord, los bots solo pueden eliminar sus propios mensajes (los tuyos permanecerán intactos).*`
        )
        .setFooter({ text: 'Confirma abajo si deseas continuar' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dm_clear_confirm')
            .setLabel('Sí, borrar todo')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
        new ButtonBuilder()
            .setCustomId('dm_clear_cancel')
            .setLabel('No, cancelar')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
    );

    return { embeds: [embed], components: [row] };
}

module.exports = function initDmAssistant(client) {
    console.log('💬 [DM ASSISTANT] Asistente informativo interactivo por Mensaje Directo activado.');

    // Limpieza periódica de historiales inactivos (> 30 min)
    setInterval(() => {
        const now = Date.now();
        for (const [uid, data] of dmHistories.entries()) {
            if (now - data.lastAt > 30 * 60 * 1000) {
                dmHistories.delete(uid);
            }
        }
    }, 10 * 60 * 1000);

    client.on('messageCreate', async (message) => {
        try {
            // EXCLUSIVAMENTE Mensajes Directos (DM) y nunca responder a bots
            if (message.author.bot || message.guild) return;

            const text = (message.content || '').trim();
            if (!text) return;

            // Anti-spam suave de 2 segundos por usuario
            const now = Date.now();
            const last = dmCooldown.get(message.author.id) || 0;
            if (now - last < 2000) return;
            dmCooldown.set(message.author.id, now);

            await message.channel.sendTyping().catch(() => {});

            // 0. Si pide borrar/limpiar el chat por texto o comando (!limpiar / !borrar / "borra el chat") -> 0 tokens
            if (isAskingToClearChat(text)) {
                await message.reply(buildClearChatConfirmPayload()).catch(() => {});
                return;
            }

            // 1. Si pide ver pruebas/demos (de un sistema concreto o del menú general) -> 0 tokens
            if (isAskingForDemoMenu(text)) {
                const specificKey = detectSpecificDemoKey(text);
                if (specificKey) {
                    const explainPayload = buildDemoExplainPayload(specificKey);
                    if (explainPayload) {
                        await message.reply(explainPayload).catch(() => {});
                        return;
                    }
                }
                const menuPayload = buildDemoMenuPayload();
                await message.reply(menuPayload).catch(() => {});
                return;
            }

            // 2. Si pregunta de forma general qué puede hacer / qué sistemas tiene -> Catálogo completo + botón de Demos
            if (isAskingForFullCatalog(text)) {
                const payload = buildCatalogEmbeds();
                await message.reply(payload).catch(() => {});
                return;
            }

            // 3. Cualquier duda específica o conversación -> Respuesta interactiva con IA
            const aiReply = await queryDmAI(message.author.id, text);
            const logoAtt = getLogoAttachment();
            const logoUrl = logoAtt ? 'attachment://logo.png' : undefined;

            const embed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({
                    name: 'ASISTENTE INTELIGENTE',
                    iconURL: logoUrl
                })
                .setThumbnail(logoUrl)
                .setDescription(
                    aiReply ||
                    'Ahora mismo no he podido procesar tu consulta. Si quieres ver todo lo que puedo hacer por tu servidor, escríbeme **"¿qué puedes hacer?"** y te enseño el catálogo completo.'
                )
                .setFooter({
                    text: 'Escribe "¿qué puedes hacer?" para ver todos los sistemas',
                    iconURL: logoUrl
                })
                .setTimestamp();

            await message.reply({
                embeds: [embed],
                files: logoAtt ? [logoAtt] : [],
                components: [buildOpenDemosButtonRow()]
            }).catch(() => {});
        } catch (err) {
            console.error('⚠️ [DM ASSISTANT Error]:', err.message);
        }
    });

    // Interacciones exclusivas de Demos por DM (NUNCA afecta a ningún canal de servidor)
    client.on('interactionCreate', async (interaction) => {
        try {
            // Blindaje absoluto: solo procesar interacciones dentro de DM (sin guild)
            if (interaction.guildId) return;

            // 0) Confirmación / Cancelación de limpieza de chat DM
            if (interaction.isButton() && interaction.customId === 'dm_clear_cancel') {
                const cancelEmbed = new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle('❌ Limpieza cancelada')
                    .setDescription('No se ha eliminado ningún mensaje del chat.');
                await interaction.update({ content: '', embeds: [cancelEmbed], components: [] }).catch(() => {});
                setTimeout(() => {
                    interaction.message?.delete().catch(() => {});
                }, 5000);
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_clear_confirm') {
                const workingEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle('🧹 Limpiando el chat...')
                    .setDescription('Eliminando todos mis mensajes de este DM, espera unos segundos...');
                await interaction.update({ content: '', embeds: [workingEmbed], components: [] }).catch(() => {});

                let deletedCount = 0;
                const channel = interaction.channel || await interaction.user.createDM().catch(() => null);
                if (channel) {
                    let beforeId = undefined;
                    for (let batch = 0; batch < 4; batch++) {
                        const fetched = await channel.messages.fetch({ limit: 100, before: beforeId }).catch(() => null);
                        if (!fetched || fetched.size === 0) break;

                        const botMsgs = fetched.filter(m => m.author.id === client.user.id && m.id !== interaction.message?.id);
                        for (const msg of botMsgs.values()) {
                            try {
                                await msg.delete();
                                deletedCount++;
                            } catch (e) { }
                        }

                        beforeId = fetched.last()?.id;
                        if (fetched.size < 100) break;
                    }
                }

                // Reiniciar también la memoria de conversación IA de este usuario en DM
                dmHistories.delete(interaction.user.id);

                const doneEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setTitle('✨ ¡Chat limpiado correctamente!')
                    .setDescription(
                        `Se han eliminado **${deletedCount}** mensaje(s) míos y se ha reiniciado nuestra conversación.\n` +
                        `*(Este aviso desaparecerá automáticamente en 5 segundos).*`
                    );
                await interaction.message?.edit({ content: '', embeds: [doneEmbed], components: [] }).catch(() => {});
                setTimeout(() => {
                    interaction.message?.delete().catch(() => {});
                }, 5000);
                return;
            }

            // A0) Botón desde respuesta IA / Catálogo: abre el panel de Demos sin borrar la respuesta de la IA
            if (interaction.isButton() && interaction.customId === 'dm_demo_open_menu_new') {
                const menuPayload = buildDemoMenuPayload();
                await interaction.reply(menuPayload).catch(() => {});
                return;
            }

            // A) Botón dentro de la Zona de Pruebas: EDITA el mismo mensaje al menú principal (estilo Telegram)
            if (interaction.isButton() && interaction.customId === 'dm_demo_open_menu') {
                const menuPayload = buildDemoMenuPayload();
                await updateDemoMessage(interaction, menuPayload);
                return;
            }

            // B) Menú desplegable: elegir un sistema -> EDITA el mismo mensaje con explicación + botón "👁️ Ver Prueba"
            if (interaction.isStringSelectMenu() && interaction.customId === 'dm_demo_select') {
                const selectedKey = interaction.values?.[0];
                const explainPayload = buildDemoExplainPayload(selectedKey);
                if (!explainPayload) return;
                await updateDemoMessage(interaction, explainPayload);
                return;
            }

            // C) Botón "👁️ Ver Prueba": EDITA el mismo mensaje al panel/diseño real del sistema
            if (interaction.isButton() && interaction.customId.startsWith('dm_demo_run_')) {
                const sysKey = interaction.customId.replace('dm_demo_run_', '');
                const sys = DEMO_SYSTEMS[sysKey];
                if (!sys) return;

                const demoPayload = sys.buildDemo(interaction.user);
                await updateDemoMessage(interaction, demoPayload);
                return;
            }

            // D) STREAMERS: Botones reales Twitch / Kick / TikTok -> Modal pidiendo URL y Título
            if (interaction.isButton() && interaction.customId.startsWith('dm_demo_stream_')) {
                const platform = interaction.customId.replace('dm_demo_stream_', ''); // Twitch | Kick | TikTok
                const placeholderUrl = platform === 'Kick'
                    ? 'https://kick.com/tunombre'
                    : (platform === 'TikTok' ? 'https://www.tiktok.com/@tunombre/live' : 'https://twitch.tv/tunombre');

                const modal = new ModalBuilder()
                    .setCustomId(`dm_demo_modal_stream_${platform}`)
                    .setTitle(`Prueba Real: Directo en ${platform}`);

                const urlInput = new TextInputBuilder()
                    .setCustomId('demo_stream_url')
                    .setLabel(`URL de tu canal de ${platform}`)
                    .setPlaceholder(placeholderUrl)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true);

                const titleInput = new TextInputBuilder()
                    .setCustomId('demo_stream_title')
                    .setLabel('Título del directo (opcional)')
                    .setPlaceholder('Ej: Atraco al Banco + Rol serio en TU SERVIDOR RP 🔥')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(urlInput),
                    new ActionRowBuilder().addComponents(titleInput)
                );

                await interaction.showModal(modal).catch(() => {});
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId.startsWith('dm_demo_modal_stream_')) {
                const platform = interaction.customId.replace('dm_demo_modal_stream_', '');
                const streamUrl = interaction.fields.getTextInputValue('demo_stream_url');
                const streamTitle = interaction.fields.getTextInputValue('demo_stream_title');
                const payload = buildDemoStreamNotification({
                    platform,
                    user: interaction.user,
                    streamUrl,
                    streamTitle
                });
                await updateDemoMessage(interaction, payload);
                return;
            }

            // E) EVENTOS: Modal real o ejemplo rápido
            if (interaction.isButton() && interaction.customId === 'dm_demo_evento_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('dm_demo_modal_evento')
                    .setTitle('Prueba Real: Publicar Evento');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_ev_title')
                            .setLabel('Título del evento')
                            .setPlaceholder('Ej: Gran Torneo de Drift Nocturno')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_ev_fecha')
                            .setLabel('Fecha y hora')
                            .setPlaceholder('Ej: Sábado 22:30 (Hora España)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_ev_lugar')
                            .setLabel('Lugar y Premio')
                            .setPlaceholder('Ej: Puerto Sur • Premio: 250.000$ IC + Coche VIP')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_ev_detalles')
                            .setLabel('Actividades o detalles (una por línea)')
                            .setPlaceholder('Inscripción gratuita\nMúsica en directo\nPremios para Top 3')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                    )
                );

                await interaction.showModal(modal).catch(() => {});
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_demo_evento_quick') {
                await updateDemoMessage(interaction, buildDemoEventoCard({}));
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId === 'dm_demo_modal_evento') {
                const payload = buildDemoEventoCard({
                    title: interaction.fields.getTextInputValue('demo_ev_title'),
                    fechaHora: interaction.fields.getTextInputValue('demo_ev_fecha'),
                    lugarPremio: interaction.fields.getTextInputValue('demo_ev_lugar'),
                    detalles: interaction.fields.getTextInputValue('demo_ev_detalles')
                });
                await updateDemoMessage(interaction, payload);
                return;
            }

            // F) VALORACIONES Y TOP STAFF
            if (interaction.isButton() && interaction.customId === 'dm_demo_val_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('dm_demo_modal_val')
                    .setTitle('Prueba Real: Valorar a un Staff');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_val_staff')
                            .setLabel('Nombre o tag del Staff (ej. (Tag Staff))')
                            .setPlaceholder('(Tag Staff)')
                            .setValue('(Tag Staff)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_val_rating')
                            .setLabel('Puntuación del 1 al 10')
                            .setPlaceholder('10')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_val_comment')
                            .setLabel('Tu comentario / experiencia')
                            .setPlaceholder('Me atendió súper rápido y resolvió todo al instante.')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );

                await interaction.showModal(modal).catch(() => {});
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId === 'dm_demo_modal_val') {
                const payload = buildDemoValoracionCard({
                    user: interaction.user,
                    staffName: interaction.fields.getTextInputValue('demo_val_staff'),
                    rating: interaction.fields.getTextInputValue('demo_val_rating'),
                    comment: interaction.fields.getTextInputValue('demo_val_comment')
                });
                await updateDemoMessage(interaction, payload);
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_demo_val_top') {
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_val_modal')
                        .setLabel('⭐ Valorar a un Staff')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('📝'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_valoraciones')
                        .setLabel('Volver al Panel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [buildDemoTopStaffEmbed()], components: [navRow] });
                return;
            }

            // G) SANCIONES: Modal real -> Acta Disciplinaria
            if (interaction.isButton() && interaction.customId === 'dm_demo_sancion_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('dm_demo_modal_sancion')
                    .setTitle('Prueba Real: Registrar Sanción');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_san_target')
                            .setLabel('Usuario sancionado (ej. (Tag Usuario))')
                            .setPlaceholder('(Tag Usuario)')
                            .setValue('(Tag Usuario)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_san_punishment')
                            .setLabel('Sanción / Escenarios')
                            .setPlaceholder('Ej: Ban temporal 3 días / 1 Warn')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('demo_san_reason')
                            .setLabel('Breve explicación / Motivo')
                            .setPlaceholder('Ej: Combat Logging (desconexión en rol activo).')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );

                await interaction.showModal(modal).catch(() => {});
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId === 'dm_demo_modal_sancion') {
                const payload = buildDemoSancionCard({
                    user: interaction.user,
                    target: interaction.fields.getTextInputValue('demo_san_target'),
                    punishment: interaction.fields.getTextInputValue('demo_san_punishment'),
                    reason: interaction.fields.getTextInputValue('demo_san_reason')
                });
                await updateDemoMessage(interaction, payload);
                return;
            }

            // H) PLANTILLAS: Selector interactivo
            if (interaction.isButton() && interaction.customId === 'dm_demo_plantilla_open') {
                const menu = new StringSelectMenuBuilder()
                    .setCustomId('dm_demo_plantilla_pick')
                    .setPlaceholder('👇 Elige una plantilla oficial para verla...')
                    .addOptions(
                        Object.entries(DEMO_PLANTILLAS).map(([k, p]) => ({
                            label: p.nombre,
                            value: k,
                            emoji: p.emoji
                        }))
                    );
                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_plantillas')
                        .setLabel('Volver al Panel')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, {
                    content: '📂 **Selecciona la plantilla oficial que quieres previsualizar:**',
                    embeds: [],
                    components: [new ActionRowBuilder().addComponents(menu), backRow]
                });
                return;
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'dm_demo_plantilla_pick') {
                const pick = DEMO_PLANTILLAS[interaction.values?.[0]];
                if (!pick) return;
                const embed = new EmbedBuilder()
                    .setColor(0xD900FF)
                    .setAuthor({ name: 'PLANTILLAS OFICIALES • TU SERVIDOR RP' })
                    .setTitle(`${pick.emoji} ${pick.nombre.toUpperCase()}`)
                    .setDescription(
                        `Aquí tienes la plantilla oficial lista para enviar al ticket con \`!enviar <ID_TICKET>\`:\n\n` +
                        `${pick.contenido}\n\n` +
                        `🛡️ **Generada por:** \`(Tag Staff)\``
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • Gestión de Postulaciones' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_plantilla_open')
                        .setLabel('Elegir otra plantilla')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📂'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [embed], components: [navRow] });
                return;
            }

            // I) CONSULTAS IA: Botón cerrar/borrar simulado en el mismo mensaje
            if (interaction.isButton() && interaction.customId === 'dm_demo_consulta_close') {
                const closedEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setAuthor({ name: 'CONSULTAS DE LA NORMATIVA | TU SERVIDOR RP' })
                    .setTitle('🗑️ CONSULTA CERRADA Y LIMPIADA')
                    .setDescription(
                        `En tu servidor, al pulsar **🗑️ Cerrar / Borrar**, el bot elimina al instante tanto la pregunta del usuario como la respuesta para mantener el canal impecable *(dejando copia permanente en tu canal privado de logs)*.`
                    )
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_consultas')
                        .setLabel('Ver Consulta otra vez')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [closedEmbed], components: [navRow] });
                return;
            }

            // J) TICKETS: Botones reales Llamar al Staff / Solucionado
            if (interaction.isButton() && interaction.customId === 'dm_demo_ticket_call') {
                const summaryEmbed = new EmbedBuilder()
                    .setColor(0xD900FF)
                    .setAuthor({ name: 'ASISTENTE VIRTUAL | TU SERVIDOR RP' })
                    .setTitle('🔨 INFORME DE APELACIÓN | TU SERVIDOR RP')
                    .setDescription(
                        `👤 **Usuario:** <@${interaction.user.id}>\n` +
                        `⚖️ **Motivo detectado:**\n` +
                        `> Solicitud de revisión de sanción por desconexión involuntaria (crash) durante un rol.\n\n` +
                        `💬 **Declaración del usuario:**\n` +
                        `> *"Se me cerró el juego en mitad del aviso policial, adjunto captura del error."*\n\n` +
                        `⚡ **Estado:** \`Esperando revisión del Staff\`\n` +
                        `🔔 **Aviso enviado a:** \`(Tag Staff)\``
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • El asistente se silencia automáticamente tras enviar este resumen' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_tickets')
                        .setLabel('Volver al Ticket')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { content: `🔔 \`(Tag Staff)\` — *Resumen generado automáticamente:*`, embeds: [summaryEmbed], components: [navRow] });
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_demo_ticket_solve') {
                const solvedEmbed = new EmbedBuilder()
                    .setColor(0x2ECC71)
                    .setAuthor({ name: 'ASISTENTE VIRTUAL | TU SERVIDOR RP' })
                    .setTitle('✅ PROBLEMA SOLUCIONADO')
                    .setDescription(`¡Genial <@${interaction.user.id}>! Me alegro de haber podido ayudarte. El asistente queda en silencio y el ticket listo para cerrarse.`)
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_tickets')
                        .setLabel('Volver al Ticket')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('⬅️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú de Pruebas')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [solvedEmbed], components: [navRow] });
                return;
            }

            // K) WHITELIST: Denegada + Informe Anti-IA
            if (interaction.isButton() && interaction.customId === 'dm_demo_wl_denegada') {
                const deniedEmbed = new EmbedBuilder()
                    .setColor(0xE74C3C)
                    .setAuthor({ name: 'SISTEMA DE WHITELIST | TU SERVIDOR RP' })
                    .setTitle('❌ WHITELIST DENEGADA')
                    .setDescription(
                        `\u200B\n` +
                        `Lo sentimos **<@${interaction.user.id}>**, en esta ocasión tu solicitud de Whitelist no ha sido aprobada.\n\n` +
                        `📝 **| Te recomendamos repasar nuestras normativas en:**\n` +
                        `> \`#normativas\` ❗\n\n` +
                        `🔄 Podrás volver a intentarlo cuando estés listo.\n\n` +
                        `👤 **Solicitante:** <@${interaction.user.id}>\n` +
                        `🛡️ **Decidido Por:** \`(Tag Staff)\``
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • Sistema de Whitelist' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_whitelist')
                        .setLabel('Ver Aprobada')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🎉'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_wl_antiia')
                        .setLabel('Ver Informe Anti-IA')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🧠'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { content: `# ❌ Whitelist Denegada — <@${interaction.user.id}>`, embeds: [deniedEmbed], components: [navRow] });
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_demo_wl_antiia') {
                const antiIaEmbed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setAuthor({ name: 'AUDITORÍA ANTI-IA | TU SERVIDOR RP' })
                    .setTitle('🧠 INFORME AUTOMÁTICO DE SOLICITUD')
                    .setDescription(
                        `👤 **Postulante:** \`(Tag Usuario)\`\n` +
                        `📊 **Probabilidad de IA:** \`87%\` 🔴 *(Alto riesgo de texto generado)*\n` +
                        `🧑 **Originalidad Humana:** \`13%\`\n\n` +
                        `🔍 **Patrones detectados:**\n` +
                        `> • Apertura cliché (*"Desde temprana edad..."*)\n` +
                        `> • Estructura narrativa típica de generación automática\n` +
                        `> • **Perspectiva de historia:** \`3ª Persona (Correcta)\``
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • Filtro Anti-IA Multicapa' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_whitelist')
                        .setLabel('Ver Aprobada')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🎉'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_wl_denegada')
                        .setLabel('Ver Denegada')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('🚫'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [antiIaEmbed], components: [navRow] });
                return;
            }

            // L) DASHBOARDS: Monitor Tickets + Monitor IA
            if (interaction.isButton() && interaction.customId === 'dm_demo_dash_tickets') {
                const tkDash = new EmbedBuilder()
                    .setColor(0xD900FF)
                    .setAuthor({ name: 'MONITOR DE TICKETS EN VIVO | TU SERVIDOR RP' })
                    .setTitle('🎫 ASISTENTE INTELIGENTE DE TICKETS')
                    .setDescription(
                        `🤖 **Estado del Asistente:** 🟢 \`Activo 24/7\`\n\n` +
                        `📂 **TICKETS EN SEGUIMIENTO:**\n` +
                        `> ⏳ **En triaje por IA:** \`2\` ticket(s)\n` +
                        `> 🔔 **Esperando Staff (resumen listo):** \`1\` ticket(s)\n` +
                        `> ✅ **Resueltos hoy automáticamente:** \`14\` ticket(s)`
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • Monitor de Tickets en Tiempo Real' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_dashboards')
                        .setLabel('Servicios')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🖥️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_dash_ia')
                        .setLabel('Monitor IA')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚡'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [tkDash], components: [navRow] });
                return;
            }

            if (interaction.isButton() && interaction.customId === 'dm_demo_dash_ia') {
                const iaDash = new EmbedBuilder()
                    .setColor(0xD900FF)
                    .setAuthor({ name: 'TU SERVIDOR AI • SISTEMA MULTI-NÚCLEO' })
                    .setTitle('⚡ MONITOR DE CONSUMO DE TOKENS EN TIEMPO REAL')
                    .setDescription(
                        `🔋 **Capacidad diaria total:** \`7.800.000\` tokens\n` +
                        `🟩🟩🟩🟩🟩🟩🟩🟩🟩🟩 \`96.4%\` disponible\n\n` +
                        `🧠 **Núcleos Activos:** \`13/13\` • **Estado:** 🟢 \`Óptimo\`\n` +
                        `🔄 **Respaldo automático:** 🟢 \`Sin interrupciones\``
                    )
                    .setFooter({ text: 'TU SERVIDOR RP • Monitorización de Inteligencia Artificial' })
                    .setTimestamp();
                const navRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('dm_demo_run_dashboards')
                        .setLabel('Servicios')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🖥️'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_dash_tickets')
                        .setLabel('Monitor Tickets')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎫'),
                    new ButtonBuilder()
                        .setCustomId('dm_demo_open_menu')
                        .setLabel('Menú')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🎮')
                );
                await updateDemoMessage(interaction, { embeds: [iaDash], components: [navRow] });
                return;
            }
        } catch (err) {
            console.error('⚠️ [DM ASSISTANT interactionCreate Error]:', err.message);
        }
    });
};
