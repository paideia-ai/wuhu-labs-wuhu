import { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "wuhu-core",
    version: "0.0.1",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

const port = parseInt(Deno.env.get("PORT") ?? "3000");
console.log(`Server running on http://localhost:${port}`);

Deno.serve({ port }, app.fetch);
