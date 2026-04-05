import { Hono } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db.js";
import {
  devices,
  pairingCodes,
  instanceSettings,
  updateDeviceRequestSchema,
  pairClaimRequestSchema,
} from "@tadaima/shared";
import { signDeviceToken } from "../auth.js";
import { decrypt } from "../crypto.js";
import { requireAuth, requireProfile } from "../middleware.js";
import { eq, and, count } from "drizzle-orm";
import type { TokenPayload } from "../auth.js";

const PAIRING_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const CODE_LENGTH = 6;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_DEVICES_PER_PROFILE = 5;

function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes)
    .map((b) => PAIRING_CHARS[b % PAIRING_CHARS.length])
    .join("");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getProfileId(token: TokenPayload): string {
  if (token.type === "profile") return token.sub!;
  if (token.type === "admin") return token.sub!;
  return "";
}

const deviceRoutes = new Hono();

// List devices for current profile
deviceRoutes.get("/", requireAuth, requireProfile, async (c) => {
  const profileId = getProfileId(c.get("token"));
  const rows = await db
    .select()
    .from(devices)
    .where(eq(devices.profileId, profileId))
    .orderBy(devices.createdAt);

  return c.json(
    rows.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      isOnline: d.isOnline,
      isDefault: d.isDefault,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  );
});

// Update device
deviceRoutes.patch("/:id", requireAuth, requireProfile, async (c) => {
  const id = c.req.param("id");
  const profileId = getProfileId(c.get("token"));
  const body = await c.req.json();
  const parsed = updateDeviceRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;

  // If setting as default, unset other defaults first
  if (parsed.data.isDefault === true) {
    await db
      .update(devices)
      .set({ isDefault: false })
      .where(eq(devices.profileId, profileId));
    updates.isDefault = true;
  }

  const [device] = await db
    .update(devices)
    .set(updates)
    .where(and(eq(devices.id, id), eq(devices.profileId, profileId)))
    .returning();

  if (!device) {
    return c.json({ error: "DEVICE_NOT_FOUND", detail: "Device not found" }, 404);
  }

  return c.json({
    id: device.id,
    name: device.name,
    platform: device.platform,
    isOnline: device.isOnline,
    isDefault: device.isDefault,
    lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    createdAt: device.createdAt.toISOString(),
  });
});

// Delete/revoke device
deviceRoutes.delete("/:id", requireAuth, requireProfile, async (c) => {
  const id = c.req.param("id");
  const profileId = getProfileId(c.get("token"));

  const [deleted] = await db
    .delete(devices)
    .where(and(eq(devices.id, id), eq(devices.profileId, profileId)))
    .returning({ id: devices.id });

  if (!deleted) {
    return c.json({ error: "DEVICE_NOT_FOUND", detail: "Device not found" }, 404);
  }

  return c.json({ success: true });
});

// Generate pairing code
deviceRoutes.post("/pair/request", requireAuth, requireProfile, async (c) => {
  const profileId = getProfileId(c.get("token"));

  // Check device limit
  const [deviceCount] = await db
    .select({ count: count() })
    .from(devices)
    .where(eq(devices.profileId, profileId));

  if (deviceCount.count >= MAX_DEVICES_PER_PROFILE) {
    return c.json(
      { error: "DEVICE_LIMIT_REACHED", detail: `Maximum ${MAX_DEVICES_PER_PROFILE} devices per profile` },
      400,
    );
  }

  // Delete any existing unclaimed codes for this profile
  await db
    .delete(pairingCodes)
    .where(
      and(
        eq(pairingCodes.profileId, profileId),
        eq(pairingCodes.claimed, false),
      ),
    );

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  await db.insert(pairingCodes).values({
    code,
    profileId,
    expiresAt,
  });

  return c.json({ code, expiresAt: expiresAt.toISOString() });
});

// Claim pairing code (called by agent)
deviceRoutes.post("/pair/claim", async (c) => {
  const body = await c.req.json();
  const parsed = pairClaimRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const { code, name, platform } = parsed.data;

  // Find the pairing code
  const [pairingCode] = await db
    .select()
    .from(pairingCodes)
    .where(eq(pairingCodes.code, code.toUpperCase()))
    .limit(1);

  if (!pairingCode) {
    return c.json({ error: "PAIRING_CODE_INVALID", detail: "Invalid pairing code" }, 404);
  }

  if (pairingCode.claimed) {
    return c.json({ error: "PAIRING_CODE_INVALID", detail: "Code already claimed" }, 409);
  }

  if (pairingCode.expiresAt < new Date()) {
    return c.json({ error: "PAIRING_CODE_EXPIRED", detail: "Pairing code has expired" }, 404);
  }

  // Check device limit
  const [deviceCount] = await db
    .select({ count: count() })
    .from(devices)
    .where(eq(devices.profileId, pairingCode.profileId));

  if (deviceCount.count >= MAX_DEVICES_PER_PROFILE) {
    return c.json(
      { error: "DEVICE_LIMIT_REACHED", detail: `Maximum ${MAX_DEVICES_PER_PROFILE} devices per profile` },
      400,
    );
  }

  // Check if this is the first device (auto-default)
  const isFirst = deviceCount.count === 0;

  // Sign device token
  const deviceId = crypto.randomUUID();
  const deviceToken = await signDeviceToken(pairingCode.profileId, deviceId);
  const tokenHash = hashToken(deviceToken);

  // Create device
  await db.insert(devices).values({
    id: deviceId,
    profileId: pairingCode.profileId,
    name,
    platform,
    tokenHash,
    isDefault: isFirst,
  });

  // Mark code as claimed
  await db
    .update(pairingCodes)
    .set({ claimed: true, deviceId })
    .where(eq(pairingCodes.code, code.toUpperCase()));

  // Get RD API key from instance settings
  const [rdSetting] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "rd_api_key"))
    .limit(1);

  const rdApiKey = rdSetting ? decrypt(rdSetting.value) : "";

  // Determine WebSocket URL from request
  const proto = c.req.header("x-forwarded-proto") ?? "ws";
  const host = c.req.header("host") ?? "localhost:3000";
  const wsProto = proto === "https" ? "wss" : "ws";
  const wsUrl = `${wsProto}://${host}/ws/agent`;

  return c.json({
    deviceId,
    deviceToken,
    rdApiKey,
    wsUrl,
  });
});

export { deviceRoutes };
