import { createInterface } from 'node:readline';
import process from 'node:process';
import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';

import { loadLatestAccount } from './wechat/accounts.js';
import { startQrLogin, waitForQrScan, displayQrInTerminal } from './wechat/login.js';
import { createMonitor, type MonitorCallbacks } from './wechat/monitor.js';
import { createSender } from './wechat/send.js';
import { extractText, extractFirstImageUrl } from './wechat/media.js';
import { createSessionStore, type Session } from './session.js';
import { createPermissionBroker } from './permission.js';
import { routeCommand, type CommandContext, type CommandResult } from './commands/router.js';
import { openCodeQuery, initOpenCode, getOpenCodeClient, type QueryOptions } from './opencode/provider.js';
import { loadConfig, saveConfig } from './config.js';
import { logger } from './logger.js';
import { DATA_DIR } from './constants.js';
import { MessageType, type WeixinMessage } from './wechat/types.js';
import { WeChatApi } from './wechat/api.js';
import { downloadImage } from './wechat/media.js';
import type { AccountData } from './wechat/accounts.js';

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

async function runSetup(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log('正在设置...\n');

  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();

    console.log('请用微信扫描下方二维码：\n');
    await displayQrInTerminal(qrcodeUrl);

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

  const workingDir = await promptUser('请输入工作目录', process.cwd());
  const config = loadConfig();
  config.workingDirectory = workingDir;
  saveConfig(config);

  console.log('\n运行 npm run daemon 启动服务');
}

const processingMsgIds = new Set<string>();

async function runDaemon(): Promise<void> {
  const config = loadConfig();
  const account = loadLatestAccount();

  if (!account) {
    console.error('未找到账号，请先运行 node dist/main.js setup');
    process.exit(1);
  }

  console.log('正在连接 OpenCode 服务...');
  try {
    await initOpenCode(config.workingDirectory);
    console.log('✅ OpenCode 服务已连接');
  } catch (err) {
    console.error('\n' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
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
      await handleMessage(msg, account, session, sessionStore, permissionBroker, sender, config, sharedCtx, api);
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
  api: WeChatApi,
): Promise<void> {
  if (msg.message_type !== MessageType.USER) return;
  if (!msg.from_user_id || !msg.item_list) return;

  const msgId = `${msg.from_user_id}-${msg.context_token}`;
  if (processingMsgIds.has(msgId)) {
    logger.warn('Message already being processed, skipping', { msgId });
    return;
  }
  processingMsgIds.add(msgId);
  setTimeout(() => processingMsgIds.delete(msgId), 60000);

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

    const result: CommandResult = await routeCommand(ctx);

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
        api,
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
    api,
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
  api: WeChatApi,
): Promise<void> {
  session.state = 'processing';
  sessionStore.save(account.accountId, session);

  sessionStore.addChatMessage(session, 'user', userText || '(图片)');

  let typingClientId: string | null = null;
  let typingTicket = '';
  
  try {
    const configResp = await api.getConfig(fromUserId, contextToken);
    typingTicket = configResp.typing_ticket || '';
  } catch (err) {
    logger.warn('Failed to get typing ticket', { error: err });
  }
  
  if (typingTicket) {
    try {
      typingClientId = await sender.sendTyping(fromUserId, typingTicket);
    } catch (err) {
      logger.warn('Failed to send typing indicator', { error: err });
    }
  }

  let typingKeepalive: ReturnType<typeof setInterval> | null = null;
  if (typingTicket) {
    typingKeepalive = setInterval(async () => {
      if (typingClientId) {
        try {
          await sender.sendTyping(fromUserId, typingTicket);
          logger.debug('Typing keepalive sent');
        } catch (err) {
          logger.warn('Failed to send typing keepalive', { error: err });
        }
      }
    }, 5000);
  }

  try {
    const cwd = session.workingDirectory || config.workingDirectory;
    let sessionId = session.sessionsByCwd[cwd];

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
      cwd,
      resume: sessionId,
      model: session.model,
      permissionMode: effectivePermissionMode,
      images,
      title: sessionTitle,
    };

    let result = await openCodeQuery(queryOptions);

    if (typingClientId && typingTicket) {
      try {
        await sender.stopTyping(fromUserId, typingTicket, typingClientId);
      } catch (err) {
        logger.warn('Failed to stop typing indicator', { error: err });
      }
      typingClientId = null;
    }
    
    if (typingKeepalive) {
      clearInterval(typingKeepalive);
      typingKeepalive = null;
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
    if (typingClientId && typingTicket) {
      try {
        await sender.stopTyping(fromUserId, typingTicket, typingClientId);
      } catch {}
      typingClientId = null;
    }
    
    if (typingKeepalive) {
      clearInterval(typingKeepalive);
      typingKeepalive = null;
    }
    
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Error in sendToOpenCode', { error: errorMsg });
    await sender.sendText(fromUserId, contextToken, '⚠️ 处理消息时出错，请稍后重试。');

    session.state = 'idle';
    sessionStore.save(account.accountId, session);
  }
}

const command = process.argv[2];

function showHelp(): void {
  console.log(`
wechat-opencode-bot - 微信接入 OpenCode

用法:
  npm run setup          扫码绑定微信
  npm run daemon:start   启动服务
  npm run daemon:stop    停止服务
  npm run daemon:status  查看状态

或直接:
  node dist/main.js --setup   扫码绑定微信
  node dist/main.js --start   启动服务
  node dist/main.js --stop    停止服务
  node dist/main.js --status  查看状态
`);
}

function getPidFile(): string {
  return join(DATA_DIR, 'daemon.pid');
}

function getDaemonStatus(): { running: boolean; pid?: number } {
  const pidFile = getPidFile();
  if (!existsSync(pidFile)) {
    return { running: false };
  }
  
  try {
    const pidStr = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      return { running: false };
    }
    
    try {
      process.kill(pid, 0);
      return { running: true, pid };
    } catch {
      return { running: false };
    }
  } catch {
    return { running: false };
  }
}

function findProcessOnPort(port: number): number | null {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid)) return pid;
        }
      }
    } else {
      const output = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' });
      const pid = parseInt(output.trim(), 10);
      if (!isNaN(pid)) return pid;
    }
  } catch {}
  return null;
}

