/**
 * Experiment: Test if AskUserQuestion tool is subject to 60-second timeout
 *
 * According to the docs, canUseTool callbacks must return within 60 seconds.
 * AskUserQuestion goes through canUseTool, so it should have the same timeout.
 *
 * This script:
 * 1. Starts a query that will trigger AskUserQuestion
 * 2. Uses canUseTool callback to intercept the AskUserQuestion
 * 3. Deliberately waits 70+ seconds before responding
 * 4. Observes whether the SDK times out or waits indefinitely
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const WAIT_TIME_MS = 70_000; // 70 seconds - beyond the documented 60s limit

console.log("=".repeat(60));
console.log("EXPERIMENT: AskUserQuestion 60-second Timeout Test");
console.log("=".repeat(60));
console.log(`Will wait ${WAIT_TIME_MS / 1000} seconds before responding to canUseTool`);
console.log(`Started at: ${new Date().toISOString()}`);
console.log("=".repeat(60));

let askUserQuestionReceived = false;
let timeoutOccurred = false;
const startTime = Date.now();

try {
  for await (const message of query({
    prompt: "I need you to ask me a clarifying question using the AskUserQuestion tool. Ask me what programming language I prefer.",
    options: {
      // Include AskUserQuestion explicitly
      allowedTools: ["AskUserQuestion"],
      maxTurns: 3,
      permissionMode: "default",

      canUseTool: async (toolName: string, toolInput: unknown) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[${elapsed}s] canUseTool called for: ${toolName}`);
        console.log(`[${elapsed}s] Input: ${JSON.stringify(toolInput, null, 2).slice(0, 200)}...`);

        if (toolName === "AskUserQuestion") {
          askUserQuestionReceived = true;
          console.log(`\n[${elapsed}s] >>> AskUserQuestion detected! Starting ${WAIT_TIME_MS / 1000}s wait...`);
          console.log(`[${elapsed}s] >>> If timeout occurs, we should see an error or fallback behavior`);

          // Log progress every 10 seconds
          const waitStart = Date.now();
          const logInterval = setInterval(() => {
            const waitElapsed = ((Date.now() - waitStart) / 1000).toFixed(0);
            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${totalElapsed}s] ... still waiting (${waitElapsed}s of ${WAIT_TIME_MS / 1000}s)`);
          }, 10_000);

          // Wait the full duration
          await new Promise(resolve => setTimeout(resolve, WAIT_TIME_MS));
          clearInterval(logInterval);

          const finalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`\n[${finalElapsed}s] >>> Wait complete! Returning allow response now...`);

          // Return a response (allow the tool)
          return {
            behavior: "allow" as const,
            updatedInput: {
              ...(toolInput as Record<string, unknown>),
              answers: { "What programming language do you prefer?": "TypeScript" }
            }
          };
        }

        // Allow other tools immediately
        return { behavior: "allow" as const, updatedInput: toolInput };
      },
    },
  })) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      console.log(`[${elapsed}s] Session initialized: ${(message as any).session_id}`);
    } else if (message.type === "assistant") {
      const content = (message as any).message?.content;
      if (content) {
        const text = Array.isArray(content)
          ? content.map((c: any) => c.text || c.type).join(" | ")
          : String(content);
        console.log(`[${elapsed}s] Assistant: ${text.slice(0, 100)}...`);
      }
    } else if ("result" in message) {
      console.log(`[${elapsed}s] RESULT: ${String((message as any).result).slice(0, 200)}...`);
    } else {
      console.log(`[${elapsed}s] Message type: ${message.type}`);
    }
  }
} catch (error) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  timeoutOccurred = true;
  console.log(`\n[${elapsed}s] ERROR CAUGHT:`);
  console.log(error);
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log("\n" + "=".repeat(60));
console.log("EXPERIMENT COMPLETE");
console.log("=".repeat(60));
console.log(`Total time: ${totalElapsed}s`);
console.log(`AskUserQuestion received: ${askUserQuestionReceived}`);
console.log(`Timeout/error occurred: ${timeoutOccurred}`);
console.log(`Ended at: ${new Date().toISOString()}`);

if (askUserQuestionReceived && !timeoutOccurred && parseFloat(totalElapsed) > 60) {
  console.log("\n>>> FINDING: AskUserQuestion appears to NOT have a 60s timeout!");
  console.log(">>> The canUseTool callback waited beyond 60s and still succeeded.");
} else if (timeoutOccurred) {
  console.log("\n>>> FINDING: A timeout or error occurred (check details above)");
} else {
  console.log("\n>>> FINDING: Need to analyze the output above");
}
