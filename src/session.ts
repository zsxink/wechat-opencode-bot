import { loadJson, saveJson } from './store.js';
import { mkdirSync } from 'node:fs';
import { DATA_DIR } from './constants.js';
import { join } from 'node:path';
import { logger } from './logger.js';

const SESSIONS_DIR = join(DATA_DIR, 'sessions');

function validateAccountId(accountId: string): void {
  if (!/^[a-zA-Z0-9_.@=-]+$/.test(accountId)) {
    throw new Error(`Invalid accountId: "${accountId}"`);
  }
}

export type SessionState = 'idle' | 'processing' | 'waiting_permission';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

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
  previousSdkSessionId?: string;
}

export interface PendingPermission {
  toolName: string;
  toolInput: string;
  resolve: (allowed: boolean) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_MAX_HISTORY = 100;

export function createSessionStore() {
  function getSessionPath(accountId: string): string {
    validateAccountId(accountId);
    return join(SESSIONS_DIR, `${accountId}.json`);
  }

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
    if (!session.sessionsByCwd) {
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

  function save(accountId: string, session: Session): void {
    mkdirSync(SESSIONS_DIR, { recursive: true });

    // Trim chat history if it exceeds max length before saving
    const maxLen = session.maxHistoryLength || DEFAULT_MAX_HISTORY;
    if (session.chatHistory.length > maxLen) {
      session.chatHistory = session.chatHistory.slice(-maxLen);
    }

    saveJson(getSessionPath(accountId), session);
  }

  function clear(accountId: string, currentSession?: Session): Session {
    const session: Session = {
      sessionsByCwd: {},
      wechatSessions: [],
      sessionTitles: {},
      workingDirectory: currentSession?.workingDirectory ?? process.cwd(),
      model: currentSession?.model,
      permissionMode: currentSession?.permissionMode,
      state: 'idle',
      chatHistory: [],
      maxHistoryLength: currentSession?.maxHistoryLength || DEFAULT_MAX_HISTORY,
    };
    save(accountId, session);
    return session;
  }

  function addChatMessage(session: Session, role: 'user' | 'assistant', content: string): void {
    if (!session.chatHistory) {
      session.chatHistory = [];
    }
    session.chatHistory.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Trim if exceeds max length
    const maxLen = session.maxHistoryLength || DEFAULT_MAX_HISTORY;
    if (session.chatHistory.length > maxLen) {
      session.chatHistory = session.chatHistory.slice(-maxLen);
    }
  }

  function getChatHistoryText(session: Session, limit?: number): string {
    const history = session.chatHistory || [];
    const messages = limit ? history.slice(-limit) : history;

    if (messages.length === 0) {
      return '暂无对话记录';
    }

    const lines: string[] = [];
    for (const msg of messages) {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      const role = msg.role === 'user' ? '用户' : 'Claude';
      lines.push(`[${time}] ${role}:`);
      lines.push(msg.content);
      lines.push('');
    }

    return lines.join('\n');
  }

  return { load, save, clear, addChatMessage, getChatHistoryText };
}

// Standalone helper functions for session management by cwd
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
