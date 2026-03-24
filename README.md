# wechat-opencode-bot

English | [中文](README_zh.md)

A bridge service that connects WeChat to OpenCode. Chat with OpenCode from your phone via WeChat — text, images, permission approvals, slash commands, all supported.

## Features

- Text conversation with OpenCode via WeChat
- Image recognition — send photos for OpenCode to analyze
- Permission approval — reply `y`/`n` in WeChat to control tool execution
- Slash commands — `/help`, `/clear`, `/new`, `/model`, `/models`, `/status`, `/skills`
- Cross-platform — macOS, Linux, Windows
- Session persistence — resume context across messages

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
npm run daemon:start    # Start the service
npm run daemon:stop     # Stop the service
npm run daemon:status   # Check running status
```

## WeChat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear current session |
| `/new` | Create new session (clear context) |
| `/model <name>` | Switch OpenCode model |
| `/models` | List available models |
| `/permission <mode>` | Switch permission mode |
| `/status` | Show current session status |
| `/skills` | List available OpenCode skills |

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
└── logs/           # Runtime logs (daily rotation)
```

## Development

```bash
npm run dev    # Watch mode — auto-compile on TypeScript changes
npm run build  # Compile TypeScript
```

## License

[MIT](LICENSE)
