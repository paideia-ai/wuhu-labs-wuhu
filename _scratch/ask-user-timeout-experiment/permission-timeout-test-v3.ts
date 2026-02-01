/**
 * Experiment: Test if Permission Request (canUseTool) has a 60-second timeout
 *
 * v3: Use PreToolUse hook to force interception since canUseTool isn't being called
 * According to docs, hooks run BEFORE permission evaluation
 */

import { query, type HookResult } from "@anthropic-ai/claude-agent-sdk";

const WAIT_TIMES = [30, 80]; // seconds

interface ExperimentResult {
  waitTimeSeconds: number;
  success: boolean;
  timedOut: boolean;
  error?: string;
  actualDurationMs: number;
  hookCalledAt?: number;
  hookReturnedAt?: number;
  hookInvoked: boolean;
}

async function runExperiment(waitTimeSeconds: number): Promise<ExperimentResult> {
  const waitTimeMs = waitTimeSeconds * 1000;
  const startTime = Date.now();
  let hookCalledAt: number | undefined;
  let hookReturnedAt: number | undefined;
  let hookInvoked = false;

  const result: ExperimentResult = {
    waitTimeSeconds,
    success: false,
    timedOut: false,
    actualDurationMs: 0,
    hookInvoked: false,
  };

  console.log(`\n[${waitTimeSeconds}s test] Starting...`);

  try {
    for await (const message of query({
      prompt: "Run this shell command: echo 'hello timeout test'",
      options: {
        allowedTools: ["Bash"],
        maxTurns: 3,
        permissionMode: "default",

        // Use PreToolUse hook instead of canUseTool
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash", // Only match Bash tool
              hooks: [
                async (input: unknown, toolUseId: string, context: unknown): Promise<HookResult> => {
                  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                  console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] >>> PreToolUse HOOK INVOKED`);
                  console.log(`[${waitTimeSeconds}s test @ ${elapsed}s]     toolUseId: ${toolUseId}`);
                  console.log(`[${waitTimeSeconds}s test @ ${elapsed}s]     input: ${JSON.stringify(input).slice(0, 100)}`);

                  if (!hookInvoked) {
                    hookInvoked = true;
                    hookCalledAt = Date.now() - startTime;

                    console.log(`[${waitTimeSeconds}s test @ ${elapsed}s]     Waiting ${waitTimeSeconds}s...`);

                    // Wait the specified time
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));

                    hookReturnedAt = Date.now() - startTime;
                    const returnElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log(`[${waitTimeSeconds}s test @ ${returnElapsed}s]     Wait complete, returning continue`);
                  }

                  // Continue with tool execution
                  return { continue: true };
                }
              ]
            }
          ]
        },
      },
    })) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (message.type === "assistant") {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] Tool request: ${block.name}`);
            }
          }
        }
      }

      if ("result" in message) {
        result.success = true;
        console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] SUCCESS`);
      }
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    result.error = error instanceof Error ? error.message : String(error);
    console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] ERROR: ${result.error}`);
    if (result.error.toLowerCase().includes("timeout")) {
      result.timedOut = true;
    }
  }

  result.actualDurationMs = Date.now() - startTime;
  result.hookCalledAt = hookCalledAt;
  result.hookReturnedAt = hookReturnedAt;
  result.hookInvoked = hookInvoked;

  return result;
}

async function main() {
  console.log("=".repeat(70));
  console.log("EXPERIMENT: Permission Timeout Test v3 (Using PreToolUse Hook)");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Wait times: ${WAIT_TIMES.join("s, ")}s`);
  console.log("Using PreToolUse hook to intercept tool calls");
  console.log("=".repeat(70));

  // Run experiments in parallel
  const experiments = WAIT_TIMES.map(t => runExperiment(t));
  const results = await Promise.all(experiments);

  // Print results
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  console.log("\n| Wait Time | Hook Invoked | Success | Timed Out | Duration |");
  console.log("|-----------|--------------|---------|-----------|----------|");

  for (const r of results) {
    const duration = (r.actualDurationMs / 1000).toFixed(1) + "s";
    console.log(`| ${r.waitTimeSeconds}s | ${r.hookInvoked ? "✅ YES" : "❌ NO"} | ${r.success ? "✅" : "❌"} | ${r.timedOut ? "⏱️ YES" : "No"} | ${duration} |`);
  }

  // Analysis
  console.log("\n" + "=".repeat(70));
  console.log("ANALYSIS");
  console.log("=".repeat(70));

  const test30 = results.find(r => r.waitTimeSeconds === 30);
  const test80 = results.find(r => r.waitTimeSeconds === 80);

  if (test30?.hookInvoked && test80?.hookInvoked) {
    console.log(`\n30s test: hook at ${test30.hookCalledAt}ms, returned at ${test30.hookReturnedAt}ms, success: ${test30.success}`);
    console.log(`80s test: hook at ${test80.hookCalledAt}ms, returned at ${test80.hookReturnedAt}ms, success: ${test80.success}`);

    if (test30.success && test80.success) {
      console.log("\n>>> FINDING: No 60-second timeout for PreToolUse hooks!");
    } else if (test30.success && !test80.success) {
      console.log("\n>>> FINDING: 60-second timeout EXISTS for hooks! 30s passed, 80s failed.");
    }
  } else {
    console.log("\n⚠️  Hook was not invoked for some tests.");
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log("\nRAW JSON:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
