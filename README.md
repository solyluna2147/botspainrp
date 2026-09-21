# 🤖 Bot de Whitelist para Discord (FiveM / SPAIN RP)

Bot automatizado para leer solicitudes de Whitelist de bots de formularios (ej. King), detectar si fueron **Aprobadas** o **Denegadas** y enviar automáticamente un **Embed (contenedor estilizado)** con mención al usuario en el canal correspondiente.

Preparado con **Express** para alojarlo en **Render 24/7** gratis.

---

## 🚀 Paso 1: Configurar el Bot en Discord Developer Portal

1. Ve a [Discord Developer Portal](https://discord.com/developers/applications).
2. Haz clic en **New Application**, ponle nombre (ej: `SPAIN RP - Notificador WL`).
3. Ve a la pestaña **Bot**:
   - En **Privileged Gateway Intents**, activa las 3 casillas:
     - ✅ **Presence Intent**
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent** *(¡Muy importante para leer el contenido/embeds de las solicitudes!)*
   - Haz clic en **Reset Token** y copia tu `DISCORD_TOKEN`.
4. Ve a **OAuth2 -> URL Generator**:
   - Selecciona `bot` y `applications.commands`.
   - Permisos de bot: `Administrator` (o `Read Messages/View Channels`, `Send Messages`, `Embed Links`, `Read Message History`).
   - Copia el enlace generado e invita el bot a tu servidor de Discord.

---

## ⚙️ Paso 2: Obtener los IDs de los Canales en Discord

Activa el **Modo Desarrollador** en Discord (*Ajustes de Discord -> Avanzado -> Modo Desarrollador*):
- Clic derecho en el canal de solicitudes -> **Copiar ID del canal** (`CHANNEL_SOLICITUDES_ID`).
- Clic derecho en el canal de aprobados -> **Copiar ID del canal** (`CHANNEL_APROBADOS_ID`).
- Clic derecho en el canal de denegados (opcional) -> **Copiar ID del canal** (`CHANNEL_DENEGADOS_ID`).

---

## 🎮 Comandos Disponibles

- **`!aprobar @usuario`** *(o `!aprobado @usuario`, `!aprobar ID`)*: Envía el anuncio oficial de Whitelist Aprobada mencionando al usuario y mostrando qué Staff lo aprobó.
- **`!denegar @usuario`** *(o `!denegado @usuario`, `!denegar ID`)*: Envía el anuncio oficial de Whitelist Denegada mencionando al usuario y mostrando qué Staff lo denegó.
- **`!borrar`**: Elimina el último mensaje del bot (o responde a cualquier mensaje con `!borrar` para eliminar ese mensaje específico).
- **`!simular @usuario`**: Crea una tarjeta de solicitud pendiente de prueba con botones interactivos de Aprobar y Denegar.
- **`!wl-ayuda`**: Muestra la lista de comandos disponibles.

---

## ☁️ Paso 3: Subir a Render (24/7 Gratis)

1. Sube este proyecto a tu repositorio de **GitHub**.
2. Ve a [Render.com](https://render.com) e inicia sesión con tu cuenta de GitHub.
3. Haz clic en **New +** -> **Web Service**.
4. Conecta el repositorio de GitHub de este bot.
5. Configura los siguientes campos:
   - **Name:** `bot-whitelist-spainrp`
   - **Language / Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
6. Ve a la sección **Environment Variables** (Variables de Entorno) y añade:
   - `DISCORD_TOKEN` = `tu_token_de_discord`
   - `CHANNEL_SOLICITUDES_ID` = `ID_del_canal_solicitudes`
   - `CHANNEL_APROBADOS_ID` = `ID_del_canal_aprobados`
   - `CHANNEL_DENEGADOS_ID` = `ID_del_canal_denegados` (opcional)
7. Haz clic en **Deploy Web Service**.

> 💡 **Para mantener Render 24/7 despierto en el plan gratuito:**  
> Copia la URL pública que te da Render (ej: `https://bot-wl.onrender.com`) y regístrala gratis en [UptimeRobot.com](https://uptimerobot.com) con un monitor HTTP cada 5 o 10 minutos.
