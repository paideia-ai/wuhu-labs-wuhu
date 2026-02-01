import { ModalClient } from "modal";

const tokenId = process.env.MODAL_TOKEN_ID?.trim();
const tokenSecret = process.env.MODAL_TOKEN_SECRET?.trim();

if (!tokenId || !tokenSecret) {
  throw new Error(
    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables must be set"
  );
}

const modal = new ModalClient({ tokenId, tokenSecret });

// Create or get the app
const app = await modal.apps.fromName("sandbox-exploration", {
  createIfMissing: true,
});

// Let's try a Python HTTP server on a custom port (3000) to test non-8080 tunnels
const image = modal.images.fromRegistry("python:3.12-alpine");

const PORT = 3000; // Using non-8080 port as requested!

console.log(`Creating sandbox with Python HTTP server on port ${PORT}...`);
console.log("Setting idle timeout to 1 hour (3600000ms)...\n");

const sb = await modal.sandboxes.create(app, image, {
  command: ["python3", "-m", "http.server", PORT.toString()],
  encryptedPorts: [PORT],
  // 1 hour idle timeout
  idleTimeoutMs: 3600000,
  // 2 hour max timeout as safety
  timeoutMs: 7200000,
});

console.log("Sandbox created!");
console.log("  Sandbox ID:", sb.sandboxId);

console.log("\nWaiting for server to start...");
await new Promise((resolve) => setTimeout(resolve, 5000));

console.log("Getting tunnel information...");
const tunnels = await sb.tunnels();

console.log("\n=== Tunnel Information ===");
for (const [port, tunnel] of Object.entries(tunnels)) {
  console.log(`  Port ${port}:`);
  console.log(`    URL: ${tunnel.url}`);
}

const tunnel = tunnels[PORT];
if (tunnel) {
  console.log("\n=== Testing Connection ===");
  console.log(`Making GET request to: ${tunnel.url}`);

  // Retry logic for connection
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`  Attempt ${attempt}...`);
      const response = await fetch(tunnel.url);
      console.log(`  Status: ${response.status} ${response.statusText}`);
      const html = await response.text();
      console.log("\n=== Response (first 500 chars) ===");
      console.log(html.substring(0, 500));
      break;
    } catch (e: any) {
      console.error(`  Attempt ${attempt} failed:`, e.message || e);
      if (attempt < 3) {
        console.log("  Retrying in 2 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}

console.log("\n=== Sandbox is running ===");
console.log("The sandbox will auto-terminate after 1 hour of inactivity.");
console.log("Sandbox ID for reference:", sb.sandboxId);
console.log(`Tunnel URL: ${tunnel?.url}`);
console.log("\nNote: NOT terminating the sandbox - it will stay alive!");

process.exit(0);
