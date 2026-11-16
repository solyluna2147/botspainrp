const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');

// Canales configurados
const CANAL_ASCENSOS_ID = '1563955554588561499';  // 【📈】ᴀꜱᴄᴇɴꜱᴏꜱ
const CANAL_DESCENSOS_ID = '1569698056826265831'; // 【📉】𝑑𝑒𝑠𝑐𝑒𝑛𝑠𝑜𝑠

// Jerarquía estricta de Rangos de Staff (Nivel 1 al Nivel 11)
const STAFF_RANKS = [
    { level: 1,  id: '1538216635326931107', name: '🔎┃Soporte Prueba' },
    { level: 2,  id: '1538216842374549525', name: '➕┃Soporte Plus' },
    { level: 3,  id: '1538216732316016771', name: '📡┃Soporte Técnico' },
    { level: 4,  id: '1538216283370422365', name: '🍋┃Moderador en Pruebas' },
    { level: 5,  id: '1538216547816968324', name: '🍊┃Moderador Junior' },
    { level: 6,  id: '1538216093544349696', name: '🔰┃Moderador' },
    { level: 7,  id: '1538216430233854013', name: '🧀┃Moderador Experto' },
    { level: 8,  id: '1538217498631999538', name: '🍭┃Administrador en Pruebas' },
    { level: 9,  id: '1538217598578204682', name: '🍓┃Administrador Junior' },
    { level: 10, id: '1538217739485716480', name: '⚡┃Administrador' },
    { level: 11, id: '1538217844087595079', name: '⭐┃Jefe Administracion' }
];

// Mapa rápido por ID para búsquedas instantáneas O(1)
const STAFF_RANK_MAP = new Map(STAFF_RANKS.map(r => [r.id, r]));

// Cola de eventos (buffer) para agrupar múltiples cambios seguidos
// Permite que si subes a 3 o 4 staffs seguidos, se publiquen juntos de forma bonita
let ascensosQueue = [];
let descensosQueue = [];
let batchTimeoutAscensos = null;
let batchTimeoutDescensos = null;

// Bloqueo temporal por usuario para evitar bucles cuando el bot retira el rol antiguo
const cooldownModifications = new Set();

/**
 * Obtiene el rango más alto de un miembro dentro de la jerarquía STAFF_RANKS
 */
function getMemberStaffRank(member) {
    if (!member || !member.roles) return null;
    let highestRank = null;
    for (const rank of STAFF_RANKS) {
        if (member.roles.cache.has(rank.id)) {
            if (!highestRank || rank.level > highestRank.level) {
                highestRank = rank;
            }
        }
    }
    return highestRank;
}

/**
 * Envía el lote acumulado de ascensos al canal oficial
 */
async function flushAscensosBatch(client) {
    if (ascensosQueue.length === 0) return;
    const batch = [...ascensosQueue];
    ascensosQueue = [];
    batchTimeoutAscensos = null;

    try {
        const canalAscensos = await client.channels.fetch(CANAL_ASCENSOS_ID).catch(() => null);
        if (!canalAscensos) {
            console.error(`❌ [STAFF RANKS] No se encontró el canal de ascensos (${CANAL_ASCENSOS_ID})`);
            return;
        }

        // Menciones ping arriba para que a los staffs les llegue la notificación
        const pingMentions = batch.map(item => `<@${item.member.id}>`).join(' ');

        // Formato idéntico al estilo histórico de Deivizz dentro del Embed
        const embedDescLines = batch.map(item => {
            if (item.isNewStaff) {
                return `> <@${item.member.id}> *Asciendes al Equipo de Staff como <@&${item.newRank.id}>*`;
            }
            return `> <@${item.member.id}> *Asciendes de <@&${item.oldRank.id}> a <@&${item.newRank.id}>*`;
        }).join('\n');

        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const files = [];
        let iconUrl = undefined;
        if (fs.existsSync(logoPath)) {
            const logoAtt = new AttachmentBuilder(logoPath, { name: 'logo.png' });
            files.push(logoAtt);
            iconUrl = 'attachment://logo.png';
        }

        const embed = new EmbedBuilder()
            .setColor(0xE67E22) // Tono dorado / naranja premium oficial de Vallecas RP
            .setAuthor({
                name: 'SISTEMA DE ADMINISTRACIÓN | VALLECAS RP',
                iconURL: iconUrl
            })
            .setTitle('📈 ¡NUEVO ASCENSO EN EL EQUIPO DE STAFF!')
            .setThumbnail(iconUrl)
            .setDescription(
                `\u200B\n` +
                `${embedDescLines}\n\n` +
                `✨ **¡Enhorabuena por vuestro ascenso y gracias por vuestro compromiso!**`
            )
            .setFooter({
                text: 'VALLECAS RP • Departamento de Administración',
                iconURL: iconUrl
            })
            .setTimestamp();

        await canalAscensos.send({
            content: pingMentions,
            embeds: [embed],
            files: files
        });

        console.log(`✅ [STAFF RANKS] Publicado lote de ${batch.length} ascenso(s) en ${canalAscensos.name}.`);
    } catch (err) {
        console.error('❌ [STAFF RANKS] Error enviando lote de ascensos:', err);
    }
}

