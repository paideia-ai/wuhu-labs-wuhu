export interface GitOutput {
  code: number;
  success: boolean;
  stdout: string;
  stderr: string;
}

export async function gitOutput(
  args: string[],
  cwd: string,
): Promise<GitOutput> {
  const cmd = new Deno.Command("git", {
    args,
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return {
    code: out.code,
    success: out.success,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

export async function runGit(args: string[], cwd: string): Promise<GitOutput> {
  const out = await gitOutput(args, cwd);
  if (!out.success) {
    throw new Error(out.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return out;
}

export async function getGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const branch = out.stdout.trim();
    if (!branch || branch === "HEAD") return undefined;
    return branch;
  } catch {
    return undefined;
  }
}
