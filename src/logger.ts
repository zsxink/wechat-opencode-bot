import { mkdirSync, appendFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".wechat-opencode-bot", "logs");
const MAX_LOG_FILES = 3;

function getLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

function cleanupOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR)
      .filter((f) => f.startsWith("wechat-opencode-bot-") && f.endsWith(".log"))
      .sort();
    while (files.length > MAX_LOG_FILES) {
      unlinkSync(join(LOG_DIR, files.shift()!));
    }
  } catch {
    // Ignore errors during cleanup
  }
}

export function redact(obj: unknown): string {
  const raw = typeof obj === "string" ? obj : JSON.stringify(obj);
  if (!raw) return raw;

  let safe = raw;
  safe = safe.replace(/Bearer\s+[^\s"\\]+/gi, "Bearer ***");
  safe = safe.replace(
    /"(?:(?:[\w]+_)?token|secret|password|api_key)"\s*:\s*"[^"]*"/gi,
    (match) => {
      const key = match.match(/"[^"]*"/)?.[0] ?? '""';
      return `${key}: "***"`;
    },
  );
  return safe;
}

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  cleanupOldLogs();
}

function getLogFilePath(): string {
  const date = getLocalDate();
  return join(LOG_DIR, `wechat-opencode-bot-${date}.log`);
}

function writeLogLine(level: string, message: string, data?: unknown): void {
  ensureLogDir();
  const timestamp = getLocalTimestamp();
  const parts = [timestamp, level, message];
  if (data !== undefined) {
    parts.push(redact(data));
  }
  const line = parts.join(" ") + "\n";
  appendFileSync(getLogFilePath(), line, "utf-8");
}

export const logger = {
  info(message: string, data?: unknown): void {
    writeLogLine("INFO", message, data);
  },
  warn(message: string, data?: unknown): void {
    writeLogLine("WARN", message, data);
  },
  error(message: string, data?: unknown): void {
    writeLogLine("ERROR", message, data);
  },
  debug(message: string, data?: unknown): void {
    writeLogLine("DEBUG", message, data);
  },
} as const;