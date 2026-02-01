import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("Starting Claude Agent SDK test...\n");

  try {
    for await (const message of query({
      prompt: "What is 2 + 2? Reply with just the number.",
      options: {
        allowedTools: [],
        // Use default permission mode instead of bypassPermissions
        permissionMode: "default",
        maxTurns: 1,
        pathToClaudeCodeExecutable: join(
          __dirname,
          "node_modules/@anthropic-ai/claude-code/cli.js"
        ),
      },
    })) {
      console.log("Message type:", message.type);
      if (message.subtype) console.log("  Subtype:", message.subtype);
      if (message.session_id) console.log("  Session ID:", message.session_id);
      if ("result" in message) console.log("  Result:", message.result);
      if (message.type === "assistant" && message.message) {
        for (const block of message.message.content || []) {
          if (block.type === "text") {
            console.log("  Text:", block.text);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error:", err.message);
    console.error("Full error:", err);
  }

  console.log("\nDone!");
}

main().catch(console.error);
