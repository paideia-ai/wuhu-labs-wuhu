/**
 * Test canUseTool callback with Claude Agent SDK using Bun - version 4
 *
 * Testing WITHOUT allowedTools - this should require permission for tool use.
 * This tests whether canUseTool is the mechanism for handling permission requests.
 */

import { query, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

console.log("=== Testing canUseTool callback v4 with Bun ===\n");

// Track canUseTool calls
const canUseToolLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];

// Use streaming input mode
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
console.log("Testing WITHOUT allowedTools to trigger permission request...\n");

try {
  for await (const message of query({
    prompt: generateMessages(),
    options: {
      // NOTE: NOT specifying allowedTools - this should require permission
      maxTurns: 3,
      permissionMode: "default",
      canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
        console.log(`[canUseTool CALLED]`);
        console.log(`  Tool: ${toolName}`);
        console.log(`  Input: ${JSON.stringify(input, null, 2)}`);
        console.log(`  Has signal: ${!!options.signal}`);
        console.log(`  Suggestions: ${JSON.stringify(options.suggestions)}`);
        console.log();

        canUseToolLog.push({
          tool: toolName,
          input,
          timestamp: new Date(),
        });

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
        console.log(`  Permission denials: ${JSON.stringify((message as any).permission_denials)}`);
      } else {
        console.log(`  Errors: ${JSON.stringify((message as any).errors)}`);
        console.log(`  Permission denials: ${JSON.stringify((message as any).permission_denials)}`);
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
console.log(`Total calls: ${canUseToolLog.length}`);
for (const entry of canUseToolLog) {
  console.log(`  - ${entry.tool} at ${entry.timestamp.toISOString()}`);
}

if (canUseToolLog.length === 0) {
  console.log("\n[FINDING] canUseTool was still not called.");
  console.log("This suggests canUseTool may have a specific purpose we haven't identified.");
  console.log("The PreToolUse hook is the correct way to intercept tool calls.");
} else {
  console.log("\n[SUCCESS] canUseTool callback was invoked!");
}
