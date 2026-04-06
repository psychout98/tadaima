import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken, type TokenPayload } from "./auth.js";

export type Env = {
  Variables: {
    token: TokenPayload;
  };
};

// ── Security headers ────────────────────────────────────────────
export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://image.tmdb.org data:; connect-src 'self' ws: wss:",
  );
  const proto = c.req.header("X-Forwarded-Proto");
  if (proto === "https" || c.req.url.startsWith("https://")) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "Missing or invalid token" });
  }

  try {
    const payload = await verifyToken(header.slice(7));
    c.set("token", payload);
    await next();
  } catch {
    throw new HTTPException(401, { message: "Invalid or expired token" });
  }
});

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const token = c.get("token");
  if (token.type !== "admin") {
    throw new HTTPException(403, { message: "Admin access required" });
  }
  await next();
});

export const requireProfile = createMiddleware<Env>(async (c, next) => {
  const token = c.get("token");
  if (token.type !== "profile" && token.type !== "admin") {
    throw new HTTPException(403, { message: "Profile session required" });
  }
  await next();
});
