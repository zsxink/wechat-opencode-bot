# 会话隔离与工作目录管理实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现微信 OpenCode Bot 的会话隔离、正在输入状态显示和消息队列处理

**Architecture:** 修改 Session 结构支持按工作目录存储会话，添加新命令，优化消息处理流程

**Tech Stack:** TypeScript, Node.js, OpenCode SDK

---

## 文件结构

### 核心修改文件

1. **src/session.ts** - 会话存储结构和逻辑
2. **src/opencode/provider.ts** - OpenCode API 调用
3. **src/main.ts** - 主逻辑和消息处理
4. **src/commands/handlers.ts** - 命令处理
5. **src/wechat/send.ts** - 消息发送（已修改）

### 测试文件

- 需要添加单元测试验证会话隔离逻辑

---

## Task 1: 修改 Session 接口和存储结构

**Files:**
- Modify: `src/session.ts`

- [ ] **Step 1: 修改 Session 接口**

```typescript
export interface Session {
  // 新的：按工作目录存储会话
  sessionsByCwd: Record<string, string>;  // { "/path/to/project": "session-id-123" }
  
  // 微信创建的会话 ID 列表
  wechatSessions: string[];
  
  // 会话标题映射（用于显示）
  sessionTitles: Record<string, string>;  // { "session-id-123": "微信: 你好世界..." }
  
  workingDirectory: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'auto';
  state: SessionState;
  chatHistory: ChatMessage[];
  maxHistoryLength?: number;
  
  // 废弃字段（用于数据迁移）
  sdkSessionId?: string;
}
```

- [ ] **Step 2: 修改 load 函数支持数据迁移**

```typescript
function load(accountId: string): Session {
  validateAccountId(accountId);
  const session = loadJson<Session>(getSessionPath(accountId), {
    sessionsByCwd: {},
    wechatSessions: [],
    sessionTitles: {},
    workingDirectory: process.cwd(),
    state: 'idle',
    chatHistory: [],
    maxHistoryLength: DEFAULT_MAX_HISTORY,
  });

  // 向后兼容：确保新字段存在
  if (!session.sessionsBywd) {
    session.sessionsByCwd = {};
  }
  if (!session.wechatSessions) {
    session.wechatSessions = [];
  }
  if (!session.sessionTitles) {
    session.sessionTitles = {};
  }

  // 数据迁移：从旧的 sdkSessionId 迁移到 sessionsByCwd
  if (session.sdkSessionId && Object.keys(session.sessionsByCwd).length === 0) {
    const cwd = session.workingDirectory || process.cwd();
    session.sessionsByCwd[cwd] = session.sdkSessionId;
    session.wechatSessions.push(session.sdkSessionId);
    session.sessionTitles[session.sdkSessionId] = '迁移的会话';
    delete session.sdkSessionId;
    logger.info('Migrated sdkSessionId to sessionsByCwd', { cwd, sessionId: session.sessionsByCwd[cwd] });
  }

  // 向后兼容：确保 chatHistory 存在
  if (!session.chatHistory) {
    session.chatHistory = [];
  }
  if (!session.maxHistoryLength) {
    session.maxHistoryLength = DEFAULT_MAX_HISTORY;
  }

  return session;
}
```

- [ ] **Step 3: 添加辅助函数**

```typescript
export function getSessionForCwd(session: Session, cwd: string): string | undefined {
  return session.sessionsByCwd[cwd];
}

export function setSessionForCwd(session: Session, cwd: string, sessionId: string, title?: string): void {
  session.sessionsByCwd[cwd] = sessionId;
  if (!session.wechatSessions.includes(sessionId)) {
    session.wechatSessions.push(sessionId);
  }
  if (title) {
    session.sessionTitles[sessionId] = title;
  }
}

export function removeSessionForCwd(session: Session, cwd: string): void {
  const sessionId = session.sessionsByCwd[cwd];
  if (sessionId) {
    delete session.sessionsByCwd[cwd];
    // 注意：不从 wechatSessions 中删除，保留历史记录
  }
}

export function getWechatSessionList(session: Session): Array<{id: string, title: string, cwd: string}> {
  const result: Array<{id: string, title: string, cwd: string}> = [];
  for (const [cwd, sessionId] of Object.entries(session.sessionsByCwd)) {
    if (session.wechatSessions.includes(sessionId)) {
      result.push({
        id: sessionId,
        title: session.sessionTitles[sessionId] || '未命名会话',
        cwd
      });
    }
  }
  return result;
}
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add src/session.ts
git commit -m "refactor: 修改 Session 接口支持按工作目录存储会话"
```

---

## Task 2: 修改 OpenCode Provider 支持会话标题

**Files:**
- Modify: `src/opencode/provider.ts`

- [ ] **Step 1: 修改 createSession 函数支持标题**

```typescript
async function createSession(title: string): Promise<string> {
  logger.info("Creating OpenCode session", { title });
  const res = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  logger.info("Session create response", { status: res.status, contentType: res.headers.get("content-type") });
  if (!res.ok) {
    const text = await res.text();
    logger.error("Session create failed", { status: res.status, body: text });
    throw new Error(`Failed to create session: ${res.status} - ${text}`);
  }
  const data = await res.json() as any;
  logger.info("Session created", { id: data.id });
  return data.id;
}
```

