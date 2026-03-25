import type { CommandContext, CommandResult } from './router.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWechatSessionList } from '../session.js';

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

export function handleHelp(_args: string): CommandResult {
  return { reply: HELP_TEXT, handled: true };
}

export function handleClear(ctx: CommandContext): CommandResult {
  ctx.rejectPendingPermission?.();
  const newSession = ctx.clearSession();
  Object.assign(ctx.session, newSession);
  return { reply: '✅ 会话已清除，下次消息将开始新会话。', handled: true };
}

export function handleNew(ctx: CommandContext): CommandResult {
  ctx.rejectPendingPermission?.();
  ctx.updateSession({
    sdkSessionId: undefined,
    chatHistory: [],
  });
  return { reply: '🆕 已创建新会话，上下文已清空。', handled: true };
}

export function handleCwd(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    return { reply: `当前工作目录: ${ctx.session.workingDirectory}\n用法: /cwd <路径>`, handled: true };
  }
  ctx.updateSession({ workingDirectory: args });
  return { reply: `✅ 工作目录已切换为: ${args}`, handled: true };
}

export function handleModel(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    return { reply: '用法: /model <模型名称>\n例: /model claude-sonnet-4-20250514', handled: true };
  }
  ctx.updateSession({ model: args });
  return { reply: `✅ 模型已切换为: ${args}`, handled: true };
}

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto'] as const;
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  default: '每次工具使用需手动审批',
  acceptEdits: '自动批准文件编辑，其他需审批',
  plan: '只读模式，不允许任何工具',
  auto: '自动批准所有工具（危险模式）',
};

export function handlePermission(ctx: CommandContext, args: string): CommandResult {
  if (!args) {
    const current = ctx.session.permissionMode ?? 'default';
    const lines = [
      '🔒 当前权限模式: ' + current,
      '',
      '可用模式:',
      ...PERMISSION_MODES.map(m => `  ${m} — ${PERMISSION_DESCRIPTIONS[m]}`),
      '',
      '用法: /permission <模式>',
    ];
    return { reply: lines.join('\n'), handled: true };
  }
  const mode = args.trim();
  if (!PERMISSION_MODES.includes(mode as any)) {
    return {
      reply: `未知模式: ${mode}\n可用: ${PERMISSION_MODES.join(', ')}`,
      handled: true,
    };
  }
  ctx.updateSession({ permissionMode: mode as any });
  const warning = mode === 'auto' ? '\n\n⚠️ 已开启危险模式：所有工具调用将自动批准，无需手动确认。' : '';
  return { reply: `✅ 权限模式已切换为: ${mode}\n${PERMISSION_DESCRIPTIONS[mode]}${warning}`, handled: true };
}

export function handleStatus(ctx: CommandContext): CommandResult {
  const s = ctx.session;
  const mode = s.permissionMode ?? 'default';
  const lines = [
    '📊 会话状态',
    '',
    `工作目录: ${s.workingDirectory}`,
    `模型: ${s.model ?? '默认'}`,
    `权限模式: ${mode}`,
    `会话ID: ${s.sdkSessionId ?? '无'}`,
    `状态: ${s.state}`,
  ];
  return { reply: lines.join('\n'), handled: true };
}

export async function handleSkills(ctx: CommandContext): Promise<CommandResult> {
  if (!ctx.opencodeClient) {
    return { reply: '⚠️ OpenCode 服务未连接', handled: true };
  }

  try {
    const agents = await ctx.opencodeClient.app.agents();
    const agentList = agents.data as any[];
    if (agentList.length === 0) {
      return { reply: '暂无可用技能', handled: true };
    }
    const lines = agentList.map(a => `- ${a.name}: ${a.description || '无描述'}`);
    return { reply: `📋 可用技能：\n\n${lines.join('\n')}`, handled: true };
  } catch (err) {
    return { reply: `⚠️ 获取技能列表失败: ${String(err)}`, handled: true };
  }
}

const MAX_HISTORY_LIMIT = 100;

export function handleHistory(ctx: CommandContext, args: string): CommandResult {
  const limit = args ? parseInt(args, 10) : 20;
  if (isNaN(limit) || limit <= 0) {
    return { reply: '用法: /history [数量]\n例: /history 50（显示最近50条对话）', handled: true };
  }
  const effectiveLimit = Math.min(limit, MAX_HISTORY_LIMIT);

  const historyText = ctx.getChatHistoryText?.(effectiveLimit) || '暂无对话记录';

  return { reply: `📝 对话记录（最近${effectiveLimit}条）:\n\n${historyText}`, handled: true };
}

