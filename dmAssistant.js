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

// Base de conocimiento oficial y completa del bot (sin ningún detalle técnico/proveedor interno)
const BOT_CAPABILITIES_KNOWLEDGE = `
CATÁLOGO COMPLETO DE SISTEMAS DEL BOT OFICIAL DE VALLECAS RP:

1. SISTEMA DE WHITELIST (ESCRITA + ANTI-IA + ORAL EN VIVO POR VOZ):
- Auditoría Anti-IA multicapa para revisar solicitudes escritas y detectar respuestas copiadas o generadas con inteligencia artificial.
- Entrevistas Orales en Vivo por Voz: el bot entra al canal de voz, formula las preguntas habladas con voz neuronal propia, escucha y transcribe en directo las respuestas del aspirante y genera automáticamente una ficha completa de evaluación para el Staff.
- Publicación automática con diseño prémium y banners oficiales de Whitelist Aprobada y Whitelist Denegada.

2. CONSULTAS DE NORMATIVA CON INTELIGENCIA ARTIFICIAL:
- Doble canal independiente: uno exclusivo para el equipo de Staff y otro abierto para todos los Usuarios/Ciudadanos.
- Funciona simplemente escribiendo la duda hablando normalmente (sin comandos).
- Conoce al 100% la Normativa General Oficial, la Normativa de Ilegales, todas las siglas de Roleplay (RK, PK, CK, MG, PG, DM, VDM, HK, NVV, RDE, ZS, etc.) y se actualiza al instante desde el canal de aprendizaje del Staff.
- Incluye botón de borrado rápido, auto-limpieza a los 90 segundos, respaldo automático entre múltiples núcleos de IA para no caerse nunca y registro completo en un canal privado de logs.

3. SISTEMA DE LOCUCIÓN Y AVISOS DE SOPORTE POR VOZ:
- Detecta al instante cuando un usuario entra en el canal de voz de Espera de Soporte.
- Reproduce una locución de bienvenida automática para el usuario en espera.
- Recorre las salas de soporte y la sala de charla de Staff emitiendo avisos sonoros periódicos (Aviso 1, Aviso 2 recordatorio y Aviso 3 de sanción), respetando a los Staffs que estén en canales de AFK o En Rol.
- Si tras el 3er aviso ningún Staff acude a atender al usuario, genera y envía automáticamente un informe oficial de aviso/sanción en el canal de sanciones de Staff.

4. ASISTENTE VIRTUAL INTELIGENTE DE TICKETS:
- Actúa automáticamente en las 4 categorías oficiales: Soporte, Apelaciones de Baneo, Creadores de Contenido (Streamers) y Donaciones, siempre que aún no haya intervenido un Staff.
- Recopila la información clave del usuario (motivo, capturas/pruebas, método de pago Bizum/PayPal, artículos VIP, enlaces de canal) con botones interactivos.
- Envía un resumen estructurado con aviso al Staff y se silencia en cuanto el Staff entra o es llamado.
- Detecta cuando un Staff escribe "RESUMEN: ..." en un ticket y lo transforma automáticamente en un embed oficial de cierre y registro.
- Cuenta con aprendizaje activo: cualquier directriz que el Staff escriba en el canal de aprendizaje queda memorizada automáticamente.

5. STREAMERS, CREADORES DE CONTENIDO Y DIRECTOS EN VIVO:
- Detección automática cuando un streamer oficial inicia directo y panel interactivo con botón para anunciar directos en Twitch, Kick y TikTok con diseño visual personalizado por plataforma.
- Auditoría automática de canales de Twitch, Kick y TikTok (seguidores, media de espectadores y visualizaciones) para solicitudes de rango Streamer.

6. SISTEMA DE VALORACIONES Y RANKING TOP STAFF:
- Panel interactivo donde los ciudadanos eligen al Staff atendiente, le puntúan con estrellas y dejan su reseña.
- Ranking Top Staff auto-actualizable en tiempo real con medias, total de valoraciones y gestión completa del equipo.

7. GESTIÓN Y PUBLICACIÓN OFICIAL DE EVENTOS:
- Panel interactivo para el Staff con formulario inteligente: pega la información del evento y el bot maqueta automáticamente título, fecha, hora, lugar, organizador, código de vestimenta, premios y cartel/flyer con diseño de lujo.
- Publicación simultánea en doble canal oficial de eventos.

8. SISTEMA DISCIPLINARIO Y EXPEDIENTES DE SANCIONES:
- Panel interactivo para emitir sanciones oficiales, adjuntar pruebas visuales, registrar expedientes y consultar el historial disciplinario completo de cualquier ciudadano.

9. ASCENSOS Y DESCENSOS AUTOMÁTICOS DE STAFF:
- Vigila en tiempo real la jerarquía completa de 11 rangos de Staff (desde Soporte Prueba hasta Jefe de Administración).
- Publica automáticamente los anuncios oficiales en los canales de Ascensos y Descensos, agrupándolos en un mismo anuncio elegante si se asciende o desciende a varios Staffs seguidos.

10. PANEL DE PLANTILLAS Y POSTULACIONES:
- Menú selector interactivo de plantillas oficiales de postulación (facciones, organizaciones, negocios, staff, etc.) con envío directo al ticket del usuario.

11. BIENVENIDAS PERSONALIZADAS Y ESTADO EN VIVO DE FIVEM:
- Bienvenidas automáticas con banner oficial, contador de miembros y accesos directos a normativa, whitelist, tickets y chat general.
- Panel auto-actualizable en vivo del servidor FiveM con jugadores conectados en tiempo real, estado online/offline, IP y código de conexión directa.

12. DASHBOARDS DE MONITORIZACIÓN EN TIEMPO REAL:
- Paneles en vivo para el equipo de administración: Estado General de Servicios, Monitor de Locución y Salas de Soporte (actualizado al instante al entrar/salir de voz), Monitor de Cola de Tickets en vivo y Monitor de Núcleos y Consumo de IA.

13. CONTROL DE ADMINISTRACIÓN Y UTILIDADES DEL SERVIDOR:
- Panel maestro de configuración de canales, roles, IP y paneles automáticos, además de herramientas rápidas de limpieza de chat y control ON/OFF de cada módulo.
`;

