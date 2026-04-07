import { Hono } from "hono";
import { hash, compare } from "bcrypt";
import { db } from "../db.js";
import { profiles } from "@tadaima/shared";
import {
  createProfileRequestSchema,
  updateProfileRequestSchema,
  selectProfileRequestSchema,
} from "@tadaima/shared";
import { signProfileToken } from "../auth.js";
import { requireAuth, requireAdmin } from "../middleware.js";
import { eq } from "drizzle-orm";

const profileRoutes = new Hono();

// List all profiles — public (needed for profile picker)
profileRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      pinHash: profiles.pinHash,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .orderBy(profiles.createdAt);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      hasPin: r.pinHash !== null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// Create profile — admin-only
profileRoutes.post("/", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json();
  const parsed = createProfileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const { name, avatar, pin } = parsed.data;

  // Check for duplicate name
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.name, name))
    .limit(1);
  if (existing.length > 0) {
    return c.json({ error: "DUPLICATE_NAME", detail: "A profile with this name already exists" }, 409);
  }

  const pinHash = pin ? await hash(pin, 10) : null;

  const [profile] = await db
    .insert(profiles)
    .values({ name, avatar: avatar ?? null, pinHash })
    .returning({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      pinHash: profiles.pinHash,
      createdAt: profiles.createdAt,
    });

  return c.json(
    {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      hasPin: profile.pinHash !== null,
      createdAt: profile.createdAt.toISOString(),
    },
    201,
  );
});

// Update profile — admin-only
profileRoutes.patch("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateProfileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.avatar !== undefined) updates.avatar = parsed.data.avatar;
  if (parsed.data.pin !== undefined) {
    updates.pinHash = parsed.data.pin ? await hash(parsed.data.pin, 10) : null;
  }

  const [profile] = await db
    .update(profiles)
    .set(updates)
    .where(eq(profiles.id, id))
    .returning({
      id: profiles.id,
      name: profiles.name,
      avatar: profiles.avatar,
      pinHash: profiles.pinHash,
      createdAt: profiles.createdAt,
    });

  if (!profile) {
    return c.json({ error: "PROFILE_NOT_FOUND", detail: "Profile not found" }, 404);
  }

  return c.json({
    id: profile.id,
    name: profile.name,
    avatar: profile.avatar,
    hasPin: profile.pinHash !== null,
    createdAt: profile.createdAt.toISOString(),
  });
});

// Delete profile — admin-only
profileRoutes.delete("/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const [deleted] = await db
    .delete(profiles)
    .where(eq(profiles.id, id))
    .returning({ id: profiles.id });

  if (!deleted) {
    return c.json({ error: "PROFILE_NOT_FOUND", detail: "Profile not found" }, 404);
  }

  return c.json({ success: true });
});

// Select a profile — public (validates PIN if present)
profileRoutes.post("/:id/select", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = selectProfileRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);

  if (!profile) {
    return c.json({ error: "PROFILE_NOT_FOUND", detail: "Profile not found" }, 404);
  }

  // Validate PIN if the profile has one
  if (profile.pinHash) {
    if (!parsed.data.pin) {
      return c.json({ error: "INVALID_PIN", detail: "PIN is required" }, 401);
    }
    const valid = await compare(parsed.data.pin, profile.pinHash);
    if (!valid) {
      return c.json({ error: "INVALID_PIN", detail: "Incorrect PIN" }, 401);
    }
  }

  const token = await signProfileToken(profile.id);

  return c.json({
    token,
    profile: {
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar,
      hasPin: profile.pinHash !== null,
      createdAt: profile.createdAt.toISOString(),
    },
  });
});

export { profileRoutes };
