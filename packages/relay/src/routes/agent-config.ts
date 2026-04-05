import { Hono } from "hono";
import { db } from "../db.js";
import { instanceSettings } from "@tadaima/shared";
import { decrypt } from "../crypto.js";
import { requireAuth } from "../middleware.js";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const agentConfig = new Hono();

// Agent fetches current config (RD key, relay version)
agentConfig.get("/config", requireAuth, async (c) => {
  const token = c.get("token");
  if (token.type !== "device") {
    return c.json({ error: "FORBIDDEN", detail: "Device token required" }, 403);
  }

  const [rdSetting] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "rd_api_key"))
    .limit(1);

  let relayVersion = "0.0.0";
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
    );
    relayVersion = pkg.version;
  } catch {
    // ignore
  }

  return c.json({
    rdApiKey: rdSetting ? decrypt(rdSetting.value) : "",
    relayVersion,
  });
});

export { agentConfig };
