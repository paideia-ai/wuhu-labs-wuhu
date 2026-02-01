import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("Starting Claude Agent SDK test...\n");

  let sessionId = null;

  for await (const message of query({
    prompt: "What is 7 * 8? Reply with just the number.",
    options: {
      allowedTools: [],
      permissionMode: "default",
      maxTurns: 1,
    },
  })) {
    console.log("Message type:", message.type);
    if (message.session_id) {
      sessionId = message.session_id;
      console.log("  Session ID:", message.session_id);
    }
    if ("result" in message) console.log("  Result:", message.result);
  }

  console.log("\nSession ID for log lookup:", sessionId);
  console.log("Done!");
}

main().catch(console.error);
