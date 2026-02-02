/**
 * Test canUseTool callback with Bash in disallowedTools
 */

import { query, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

console.log("=== Testing canUseTool with Bash in disallowedTools ===\n");

const canUseToolLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];
const startTime = Date.now();

try {
  for await (const message of query({
    prompt: "Run 'echo hello' using the Bash tool.",
    options: {
      // Using disallowedTools to block Bash
      disallowedTools: ["Bash"],
      maxTurns: 3,
      permissionMode: "default",

      canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[${elapsed}s] [canUseTool CALLED]`);
        console.log(`  Tool: ${toolName}`);
        console.log(`  Input: ${JSON.stringify(input, null, 2).slice(0, 300)}`);

        canUseToolLog.push({
          tool: toolName,
          input,
          timestamp: new Date(),
        });

        // Allow the tool use
        return {
          behavior: "allow" as const,
          updatedInput: input as Record<string, unknown>,
        };
      },
    },
  })) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (message.type === "system" && message.subtype === "init") {
      console.log(`[${elapsed}s] [INIT] Session: ${message.session_id}`);
      console.log(`  Tools: ${message.tools.join(", ")}`);
      console.log(`  Permission Mode: ${message.permissionMode}`);
    } else if (message.type === "assistant") {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            console.log(`[${elapsed}s] [ASSISTANT] ${block.text.slice(0, 200)}`);
          } else if (block.type === "tool_use") {
            console.log(`[${elapsed}s] [TOOL_USE] ${block.name}`);
          }
        }
      }
    } else if (message.type === "result") {
      console.log(`[${elapsed}s] [RESULT] Subtype: ${message.subtype}`);
      if (message.subtype === "success") {
        console.log(`  Result: ${message.result.slice(0, 200)}`);
        console.log(`  Permission denials: ${JSON.stringify((message as any).permission_denials)}`);
      } else {
        console.log(`  Errors: ${JSON.stringify((message as any).errors)}`);
      }
      console.log(`  Turns: ${message.num_turns}`);
    }
  }
} catch (error) {
  console.error("Error:", error);
}

console.log("\n=== canUseTool Call Log ===");
console.log(`Total calls: ${canUseToolLog.length}`);
