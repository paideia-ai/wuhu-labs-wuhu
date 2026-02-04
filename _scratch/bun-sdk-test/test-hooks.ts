/**
 * Test hooks with Claude Agent SDK using Bun
 *
 * This tests the PreToolUse hook to intercept tool calls.
 */

import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

console.log("=== Testing Hooks with Bun ===\n");

// Track tool use attempts via hooks
const hookLog: Array<{ tool: string; input: unknown; timestamp: Date }> = [];

// Define a hook callback
const toolInterceptor: HookCallback = async (input, toolUseID, { signal }) => {
  console.log(`[HOOK CALLED] ${input.hook_event_name}`);

  if (input.hook_event_name === 'PreToolUse') {
    const preInput = input as PreToolUseHookInput;
    console.log(`  Tool: ${preInput.tool_name}`);
    console.log(`  Input: ${JSON.stringify(preInput.tool_input, null, 2)}`);
    console.log(`  Tool Use ID: ${toolUseID}`);
    console.log();

    hookLog.push({
      tool: preInput.tool_name,
      input: preInput.tool_input,
      timestamp: new Date(),
    });

    // Allow the tool use
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: 'allow' as const,
        permissionDecisionReason: 'Allowed by test hook',
      }
    };
  }

  return {};
};

// Simple prompt that should trigger tool use
const testPrompt = "Use the Bash tool to run 'echo hello world'";

console.log(`Prompt: ${testPrompt}\n`);
console.log("Starting query with PreToolUse hook...\n");

try {
  for await (const message of query({
    prompt: testPrompt,
    options: {
      allowedTools: ["Bash"],
      maxTurns: 3,
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [toolInterceptor] }
        ]
      }
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

console.log("=== Hook Call Log ===");
console.log(`Total calls: ${hookLog.length}`);
for (const entry of hookLog) {
  console.log(`  - ${entry.tool} at ${entry.timestamp.toISOString()}`);
}

if (hookLog.length === 0) {
  console.log("\n[WARNING] No hooks were called! This might indicate a bug.");
} else {
  console.log("\n[SUCCESS] Hooks are working correctly!");
}