/**
 * Envía el lote acumulado de descensos al canal oficial
 */
async function flushDescensosBatch(client) {
    if (descensosQueue.length === 0) return;
    const batch = [...descensosQueue];
    descensosQueue = [];
    batchTimeoutDescensos = null;

    try {
        const canalDescensos = await client.channels.fetch(CANAL_DESCENSOS_ID).catch(() => null);
        if (!canalDescensos) {
            console.error(`❌ [STAFF RANKS] No se encontró el canal de descensos (${CANAL_DESCENSOS_ID})`);
            return;
        }

        const pingMentions = batch.map(item => `<@${item.member.id}>`).join(' ');

        // Formato estilo Deivizz dentro del embed
        const embedDescLines = batch.map(item => 
            `> <@${item.member.id}> *Desciendes de <@&${item.oldRank.id}> a <@&${item.newRank.id}>*`
        ).join('\n');

        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const files = [];
        let iconUrl = undefined;
        if (fs.existsSync(logoPath)) {
            const logoAtt = new AttachmentBuilder(logoPath, { name: 'logo.png' });
            files.push(logoAtt);
            iconUrl = 'attachment://logo.png';
        }

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C) // Rojo advertencia / descenso
            .setAuthor({
                name: 'SISTEMA DE ADMINISTRACIÓN | VALLECAS RP',
                iconURL: iconUrl
            })
            .setTitle('📉 ACTUALIZACIÓN DE RANGO EN EL EQUIPO DE STAFF')
            .setThumbnail(iconUrl)
            .setDescription(
                `\u200B\n` +
                `${embedDescLines}\n\n` +
                `⚖️ **Modificación oficial en el organigrama del equipo de staff.**`
            )
            .setFooter({
                text: 'VALLECAS RP • Departamento de Administración',
                iconURL: iconUrl
            })
            .setTimestamp();

        await canalDescensos.send({
            content: pingMentions,
            embeds: [embed],
            files: files
        });

        console.log(`✅ [STAFF RANKS] Publicado lote de ${batch.length} descenso(s) en ${canalDescensos.name}.`);
    } catch (err) {
        console.error('❌ [STAFF RANKS] Error enviando lote de descensos:', err);
    }
}

/**
 * Inicializador del sistema automático de rangos
 */
