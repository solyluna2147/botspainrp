const { EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const path = require('path');
const fs = require('fs');
const guildManager = require('./guildManager');

// Canales configurados por defecto (Vallecas RP - servidor principal intacto)
const DEFAULT_CANAL_ASCENSOS_ID = '1563955554588561499';  // 【📈】ᴀꜱᴄᴇɴꜱᴏꜱ
const DEFAULT_CANAL_DESCENSOS_ID = '1569698056826265831'; // 【📉】𝑑𝑒𝑠𝑐𝑒𝑛𝑠𝑜𝑠

// Jerarquía estricta de Rangos de Staff (Vallecas RP - Nivel 1 al Nivel 11)
const DEFAULT_STAFF_RANKS = [
    { level: 1, id: '1538216635326931107', name: '🔎┃Soporte Prueba' },
    { level: 2, id: '1538216842374549525', name: '➕┃Soporte Plus' },
    { level: 3, id: '1538216732316016771', name: '📡┃Soporte Técnico' },
    { level: 4, id: '1538216283370422365', name: '🍋┃Moderador en Pruebas' },
    { level: 5, id: '1538216547816968324', name: '🍊┃Moderador Junior' },
    { level: 6, id: '1538216093544349696', name: '🔰┃Moderador' },
    { level: 7, id: '1538216430233854013', name: '🧀┃Moderador Experto' },
    { level: 8, id: '1538217498631999538', name: '🍭┃Administrador en Pruebas' },
    { level: 9, id: '1538217598578204682', name: '🍓┃Administrador Junior' },
    { level: 10, id: '1538217739485716480', name: '⚡┃Administrador' },
    { level: 11, id: '1538217844087595079', name: '⭐┃Jefe Administracion' }
];

// Jerarquía estricta de Rangos de Staff (VilaCity RP - Nivel 1 al Nivel 17)
// Nota: ⚡EQUIPO DE STAFF⚡ (1506768698143408319) es el rol base principal de Staff, no un escalón de ascenso/descenso.
const VILACITY_STAFF_RANKS = [
    { level: 1, id: '1506768955157643355', name: '⭐SOPORTE EN PRUEBAS⭐' },
    { level: 2, id: '1506769474345242754', name: '⭐SOPORTE⭐' },
    { level: 3, id: '1506769426932826302', name: '⭐SOPORTE +⭐' },
    { level: 4, id: '1506769625726062753', name: '⭐JEFE DE SOPORTES⭐' },
    { level: 5, id: '1504135462883823746', name: '🔧MODERADOR EN PRUEBAS🔧' },
    { level: 6, id: '1506771317402370109', name: '🔧MODERADOR🔧' },
    { level: 7, id: '1506769670164713643', name: '🔧MODERADOR +🔧' },
    { level: 8, id: '1506779563626201258', name: '🔧JEFE DE MODERADORES🔧' },
    { level: 9, id: '1506770235061964991', name: '🔨ADMINISTRADOR EN PRUEBAS🔨' },
    { level: 10, id: '1504135461994758287', name: '🔨ADMINISTRADOR🔨' },
    { level: 11, id: '1506770414490222693', name: '🔨ADMINISTRADOR +🔨' },
    { level: 12, id: '1504135460430286848', name: '👾GAME MASTER👾' },
    { level: 13, id: '1504135459666923650', name: '🏆STAFF DE LA SEMANA🏆' },
    { level: 14, id: '1506770461327884490', name: '🌳HEAD ADMINISTRATIVA🌳' },
    { level: 15, id: '1506770515958829206', name: '🔮CUPULA ADMINISTRATIVA🔮' },
    { level: 16, id: '1504135456177258676', name: '🌸SUB-DIRECTIVA DE STAFF🌸' },
    { level: 17, id: '1504135455040344134', name: '👑DIRECTOR STAFF👑' }
];

// Colas aisladas por servidor (guildId -> array / timeout)
const ascensosQueues = new Map();
const descensosQueues = new Map();
const batchTimeoutsAscensos = new Map();
const batchTimeoutsDescensos = new Map();

// Bloqueo temporal por usuario para evitar bucles
const cooldownModifications = new Set();

function getGuildRanksConfig(guildId, guild = null) {
    if (!guildId || guildManager.isPrimaryGuild(guildId)) {
        return {
            ascensosChannelId: DEFAULT_CANAL_ASCENSOS_ID,
            descensosChannelId: DEFAULT_CANAL_DESCENSOS_ID,
            ranks: DEFAULT_STAFF_RANKS
        };
    }
    const cfg = guildManager.getGuildConfig(guildId);
    let ranks = Array.isArray(cfg.STAFF_RANKS_LIST) && cfg.STAFF_RANKS_LIST.length > 0
        ? cfg.STAFF_RANKS_LIST.filter(r => r && r.id && r.level).sort((a, b) => a.level - b.level)
        : [];

    // Auto-detección de la jerarquía oficial de VilaCity RP por sus roles reales
    if (ranks.length === 0 && guild && (
        guild.roles.cache.has('1506768698143408319') ||
        guild.roles.cache.has('1506768955157643355')
    )) {
        ranks = VILACITY_STAFF_RANKS;
    }

    return {
        ascensosChannelId: cfg.CHANNEL_ASCENSOS_ID || '',
        descensosChannelId: cfg.CHANNEL_DESCENSOS_ID || '',
        ranks
    };
}

function isStaffOrAdmin(member) {
    if (!member || member.user?.bot) return false;
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId);
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? '1538191116610838691' : '');
    if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

