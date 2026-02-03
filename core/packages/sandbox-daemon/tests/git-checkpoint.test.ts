import { assertEquals } from "@std/assert";

import { FakeAgentProvider } from "../src/agent-provider.ts";
import { createSandboxDaemonApp } from "../src/server.ts";
import type {
  SandboxDaemonAgentEvent,
  SandboxDaemonCheckpointCommitEvent,
  SandboxDaemonInitRequest,
  SandboxDaemonStreamEnvelope,
} from "../src/types.ts";

async function runGit(cwd: string, args: string[]): Promise<string> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  if (!out.success) {
    throw new Error(new TextDecoder().decode(out.stderr));
  }
  return new TextDecoder().decode(out.stdout).trim();
}

Deno.test("git checkpoint: per-turn commits and emits event", async () => {
  const tmp = await Deno.makeTempDir();
  const sourceRepo = `${tmp}/source`;
  const workspaceRoot = `${tmp}/ws`;
  await Deno.mkdir(sourceRepo, { recursive: true });

  await runGit(sourceRepo, ["init", "-b", "main"]);
  await runGit(sourceRepo, ["config", "user.email", "test@example.com"]);
  await runGit(sourceRepo, ["config", "user.name", "Test"]);
  await Deno.writeTextFile(`${sourceRepo}/README.md`, "hello");
  await runGit(sourceRepo, ["add", "."]);
  await runGit(sourceRepo, ["commit", "-m", "init"]);

  const provider = new FakeAgentProvider();
  const { app } = createSandboxDaemonApp({ provider, workspaceRoot });

  const initPayload: SandboxDaemonInitRequest = {
    workspace: {
      repos: [{ id: "repo", source: sourceRepo, path: "repo" }],
    },
    gitCheckpoint: {
      mode: "per-turn",
      branchName: "wuhu/checkpoints",
      commitMessageTemplate: "checkpoint turn {turn}",
      push: false,
    },
  };

  const initRes = await app.request("/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initPayload),
  });
  assertEquals(initRes.status, 200);

  const clonedRepo = `${workspaceRoot}/repo`;
  await Deno.writeTextFile(`${clonedRepo}/README.md`, "changed");

  const turnEnd: SandboxDaemonAgentEvent = {
    source: "agent",
    type: "turn_end",
    payload: { type: "turn_end" },
  };
  provider.emit(turnEnd);

  const isCheckpointCommitEvent = (
    event: unknown,
  ): event is SandboxDaemonCheckpointCommitEvent => {
    return typeof event === "object" && event !== null &&
      (event as { type?: unknown }).type === "checkpoint_commit";
  };

  let checkpointEvent: SandboxDaemonCheckpointCommitEvent | undefined;
  for (let i = 0; i < 50; i++) {
    const streamRes = await app.request("/stream?cursor=0", { method: "GET" });
    const text = await streamRes.text();
    const dataLines = text.split("\n").filter((line) =>
      line.startsWith("data: ")
    );
    for (const line of dataLines) {
      const envelope = JSON.parse(
        line.slice("data: ".length),
      ) as SandboxDaemonStreamEnvelope<
        { type?: string; [key: string]: unknown }
      >;
      if (isCheckpointCommitEvent(envelope.event)) {
        checkpointEvent = envelope.event;
        break;
      }
    }
    if (checkpointEvent) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  assertEquals(checkpointEvent?.type, "checkpoint_commit");
  assertEquals(checkpointEvent?.repoId, "repo");
  assertEquals(checkpointEvent?.branch, "wuhu/checkpoints");
  assertEquals(checkpointEvent?.turn, 1);
  assertEquals(typeof checkpointEvent?.commitSha, "string");
  assertEquals(checkpointEvent?.commitSha.length, 40);

  assertEquals(
    await runGit(clonedRepo, ["rev-parse", "--abbrev-ref", "HEAD"]),
    "wuhu/checkpoints",
  );
  assertEquals(
    await runGit(clonedRepo, ["log", "-1", "--pretty=%s"]),
    "checkpoint turn 1",
  );
});
