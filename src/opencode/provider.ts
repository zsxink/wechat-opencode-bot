import { logger } from "../logger.js";
import { execSync } from "node:child_process";

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
  title?: string;
}

export interface QueryResult {
  text: string;
  sessionId: string;
  error?: string;
}

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const OPENCODE_PORT = 4096;

function checkOpenCodeInstalled(): boolean {
  try {
    const cmd = process.platform === "win32" ? "where opencode" : "which opencode";
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function waitForService(url: string, maxAttempts: number = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/global/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

function startOpenCodeService(cwd?: string): void {
  logger.info("Starting OpenCode service", { port: OPENCODE_PORT, cwd });
  console.log(`正在启动 OpenCode 服务 (端口: ${OPENCODE_PORT})...`);
  
  const workDir = cwd || process.cwd();
  
  try {
    if (process.platform === "win32") {
      // Windows: 使用 execSync 后台启动
      execSync(`start /b opencode serve --hostname 127.0.0.1 --port ${OPENCODE_PORT}`, {
        cwd: workDir,
        stdio: 'ignore',
        shell: process.env.COMSPEC || 'cmd.exe',
      });
    } else {
      execSync(`nohup opencode serve --hostname 127.0.0.1 --port ${OPENCODE_PORT} > /dev/null 2>&1 &`, {
        stdio: "ignore",
        cwd: workDir,
      });
    }
  } catch (e) {
    // 忽略错误，稍后会检查服务是否启动
    logger.warn("Start command failed, will check if service started anyway");
  }
}

export async function initOpenCode(cwd?: string): Promise<void> {
  try {
    const res = await fetch(`${OPENCODE_URL}/global/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    const data = await res.json() as any;
    logger.info("OpenCode client connected", { version: data.version });
  } catch (err) {
    logger.warn("Failed to connect to OpenCode, checking installation");
    
    if (!checkOpenCodeInstalled()) {
      throw new Error(
        `OpenCode 未安装。请先安装：\n` +
        `npm install -g opencode-ai`
      );
    }
    
    console.log("OpenCode 已安装，但服务未启动");
    startOpenCodeService(cwd);
    
    console.log("等待 OpenCode 服务启动...");
    const started = await waitForService(OPENCODE_URL);
    
    if (!started) {
      throw new Error(
        `OpenCode 服务启动失败或超时。\n` +
        `请手动启动: opencode serve --hostname 127.0.0.1 --port ${OPENCODE_PORT}`
      );
    }
    
    console.log("✅ OpenCode 服务已启动");
    logger.info("OpenCode service started successfully");
  }
}

async function createSession(title: string, cwd?: string): Promise<string> {
  logger.info("Creating OpenCode session", { title, cwd });
  const body: any = { title };
  if (cwd) {
    body.cwd = cwd;
  }
  const res = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

async function sendPrompt(sessionId: string, parts: any[], model?: string, cwd?: string): Promise<string> {
  const body: any = { parts };
  if (model) {
    body.model = { providerID: "anthropic", modelID: model };
  }
  if (cwd) {
    body.cwd = cwd;
  }

  const url = `${OPENCODE_URL}/session/${sessionId}/message`;
  logger.info("Sending prompt", { sessionId, url, partsCount: parts.length });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000); // 60 秒超时

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    logger.info("Prompt response", { status: res.status, contentType: res.headers.get("content-type") });

    if (!res.ok) {
      const text = await res.text();
      logger.error("Prompt failed", { status: res.status, body: text.substring(0, 200) });
      throw new Error(`Prompt failed: ${res.status} - ${text}`);
    }

    const text = await res.text();
    logger.info("Raw response", { length: text.length, preview: text.substring(0, 100) });

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.error("JSON parse failed", { text: text.substring(0, 200) });
      throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }

    let responseText = "";
    if (data.parts) {
      responseText = data.parts
        .filter((p: any) => p.type === "text" && p.text)
        .map((p: any) => p.text)
        .join("\n");
    } else if (data.info?.text) {
      responseText = data.info.text;
    }

    return responseText;
  } finally {
    clearTimeout(timeout);
  }
}

export async function openCodeQuery(options: QueryOptions): Promise<QueryResult> {
  const { prompt, cwd, resume, model, images, title } = options;

  logger.info("Starting OpenCode query", {
    cwd,
    model,
    resume: !!resume,
    hasImages: !!images?.length,
    title,
  });

  try {
    let sessionId = resume || "";
    if (!sessionId) {
      const sessionTitle = title || "微信: 会话";
      sessionId = await createSession(sessionTitle, cwd);
    }

    const parts: any[] = [{ type: "text", text: prompt }];

    if (images?.length) {
      for (const img of images) {
        parts.push({ type: "image", source: img.source });
      }
    }

    const text = await sendPrompt(sessionId, parts, model, cwd);

    logger.info("OpenCode query completed", {
      sessionId,
      textLength: text.length,
    });

    return { text, sessionId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("OpenCode query failed", { error: errorMessage });
    return { text: "", sessionId: "", error: errorMessage };
  }
}

export function getOpenCodeClient(): null {
  return null;
}
