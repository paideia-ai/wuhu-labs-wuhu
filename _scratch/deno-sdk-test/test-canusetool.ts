/**
 * Test canUseTool callback with Claude Agent SDK using Deno
 *
 * This test verifies that the canUseTool callback is invoked correctly
 * when the agent tries to use tools.
 */

import { query } from "npm:@anthropic-ai/claude-agent-sdk";

console.log("=== Testing canUseTool callback with Deno ===\n");

// Track tool use attempts
const toolUseLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];

// Simple prompt that should trigger tool use
const testPrompt = "Use the Bash tool to run 'echo hello world'";

console.log(`Prompt: ${testPrompt}\n`);
console.log("Starting query with canUseTool callback...\n");

try {
  for await (const message of query({
    prompt: testPrompt,
    options: {
      allowedTools: ["Bash"],
      maxTurns: 3,
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
