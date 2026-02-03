import { createServer, version } from "vite";

console.log("vite version:", version);

const server = await createServer({
  configFile: "./vite.config.ts",
});

await server.listen();
server.printUrls();
