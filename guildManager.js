// ==========================================
// MÓDULO MULTI-SERVIDOR: GESTOR DE PERFILES, CANALES, LOGO Y BANNERS POR SERVIDOR (guildId)
// ==========================================
// - Agrupa TAMBIÉN a Vallecas RP bajo su propio documento en MongoDB (colección `guildprofiles`)
//   manteniendo intactos sus canales y assets actuales en `assets/`.
// - Cada servidor nuevo tiene su propio documento en `guildprofiles` con su `guildId`, `guildName`,
//   canales, roles, marca, color y carpeta propia de imágenes en `assets/<NombreDelServidor>/`.

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { AttachmentBuilder } = require('discord.js');

const GUILD_CONFIGS_FILE = path.join(__dirname, 'guild_configs.json');
const ASSETS_DIR = path.join(__dirname, 'assets');

// Esquema MongoDB unificado por servidor (cada servidor = 1 documento propio con su guildId)
const guildProfileSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true, index: true },
    guildName: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const GuildProfileModel = mongoose.models.GuildProfile || mongoose.model('GuildProfile', guildProfileSchema);

/**
 * Devuelve el nombre de la Base de Datos MongoDB dedicada para un servidor.
 * - Servidor principal (Vallecas RP) -> usa la DB por defecto (spainrp_db).
 * - Cualquier otro servidor -> su propia DB separada dentro del mismo clúster (ej: vilacityrp_db).
 */
function getGuildDbName(guildId) {
    if (!guildId || isPrimaryGuild(guildId)) return null; // null = DB principal spainrp_db
    const cfg = guildCache.get(String(guildId)) || {};
    if (cfg.DB_NAME && /^[a-z0-9_]+$/i.test(cfg.DB_NAME.trim())) {
        return cfg.DB_NAME.trim().toLowerCase();
    }
    const guild = discordClientRef?.guilds?.cache?.get(String(guildId));
    const slug = normalizeSlug(cfg.BRAND_NAME || guild?.name || '');
    if (slug) return `${slug.slice(0, 32)}_db`;
    return `srv_${String(guildId)}_db`;
}

function getGuildDb(guildId) {
    const dbName = getGuildDbName(guildId);
    if (!dbName) return mongoose.connection;
    return mongoose.connection.useDb(dbName, { useCache: true });
}

function getGuildModel(guildId, modelName, schema) {
    const db = getGuildDb(guildId);
    return db.models[modelName] || db.model(modelName, schema);
}

const guildCache = new Map(); // guildId -> config object
let primaryGuildId = process.env.PRIMARY_GUILD_ID || null;
let primaryConfigGetter = () => ({});
let primaryConfigUpdater = async () => {};
let discordClientRef = null;

// Canales conocidos del servidor principal (para identificar Vallecas RP automáticamente)
const PRIMARY_HINT_CHANNELS = [
    '1517530849661288455',
    '1550880724930797610',
    '1517530849032016006',
    '1551998229384536114',
    '1552087566776537148',
    '1571567304628506855'
];

// Mapa de tipos de banner -> clave URL + nombre de archivo esperado dentro de assets/<carpeta>/
const BANNER_TYPES = {
    directos:      { key: 'BANNER_DIRECTOS_URL',     file: 'panel_directos.png' },
    stream:        { key: 'BANNER_DIRECTOS_URL',     file: 'panel_directos.png' },
    streamers:     { key: 'BANNER_DIRECTOS_URL',     file: 'panel_directos.png' },
    eventos:       { key: 'BANNER_EVENTOS_URL',      file: 'panel_eventos.png' },
    valoraciones:  { key: 'BANNER_VALORACIONES_URL', file: 'panel_valoracion.png' },
    valoracion:    { key: 'BANNER_VALORACIONES_URL', file: 'panel_valoracion.png' },
    tops:          { key: 'BANNER_TOPS_URL',         file: 'panel_tops.png' },
    sanciones:     { key: 'BANNER_SANCIONES_URL',    file: 'panel_sanciones.png' },
    plantillas:    { key: 'BANNER_PLANTILLAS_URL',   file: 'panel_postulaciones.png' },
    postulaciones: { key: 'BANNER_PLANTILLAS_URL',   file: 'panel_postulaciones.png' },
    bienvenida:    { key: 'BANNER_BIENVENIDA_URL',   file: 'banner_bienvenida.png' },
    bienvenidas:   { key: 'BANNER_BIENVENIDA_URL',   file: 'banner_bienvenida.png' },
    consultas:     { key: 'BANNER_CONSULTAS_URL',    file: 'banner_consultas.png' },
    aprobado:      { key: 'BANNER_APROBADO_URL',     file: 'aprobado.png' },
    denegado:      { key: 'BANNER_DENEGADO_URL',     file: 'denegado.png' }
};

