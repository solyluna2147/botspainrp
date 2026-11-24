// ==========================================
// MÓDULO INDEPENDIENTE: SISTEMA DE VERIFICACIÓN MULTI-SERVIDOR
// ==========================================
// Comandos disponibles (Staff / Admin):
//   - !panel-verificacion / !verificacion-panel -> Publica el panel oficial de verificación con banner y botón
//   - !setverificacion <#canal o ID> <@rol o ID> -> Configura canal y rol de ciudadano en cualquier servidor
//
// Pre-configurado automáticamente para VilaCity RP:
//   - Canal: 1510417004689883357
//   - Rol Ciudadano: 1504135516788887743
//   - Banner: verificacion.png (dentro de assets/VilacityRP/ o assets/<carpeta>/)

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const guildManager = require('./guildManager');

// Defaults pre-configurados exclusivos de VilaCity RP
const VILACITY_VERIFY_CHANNEL_ID = '1510417004689883357';
const VILACITY_VERIFY_ROLE_ID = '1504135516788887743';

function getGuildVerifyConfig(guild) {
    if (!guild) return { channelId: '', roleId: '', messageId: '', verifiedCount: 0 };
    const gId = guild.id;
    const cfg = guildManager.getGuildConfig(gId);

    let channelId = cfg.CHANNEL_VERIFICACION_ID || '';
    let roleId = cfg.ROLE_VERIFICACION_ID || '';

    // Auto-detección de VilaCity RP por sus IDs reales (nunca afecta a Vallecas RP ni a otros servidores)
    const isVilacity = !guildManager.isPrimaryGuild(gId) && (
        guild.channels.cache.has(VILACITY_VERIFY_CHANNEL_ID) ||
        guild.roles.cache.has(VILACITY_VERIFY_ROLE_ID)
    );

    if (isVilacity) {
        if (!channelId) channelId = VILACITY_VERIFY_CHANNEL_ID;
        if (!roleId) roleId = VILACITY_VERIFY_ROLE_ID;
    }

    return {
        channelId,
        roleId,
        messageId: cfg.MSG_VERIFICACION_ID || '',
        verifiedCount: Number(cfg.VERIFICACION_COUNT || 0)
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

function buildVerificationEmbed(guild, roleId, verifiedCount = 0) {
    const v = guildManager.resolveGuildVisuals(guild?.id, 'verificacion');
    const serverName = v.name || guild?.name || 'SERVIDOR RP';
    const iconUrl = v.logoUrl || guild?.iconURL() || undefined;
    const gCfg = v.config || {};
    const canalNormativas = gCfg.CHANNEL_NORMATIVAS_ID ? `<#${gCfg.CHANNEL_NORMATIVAS_ID}>` : '`#normativas`';
    const canalTickets = gCfg.CHANNEL_TICKETS_ID ? `<#${gCfg.CHANNEL_TICKETS_ID}>` : '`#tickets`';
    const roleDisplay = roleId ? `<@&${roleId}>` : '`Ciudadano`';

    const embed = new EmbedBuilder()
        .setColor(v.color)
        .setAuthor({
            name: `SISTEMA DE VERIFICACIÓN | ${serverName}`,
            iconURL: iconUrl
        })
        .setThumbnail(iconUrl)
        .setTitle('🛡️ VERIFICACIÓN OFICIAL DE CIUDADANOS')
        .setDescription(
            `\u200B\n` +
            `👋 ¡Te damos la bienvenida a **${serverName}** 🇪🇸!\n\n` +
            `Para desbloquear todos los canales de la comunidad y recibir automáticamente tu rol oficial de ${roleDisplay}, completa la verificación rápida en un solo clic.\n\n` +
            `📋 **| ¿Qué debes tener en cuenta antes de verificarte?**\n` +
            `> 📜 Lee y respeta nuestra normativa oficial en ${canalNormativas} ❗\n` +
            `> 🤝 Mantén siempre el respeto hacia todos los usuarios y el equipo de Staff.\n` +
            `> 📁 Si tienes algún problema con el acceso, abre un ticket en ${canalTickets} ❗\n\n` +
            `✅ **| Pulsa el botón verde de abajo** (*"Quiero verificarme"*) para acceder al servidor al instante.\n\n` +
            `🇪🇸 **| ¡Disfruta de ${serverName}! |** 🇪🇸`
        )
        .setFooter({
            text: `${serverName} • Sistema Oficial de Verificación${verifiedCount > 0 ? ` • ${verifiedCount} verificados` : ''}`,
            iconURL: iconUrl
        })
        .setTimestamp();

    if (v.bannerUrl) {
        embed.setImage(v.bannerUrl);
    }

    return { embed, files: [...v.files] };
}

function buildVerificationRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_verificar_ciudadano')
            .setLabel('Quiero verificarme')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
    );
}

let initialized = false;

