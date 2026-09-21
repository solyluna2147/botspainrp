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

// IDs de canales configurables por Variables de Entorno (.env)
const CHANNEL_SOLICITUDES_ID = process.env.CHANNEL_SOLICITUDES_ID; // Canal donde llegan las solicitudes del bot de WL
const CHANNEL_APROBADOS_ID = process.env.CHANNEL_APROBADOS_ID;     // Canal donde se anuncian las WL aprobadas
const CHANNEL_DENEGADOS_ID = process.env.CHANNEL_DENEGADOS_ID;     // Opcional: Canal donde se anuncian las denegadas (si aplica)

// Set para evitar procesar dos veces el mismo mensaje
const processedMessages = new Set();

// Lista de estados dinámicos / animados que rotarán
const activities = [
    { name: 'SPAIN RP 🇪🇸', type: ActivityType.Playing },
    { name: '📋 Solicitudes de Whitelist', type: ActivityType.Watching },
    { name: 'cfx.re/join/7b97gmr', type: ActivityType.Streaming, url: 'https://twitch.tv/spainrp' },
    { name: '🛡️ Normativa de la Ciudad', type: ActivityType.Listening },
    { name: '🌆 El estándar del RP realista', type: ActivityType.Watching }
];

client.once('ready', async () => {
    console.log(`✅ Bot conectado exitosamente como: ${client.user.tag}`);
    console.log(`📌 Canal de Solicitudes (Whitelist): ${CHANNEL_SOLICITUDES_ID || 'Todos los canales'}`);
    console.log(`📌 Canal de Resultados (Aprobados/Denegados): ${CHANNEL_APROBADOS_ID || 'No configurado'}`);

    // Comprobación de acceso a los canales en el servidor
    try {
        const guilds = client.guilds.cache;
        guilds.forEach(guild => {
            console.log(`🏰 Servidor conectado: ${guild.name} (${guild.id})`);
            const chSolicitudes = guild.channels.cache.get(CHANNEL_SOLICITUDES_ID);
            const chAprobados = guild.channels.cache.get(CHANNEL_APROBADOS_ID);
            console.log(`   -> Canal Solicitudes (${CHANNEL_SOLICITUDES_ID}): ${chSolicitudes ? `✅ #${chSolicitudes.name}` : '❌ NO ENCONTRADO O SIN PERMISO'}`);
            console.log(`   -> Canal Aprobados (${CHANNEL_APROBADOS_ID}): ${chAprobados ? `✅ #${chAprobados.name}` : '❌ NO ENCONTRADO O SIN PERMISO'}`);
        });
    } catch (e) {
        console.error('Error al listar canales del servidor:', e);
    }

    // Rotar estado cada 8 segundos
    let activityIndex = 0;
    setInterval(() => {
        const activity = activities[activityIndex];
        client.user.setPresence({
            activities: [activity],
            status: 'online'
        });
        activityIndex = (activityIndex + 1) % activities.length;
    }, 8000);
});

// ==========================================
// 3. FUNCIONES PARA ENVIAR NOTIFICACIONES
// ==========================================

async function sendApprovedNotification({ userMention, staffName = 'Equipo de Staff' }) {
    const targetChannelId = CHANNEL_APROBADOS_ID || '1550880724930797610';
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

    const canalNormativas = `<#${process.env.CHANNEL_NORMATIVAS_ID || '1517530848658849996'}>`;
    const canalTickets = `<#${process.env.CHANNEL_TICKETS_ID || '1517530849334136844'}>`;
    const canalGeneral = `<#${process.env.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

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
    const targetChannelId = (CHANNEL_DENEGADOS_ID || CHANNEL_APROBADOS_ID) || '1550880724930797610';
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

    const canalNormativas = `<#${process.env.CHANNEL_NORMATIVAS_ID || '1517530848658849996'}>`;
    const canalTickets = `<#${process.env.CHANNEL_TICKETS_ID || '1518087100275097671'}>`;

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

    // 1. Detectar si la decisión es Aprobada o Denegada
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
        console.log(`❌ [DEBUG] No es ni Aprobada ni Denegada según los patrones.`);
        console.log(`==============================================\n`);
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

    // 4. Enviar notificación usando la función reutilizable
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
        // COMANDO DE AYUDA: !wl-ayuda / !wl-comandos
        // ----------------------------------------------------
        if (['!wl-ayuda', '!wl-comandos', '!comandos-wl'].includes(command)) {
            return message.reply({
                content: `📖 **COMANDOS DEL BOT DE WHITELIST:**\n\n` +
                    `✅ \`!aprobar @usuario\` o \`!aprobado @usuario\` → Envía el anuncio oficial de Whitelist Aprobada.\n` +
                    `❌ \`!denegar @usuario\` o \`!denegado @usuario\` → Envía el anuncio oficial de Whitelist Denegada.\n` +
                    `🗑️ \`!borrar\` → Borra el mensaje anterior del bot (o responde a un mensaje con \`!borrar\` para borrarlo).\n` +
                    `🧪 \`!simular @usuario\` → Crea un mensaje interactivo con botones de prueba.\n`
            });
        }

        // Comando interactivo para simular una solicitud PENDIENTE con botones reales
        if (message.content.startsWith('!simular-pendiente') || message.content.startsWith('!simular')) {
            const mentionedUser = message.mentions.users.first() || message.author;

            const embedPendiente = new EmbedBuilder()
                .setColor(0xF1C40F) // Amarillo / Pendiente
                .setTitle('📋 Whitelist Solicitud Pendiente')
                .setDescription(
                    `**Solicitante:** <@${mentionedUser.id}> ha enviado una solicitud para 📋 **Whitelist**.\n\n` +
                    `🎭 **¿QUÉ ES EL ROL?**\nEs interpretar un personaje ficticio siguiendo situaciones de la vida real respetando la historia y el entorno.\n\n` +
                    `❤️ **VALORACIÓN DE VIDA**\nSi me apuntan con un arma colaboro y pongo mi vida por encima de todo.\n\n` +
                    `📖 **HISTORIA DEL PERSONAJE**\nJulián Torres creció en un barrio humilde y llega a la ciudad para forjar un nuevo futuro legal.\n\n` +
                    `────────────────────────────\n` +
                    `**Solicitante:** <@${mentionedUser.id}>\n` +
                    `**Decisión:** \`🟡 Pendiente\`\n` +
                    `**Enviada El:** ${new Date().toLocaleDateString()}`
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`aprobar_wl_${mentionedUser.id}`)
                    .setLabel('Aprobar Whitelist')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅'),
                new ButtonBuilder()
                    .setCustomId(`denegar_wl_${mentionedUser.id}`)
                    .setLabel('Denegar Whitelist')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await message.channel.send({
                content: `🔔 **Nueva Solicitud de Whitelist recibida** para <@${mentionedUser.id}>`,
                embeds: [embedPendiente],
                components: [row]
            });
            return;
        }
    }

    if (message.author.id === client.user.id) return;
    await handleWhitelistMessage(message, 'messageCreate');
});

// Manejo de clics en los botones de Aprobar / Denegar del simulador
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const [action, type, targetUserId] = interaction.customId.split('_');
    if (type !== 'wl') return;

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

// Iniciar sesión en Discord
client.login(process.env.DISCORD_TOKEN);