async function flushAscensosBatch(client, guildId) {
    const queue = ascensosQueues.get(guildId) || [];
    if (queue.length === 0) return;
    const batch = [...queue];
    ascensosQueues.set(guildId, []);
    batchTimeoutsAscensos.delete(guildId);

    try {
        const { ascensosChannelId, ranks } = getGuildRanksConfig(guildId);
        if (!ascensosChannelId) return;

        const canalAscensos = await client.channels.fetch(ascensosChannelId).catch(() => null);
        if (!canalAscensos) {
            console.error(`❌ [STAFF RANKS] No se encontró el canal de ascensos (${ascensosChannelId}) en guild ${guildId}`);
            return;
        }

        const firstRankId = ranks[0]?.id || '1538216635326931107';
        const embedDescLines = batch.map(item => {
            const oldRankId = item.oldRank ? item.oldRank.id : null;
            if (oldRankId && oldRankId !== 'USER') {
                return `<@${item.member.id}> *Asciendes de* <@&${oldRankId}> *a* <@&${item.newRank.id}>`;
            }
            if (guildManager.isPrimaryGuild(guildId)) {
                return `<@${item.member.id}> *Asciendes de* <@&${firstRankId}> *a* <@&${item.newRank.id}>`;
            }
            return `<@${item.member.id}> *Asciendes a* <@&${item.newRank.id}>`;
        }).join('\n');

        const v = guildManager.resolveGuildVisuals(guildId);
        const files = [...v.files];
        const iconUrl = v.logoUrl || undefined;

        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setAuthor({
                name: `SISTEMA DE ADMINISTRACIÓN | ${v.name}`,
                iconURL: iconUrl
            })
            .setDescription(embedDescLines);

        await canalAscensos.send({ embeds: [embed], files });
        guildManager.logGuild(guildId, '📈', `Ascenso publicado en #${canalAscensos.name} (${batch.length} miembro/s)`);
    } catch (err) {
        console.error('❌ [STAFF RANKS] Error enviando lote de ascensos:', err);
    }
}

async function flushDescensosBatch(client, guildId) {
    const queue = descensosQueues.get(guildId) || [];
    if (queue.length === 0) return;
    const batch = [...queue];
    descensosQueues.set(guildId, []);
    batchTimeoutsDescensos.delete(guildId);

    try {
        const { descensosChannelId } = getGuildRanksConfig(guildId);
        if (!descensosChannelId) return;

        const canalDescensos = await client.channels.fetch(descensosChannelId).catch(() => null);
        if (!canalDescensos) {
            console.error(`❌ [STAFF RANKS] No se encontró el canal de descensos (${descensosChannelId}) en guild ${guildId}`);
            return;
        }

        const embedDescLines = batch.map(item =>
            `<@${item.member.id}> *Desciendes de* <@&${item.oldRank.id}> *a* <@&${item.newRank.id}>`
        ).join('\n');

        const v = guildManager.resolveGuildVisuals(guildId);
        const files = [...v.files];
        const iconUrl = v.logoUrl || undefined;

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setAuthor({
                name: `SISTEMA DE ADMINISTRACIÓN | ${v.name}`,
                iconURL: iconUrl
            })
            .setDescription(embedDescLines);

        await canalDescensos.send({ embeds: [embed], files });
        guildManager.logGuild(guildId, '📉', `Descenso publicado en #${canalDescensos.name} (${batch.length} miembro/s)`);
    } catch (err) {
        console.error('❌ [STAFF RANKS] Error enviando lote de descensos:', err);
    }
}

