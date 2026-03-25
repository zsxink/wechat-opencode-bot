# 微信接入 OpenCode 服务设计文档

**项目名称**: opencode-wechat-bridge  
**版本**: 1.0.0  
**日期**: 2026-03-24

---

## 1. 项目概述

### 1.1 目标

创建一个独立的守护进程服务，通过微信（ClawBot/ilink 协议）连接 OpenCode。用户可以通过手机微信与 OpenCode 进行对话，完成代码开发等任务。

### 1.2 技术选型

- **语言**: TypeScript + Node.js
- **微信协议**: 直接实现 ilink bot API（复用 wechat-claude-code 的协议实现）
- **AI 后端**: `@opencode-ai/sdk`
- **进程管理**: 支持 macOS launchd、Linux systemd、nohup 回退

### 1.3 架构图

```
┌─────────────┐     ilink API      ┌─────────────────┐
│  微信客户端  │ ←────────────────→│  opencode-wechat │
│  (手机微信)  │   长轮询/发送      │     -bridge      │
└─────────────┘                   └────────┬────────┘
                                           │
                                           ↓
                                   ┌─────────────────┐
                                   │  @opencode-ai    │
                                   │      SDK         │
                                   └────────┬────────┘
                                           │
                                           ↓
                                   ┌─────────────────┐
                                   │   OpenCode       │
                                   │   Server         │
                                   └─────────────────┘
```

---

## 2. 功能清单

### 2.1 基础功能

| 功能 | 描述 |
|------|------|
| 扫码登录 | 首次运行时通过二维码绑定微信账号 |
| 消息收发 | 接收用户文字/图片消息，回复文字 |
| 图片识别 | 接收图片后调用 OpenCode 分析 |
| 权限审批 | 用户回复 y/n 审批工具执行 |
| 会话持久化 | 保存对话上下文，跨消息恢复 |

### 2.2 命令功能

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除当前会话，重新开始 |
| `/status` | 查看当前会话状态 |
| `/model <name>` | 切换 OpenCode 模型 |
| `/permission <mode>` | 切换权限模式（default/acceptEdits/plan/auto）|
| `/skills` | 列出可用的 OpenCode 技能 |
| `/<skill> [args]` | 触发指定技能 |
| `/new` | 新建一个会话（清空当前上下文）|

### 2.3 管理命令（命令行）

| 命令 | 描述 |
|------|------|
| `npm run setup` | 扫码绑定微信账号 |
| `npm run daemon -- start` | 启动守护进程 |
| `npm run daemon -- stop` | 停止守护进程 |
| `npm run daemon -- restart` | 重启守护进程 |
| `npm run daemon -- status` | 查看运行状态 |
| `npm run daemon -- logs` | 查看最近日志 |

---

## 3. 数据结构

### 3.1 目录结构

```
~/.opencode-wechat-bridge/
├── accounts/           # 微信账号凭证（每个账号一个 JSON）
│   └── <account-id>.json
├── config.env          # 全局配置（工作目录、默认模型、权限模式）
├── sessions/           # 会话数据
│   └── <account-id>.json
├── get_updates_buf    # 消息轮询同步缓冲
└── logs/              # 运行日志（每日轮转，保留 30 天）
```

### 3.2 账号数据结构

```typescript
interface AccountData {
  accountId: string;      // ilink_bot_id (如 "xxx@im.bot")
  botToken: string;       // 认证 token
  baseUrl: string;        // ilink API 基础 URL
  userId: string;         // 微信用户 ID
}
```

### 3.3 会话数据结构

```typescript
interface Session {
  state: 'idle' | 'processing' | 'waiting_permission';
  workingDirectory: string;
  model: string;
  permissionMode: string;
  sdkSessionId?: string;  // OpenCode SDK 会话 ID
}
```

---

## 4. 模块设计

### 4.1 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| main.ts | src/main.ts | CLI 入口、setup/daemon 模式分发 |
| wechat/api.ts | src/wechat/api.ts | ilink API 封装（getUpdates/sendMessage）|
| wechat/login.ts | src/wechat/login.ts | 二维码登录流程 |
| wechat/monitor.ts | src/wechat/monitor.ts | 长轮询消息监听 |
| wechat/send.ts | src/wechat/send.ts | 消息发送（文本/媒体）|
| wechat/media.ts | src/wechat/media.ts | 图片下载、加解密 |
| wechat/accounts.ts | src/wechat/accounts.ts | 账号存储与加载 |
| wechat/crypto.ts | src/wechat/crypto.ts | AES-128-ECB 加密/解密 |
| wechat/cdn.ts | src/wechat/cdn.ts | CDN 上传/下载 |
| wechat/types.ts | src/wechat/types.ts | 微信消息类型定义 |
| opencode/provider.ts | src/opencode/provider.ts | OpenCode SDK 封装 |
| session.ts | src/session.ts | 会话存储与管理 |
| permission.ts | src/permission.ts | 权限审批逻辑 |
| commands/router.ts | src/commands/router.ts | 命令路由 |
| commands/handlers.ts | src/commands/handlers.ts | 命令处理 |
| config.ts | src/config.ts | 配置加载/保存 |
| logger.ts | src/logger.ts | 日志管理 |

### 4.2 消息流程

```
微信消息 → monitor.run() 长轮询
       ↓
    onMessage 回调
       ↓
  提取文本/图片 → 判断命令（/开头）
       ↓
    命令路由 → commands/router.ts
       ↓
   普通消息 → opencode/provider.ts → client.session.prompt()
       ↓
    处理权限回调 → permission.ts → 发送权限请求到微信
       ↓
    获取响应 → 拆分长消息 → send.ts 发送回微信
```

### 4.3 权限流程

```
SDK 请求工具 → canUseTool 回调
       ↓
设置 session.state = 'waiting_permission'
       ↓
发送权限请求到微信: "是否允许执行 xxx 工具？"
       ↓
用户回复 y/n → permission.ts 处理
       ↓
返回结果给 SDK → 继续执行或拒绝
```

---

## 5. API 对接细节

### 5.1 OpenCode SDK 使用

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
});

// 发送消息
const result = await client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: userMessage }],
    // 图片支持
    // images: [...]
  },
});
```

### 5.2 权限回调

```typescript
const sdkOptions = {
  canUseTool: async (toolName, toolInput) => {
    // 发送权限请求到微信
    await sender.sendText(userId, contextToken, `请求执行 ${toolName}`);
    // 等待用户回复 y/n
    return await permissionBroker.createPending(...);
  },
};
```

---

## 6. 安装与部署

### 6.1 安装

```bash
# 克隆项目
git clone <repo> ~/.opencode-wechat-bridge
cd ~/.opencode-wechat-bridge
npm install
```

### 6.2 首次设置

```bash
npm run setup
# 弹出二维码 → 微信扫码绑定
# 输入工作目录
```

### 6.3 启动服务

```bash
# macOS
npm run daemon -- start

# Linux
npm run daemon -- start
```

---

## 7. 兼容性

- Node.js >= 18
- macOS / Linux（Windows 通过 WSL）
- OpenCode 服务需在本地运行（默认 localhost:4096）

---

## 8. 待定事项

- [ ] OpenCode SDK 会话复用策略
- [ ] 媒体文件（除图片外）的处理（语音/视频/文件）
- [ ] 多账号支持
- [ ] 错误恢复与重试机制