# wechat-opencode-bot

English | [中文](README_zh.md)

A bridge service that connects WeChat to OpenCode. Chat with OpenCode from your phone via WeChat — text, images, permission approvals, slash commands, all supported.

## Features

- Text conversation with OpenCode via WeChat
- Image recognition — send photos for OpenCode to analyze
- Permission approval — reply `y`/`n` in WeChat to control tool execution
- Slash commands — `/help`, `/cwd`, `/ls`, `/new`, `/sessions`, `/model`, `/models`, `/status`, `/skills`
- Cross-platform — macOS, Linux, Windows
- Session persistence — resume context across messages
- Directory-based session management — each directory has its own OpenCode session

## Prerequisites

- Node.js >= 18
- macOS, Linux or Windows
- Personal WeChat account (requires QR code binding)
- [OpenCode](https://opencode.ai) installed and running locally (default localhost:4096)

## Installation

Clone to a local directory:

```bash
git clone <repo> ~/wechat-opencode-bot
cd ~/wechat-opencode-bot
npm install
```

The `postinstall` script will automatically compile TypeScript.

## Quick Start

### 1. First-time Setup

Bind your WeChat account via QR code:

```bash
npm run setup
```

A QR code will display in terminal — scan it with WeChat, then configure your working directory.

### 2. Start the Service

```bash
npm run daemon:start
```

### 3. Chat in WeChat

Simply send messages in WeChat to chat with OpenCode.

### 4. Manage the Service

```bash
npm run daemon:start    # Start the service (runs in background)
npm run daemon:stop     # Stop the service
npm run daemon:status   # Check running status
```

## WeChat Commands

### Session Management

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear current session |
| `/new [title]` | Create new session (clear context), optional title |
| `/sessions` | List OpenCode sessions in current directory |
| `/session <n|ID>` | Switch to session by number (1-based) or ID |
| `/compact` | Compact context (start new SDK session, keep history) |
| `/history [n]` | View chat history (default last 20) |
| `/undo [n]` | Undo last n messages (default 1) |

### Working Directory

| Command | Description |
|---------|-------------|
| `/cwd [path]` | Switch working directory (supports relative/absolute paths) |
| `/ls` | List current directory contents |

### Configuration

| Command | Description |
|---------|-------------|
| `/model [id]` | View or switch model |
| `/models` | List available models |
| `/permission [mode]` | View or switch permission mode |
| `/status` | Show current session status |

### Other

| Command | Description |
|---------|-------------|
| `/skills` | List available OpenCode skills |
| `/version` | Show version info |

## Working Directory

- Initial directory is set by `workingDirectory` in `config.env`
- `/cwd` supports relative paths (`a`, `../b`) and absolute paths
- `/cwd` auto-creates directories that don't exist
- Directory switching is limited to within `config.env` working directory
- Each directory has its own OpenCode session

Examples:

```
/cwd a              # Switch to subdirectory a
/cwd ../b           # Switch to sibling directory b
/cwd /home/user     # Switch to absolute path (must be within base directory)
```

## Permission Approval

When OpenCode requests to execute a tool, you receive a permission request in WeChat:

- Reply `y` or `yes` to allow
- Reply `n` or `no` to deny
- No reply within 120 seconds auto-denies

Switch permission mode with `/permission <mode>`:

| Mode | Description |
|------|-------------|
| `default` | Manual approval for every tool use |
| `acceptEdits` | Auto-approve file edits, others need approval |
| `plan` | Read-only mode, no tools allowed |
| `auto` | Auto-approve all tools (dangerous mode) |

## How It Works

```
WeChat (phone) ←→ ilink bot API ←→ Node.js daemon ←→ OpenCode service
```

- Daemon listens for new messages via long-polling WeChat ilink bot API
- Messages forwarded to OpenCode via HTTP API
- Replies sent back to WeChat

## Data Directory

All data stored in `~/.wechat-opencode-bot/`:

```
~/.wechat-opencode-bot/
├── accounts/       # WeChat account credentials (one JSON per account)
├── config.env      # Global config (working directory, model, permission mode)
├── sessions/       # Session data (one JSON per account)
├── get_updates_buf # Message polling sync buffer
├── logs/           # Runtime logs (daily rotation)
└── daemon.pid      # Daemon process PID
```

## Development

```bash
npm run dev    # Watch mode — auto-compile on TypeScript changes
npm run build  # Compile TypeScript
```

## License

[MIT](LICENSE)