- [ ] **Step 2: 修改 openCodeQuery 支持自定义标题**

```typescript
export async function openCodeQuery(options: QueryOptions & { title?: string }): Promise<QueryResult> {
  const { prompt, cwd, resume, model, images, title } = options;

  logger.info("Starting OpenCode query", {
    cwd,
    model,
    resume: !!resume,
    hasImages: !!images?.length,
    title
  });

  try {
    let sessionId = resume || "";
    if (!sessionId) {
      const sessionTitle = title || "微信: 会话";
      sessionId = await createSession(sessionTitle);
    }

    // ... 其余代码保持不变
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("OpenCode query failed", { error: errorMessage });
    return { text: "", sessionId: "", error: errorMessage };
  }
}
```

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/opencode/provider.ts
git commit -m "feat: 支持自定义会话标题"
```

---

## Task 3: 修改 sendToOpenCode 使用新的会话逻辑

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 修改 sendToOpenCode 函数**

```typescript
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

  let typingClientId: string | null = null;
  
  try {
    typingClientId = await sender.sendTyping(fromUserId, contextToken);
  } catch (err) {
    logger.warn('Failed to send typing indicator', { error: err });
  }

  try {
    // 获取当前工作目录的会话 ID
    const cwd = session.workingDirectory || config.workingDirectory;
    let sessionId = session.sessionsByCwd[cwd];
    
    // 生成会话标题（使用用户消息前20字）
    let sessionTitle: string | undefined;
    if (!sessionId) {
      const userMessage = userText || '(图片)';
      const summary = userMessage.substring(0, 20) + (userMessage.length > 20 ? '...' : '');
      sessionTitle = `微信: ${summary}`;
    }

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
      cwd: cwd,
      resume: sessionId,
      model: session.model,
      permissionMode: effectivePermissionMode,
      images,
      title: sessionTitle,
    };

    let result = await openCodeQuery(queryOptions);

    if (typingClientId) {
      try {
        await sender.stopTyping(fromUserId, contextToken, typingClientId);
      } catch (err) {
        logger.warn('Failed to stop typing indicator', { error: err });
      }
      typingClientId = null;
    }

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

    // 保存会话 ID 到当前工作目录
    if (result.sessionId) {
      session.sessionsByCwd[cwd] = result.sessionId;
      if (!session.wechatSessions.includes(result.sessionId)) {
        session.wechatSessions.push(result.sessionId);
      }
      if (sessionTitle) {
        session.sessionTitles[result.sessionId] = sessionTitle;
      }
    }

    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  } catch (err) {
    if (typingClientId) {
      try {
        await sender.stopTyping(fromUserId, contextToken, typingClientId);
      } catch {}
    }
    
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error in sendToOpenCode', { error: errorMsg });
    await sender.sendText(fromUserId, contextToken, '⚠️ 处理消息时出错，请稍后重试。');

    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  }
}
```

- [ ] **Step 2: 构建验证**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 3: 提交**

```bash
git add src/main.ts
git commit -m "feat: 修改 sendToOpenCode 使用按工作目录的会话逻辑"
```

---

## Task 4: 添加 /sessions 和 /session 命令

**Files:**
- Modify: `src/commands/handlers.ts`
- Modify: `src/commands/router.ts`

- [ ] **Step 1: 在 handlers.ts 中添加 handleSessions 函数**

```typescript
import { getWechatSessionList } from '../session.js';

export function handleSessions(ctx: CommandContext): CommandResult {
  const sessions = getWechatSessionList(ctx.session);
  
  if (sessions.length === 0) {
    return { reply: '暂无微信会话记录', handled: true };
  }

  const lines = sessions.map((s, i) => 
    `${i + 1}. ${s.title}\n   ID: ${s.id}\n   目录: ${s.cwd}`
  );

  return { 
    reply: `📋 微信会话列表：\n\n${lines.join('\n\n')}\n\n使用 /session <ID> 切换会话`, 
    handled: true 
  };
}

export function handleSession(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    const currentCwd = ctx.session.workingDirectory;
    const currentSessionId = ctx.session.sessionsByCwd[currentCwd];
    const currentTitle = currentSessionId ? ctx.session.sessionTitles[currentSessionId] : '无';
    
    return { 
      reply: `当前会话：${currentTitle}\nID: ${currentSessionId || '无'}\n\n用法: /session <会话ID>`, 
      handled: true 
    };
  }

  const targetSessionId = args.trim();
  
  // 检查是否是微信创建的会话
  if (!ctx.session.wechatSessions.includes(targetSessionId)) {
    return { reply: '⚠️ 未找到该会话，只能切换微信创建的会话', handled: true };
  }

  // 查找会话对应的工作目录
  let targetCwd: string | undefined;
  for (const [cwd, sessionId] of Object.entries(ctx.session.sessionsByCwd)) {
    if (sessionId === targetSessionId) {
      targetCwd = cwd;
      break;
    }
  }

  if (!targetCwd) {
    return { reply: '⚠️ 未找到该会话对应的工作目录', handled: true };
  }

  // 切换工作目录和会话
  ctx.updateSession({ workingDirectory: targetCwd });
  
  const title = ctx.session.sessionTitles[targetSessionId] || '未命名会话';
  return { 
    reply: `✅ 已切换到会话：${title}\n工作目录: ${targetCwd}`, 
    handled: true 
  };
}
```

- [ ] **Step 2: 在 router.ts 中添加命令路由**

```typescript
import { handleHelp, handleClear, handleCwd, handleModel, handleModels, handlePermission, handleStatus, handleSkills, handleHistory, handleReset, handleCompact, handleUndo, handleVersion, handleUnknown, handleNew, handleSessions, handleSession } from './handlers.js';

