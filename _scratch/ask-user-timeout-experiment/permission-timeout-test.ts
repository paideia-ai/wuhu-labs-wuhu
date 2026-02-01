/**
 * Experiment: Test if Permission Request (canUseTool) has a 60-second timeout
 *
 * Fixed version: Force Claude to request permission by NOT auto-allowing tools
 * Testing only 30s and 80s (beyond the documented 60s limit)
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const WAIT_TIMES = [30, 80]; // seconds - 30s should pass, 80s tests the 60s limit

interface ExperimentResult {
  waitTimeSeconds: number;
  success: boolean;
  timedOut: boolean;
  error?: string;
  actualDurationMs: number;
  callbackCalledAt?: number;
  callbackReturnedAt?: number;
  callbackInvoked: boolean;
}

async function runExperiment(waitTimeSeconds: number): Promise<ExperimentResult> {
  const waitTimeMs = waitTimeSeconds * 1000;
  const startTime = Date.now();
  let callbackCalledAt: number | undefined;
  let callbackReturnedAt: number | undefined;
  let callbackInvoked = false;

  const result: ExperimentResult = {
    waitTimeSeconds,
    success: false,
    timedOut: false,
    actualDurationMs: 0,
    callbackInvoked: false,
  };

  console.log(`\n[${ waitTimeSeconds}s test] Starting...`);

  try {
    for await (const message of query({
      prompt: "Run this exact bash command: echo 'hello from permission test'. Do not use any other tool, only Bash.",
      options: {
        // Only allow Bash - no other tools
        allowedTools: ["Bash"],
        maxTurns: 3,
        // Use default mode which should require permission
        permissionMode: "default",

        canUseTool: async (toolName: string, toolInput: unknown) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] canUseTool called for: ${toolName}`);

          if (toolName === "Bash" && !callbackInvoked) {
            callbackInvoked = true;
            callbackCalledAt = Date.now() - startTime;

            console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] Bash permission requested! Waiting ${waitTimeSeconds}s...`);

            // Wait the specified time
            await new Promise(resolve => setTimeout(resolve, waitTimeMs));

            callbackReturnedAt = Date.now() - startTime;
            const returnElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${waitTimeSeconds}s test @ ${returnElapsed}s] Wait complete, returning allow`);

            return { behavior: "allow" as const, updatedInput: toolInput };
          }

          // Allow other tools immediately
          return { behavior: "allow" as const, updatedInput: toolInput };
        },
      },
    })) {
      if ("result" in message) {
        result.success = true;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] SUCCESS - Result received`);
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
  result.callbackCalledAt = callbackCalledAt;
  result.callbackReturnedAt = callbackReturnedAt;
  result.callbackInvoked = callbackInvoked;

  return result;
}

async function main() {
  console.log("=".repeat(70));
  console.log("EXPERIMENT: Permission Request Timeout Test (30s and 80s)");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Wait times: ${WAIT_TIMES.join("s, ")}s`);
  console.log("=".repeat(70));

  // Run experiments in parallel
  const experiments = WAIT_TIMES.map(t => runExperiment(t));
  const results = await Promise.all(experiments);

  // Print results
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  console.log("\n| Wait Time | Callback Invoked | Success | Timed Out | Duration | Error |");
  console.log("|-----------|------------------|---------|-----------|----------|-------|");

  for (const r of results) {
    const duration = (r.actualDurationMs / 1000).toFixed(1) + "s";
    const error = r.error ? r.error.slice(0, 40) + "..." : "-";
    console.log(`| ${r.waitTimeSeconds}s | ${r.callbackInvoked ? "✅ YES" : "❌ NO"} | ${r.success ? "✅" : "❌"} | ${r.timedOut ? "⏱️ YES" : "No"} | ${duration} | ${error} |`);
  }

  // Analysis
  console.log("\n" + "=".repeat(70));
  console.log("ANALYSIS");
  console.log("=".repeat(70));

  const test30 = results.find(r => r.waitTimeSeconds === 30);
  const test80 = results.find(r => r.waitTimeSeconds === 80);

  if (!test30?.callbackInvoked || !test80?.callbackInvoked) {
    console.log("\n⚠️  WARNING: Callback was not invoked for some tests!");
    console.log("   The permission system may have auto-allowed the tool.");
    console.log("   Need to investigate further with different settings.");
  } else {
    console.log(`\n30s test: ${test30.success ? "PASSED" : "FAILED"} (callback invoked: ${test30.callbackInvoked})`);
    console.log(`80s test: ${test80.success ? "PASSED" : "FAILED"} (callback invoked: ${test80.callbackInvoked})`);

    if (test30.success && test80.success) {
      console.log("\n>>> FINDING: No 60-second timeout! Both 30s and 80s tests succeeded.");
    } else if (test30.success && !test80.success) {
      console.log("\n>>> FINDING: 60-second timeout EXISTS! 30s passed, 80s failed.");
    } else {
      console.log("\n>>> FINDING: Unexpected results - need further analysis.");
    }
  }

  console.log(`\nCompleted at: ${new Date().toISOString()}`);

  // Raw JSON
  console.log("\n" + "=".repeat(70));
  console.log("RAW JSON");
  console.log("=".repeat(70));
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
