try {
  await import("dotenv/config");
} catch {
  // dotenv not available in production — that's fine
}

import { Hono } from "hono";
import { cors } from "hono/cors";
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

// Find the web dist folder — works both in dev and Docker
const webDistCandidates = [
  join(__dirname, "../../web/dist"),           // dev: from packages/relay/src
  join(__dirname, "../web/dist"),              // docker: from packages/relay/dist
  join(process.cwd(), "packages/web/dist"),    // cwd fallback
];

const webDistPath = webDistCandidates.find((p) => existsSync(p));

if (webDistPath) {
  // Serve static files with the absolute path via a custom handler
  app.get("/assets/*", async (c) => {
    const filePath = join(webDistPath, c.req.path);
    try {
      const content = readFileSync(filePath);
      const ext = c.req.path.split(".").pop() ?? "";
      const types: Record<string, string> = {
        js: "application/javascript",
        css: "text/css",
        html: "text/html",
        json: "application/json",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        ico: "image/x-icon",
      };
      c.header("Content-Type", types[ext] ?? "application/octet-stream");
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      return c.body(content as unknown as ReadableStream);
    } catch {
      return c.notFound();
    }
  });

  // SPA fallback — serve index.html for non-API routes
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/ws")) {
      return c.notFound();
    }
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
