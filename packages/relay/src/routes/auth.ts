import { Hono } from "hono";
import { compare } from "bcrypt";
import { createHash } from "node:crypto";
import { db } from "../db.js";
import { admin, refreshTokens } from "@tadaima/shared";
import { loginRequestSchema, refreshRequestSchema, logoutRequestSchema } from "@tadaima/shared";
import {
  signAdminAccessToken,
  signAdminRefreshToken,
  verifyToken,
} from "../auth.js";
import { eq, and } from "drizzle-orm";

const auth = new Hono();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

auth.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = loginRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(admin)
    .where(eq(admin.username, username))
    .limit(1);

  if (!user || !(await compare(password, user.passwordHash))) {
    return c.json({ error: "INVALID_CREDENTIALS", detail: "Invalid credentials" }, 401);
  }

  const accessToken = await signAdminAccessToken(user.id);
  const refreshToken = await signAdminRefreshToken(user.id);

  // Store refresh token hash
  await db.insert(refreshTokens).values({
    adminId: user.id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return c.json({ accessToken, refreshToken });
});

auth.post("/refresh", async (c) => {
  const body = await c.req.json();
  const parsed = refreshRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const { refreshToken: oldToken } = parsed.data;
  const tokenHash = hashToken(oldToken);

  // Verify JWT is valid
  let payload;
  try {
    payload = await verifyToken(oldToken);
  } catch {
    return c.json({ error: "TOKEN_INVALID", detail: "Invalid refresh token" }, 401);
  }

  if (payload.type !== "admin_refresh") {
    return c.json({ error: "TOKEN_INVALID", detail: "Not a refresh token" }, 401);
  }

  // Check token exists in DB
  const [existing] = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        eq(refreshTokens.adminId, payload.sub!),
      ),
    )
    .limit(1);

  if (!existing) {
    return c.json({ error: "TOKEN_INVALID", detail: "Refresh token not found or revoked" }, 401);
  }

  // Revoke old token
  await db.delete(refreshTokens).where(eq(refreshTokens.id, existing.id));

  // Issue new pair
  const accessToken = await signAdminAccessToken(payload.sub!);
  const newRefreshToken = await signAdminRefreshToken(payload.sub!);

  await db.insert(refreshTokens).values({
    adminId: payload.sub!,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return c.json({ accessToken, refreshToken: newRefreshToken });
});

auth.post("/logout", async (c) => {
  const body = await c.req.json();
  const parsed = logoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", detail: parsed.error.message }, 400);
  }

  const tokenHash = hashToken(parsed.data.refreshToken);
  await db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));

  return c.json({ success: true });
});

export { auth };
