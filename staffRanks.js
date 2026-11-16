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

        // 1. Mensaje de texto exacto con menciones idéntico al formato histórico
        const textLines = batch.map(item => {
            if (item.isNewStaff) {
                return `<@${item.member.id}> *Asciendes al Equipo de Staff como <@&${item.newRank.id}>*`;
            }
            return `<@${item.member.id}> *Asciendes de <@&${item.oldRank.id}> a <@&${item.newRank.id}>*`;
        }).join('\n');

        // 2. Embed visual elegante de Vallecas RP
        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const files = [];
        let iconUrl = undefined;
        if (fs.existsSync(logoPath)) {
            const logoAtt = new AttachmentBuilder(logoPath, { name: 'logo.png' });
            files.push(logoAtt);
            iconUrl = 'attachment://logo.png';
        }

        const embedDesc = batch.map(item => {
            if (item.isNewStaff) {
                return `> 👤 <@${item.member.id}> \`(${item.member.user.tag})\`\n` +
                       `> 🎉 Incorporación: <@&${item.newRank.id}>`;
            }
            return `> 👤 <@${item.member.id}> \`(${item.member.user.tag})\`\n` +
                   `> 📈 Rango Anterior: <@&${item.oldRank.id}>\n` +
                   `> ⭐ Nuevo Rango: <@&${item.newRank.id}>`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor(0x2ECC71) // Verde esmeralda / ascenso
            .setAuthor({
                name: 'SISTEMA DE GESTIÓN DE STAFF | VALLECAS RP',
                iconURL: iconUrl
            })
            .setTitle('🎉 ¡NUEVO ASCENSO EN EL EQUIPO DE STAFF!')
            .setThumbnail(iconUrl)
            .setDescription(
                `Se ha hecho oficial el ascenso dentro del organigrama del equipo administrativo:\n\n` +
                `${embedDesc}\n\n` +
                `✨ **¡Enhorabuena por vuestro compromiso y dedicación con la comunidad!**`
            )
            .setFooter({
                text: 'VALLECAS RP • Departamento de Administración',
                iconURL: iconUrl
            })
            .setTimestamp();

        await canalAscensos.send({
            content: textLines,
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

        // 1. Mensaje de texto exacto con menciones
        const textLines = batch.map(item => 
            `<@${item.member.id}> *Desciendes de <@&${item.oldRank.id}> a <@&${item.newRank.id}>*`
        ).join('\n');

        // 2. Embed visual elegante de Vallecas RP
        const logoPath = path.join(__dirname, 'assets', 'logo.png');
        const files = [];
        let iconUrl = undefined;
        if (fs.existsSync(logoPath)) {
            const logoAtt = new AttachmentBuilder(logoPath, { name: 'logo.png' });
            files.push(logoAtt);
            iconUrl = 'attachment://logo.png';
        }

        const embedDesc = batch.map(item => 
            `> 👤 <@${item.member.id}> \`(${item.member.user.tag})\`\n` +
            `> 📉 Rango Anterior: <@&${item.oldRank.id}>\n` +
            `> 🔻 Nuevo Rango: <@&${item.newRank.id}>`
        ).join('\n\n');

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C) // Rojo / descenso
            .setAuthor({
                name: 'SISTEMA DE GESTIÓN DE STAFF | VALLECAS RP',
                iconURL: iconUrl
            })
            .setTitle('⚠️ ACTUALIZACIÓN DE RANGO ADMINISTRATIVO')
            .setThumbnail(iconUrl)
            .setDescription(
                `Se ha registrado una modificación en el organigrama del equipo administrativo:\n\n` +
                `${embedDesc}`
            )
            .setFooter({
                text: 'VALLECAS RP • Departamento de Administración',
                iconURL: iconUrl
            })
            .setTimestamp();

        await canalDescensos.send({
            content: textLines,
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

                // Rango anterior que tenía antes de este cambio (si tenía alguno)
                const prevRank = oldRanksInMember.sort((a, b) => b.level - a.level)[0];

                if (prevRank && prevRank.id !== highestAdded.id) {
                    if (highestAdded.level > prevRank.level) {
                        // === ASCENSO AUTOMÁTICO ENTRE RANGOS ===
                        console.log(`📈 [STAFF RANKS] Detectado ASCENSO para ${newMember.displayName}: Nivel ${prevRank.level} (${prevRank.name}) -> Nivel ${highestAdded.level} (${highestAdded.name})`);

                        // Evitar bucle mientras retiramos el rol antiguo
                        cooldownModifications.add(userId);
                        try {
                            // Retirar los roles antiguos de la escala que ya no correspondan
                            for (const oldR of oldRanksInMember) {
                                if (oldR.id !== highestAdded.id && newMember.roles.cache.has(oldR.id)) {
                                    await newMember.roles.remove(oldR.id, 'Auto-limpieza de rango anterior por ascenso');
                                }
                            }
                        } catch (errRole) {
                            console.warn(`⚠️ [STAFF RANKS] No se pudo retirar rol antiguo a ${newMember.displayName}:`, errRole.message);
                        } finally {
                            setTimeout(() => cooldownModifications.delete(userId), 3000);
                        }

                        // Agregar a la cola de ascensos
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

                        cooldownModifications.add(userId);
                        try {
                            // Retirar roles superiores
                            for (const oldR of oldRanksInMember) {
                                if (oldR.id !== highestAdded.id && newMember.roles.cache.has(oldR.id)) {
                                    await newMember.roles.remove(oldR.id, 'Auto-limpieza de rango anterior por descenso');
                                }
                            }
                        } catch (errRole) {
                            console.warn(`⚠️ [STAFF RANKS] No se pudo retirar rol superior a ${newMember.displayName}:`, errRole.message);
                        } finally {
                            setTimeout(() => cooldownModifications.delete(userId), 3000);
                        }

                        // Agregar a la cola de descensos
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

                    // Representamos el rango base anterior como Usuario / Sin Rango
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

    console.log('✅ [STAFF RANKS] Sistema de detección automática de ascensos/descensos activo.');
}

module.exports = initStaffRanks;