function normalizeSlug(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function loadLocalFile() {
    try {
        if (fs.existsSync(GUILD_CONFIGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(GUILD_CONFIGS_FILE, 'utf8'));
            for (const [gid, cfg] of Object.entries(data)) {
                if (cfg && typeof cfg === 'object') {
                    guildCache.set(gid, { ...(guildCache.get(gid) || {}), ...cfg });
                }
            }
        }
    } catch (e) {
        console.error('⚠️ [GUILD MANAGER] Error leyendo guild_configs.json:', e.message);
    }
}

function persistLocalFile() {
    try {
        const obj = {};
        for (const [gid, cfg] of guildCache.entries()) {
            obj[gid] = cfg;
        }
        fs.writeFileSync(GUILD_CONFIGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ [GUILD MANAGER] Error guardando guild_configs.json:', e.message);
    }
}

function initGuildManager({ client, getPrimaryConfig, updatePrimaryConfig }) {
    discordClientRef = client;
    if (typeof getPrimaryConfig === 'function') primaryConfigGetter = getPrimaryConfig;
    if (typeof updatePrimaryConfig === 'function') primaryConfigUpdater = updatePrimaryConfig;
    loadLocalFile();
}

function detectPrimaryGuildId() {
    if (primaryGuildId) return primaryGuildId;
    if (!discordClientRef || !discordClientRef.guilds) return null;

    for (const guild of discordClientRef.guilds.cache.values()) {
        for (const chId of PRIMARY_HINT_CHANNELS) {
            if (guild.channels.cache.has(chId)) {
                primaryGuildId = guild.id;
                console.log(`🏠 [MULTI-SERVER] Servidor principal (Vallecas RP) identificado: ${guild.name} (${guild.id})`);
                return primaryGuildId;
            }
        }
    }
    return null;
}

function isPrimaryGuild(guildId) {
    if (!guildId) return true;
    const pId = detectPrimaryGuildId();
    if (!pId) return false;
    return String(guildId) === String(pId);
}

// Agrupa y sincroniza el perfil completo de Vallecas RP en MongoDB bajo su propio guildId
async function ensurePrimaryGuildProfileInMongo() {
    const pId = detectPrimaryGuildId();
    if (!pId) return;
    const guild = discordClientRef?.guilds?.cache?.get(pId);
    const mergedPrimary = {
        BRAND_NAME: 'VALLECAS RP',
        BRAND_COLOR: '#D900FF',
        ASSETS_FOLDER: '',
        ...(primaryConfigGetter() || {}),
        ...(guildCache.get(pId) || {})
    };
    guildCache.set(pId, mergedPrimary);
    persistLocalFile();

    if (mongoose.connection.readyState === 1) {
        try {
            await GuildProfileModel.findOneAndUpdate(
                { guildId: String(pId) },
                {
                    $set: {
                        guildId: String(pId),
                        guildName: guild?.name || 'VALLECAS RP',
                        isPrimary: true,
                        config: mergedPrimary
                    }
                },
                { upsert: true }
            );
            console.log(`🗄️ [MULTI-SERVER] Perfil de Vallecas RP agrupado en MongoDB (guildId: ${pId}).`);
        } catch (e) {
            console.error('⚠️ [MULTI-SERVER] Error agrupando Vallecas RP en MongoDB:', e.message);
        }
    }
}

// Crea automáticamente las colecciones limpias dentro de una DB dedicada (ej. vilacityrp_db) sin tocar spainrp_db
async function ensureDedicatedDatabaseExists(dbName) {
    if (!dbName || mongoose.connection.readyState !== 1) return;
    try {
        const db = mongoose.connection.useDb(dbName, { useCache: true }).db;
        if (!db) return;
        const requiredCols = ['guildprofiles', 'normativadocs', 'ticketknowledges', 'sanciones', 'eventos', 'streamers', 'valoraciones'];
        const existing = (await db.listCollections().toArray()).map(c => c.name);
        for (const col of requiredCols) {
            if (!existing.includes(col)) {
                await db.createCollection(col).catch(() => {});
            }
        }
        console.log(`🗄️ [MULTI-SERVER] Base de datos dedicada lista en Atlas: ${dbName} (${requiredCols.length} colecciones).`);
    } catch (e) {
        console.error(`⚠️ [MULTI-SERVER] Error inicializando DB ${dbName}:`, e.message);
    }
}

async function syncGuildProfilesFromMongo() {
    if (mongoose.connection.readyState !== 1) return;
    try {
        // Asegurar que la DB dedicada de VilacityRP exista lista y limpia desde el arranque
        await ensureDedicatedDatabaseExists('vilacityrp_db');

        const docs = await GuildProfileModel.find().lean();
        for (const doc of docs) {
            if (doc.guildId && doc.config) {
                guildCache.set(doc.guildId, { ...(guildCache.get(doc.guildId) || {}), ...doc.config });
            }
        }
        persistLocalFile();
        console.log(`🌐 [MULTI-SERVER] Sincronizados ${docs.length} perfiles de servidores desde MongoDB.`);
    } catch (e) {
        console.error('⚠️ [MULTI-SERVER] Error sincronizando perfiles desde MongoDB:', e.message);
    }
}

/**
 * Busca la carpeta privada de assets de un servidor:
 * 1) Si tiene `ASSETS_FOLDER` configurada (ej. `!setcarpeta MadridRP`) -> `assets/MadridRP/`
 * 2) Autodetecta cualquier subcarpeta dentro de `assets/` cuyo nombre coincida con el nombre del servidor
 *    (o con `BRAND_NAME`), ignorando mayúsculas, tildes, espacios y emojis.
 * 3) También comprueba `assets/guilds/<GUILD_ID>/`.
 */
function findGuildAssetsDir(guildId, cfg = {}) {
    if (!guildId || isPrimaryGuild(guildId)) return ASSETS_DIR;

    // 1. Carpeta explícita guardada en BD (!setcarpeta <nombre>)
    if (cfg.ASSETS_FOLDER && cfg.ASSETS_FOLDER.trim()) {
        const explicitDir = path.join(ASSETS_DIR, cfg.ASSETS_FOLDER.trim());
        if (fs.existsSync(explicitDir) && fs.statSync(explicitDir).isDirectory()) {
            return explicitDir;
        }
    }

    // 2. Carpeta por ID en assets/guilds/<guildId>
    const byGuildId = path.join(ASSETS_DIR, 'guilds', String(guildId));
    if (fs.existsSync(byGuildId) && fs.statSync(byGuildId).isDirectory()) {
        return byGuildId;
    }

    // 3. Autodetección por nombre de carpeta en assets/<NombreDelServidor>
    const guild = discordClientRef?.guilds?.cache?.get(guildId);
    const targets = [
        normalizeSlug(cfg.ASSETS_FOLDER),
        normalizeSlug(cfg.BRAND_NAME),
        normalizeSlug(guild?.name)
    ].filter(Boolean);

    if (targets.length > 0 && fs.existsSync(ASSETS_DIR)) {
        try {
            const entries = fs.readdirSync(ASSETS_DIR, { withFileTypes: true });
            for (const ent of entries) {
                if (!ent.isDirectory() || ent.name === 'guilds') continue;
                const slug = normalizeSlug(ent.name);
                if (slug && targets.some(t => t === slug || t.includes(slug) || slug.includes(t))) {
                    return path.join(ASSETS_DIR, ent.name);
                }
            }
        } catch (e) { }
    }

    return null;
}

function findImageInDir(dirPath, baseFilename) {
    if (!dirPath || !fs.existsSync(dirPath)) return null;
    const exact = path.join(dirPath, baseFilename);
    if (fs.existsSync(exact)) return { fullPath: exact, name: baseFilename };

    // Probar extensiones alternativas (.png, .jpg, .jpeg, .webp, .gif)
    const stem = baseFilename.replace(/\.[^.]+$/, '');
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
        const candidate = path.join(dirPath, stem + ext);
        if (fs.existsSync(candidate)) return { fullPath: candidate, name: stem + ext };
    }
    return null;
}

function getGuildConfig(guildId) {
    if (!guildId || isPrimaryGuild(guildId)) {
        const base = primaryConfigGetter() || {};
        const overrides = guildId ? (guildCache.get(guildId) || {}) : {};
        return { ...base, ...overrides };
    }

    const existing = guildCache.get(guildId) || {};
    const guild = discordClientRef?.guilds?.cache?.get(guildId);
    return {
        BRAND_NAME: guild?.name ? guild.name.toUpperCase() : 'MI SERVIDOR RP',
        BRAND_COLOR: '#D900FF',
        ASSETS_FOLDER: '',
        PREFIX: '!',
        FIVEM_CFX_CODE: '',
        FIVEM_SERVER_IP: '',
        CHANNEL_SOLICITUDES_ID: '',
        CHANNEL_APROBADOS_ID: '',
        CHANNEL_DENEGADOS_ID: '',
        CHANNEL_STREAM_PANEL_ID: '',
        CHANNEL_STREAMERS_ID: '',
        CHANNEL_NORMATIVAS_ID: '',
        CHANNEL_TICKETS_ID: '',
        CHANNEL_GENERAL_ID: '',
        CHANNEL_VALORACION_PANEL_ID: '',
        CHANNEL_VALORACIONES_ID: '',
        CHANNEL_SANCIONES_ID: '',
        CHANNEL_SANCIONES_PANEL_ID: '',
        CHANNEL_EVENTOS_ID: '',
        CHANNEL_EVENTOS_2_ID: '',
        CHANNEL_EVENTOS_PANEL_ID: '',
        CHANNEL_BIENVENIDAS_ID: '',
        CHANNEL_CONSULTAS_STAFF_ID: '',
        CHANNEL_CONSULTAS_USERS_ID: '',
        CHANNEL_CONSULTAS_LOGS_ID: '',
        ROLE_STAFF_ID: '',
        ROLE_STREAMER_ID: '',
        ...existing
    };
}

async function setGuildConfigKey(guildId, key, value) {
    const primary = !guildId || isPrimaryGuild(guildId);
    const targetGuildId = guildId || detectPrimaryGuildId();

    if (primary) {
        await primaryConfigUpdater(key, value);
    }

    if (targetGuildId) {
        const guild = discordClientRef?.guilds?.cache?.get(targetGuildId);
        const cur = primary
            ? { ...(primaryConfigGetter() || {}), ...(guildCache.get(targetGuildId) || {}), [key]: value }
            : { ...(guildCache.get(targetGuildId) || {}), [key]: value };
        cur.updatedAt = new Date().toISOString();
        guildCache.set(targetGuildId, cur);
        persistLocalFile();

        if (mongoose.connection.readyState === 1) {
            try {
                // 1. Guardar en el índice maestro de perfiles (para recuperar al reiniciar)
                await GuildProfileModel.findOneAndUpdate(
                    { guildId: String(targetGuildId) },
                    {
                        $set: {
                            guildId: String(targetGuildId),
                            guildName: guild?.name || cur.BRAND_NAME || '',
                            isPrimary: primary,
                            config: cur
                        }
                    },
                    { upsert: true }
                );

                // 2. Si es un servidor independiente (ej. VilacityRP), replicar también en SU PROPIA DB dedicada (ej. vilacityrp_db)
                if (!primary) {
                    const DedicatedProfile = getGuildModel(targetGuildId, 'GuildProfile', guildProfileSchema);
                    await DedicatedProfile.findOneAndUpdate(
                        { guildId: String(targetGuildId) },
                        {
                            $set: {
                                guildId: String(targetGuildId),
                                guildName: guild?.name || cur.BRAND_NAME || '',
                                isPrimary: false,
                                config: cur
                            }
                        },
                        { upsert: true }
                    );
                }
            } catch (e) {
                console.error(`⚠️ [MULTI-SERVER] Error guardando en MongoDB (${targetGuildId}):`, e.message);
            }
        }
    }

    if (!primary && ['CHANNEL_CONSULTAS_STAFF_ID', 'CHANNEL_CONSULTAS_USERS_ID', 'CHANNEL_CONSULTAS_LOGS_ID'].includes(key)) {
        if (discordClientRef && typeof discordClientRef.updateConsultasChannelForGuild === 'function') {
            discordClientRef.updateConsultasChannelForGuild(guildId, key, value);
        }
    }

    console.log(`💾 [MULTI-SERVER ${targetGuildId || 'primary'}] ${key} = ${value}`);
}

async function setGuildConfigBulk(guildId, partialObj) {
    if (!guildId || !partialObj || typeof partialObj !== 'object') return;
    for (const [k, v] of Object.entries(partialObj)) {
        await setGuildConfigKey(guildId, k, v);
    }
}

function resolveGuildVisuals(guildId, bannerType = null) {
    const primary = isPrimaryGuild(guildId);
    const cfg = getGuildConfig(guildId);
    const guild = guildId ? discordClientRef?.guilds?.cache?.get(guildId) : null;
    const assetsDir = findGuildAssetsDir(guildId, cfg);

    const name = primary
        ? (cfg.BRAND_NAME || 'VALLECAS RP')
        : (cfg.BRAND_NAME || (guild?.name ? guild.name.toUpperCase() : 'MI SERVIDOR RP'));

    const hexRaw = (cfg.BRAND_COLOR || '#D900FF').trim();
    const colorInt = /^#[0-9a-f]{6}$/i.test(hexRaw) ? parseInt(hexRaw.slice(1), 16) : 0xD900FF;

    const files = [];
    let logoUrl = null;

    if (cfg.LOGO_URL && /^https?:\/\//i.test(cfg.LOGO_URL)) {
        logoUrl = cfg.LOGO_URL.trim();
    } else {
        const logoFile = findImageInDir(assetsDir, 'logo.png');
        if (logoFile) {
            files.push(new AttachmentBuilder(logoFile.fullPath, { name: logoFile.name }));
            logoUrl = `attachment://${logoFile.name}`;
        } else {
            logoUrl = guild?.iconURL?.({ size: 256 }) || discordClientRef?.user?.displayAvatarURL?.() || undefined;
        }
    }

    let bannerUrl = null;
    if (bannerType && BANNER_TYPES[bannerType]) {
        const info = BANNER_TYPES[bannerType];
        if (cfg[info.key] && /^https?:\/\//i.test(cfg[info.key])) {
            bannerUrl = cfg[info.key].trim();
        } else {
            const bannerFile = findImageInDir(assetsDir, info.file);
            if (bannerFile) {
                files.push(new AttachmentBuilder(bannerFile.fullPath, { name: bannerFile.name }));
                bannerUrl = `attachment://${bannerFile.name}`;
            }
        }
    }

    return {
        isPrimary: primary,
        assetsDir,
        name,
        color: colorInt,
        colorHex: hexRaw,
        logoUrl,
        bannerUrl,
        files,
        config: cfg
    };
}

function getAllSecondaryGuildConfigs() {
    const out = {};
    for (const [gid, cfg] of guildCache.entries()) {
        if (!isPrimaryGuild(gid)) out[gid] = cfg;
    }
    return out;
}

module.exports = {
    BANNER_TYPES,
    initGuildManager,
    detectPrimaryGuildId,
    isPrimaryGuild,
    getGuildDbName,
    getGuildDb,
    getGuildModel,
    ensurePrimaryGuildProfileInMongo,
    syncGuildProfilesFromMongo,
    findGuildAssetsDir,
    getGuildConfig,
    setGuildConfigKey,
    setGuildConfigBulk,
    resolveGuildVisuals,
    getAllSecondaryGuildConfigs
};
