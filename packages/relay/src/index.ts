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
import { dirname, join, resolve } from "node:path";
import { setup } from "./routes/setup.js";
import { auth } from "./routes/auth.js";
import { profileRoutes } from "./routes/profiles.js";
import { settings } from "./routes/settings.js";
import { deviceRoutes } from "./routes/devices.js";
import { agentConfig } from "./routes/agent-config.js";
import { proxy } from "./routes/proxy.js";
import { recentlyViewedRoutes } from "./routes/recently-viewed.js";
import { downloadRoutes } from "./routes/downloads.js";
import { versionRoute } from "./routes/version.js";
import { securityHeaders } from "./middleware.js";
import { attachWebSocket } from "./ws/handler.js";
import { startStaleReaper, stopStaleReaper } from "./ws/pool.js";
import { closeDatabase } from "./db.js";
import { runMigrations } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Startup security checks ──────────────────────────────────
const nodeEnv = process.env.NODE_ENV ?? "";
if (nodeEnv === "production") {
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (jwtSecret === "change-me-in-production" || (jwtSecret && jwtSecret.length < 32)) {
    console.error(
      "FATAL: JWT_SECRET is insecure — it must not be the default placeholder and must be at least 32 characters.",
    );
    process.exit(1);
  }

  const encryptionKey = process.env.ENCRYPTION_MASTER_KEY ?? "";
  if (!encryptionKey || encryptionKey.length < 32) {
    console.error(
      "FATAL: ENCRYPTION_MASTER_KEY is missing or too short (min 32 hex chars). " +
        "Generate one with: openssl rand -hex 32",
    );
    process.exit(1);
  }
}

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

app.use("/*", securityHeaders);
app.use("/*", cors());

// ── API routes ─────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/api/version", versionRoute);

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
    const resolved = resolve(filePath);
    if (!resolved.startsWith(resolve(webDistPath))) return c.notFound();
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
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return c.notFound();
      }
      console.error("Static file serving error:", err);
      return c.json({ error: "INTERNAL_ERROR", detail: "Failed to read static file" }, 500);
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
    } catch (err: unknown) {
      console.error("SPA fallback error: failed to read index.html:", err);
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

// Run database migrations before accepting connections
try {
  await runMigrations();
} catch (err) {
  console.warn("Migration warning:", (err as Error).message);
  console.warn("Continuing — tables may already exist.");
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Relay v${relayVersion} listening on http://localhost:${info.port}`);
});

// Attach WebSocket handling to the HTTP server
attachWebSocket(server);
startStaleReaper();

// ── Graceful shutdown ─────────────────────────────────────────
async function shutdown() {
  console.log("Shutting down gracefully…");
  stopStaleReaper();
  server.close();
  await closeDatabase();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app };