// 在 switch 语句中添加
case 'sessions':
  return handleSessions(ctx);
case 'session':
  return handleSession(ctx, args);
```

- [ ] **Step 3: 更新帮助文本**

```typescript
const HELP_TEXT = `可用命令：

会话管理：
  /help             显示帮助
  /clear            清除当前会话
  /new              新建会话（清空上下文）
  /reset            完全重置（包括工作目录等设置）
  /status           查看当前会话状态
  /compact          压缩上下文（开始新 SDK 会话，保留历史）
  /history [数量]   查看对话记录（默认最近20条）
  /undo [数量]      撤销最近对话（默认1条）
  /sessions         查看微信会话列表
  /session <ID>     切换到指定会话

配置：
  /cwd [路径]       查看或切换工作目录
  /model [名称]     查看或切换 OpenCode 模型
  /models           列出可用的模型
  /permission [模式] 查看或切换权限模式

其他：
  /skills           列出可用的 OpenCode 技能
  /version          查看版本信息
  /<skill> [参数]   触发已安装的技能

直接输入文字即可与 OpenCode 对话`;
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 5: 提交**

```bash
git add src/commands/handlers.ts src/commands/router.ts
git commit -m "feat: 添加 /sessions 和 /session 命令"
```

---

## Task 5: 验证正在输入状态和消息队列处理

**Files:**
- Modify: `src/main.ts` (如果需要调整)

- [ ] **Step 1: 检查 sendTyping 实现**

确认 `src/wechat/send.ts` 中的 `sendTyping` 函数已添加占位符文本项：

```typescript
async function sendTyping(toUserId: string, contextToken: string): Promise<string> {
  const clientId = generateClientId();

  const items: MessageItem[] = [
    {
      type: MessageItemType.TEXT,
      text_item: { text: '' },
    },
  ];

  const msg: OutboundMessage = {
    from_user_id: botAccountId,
    to_user_id: toUserId,
    client_id: clientId,
    message_type: MessageType.BOT,
    message_state: MessageState.GENERATING,
    context_token: contextToken,
    item_list: items,
  };

  logger.info('Sending typing indicator', { toUserId, clientId });
  await api.sendMessage({ msg });
  logger.info('Typing indicator sent', { toUserId, clientId });
  return clientId;
}
```

- [ ] **Step 2: 检查消息队列处理**

确认 `handleMessage` 中的消息队列处理逻辑：

```typescript
if (session.state === 'processing') {
  if (userText.startsWith('/clear')) {
    await sender.sendText(fromUserId, contextToken, '⏳ 正在处理上一条消息，请稍后再清除会话');
  } else if (!userText.startsWith('/')) {
    await sender.sendText(fromUserId, contextToken, '⏳ 正在处理上一条消息，请稍后...');
  }
  if (!userText.startsWith('/status') && !userText.startsWith('/help')) return;
}
```

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 4: 提交**

```bash
git add src/main.ts
git commit -m "fix: 验证正在输入状态和消息队列处理"
```

---

## Task 6: 测试和集成验证

- [ ] **Step 1: 构建完整项目**

```bash
npm run build
```

Expected: 编译成功

- [ ] **Step 2: 启动服务测试**

```bash
npm run daemon:start
```

Expected: 服务启动成功，连接到 OpenCode

- [ ] **Step 3: 测试会话隔离**

1. 发送消息创建会话
2. 使用 `/cwd` 切换工作目录
3. 发送新消息，验证是否创建新会话
4. 使用 `/sessions` 查看会话列表
5. 使用 `/session <ID>` 切换会话

- [ ] **Step 4: 测试正在输入状态**

发送消息后，观察微信端是否显示"正在输入"标识

- [ ] **Step 5: 测试消息队列处理**

在 OpenCode 处理消息时，发送新消息，验证是否收到"正在处理上一条消息"的提示

- [ ] **Step 6: 最终提交**

```bash
git add .
git commit -m "feat: 完成会话隔离与工作目录管理功能"
```

---

## 检查清单

- [ ] 所有代码编译通过
- [ ] 会话按工作目录正确隔离
- [ ] 正在输入状态正常显示
- [ ] 消息队列处理正确
- [ ] /sessions 和 /session 命令正常工作
- [ ] 数据迁移逻辑正确
- [ ] 错误处理完善
