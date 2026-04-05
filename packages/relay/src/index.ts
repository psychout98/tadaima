import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { setup } from "./routes/setup.js";
import { auth } from "./routes/auth.js";
import { profileRoutes } from "./routes/profiles.js";
import { settings } from "./routes/settings.js";
import { deviceRoutes } from "./routes/devices.js";
import { agentConfig } from "./routes/agent-config.js";
import { attachWebSocket } from "./ws/handler.js";
import { startStaleReaper } from "./ws/pool.js";

const app = new Hono();

app.use("/*", cors());

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/setup", setup);
app.route("/api/auth", auth);
app.route("/api/profiles", profileRoutes);
app.route("/api/admin/settings", settings);
app.route("/api/devices", deviceRoutes);
app.route("/api/agent", agentConfig);

// Global error handler
app.onError((err, c) => {
  const status = "status" in err ? (err.status as number) : 500;
  if (status >= 500) console.error(err);
  return c.json(
    { error: "INTERNAL_ERROR", detail: err.message },
    status as 500,
  );
});

const port = parseInt(process.env.PORT ?? "3000", 10);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Relay listening on http://localhost:${info.port}`);
});

// Attach WebSocket handling to the HTTP server
attachWebSocket(server);
startStaleReaper();

export { app };
