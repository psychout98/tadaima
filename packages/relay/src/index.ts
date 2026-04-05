import { Hono } from "hono";
import { serve } from "@hono/node-server";

const app = new Hono();

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

const port = parseInt(process.env.PORT ?? "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Relay listening on http://localhost:${info.port}`);
});
