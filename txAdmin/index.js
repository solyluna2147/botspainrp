// ============================================================================
// MÓDULO INDEPENDIENTE: CENTRO DE CONTROL INTERACTIVO TXADMIN + IA
// ============================================================================
// Comandos disponibles:
//   - !panel-txadmin             : Publica el panel interactivo permanente para Staff
//   - !panel-txowner             : (Solo Creador) Publica el panel maestro permanente del Creador
//   - !panel-txadmintest         : (Solo Creador) Panel de TESTEO Staff con datos simulados en vivo
//   - !panel-txownertest         : (Solo Creador) Panel de TESTEO Creador con datos simulados en vivo
//   - !tx-setup                  : (Solo Creador) Genera/muestra token del puente y plantilla .env
//   - !tx-logs [#canal | off]    : Configura el canal de auditoría de acciones txAdmin

const crypto = require('crypto');
const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const guildManager = require('../guildManager');
const bridgeHub = require('./bridgeHub');
const txAiEngine = require('./txAiEngine');
const panels = require('./txPanels');
const demoSandbox = require('./txDemoSandbox');

const PRIMARY_STAFF_ROLE_ID = '1538191116610838691';
const OWNER_IDS = new Set(['418558256840179722', '1308814761269395527']);

// Confirmaciones humanas pendientes (confirmId -> { guildId, userId, userTag, bridgeAction, params, txUsername, isDemo, expiresAt })
const pendingConfirmations = new Map();

// Autoeliminación inteligente de respuestas efímeras (se reinicia cada vez que el Staff navega en el mismo mensaje)
const TX_EPHEMERAL_TTL_MS = 120 * 1000;
const ephemeralDeleteTimers = new Map();

function scheduleAutoDelete(interaction) {
    if (!interaction) return;
    const key = interaction.message?.flags?.has?.(64)
        ? `msg:${interaction.message.id}`
        : `int:${interaction.id}`;
    if (ephemeralDeleteTimers.has(key)) {
        clearTimeout(ephemeralDeleteTimers.get(key));
    }
    const timer = setTimeout(() => {
        ephemeralDeleteTimers.delete(key);
        interaction.deleteReply().catch(() => {});
    }, TX_EPHEMERAL_TTL_MS);
    ephemeralDeleteTimers.set(key, timer);
}

// Resetea visualmente los desplegables de los paneles permanentes para que no queden preseleccionados tras usarlos 1 vez
function resetPermanentSelectMenu(interaction, isDemo = false, isOwnerPanel = false) {
    try {
        const msg = interaction.message;
        if (!msg || !msg.editable) return;
        const gId = interaction.guild?.id;
        const status = isDemo
            ? demoSandbox.getDemoBridgeStatus(gId, interaction.user)
            : bridgeHub.getBridgeStatus(gId);
        const fresh = isOwnerPanel
            ? panels.buildOwnerPermanentPanelPayload(interaction.guild, status, { includeFiles: false })
            : panels.buildMainPanelPayload(interaction.guild, status, { includeFiles: false });
        const decorated = decorateForDemo(fresh, isDemo);
        msg.edit({ components: decorated.components }).catch(() => {});
    } catch (_) {}
}

// Cruza los jugadores conectados ÚNICAMENTE con administradores reales de txAdmin (y sesiones txAdmin verificadas)
// Nunca usa el rol Staff de Discord, ya que puede haber Staffs en Discord sin cuenta/rango en txAdmin todavía.
function enrichOnlinePlayersWithTxAdmins(bridgeStatus, data) {
    if (!data || !Array.isArray(data.players)) return data;
    const sessionByDiscord = new Map();
    for (const s of (bridgeStatus?.sessions || [])) {
        if (s.discordUserId) sessionByDiscord.set(String(s.discordUserId), s);
    }

    const enrichedPlayers = data.players.map(p => {
        const ids = Array.isArray(p.identifiers) ? p.identifiers : [];
        const discRaw = ids.find(i => /^discord:\d+/i.test(String(i)));
        const discordId = p.discordId || (discRaw ? String(discRaw).replace(/^discord:/i, '') : null);

        let isTxAdmin = Boolean(p.isTxAdmin);
        let txAdminName = p.txAdminName || null;
        let txAdminMaster = Boolean(p.txAdminMaster);

        // Respaldo solo si esa persona ya inició sesión real con una cuenta de txAdmin verificada
        if (!isTxAdmin && discordId && sessionByDiscord.has(discordId)) {
            const sess = sessionByDiscord.get(discordId);
            isTxAdmin = true;
            txAdminName = sess.txUsername || txAdminName;
            txAdminMaster = Boolean(sess.master);
        }

        return {
            ...p,
            discordId,
            isTxAdmin,
            txAdminName,
            txAdminMaster
        };
    });

    const staffsOnline = enrichedPlayers
        .filter(p => p.isTxAdmin)
        .map(p => ({
            id: p.id,
            name: p.name,
            discordId: p.discordId,
            txAdminName: p.txAdminName,
            isMaster: p.txAdminMaster
        }));

    return {
        ...data,
        totalOnline: data.totalOnline ?? enrichedPlayers.length,
        staffOnlineCount: staffsOnline.length,
        staffsOnline,
        players: enrichedPlayers
    };
}

function isBotOwner(userId) {
    return OWNER_IDS.has(String(userId || ''));
}

function isMemberStaff(member) {
    if (!member || member.user?.bot) return false;
    if (isBotOwner(member.id)) return true;
    const gId = member.guild?.id;
    const gCfg = guildManager.getGuildConfig(gId) || {};
    const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? PRIMARY_STAFF_ROLE_ID : '');
    if (staffRoleId && member.roles?.cache?.has(staffRoleId)) return true;
    if (member.permissions?.has(PermissionFlagsBits.Administrator) || member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    return false;
}

function getUserSessionFromStatus(bridgeStatus, userId) {
    return (bridgeStatus.sessions || []).find(s => String(s.discordUserId) === String(userId)) || null;
}

function createPendingConfirmation({ guildId, userId, userTag, bridgeAction, params, txUsername, isDemo = false }) {
    const confirmId = crypto.randomBytes(6).toString('hex');
    pendingConfirmations.set(confirmId, {
        guildId: String(guildId),
        userId: String(userId),
        userTag,
        bridgeAction,
        params,
        txUsername,
        isDemo: Boolean(isDemo),
        expiresAt: Date.now() + 60000
    });
    setTimeout(() => pendingConfirmations.delete(confirmId), 65000);
    return confirmId;
}

// Prefija todos los customId con "demo_" cuando estamos dentro de !panel-txadmintest / !panel-txownertest
function decorateForDemo(payload, isDemo) {
    if (!isDemo || !payload) return payload;
    if (Array.isArray(payload.components)) {
        for (const row of payload.components) {
            if (!row || !Array.isArray(row.components)) continue;
            for (const comp of row.components) {
                const curId = comp?.data?.custom_id;
                if (curId && !curId.startsWith('demo_') && typeof comp.setCustomId === 'function') {
                    comp.setCustomId(`demo_${curId}`.slice(0, 100));
                }
            }
        }
    }
    if (Array.isArray(payload.embeds) && payload.embeds[0]?.data) {
        const first = payload.embeds[0];
        const fText = first.data.footer?.text || '';
        if (!fText.includes('MODO TEST')) {
            first.setFooter({
                text: `🧪 MODO TEST • ${fText || 'Sandbox txAdmin'}`,
                ...(first.data.footer?.icon_url ? { iconURL: first.data.footer.icon_url } : {})
            });
        }
    }
    return payload;
}

