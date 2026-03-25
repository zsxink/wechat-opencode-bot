# 微信接入 OpenCode 服务实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建独立的守护进程服务，通过微信连接 OpenCode，实现聊天式代码开发

**Architecture:** 基于 wechat-claude-code 协议层，复用微信 ilink API，替换 AI SDK 为 @opencode-ai/sdk

**Tech Stack:** TypeScript, Node.js, @opencode-ai/sdk, ilink bot API

---

## 文件结构

```
opencode-wechat-bridge/
├── package.json
├── tsconfig.json
├── scripts/
│   └── daemon.sh
└── src/
    ├── main.ts                    (新建 - 入口文件)
    ├── opencode/
    │   └── provider.ts            (新建 - OpenCode SDK 封装)
    ├── commands/
    │   ├── router.ts              (修改 - 添加 /new, /skills)
    │   └── handlers.ts            (修改 - 添加命令处理)
    ├── wechat/                    (已复制 - 11个文件)
    ├── permission.ts              (修改 - 适配 OpenCode)
    ├── session.ts                 (已复制 - 需修改数据目录)
    ├── logger.ts                  (已复制)
    ├── config.ts                  (已复制)
    └── constants.ts               (修改 - 数据目录)
```

---

## Task 1: 修改 constants.ts - 更新数据目录

**Files:**
- Modify: `src/constants.ts:4`

- [ ] **Step 1: 修改数据目录**

```typescript
export const DATA_DIR = process.env.OWB_DATA_DIR || join(homedir(), '.opencode-wechat-bridge');
```

- [ ] **Step 2: 提交**

```bash
git add src/constants.ts
git commit -m "chore: rename data dir to .opencode-wechat-bridge"
```

---

## Task 2: 创建 opencode/provider.ts - OpenCode SDK 封装

**Files:**
- Create: `src/opencode/provider.ts`

- [ ] **Step 1: 创建 SDK 封装文件**

```typescript
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { logger } from "../logger.js";

export interface QueryOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  permissionMode?: "default" | "acceptEdits" | "plan" | "auto";
  images?: Array<{
    type: "image";
    source: { type: "base64"; media_type: string; data: string };
  }>;
  onPermissionRequest?: (toolName: string, toolInput: string) => Promise<boolean>;
}

export interface QueryResult {
  text: string;
  sessionId: string;
  error?: string;
}

let client: ReturnType<typeof createOpencodeClient> | null = null;
let serverProcess: { close: () => void } | null = null;

export async function initOpenCode(): Promise<void> {
  try {
    const opencode = await createOpencode({
      hostname: "127.0.0.1",
      port: 4096,
      timeout: 10000,
    });
    client = opencode.client;
    serverProcess = opencode.server;
    logger.info("OpenCode client initialized");
  } catch (err) {
    logger.error("Failed to initialize OpenCode client", { error: String(err) });
    throw err;
  }
}

export async function createOpenCodeClientOnly(): Promise<ReturnType<typeof createOpencodeClient>> {
  if (!client) {
    client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });
  }
  return client;
}

export async function openCodeQuery(options: QueryOptions): Promise<QueryResult> {
  if (!client) {
    await initOpenCode();
  }

  const { prompt, cwd, resume, model, images } = options;

  logger.info("Starting OpenCode query", {
    cwd,
    model,
    resume: !!resume,
    hasImages: !!images?.length,
  });

  try {
    // 确保 OpenCode 服务已启动
    if (!client) {
      client = await createOpenCodeClientOnly();
    }

    // 创建或复用会话
    let sessionId = resume;
    if (!sessionId) {
      const session = await client.session.create({
        body: { title: "WeChat Bridge Session" },
      });
      sessionId = session.info.id;
    }

    // 构建消息 parts
    const parts: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [
      { type: "text", text: prompt },
    ];

    if (images?.length) {
      for (const img of images) {
        parts.push({
          type: "image",
          source: img.source,
        });
      }
    }

    // 发送消息
    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        model: model ? { providerID: "anthropic", modelID: model } : undefined,
      },
    });

    // 提取响应文本
    let text = "";
    if (result.parts) {
      text = result.parts
        .filter((p: any) => p.type === "text" && p.text)
        .map((p: any) => p.text)
        .join("\n");
    }

    logger.info("OpenCode query completed", {
      sessionId,
      textLength: text.length,
    });

    return {
      text,
      sessionId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("OpenCode query failed", { error: errorMessage });
    return {
      text: "",
      sessionId: "",
      error: errorMessage,
    };
  }
}

export function getOpenCodeClient(): ReturnType<typeof createOpencodeClient> | null {
  return client;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/opencode/provider.ts
git commit -m "feat: add OpenCode SDK provider"
```