module.exports = function initVerificacion(client) {
    if (initialized) return;
    initialized = true;

    console.log('🛡️ [VERIFICACIÓN] Módulo independiente multi-servidor cargado (!panel-verificacion, !setverificacion).');

    // 1. COMANDOS DE CONFIGURACIÓN Y PUBLICACIÓN DEL PANEL
    client.on('messageCreate', async (message) => {
        try {
            if (!message.guild || message.author.bot) return;
            const raw = message.content.trim();
            if (!raw.startsWith('!')) return;

            const args = raw.split(/\s+/);
            const cmd = args[0].toLowerCase();

            // !setverificacion <#canal o ID> <@rol o ID>
            if (['!setverificacion', '!configverificacion', '!setverify'].includes(cmd)) {
                if (!isStaffOrAdmin(message.member)) return;
                await message.delete().catch(() => {});

                const rawCh = args[1]?.replace(/[<#>]/g, '').trim();
                const rawRole = args[2]?.replace(/[<@&>]/g, '').trim();
                const targetCh = message.mentions.channels.first() || (rawCh ? message.guild.channels.cache.get(rawCh) : null);
                const targetRole = message.mentions.roles.first() || (rawRole ? message.guild.roles.cache.get(rawRole) : null);

                if (!targetCh || !targetRole) {
                    const help = await message.channel.send('⚠️ **Uso:** `!setverificacion <#canal o ID_canal> <@rol o ID_rol>`\n📌 *Ejemplo:* `!setverificacion #verificacion @Ciudadano`').catch(() => null);
                    if (help) setTimeout(() => help.delete().catch(() => {}), 7000);
                    return;
                }

                await guildManager.setGuildConfigKey(message.guild.id, 'CHANNEL_VERIFICACION_ID', targetCh.id);
                await guildManager.setGuildConfigKey(message.guild.id, 'ROLE_VERIFICACION_ID', targetRole.id);

                const ok = await message.channel.send(
                    `✅ **Sistema de Verificación configurado para ${message.guild.name}:**\n` +
                    `> 📺 **Canal:** <#${targetCh.id}> (\`${targetCh.id}\`)\n` +
                    `> 🎭 **Rol Ciudadano:** <@&${targetRole.id}> (\`${targetRole.id}\`)\n\n` +
                    `💡 *Ahora ejecuta \`!panel-verificacion\` para publicar el mensaje oficial.*`
                ).catch(() => null);
                if (ok) setTimeout(() => ok.delete().catch(() => {}), 9000);
                return;
            }

            // !panel-verificacion
            if (['!panel-verificacion', '!panelverificacion', '!verificacion-panel', '!fijar-verificacion', '!panel-verify'].includes(cmd)) {
                if (!isStaffOrAdmin(message.member)) return;
                await message.delete().catch(() => {});

                const vCfg = getGuildVerifyConfig(message.guild);
                const targetChannel = vCfg.channelId
                    ? (message.guild.channels.cache.get(vCfg.channelId) || await message.guild.channels.fetch(vCfg.channelId).catch(() => null) || message.channel)
                    : message.channel;

                const { embed, files } = buildVerificationEmbed(message.guild, vCfg.roleId, vCfg.verifiedCount);
                const row = buildVerificationRow();

                const sent = await targetChannel.send({
                    embeds: [embed],
                    components: [row],
                    files
                }).catch(err => {
                    console.error('❌ [VERIFICACIÓN] Error enviando panel:', err.message);
                    return null;
                });

                if (sent) {
                    // Guardar canal, rol y ID del mensaje de verificación en este servidor
                    await guildManager.setGuildConfigKey(message.guild.id, 'CHANNEL_VERIFICACION_ID', targetChannel.id);
                    if (vCfg.roleId) {
                        await guildManager.setGuildConfigKey(message.guild.id, 'ROLE_VERIFICACION_ID', vCfg.roleId);
                    }
                    await guildManager.setGuildConfigKey(message.guild.id, 'MSG_VERIFICACION_ID', sent.id);

                    // Poner la reacción oficial del bot (Tick Verde)
                    await sent.react('✅').catch(() => {});

                    if (targetChannel.id !== message.channel.id) {
                        const info = await message.channel.send(`✅ **Panel de Verificación publicado correctamente en <#${targetChannel.id}>.**`).catch(() => null);
                        if (info) setTimeout(() => info.delete().catch(() => {}), 5000);
                    }
                    console.log(`🛡️ [VERIFICACIÓN] Panel publicado en #${targetChannel.name} (${message.guild.name}).`);
                }
                return;
            }
        } catch (err) {
            console.error('⚠️ [VERIFICACIÓN messageCreate Error]:', err.message);
        }
    });

    // 2. BOTÓN "Quiero verificarme" -> ASIGNA ROL CIUDADANO + TICK VERDE DEL BOT
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isButton()) return;
            if (interaction.customId !== 'btn_verificar_ciudadano') return;
            if (!interaction.guild || !interaction.member) return;

            const vCfg = getGuildVerifyConfig(interaction.guild);
            if (!vCfg.roleId) {
                return interaction.reply({
                    content: '⚠️ El rol de verificación aún no está configurado en este servidor. Avisa a un Administrador.',
                    ephemeral: true
                }).catch(() => {});
            }

            const member = interaction.guild.members.cache.get(interaction.user.id)
                || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

            if (!member) {
                return interaction.reply({
                    content: '❌ No se pudo cargar tu perfil en el servidor. Inténtalo de nuevo.',
                    ephemeral: true
                }).catch(() => {});
            }

            // Asegurar que el panel tiene el Tick Verde puesto únicamente por el bot
            if (interaction.message) {
                await interaction.message.react('✅').catch(() => {});
            }

            if (member.roles.cache.has(vCfg.roleId)) {
                const vAlready = guildManager.resolveGuildVisuals(interaction.guild.id);
                const alreadyIcon = vAlready.logoUrl || interaction.guild.iconURL() || undefined;
                const alreadyEmbed = new EmbedBuilder()
                    .setColor(vAlready.color)
                    .setAuthor({
                        name: `VERIFICACIÓN | ${vAlready.name}`,
                        iconURL: alreadyIcon
                    })
                    .setThumbnail(alreadyIcon)
                    .setTitle('✅ ¡Ya estás verificado!')
                    .setDescription(
                        `👋 Hola <@${interaction.user.id}>, ya cuentas con el rol oficial <@&${vCfg.roleId}> y acceso completo a **${vAlready.name}**.\n\n` +
                        `> 🏙️ *Disfruta de la comunidad.*`
                    )
                    .setFooter({
                        text: `${vAlready.name} • Este mensaje se auto-eliminará en 5s`,
                        iconURL: alreadyIcon
                    })
                    .setTimestamp();

                await interaction.reply({
                    embeds: [alreadyEmbed],
                    files: vAlready.files,
                    ephemeral: true
                }).catch(() => {});
                setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                return;
            }

            // Asignar rol de Ciudadano
            try {
                await member.roles.add(vCfg.roleId, 'Verificación oficial mediante botón');
            } catch (roleErr) {
                console.error('❌ [VERIFICACIÓN] Error asignando rol:', roleErr.message);
                await interaction.reply({
                    content: '❌ No tengo permisos suficientes para asignarte el rol. Asegúrate de que mi rol está por encima del rol de Ciudadano.',
                    ephemeral: true
                }).catch(() => {});
                setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
                return;
            }

            // Incrementar contador de verificados de este servidor y actualizar footer del panel
            const newCount = (vCfg.verifiedCount || 0) + 1;
            await guildManager.setGuildConfigKey(interaction.guild.id, 'VERIFICACION_COUNT', newCount).catch(() => {});

            if (interaction.message) {
                try {
                    const { embed: updatedEmbed } = buildVerificationEmbed(interaction.guild, vCfg.roleId, newCount);
                    await interaction.message.edit({
                        embeds: [updatedEmbed],
                        components: [buildVerificationRow()]
                    }).catch(() => {});
                    await interaction.message.react('✅').catch(() => {});
                } catch (e) { }
            }

            const v = guildManager.resolveGuildVisuals(interaction.guild.id);
            const okIcon = v.logoUrl || interaction.guild.iconURL() || undefined;
            const okEmbed = new EmbedBuilder()
                .setColor(v.color)
                .setAuthor({
                    name: `VERIFICACIÓN COMPLETADA | ${v.name}`,
                    iconURL: okIcon
                })
                .setThumbnail(okIcon)
                .setTitle('🎉 ¡Verificación completada con éxito!')
                .setDescription(
                    `👋 ¡Bienvenido/a <@${interaction.user.id}>!\n\n` +
                    `> 🎭 **Rol asignado:** <@&${vCfg.roleId}>\n` +
                    `> 🏙️ **Acceso:** ¡Ya tienes acceso completo a **${v.name}**! Disfruta de la comunidad.`
                )
                .setFooter({
                    text: `${v.name} • Este mensaje se auto-eliminará en 5s`,
                    iconURL: okIcon
                })
                .setTimestamp();

            await interaction.reply({
                embeds: [okEmbed],
                files: v.files,
                ephemeral: true
            }).catch(() => {});
            setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
            return;
        } catch (err) {
            console.error('⚠️ [VERIFICACIÓN interactionCreate Error]:', err.message);
        }
    });

    // 3. PROTECCIÓN DE REACCIONES: SOLO EL BOT PUEDE REACCIONAR EN EL MENSAJE DE VERIFICACIÓN
    // Si cualquier usuario reacciona con cualquier emoji, el bot borra su reacción al instante.
    client.on('messageReactionAdd', async (reaction, user) => {
        try {
            if (!user || user.bot) return;

            if (reaction.partial) {
                await reaction.fetch().catch(() => null);
            }
            const msg = reaction.message;
            if (!msg || !msg.guild) return;

            const vCfg = getGuildVerifyConfig(msg.guild);
            const isVerifyMessage = (vCfg.messageId && msg.id === vCfg.messageId)
                || (vCfg.channelId && msg.channel.id === vCfg.channelId && msg.author?.id === client.user?.id);

            if (!isVerifyMessage) return;

            // Eliminar inmediatamente la reacción puesta por el usuario
            await reaction.users.remove(user.id).catch(() => {});
        } catch (err) { }
    });
};