function initStaffRanks(client) {
    console.log('🛡️ [STAFF RANKS] Inicializando detector automático de ascensos y descensos...');

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            if (newMember.user.bot) return;

            const userId = newMember.id;
            if (cooldownModifications.has(userId)) return;

            // Verificar si hubo algún cambio en los roles de STAFF_RANKS
            const oldRanksInMember = STAFF_RANKS.filter(r => oldMember.roles.cache.has(r.id));
            const newRanksInMember = STAFF_RANKS.filter(r => newMember.roles.cache.has(r.id));

            // Roles agregados y roles retirados dentro del árbol de staff
            const addedRankRoles = newRanksInMember.filter(r => !oldMember.roles.cache.has(r.id));
            const removedRankRoles = oldRanksInMember.filter(r => !newMember.roles.cache.has(r.id));

            // Si no se tocó ningún rol de la jerarquía de staff, ignorar el evento
            if (addedRankRoles.length === 0 && removedRankRoles.length === 0) return;

            // Caso A: Se le ha asignado un nuevo rol de staff
            if (addedRankRoles.length > 0) {
                // El rol nuevo de mayor nivel agregado
                const highestAdded = addedRankRoles.sort((a, b) => b.level - a.level)[0];

                // Rango anterior que tenía antes de este cambio (el más alto que tenía)
                const prevRank = oldRanksInMember.sort((a, b) => b.level - a.level)[0];

                if (prevRank && prevRank.id !== highestAdded.id) {
                    if (highestAdded.level > prevRank.level) {
                        // === ASCENSO AUTOMÁTICO ENTRE RANGOS ===
                        console.log(`📈 [STAFF RANKS] Detectado ASCENSO para ${newMember.displayName}: Nivel ${prevRank.level} (${prevRank.name}) -> Nivel ${highestAdded.level} (${highestAdded.name})`);

                        // El bot NO elimina ningún rol, solo detecta y publica
                        ascensosQueue.push({
                            member: newMember,
                            oldRank: prevRank,
                            newRank: highestAdded
                        });

                        if (batchTimeoutAscensos) clearTimeout(batchTimeoutAscensos);
                        batchTimeoutAscensos = setTimeout(() => flushAscensosBatch(client), 3500);

                    } else if (highestAdded.level < prevRank.level) {
                        // === DESCENSO AUTOMÁTICO (al darle un rol inferior) ===
                        console.log(`📉 [STAFF RANKS] Detectado DESCENSO para ${newMember.displayName}: Nivel ${prevRank.level} (${prevRank.name}) -> Nivel ${highestAdded.level} (${highestAdded.name})`);

                        // El bot NO elimina ningún rol, solo detecta y publica
                        descensosQueue.push({
                            member: newMember,
                            oldRank: prevRank,
                            newRank: highestAdded
                        });

                        if (batchTimeoutDescensos) clearTimeout(batchTimeoutDescensos);
                        batchTimeoutDescensos = setTimeout(() => flushDescensosBatch(client), 3500);
                    }
                } else if (!prevRank) {
                    // === NUEVA ENTRADA AL EQUIPO DE STAFF (Ascenso inicial / Incorporación) ===
                    console.log(`🎉 [STAFF RANKS] Detectada NUEVA INCORPORACIÓN / ASCENSO para ${newMember.displayName} a ${highestAdded.name}`);

                    const userBaseRank = {
                        id: 'USER',
                        name: 'Usuario / Ciudadano',
                        level: 0
                    };

                    ascensosQueue.push({
                        member: newMember,
                        oldRank: userBaseRank,
                        newRank: highestAdded,
                        isNewStaff: true
                    });

                    if (batchTimeoutAscensos) clearTimeout(batchTimeoutAscensos);
                    batchTimeoutAscensos = setTimeout(() => flushAscensosBatch(client), 3500);
                }
            } 
            // Caso B: Se le retiró un rol de staff sin agregarle uno nuevo directamente
            // (Ejemplo: Le quitas 'Moderador' y se queda con 'Moderador Junior' que ya tenía de fondo)
            else if (removedRankRoles.length > 0 && newRanksInMember.length > 0) {
                const highestRemoved = removedRankRoles.sort((a, b) => b.level - a.level)[0];
                const currentRemaining = newRanksInMember.sort((a, b) => b.level - a.level)[0];

                if (currentRemaining.level < highestRemoved.level) {
                    console.log(`📉 [STAFF RANKS] Detectado DESCENSO por retiro de rol para ${newMember.displayName}: Nivel ${highestRemoved.level} (${highestRemoved.name}) -> Nivel ${currentRemaining.level} (${currentRemaining.name})`);

                    descensosQueue.push({
                        member: newMember,
                        oldRank: highestRemoved,
                        newRank: currentRemaining
                    });

                    if (batchTimeoutDescensos) clearTimeout(batchTimeoutDescensos);
                    batchTimeoutDescensos = setTimeout(() => flushDescensosBatch(client), 3500);
                }
            }
        } catch (err) {
            console.error('❌ [STAFF RANKS] Error procesando guildMemberUpdate:', err);
        }
    });

    // Comando rápido para comprobar en Discord si el sistema está activo: !staff-estado o !staff-test
    client.on('messageCreate', async (message) => {
        if (!message.guild || message.author.bot) return;
        const text = message.content.trim().toLowerCase();
        if (text === '!staff-estado' || text === '!staff-test' || text === '!ascensos-estado') {
            const cAsc = message.guild.channels.cache.get(CANAL_ASCENSOS_ID);
            const cDesc = message.guild.channels.cache.get(CANAL_DESCENSOS_ID);
            return message.reply({
                content: `🛡️ **Sistema Automático de Ascensos y Descensos | VALLECAS RP**\n` +
                         `> 🟢 **Estado:** ACTIVO y escuchando cambios de roles en tiempo real.\n` +
                         `> 📈 **Canal Ascensos:** ${cAsc ? `<#${cAsc.id}>` : '❌ No encontrado'}\n` +
                         `> 📉 **Canal Descensos:** ${cDesc ? `<#${cDesc.id}>` : '❌ No encontrado'}\n` +
                         `> 📊 **Rangos Monitoreados:** 11 niveles de Staff.\n\n` +
                         `*Para probarlo, añade o cambia un rol de staff a cualquier miembro en Discord y el bot lo publicará automáticamente.*`
            }).catch(() => {});
        }
    });

    console.log('✅ [STAFF RANKS] Sistema de detección automática de ascensos/descensos activo.');
}

module.exports = initStaffRanks;