function initStaffRanks(client) {
    console.log('🛡️ [STAFF RANKS] Inicializando detector automático de ascensos y descensos multi-servidor...');

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            if (!newMember || !newMember.guild || newMember.user.bot) return;

            const guildId = newMember.guild.id;
            const { ranks } = getGuildRanksConfig(guildId, newMember.guild);
            if (!ranks || ranks.length === 0) return;

            const userKey = `${guildId}:${newMember.id}`;
            if (cooldownModifications.has(userKey)) return;

            const oldRanksInMember = ranks.filter(r => oldMember.roles.cache.has(r.id));
            const newRanksInMember = ranks.filter(r => newMember.roles.cache.has(r.id));

            const addedRankRoles = newRanksInMember.filter(r => !oldMember.roles.cache.has(r.id));
            const removedRankRoles = oldRanksInMember.filter(r => !newMember.roles.cache.has(r.id));

            if (addedRankRoles.length === 0 && removedRankRoles.length === 0) return;

            const enqueueAscenso = (item) => {
                const q = ascensosQueues.get(guildId) || [];
                q.push(item);
                ascensosQueues.set(guildId, q);
                if (batchTimeoutsAscensos.has(guildId)) clearTimeout(batchTimeoutsAscensos.get(guildId));
                batchTimeoutsAscensos.set(guildId, setTimeout(() => flushAscensosBatch(client, guildId), 800));
            };

            const enqueueDescenso = (item) => {
                const q = descensosQueues.get(guildId) || [];
                q.push(item);
                descensosQueues.set(guildId, q);
                if (batchTimeoutsDescensos.has(guildId)) clearTimeout(batchTimeoutsDescensos.get(guildId));
                batchTimeoutsDescensos.set(guildId, setTimeout(() => flushDescensosBatch(client, guildId), 800));
            };

            if (addedRankRoles.length > 0) {
                const highestAdded = addedRankRoles.sort((a, b) => b.level - a.level)[0];
                const prevRank = oldRanksInMember.sort((a, b) => b.level - a.level)[0];

                if (prevRank && prevRank.id !== highestAdded.id) {
                    if (highestAdded.level > prevRank.level) {
                        enqueueAscenso({ member: newMember, oldRank: prevRank, newRank: highestAdded });
                    } else if (highestAdded.level < prevRank.level) {
                        enqueueDescenso({ member: newMember, oldRank: prevRank, newRank: highestAdded });
                    }
                } else if (!prevRank) {
                    enqueueAscenso({
                        member: newMember,
                        oldRank: { id: 'USER', name: 'Usuario / Ciudadano', level: 0 },
                        newRank: highestAdded,
                        isNewStaff: true
                    });
                }
            } else if (removedRankRoles.length > 0 && newRanksInMember.length > 0) {
                const highestRemoved = removedRankRoles.sort((a, b) => b.level - a.level)[0];
                const currentRemaining = newRanksInMember.sort((a, b) => b.level - a.level)[0];

                if (currentRemaining.level < highestRemoved.level) {
                    enqueueDescenso({ member: newMember, oldRank: highestRemoved, newRank: currentRemaining });
                }
            }
        } catch (err) {
            console.error('❌ [STAFF RANKS] Error procesando guildMemberUpdate:', err);
        }
    });

    client.on('messageCreate', async (message) => {
        if (!message.guild || message.author.bot) return;
        const gId = message.guild.id;
        const raw = message.content.trim();
        const args = raw.split(/\s+/);
        const cmd = args[0]?.toLowerCase();

        if (['!staff-estado', '!staff-test', '!ascensos-estado', '!verrangos'].includes(cmd)) {
            const { ascensosChannelId, descensosChannelId, ranks } = getGuildRanksConfig(gId, message.guild);
            const v = guildManager.resolveGuildVisuals(gId);
            const cAsc = ascensosChannelId ? message.guild.channels.cache.get(ascensosChannelId) : null;
            const cDesc = descensosChannelId ? message.guild.channels.cache.get(descensosChannelId) : null;
            const ranksPreview = ranks.length > 0
                ? ranks.map(r => `> \`Nivel ${r.level}\` → <@&${r.id}>`).join('\n')
                : '> *Aún no has añadido rangos. Usa `!addrango <nivel> <@rol o ID>`*';

            return message.reply({
                content: `🛡️ **Sistema Automático de Ascensos y Descensos | ${v.name}**\n` +
                    `> 🟢 **Estado:** ACTIVO y escuchando cambios de roles en tiempo real.\n` +
                    `> 📈 **Canal Ascensos:** ${cAsc ? `<#${cAsc.id}>` : '❌ No configurado (`!setascensos #canal`)'}\n` +
                    `> 📉 **Canal Descensos:** ${cDesc ? `<#${cDesc.id}>` : '❌ No configurado (`!setdescensos #canal`)'}\n` +
                    `> 📊 **Rangos Monitoreados (${ranks.length}):**\n${ranksPreview}`
            }).catch(() => { });
        }

        if (['!setascensos', '!setdescensos'].includes(cmd)) {
            if (!isStaffOrAdmin(message.member)) return;
            const targetCh = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]?.replace(/[<#>]/g, '')) || message.channel;
            const key = cmd === '!setascensos' ? 'CHANNEL_ASCENSOS_ID' : 'CHANNEL_DESCENSOS_ID';
            await guildManager.updateGuildConfig(gId, key, targetCh.id, message.guild.name);
            return message.reply(`✅ Canal de **${cmd === '!setascensos' ? 'Ascensos' : 'Descensos'}** configurado en <#${targetCh.id}> para **${message.guild.name}**.`).catch(() => { });
        }

        if (['!addrango', '!setrango'].includes(cmd)) {
            if (!isStaffOrAdmin(message.member)) return;
            const level = parseInt(args[1], 10);
            const rawRoleId = args[2]?.replace(/[<@&>]/g, '').trim();
            const role = message.mentions.roles.first() || (rawRoleId ? message.guild.roles.cache.get(rawRoleId) : null);
            if (!level || level < 1 || !role) {
                return message.reply('⚠️ **Uso:** `!addrango <nivel_1_a_20> <@rol o ID_rol>`\n📌 *Ejemplo:* `!addrango 1 @Soporte`').catch(() => { });
            }
            const cfg = guildManager.getGuildConfig(gId);
            const current = Array.isArray(cfg.STAFF_RANKS_LIST) ? [...cfg.STAFF_RANKS_LIST] : [];
            const filtered = current.filter(r => r.level !== level && r.id !== role.id);
            filtered.push({ level, id: role.id, name: role.name });
            filtered.sort((a, b) => a.level - b.level);
            await guildManager.updateGuildConfig(gId, 'STAFF_RANKS_LIST', filtered, message.guild.name);
            return message.reply(`✅ Rango **Nivel ${level}** → <@&${role.id}> guardado en **${message.guild.name}** (${filtered.length} rangos en total).`).catch(() => { });
        }

        if (cmd === '!delrango') {
            if (!isStaffOrAdmin(message.member)) return;
            const target = args[1]?.replace(/[<@&>]/g, '').trim();
            if (!target) return message.reply('⚠️ **Uso:** `!delrango <nivel o ID_rol>`').catch(() => { });
            const cfg = guildManager.getGuildConfig(gId);
            const current = Array.isArray(cfg.STAFF_RANKS_LIST) ? [...cfg.STAFF_RANKS_LIST] : [];
            const filtered = current.filter(r => String(r.level) !== target && r.id !== target);
            await guildManager.updateGuildConfig(gId, 'STAFF_RANKS_LIST', filtered, message.guild.name);
            return message.reply(`🗑️ Rango \`${target}\` eliminado de **${message.guild.name}** (${filtered.length} restantes).`).catch(() => { });
        }
    });

    console.log('✅ [STAFF RANKS] Sistema de detección automática de ascensos/descensos activo.');
}

module.exports = initStaffRanks;
