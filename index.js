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
// 3. PROCESAMIENTO DE SOLICITUDES DEL BOT KING
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

    // 4. Enviar contenedor (Embed) al canal oficial de resultados/aprobados
    try {
        const targetChannelId = (isAprobada ? CHANNEL_APROBADOS_ID : (CHANNEL_DENEGADOS_ID || CHANNEL_APROBADOS_ID)) || '1550880724930797610';
        console.log(`📤 [INTENTO DE ENVÍO] Buscando canal de resultados con ID: ${targetChannelId}`);

        const targetChannel = await client.channels.fetch(targetChannelId).catch(err => {
            console.error(`❌ [ERROR FETCH CANAL] No se pudo obtener el canal con ID ${targetChannelId}:`, err.message);
            return null;
        });

        if (!targetChannel) {
            console.error(`❌ [ERROR CANAL] El bot no encuentra el canal ${targetChannelId}. Verifica que el bot tenga permiso para ver ese canal.`);
            return;
        }

        console.log(`✅ [CANAL ENCONTRADO] Nombre: #${targetChannel.name} (Servidor: ${targetChannel.guild ? targetChannel.guild.name : 'N/A'})`);

        if (isAprobada) {
            const imgPngPath = path.join(__dirname, 'assets', 'aprobado.png');
            const imgGifPath = path.join(__dirname, 'assets', 'aprobado.gif');
            const logoPath = path.join(__dirname, 'assets', 'logo.png');
            const files = [];

            if (fs.existsSync(logoPath)) {
                files.push(new AttachmentBuilder(logoPath, { name: 'logo.png' }));
            }

            // Canales oficiales interactivos (<#ID>)
            const canalNormativas = `<#${process.env.CHANNEL_NORMATIVAS_ID || '1517530848658849996'}>`;
            const canalTickets = `<#${process.env.CHANNEL_TICKETS_ID || '1517530849334136844'}>`;
            const canalGeneral = `<#${process.env.CHANNEL_GENERAL_ID || '1517530849032016002'}>`;

            const embedAprobado = new EmbedBuilder()
                .setColor(0x2ECC71) // Verde esmeralda brillante
                .setAuthor({
                    name: 'SISTEMA DE WHITELIST | SPAIN RP \uD83C\uDDEA\uD83C\uDDF8',
                    iconURL: fs.existsSync(logoPath) ? 'attachment://logo.png' : client.user.displayAvatarURL()
                })
                .setThumbnail('attachment://logo.png') // LOGO FIJO EN LA ESQUINA DERECHA
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

            await targetChannel.send({
                content: `# 🎉 ¡Enhorabuena ${userMention}!\n# ¡Tu Whitelist ha sido aprobada!`,
                embeds: [embedAprobado],
                files: files
            });

            console.log(`[WL APROBADA] Notificación enviada para ${userMention}`);
            processedMessages.add(cacheKey);

        } else if (isDenegada) {
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
                .setThumbnail('attachment://logo.png') // LOGO FIJO EN LA ESQUINA DERECHA
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

            await targetChannel.send({
                content: `# ⚠️ ¡Atención ${userMention}!\n# Tu solicitud ha sido denegada.`,
                embeds: [embedDenegado],
                files: files
            });

            console.log(`[WL DENEGADA] Notificación enviada para ${userMention}`);
            processedMessages.add(cacheKey);
        }
    } catch (error) {
        console.error('Error al enviar la notificación al canal de resultados:', error);
    }
}

// ==========================================
// 4. EVENTOS DE MENSAJES Y COMANDOS DE PRUEBA
// ==========================================

client.on('messageCreate', async (message) => {
    console.log(`📥 [MSG RECIBIDO] Canal: #${message.channel ? message.channel.name : 'N/A'} (${message.channel ? message.channel.id : 'N/A'}) | Autor: ${message.author ? message.author.tag : 'N/A'}`);

    if (!message.author.bot) {
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