function stopOpenCodeService(): void {
  const OPENCODE_PORT = 4096;
  const pid = findProcessOnPort(OPENCODE_PORT);
  
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`已停止 OpenCode 服务 (端口: ${OPENCODE_PORT}, PID: ${pid})`);
    } catch (err) {
      console.error(`停止 OpenCode 服务失败: ${err}`);
    }
  } else {
    console.log(`未发现运行在端口 ${OPENCODE_PORT} 的 OpenCode 服务`);
  }
}

function runStop(): void {
  // 先停止 OpenCode 服务（无论 bot 是否运行）
  stopOpenCodeService();
  
  const status = getDaemonStatus();
  
  if (!status.running) {
    console.log('wechat-opencode-bot 未在后台运行');
    return;
  }
  
  try {
    process.kill(status.pid!, 'SIGTERM');
    console.log(`已停止 wechat-opencode-bot (PID: ${status.pid})`);
  } catch (err) {
    console.error(`停止 wechat-opencode-bot 失败: ${err}`);
  }
  
  const pidFile = getPidFile();
  if (existsSync(pidFile)) {
    try {
      unlinkSync(pidFile);
    } catch {}
  }
}

function runStatus(): void {
  const status = getDaemonStatus();
  
  if (status.running) {
    console.log(`wechat-opencode-bot 运行中 (PID: ${status.pid})`);
  } else {
    console.log('wechat-opencode-bot 未运行');
  }
  
  const OPENCODE_PORT = 4096;
  const opencodePid = findProcessOnPort(OPENCODE_PORT);
  if (opencodePid) {
    console.log(`OpenCode 服务运行中 (端口: ${OPENCODE_PORT}, PID: ${opencodePid})`);
  } else {
    console.log(`OpenCode 服务未运行 (端口: ${OPENCODE_PORT})`);
  }
}

if (command === '--setup' || command === 'setup') {
  runSetup().catch((err) => {
    logger.error('Setup failed', { error: err instanceof Error ? err.message : String(err) });
    console.error('设置失败:', err);
    process.exit(1);
  });
} else if (command === '--start' || command === 'start' || !command) {
  const status = getDaemonStatus();
  if (status.running) {
    console.log(`wechat-opencode-bot 已在后台运行 (PID: ${status.pid})`);
    process.exit(0);
  }
  
  if (process.platform === 'win32') {
    try {
      const command = `Start-Process -FilePath "node" -ArgumentList "dist/main.js","--daemon" -WorkingDirectory "${process.cwd()}" -WindowStyle Hidden`;
      execSync(`powershell.exe -Command "${command}"`, {
        stdio: 'ignore',
        shell: 'powershell.exe'
      });
      console.log('wechat-opencode-bot 已在后台启动');
      process.exit(0);
    } catch (e) {
      console.error('启动失败:', e);
    }
  }
  
  console.log('正在后台启动 wechat-opencode-bot...');
  
  const pidFile = getPidFile();
  
  runDaemon().catch((err) => {
    logger.error('Daemon start failed', { error: err instanceof Error ? err.message : String(err) });
    console.error('启动失败:', err);
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
    process.exit(1);
  });
} else if (command === '--daemon') {
  const pidFile = getPidFile();
  
  const config = loadConfig();
  console.log(`工作目录: ${config.workingDirectory}`);
  console.log(`进程目录: ${process.cwd()}`);
  console.log(`PID: ${process.pid}`);
  
  try {
    writeFileSync(pidFile, String(process.pid), 'utf-8');
    console.log(`wechat-opencode-bot 已启动 (PID: ${process.pid})`);
  } catch (err) {
    console.error('保存 PID 失败:', err);
  }
  
  runDaemon().catch((err) => {
    logger.error('Daemon failed', { error: err instanceof Error ? err.message : String(err) });
    console.error('运行失败:', err);
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }
    process.exit(1);
  });
} else if (command === '--stop' || command === 'stop') {
  runStop();
} else if (command === '--status' || command === 'status') {
  runStatus();
} else if (command === '--help' || command === '-h') {
  showHelp();
} else {
  console.error(`未知命令: ${command}`);
  showHelp();
  process.exit(1);
}