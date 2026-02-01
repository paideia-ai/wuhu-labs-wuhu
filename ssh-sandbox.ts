import { ModalClient } from "modal";

const tokenId = process.env.MODAL_TOKEN_ID?.trim();
const tokenSecret = process.env.MODAL_TOKEN_SECRET?.trim();

if (!tokenId || !tokenSecret) {
  throw new Error(
    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables must be set"
  );
}

const modal = new ModalClient({ tokenId, tokenSecret });

const app = await modal.apps.fromName("ssh-sandbox", {
  createIfMissing: true,
});

// Use a more feature-rich image
const image = modal.images.fromRegistry("ubuntu:22.04");

console.log("Creating sandbox with Ubuntu 22.04...");
console.log("Setting idle timeout to 1 hour...\n");

const sb = await modal.sandboxes.create(app, image, {
  command: ["sleep", "infinity"],
  idleTimeoutMs: 3600000,
  timeoutMs: 7200000,
});

console.log("Sandbox created!");
console.log("  Sandbox ID:", sb.sandboxId);

console.log("\nInstalling packages and setting up environment...");

// Install useful tools
const setupCommands = [
  ["apt-get", "update"],
  ["apt-get", "install", "-y", "curl", "vim", "git", "htop", "net-tools", "python3", "python3-pip"],
];

for (const cmd of setupCommands) {
  console.log(`  Running: ${cmd.slice(0, 3).join(" ")}...`);
  const proc = await sb.exec(cmd);
  await proc.wait();
}

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║                         SANDBOX READY                              ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Sandbox ID: ${sb.sandboxId}`);
console.log("║                                                                    ║");
console.log("║  Since Modal tunnels are HTTPS-only (not raw TCP), SSH won't      ║");
console.log("║  work directly. But you can use the Modal CLI to connect:         ║");
console.log("║                                                                    ║");
console.log("║  Option 1 - Modal CLI (if installed):                             ║");
console.log(`║    modal sandbox exec ${sb.sandboxId} /bin/bash`);
console.log("║                                                                    ║");
console.log("║  Option 2 - Use this script interactively (see shell-sandbox.ts)  ║");
console.log("║                                                                    ║");
console.log("║  The sandbox has: curl, vim, git, htop, python3, pip              ║");
console.log("╚══════════════════════════════════════════════════════════════════╝");

// Let's demonstrate running some commands
console.log("\n=== Quick demo - running some commands ===\n");

const demoCommands = [
  { cmd: ["uname", "-a"], desc: "System info" },
  { cmd: ["cat", "/etc/os-release"], desc: "OS release" },
  { cmd: ["df", "-h"], desc: "Disk space" },
];

for (const { cmd, desc } of demoCommands) {
  console.log(`--- ${desc} ---`);
  const proc = await sb.exec(cmd);
  const output = await proc.stdout.readText();
  console.log(output);
}

console.log("=== Sandbox is running ===");
console.log("Will auto-terminate after 1 hour of inactivity.");

process.exit(0);
