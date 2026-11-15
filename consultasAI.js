// ==========================================
// MÓDULO INDEPENDIENTE: CONSULTAS IA PARA STAFF (VALLECAS RP)
// ==========================================
// Canal exclusivo: 1571567304628506855
// Canal de aprendizaje compartido: 1571488286789079080
// Comandos de control para Staff:
//   - !consultas on / !consultas off / !consultas estado
//   - !limpiarconsultas

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
    EmbedBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');

// ==========================================
// MODELOS DE MONGODB (COMPARTIDOS)
// ==========================================
const ticketKnowledgeSchema = new mongoose.Schema({
    category: { type: String, required: true },
    keywords: [{ type: String }],
    questionPattern: { type: String, required: true },
    response: { type: String, required: true },
    addedBy: { type: String, default: 'Sistema' },
    createdAt: { type: Date, default: Date.now }
});

const TicketKnowledge = mongoose.models.TicketKnowledge || mongoose.model('TicketKnowledge', ticketKnowledgeSchema);

const botSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const BotSetting = mongoose.models.BotSetting || mongoose.model('BotSetting', botSettingSchema);

// ==========================================
// CONFIGURACIÓN Y CONSTANTES
// ==========================================
const CANAL_CONSULTAS_ID = '1571567304628506855';
const CANAL_APRENDIZAJE_ID = '1571488286789079080';
const ROLE_STAFF_ID = '1538191116610838691';

let consultasActivas = true;

// Helper para obtener el logo oficial
function getLogoPath() {
    return path.join(__dirname, 'assets', 'logo.png');
}

function getLogoAttachment() {
    const p = getLogoPath();
    if (fs.existsSync(p)) {
        return new AttachmentBuilder(p, { name: 'logo.png' });
    }
    return null;
}

async function loadConfig() {
    try {
        const config = await BotSetting.findOne({ key: 'consultas_ai_activo' });
        if (config !== null && config.value !== undefined) {
            consultasActivas = !!config.value;
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS IA] Error cargando config:', e.message);
    }
}

/**
 * Consulta la IA de Groq inyectando toda la base de conocimientos aprendida
 */
async function queryGroqAI(userQuestion) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return null;

    try {
        // Recuperar conocimientos del canal de aprendizaje (últimos 35 registros)
        let knowledgeContext = '';
        try {
            const allKnowledge = await TicketKnowledge.find({}).sort({ createdAt: -1 }).limit(35);
            if (allKnowledge && allKnowledge.length > 0) {
                knowledgeContext = '\n\nBASE DE CONOCIMIENTOS OFICIAL DE VALLECAS RP (Normativas, Precios y Reglas):\n' +
                    allKnowledge.map(k => `• ${k.response}`).join('\n') + '\n';
            }
        } catch (e) { }

        const systemPrompt =
            'Eres la IA Asesora Interna y Oficial de VALLECAS RP para el Equipo de Staff y Administración.\n' +
            'Tu labor es responder consultas de moderadores sobre normativas de FiveM (PG, MG, RDM, VDM, IC/OOC, etc.), precios de donaciones, sanciones y funcionamiento del servidor.\n\n' +
            'REGLAS DE ORO:\n' +
            '1. Responde de forma clara, directa, profesional y concisa (máximo 1 o 2 párrafos bien redactados).\n' +
            '2. Si la duda es sobre una normativa específica (ej: PG, RDM), define la regla y da ejemplos claros.\n' +
            '3. Básate prioritariamente en la base de datos de Vallecas RP proporcionada a continuación.\n' +
            '4. Habla siempre en español de España de forma respetuosa y cercana hacia los moderadores.\n' +
            '5. NUNCA inventes precios ni normativas que contradigan las notas oficiales.' +
            knowledgeContext;

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen/qwen3.8-27b',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userQuestion }
                ],
                max_tokens: 350,
                temperature: 0.3
            })
        });

        if (res.ok) {
            const data = await res.json();
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (reply && reply.length > 5) return reply;
        } else {
            console.error('⚠️ [CONSULTAS AI Groq Error]:', res.status, await res.text());
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS AI Error]:', e.message);
    }
    return null;
}

