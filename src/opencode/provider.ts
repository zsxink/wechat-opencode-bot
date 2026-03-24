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
}

export interface QueryResult {
  text: string;
  sessionId: string;
  error?: string;
}

let client: any = null;
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

export async function createOpenCodeClientOnly(): Promise<any> {
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
    if (!client) {
      client = await createOpenCodeClientOnly();
    }

    let sessionId = resume || "";
    if (!sessionId) {
      const sessionResult = await client.session.create({
        body: { title: "WeChat Bridge Session" },
      });
      if (sessionResult.error) {
        throw new Error(String(sessionResult.error));
      }
      sessionId = sessionResult.data.info.id;
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

    const promptResult = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts,
        model: model ? { providerID: "anthropic", modelID: model } : undefined,
      },
    });

    if (promptResult.error) {
      throw new Error(String(promptResult.error));
    }

    let text = "";
    const responseData = promptResult.data;
    if (responseData && responseData.parts) {
      text = responseData.parts
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