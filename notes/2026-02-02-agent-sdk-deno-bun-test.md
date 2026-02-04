# Claude Agent SDK - Deno & Bun Testing Results

Date: 2026-02-02

## Overview

Tested the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk@0.2.29`) with both Deno and Bun runtimes.

## Test Environment

- **Deno**: 2.6.7
- **Bun**: 1.3.6
- **SDK**: @anthropic-ai/claude-agent-sdk@0.2.29
- **Auth**: Claude Max subscription via `~/.claude/.credentials.json`

## Test Results Summary

| Feature | Deno | Bun | Notes |
|---------|------|-----|-------|
| Custom Tools (createSdkMcpServer) | ✅ Works | ✅ Works | Function-to-MCP conversion works correctly |
| Hooks (PreToolUse) | ✅ Works | ✅ Works | Hook callbacks are invoked correctly |
| canUseTool callback | ❌ Not invoked | ❌ Not invoked | See findings below |

## Detailed Findings

### 1. Custom Tools (createSdkMcpServer + tool helper)

**Status: WORKING in both Deno and Bun**

The function-to-MCP converter works correctly. Example:

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"; // or npm:@anthropic-ai/claude-agent-sdk for Deno
import { z } from "zod"; // or npm:zod for Deno

const customTool = tool(
  "add_numbers",
  "Add two numbers together",
  {
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  },
  async (args) => {
    const result = args.a + args.b;
    return {
      content: [{ type: "text", text: `Sum: ${result}` }],
    };
  }
);

const customServer = createSdkMcpServer({
  name: "my-calculator",
  version: "1.0.0",
  tools: [customTool],
});

// IMPORTANT: Custom MCP tools require streaming input mode
async function* generateMessages() {
  yield {
    type: "user",
    message: { role: "user", content: "Add 42 and 58" },
  };
}

for await (const message of query({
  prompt: generateMessages(),  // Must use async generator
  options: {
    mcpServers: { "my-calculator": customServer },
    allowedTools: ["mcp__my-calculator__add_numbers"],
  },
})) {
  // Handle messages
}
```

**Key points:**
- Tools are exposed with naming pattern: `mcp__<server-name>__<tool-name>`
- Must use streaming input mode (async generator) when using MCP servers
- Tool handlers receive properly typed arguments from Zod schema

### 2. canUseTool Callback

**Status: NOT WORKING (potential bug or undocumented behavior)**

The `canUseTool` callback was never invoked in any of our tests, despite:
- Using default permission mode
- Testing with and without `allowedTools`
- Testing with both built-in tools and custom MCP tools
- Using streaming input mode

This appears to be either:
1. A bug in the SDK
2. The callback only being invoked under very specific conditions not documented

**Workaround: Use Hooks Instead**

The `PreToolUse` hook provides the same functionality and works correctly:

```typescript
import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const toolInterceptor: HookCallback = async (input, toolUseID, { signal }) => {
  if (input.hook_event_name === 'PreToolUse') {
    const preInput = input as PreToolUseHookInput;
    console.log(`Tool: ${preInput.tool_name}`);
    console.log(`Input: ${JSON.stringify(preInput.tool_input)}`);

    // Allow the tool
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: 'allow',
        permissionDecisionReason: 'Allowed by hook',
      }
    };
  }
  return {};
};

for await (const message of query({
  prompt: "Use Bash to echo hello",
  options: {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [toolInterceptor] }]
    }
  },
})) {
  // Handle messages
}
```

### 3. Hooks

**Status: WORKING in both Deno and Bun**

The hooks system works correctly for intercepting tool calls. Key hooks:
- `PreToolUse`: Intercept before tool execution (can block/modify)
- `PostToolUse`: Intercept after tool execution (for logging/auditing)
- `PermissionRequest`: Custom permission handling

## Recommendations

1. **For tool interception/permission control**: Use `hooks.PreToolUse` instead of `canUseTool`
2. **For custom tools**: Use `createSdkMcpServer` + `tool` helper with async generator input mode
3. **For Deno**: Import from `npm:@anthropic-ai/claude-agent-sdk` and `npm:zod`

## Test Files

Test scripts are located in:
- `_scratch/deno-sdk-test/` - Deno test files
- `_scratch/bun-sdk-test/` - Bun test files

## Questions for Further Investigation

1. Under what conditions is `canUseTool` actually invoked?
2. Is `canUseTool` deprecated in favor of hooks?
3. Does `permissionPromptToolName` affect when `canUseTool` is called?
