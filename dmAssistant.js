// ==========================================
// MÓDULO INDEPENDIENTE: ASISTENTE INFORMATIVO POR DM (VALLECAS RP)
// ==========================================
// Actúa ÚNICAMENTE por Mensajes Directos (DM) al bot.
// - Si alguien pregunta qué puede hacer / qué sistemas tiene / funciones -> envía el catálogo completo.
// - Permite conversar con IA sobre cualquier sistema, función o duda del bot.
// - Confidencialidad estricta: NUNCA revela proveedores, APIs, modelos ni tecnología interna.

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

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
    for (let i = 2; i <= 10; i++) {
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
            name: 'BOT TODO-EN-UNO PARA FIVEM RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('✨ ¿QUÉ PUEDO HACER POR TU SERVIDOR?')
        .setDescription(
            `¡Hola! Soy un **Bot Profesional Todo-en-Uno para servidores de FiveM Roleplay**, **100% personalizable** con tu logo, colores, banners, roles, canales y tu propia normativa.\n\n` +
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
            text: 'Bot Profesional Todo-en-Uno • 100% Personalizable para tu Servidor',
            iconURL: logoUrl
        })
        .setTimestamp();

    return { embeds: [embed1, embed2, embed3], files: logoAtt ? [logoAtt] : [] };
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
        '1. NUNCA menciones el nombre de ningún servidor concreto (como Vallecas RP) ni cifras fijas de rangos; si hablas del bot, habla en segunda persona ("tu servidor", "tu equipo de Staff").\n' +
        '2. NUNCA menciones entrevistas orales ni whitelist por voz.\n' +
        '3. NUNCA reveles qué inteligencia artificial, proveedor, API, modelo, base de datos, hosting o tecnología interna usa este bot. PROHIBIDO mencionar: Groq, Qwen, OpenAI, GPT, ChatGPT, ElevenLabs, Gemini, Claude, HuggingFace, Sapling, MongoDB, Railway, Render, API Keys, wttr.in o código interno del bot.\n' +
        '4. Si alguien pregunta qué IA eres o cómo estás hecho, responde amablemente que funcionas con **tecnología de inteligencia artificial propia desarrollada a medida** y que los detalles internos son confidenciales.\n' +
        '5. Responde siempre en español de España, de forma natural, clara, útil y bien estructurada (sin enrollarte innecesariamente, pero dando respuestas completas y precisas cuando el tema lo requiera).\n\n' +
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

            // 1. Si pregunta de forma general qué puede hacer / qué sistemas tiene -> Catálogo completo
            if (isAskingForFullCatalog(text)) {
                const { embeds, files } = buildCatalogEmbeds();
                await message.reply({ embeds, files }).catch(() => {});
                return;
            }

            // 2. Cualquier duda específica o conversación -> Respuesta interactiva con IA
            const aiReply = await queryDmAI(message.author.id, text);
            const logoAtt = getLogoAttachment();
            const logoUrl = logoAtt ? 'attachment://logo.png' : undefined;

            const embed = new EmbedBuilder()
                .setColor(0xD900FF)
                .setAuthor({
                    name: 'BOT TODO-EN-UNO PARA FIVEM RP',
                    iconURL: logoUrl
                })
                .setThumbnail(logoUrl)
                .setDescription(
                    aiReply ||
                    'Ahora mismo no he podido procesar tu consulta. Si quieres ver todo lo que puedo hacer por tu servidor, escríbeme **"¿qué puedes hacer?"** y te enseño el catálogo completo.'
                )
                .setFooter({
                    text: 'Bot Profesional Todo-en-Uno • Escribe "¿qué puedes hacer?" para ver todos los sistemas',
                    iconURL: logoUrl
                })
                .setTimestamp();

            await message.reply({
                embeds: [embed],
                files: logoAtt ? [logoAtt] : []
            }).catch(() => {});
        } catch (err) {
            console.error('⚠️ [DM ASSISTANT Error]:', err.message);
        }
    });
};
