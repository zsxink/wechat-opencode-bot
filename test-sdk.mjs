import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

async function test() {
  try {
    const sessionId = "ses_2dfc1ac5effeJCvjgF5JBuWDEl";
    console.log("Testing session:", sessionId);

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: "Hello" }] },
    });

    console.log("Result received");
    if (result.parts) {
      const text = result.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n");
      console.log("Response:", text.substring(0, 200));
    } else {
      console.log("No parts in response:", JSON.stringify(result).substring(0, 300));
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
