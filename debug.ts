import { ModalClient } from "modal";

const tokenId = process.env.MODAL_TOKEN_ID?.trim();
const tokenSecret = process.env.MODAL_TOKEN_SECRET?.trim();

console.log("Token ID:", tokenId);
console.log("Token Secret:", tokenSecret?.substring(0, 5) + "...");
console.log("Token ID length:", tokenId?.length);
console.log("Token Secret length:", tokenSecret?.length);

if (!tokenId || !tokenSecret) {
  throw new Error(
    "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables must be set"
  );
}

console.log("\nAttempting to create ModalClient...");
const modal = new ModalClient({ tokenId, tokenSecret });

console.log("ModalClient created, attempting to get app...");
try {
  const app = await modal.apps.fromName("test-app", { createIfMissing: true });
  console.log("Success! App:", app);
} catch (e) {
  console.error("Error:", e);
}
