/**
 * Test canUseTool callback with Claude Agent SDK using Bun - version 2
 *
 * Testing with explicit permissionMode and streaming input mode
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

console.log("=== Testing canUseTool callback v2 with Bun ===\n");

// Track tool use attempts
const toolUseLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];

// Use streaming input mode (async generator)
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "Use the Bash tool to run 'echo hello world'",
    },
  };
}

console.log("Prompt: Use the Bash tool to run 'echo hello world'\n");
console.log("Starting query with canUseTool callback (streaming mode, explicit permissionMode)...\n");

try {
  for await (const message of query({
    prompt: generateMessages(),
    options: {
      allowedTools: ["Bash"],
      maxTurns: 3,
      permissionMode: "default",  // Explicit permission mode
      canUseTool: async (toolName, input, options) => {
        const logEntry = {
          tool: toolName,
          input,
          timestamp: new Date()
        };
        toolUseLog.push(logEntry);

        console.log(`[canUseTool CALLED]`);
        console.log(`  Tool: ${toolName}`);
        console.log(`  Input: ${JSON.stringify(input, null, 2)}`);
        console.log(`  Has signal: ${!!options.signal}`);
        console.log(`  Suggestions: ${JSON.stringify(options.suggestions)}`);
        console.log();

        // Allow the tool use
        return {
          behavior: "allow" as const,
          updatedInput: input as Record<string, unknown>,
        };
      },
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      console.log(`[INIT] Session: ${message.session_id}`);
      console.log(`  Tools: ${message.tools.join(", ")}`);
      console.log(`  Model: ${message.model}`);
      console.log(`  Permission Mode: ${message.permissionMode}`);
      console.log();
    } else if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            console.log(`[ASSISTANT] ${block.text}`);
          } else if (block.type === "tool_use") {
            console.log(`[TOOL_USE] ${block.name}`);
            console.log(`  Input: ${JSON.stringify(block.input)}`);
          }
        }
      }
      console.log();
    } else if (message.type === "result") {
      console.log(`[RESULT] Subtype: ${message.subtype}`);
      if (message.subtype === "success") {
        console.log(`  Result: ${message.result}`);
      }
      console.log(`  Turns: ${message.num_turns}`);
      console.log(`  Cost: $${message.total_cost_usd.toFixed(4)}`);
      console.log();
    }
  }
} catch (error) {
  console.error("Error during query:", error);
}

console.log("=== canUseTool Call Log ===");
console.log(`Total calls: ${toolUseLog.length}`);
for (const entry of toolUseLog) {
  console.log(`  - ${entry.tool} at ${entry.timestamp.toISOString()}`);
}

if (toolUseLog.length === 0) {
  console.log("\n[WARNING] canUseTool was never called! This might indicate a bug.");
} else {
  console.log("\n[SUCCESS] canUseTool callback is working correctly!");
}
