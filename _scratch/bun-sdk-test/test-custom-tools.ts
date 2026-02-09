/**
 * Test custom tools (function list to MCP converter) with Claude Agent SDK using Bun
 *
 * This test verifies that the createSdkMcpServer and tool helpers work correctly.
 */

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

console.log("=== Testing Custom Tools with Bun ===\n");

// Track custom tool invocations
const customToolLog: Array<{ tool: string; args: unknown; timestamp: Date }> = [];

// Create a simple custom tool that adds two numbers
const calculatorTool = tool(
  "add_numbers",
  "Add two numbers together and return the result",
  {
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  },
  async (args) => {
    console.log(`[CUSTOM TOOL INVOKED] add_numbers`);
    console.log(`  Args: ${JSON.stringify(args)}`);

    customToolLog.push({
      tool: "add_numbers",
      args,
      timestamp: new Date(),
    });

    const result = args.a + args.b;
    console.log(`  Result: ${result}\n`);

    return {
      content: [
        {
          type: "text" as const,
          text: `The sum of ${args.a} and ${args.b} is ${result}`,
        },
      ],
    };
  }
);

// Create another custom tool for string manipulation
const stringTool = tool(
  "reverse_string",
  "Reverse a string and return the result",
  {
    text: z.string().describe("The string to reverse"),
  },
  async (args) => {
    console.log(`[CUSTOM TOOL INVOKED] reverse_string`);
    console.log(`  Args: ${JSON.stringify(args)}`);

    customToolLog.push({
      tool: "reverse_string",
      args,
      timestamp: new Date(),
    });

    const reversed = args.text.split("").reverse().join("");
    console.log(`  Result: ${reversed}\n`);

    return {
      content: [
        {
          type: "text" as const,
          text: `The reversed string is: "${reversed}"`,
        },
      ],
    };
  }
);

// Create the MCP server with our custom tools
console.log("Creating SDK MCP server with custom tools...\n");

const customServer = createSdkMcpServer({
  name: "my-calculator",
  version: "1.0.0",
  tools: [calculatorTool, stringTool],
});

console.log("MCP Server created:");
console.log(`  Name: my-calculator`);
console.log(`  Type: ${customServer.type}`);
console.log();

// Use streaming input mode as required by MCP tools
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "Please use the add_numbers tool to add 42 and 58 together. Then use the reverse_string tool to reverse 'hello world'.",
    },
  };
}

console.log("Prompt: Use add_numbers to add 42+58, and reverse_string to reverse 'hello world'\n");
console.log("Starting query with custom MCP tools...\n");

try {
  for await (const message of query({
    prompt: generateMessages(),
    options: {
      mcpServers: {
        "my-calculator": customServer,
      },
      allowedTools: [
        "mcp__my-calculator__add_numbers",
        "mcp__my-calculator__reverse_string",
      ],
      maxTurns: 5,
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      console.log(`[INIT] Session: ${message.session_id}`);
      console.log(`  Tools: ${message.tools.join(", ")}`);
      console.log(`  Model: ${message.model}`);
      console.log(`  MCP Servers: ${JSON.stringify(message.mcp_servers)}`);
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
      } else {
        console.log(`  Errors: ${JSON.stringify((message as any).errors)}`);
      }
      console.log(`  Turns: ${message.num_turns}`);
      console.log(`  Cost: $${message.total_cost_usd.toFixed(4)}`);
      console.log();
    }
  }
} catch (error) {
  console.error("Error during query:", error);
}

console.log("=== Custom Tool Invocation Log ===");
console.log(`Total invocations: ${customToolLog.length}`);
for (const entry of customToolLog) {
  console.log(`  - ${entry.tool} at ${entry.timestamp.toISOString()}`);
  console.log(`    Args: ${JSON.stringify(entry.args)}`);
}

if (customToolLog.length === 0) {
  console.log("\n[WARNING] No custom tools were invoked! This might indicate a bug.");
  console.log("Possible issues:");
  console.log("  - The MCP server might not be properly connected");
  console.log("  - The tools might not be in the allowed list");
  console.log("  - There might be a serialization issue with the tool definitions");
} else {
  console.log("\n[SUCCESS] Custom tools are working correctly!");
}
