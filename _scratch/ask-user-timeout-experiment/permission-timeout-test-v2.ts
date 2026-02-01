/**
 * Experiment: Test if Permission Request (canUseTool) has a 60-second timeout
 *
 * v2: Try different approaches to force canUseTool to be invoked
 * - Don't set permissionMode at all (let it default)
 * - Or explicitly require approval via the callback
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const WAIT_TIMES = [30, 80]; // seconds

interface ExperimentResult {
  waitTimeSeconds: number;
  success: boolean;
  timedOut: boolean;
  error?: string;
  actualDurationMs: number;
  callbackCalledAt?: number;
  callbackReturnedAt?: number;
  callbackInvoked: boolean;
  toolName?: string;
}

async function runExperiment(waitTimeSeconds: number): Promise<ExperimentResult> {
  const waitTimeMs = waitTimeSeconds * 1000;
  const startTime = Date.now();
  let callbackCalledAt: number | undefined;
  let callbackReturnedAt: number | undefined;
  let callbackInvoked = false;
  let toolNameSeen: string | undefined;

  const result: ExperimentResult = {
    waitTimeSeconds,
    success: false,
    timedOut: false,
    actualDurationMs: 0,
    callbackInvoked: false,
  };

  console.log(`\n[${waitTimeSeconds}s test] Starting...`);

  try {
    for await (const message of query({
      // Use a more explicit command that definitely needs Bash
      prompt: "Please run this shell command using the Bash tool: ls -la /tmp | head -5",
      options: {
        // Only Bash available
        allowedTools: ["Bash"],
        maxTurns: 5,
        // Don't set permissionMode - see if callback is invoked

        canUseTool: async (toolName: string, toolInput: unknown) => {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] >>> canUseTool INVOKED for: ${toolName}`);
          console.log(`[${waitTimeSeconds}s test @ ${elapsed}s]     Input: ${JSON.stringify(toolInput).slice(0, 100)}`);

          toolNameSeen = toolName;

          if (!callbackInvoked) {
            callbackInvoked = true;
            callbackCalledAt = Date.now() - startTime;

            console.log(`[${waitTimeSeconds}s test @ ${elapsed}s]     Waiting ${waitTimeSeconds}s before allowing...`);

            // Wait the specified time
            await new Promise(resolve => setTimeout(resolve, waitTimeMs));

            callbackReturnedAt = Date.now() - startTime;
            const returnElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[${waitTimeSeconds}s test @ ${returnElapsed}s]     Wait complete, returning allow`);
          }

          return { behavior: "allow" as const, updatedInput: toolInput };
        },
      },
    })) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (message.type === "assistant") {
        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use") {
              console.log(`[${waitTimeSeconds}s test @ ${elapsed}s] Assistant requesting tool: ${block.name}`);
            }
          }
        }
      }

      if ("result" in message) {
        result.success = true;
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
  result.toolName = toolNameSeen;

  return result;
}

async function main() {
  console.log("=".repeat(70));
  console.log("EXPERIMENT: Permission Request Timeout Test v2 (30s and 80s)");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Wait times: ${WAIT_TIMES.join("s, ")}s`);
  console.log("NOTE: Not setting permissionMode, relying on canUseTool callback");
  console.log("=".repeat(70));

  // Run experiments in parallel
  const experiments = WAIT_TIMES.map(t => runExperiment(t));
  const results = await Promise.all(experiments);

  // Print results
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  console.log("\n| Wait Time | Callback Invoked | Tool | Success | Timed Out | Duration |");
  console.log("|-----------|------------------|------|---------|-----------|----------|");

  for (const r of results) {
    const duration = (r.actualDurationMs / 1000).toFixed(1) + "s";
    const tool = r.toolName || "none";
    console.log(`| ${r.waitTimeSeconds}s | ${r.callbackInvoked ? "✅ YES" : "❌ NO"} | ${tool} | ${r.success ? "✅" : "❌"} | ${r.timedOut ? "⏱️ YES" : "No"} | ${duration} |`);
  }

  // Analysis
  console.log("\n" + "=".repeat(70));
  console.log("ANALYSIS");
  console.log("=".repeat(70));

  const test30 = results.find(r => r.waitTimeSeconds === 30);
  const test80 = results.find(r => r.waitTimeSeconds === 80);

  if (!test30?.callbackInvoked && !test80?.callbackInvoked) {
    console.log("\n⚠️  Callback was NEVER invoked!");
    console.log("   The SDK may be auto-allowing tools without calling canUseTool.");
    console.log("   This could be environment-specific (running as root, etc.)");
  } else if (test30?.callbackInvoked && test80?.callbackInvoked) {
    console.log(`\n30s test: callback at ${test30.callbackCalledAt}ms, returned at ${test30.callbackReturnedAt}ms`);
    console.log(`80s test: callback at ${test80.callbackCalledAt}ms, returned at ${test80.callbackReturnedAt}ms`);

    if (test30.success && test80.success) {
      console.log("\n>>> FINDING: No 60-second timeout! Both 30s and 80s tests succeeded.");
    } else if (test30.success && !test80.success) {
      console.log("\n>>> FINDING: 60-second timeout EXISTS! 30s passed, 80s failed.");
      if (test80.error) {
        console.log(`    80s error: ${test80.error}`);
      }
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
