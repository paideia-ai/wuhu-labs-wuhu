# What Are Coding Agents

Coding agents are AI-powered tools that autonomously write, modify, and reason
about code. They operate in an agentic loop: receive a prompt, reason about it,
use tools (read files, run shell commands, edit code, search the web), observe
results, and repeat until the task is done.

## Examples

- **Claude Code** (Anthropic) - The OG coding agent. Also available as
  `@anthropic-ai/claude-agent-sdk` for programmatic embedding.
- **Codex** (OpenAI) - https://github.com/openai/codex
- **Pi** - A minimal coding agent. https://github.com/badlogic/pi-mono
- **OpenCode** - A popular vendor-neutral option.
  https://github.com/anomalyco/opencode

## Key Concepts

- **Reasoning / Chain of Thought (CoT)** - LLMs reason step-by-step before
  producing output. Frontier models hide raw reasoning but provide a reasoning
  summary. Historically, reasoning tokens are consumed internally and discarded
  before the next human/AI turn.
- **Interleaved thinking** - 2025+ models do: thinking => tool call => wait for
  tool result => more thinking/calls or finish. Some models emit reasoning
  tokens, some emit assistant messages, sometimes both. From an inference
  perspective, message/reasoning/tool call are generated in one batch; the
  harness writes tool results back as input for the next batch. When the model
  generates output with no tool call, the turn is done.
- **Harness** - VC buzzword for coding agent; or more precisely, the environment
  (tools, sandbox, permissions) the LLM interacts with.
- **MCP (Model Context Protocol)** - A standard for exposing tools to a harness.
  Lets external services provide tool definitions that coding agents can
  discover and invoke.

## Common Architecture

Despite different implementations, coding agents share a structure:

1. **Session** - A conversation between human and agent, spanning multiple turns.
2. **Turn** - One cycle: human message in, agent works (tool calls, reasoning),
   agent final response out.
3. **Tool calls** - File reads, edits, shell commands, web searches. The agent
   decides which tools to invoke and interprets results.
4. **Session logs** - A record of everything that happened: prompts, reasoning,
   tool calls, tool results, final outputs.
