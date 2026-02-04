/**
 * Matrix Experiment: Timeout behavior for AskUserQuestion vs Permission Request
 *
 * Dimensions:
 * - Tool type: AskUserQuestion | Permission (Bash command)
 * - Wait time: 30s, 60s, 90s, 120s, 300s
 *
 * Total: 2 x 5 = 10 experiments, run in parallel
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

const WAIT_TIMES = [30, 60, 90, 120, 300]; // seconds
const TOOL_TYPES = ["AskUserQuestion", "PermissionRequest"] as const;

type ToolType = typeof TOOL_TYPES[number];

interface ExperimentResult {
  toolType: ToolType;
  waitTimeSeconds: number;
  success: boolean;
  timedOut: boolean;
  error?: string;
  actualDurationMs: number;
  callbackCalledAt?: number;
  callbackReturnedAt?: number;
}

async function runExperiment(toolType: ToolType, waitTimeSeconds: number): Promise<ExperimentResult> {
  const waitTimeMs = waitTimeSeconds * 1000;
  const startTime = Date.now();
  let callbackCalledAt: number | undefined;
  let callbackReturnedAt: number | undefined;
  let callbackTriggered = false;

  const result: ExperimentResult = {
    toolType,
    waitTimeSeconds,
    success: false,
    timedOut: false,
    actualDurationMs: 0,
  };

  const prompt = toolType === "AskUserQuestion"
    ? "Use the AskUserQuestion tool to ask me what my favorite color is. This is required."
    : "Run the command: echo 'test permission timeout'";

  const allowedTools = toolType === "AskUserQuestion"
    ? ["AskUserQuestion"]
    : ["Bash"];

  try {
    for await (const message of query({
      prompt,
      options: {
        allowedTools,
        maxTurns: 3,
        permissionMode: "default",

        canUseTool: async (toolName: string, toolInput: unknown) => {
          // Only intercept the relevant tool
          const isTargetTool = toolType === "AskUserQuestion"
            ? toolName === "AskUserQuestion"
            : toolName === "Bash";

          if (isTargetTool && !callbackTriggered) {
            callbackTriggered = true;
            callbackCalledAt = Date.now() - startTime;

            // Wait the specified time
            await new Promise(resolve => setTimeout(resolve, waitTimeMs));

            callbackReturnedAt = Date.now() - startTime;

            if (toolType === "AskUserQuestion") {
              return {
                behavior: "allow" as const,
                updatedInput: {
                  ...(toolInput as Record<string, unknown>),
                  answers: { "What is your favorite color?": "Blue" }
                }
              };
            } else {
              return { behavior: "allow" as const, updatedInput: toolInput };
            }
          }

          // Allow other tools immediately
          return { behavior: "allow" as const, updatedInput: toolInput };
        },
      },
    })) {
      if ("result" in message) {
        result.success = true;
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    if (result.error.toLowerCase().includes("timeout")) {
      result.timedOut = true;
    }
  }

  result.actualDurationMs = Date.now() - startTime;
  result.callbackCalledAt = callbackCalledAt;
  result.callbackReturnedAt = callbackReturnedAt;

  return result;
}

async function main() {
  console.log("=".repeat(70));
  console.log("MATRIX EXPERIMENT: Timeout Behavior");
  console.log("=".repeat(70));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Tool types: ${TOOL_TYPES.join(", ")}`);
  console.log(`Wait times: ${WAIT_TIMES.join("s, ")}s`);
  console.log(`Total experiments: ${TOOL_TYPES.length * WAIT_TIMES.length}`);
  console.log("=".repeat(70));
  console.log("\nLaunching all experiments in parallel...\n");

  // Create all experiment promises
  const experiments: Promise<ExperimentResult>[] = [];

  for (const toolType of TOOL_TYPES) {
    for (const waitTime of WAIT_TIMES) {
      console.log(`  Starting: ${toolType} @ ${waitTime}s`);
      experiments.push(runExperiment(toolType, waitTime));
    }
  }

  // Wait for all to complete
  const results = await Promise.all(experiments);

  // Sort by tool type then wait time
  results.sort((a, b) => {
    if (a.toolType !== b.toolType) {
      return a.toolType.localeCompare(b.toolType);
    }
    return a.waitTimeSeconds - b.waitTimeSeconds;
  });

  // Print results
  console.log("\n" + "=".repeat(70));
  console.log("RESULTS");
  console.log("=".repeat(70));

  console.log("\n### AskUserQuestion Results\n");
  console.log("| Wait Time | Success | Timed Out | Duration | Error |");
  console.log("|-----------|---------|-----------|----------|-------|");

  for (const r of results.filter(r => r.toolType === "AskUserQuestion")) {
    const duration = (r.actualDurationMs / 1000).toFixed(1) + "s";
    const error = r.error ? r.error.slice(0, 30) + "..." : "-";
    console.log(`| ${r.waitTimeSeconds}s | ${r.success ? "✅" : "❌"} | ${r.timedOut ? "⏱️ YES" : "No"} | ${duration} | ${error} |`);
  }

  console.log("\n### Permission Request (Bash) Results\n");
  console.log("| Wait Time | Success | Timed Out | Duration | Error |");
  console.log("|-----------|---------|-----------|----------|-------|");

  for (const r of results.filter(r => r.toolType === "PermissionRequest")) {
    const duration = (r.actualDurationMs / 1000).toFixed(1) + "s";
    const error = r.error ? r.error.slice(0, 30) + "..." : "-";
    console.log(`| ${r.waitTimeSeconds}s | ${r.success ? "✅" : "❌"} | ${r.timedOut ? "⏱️ YES" : "No"} | ${duration} | ${error} |`);
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const askUserResults = results.filter(r => r.toolType === "AskUserQuestion");
  const permResults = results.filter(r => r.toolType === "PermissionRequest");

  const askUserSuccessRate = askUserResults.filter(r => r.success).length / askUserResults.length * 100;
  const permSuccessRate = permResults.filter(r => r.success).length / permResults.length * 100;

  const askUserTimeouts = askUserResults.filter(r => r.timedOut).map(r => r.waitTimeSeconds);
  const permTimeouts = permResults.filter(r => r.timedOut).map(r => r.waitTimeSeconds);

  console.log(`\nAskUserQuestion:`);
  console.log(`  Success rate: ${askUserSuccessRate.toFixed(0)}%`);
  console.log(`  Timeouts at: ${askUserTimeouts.length > 0 ? askUserTimeouts.join("s, ") + "s" : "None"}`);

  console.log(`\nPermission Request:`);
  console.log(`  Success rate: ${permSuccessRate.toFixed(0)}%`);
  console.log(`  Timeouts at: ${permTimeouts.length > 0 ? permTimeouts.join("s, ") + "s" : "None"}`);

  console.log(`\nCompleted at: ${new Date().toISOString()}`);

  // JSON output for parsing
  console.log("\n" + "=".repeat(70));
  console.log("RAW JSON RESULTS");
  console.log("=".repeat(70));
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
