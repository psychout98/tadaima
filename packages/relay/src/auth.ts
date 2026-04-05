import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { db } from "./db.js";
import { instanceSettings } from "@tadaima/shared";
import { eq } from "drizzle-orm";

export interface AdminTokenPayload extends JWTPayload {
  sub: string;
  type: "admin";
}

export interface AdminRefreshPayload extends JWTPayload {
  sub: string;
  type: "admin_refresh";
}

export interface ProfileTokenPayload extends JWTPayload {
  sub: string;
  type: "profile";
}

export interface DeviceTokenPayload extends JWTPayload {
  sub: string;
  type: "device";
  deviceId: string;
}

export type TokenPayload =
  | AdminTokenPayload
  | AdminRefreshPayload
  | ProfileTokenPayload
  | DeviceTokenPayload;

let cachedSecret: Uint8Array | null = null;

async function getJwtSecret(): Promise<Uint8Array> {
  if (cachedSecret) return cachedSecret;

  const row = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "jwt_secret"))
    .limit(1);

  if (row.length === 0) {
    throw new Error("JWT secret not configured. Run setup first.");
  }

  cachedSecret = new TextEncoder().encode(row[0].value);
  return cachedSecret;
}

export function clearSecretCache(): void {
  cachedSecret = null;
}

export async function signAdminAccessToken(adminId: string): Promise<string> {
  const secret = await getJwtSecret();
  return new SignJWT({ sub: adminId, type: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function signAdminRefreshToken(adminId: string): Promise<string> {
  const secret = await getJwtSecret();
  return new SignJWT({ sub: adminId, type: "admin_refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function signProfileToken(profileId: string): Promise<string> {
  const secret = await getJwtSecret();
  return new SignJWT({ sub: profileId, type: "profile" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

export async function signDeviceToken(
  profileId: string,
  deviceId: string,
): Promise<string> {
  const secret = await getJwtSecret();
  return new SignJWT({ sub: profileId, type: "device", deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const secret = await getJwtSecret();
  const { payload } = await jwtVerify(token, secret);
  return payload as TokenPayload;
}