export function handleReset(ctx: CommandContext): CommandResult {
  ctx.rejectPendingPermission?.();
  const newSession = ctx.clearSession();
  newSession.workingDirectory = process.cwd();
  newSession.model = undefined;
  newSession.permissionMode = undefined;
  Object.assign(ctx.session, newSession);
  return { reply: '✅ 会话已完全重置，所有设置恢复默认。', handled: true };
}

export function handleCompact(ctx: CommandContext): CommandResult {
  const currentSessionId = ctx.session.sdkSessionId;
  if (!currentSessionId) {
    return { reply: 'ℹ️ 当前没有活动的 SDK 会话，无需压缩。', handled: true };
  }
  ctx.updateSession({
    previousSdkSessionId: currentSessionId,
    sdkSessionId: undefined,
  });
  return {
    reply: '✅ 上下文已压缩\n\n下次消息将开始新的 SDK 会话（token 清零）\n聊天历史已保留，可用 /history 查看',
    handled: true,
  };
}

export function handleUndo(ctx: CommandContext, args: string): CommandResult {
  const count = args ? parseInt(args, 10) : 1;
  if (isNaN(count) || count <= 0) {
    return { reply: '用法: /undo [数量]\n例: /undo 2（撤销最近2条对话）', handled: true };
  }
  const history = ctx.session.chatHistory || [];
  if (history.length === 0) {
    return { reply: '⚠️ 没有对话记录可撤销', handled: true };
  }
  const actualCount = Math.min(count, history.length);
  ctx.session.chatHistory = history.slice(0, -actualCount);
  ctx.updateSession({ chatHistory: ctx.session.chatHistory });
  return { reply: `✅ 已撤销最近 ${actualCount} 条对话`, handled: true };
}

export async function handleModels(ctx: CommandContext): Promise<CommandResult> {
  const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096';

  try {
    const res = await fetch(`${OPENCODE_URL}/config/providers`);
    if (!res.ok) {
      throw new Error(`Failed to fetch providers: ${res.status}`);
    }

    const data = await res.json() as any;
    const providers = data.providers || [];

    if (providers.length === 0) {
      return { reply: '⚠️ 未找到可用的模型提供商', handled: true };
    }

    const lines: string[] = ['📋 可用模型：', ''];

    for (const provider of providers) {
      lines.push(`【${provider.name || provider.id}】`);
      const models = provider.models || [];
      for (const model of models) {
        lines.push(`  - ${model.id}`);
      }
      lines.push('');
    }

    const currentModel = ctx.session.model;
    if (currentModel) {
      lines.push(`当前模型: ${currentModel}`);
    }

    return { reply: lines.join('\n'), handled: true };
  } catch (err) {
    return { reply: `⚠️ 获取模型列表失败: ${String(err)}`, handled: true };
  }
}

export function handleVersion(): CommandResult {
  try {
    const __dirname = fileURLToPath(new URL('.', import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    const version = pkg.version || 'unknown';
    return { reply: `wechat-opencode-bot v${version}`, handled: true };
  } catch {
    return { reply: 'wechat-opencode-bot (version unknown)', handled: true };
  }
}

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
    const currentSessionId = ctx.session.sessionsByCwd?.[currentCwd];
    const currentTitle = currentSessionId ? ctx.session.sessionTitles?.[currentSessionId] : '无';
    
    return { 
      reply: `当前会话：${currentTitle || '无'}\nID: ${currentSessionId || '无'}\n\n用法: /session <会话ID>`, 
      handled: true 
    };
  }

  const targetSessionId = args.trim();
  
  if (!ctx.session.wechatSessions?.includes(targetSessionId)) {
    return { reply: '⚠️ 未找到该会话，只能切换微信创建的会话', handled: true };
  }

  let targetCwd: string | undefined;
  for (const [cwd, sessionId] of Object.entries(ctx.session.sessionsByCwd || {})) {
    if (sessionId === targetSessionId) {
      targetCwd = cwd;
      break;
    }
  }

  if (!targetCwd) {
    return { reply: '⚠️ 未找到该会话对应的工作目录', handled: true };
  }

  ctx.updateSession({ workingDirectory: targetCwd });
  
  const title = ctx.session.sessionTitles?.[targetSessionId] || '未命名会话';
  return { 
    reply: `✅ 已切换到会话：${title}\n工作目录: ${targetCwd}`, 
    handled: true 
  };
}

export function handleUnknown(cmd: string, args: string): CommandResult {
  return {
    handled: true,
    reply: `技能 ${cmd} 未找到\n使用 /skills 查看可用技能列表`,
  };
}