// Detectar si el usuario pide el catálogo general ("qué puedes hacer", "qué tienes", "qué sistemas tienes", etc.)
function isAskingForFullCatalog(text) {
    const clean = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (clean.length > 95) return false;

    const catalogPatterns = [
        /^(hola|buenas|hey|ey|ola|info|ayuda|help|menu|sistemas|funciones|catalogo)[\s!?.]*$/,
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
            name: 'ASISTENTE OFICIAL | VALLECAS RP',
            iconURL: logoUrl
        })
        .setThumbnail(logoUrl)
        .setTitle('✨ CATÁLOGO COMPLETO DE SISTEMAS | VALLECAS RP')
        .setDescription(
            `¡Buenas! Soy el **Bot Oficial de VALLECAS RP** 🇪🇸.\n` +
            `Aquí tienes **absolutamente todo** lo que puedo hacer por la comunidad y el equipo de Staff:\n\n` +
            `────────────────────────────\n` +
            `🧠 **INTELIGENCIA ARTIFICIAL Y ATENCIÓN**\n` +
            `────────────────────────────\n\n` +
            `📚 **1. Consultas de Normativa con IA**\n` +
            `> • Canales independientes para **Usuarios** y **Staff**.\n` +
            `> • Responde al instante con solo hablar *(sin comandos)* sobre Normativa General, Ilegales y siglas RP (\`RK\`, \`PK\`, \`CK\`, \`MG\`, \`PG\`, \`DM\`, \`VDM\`, \`NVV\`...).\n` +
            `> • Auto-limpieza a los 90s, botón de cierre rápido, sistema multi-núcleo sin caídas y registro automático en **canal de logs**.\n\n` +
            `🎫 **2. Asistente Virtual Inteligente de Tickets**\n` +
            `> • Actúa en **Soporte, Apelaciones, Creadores y Donaciones** mientras no haya entrado un Staff.\n` +
            `> • Recopila motivo, capturas, método de pago o enlaces, avisa al Staff con un **resumen estructurado** y se silencia al instante.\n` +
            `> • Convierte los \`RESUMEN:\` del Staff en cierres oficiales y memoriza nuevas directrices desde el **canal de aprendizaje**.\n\n` +
            `🎙️ **3. Locución y Avisos de Soporte por Voz**\n` +
            `> • Detecta usuarios en **Espera de Soporte** y les reproduce una locución de bienvenida automática.\n` +
            `> • Avisa por voz al Staff en **Salas de Soporte y Sala de Charla** *(Aviso 1, Aviso 2 y Aviso 3)*, respetando salas AFK y En Rol.\n` +
            `> • Si nadie atiende tras el 3er aviso, genera un **informe automático** para administración.`
        );

    const embed2 = new EmbedBuilder()
        .setColor(0xD900FF)
        .setDescription(
            `────────────────────────────\n` +
            `🛡️ **WHITELIST, MODERACIÓN Y EQUIPO STAFF**\n` +
            `────────────────────────────\n\n` +
            `📋 **4. Whitelist Escrita, Anti-IA y Entrevistas por Voz**\n` +
            `> • **Auditoría Anti-IA** para detectar solicitudes copiadas o generadas artificialmente.\n` +
            `> • **Entrevistas Orales en Vivo:** entra a voz, hace preguntas con voz neuronal, transcribe respuestas y genera la ficha completa.\n` +
            `> • Anuncios oficiales con banner de **Whitelist Aprobada** y **Denegada**.\n\n` +
            `⚖️ **5. Expedientes y Sistema de Sanciones**\n` +
            `> • Panel interactivo para emitir sanciones con pruebas, guardar expedientes y consultar el historial disciplinario de cualquier ciudadano.\n\n` +
            `📈 **6. Ascensos y Descensos Automáticos de Staff**\n` +
            `> • Detecta cambios en la jerarquía de **11 rangos de Staff** y publica los anuncios oficiales agrupados automáticamente.\n\n` +
            `⭐ **7. Valoraciones Ciudadanas y Ranking Top Staff**\n` +
            `> • Panel con menú para valorar a cualquier Staff con estrellas y comentario.\n` +
            `> • **Top Staff** actualizado en tiempo real con medias y estadísticas.`
        );

    const embed3 = new EmbedBuilder()
        .setColor(0xD900FF)
        .setDescription(
            `────────────────────────────\n` +
            `🎉 **COMUNIDAD, SERVIDOR Y MONITORIZACIÓN**\n` +
            `────────────────────────────\n\n` +
            `🟣 **8. Streamers y Directos en Vivo**\n` +
            `> • Panel y avisos de directos para **Twitch, Kick y TikTok** con diseño personalizado y auditoría automática de canales.\n\n` +
            `🎊 **9. Gestión y Publicación de Eventos**\n` +
            `> • Formulario inteligente que maqueta título, hora, lugar, organizador, premios y cartel en formato prémium en doble canal.\n\n` +
            `📑 **10. Panel de Plantillas y Postulaciones**\n` +
            `> • Selector interactivo de plantillas oficiales listas para enviar directamente a tickets.\n\n` +
            `👋 **11. Bienvenidas Oficiales y Estado en Vivo de FiveM**\n` +
            `> • Bienvenidas con banner y accesos rápidos + panel en tiempo real con jugadores conectados, IP y código de conexión.\n\n` +
            `🖥️ **12. Dashboards en Tiempo Real y Panel Maestro**\n` +
            `> • Monitores en vivo de **Servicios**, **Locución/Salas**, **Cola de Tickets** y **Núcleos IA**, más configuración completa de canales, roles y utilidades.\n\n` +
            `────────────────────────────\n` +
            `💬 **¿Quieres saber cómo funciona algún sistema al detalle?**\n` +
            `*Pregúntame directamente por aquí lo que quieras y te lo explico paso a paso.*`
        )
        .setFooter({
            text: 'VALLECAS RP • Asistente Oficial por Mensaje Directo',
            iconURL: logoUrl
        })
        .setTimestamp();

    return { embeds: [embed1, embed2, embed3], files: logoAtt ? [logoAtt] : [] };
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

    const systemPrompt =
        'Eres el Asistente Oficial de VALLECAS RP (bot oficial del servidor de FiveM) respondiendo por Mensaje Directo (DM) en Discord.\n' +
        'Tu función es informar con claridad, cercanía y entusiasmo a cualquier persona (usuarios o Staff) sobre TODO lo que puede hacer el bot, cómo funciona cada sistema, para qué sirve y resolver cualquier duda sobre sus funciones.\n\n' +
        'REGLAS DE CONFIDENCIALIDAD ESTRICTAS (PROHIBIDO INCUMPLIR):\n' +
        '1. NUNCA reveles qué inteligencia artificial, proveedor, API, modelo, base de datos, hosting o lenguaje de programación usas. PROHIBIDO mencionar palabras como: Groq, Qwen, OpenAI, GPT, ChatGPT, ElevenLabs, Gemini, Claude, HuggingFace, Sapling, MongoDB, Railway, Render, Node.js, Discord.js, API Keys, tokens de proveedor o código interno.\n' +
        '2. Si alguien pregunta qué IA usas, cómo estás programado, qué API utilizas o cómo replicar tus sistemas, responde amablemente que funcionas con **tecnología y sistemas internos propios de VALLECAS RP** y que los detalles técnicos internos son confidenciales.\n' +
        '3. Habla siempre en español de España, de forma natural, clara y bien estructurada (máximo 2-3 párrafos o lista corta con puntos).\n' +
        '4. Cíñete únicamente a los sistemas reales del bot descritos abajo; no inventes funciones que no existan.\n\n' +
        BOT_CAPABILITIES_KNOWLEDGE;

    const historyMessages = entry.messages.slice(-8);
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
                        max_tokens: 450,
                        temperature: 0.35
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply && reply.length > 5) {
                        entry.messages.push({ role: 'user', content: userMessage });
                        entry.messages.push({ role: 'assistant', content: reply });
                        if (entry.messages.length > 10) {
                            entry.messages = entry.messages.slice(-10);
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
                    name: 'ASISTENTE OFICIAL | VALLECAS RP',
                    iconURL: logoUrl
                })
                .setThumbnail(logoUrl)
                .setDescription(
                    aiReply ||
                    'Ahora mismo no he podido procesar tu consulta. Si quieres ver todo lo que puedo hacer, escríbeme **"¿qué puedes hacer?"** y te enseño todos mis sistemas.'
                )
                .setFooter({
                    text: 'VALLECAS RP • Escribe "¿qué puedes hacer?" para ver todos los sistemas',
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
