import type { Session } from '../session.js';
import { logger } from '../logger.js';
import { handleHelp, handleClear, handleCwd, handleLs, handleModel, handleModels, handlePermission, handleStatus, handleSkills, handleHistory, handleReset, handleCompact, handleUndo, handleVersion, handleUnknown, handleNew, handleSessions, handleSession } from './handlers.js';

export interface CommandContext {
  accountId: string;
  session: Session;
  updateSession: (partial: Partial<Session>) => void;
  clearSession: () => Session;
  getChatHistoryText?: (limit?: number) => string;
  rejectPendingPermission?: () => boolean;
  text: string;
  opencodeClient?: any;
}

export interface CommandResult {
  reply?: string;
  handled: boolean;
  claudePrompt?: string; // If set, this text should be sent to Claude
}

/**
 * Parse and dispatch a slash command.
 *
 * Supported commands:
 *   /help     - Show help text with all available commands
 *   /clear    - Clear the current session
 *   /new      - Create new session
 *   /model <name> - Update the session model
 *   /status   - Show current session info
 *   /skills   - List all installed skills
 *   /<skill>  - Invoke a skill by name (args are forwarded to OpenCode)
 */
export async function routeCommand(ctx: CommandContext): Promise<CommandResult> {
  const text = ctx.text.trim();

  if (!text.startsWith('/')) {
    return { handled: false };
  }

  const spaceIdx = text.indexOf(' ');
  const cmd = (spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

  logger.info(`Slash command: /${cmd} ${args}`.trimEnd());

  switch (cmd) {
    case 'help':
      return handleHelp(args);
    case 'clear':
      return handleClear(ctx);
    case 'reset':
      return handleReset(ctx);
    case 'cwd':
      return handleCwd(ctx, args);
    case 'ls':
      return handleLs(ctx);
    case 'model':
      return handleModel(ctx, args);
    case 'models':
      return await handleModels(ctx);
    case 'permission':
      return handlePermission(ctx, args);
    case 'status':
      return handleStatus(ctx);
    case 'new':
      return await handleNew(ctx, args);
    case 'skills':
      return await handleSkills(ctx);
    case 'history':
      return handleHistory(ctx, args);
    case 'undo':
      return handleUndo(ctx, args);
    case 'compact':
      return handleCompact(ctx);
    case 'version':
    case 'v':
      return handleVersion();
    case 'sessions':
      return await handleSessions(ctx);
    case 'session':
      return handleSession(ctx, args);
    default:
      return handleUnknown(cmd, args);
  }
}
