import { Hono } from "hono";
import { hash } from "bcrypt";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { admin, instanceSettings, profiles } from "@tadaima/shared";
import { setupCompleteRequestSchema } from "@tadaima/shared";
import { encrypt } from "../crypto.js";
import { clearSecretCache } from "../auth.js";
import { count } from "drizzle-orm";

const setup = new Hono();

setup.get("/status", async (c) => {
  const [result] = await db.select({ count: count() }).from(admin);
  return c.json({ needsSetup: result.count === 0 });
});

setup.post("/complete", async (c) => {
  // Check if already set up
  const [result] = await db.select({ count: count() }).from(admin);
  if (result.count > 0) {
    return c.json({ error: "SETUP_ALREADY_COMPLETE", detail: "Setup has already been completed" }, 409);
  }

  const body = await c.req.json();
  const parsed = setupCompleteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const { username, password, tmdbApiKey, rdApiKey, profileName, profileAvatar } = parsed.data;

  // Hash password
  const passwordHash = await hash(password, 12);

  // Generate JWT secret
  const jwtSecret = randomBytes(64).toString("hex");

  // Create admin
  const [newAdmin] = await db
    .insert(admin)
    .values({ username, passwordHash })
    .returning({ id: admin.id });

  // Store settings
  const now = new Date();
  await db.insert(instanceSettings).values([
    { key: "jwt_secret", value: jwtSecret, updatedAt: now },
    { key: "rd_api_key", value: encrypt(rdApiKey), updatedAt: now },
    { key: "tmdb_api_key", value: encrypt(tmdbApiKey), updatedAt: now },
  ]);

  // Clear cached JWT secret so it picks up the new one
  clearSecretCache();

  // Create first profile
  const [profile] = await db
    .insert(profiles)
    .values({ name: profileName, avatar: profileAvatar ?? null })
    .returning({ id: profiles.id, name: profiles.name, avatar: profiles.avatar });

  return c.json({
    adminId: newAdmin.id,
    profile: { id: profile.id, name: profile.name, avatar: profile.avatar, hasPin: false },
  }, 201);
});

export { setup };
