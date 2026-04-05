import { Hono } from "hono";
import { db } from "../db.js";
import { instanceSettings, updateSettingsRequestSchema } from "@tadaima/shared";
import { encrypt, decrypt } from "../crypto.js";
import { requireAuth, requireAdmin } from "../middleware.js";

const settings = new Hono();

// All settings routes require admin auth
settings.use("/*", requireAuth, requireAdmin);

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

settings.get("/", async (c) => {
  const rows = await db.select().from(instanceSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const rdEncrypted = map.get("rd_api_key");
  const tmdbEncrypted = map.get("tmdb_api_key");

  return c.json({
    rdApiKey: rdEncrypted ? maskKey(decrypt(rdEncrypted)) : null,
    tmdbApiKey: tmdbEncrypted ? maskKey(decrypt(tmdbEncrypted)) : null,
  });
});

settings.patch("/", async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const now = new Date();

  if (parsed.data.rdApiKey) {
    await db
      .insert(instanceSettings)
      .values({ key: "rd_api_key", value: encrypt(parsed.data.rdApiKey), updatedAt: now })
      .onConflictDoUpdate({
        target: instanceSettings.key,
        set: { value: encrypt(parsed.data.rdApiKey), updatedAt: now },
      });
  }

  if (parsed.data.tmdbApiKey) {
    await db
      .insert(instanceSettings)
      .values({ key: "tmdb_api_key", value: encrypt(parsed.data.tmdbApiKey), updatedAt: now })
      .onConflictDoUpdate({
        target: instanceSettings.key,
        set: { value: encrypt(parsed.data.tmdbApiKey), updatedAt: now },
      });
  }

  return c.json({ success: true });
});

settings.post("/test-rd", async (c) => {
  const { apiKey } = await c.req.json();
  if (!apiKey) {
    return c.json({ valid: false, detail: "API key is required" });
  }

  try {
    const res = await fetch("https://api.real-debrid.com/rest/1.0/user", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      return c.json({ valid: true });
    }
    return c.json({ valid: false, detail: "Invalid API key" });
  } catch {
    return c.json({ valid: false, detail: "Failed to connect to Real-Debrid" });
  }
});

settings.post("/test-tmdb", async (c) => {
  const { apiKey } = await c.req.json();
  if (!apiKey) {
    return c.json({ valid: false, detail: "API key is required" });
  }

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/configuration?api_key=${apiKey}`,
    );
    if (res.ok) {
      return c.json({ valid: true });
    }
    return c.json({ valid: false, detail: "Invalid API key" });
  } catch {
    return c.json({ valid: false, detail: "Failed to connect to TMDB" });
  }
});

export { settings };