---

## Task 3: 创建 main.ts - 入口文件

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: 创建 main.ts**

```typescript
import { createInterface } from 'node:readline';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { unlinkSync, writeFileSync, mkdirSync } from 'node:fs';

import { WeChatApi } from './wechat/api.js';
import { saveAccount, loadLatestAccount, type AccountData } from './wechat/accounts.js';
import { startQrLogin, waitForQrScan } from './wechat/login.js';
import { createMonitor, type MonitorCallbacks } from './wechat/monitor.js';
import { createSender } from './wechat/send.js';
import { downloadImage, extractText, extractFirstImageUrl } from './wechat/media.js';
import { createSessionStore, type Session } from './session.js';
import { createPermissionBroker } from './permission.js';
import { routeCommand, type CommandContext, type CommandResult } from './commands/router.js';
import { openCodeQuery, initOpenCode, getOpenCodeClient, type QueryOptions } from './opencode/provider.js';
import { loadConfig, saveConfig } from './config.js';
import { logger } from './logger.js';
import { DATA_DIR } from './constants.js';
import { MessageType, type WeixinMessage } from './wechat/types.js';

const MAX_MESSAGE_LENGTH = 2048;

function splitMessage(text: string, maxLen: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');
  }
  return chunks;
}

function promptUser(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const display = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(display, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function openFile(filePath: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [filePath];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', filePath];
  } else {
    cmd = 'xdg-open';
    args = [filePath];
  }

  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  if (result.error) {
    logger.warn('Failed to open file', { cmd, filePath, error: result.error.message });
  }
}

async function runSetup(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const QR_PATH = join(DATA_DIR, 'qrcode.png');

  console.log('正在设置...\n');

  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();

    const isHeadlessLinux = process.platform === 'linux' &&
      !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

    if (isHeadlessLinux) {
      try {
        const qrcodeTerminal = await import('qrcode-terminal');
        console.log('请用微信扫描下方二维码：\n');
        qrcodeTerminal.default.generate(qrcodeUrl, { small: true });
        console.log();
        console.log('二维码链接：', qrcodeUrl);
        console.log();
      } catch {
        logger.warn('qrcode-terminal not available, falling back to URL');
        console.log('无法在终端显示二维码，请访问链接：');
        console.log(qrcodeUrl);
        console.log();
      }
    } else {
      const QRCode = await import('qrcode');
      const pngData = await QRCode.toBuffer(qrcodeUrl, { type: 'png', width: 400, margin: 2 });
      writeFileSync(QR_PATH, pngData);
      openFile(QR_PATH);
      console.log('已打开二维码图片，请用微信扫描：');
      console.log(`图片路径: ${QR_PATH}\n`);
    }

    console.log('等待扫码绑定...');

    try {
      await waitForQrScan(qrcodeId);
      console.log('✅ 绑定成功!');
      break;
    } catch (err: any) {
      if (err.message?.includes('expired')) {
        console.log('⚠️ 二维码已过期，正在刷新...\n');
        continue;
      }
      throw err;
    }
  }

  try { unlinkSync(QR_PATH); } catch {
    logger.warn('Failed to clean up QR image', { path: QR_PATH });
  }

  const workingDir = await promptUser('请输入工作目录', process.cwd());
  const config = loadConfig();
  config.workingDirectory = workingDir;
  saveConfig(config);

  console.log('\n运行 npm run daemon -- start 启动服务');
}

async function runDaemon(): Promise<void> {
  const config = loadConfig();
  const account = loadLatestAccount();

  if (!account) {
    console.error('未找到账号，请先运行 node dist/main.js setup');
    process.exit(1);
  }

  // 初始化 OpenCode
  console.log('正在连接 OpenCode 服务...');
  try {
    await initOpenCode();
    console.log('✅ OpenCode 服务已连接');
  } catch (err) {
    console.error('⚠️ OpenCode 服务连接失败，请确保 opencode 已安装并运行');
    console.error('错误:', err);
  }

  const api = new WeChatApi(account.botToken, account.baseUrl);
  const sessionStore = createSessionStore();
  const session: Session = sessionStore.load(account.accountId);

  if (config.workingDirectory && session.workingDirectory === process.cwd()) {
    session.workingDirectory = config.workingDirectory;
    sessionStore.save(account.accountId, session);
  }

  const sender = createSender(api, account.accountId);
  const sharedCtx = { lastContextToken: '' };
  const permissionBroker = createPermissionBroker(async () => {
    try {
      await sender.sendText(account.userId ?? '', sharedCtx.lastContextToken, '⏰ 权限请求超时，已自动拒绝。');
    } catch {
      logger.warn('Failed to send permission timeout message');
    }
  });

  const callbacks: MonitorCallbacks = {
    onMessage: async (msg: WeixinMessage) => {
      await handleMessage(msg, account, session, sessionStore, permissionBroker, sender, config, sharedCtx);
    },
    onSessionExpired: () => {
      logger.warn('Session expired, will keep retrying...');
      console.error('⚠️ 微信会话已过期，请重新运行 setup 扫码绑定');
    },
  };

  const monitor = createMonitor(api, callbacks);

  function shutdown(): void {
    logger.info('Shutting down...');
    monitor.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Daemon started', { accountId: account.accountId });
  console.log(`已启动 (账号: ${account.accountId})`);

  await monitor.run();
}

async function handleMessage(
  msg: WeixinMessage,
  account: AccountData,
  session: Session,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
  sender: ReturnType<typeof createSender>,
  config: ReturnType<typeof loadConfig>,
  sharedCtx: { lastContextToken: string },
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;
  if (!msg.from_user_id || !msg.item_list) return;

  const contextToken = msg.context_token ?? '';
  const fromUserId = msg.from_user_id;
  sharedCtx.lastContextToken = contextToken;

  const userText = extractTextFromItems(msg.item_list);
  const imageItem = extractFirstImageUrl(msg.item_list);

  if (session.state === 'processing') {
    if (userText.startsWith('/clear')) {
      await sender.sendText(fromUserId, contextToken, '⏳ 正在处理上一条消息，请稍后再清除会话');
    } else if (!userText.startsWith('/')) {
      await sender.sendText(fromUserId, contextToken, '⏳ 正在处理上一条消息，请稍后...');
    }
    if (!userText.startsWith('/status') && !userText.startsWith('/help')) return;
  }

  if (session.state === 'idle' && permissionBroker.isTimedOut(account.accountId)) {
    const lower = userText.toLowerCase();
    if (lower === 'y' || lower === 'yes' || lower === 'n' || lower === 'no') {
      permissionBroker.clearTimedOut(account.accountId);
      await sender.sendText(fromUserId, contextToken, '⏰ 权限请求已超时，请重新发送你的请求。');
      return;
    }
  }

  if (session.state === 'waiting_permission') {
    const pendingPerm = permissionBroker.getPending(account.accountId);
    if (!pendingPerm) {
      session.state = 'idle';
      sessionStore.save(account.accountId, session);
      await sender.sendText(fromUserId, contextToken, '⚠️ 权限请求已失效（可能因服务重启），请重新发送你的请求。');
      return;
    }

    const lower = userText.toLowerCase();
    if (lower === 'y' || lower === 'yes') {
      const resolved = permissionBroker.resolvePermission(account.accountId, true);
      await sender.sendText(fromUserId, contextToken, resolved ? '✅ 已允许' : '⚠️ 权限请求处理失败，可能已超时');
    } else if (lower === 'n' || lower === 'no') {
      const resolved = permissionBroker.resolvePermission(account.accountId, false);
      await sender.sendText(fromUserId, contextToken, resolved ? '❌ 已拒绝' : '⚠️ 权限请求处理失败，可能已超时');
    } else {
      await sender.sendText(fromUserId, contextToken, '正在等待权限审批，请回复 y 或 n。');
    }
    return;
  }

  if (userText.startsWith('/')) {
    const updateSession = (partial: Partial<Session>) => {
      Object.assign(session, partial);
      sessionStore.save(account.accountId, session);
    };

    const ctx: CommandContext = {
      accountId: account.accountId,
      session,
      updateSession,
      clearSession: () => sessionStore.clear(account.accountId),
      getChatHistoryText: (limit?: number) => sessionStore.getChatHistoryText(session, limit),
      rejectPendingPermission: () => permissionBroker.rejectPending(account.accountId),
      text: userText,
      opencodeClient: getOpenCodeClient(),
    };

    const result: CommandResult = routeCommand(ctx);

    if (result.handled && result.reply) {
      await sender.sendText(fromUserId, contextToken, result.reply);
      return;
    }

    if (result.handled && result.claudePrompt) {
      await sendToOpenCode(
        result.claudePrompt,
        imageItem,
        fromUserId,
        contextToken,
        account,
        session,
        sessionStore,
        permissionBroker,
        sender,
        config,
      );
      return;
    }

    if (result.handled) {
      return;
    }
  }

  if (!userText && !imageItem) {
    await sender.sendText(fromUserId, contextToken, '暂不支持此类型消息，请发送文字或图片');
    return;
  }

  await sendToOpenCode(
    userText,
    imageItem,
    fromUserId,
    contextToken,
    account,
    session,
    sessionStore,
    permissionBroker,
    sender,
    config,
  );
}

function extractTextFromItems(items: NonNullable<WeixinMessage['item_list']>): string {
  return items.map((item) => extractText(item)).filter(Boolean).join('\n');
}

async function sendToOpenCode(
  userText: string,
  imageItem: ReturnType<typeof extractFirstImageUrl>,
  fromUserId: string,
  contextToken: string,
  account: AccountData,
  session: Session,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
  sender: ReturnType<typeof createSender>,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  session.state = 'processing';
  sessionStore.save(account.accountId, session);

  sessionStore.addChatMessage(session, 'user', userText || '(图片)');

  try {
    let images: QueryOptions['images'];
    if (imageItem) {
      const base64DataUri = await downloadImage(imageItem);
      if (base64DataUri) {
        const matches = base64DataUri.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          images = [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: matches[1],
                data: matches[2],
              },
            },
          ];
        }
      }
    }

    const effectivePermissionMode = session.permissionMode ?? config.permissionMode;

    const queryOptions: QueryOptions = {
      prompt: userText || '请分析这张图片',
      cwd: session.workingDirectory || config.workingDirectory,
      resume: session.sdkSessionId,
      model: session.model,
      permissionMode: effectivePermissionMode,
      images,
    };

    let result = await openCodeQuery(queryOptions);

    if (result.error) {
      logger.error('OpenCode query error', { error: result.error });
      await sender.sendText(fromUserId, contextToken, '⚠️ OpenCode 处理请求时出错，请稍后重试。');
    } else if (result.text) {
      sessionStore.addChatMessage(session, 'assistant', result.text);

      const chunks = splitMessage(result.text);
      for (const chunk of chunks) {
        await sender.sendText(fromUserId, contextToken, chunk);
      }
    } else {
      await sender.sendText(fromUserId, contextToken, 'ℹ️ OpenCode 无返回内容');
    }

    session.sdkSessionId = result.sessionId || undefined;
    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error in sendToOpenCode', { error: errorMsg });
    await sender.sendText(fromUserId, contextToken, '⚠️ 处理消息时出错，请稍后重试。');

    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  }
}

const command = process.argv[2];

if (command === 'setup') {
  runSetup().catch((err) => {
    logger.error('Setup failed', { error: err instanceof Error ? err.message : String(err) });
    console.error('设置失败:', err);
    process.exit(1);
  });
} else {
  runDaemon().catch((err) => {
    logger.error('Daemon start failed', { error: err instanceof Error ? err.message : String(err) });
    console.error('启动失败:', err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: 提交**

```bash
git add src/main.ts
git commit -m "feat: add main entry point"
```

---

## Task 4: 修改 commands/router.ts - 添加 OpenCode 相关字段

**Files:**
- Modify: `src/commands/router.ts`

- [ ] **Step 1: 添加 opencodeClient 字段到 CommandContext**

```typescript
// 在 CommandContext 接口中添加
opencodeClient?: ReturnType<typeof createOpencodeClient> | null;
```

- [ ] **Step 2: 提交**

```bash
git add src/commands/router.ts
git commit -m "feat: add opencodeClient to command context"
```

---

## Task 5: 修改 commands/handlers.ts - 添加 /new, /skills 命令

**Files:**
- Modify: `src/commands/handlers.ts`

- [ ] **Step 1: 查看现有 handlers 结构**

读取现有文件内容...

- [ ] **Step 2: 添加 /new 命令处理**

在 handlers.ts 中添加：

```typescript
// /new - 新建会话
async function handleNew(ctx: CommandContext): Promise<CommandResult> {
  ctx.clearSession();
  return {
    handled: true,
    reply: '🆕 已创建新会话，上下文已清空。',
  };
}
```

- [ ] **Step 3: 添加 /skills 命令处理**

```typescript
// /skills - 列出可用技能
async function handleSkills(ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.opencodeClient) {
    return {
      handled: true,
      reply: '⚠️ OpenCode 服务未连接',
    };
  }

  try {
    const agents = await ctx.opencodeClient.app.agents();
    const skillList = agents.data.map((a: any) => `- ${a.name}: ${a.description || '无描述'}`).join('\n');
    return {
      handled: true,
      reply: `📋 可用技能：\n${skillList || '暂无技能'}`,
    };
  } catch (err) {
    return {
      handled: true,
      reply: `⚠️ 获取技能列表失败: ${String(err)}`,
    };
  }
}
```

- [ ] **Step 4: 更新 router.ts 中的路由映射**

添加新命令到 switch 语句...

- [ ] **Step 5: 提交**

```bash
git add src/commands/handlers.ts src/commands/router.ts
git commit -m "feat: add /new and /skills commands"
```

---

## Task 6: 验证项目编译

**Files:**
- Run: `npm run build`

- [ ] **Step 1: 安装依赖并编译**

```bash
cd opencode-wechat-bridge
npm install
npm run build
```

- [ ] **Step 2: 检查是否有编译错误**

如果有错误，修复并重新编译...

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "build: project compiles successfully"
```

---

## Task 7: 更新 package.json 的依赖版本

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 检查 @opencode-ai/sdk 可用版本**

```bash
npm view @opencode-ai/sdk versions
```

- [ ] **Step 2: 更新 package.json 中的版本**

```json
"@opencode-ai/sdk": "^x.x.x"
```

- [ ] **Step 3: 提交**

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-03-24-wechat-opencode-bridge-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**