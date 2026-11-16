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

const normativaDocSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    pages: [{ pageNumber: Number, text: String }],
    updatedAt: { type: Date, default: Date.now }
});

const NormativaDoc = mongoose.models.NormativaDoc || mongoose.model('NormativaDoc', normativaDocSchema);

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
let memoriaNormativaPages = []; // Caché en memoria RAM de las 16 páginas completas

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

        // Cargar las páginas de la normativa directamente desde MongoDB o localmente
        const docGeneral = await NormativaDoc.findOne({ key: 'normativa_general_2026' });
        if (docGeneral && docGeneral.pages && docGeneral.pages.length > 0) {
            memoriaNormativaPages = docGeneral.pages.map(p => p.text);
            console.log(`📚 [CONSULTAS AI] Cargadas ${memoriaNormativaPages.length} páginas de la normativa general desde MongoDB.`);
        } else {
            const localTxt = path.join(__dirname, 'normativa_vallecas_completa.txt');
            if (fs.existsSync(localTxt)) {
                const fullContent = fs.readFileSync(localTxt, 'utf8');
                memoriaNormativaPages = fullContent.split(/(?=VALLECAS RP\s*\n\|\s*NORMATIVA GENERAL OFICIAL)/i).map(p => p.trim());
            }
        }

        // Cargar la Normativa de Ilegales desde MongoDB (o respaldo local)
        const docIlegales = await NormativaDoc.findOne({ key: 'normativa_ilegales_2026' });
        if (docIlegales && docIlegales.pages && docIlegales.pages.length > 0) {
            if (!memoriaNormativaPages) memoriaNormativaPages = [];
            memoriaNormativaPages.push(...docIlegales.pages.map(p => p.text));
            console.log(`🔫 [CONSULTAS AI] Cargadas ${docIlegales.pages.length} secciones de la Normativa de Ilegales desde MongoDB.`);
        } else {
            const ilegalesTxt = path.join(__dirname, 'normativa_ilegales.txt');
            if (fs.existsSync(ilegalesTxt)) {
                const ilegalesContent = fs.readFileSync(ilegalesTxt, 'utf8');
                const ilegalesSections = ilegalesContent.split(/_{5,}|\n\n(?=[0-9]+\.\s+[A-ZÁÉÍÓÚÑ\s]+)/).map(s => s.trim()).filter(Boolean);
                if (ilegalesSections.length > 0) {
                    if (!memoriaNormativaPages) memoriaNormativaPages = [];
                    memoriaNormativaPages.push(...ilegalesSections);
                    console.log(`🔫 [CONSULTAS AI] Cargadas ${ilegalesSections.length} secciones de la Normativa de Ilegales desde archivo local.`);
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [CONSULTAS IA] Error cargando config y normativa:', e.message);
    }
}

// Diccionario inteligente de sinónimos y jerga FiveM / española para comprender al Staff aunque escriba mal
const JERGA_SINONIMOS = {
    'negocio': ['local', 'tienda', 'negocio', 'empresa', 'comercio', 'badulaque', 'taller', 'keli', 'propiedad'],
    'cerrado': ['cerrado', 'cerrar', 'serrao', 'cerrao', 'inactivo', 'inactividad', 'abrir', 'abre', 'tiempo', 'dias'],
    'robar': ['robo', 'robar', 'atraco', 'atracar', 'asaltar', 'asalto', 'botin', 'hurto', 'mangado', 'chafado'],
    'policia': ['lspd', 'cop', 'cops', 'agente', 'policia', 'patrulla', 'maderos', 'nacional', 'pitufo'],
    'ck': ['ck', 'cadena perpetua', 'perpetua', 'muerte definitiva', 'multas', 'droga', 'matarle el pj', 'borrar pj'],
    'sancion': ['ban', 'baneo', 'jail', 'sancion', 'castigo', 'expulsion', 'permaban', 'sancionan', 'castigan'],
    'coche': ['coche', 'vehiculo', 'auto', 'moto', 'patrulla', 'conducir', 'disparar', 'buga'],
    'arma': ['pistola', 'fusil', 'ak', 'escopeta', 'pesada', 'armamento', 'blanca', 'pipa', 'plomo'],
    'secuestro': ['secuestro', 'secuestrar', 'rapto', 'retener', 'rehén', 'rehenes', 'rescate'],
    'guerra': ['guerra', 'tiroteo', 'bandas', 'mafias', 'pacto', 'alianza', 'barrio', 'cartel', 'carteles', 'ilegal', 'ilegales', 'limite', 'cupo', 'integrantes', 'alianzas'],
    'entorno': ['entorno', 'rde', 'comisaria', 'zona segura', 'zs', 'evasion', 'campeo', 'caliente']
};

// Helper para buscar las páginas y secciones más relevantes de la normativa según la pregunta del Staff
function getRelevantNormativaSnippets(question) {
    if (!memoriaNormativaPages || memoriaNormativaPages.length === 0) {
        memoriaNormativaPages = [];
        const localTxt = path.join(__dirname, 'normativa_vallecas_completa.txt');
        if (fs.existsSync(localTxt)) {
            const fullContent = fs.readFileSync(localTxt, 'utf8');
            memoriaNormativaPages.push(...fullContent.split(/(?=VALLECAS RP\s*\n\|\s*NORMATIVA GENERAL OFICIAL)/i).map(p => p.trim()));
        }
        const ilegalesTxt = path.join(__dirname, 'normativa_ilegales.txt');
        if (fs.existsSync(ilegalesTxt)) {
            const ilegalesContent = fs.readFileSync(ilegalesTxt, 'utf8');
            const ilegalesSections = ilegalesContent.split(/_{5,}|\n\n(?=[0-9]+\.\s+[A-ZÁÉÍÓÚÑ\s]+)/).map(s => s.trim()).filter(Boolean);
            memoriaNormativaPages.push(...ilegalesSections);
        }
    }
    if (!memoriaNormativaPages || memoriaNormativaPages.length === 0) return '';

    try {
        const stopWords = new Set(['para', 'como', 'pero', 'este', 'esta', 'sobre', 'todo', 'toda', 'donde', 'cuando', 'quien', 'porque', 'mucho', 'poco', 'tiempo', 'pasa', 'queda', 'hace', 'deha', 'nota', 'cosa']);
        const qClean = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const words = qClean.split(/[^a-z0-9]+/i).filter(w => w.length >= 3 && !stopWords.has(w));

        // Expandir palabras clave con jerga y sinónimos
        const expandedWords = new Set(words);
        for (const [key, list] of Object.entries(JERGA_SINONIMOS)) {
            if (list.some(s => qClean.includes(s))) {
                list.forEach(w => expandedWords.add(w));
            }
        }

        // Puntuación de relevancia por página
        const scored = memoriaNormativaPages.map(page => {
            const pageLower = page.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            let score = 0;
            for (const word of expandedWords) {
                if (pageLower.includes(word)) {
                    score += (word.length >= 5 ? 3 : 1);
                    const occurrences = (pageLower.match(new RegExp(word, 'g')) || []).length;
                    score += Math.min(occurrences, 4);
                }
            }
            return { page, score };
        });

        scored.sort((a, b) => b.score - a.score);
        // Tomar las 2 páginas más relevantes
        const bestMatches = scored.slice(0, 2).filter(s => s.score > 0).map(s => s.page.trim()).join('\n\n--- SIGUIENTE SECCIÓN DE LA NORMATIVA ---\n\n');
        return bestMatches.slice(0, 5000);
    } catch (e) {
        return '';
    }
}

/**
 * Consulta la IA de Groq inyectando toda la base de conocimientos aprendida
 */
async function queryGroqAI(userQuestion) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return null;

    const qLower = userQuestion.toLowerCase();
    if (qLower.includes('anubis')) {
        const bromasAnubis = [
            'Creo que eso no es posible... De hecho, es más fácil que Siria deje las guerras a que consigas hablar con Anubis. Sigue soñando, compañero. 😂',
            '¿Hablar con Anubis? Tienes más probabilidades de tener una cena privada con el Papa en el Vaticano que de verle contestar al Discord. Búscate a otro Staff, crack. 💀',
            'Hablar con Anubis es como que te toque el Euromillones dos veces seguidas sin haber comprado boleto. Si tienes prisa, mejor reza un padrenuestro. 🍀',
            'Anubis es un ser mitológico que solo baja a la Tierra en año bisiesto si los astros se alinean. Sigue esperando sentado que de pie te vas a cansar. 🏛️',
            'He consultado los registros del universo y es más fácil encontrar agua líquida en el Sol que pillar a Anubis disponible. Inténtalo en otra reencarnación. ⏳',
            'Dicen las malas lenguas que Anubis solo habla con mortales cuando lluevan billetes de 500€ en Vallecas. Mejor búscate a otro moderador. 💸',
            'Espera sentado... De hecho, ponte cómodo, hazte unas palomitas y ponte una trilogía entera, porque la respuesta de Anubis va para largo. 🍿'
        ];
        return bromasAnubis[Math.floor(Math.random() * bromasAnubis.length)];
    }

    try {
        // 1. Fragmentos directos del texto original del PDF de la normativa
        const exactNormativaText = getRelevantNormativaSnippets(userQuestion);

        // 2. Conocimientos específicos en MongoDB
        let knowledgeContext = '';
        try {
            const allKnowledge = await TicketKnowledge.find({}).sort({ createdAt: -1 }).limit(25);
            if (allKnowledge && allKnowledge.length > 0) {
                knowledgeContext = '\nPUNTOS RESUMIDOS Y APRENDIZAJES:\n' +
                    allKnowledge.map(k => `• ${k.response}`).join('\n') + '\n';
            }
        } catch (e) { }

        const systemPrompt =
            'Eres la IA Asesora Interna y Oficial de VALLECAS RP (FiveM GTA V Roleplay) para el Equipo de Staff y Administración.\n' +
            'REGLA CRÍTICA DE INTERPRETACIÓN:\n' +
            'El moderador o staff puede escribir con faltas de ortografía, sin tildes, con jerga callejera (ej: "cerrao", "pasa si un nota", "buga", "maderos") o explicarse con dificultad. DEBES descifrar exactamente qué está queriendo preguntar en el fondo y darle la solución oficial basándote en la normativa.\n\n' +
            'TEXTO EXACTO DE LA NORMATIVA GENERAL OFICIAL (PDF):\n' +
            (exactNormativaText ? exactNormativaText : 'Normativa general vigente.') + '\n' +
            knowledgeContext +
            '\nREGLAS DE RESPUESTA:\n' +
            '1. Da la solución exacta, clara y directa (citas de artículos, cifras numéricas, sanciones y recomendaciones para el Staff).\n' +
            '2. Máximo 1 o 2 párrafos concisos y bien estructurados.\n' +
            '3. BÁSATE 100% EN LA NORMATIVA DE VALLECAS RP.\n' +
            '4. Habla en español de España de forma cercana y profesional hacia el Staff.';

        let res = null;
        let retries = 2;
        while (retries > 0) {
            try {
                res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
                } else if (res.status === 429) {
                    // Si Groq devuelve rate limit, esperar 1.2 segundos y reintentar
                    await new Promise(r => setTimeout(r, 1200));
                } else {
                    console.error('⚠️ [CONSULTAS AI Groq Error]:', res.status, await res.text());
                }
            } catch (netErr) {
                console.error('⚠️ [CONSULTAS AI Net Error]:', netErr.message);
            }
            retries--;
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

                // Detectar si el usuario quiere respuesta privada por MD usando el comando "!ai"
                const isPrivateAiCommand = message.content.toLowerCase().startsWith('!ai ');
                const questionText = isPrivateAiCommand 
                    ? message.content.slice(4).trim() 
                    : message.content.trim();

                if (questionText.length < 3) return;

                // Indicador visual de que la IA está procesando la consulta
                await message.channel.sendTyping().catch(() => {});

                // Consultar la IA
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
                        (isPrivateAiCommand 
                            ? `🔒 *Respuesta privada enviada por !ai (solo para tus ojos).*`
                            : `*(Pulsa el botón de abajo en cuanto hayas terminado de leer).*`)
                    )
                    .setThumbnail(iconUrl)
                    .setFooter({
                        text: 'VALLECAS RP • Base de Datos Oficial',
                        iconURL: iconUrl
                    })
                    .setTimestamp();

                // ----------------------------------------------------
                // MODO 1: CON COMANDO !ai (100% PRIVADO Y OCULTO A LOS DEMÁS)
                // ----------------------------------------------------
                if (isPrivateAiCommand) {
                    // Borramos su comando en el canal para que nadie vea qué preguntó
                    await message.delete().catch(() => {});

                    try {
                        // Enviamos la respuesta por privado (MD) al Staff
                        await message.author.send({
                            embeds: [embed],
                            files: logoAttachment ? [logoAttachment] : []
                        });
                    } catch (dmErr) {
                        // Si tiene los MD cerrados, avisar temporalmente
                        const notice = await message.channel.send(`⚠️ <@${message.author.id}>, tienes tus Mensajes Directos bloqueados. Habilítalos para recibir respuestas privadas de \`!ai\`.`);
                        setTimeout(() => notice.delete().catch(() => {}), 7000);
                    }
                    return;
                }

                // ----------------------------------------------------
                // MODO 2: ESCRIBIENDO NORMAL EN EL CANAL
                // ----------------------------------------------------
                // Botón interactivo para eliminar ambos mensajes (el del bot y el original del usuario)
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_cerrar_consulta_${message.author.id}_${message.id}`)
                        .setLabel('Cerrar / Borrar')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('🗑️')
                );

                const responseMsg = await message.reply({
                    embeds: [embed],
                    files: logoAttachment ? [logoAttachment] : [],
                    components: [row]
                }).catch(() => null);

                // Auto-borrado preventivo a los 90 segundos para que no queden mensajes olvidados
                if (responseMsg) {
                    setTimeout(async () => {
                        await responseMsg.delete().catch(() => {});
                        await message.delete().catch(() => {});
                    }, 90 * 1000);
                }
            }

        } catch (err) {
            console.error('⚠️ [CONSULTAS AI messageCreate Error]:', err.message);
        }
    });

    // Evento: Botón para borrar la consulta y el mensaje original del Staff
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;
            if (interaction.customId.startsWith('btn_cerrar_consulta_')) {
                const parts = interaction.customId.replace('btn_cerrar_consulta_', '').split('_');
                const targetUserId = parts[0];
                const originalMessageId = parts[1];
                
                // Solo el staff que preguntó o un administrador puede pulsar el botón
                const isAllowed = interaction.user.id === targetUserId || interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
                if (!isAllowed) {
                    return interaction.reply({
                        content: '⛔ Solo la persona que hizo esta consulta puede borrarla.',
                        ephemeral: true
                    });
                }

                // 1. Borrar el mensaje del bot
                await interaction.message.delete().catch(() => {});

                // 2. Borrar el mensaje original que escribió el Staff
                if (originalMessageId && interaction.channel) {
                    const originalMsg = await interaction.channel.messages.fetch(originalMessageId).catch(() => null);
                    if (originalMsg) {
                        await originalMsg.delete().catch(() => {});
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ [CONSULTAS AI interactionCreate Error]:', err.message);
        }
    });
}

module.exports = initConsultasAI;

