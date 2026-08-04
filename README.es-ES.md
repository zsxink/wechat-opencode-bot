# wechat-opencode-bot

English | [中文](README_zh.md)

Un servicio puente que conecta WeChat con OpenCode. Chatea con OpenCode desde tu teléfono a través de WeChat — texto, imágenes, aprobaciones de permisos, comandos con barra oblique, todo compatible.

## Características

- Conversación por texto con OpenCode a través de WeChat
- Reconocimiento de imágenes — envía fotos para que OpenCode las analice
- Aprobación de permisos — responde `y`/`n` en WeChat para controlar la ejecución de herramientas
- Comandos con barra oblique — `/help`, `/cwd`, `/ls`, `/new`, `/sessions`, `/model`, `/models`, `/status`, `/skills`
- Multiplataforma — macOS, Linux, Windows
- Persistencia de sesión — reanuda el contexto entre mensajes
- Gestión de sesiones basada en directorios — cada directorio tiene su propia sesión de OpenCode

## Requisitos previos

- Node.js >= 18
- macOS, Linux o Windows
- Cuenta personal de WeChat (requiere vinculación mediante código QR)
- [OpenCode](https://opencode.ai) instalado y en ejecución localmente (localhost:4096 por defecto)

## Instalación

Clona en un directorio local:

```bash
git clone <repo> ~/wechat-opencode-bot
cd ~/wechat-opencode-bot
npm install
```

El script `postinstall` compilará automáticamente TypeScript.

## Inicio rápido

### 1. Configuración inicial

Vincula tu cuenta de WeChat mediante un código QR:

```bash
npm run setup
```

Se mostrará un código QR en la terminal — escánalo con WeChat y luego configura tu directorio de trabajo.

### 2. Iniciar el servicio

```bash
npm run daemon:start
```

### 3. Chatear en WeChat

Simplemente envía mensajes en WeChat para chatear con OpenCode.

### 4. Gestionar el servicio

```bash
npm run daemon:start    # Iniciar el servicio (se ejecuta en segundo plano)
npm run daemon:stop     # Detener el servicio
npm run daemon:status   # Comprobar el estado de ejecución
```

## Comandos de WeChat

### Gestión de sesiones

| Comando | Descripción |
|---------|-------------|
| `/help` | Mostrar ayuda |
| `/clear` | Limpiar la sesión actual |
| `/new [título]` | Crear nueva sesión (limpiar contexto), título opcional |
| `/sessions` | Listar las sesiones de OpenCode en el directorio actual |
| `/session <n|ID>` | Cambiar a la sesión por número (empezando en 1) o ID |
| `/compact` | Compactar el contexto (iniciar nueva sesión SDK, mantener historial) |
| `/history [n]` | Ver historial de chat (últimas 20 por defecto) |
| `/undo [n]` | Deshacer los últimos n mensajes (1 por defecto) |

### Directorio de trabajo

| Comando | Descripción |
|---------|-------------|
| `/cwd [ruta]` | Cambiar el directorio de trabajo (admite rutas relativas/absolutas) |
| `/ls` | Listar el contenido del directorio actual |

### Configuración

| Comando | Descripción |
|---------|-------------|
| `/model [id]` | Ver o cambiar el modelo |
| `/models` | Listar los modelos disponibles |
| `/permission [modo]` | Ver o cambiar el modo de permiso |
| `/status` | Mostrar el estado de la sesión actual |

### Otros

| Comando | Descripción |
|---------|-------------|
| `/skills` | Listar las habilidades disponibles de OpenCode |
| `/version` | Mostrar información de la versión |

## Directorio de trabajo

- El directorio inicial se establece mediante `workingDirectory` en `config.env`
- `/cwd` admite rutas relativas (`a`, `../b`) y rutas absolutas
- `/cwd` crea automáticamente directorios que no existen
- El cambio de directorio está limitado al directorio de trabajo definido en `config.env`
- Cada directorio tiene su propia sesión de OpenCode

Ejemplos:

```
/cwd a              # Cambiar al subdirectorio a
/cwd ../b           # Cambiar al directorio hermano b
/cwd /home/user     # Cambiar a ruta absoluta (debe estar dentro del directorio base)
```

## Aprobación de permisos

Cuando OpenCode solicita ejecutar una herramienta, recibirás una solicitud de permiso en WeChat:

- Responde `y` o `yes` para permitir
- Responde `n` o `no` para denegar
- No responder en 120 segundos deniega automáticamente

Cambia el modo de permiso con `/permission <modo>`:

| Modo | Descripción |
|------|-------------|
| `default` | Aprobación manual para cada uso de herramienta |
| `acceptEdits` | Aprobar automáticamente ediciones de archivos, otros necesitan aprobación |
| `plan` | Modo solo lectura, sin herramientas permitidas |
| `auto` | Aprobar automáticamente todas las herramientas (modo peligroso) |

## Cómo funciona

```
WeChat (teléfono) ←→ ilink bot API ←→ Node.js daemon ←→ OpenCode service
```

- El daemon escucha nuevos mensajes mediante la API de bot ilink de WeChat (long polling)
- Los mensajes se reenvían a OpenCode mediante la API HTTP
- Las respuestas se envían de vuelta a WeChat

## Directorio de datos

Todos los datos se almacenan en `~/.wechat-opencode-bot/`:

```
~/.wechat-opencode-bot/
├── accounts/       # Credenciales de cuenta de WeChat (un JSON por cuenta)
├── config.env      # Configuración global (directorio de trabajo, modelo, modo de permiso)
├── sessions/       # Datos de sesión (un JSON por cuenta)
├── get_updates_buf # Búfer de sincronización de sondeo de mensajes
├── logs/           # Registros de ejecución (rotación diaria)
└── daemon.pid      # PID del proceso daemon
```

## Desarrollo

```bash
npm run dev    # Modo de observación — compila automáticamente al cambiar TypeScript
npm run build  # Compilar TypeScript
```

## Licencia

[MIT](LICENSE)
