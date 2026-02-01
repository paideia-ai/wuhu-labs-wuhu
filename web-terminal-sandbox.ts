import { ModalClient } from "modal";

const tokenId = process.env.MODAL_TOKEN_ID?.trim();
const tokenSecret = process.env.MODAL_TOKEN_SECRET?.trim();

if (!tokenId || !tokenSecret) {
  throw new Error(
    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables must be set"
  );
}

const modal = new ModalClient({ tokenId, tokenSecret });

const app = await modal.apps.fromName("web-terminal-sandbox", {
  createIfMissing: true,
});

// Use Ubuntu with ttyd for web-based terminal access
const image = modal.images.fromRegistry("ubuntu:22.04");

const PORT = 7681; // ttyd default port

console.log("Creating sandbox with web-based terminal (ttyd)...");
console.log("Setting idle timeout to 1 hour...\n");

const sb = await modal.sandboxes.create(app, image, {
  command: ["sleep", "infinity"],
  encryptedPorts: [PORT],
  idleTimeoutMs: 3600000,
  timeoutMs: 7200000,
});

console.log("Sandbox created!");
console.log("  Sandbox ID:", sb.sandboxId);

console.log("\nInstalling ttyd (web-based terminal)...");

// Install ttyd and useful tools
const setupCommands = [
  ["apt-get", "update"],
  ["apt-get", "install", "-y", "curl", "vim", "git", "htop", "wget", "python3", "tmux"],
  // Install ttyd
  ["sh", "-c", "wget -q https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 -O /usr/local/bin/ttyd && chmod +x /usr/local/bin/ttyd"],
];

for (const cmd of setupCommands) {
  const label = Array.isArray(cmd) ? cmd.slice(0, 3).join(" ") : cmd;
  console.log(`  Running: ${label}...`);
  const proc = await sb.exec(cmd);
  await proc.wait();
}

// Start ttyd
console.log("\nStarting ttyd web terminal on port 7681...");
const ttydProc = await sb.exec([
  "/usr/local/bin/ttyd",
  "--port", PORT.toString(),
  "--writable",  // Allow input
  "/bin/bash"
]);
// Don't await - let it run

console.log("Waiting for ttyd to start...");
await new Promise((resolve) => setTimeout(resolve, 3000));

console.log("Getting tunnel information...");
const tunnels = await sb.tunnels();

const tunnel = tunnels[PORT];

console.log("\n╔══════════════════════════════════════════════════════════════════╗");
console.log("║                    WEB TERMINAL READY!                             ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");

if (tunnel) {
  console.log("║                                                                    ║");
  console.log("║  Open this URL in your browser for a full terminal:               ║");
  console.log("║                                                                    ║");
  console.log(`║  ${tunnel.url}`);
  console.log("║                                                                    ║");
  console.log("╠══════════════════════════════════════════════════════════════════╣");
  console.log(`║  Sandbox ID: ${sb.sandboxId}`);
  console.log("║  Installed: curl, vim, git, htop, python3, tmux                   ║");
  console.log("║                                                                    ║");
  console.log("║  The sandbox will auto-terminate after 1 hour of inactivity.      ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");
}

process.exit(0);
