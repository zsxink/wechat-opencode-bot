import { logger } from "../logger.js";
import { execSync, spawn } from "node:child_process";
import { join } from "node:path";

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

async function waitForService(url: string, maxAttempts: number = 120): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/global/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

function findOpenCodePath(): string {
  try {
    if (process.platform === 'win32') {
      const output = execSync('npm config get prefix', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      return join(output, 'opencode.cmd');
    } else {
      const output = execSync('which opencode', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      return output;
    }
  } catch {
    return 'opencode';
  }
}

function startOpenCodeService(cwd?: string): void {
  logger.info("Starting OpenCode service", { port: OPENCODE_PORT, cwd });
  console.log(`正在启动 OpenCode 服务 (端口: ${OPENCODE_PORT})...`);
  
  const workDir = cwd || process.cwd();
  
  try {
    if (process.platform === 'win32') {
      const opencodePath = findOpenCodePath();
      logger.info("Using opencode path", { path: opencodePath });
      
      const command = `Start-Process -FilePath "powershell.exe" -ArgumentList '-Command', '& "${opencodePath}" serve --hostname 127.0.0.1 --port ${OPENCODE_PORT}' -WorkingDirectory "${workDir}" -WindowStyle Hidden`;
      execSync(command, {
        stdio: 'ignore',
        shell: 'powershell.exe'
      });
      
      logger.info("OpenCode service started successfully");
    } else {
      const command = `opencode serve --hostname 127.0.0.1 --port ${OPENCODE_PORT} > /dev/null 2>&1 &`;
      execSync(command, {
        cwd: workDir,
        stdio: 'ignore',
        shell: '/bin/sh'
      });
    }
  } catch (e) {
    logger.warn("Start command failed", { error: String(e) });
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
  
  let url = `${OPENCODE_URL}/session`;
  if (cwd) {
    url += `?directory=${encodeURIComponent(cwd)}`;
  }
  
  const res = await fetch(url, {
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
  logger.info("Session created", { id: data.id, directory: data.directory });
  return data.id;
}

async function listSessions(cwd?: string): Promise<Array<{id: string, title: string, directory: string, time: {created: number, updated: number}}>> {
  logger.info("Listing OpenCode sessions", { cwd });
  
  let url = `${OPENCODE_URL}/session`;
  if (cwd) {
    url += `?directory=${encodeURIComponent(cwd)}`;
  }
  
  const res = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  
  if (!res.ok) {
    const text = await res.text();
    logger.error("Session list failed", { status: res.status, body: text });
    throw new Error(`Failed to list sessions: ${res.status} - ${text}`);
  }
  
  const sessions = await res.json() as any;
  logger.info("Sessions listed", { count: sessions.length });
  return sessions;
}

async function getModelConfig(modelName: string): Promise<{ providerID: string, modelID: string } | null> {
  try {
    const res = await fetch(`${OPENCODE_URL}/config/providers`);
    if (!res.ok) return null;
    
    const data = await res.json() as any;
    const providers = data.providers || [];
    
    for (const provider of providers) {
      const models = provider.models || {};
      for (const [modelId, modelInfo] of Object.entries(models)) {
        const m = modelInfo as any;
        if (m.name === modelName || m.id === modelName) {
          return { providerID: m.providerID, modelID: m.id };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function sendPrompt(sessionId: string, parts: any[], model?: string, cwd?: string): Promise<string> {
  const body: any = { parts };
  
  if (model) {
    const modelConfig = await getModelConfig(model);
    if (modelConfig) {
      body.model = modelConfig;
    } else {
      body.model = { providerID: "opencode", modelID: model };
    }
  }
  
  if (cwd) {
    body.cwd = cwd;
  }

  const url = `${OPENCODE_URL}/session/${sessionId}/message`;
  logger.info("Sending prompt", { sessionId, url, partsCount: parts.length, model: body.model });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_800_000); // 30 分钟超时

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

    if (!text || text.trim() === '') {
      logger.error("Empty response from OpenCode", { 
        status: res.status, 
        url,
        cwd 
      });
      throw new Error('OpenCode 返回了空响应。这通常是因为：1) 工作目录不存在；2) AI 模型的 API Key 未配置。请检查 OpenCode 服务配置，并设置 ANTHROPIC_API_KEY 或其他 AI 模型的 API Key。');
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      logger.error("JSON parse failed", { text: text.substring(0, 200) });
      throw new Error(`OpenCode 返回了无效的响应格式。请检查 OpenCode 服务状态和配置。原始响应: ${text.substring(0, 100)}`);
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
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error("OpenCode query failed", {
      error: errorMessage,
      stack: errorStack,
      prompt: prompt?.substring(0, 100),
      cwd,
      resume: !!resume,
      model,
    });
    return { text: "", sessionId: "", error: errorMessage };
  }
}

export function getOpenCodeClient(): null {
  return null;
}

export { listSessions, createSession };