function isMemberStaff(member) {
    if (!member || member.user.bot) return false;
    if (ROLE_STAFF_ID && member.roles.cache.has(ROLE_STAFF_ID)) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

/**
 * Inicializador del módulo de Consultas IA
 */
function initConsultasAI(client) {
    loadConfig();

    console.log('🤖 [CONSULTAS AI] Sistema independiente cargado. Canal:', CANAL_CONSULTAS_ID);

    client.on('messageCreate', async (message) => {
        try {
            if (message.author.bot || !message.guild) return;

            const contentLower = message.content.trim().toLowerCase();
            const isStaff = isMemberStaff(message.member);

            // ==========================================
            // COMANDOS DE CONTROL (!consultas on/off/estado)
            // ==========================================
            if (contentLower === '!consultas on') {
                if (!isStaff) return;
                consultasActivas = true;
                await BotSetting.findOneAndUpdate({ key: 'consultas_ai_activo' }, { key: 'consultas_ai_activo', value: true }, { upsert: true });
                return message.reply('🟢 **Canal de Consultas IA ACTIVADO.** Los staffs pueden consultar dudas normalmente.');
            }

            if (contentLower === '!consultas off') {
                if (!isStaff) return;
                consultasActivas = false;
                await BotSetting.findOneAndUpdate({ key: 'consultas_ai_activo' }, { key: 'consultas_ai_activo', value: false }, { upsert: true });
                return message.reply('🔴 **Canal de Consultas IA DESACTIVADO.** Modo pausa.');
            }

            if (contentLower === '!consultas estado') {
                if (!isStaff) return;
                return message.reply(`ℹ️ El sistema de Consultas IA se encuentra: **${consultasActivas ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}**.`);
            }

            if (contentLower === '!limpiarconsultas') {
                if (!isStaff) return;
                if (message.channel.id !== CANAL_CONSULTAS_ID) {
                    return message.reply('❌ Este comando solo se puede usar en el canal de consultas.');
                }
                const msgs = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (msgs && msgs.size > 0) {
                    await message.channel.bulkDelete(msgs, true).catch(() => {});
                }
                const temp = await message.channel.send('🧹 **Canal de consultas limpiado por completo.**');
                setTimeout(() => temp.delete().catch(() => {}), 4000);
                return;
            }

            // ==========================================
            // ATENCIÓN DE CONSULTAS EN EL CANAL 1571567304628506855
            // ==========================================
            if (message.channel.id === CANAL_CONSULTAS_ID) {
                // Solo permitimos a miembros del Staff consultar
                if (!isStaff) {
                    await message.delete().catch(() => {});
                    const warn = await message.channel.send(`⛔ <@${message.author.id}>, este canal es exclusivo para el Staff de Vallecas RP.`);
                    setTimeout(() => warn.delete().catch(() => {}), 5000);
                    return;
                }

                if (!consultasActivas) {
                    await message.delete().catch(() => {});
                    const aviso = await message.channel.send(`⚠️ <@${message.author.id}>, el sistema de Consultas IA está actualmente desactivado por la Administración.`);
                    setTimeout(() => aviso.delete().catch(() => {}), 6000);
                    return;
                }

                const questionText = message.content.trim();
                if (questionText.length < 3) return;

                // 1. ELIMINAR EL MENSAJE DEL STAFF AUTOMÁTICAMENTE para mantener el canal limpio
                await message.delete().catch(() => {});

                // 2. Indicador visual de que la IA está procesando la consulta
                await message.channel.sendTyping().catch(() => {});

                // 3. Consultar la IA
                const aiAnswer = await queryGroqAI(questionText);

                const logoAttachment = getLogoAttachment();
                const iconUrl = logoAttachment ? 'attachment://logo.png' : (message.guild.iconURL() || undefined);

                // Diseño limpio: solo título, texto de respuesta y logo oficial
                const embed = new EmbedBuilder()
                    .setColor(0x3498db)
                    .setAuthor({
                        name: 'ASESORÍA DE STAFF | VALLECAS RP',
                        iconURL: iconUrl
                    })
                    .setTitle('📋 RESOLUCIÓN DE CONSULTA')
                    .setDescription(
                        `❓ **| Pregunta planteada:**\n` +
                        `> *"${questionText.length > 200 ? questionText.slice(0, 197) + '...' : questionText}"*\n\n` +
                        `💡 **| Respuesta de la IA:**\n` +
                        `> ${aiAnswer || 'Lo siento, no he podido obtener respuesta en este momento. Por favor, consulta directamente con la Administración.'}\n\n` +
                        `*(Pulsa el botón de abajo en cuanto hayas terminado de leer).*`
                    )
                    .setThumbnail(iconUrl)
                    .setFooter({
                        text: 'VALLECAS RP • Base de Datos Oficial',
                        iconURL: iconUrl
                    })
                    .setTimestamp();

                // Botón interactivo para eliminar el mensaje al terminar de leer
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_cerrar_consulta_${message.author.id}`)
                        .setLabel('Cerrar / Borrar')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🗑️')
                );

                const responseMsg = await message.channel.send({
                    content: `👋 <@${message.author.id}> aquí tienes tu respuesta:`,
                    embeds: [embed],
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [row]
                }).catch(() => null);

                // Auto-borrado preventivo a los 70 segundos para que el canal nunca quede con mensajes olvidados
                if (responseMsg) {
                    setTimeout(() => {
                        responseMsg.delete().catch(() => {});
                    }, 70 * 1000);
                }
            }

        } catch (err) {
            console.error('⚠️ [CONSULTAS AI messageCreate Error]:', err.message);
        }
    });

    // Evento: Botón para borrar la consulta
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;
            if (interaction.customId.startsWith('btn_cerrar_consulta_')) {
                const targetUserId = interaction.customId.replace('btn_cerrar_consulta_', '');
                
                // Solo el staff que preguntó o un administrador puede pulsar el botón
                const isAllowed = interaction.user.id === targetUserId || interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
                if (!isAllowed) {
                    return interaction.reply({
                        content: '⛔ Solo la persona que hizo esta consulta puede borrarla.',
                        ephemeral: true
                    });
                }

                await interaction.message.delete().catch(() => {});
            }
        } catch (err) {
            console.error('⚠️ [CONSULTAS AI interactionCreate Error]:', err.message);
        }
    });
}

module.exports = initConsultasAI;

