/**
 * Test canUseTool callback with AskUserQuestion tool
 *
 * Based on previous findings, canUseTool IS invoked for AskUserQuestion
 * but NOT for Bash (which gets auto-allowed).
 */

import { query, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

console.log("=== Testing canUseTool with AskUserQuestion ===\n");

const canUseToolLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];
const startTime = Date.now();

try {
  for await (const message of query({
    prompt: "I need you to ask me a clarifying question using the AskUserQuestion tool. Ask me what programming language I prefer.",
    options: {
      allowedTools: ["AskUserQuestion"],
      maxTurns: 3,
      permissionMode: "default",

      canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[${elapsed}s] [canUseTool CALLED]`);
        console.log(`  Tool: ${toolName}`);
        console.log(`  Input: ${JSON.stringify(input, null, 2).slice(0, 500)}`);
        console.log(`  Has signal: ${!!options.signal}`);
        console.log(`  Suggestions: ${JSON.stringify(options.suggestions)}`);

        canUseToolLog.push({
          tool: toolName,
          input,
          timestamp: new Date(),
        });

        if (toolName === "AskUserQuestion") {
          console.log(`\n[${elapsed}s] >>> AskUserQuestion detected! Returning answer.`);
          // Return the answer to the question
          return {
            behavior: "allow" as const,
            updatedInput: {
              ...(input as Record<string, unknown>),
              answers: { "What programming language do you prefer?": "TypeScript" }
            }
          };
        }

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
      console.log(`  Model: ${message.model}`);
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
      }
      console.log(`  Turns: ${message.num_turns}`);
      console.log(`  Cost: $${message.total_cost_usd.toFixed(4)}`);
    }
  }
} catch (error) {
  console.error("Error:", error);
}

console.log("\n=== canUseTool Call Log ===");
console.log(`Total calls: ${canUseToolLog.length}`);
for (const entry of canUseToolLog) {
  console.log(`  - ${entry.tool} at ${entry.timestamp.toISOString()}`);
}

if (canUseToolLog.length === 0) {
  console.log("\n[FINDING] canUseTool was NOT called even for AskUserQuestion.");
} else {
  console.log("\n[SUCCESS] canUseTool callback is working for AskUserQuestion!");
}
