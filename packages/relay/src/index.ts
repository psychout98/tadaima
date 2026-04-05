import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setup } from "./routes/setup.js";
import { auth } from "./routes/auth.js";
import { profileRoutes } from "./routes/profiles.js";
import { settings } from "./routes/settings.js";
import { deviceRoutes } from "./routes/devices.js";
import { agentConfig } from "./routes/agent-config.js";
import { proxy } from "./routes/proxy.js";
import { recentlyViewedRoutes } from "./routes/recently-viewed.js";
import { downloadRoutes } from "./routes/downloads.js";
import { attachWebSocket } from "./ws/handler.js";
import { startStaleReaper } from "./ws/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read relay version
let relayVersion = "0.0.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
  );
  relayVersion = pkg.version;
} catch {
  // ignore
}

const app = new Hono();

app.use("/*", cors());

// ── API routes ─────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/version", (c) => {
  return c.json({
    version: relayVersion,
  });
});

app.route("/api/setup", setup);
app.route("/api/auth", auth);
app.route("/api/profiles", profileRoutes);
app.route("/api/admin/settings", settings);
app.route("/api/devices", deviceRoutes);
app.route("/api/agent", agentConfig);
app.route("/api", proxy);
app.route("/api/recently-viewed", recentlyViewedRoutes);
app.route("/api/downloads", downloadRoutes);

// ── Static file serving (production) ───────────────────────────

const webDistPath = join(__dirname, "../../web/dist");
if (existsSync(webDistPath)) {
  app.use("/*", serveStatic({ root: webDistPath }));

  // SPA fallback — serve index.html for non-API, non-file routes
  app.get("*", (c) => {
    try {
      const html = readFileSync(join(webDistPath, "index.html"), "utf-8");
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });
}

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
  console.log(`Relay v${relayVersion} listening on http://localhost:${info.port}`);
});

// Attach WebSocket handling to the HTTP server
attachWebSocket(server);
startStaleReaper();

export { app };