function decorateModalForDemo(modal, isDemo) {
    if (!isDemo || !modal) return modal;
    const curId = modal?.data?.custom_id;
    if (curId && !curId.startsWith('demo_') && typeof modal.setCustomId === 'function') {
        modal.setCustomId(`demo_${curId}`);
    }
    const curTitle = modal?.data?.title || '';
    if (!curTitle.includes('[TEST]') && typeof modal.setTitle === 'function') {
        modal.setTitle(`🧪 ${curTitle}`.slice(0, 45));
    }
    return modal;
}

async function sendTxAuditLog(client, guild, { actorUser, txUsername, actionKey, params, ok, resultMsg, isDemo = false }) {
    if (isDemo) return; // En modo test no contaminar el canal real de auditoría
    try {
        const gId = guild?.id;
        const gCfg = guildManager.getGuildConfig(gId) || {};
        const logChannelId = gCfg.CHANNEL_TX_LOGS_ID;
        if (!logChannelId) return;

        const ch = client.channels.cache.get(logChannelId) || await client.channels.fetch(logChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;

        const v = guildManager.resolveGuildVisuals(gId);
        const paramSummary = Object.entries(params || {})
            .filter(([, val]) => val !== undefined && val !== null && String(val).trim() !== '')
            .map(([k, val]) => `> • **${k}:** \`${String(val).slice(0, 180)}\``)
            .join('\n') || '> *(Sin parámetros)*';

        const embed = new EmbedBuilder()
            .setColor(ok ? 0x2ECC71 : 0xE74C3C)
            .setAuthor({
                name: `AUDITORÍA TXADMIN • ${v.name}`,
                iconURL: actorUser?.displayAvatarURL?.({ size: 128 }) || undefined
            })
            .setTitle(`${ok ? '✅' : '❌'}┃${panels.ACTION_LABELS[actionKey] || actionKey}`)
            .setDescription(
                `> 👤 **Staff Discord:** <@${actorUser.id}> (\`${actorUser.tag || actorUser.username}\`)\n` +
                `> 🔑 **Cuenta txAdmin:** \`${txUsername || 'N/D'}\`\n` +
                `> 📌 **Resultado:** ${resultMsg || (ok ? 'Ejecutado en txAdmin' : 'Error')}\n\n` +
                `📋┃**Parámetros enviados**\n${paramSummary}`
            )
            .setFooter({ text: `${v.name} • Registro Inmutable de Acciones txAdmin` })
            .setTimestamp();

        await ch.send({ embeds: [embed] }).catch(() => {});
    } catch (_) {}
}

function initTxAdminModule(client, app) {
    // 1. Montar los endpoints seguros del puente Reverse-RPC en Express
    bridgeHub.mountBridgeRoutes(app, async (guildId, event) => {
        if (!event || !event.type) return;
        const guild = client.guilds.cache.get(String(guildId));
        if (!guild) return;
        const gCfg = guildManager.getGuildConfig(guildId) || {};
        if (!gCfg.CHANNEL_TX_LOGS_ID) return;
        const ch = client.channels.cache.get(gCfg.CHANNEL_TX_LOGS_ID) || await client.channels.fetch(gCfg.CHANNEL_TX_LOGS_ID).catch(() => null);
        if (!ch || !ch.isTextBased()) return;

        const embed = panels.buildNoticeEmbed(guild, {
            title: `📡┃Evento FiveM/txAdmin: ${event.type}`,
            description: event.summary || `\`\`\`json\n${JSON.stringify(event.data || {}).slice(0, 1200)}\n\`\`\``
        });
        await ch.send({ embeds: [embed] }).catch(() => {});
    });

    // 2. Comandos de configuración y publicación de paneles
    client.on('messageCreate', async (message) => {
        try {
            if (!message.guild || message.author.bot) return;
            const raw = message.content.trim();
            const lower = raw.toLowerCase();
            const gId = message.guild.id;

            // !panel-txadmin (Panel real permanente para Staff)
            if (['!panel-txadmin', '!panel-tx', '!paneltx', '!txpanel'].includes(lower)) {
                if (!isMemberStaff(message.member)) return;
                await message.delete().catch(() => {});
                const status = bridgeHub.getBridgeStatus(gId);
                const payload = panels.buildMainPanelPayload(message.guild, status);
                await message.channel.send(payload).catch(e => console.error('⚠️ [TXADMIN] Error enviando panel:', e.message));
                return;
            }

            // !panel-txowner (Panel real permanente exclusivo del Creador)
            if (['!panel-txowner', '!paneltxowner', '!panel-tx-owner'].includes(lower)) {
                if (!isBotOwner(message.author.id)) return;
                await message.delete().catch(() => {});
                const status = bridgeHub.getBridgeStatus(gId);
                const payload = panels.buildOwnerPermanentPanelPayload(message.guild, status);
                await message.channel.send(payload).catch(e => console.error('⚠️ [TXADMIN] Error enviando panel owner:', e.message));
                return;
            }

            // !panel-txadmintest (Panel de TESTEO Staff con datos simulados y tú ya registrado)
            if (['!panel-txadmintest', '!paneltxadmintest', '!panel-txtest'].includes(lower)) {
                if (!isBotOwner(message.author.id)) return;
                await message.delete().catch(() => {});
                const demoStatus = demoSandbox.getDemoBridgeStatus(gId, message.author);
                const payload = decorateForDemo(panels.buildMainPanelPayload(message.guild, demoStatus), true);
                await message.channel.send(payload).catch(e => console.error('⚠️ [TXADMIN] Error enviando panel staff test:', e.message));
                return;
            }

            // !panel-txownertest (Panel de TESTEO Creador con sesiones y admins simulados)
            if (['!panel-txownertest', '!paneltxownertest'].includes(lower)) {
                if (!isBotOwner(message.author.id)) return;
                await message.delete().catch(() => {});
                const demoStatus = demoSandbox.getDemoBridgeStatus(gId, message.author);
                const payload = decorateForDemo(panels.buildOwnerPermanentPanelPayload(message.guild, demoStatus), true);
                await message.channel.send(payload).catch(e => console.error('⚠️ [TXADMIN] Error enviando panel owner test:', e.message));
                return;
            }

            // !tx-resettest (Reinicia los datos simulados del sandbox)
            if (lower === '!tx-resettest') {
                if (!isBotOwner(message.author.id)) return;
                await message.delete().catch(() => {});
                demoSandbox.resetDemoState(gId, message.author);
                const ok = await message.channel.send({
                    embeds: [panels.buildNoticeEmbed(message.guild, {
                        title: '🧪┃Datos de Testeo Reiniciados',
                        description: 'Se han restaurado las sesiones, jugadores, sanciones y recursos de prueba.',
                        color: 0x2ECC71
                    })]
                }).catch(() => null);
                if (ok) setTimeout(() => ok.delete().catch(() => {}), 5000);
                return;
            }

            // !tx-logs [#canal | off]
            if (lower === '!tx-logs' || lower.startsWith('!tx-logs ')) {
                if (!isMemberStaff(message.member)) return;
                await message.delete().catch(() => {});
                const arg = raw.split(/\s+/)[1]?.toLowerCase() || '';
                if (arg === 'off' || arg === 'desactivar') {
                    await guildManager.setGuildConfigKey(gId, 'CHANNEL_TX_LOGS_ID', '');
                    const emb = panels.buildNoticeEmbed(message.guild, {
                        title: '🔴┃Logs de Auditoría txAdmin Desactivados',
                        description: 'Ya no se enviarán registros de acciones txAdmin a ningún canal.',
                        color: 0xE74C3C
                    });
                    const m = await message.channel.send({ embeds: [emb] }).catch(() => null);
                    if (m) setTimeout(() => m.delete().catch(() => {}), 7000);
                    return;
                }
                const targetCh = message.mentions.channels.first() || message.channel;
                await guildManager.setGuildConfigKey(gId, 'CHANNEL_TX_LOGS_ID', targetCh.id);
                const emb = panels.buildNoticeEmbed(message.guild, {
                    title: '📜┃Canal de Auditoría txAdmin Configurado',
                    description: `Todas las acciones ejecutadas en txAdmin desde Discord quedarán registradas en <#${targetCh.id}>.`,
                    color: 0x2ECC71
                });
                const m = await message.channel.send({ embeds: [emb] }).catch(() => null);
                if (m) setTimeout(() => m.delete().catch(() => {}), 8000);
                return;
            }

            // !tx-setup (Exclusivo Creador)
            if (lower === '!tx-setup' || lower === '!tx-setup regenerar') {
                if (!isBotOwner(message.author.id)) return;
                await message.delete().catch(() => {});

                let secret = bridgeHub.getBridgeSecretForGuild(gId);
                if (!secret || lower.includes('regenerar')) {
                    secret = bridgeHub.generateBridgeSecret();
                    await guildManager.setGuildConfigKey(gId, 'TX_BRIDGE_SECRET', secret);
                }

                const publicUrl = (process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://bot-vallecasrp-production.up.railway.app')
                    .replace(/\/+$/, '');
                const botUrl = publicUrl.startsWith('http') ? publicUrl : `https://${publicUrl}`;
                const hookSecret = crypto.createHash('sha256').update(`hook:${secret}`).digest('hex').slice(0, 32);
                const masterKey = crypto.randomBytes(32).toString('hex');

                const envSnippet =
                    `BOT_BASE_URL=${botUrl}\n` +
                    `GUILD_ID=${gId}\n` +
                    `TX_BRIDGE_SECRET=${secret}\n` +
                    `BRIDGE_MODE=local\n` +
                    `TXADMIN_URL=http://127.0.0.1:40120\n` +
                    `FXSERVER_URL=http://127.0.0.1:30120\n` +
                    `TXDATA_DIR=C:\\ruta\\a\\tu\\txData\n` +
                    `TX_PROFILE_NAME=default\n` +
                    `LUA_HOOK_SECRET=${hookSecret}\n` +
                    `SESSION_MASTER_KEY=${masterKey}`;

                const dmEmbed = panels.buildNoticeEmbed(message.guild, {
                    title: '🔐┃Credenciales del Puente txBridge Listas',
                    description:
                        `Copia este bloque exacto en el archivo \`txBridge/.env\` de tu PC *(y luego en tu VPS)*:\n\n` +
                        `\`\`\`env\n${envSnippet}\n\`\`\`\n` +
                        `> 🧩 En tu \`server.cfg\` de FiveM añade:\n` +
                        `> \`set vantex_tx_hook_secret "${hookSecret}"\`\n` +
                        `> \`ensure vantex_tx_hook\`\n\n` +
                        `> ⚠️ *No compartas estas claves con nadie. Puedes regenerarlas cuando quieras con \`!tx-setup regenerar\`.*`,
                    color: 0x2ECC71
                });

                try {
                    await message.author.send({ embeds: [dmEmbed] });
                    const ok = await message.channel.send({
                        embeds: [panels.buildNoticeEmbed(message.guild, {
                            title: '📩┃Configuración Enviada por Privado',
                            description: `<@${message.author.id}>, te he enviado por Mensaje Directo las credenciales de \`txBridge/.env\` para **${message.guild.name}**.`,
                            color: 0x2ECC71
                        })]
                    }).catch(() => null);
                    if (ok) setTimeout(() => ok.delete().catch(() => {}), 7000);
                } catch (_) {
                    const warn = await message.channel.send({
                        embeds: [panels.buildNoticeEmbed(message.guild, {
                            title: '⚠️┃Mensajes Directos Cerrados',
                            description: 'Activa tus Mensajes Directos para enviarte las credenciales privadas de forma segura (nunca las publico en un canal).',
                            color: 0xF39C12
                        })]
                    }).catch(() => null);
                    if (warn) setTimeout(() => warn.delete().catch(() => {}), 7000);
                }
            }
        } catch (err) {
            console.error('⚠️ [TXADMIN messageCreate Error]:', err.message);
        }
    });

    // 3. Revocación automática instantánea si un Staff pierde su rol o sale del servidor
    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        try {
            if (!newMember?.guild || newMember.user?.bot || isBotOwner(newMember.id)) return;
            const gId = newMember.guild.id;
            const gCfg = guildManager.getGuildConfig(gId) || {};
            const staffRoleId = gCfg.ROLE_STAFF_ID || (guildManager.isPrimaryGuild(gId) ? PRIMARY_STAFF_ROLE_ID : '');
            if (!staffRoleId) return;

            const had = oldMember.roles?.cache?.has(staffRoleId);
            const has = newMember.roles?.cache?.has(staffRoleId);
            if (had && !has) {
                const status = bridgeHub.getBridgeStatus(gId);
                if (getUserSessionFromStatus(status, newMember.id)) {
                    await bridgeHub.dispatchToBridge(gId, 'session_revoke', { discordUserId: newMember.id }).catch(() => {});
                    console.log(`🔒 [TXADMIN] Sesión revocada automáticamente a ${newMember.user.tag} por pérdida de rol Staff.`);
                }
            }
        } catch (_) {}
    });

    client.on('guildMemberRemove', async (member) => {
        try {
            if (!member?.guild || member.user?.bot) return;
            const gId = member.guild.id;
            const status = bridgeHub.getBridgeStatus(gId);
            if (getUserSessionFromStatus(status, member.id)) {
                await bridgeHub.dispatchToBridge(gId, 'session_revoke', { discordUserId: member.id }).catch(() => {});
                console.log(`🔒 [TXADMIN] Sesión revocada automáticamente a ${member.user.tag} al salir del servidor.`);
            }
        } catch (_) {}
    });

    // Helper unificado para renderizar secciones (funciona igual en modo REAL y modo TEST)
    async function renderSection(interaction, section, { isFreshReply = false, page = 0, filter = null, isDemo = false } = {}) {
        const gId = interaction.guild?.id;
        const getStatus = () => isDemo
            ? demoSandbox.getDemoBridgeStatus(gId, interaction.user)
            : bridgeHub.getBridgeStatus(gId);
        const dispatch = (action, payload = {}, timeoutMs = 15000) => isDemo
            ? demoSandbox.dispatchDemoAction(gId, action, payload, interaction.user)
            : bridgeHub.dispatchToBridge(gId, action, payload, timeoutMs);

        const status = getStatus();
        const userSession = getUserSessionFromStatus(status, interaction.user.id);
        const owner = isBotOwner(interaction.user.id);

        const respond = async (rawPayload) => {
            const payload = decorateForDemo(rawPayload, isDemo);
            let res;
            if (isFreshReply) {
                if (interaction.deferred || interaction.replied) res = await interaction.editReply(payload).catch(() => {});
                else res = await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
            } else {
                if (interaction.deferred || interaction.replied) res = await interaction.editReply(payload).catch(() => {});
                else res = await interaction.update(payload).catch(() => {});
            }
            scheduleAutoDelete(interaction);
            return res;
        };

        // Modales directos
        if (section === 'login') return interaction.showModal(decorateModalForDemo(panels.buildLoginModal(), isDemo));
        if (section === 'ai') return interaction.showModal(decorateModalForDemo(panels.buildAiQueryModal(), isDemo));
        if (section === 'search_player') return interaction.showModal(decorateModalForDemo(panels.buildSearchPlayerModal(), isDemo));

        if (section === 'hub') {
            return respond(panels.buildEphemeralHubPayload(interaction.guild, status, userSession, owner));
        }

        if (section === 'actions') {
            return respond(panels.buildActionsMenuPayload(interaction.guild, userSession, status.readOnlyMode, owner));
        }

        if (section === 'owner_panel') {
            if (!owner) {
                return respond({
                    embeds: [panels.buildNoticeEmbed(interaction.guild, {
                        title: '⛔┃Acceso Exclusivo del Creador',
                        description: 'Solo el creador del bot puede acceder al Panel Maestro de sesiones y seguridad txAdmin.',
                        color: 0xE74C3C
                    })],
                    components: []
                });
            }
            if (filter === 'admins') {
                if (isFreshReply) await interaction.deferReply({ ephemeral: true }).catch(() => {});
                else await interaction.deferUpdate().catch(() => {});
                let admins = [];
                try {
                    const res = await dispatch('read_list_tx_admins', {});
                    admins = res?.admins || [];
                } catch (_) {}
                return respond(panels.buildOwnerMasterPayload(interaction.guild, getStatus(), admins, true));
            }
            return respond(panels.buildOwnerMasterPayload(interaction.guild, status, [], false));
        }

        if (isFreshReply) await interaction.deferReply({ ephemeral: true }).catch(() => {});
        else await interaction.deferUpdate().catch(() => {});

        try {
            if (section === 'players') {
                const raw = await dispatch('read_list_online_players', {});
                const data = enrichOnlinePlayersWithTxAdmins(getStatus(), raw);
                const mode = filter === 'staff' ? 'staff' : 'all';
                return respond(panels.buildOnlinePlayersPayload(interaction.guild, data, page, mode));
            }

            if (section === 'sanctions') {
                const filterKey = filter || 'all';
                const queryArgs = {};
                if (filterKey === 'ban_active') { queryArgs.type = 'ban'; queryArgs.status = 'active'; }
                else if (filterKey === 'ban_expired') { queryArgs.type = 'ban'; queryArgs.status = 'expired'; }
                else if (filterKey === 'revoked') { queryArgs.type = 'all'; queryArgs.status = 'revoked'; }
                else if (filterKey === 'warn') { queryArgs.type = 'warn'; queryArgs.status = 'all'; }
                else if (filterKey === 'week') { queryArgs.type = 'all'; queryArgs.status = 'all'; queryArgs.rangeDays = 7; }
                else { queryArgs.type = 'all'; queryArgs.status = 'all'; }

                const data = await dispatch('read_query_sanctions', queryArgs);
                return respond(panels.buildSanctionsPayload(interaction.guild, data, page, filterKey));
            }

            if (section === 'staff_activity') {
                const viewMode = filter || 'ranking';
                const data = await dispatch('read_get_staff_activity', { includeAdminLog: viewMode === 'adminlog' });
                return respond(panels.buildStaffActivityPayload(interaction.guild, data, page, viewMode));
            }

            if (section === 'server_status') {
                const tab = filter || 'overview';
                let data = {};
                if (tab === 'overview') {
                    data.overview = await dispatch('read_get_server_overview', {});
                } else if (tab === 'console_errors') {
                    data = await dispatch('read_get_console_errors', { lines: 60 });
                } else {
                    data = await dispatch('read_get_server_resources', { filter: tab === 'res_stopped' ? 'stopped' : 'all' });
                }
                return respond(panels.buildServerAndResourcesPayload(interaction.guild, data, page, tab));
            }
        } catch (err) {
            return respond({
                embeds: [panels.buildNoticeEmbed(interaction.guild, {
                    title: '⚠️┃Sin Conexión con txAdmin',
                    description: `${err.message}`,
                    color: 0xF39C12
                })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Volver al Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                )]
            });
        }
    }

    // 4. Manejador unificado de interacciones (Producción + Sandbox Test)
    client.on('interactionCreate', async (interaction) => {
        try {
            const rawCid = interaction.customId || '';
            const isDemo = rawCid.startsWith('demo_');
            const cid = isDemo ? rawCid.slice(5) : rawCid;

            const isOurInteraction =
                cid.startsWith('select_tx_') ||
                cid.startsWith('btn_tx_') ||
                cid.startsWith('tx_') ||
                cid.startsWith('modal_tx_');

            if (!isOurInteraction) return;

            if (!isMemberStaff(interaction.member)) {
                return interaction.reply({
                    embeds: [panels.buildNoticeEmbed(interaction.guild, {
                        title: '⛔┃Acceso Restringido',
                        description: 'Este sistema es de uso exclusivo para el equipo de **Staff**.',
                        color: 0xE74C3C
                    })],
                    ephemeral: true
                }).catch(() => {});
            }

            const gId = interaction.guild?.id;
            const getStatus = () => isDemo
                ? demoSandbox.getDemoBridgeStatus(gId, interaction.user)
                : bridgeHub.getBridgeStatus(gId);
            const dispatch = (action, payload = {}, timeoutMs = 15000) => isDemo
                ? demoSandbox.dispatchDemoAction(gId, action, payload, interaction.user)
                : bridgeHub.dispatchToBridge(gId, action, payload, timeoutMs);

            // ------------------------------------------------------------
            // A. MENÚS DESPLEGABLES
            // ------------------------------------------------------------
            if (interaction.isStringSelectMenu()) {
                const val = interaction.values[0];

                if (cid === 'select_tx_main_menu') {
                    const out = await renderSection(interaction, val, { isFreshReply: true, isDemo });
                    resetPermanentSelectMenu(interaction, isDemo, false);
                    return out;
                }
                if (cid === 'select_tx_ephemeral_nav') {
                    return renderSection(interaction, val, { isFreshReply: false, isDemo });
                }
                if (cid === 'select_tx_sanctions_filter') {
                    return renderSection(interaction, 'sanctions', { isFreshReply: false, page: 0, filter: val, isDemo });
                }
                if (cid === 'select_tx_server_tab') {
                    return renderSection(interaction, 'server_status', { isFreshReply: false, page: 0, filter: val, isDemo });
                }
                if (cid === 'select_tx_action_pick') {
                    if (val === 'none') return interaction.deferUpdate().catch(() => {});
                    const status = getStatus();
                    const userSession = getUserSessionFromStatus(status, interaction.user.id);
                    if (!panels.canExecuteTxAction(userSession, val, isBotOwner(interaction.user.id))) {
                        await interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Sin Permiso en txAdmin',
                                description: 'Tu cuenta de txAdmin no tiene permisos autorizados para ejecutar esta acción.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                        scheduleAutoDelete(interaction);
                        return;
                    }
                    return interaction.showModal(decorateModalForDemo(panels.buildActionModal(val), isDemo));
                }

                // Menú del Panel Permanente del Creador (!panel-txowner / !panel-txownertest) — TIENE TODO
                if (cid === 'select_tx_owner_panel') {
                    if (!isBotOwner(interaction.user.id)) {
                        return interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Acceso Exclusivo del Creador',
                                description: 'Solo el creador del bot puede utilizar este panel.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                    }

                    if (['login', 'ai', 'players', 'search_player', 'sanctions', 'staff_activity', 'server_status', 'actions'].includes(val)) {
                        const out = await renderSection(interaction, val, { isFreshReply: true, isDemo });
                        resetPermanentSelectMenu(interaction, isDemo, true);
                        return out;
                    }
                    if (val === 'manage_sessions') {
                        const out = await renderSection(interaction, 'owner_panel', { isFreshReply: true, isDemo });
                        resetPermanentSelectMenu(interaction, isDemo, true);
                        return out;
                    }
                    if (val === 'view_admins') {
                        const out = await renderSection(interaction, 'owner_panel', { isFreshReply: true, filter: 'admins', isDemo });
                        resetPermanentSelectMenu(interaction, isDemo, true);
                        return out;
                    }
                    if (val === 'toggle_readonly') {
                        if (isDemo) {
                            demoSandbox.toggleDemoReadOnly(gId);
                        } else {
                            const cur = Boolean((guildManager.getGuildConfig(gId) || {}).TX_READ_ONLY_MODE);
                            await guildManager.setGuildConfigKey(gId, 'TX_READ_ONLY_MODE', !cur);
                        }
                        const freshStatus = getStatus();
                        await interaction.update(decorateForDemo(
                            panels.buildOwnerPermanentPanelPayload(interaction.guild, freshStatus, { includeFiles: false }),
                            isDemo
                        )).catch(() => {});
                        return;
                    }
                    if (val === 'send_env_dm') {
                        resetPermanentSelectMenu(interaction, isDemo, true);
                        if (isDemo) {
                            return interaction.reply({
                                embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                    title: '🧪┃Simulación de Envío de Credenciales',
                                    description: 'En el panel real (`!panel-txowner`), esta opción genera/recupera tu `TX_BRIDGE_SECRET` real y te envía el bloque `.env` por Mensaje Directo.',
                                    color: 0x2ECC71
                                })],
                                ephemeral: true
                            }).catch(() => {});
                        }
                        let secret = bridgeHub.getBridgeSecretForGuild(gId);
                        if (!secret) {
                            secret = bridgeHub.generateBridgeSecret();
                            await guildManager.setGuildConfigKey(gId, 'TX_BRIDGE_SECRET', secret);
                        }
                        const publicUrl = (process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN || 'https://bot-vallecasrp-production.up.railway.app').replace(/\/+$/, '');
                        const botUrl = publicUrl.startsWith('http') ? publicUrl : `https://${publicUrl}`;
                        const hookSecret = crypto.createHash('sha256').update(`hook:${secret}`).digest('hex').slice(0, 32);
                        const masterKey = crypto.randomBytes(32).toString('hex');
                        const envSnippet =
                            `BOT_BASE_URL=${botUrl}\nGUILD_ID=${gId}\nTX_BRIDGE_SECRET=${secret}\nBRIDGE_MODE=local\n` +
                            `TXADMIN_URL=http://127.0.0.1:40120\nFXSERVER_URL=http://127.0.0.1:30120\n` +
                            `TXDATA_DIR=C:\\ruta\\a\\tu\\txData\nTX_PROFILE_NAME=default\nLUA_HOOK_SECRET=${hookSecret}\nSESSION_MASTER_KEY=${masterKey}`;

                        try {
                            await interaction.user.send({
                                embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                    title: '🔐┃Credenciales txBridge (.env)',
                                    description: `Copia este bloque en \`txBridge/.env\`:\n\n\`\`\`env\n${envSnippet}\n\`\`\`\n> 🧩 \`server.cfg\`: \`set vantex_tx_hook_secret "${hookSecret}"\` + \`ensure vantex_tx_hook\``,
                                    color: 0x2ECC71
                                })]
                            });
                            return interaction.reply({
                                embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                    title: '📩┃Credenciales Enviadas por DM',
                                    description: 'Revisa tus Mensajes Directos para copiar tu bloque `txBridge/.env`.',
                                    color: 0x2ECC71
                                })],
                                ephemeral: true
                            }).catch(() => {});
                        } catch (_) {
                            return interaction.reply({
                                embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                    title: '⚠️┃DM Cerrados',
                                    description: 'Activa tus Mensajes Directos para poder enviarte las credenciales privadas.',
                                    color: 0xF39C12
                                })],
                                ephemeral: true
                            }).catch(() => {});
                        }
                    }
                    return;
                }

                if (cid === 'select_tx_owner_revoke') {
                    if (!isBotOwner(interaction.user.id)) return;
                    await interaction.deferUpdate().catch(() => {});
                    try {
                        await dispatch('session_revoke', { discordUserId: val });
                        const freshStatus = getStatus();
                        const payload = decorateForDemo(panels.buildOwnerMasterPayload(interaction.guild, freshStatus, [], false), isDemo);
                        await interaction.editReply(payload).catch(() => {});
                    } catch (err) {
                        await interaction.editReply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '❌┃Error al Cerrar Sesión',
                                description: err.message,
                                color: 0xE74C3C
                            })]
                        }).catch(() => {});
                    }
                    return;
                }
            }

            // ------------------------------------------------------------
            // B. BOTONES
            // ------------------------------------------------------------
            if (interaction.isButton()) {
                if (cid === 'btn_tx_quick_login') {
                    return interaction.showModal(decorateModalForDemo(panels.buildLoginModal(), isDemo));
                }
                if (cid === 'btn_tx_quick_ai') {
                    return interaction.showModal(decorateModalForDemo(panels.buildAiQueryModal(), isDemo));
                }
                if (cid === 'btn_tx_quick_players') {
                    return renderSection(interaction, 'players', { isFreshReply: true, page: 0, filter: 'all', isDemo });
                }
                if (cid === 'tx_open_search_modal') {
                    return interaction.showModal(decorateModalForDemo(panels.buildSearchPlayerModal(), isDemo));
                }
                if (cid === 'tx_nav_actions') {
                    return renderSection(interaction, 'actions', { isFreshReply: false, isDemo });
                }
                if (cid.startsWith('tx_repeat_act_')) {
                    const actionKey = cid.slice('tx_repeat_act_'.length);
                    const status = getStatus();
                    const userSession = getUserSessionFromStatus(status, interaction.user.id);
                    if (status.readOnlyMode) {
                        await interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '🔒┃Modo Solo Lectura Activo',
                                description: 'El creador ha pausado temporalmente las acciones administrativas.',
                                color: 0xF39C12
                            })],
                            ephemeral: true
                        }).catch(() => {});
                        scheduleAutoDelete(interaction);
                        return;
                    }
                    if (!panels.canExecuteTxAction(userSession, actionKey, isBotOwner(interaction.user.id))) {
                        await interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Sin Permiso en txAdmin',
                                description: 'Tu cuenta de txAdmin no tiene permisos autorizados para repetir esta acción.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                        scheduleAutoDelete(interaction);
                        return;
                    }
                    return interaction.showModal(decorateModalForDemo(panels.buildActionModal(actionKey), isDemo));
                }
                if (cid === 'btn_tx_refresh_main') {
                    const status = getStatus();
                    const payload = decorateForDemo(panels.buildMainPanelPayload(interaction.guild, status, { includeFiles: false }), isDemo);
                    await interaction.update(payload).catch(() => {});
                    return;
                }

                // Botones del Panel Permanente del Creador (!panel-txowner / !panel-txownertest)
                if (cid.startsWith('btn_tx_owner_')) {
                    if (!isBotOwner(interaction.user.id)) {
                        return interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Acceso Exclusivo del Creador',
                                description: 'Solo el creador del bot puede utilizar los controles de este panel.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                    }
                    if (cid === 'btn_tx_owner_refresh_panel') {
                        const status = getStatus();
                        await interaction.update(decorateForDemo(
                            panels.buildOwnerPermanentPanelPayload(interaction.guild, status, { includeFiles: false }),
                            isDemo
                        )).catch(() => {});
                        return;
                    }
                    if (cid === 'btn_tx_owner_open_actions') {
                        return renderSection(interaction, 'actions', { isFreshReply: true, isDemo });
                    }
                    if (cid === 'btn_tx_owner_open_sessions') {
                        return renderSection(interaction, 'owner_panel', { isFreshReply: true, isDemo });
                    }
                    if (cid === 'btn_tx_owner_open_admins') {
                        return renderSection(interaction, 'owner_panel', { isFreshReply: true, filter: 'admins', isDemo });
                    }
                }

                if (cid === 'tx_nav_hub') {
                    return renderSection(interaction, 'hub', { isFreshReply: false, isDemo });
                }

                if (cid.startsWith('tx_pg_players_')) {
                    const clean = cid.replace(/_ref$/, '');
                    const parts = clean.split('_');
                    const page = parseInt(parts[3], 10) || 0;
                    const mode = parts[4] === 'staff' ? 'staff' : 'all';
                    return renderSection(interaction, 'players', { isFreshReply: false, page, filter: mode, isDemo });
                }

                if (cid.startsWith('tx_pg_sanctions_')) {
                    const parts = cid.replace(/_ref$/, '').split('_');
                    const page = parseInt(parts[3], 10) || 0;
                    const filterKey = parts.slice(4).join('_') || 'all';
                    return renderSection(interaction, 'sanctions', { isFreshReply: false, page, filter: filterKey, isDemo });
                }

                if (cid.startsWith('tx_pg_player_')) {
                    const rest = cid.slice('tx_pg_player_'.length);
                    const sep = rest.indexOf('_');
                    const page = parseInt(rest.slice(0, sep), 10) || 0;
                    const query = decodeURIComponent(rest.slice(sep + 1));
                    await interaction.deferUpdate().catch(() => {});
                    try {
                        const data = await dispatch('read_search_player', { query });
                        await interaction.editReply(decorateForDemo(
                            panels.buildPlayerProfilePayload(interaction.guild, data, query, page),
                            isDemo
                        )).catch(() => {});
                    } catch (err) {
                        await interaction.editReply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, { title: '⚠️┃Error', description: err.message, color: 0xF39C12 })]
                        }).catch(() => {});
                    }
                    return;
                }

                if (cid.startsWith('tx_pg_staff_')) {
                    const parts = cid.split('_');
                    const page = parseInt(parts[3], 10) || 0;
                    const mode = parts[4] || 'ranking';
                    return renderSection(interaction, 'staff_activity', { isFreshReply: false, page, filter: mode, isDemo });
                }

                if (cid.startsWith('tx_pg_srv_')) {
                    const clean = cid.replace(/_ref$/, '');
                    const parts = clean.split('_');
                    const page = parseInt(parts[3], 10) || 0;
                    const tab = parts.slice(4).join('_') || 'overview';
                    return renderSection(interaction, 'server_status', { isFreshReply: false, page, filter: tab, isDemo });
                }

                if (cid.startsWith('tx_owner_')) {
                    if (!isBotOwner(interaction.user.id)) {
                        return interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Solo Creador',
                                description: 'Esta acción está reservada exclusivamente al creador del bot.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                    }

                    if (cid === 'tx_owner_view_admins') {
                        return renderSection(interaction, 'owner_panel', { isFreshReply: false, filter: 'admins', isDemo });
                    }
                    if (cid === 'tx_owner_view_sessions') {
                        return renderSection(interaction, 'owner_panel', { isFreshReply: false, isDemo });
                    }
                    if (cid === 'tx_owner_toggle_readonly') {
                        if (isDemo) {
                            demoSandbox.toggleDemoReadOnly(gId);
                        } else {
                            const cur = Boolean((guildManager.getGuildConfig(gId) || {}).TX_READ_ONLY_MODE);
                            await guildManager.setGuildConfigKey(gId, 'TX_READ_ONLY_MODE', !cur);
                        }
                        const freshStatus = getStatus();
                        await interaction.update(decorateForDemo(
                            panels.buildOwnerMasterPayload(interaction.guild, freshStatus, [], false),
                            isDemo
                        )).catch(() => {});
                        return;
                    }
                    if (cid === 'tx_owner_revoke_all') {
                        await interaction.deferUpdate().catch(() => {});
                        await dispatch('session_revoke_all', {}).catch(() => {});
                        const freshStatus = getStatus();
                        await interaction.editReply(decorateForDemo(
                            panels.buildOwnerMasterPayload(interaction.guild, freshStatus, [], false),
                            isDemo
                        )).catch(() => {});
                        return;
                    }
                }

                // Confirmación humana: Cancelar
                if (cid.startsWith('tx_confirm_no_')) {
                    const confirmId = cid.replace('tx_confirm_no_', '');
                    const pending = pendingConfirmations.get(confirmId);
                    if (pending && pending.userId !== interaction.user.id && !isBotOwner(interaction.user.id)) {
                        return interaction.reply({ content: '⛔ Solo quien solicitó esta acción puede cancelarla.', ephemeral: true }).catch(() => {});
                    }
                    pendingConfirmations.delete(confirmId);
                    await interaction.update(decorateForDemo({
                        embeds: [panels.buildNoticeEmbed(interaction.guild, {
                            title: '❌┃Acción Cancelada',
                            description: 'No se ha enviado ningún cambio a txAdmin.',
                            color: 0x95A5A6
                        })],
                        components: [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Volver al Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                        )]
                    }, isDemo)).catch(() => {});
                    return;
                }

                // Confirmación humana: Confirmar y Ejecutar
                if (cid.startsWith('tx_confirm_yes_')) {
                    const confirmId = cid.replace('tx_confirm_yes_', '');
                    const pending = pendingConfirmations.get(confirmId);
                    if (!pending || Date.now() > pending.expiresAt) {
                        pendingConfirmations.delete(confirmId);
                        return interaction.update(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⌛┃Confirmación Caducada',
                                description: 'Han pasado más de 60 segundos. Vuelve a solicitar la acción para confirmar.',
                                color: 0xF39C12
                            })],
                            components: [new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Volver al Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                            )]
                        }, isDemo)).catch(() => {});
                    }

                    if (pending.userId !== interaction.user.id) {
                        return interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Confirmación Bloqueada',
                                description: 'Solo el administrador que generó esta solicitud puede confirmarla.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                    }

                    const status = getStatus();
                    if (status.readOnlyMode) {
                        pendingConfirmations.delete(confirmId);
                        return interaction.update(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '🔒┃Modo Solo Lectura Activo',
                                description: 'El creador ha pausado temporalmente la ejecución de acciones administrativas en txAdmin.',
                                color: 0xF39C12
                            })],
                            components: []
                        }, isDemo)).catch(() => {});
                    }

                    pendingConfirmations.delete(confirmId);
                    await interaction.deferUpdate().catch(() => {});

                    try {
                        const result = await dispatch(pending.bridgeAction, {
                            discordUserId: interaction.user.id,
                            discordTag: interaction.user.tag || interaction.user.username,
                            params: pending.params
                        }, 20000);

                        await sendTxAuditLog(client, interaction.guild, {
                            actorUser: interaction.user,
                            txUsername: result?.executedAs || pending.txUsername,
                            actionKey: pending.bridgeAction,
                            params: pending.params,
                            ok: true,
                            resultMsg: result?.message || 'Acción aplicada en txAdmin correctamente.',
                            isDemo
                        });

                        await interaction.editReply(decorateForDemo(
                            panels.buildActionResultPayload(interaction.guild, {
                                ok: true,
                                bridgeAction: pending.bridgeAction,
                                txUsername: result?.executedAs || pending.txUsername,
                                message: result?.message || 'Completado con éxito.',
                                canRepeat: true
                            }),
                            isDemo
                        )).catch(() => {});
                        scheduleAutoDelete(interaction);
                    } catch (execErr) {
                        await sendTxAuditLog(client, interaction.guild, {
                            actorUser: interaction.user,
                            txUsername: pending.txUsername,
                            actionKey: pending.bridgeAction,
                            params: pending.params,
                            ok: false,
                            resultMsg: execErr.message,
                            isDemo
                        });

                        await interaction.editReply(decorateForDemo(
                            panels.buildActionResultPayload(interaction.guild, {
                                ok: false,
                                bridgeAction: pending.bridgeAction,
                                txUsername: pending.txUsername,
                                message: execErr.message,
                                canRepeat: true
                            }),
                            isDemo
                        )).catch(() => {});
                        scheduleAutoDelete(interaction);
                    }
                    return;
                }
            }

            // ------------------------------------------------------------
            // C. ENVÍO DE MODALES (LOGIN, IA, BÚSQUEDA, ACCIONES)
            // ------------------------------------------------------------
            if (interaction.isModalSubmit()) {
                if (cid === 'modal_tx_login') {
                    await interaction.deferReply({ ephemeral: true }).catch(() => {});
                    const txUsername = interaction.fields.getTextInputValue('tx_user').trim();
                    const txPassword = interaction.fields.getTextInputValue('tx_pass');

                    try {
                        const res = await dispatch('session_login', {
                            discordUserId: interaction.user.id,
                            discordTag: interaction.user.tag || interaction.user.username,
                            txUsername,
                            txPassword
                        });

                        const permsText = res?.master
                            ? '`MASTER (Acceso total)`'
                            : `\`${(res?.permissions || []).join(', ') || 'Permisos de txAdmin'}\``;

                        await interaction.editReply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '✅┃Sesión de txAdmin Vinculada',
                                description:
                                    `Tu cuenta personal ha sido verificada correctamente contra txAdmin.\n\n` +
                                    `> 👤 **Staff Discord:** <@${interaction.user.id}>\n` +
                                    `> 🔑 **Usuario txAdmin:** \`${res?.txUsername || txUsername}\`\n` +
                                    `> 🛡️ **Permisos detectados:** ${permsText}\n` +
                                    `> 🔒 **Persistencia:** *Tu sesión permanecerá abierta automáticamente hasta que el creador la cierre.*`,
                                color: 0x2ECC71
                            })],
                            components: [new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Abrir Consola Interactiva').setStyle(ButtonStyle.Primary).setEmoji('🧭')
                            )]
                        }, isDemo)).catch(() => {});
                        scheduleAutoDelete(interaction);
                    } catch (err) {
                        await interaction.editReply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '❌┃Error al Iniciar Sesión en txAdmin',
                                description: `${err.message}`,
                                color: 0xE74C3C
                            })]
                        }, isDemo)).catch(() => {});
                        scheduleAutoDelete(interaction);
                    }
                    return;
                }

                if (cid === 'modal_tx_search_player') {
                    await interaction.deferReply({ ephemeral: true }).catch(() => {});
                    const query = interaction.fields.getTextInputValue('tx_player_query').trim();
                    try {
                        const data = await dispatch('read_search_player', { query });
                        await interaction.editReply(decorateForDemo(
                            panels.buildPlayerProfilePayload(interaction.guild, data, query, 0),
                            isDemo
                        )).catch(() => {});
                        scheduleAutoDelete(interaction);
                    } catch (err) {
                        await interaction.editReply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⚠️┃No se pudo realizar la búsqueda',
                                description: err.message,
                                color: 0xF39C12
                            })]
                        }, isDemo)).catch(() => {});
                        scheduleAutoDelete(interaction);
                    }
                    return;
                }

                if (cid === 'modal_tx_ai_query') {
                    await interaction.deferReply({ ephemeral: true }).catch(() => {});
                    const promptText = interaction.fields.getTextInputValue('tx_ai_prompt').trim();
                    const status = getStatus();
                    const userSession = getUserSessionFromStatus(status, interaction.user.id);

                    try {
                        const { answer, proposedAction } = await txAiEngine.runTxAiQuery({
                            guildId: gId,
                            userId: interaction.user.id,
                            userTag: interaction.user.tag || interaction.user.username,
                            promptText,
                            userSession,
                            hasLinkedSession: Boolean(userSession),
                            isOwner: isBotOwner(interaction.user.id),
                            dispatchFn: isDemo ? (gid, act, pl) => demoSandbox.dispatchDemoAction(gid, act, pl, interaction.user) : null,
                            enrichOnlineFn: (rawOnline) => enrichOnlinePlayersWithTxAdmins(getStatus(), rawOnline)
                        });

                        if (proposedAction) {
                            if (status.readOnlyMode) {
                                await interaction.editReply(decorateForDemo({
                                    embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                        title: '🔒┃Acción Bloqueada (Solo Lectura)',
                                        description: `${answer.slice(0, 2500)}\n\n────────────────────────────\n⚠️ *El creador tiene activado el **Modo Solo Lectura**, por lo que no se pueden confirmar acciones administrativas ahora.*`,
                                        color: 0xF39C12
                                    })],
                                    components: [new ActionRowBuilder().addComponents(
                                        new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                                    )]
                                }, isDemo)).catch(() => {});
                                scheduleAutoDelete(interaction);
                                return;
                            }

                            if (!userSession) {
                                await interaction.editReply(decorateForDemo({
                                    embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                        title: '🔑┃Inicia Sesión para Confirmar Acciones',
                                        description: `${answer.slice(0, 2500)}\n\n────────────────────────────\n🔒 *Para ejecutar **${panels.ACTION_LABELS[proposedAction.bridgeAction] || proposedAction.bridgeAction}** en txAdmin, primero vincula tu cuenta con el botón de abajo.*`,
                                        color: 0xF39C12
                                    })],
                                    components: [new ActionRowBuilder().addComponents(
                                        new ButtonBuilder().setCustomId('btn_tx_quick_login').setLabel('Iniciar Sesión txAdmin').setStyle(ButtonStyle.Primary).setEmoji('🔑'),
                                        new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                                    )]
                                }, isDemo)).catch(() => {});
                                scheduleAutoDelete(interaction);
                                return;
                            }

                            const confirmId = createPendingConfirmation({
                                guildId: gId,
                                userId: interaction.user.id,
                                userTag: interaction.user.tag || interaction.user.username,
                                bridgeAction: proposedAction.bridgeAction,
                                params: proposedAction.params,
                                txUsername: userSession.txUsername,
                                isDemo
                            });

                            await interaction.editReply(decorateForDemo(panels.buildConfirmationPayload(interaction.guild, {
                                confirmId,
                                bridgeAction: proposedAction.bridgeAction,
                                params: proposedAction.params,
                                txUsername: userSession.txUsername,
                                aiAnswer: answer
                            }), isDemo)).catch(() => {});
                            scheduleAutoDelete(interaction);
                            return;
                        }

                        await interaction.editReply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '🤖┃Respuesta IA • Datos en Vivo txAdmin',
                                description:
                                    `❓┃**Consulta:** *"${promptText.slice(0, 180)}"*\n\n` +
                                    `────────────────────────────\n\n` +
                                    `${answer.slice(0, 3400)}`
                            })],
                            components: [new ActionRowBuilder().addComponents(
                                new ButtonBuilder().setCustomId('btn_tx_quick_ai').setLabel('Otra Consulta IA').setStyle(ButtonStyle.Primary).setEmoji('🤖'),
                                new ButtonBuilder().setCustomId('tx_nav_actions').setLabel('Moderar').setStyle(ButtonStyle.Secondary).setEmoji('⚡'),
                                new ButtonBuilder().setCustomId('tx_nav_hub').setLabel('Menú').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                            )]
                        }, isDemo)).catch(() => {});
                        scheduleAutoDelete(interaction);
                    } catch (err) {
                        await interaction.editReply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⚠️┃Error en Consulta IA txAdmin',
                                description: err.message,
                                color: 0xE74C3C
                            })]
                        }, isDemo)).catch(() => {});
                        scheduleAutoDelete(interaction);
                    }
                    return;
                }

                if (cid.startsWith('modal_tx_act_')) {
                    const actionKey = cid.replace('modal_tx_act_', '');
                    if (actionKey === 'tx_server_control' && !isBotOwner(interaction.user.id)) {
                        return interaction.reply({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Acción Exclusiva del Creador',
                                description: 'Reiniciar, detener o arrancar el servidor solo puede ejecutarse desde `!panel-txowner`.',
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }).catch(() => {});
                    }
                    const status = getStatus();
                    const userSession = getUserSessionFromStatus(status, interaction.user.id);

                    if (status.readOnlyMode) {
                        return interaction.reply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '🔒┃Modo Solo Lectura Activo',
                                description: 'El creador ha bloqueado las acciones administrativas temporalmente.',
                                color: 0xF39C12
                            })],
                            ephemeral: true
                        }, isDemo)).catch(() => {});
                    }

                    if (!userSession) {
                        return interaction.reply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '🔑┃Sesión txAdmin Requerida',
                                description: 'Debes iniciar sesión con tu cuenta de txAdmin antes de ejecutar acciones.',
                                color: 0xF39C12
                            })],
                            ephemeral: true
                        }, isDemo)).catch(() => {});
                    }

                    if (!panels.canExecuteTxAction(userSession, actionKey, isBotOwner(interaction.user.id))) {
                        return interaction.reply(decorateForDemo({
                            embeds: [panels.buildNoticeEmbed(interaction.guild, {
                                title: '⛔┃Sin Permiso en txAdmin',
                                description: `Tu cuenta de txAdmin (\`${userSession.txUsername}\`) no tiene permiso para ejecutar esta acción.`,
                                color: 0xE74C3C
                            })],
                            ephemeral: true
                        }, isDemo)).catch(() => {});
                    }

                    const params = {};
                    for (const field of interaction.fields.fields.values()) {
                        params[field.customId] = (field.value || '').trim();
                    }

                    const confirmId = createPendingConfirmation({
                        guildId: gId,
                        userId: interaction.user.id,
                        userTag: interaction.user.tag || interaction.user.username,
                        bridgeAction: actionKey,
                        params,
                        txUsername: userSession.txUsername,
                        isDemo
                    });

                    await interaction.reply({
                        ...decorateForDemo(panels.buildConfirmationPayload(interaction.guild, {
                            confirmId,
                            bridgeAction: actionKey,
                            params,
                            txUsername: userSession.txUsername
                        }), isDemo),
                        ephemeral: true
                    }).catch(() => {});
                    scheduleAutoDelete(interaction);
                    return;
                }
            }
        } catch (err) {
            console.error('⚠️ [TXADMIN interactionCreate Error]:', err.message);
        }
    });

    console.log('🛡️ [TXADMIN] Módulo interactivo txAdmin + IA cargado correctamente.');
}

module.exports = initTxAdminModule;
