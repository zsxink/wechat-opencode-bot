import { createOpencodeClient } from "@opencode-ai/sdk/v2";
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
}

export interface QueryResult {
  text: string;
  sessionId: string;
  error?: string;
}

let client: any = null;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

export async function initOpenCode(): Promise<void> {
  try {
    client = createOpencodeClient({
      baseUrl: OPENCODE_URL,
    });

    // Verify connection using health endpoint
    const health = await client.global.health();
    if (!health.data || health.error) {
      throw new Error("Health check failed");
    }

    logger.info("OpenCode client connected", { version: health.data.version });
  } catch (err) {
    logger.error("Failed to connect to OpenCode", { error: String(err) });
    client = null;
    throw new Error(
      `无法连接到 OpenCode 服务 (${OPENCODE_URL})。请确保：\n` +
      `1. OpenCode 已安装: npm install -g opencode-ai\n` +
      `2. OpenCode 服务已启动: opencode serve --hostname 127.0.0.1 --port 4096\n` +
      `3. 或者通过环境变量 OPENCODE_URL 指定服务地址`
    );
  }
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
    if (!client) {
      await initOpenCode();
    }

    let sessionId = resume || "";
    if (!sessionId) {
      const session = await client.session.create({
        body: { title: "WeChat Bot Session" },
      });
      if (!session || !session.id) {
        throw new Error("Failed to create session");
      }
      sessionId = session.id;
    }

    const parts: any[] = [
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

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        model: model ? { providerID: "anthropic", modelID: model } : undefined,
      },
    });

    // Extract text from response parts
    let text = "";
    if (result && result.parts) {
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

export function getOpenCodeClient(): any {
  return client;
}
