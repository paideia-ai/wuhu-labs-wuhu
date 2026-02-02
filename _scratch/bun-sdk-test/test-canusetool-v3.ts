/**
 * Test canUseTool callback with Claude Agent SDK using Bun - version 3
 *
 * Testing with a tool that requires permission (Edit) to see if canUseTool is called.
 * Also testing without any allowedTools to see if permission checks are triggered.
 */

import { query, tool, createSdkMcpServer, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

console.log("=== Testing canUseTool callback v3 with Bun ===\n");

// Track canUseTool calls
const canUseToolLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];

// Create a custom MCP tool that we'll use to see if canUseTool is called for MCP tools
const customTool = tool(
  "test_tool",
  "A test tool that just returns a message",
  {
    message: z.string().describe("Message to return"),
  },
  async (args) => {
    console.log(`[CUSTOM TOOL INVOKED] test_tool with message: ${args.message}`);
    return {
      content: [{ type: "text" as const, text: `Tool received: ${args.message}` }],
    };
  }
);

const customServer = createSdkMcpServer({
  name: "test-server",
  version: "1.0.0",
  tools: [customTool],
});

// Use streaming input mode
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "Please use the test_tool with message 'hello from test'",
    },
  };
}

console.log("Prompt: Please use the test_tool with message 'hello from test'\n");
console.log("Testing canUseTool with MCP tools...\n");

try {
  for await (const message of query({
    prompt: generateMessages(),
    options: {
      mcpServers: {
        "test-server": customServer,
      },
      allowedTools: ["mcp__test-server__test_tool"],
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
  console.log("\n[NOTE] canUseTool was not called.");
  console.log("This suggests canUseTool may only be called in specific scenarios:");
  console.log("  - When a tool is not in allowedTools");
  console.log("  - When permissionPromptToolName is set");
  console.log("  - When the tool requires permission approval");
  console.log("\nFor intercepting tool calls, use hooks (PreToolUse) instead.");
} else {
  console.log("\n[SUCCESS] canUseTool callback was invoked!");
}
