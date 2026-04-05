import { Hono } from "hono";
import { db } from "../db.js";
import { downloadQueue, downloadHistory } from "@tadaima/shared";
import { requireAuth, requireProfile } from "../middleware.js";
import { eq, and, desc } from "drizzle-orm";

const downloadRoutes = new Hono();

downloadRoutes.use("/*", requireAuth, requireProfile);

// List queued downloads for current profile
downloadRoutes.get("/queue", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;

  const rows = await db
    .select()
    .from(downloadQueue)
    .where(
      and(
        eq(downloadQueue.profileId, profileId),
        eq(downloadQueue.status, "queued"),
      ),
    )
    .orderBy(desc(downloadQueue.createdAt));

  return c.json(
    rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      deviceId: r.deviceId,
      payload: r.payload,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
    })),
  );
});

// Cancel a queued download
downloadRoutes.delete("/queue/:id", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(downloadQueue)
    .where(
      and(
        eq(downloadQueue.id, id),
        eq(downloadQueue.profileId, profileId),
      ),
    )
    .returning({ id: downloadQueue.id });

  if (!deleted) {
    return c.json({ error: "NOT_FOUND", detail: "Queued download not found" }, 404);
  }
  return c.json({ success: true });
});

// List download history
downloadRoutes.get("/", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const status = c.req.query("status");

  let query = db
    .select()
    .from(downloadHistory)
    .where(eq(downloadHistory.profileId, profileId))
    .orderBy(desc(downloadHistory.startedAt))
    .limit(limit)
    .offset(offset);

  if (status) {
    query = db
      .select()
      .from(downloadHistory)
      .where(
        and(
          eq(downloadHistory.profileId, profileId),
          eq(downloadHistory.status, status),
        ),
      )
      .orderBy(desc(downloadHistory.startedAt))
      .limit(limit)
      .offset(offset);
  }

  const rows = await query;
  return c.json(
    rows.map((r) => ({
      id: r.id,
      profileId: r.profileId,
      deviceId: r.deviceId,
      tmdbId: r.tmdbId,
      imdbId: r.imdbId,
      title: r.title,
      year: r.year,
      mediaType: r.mediaType,
      season: r.season,
      episode: r.episode,
      episodeTitle: r.episodeTitle,
      torrentName: r.torrentName,
      sizeBytes: r.sizeBytes,
      status: r.status,
      error: r.error,
      retryable: r.retryable,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  );
});

// Delete history entry
downloadRoutes.delete("/:id", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;
  const id = c.req.param("id");

  await db
    .delete(downloadHistory)
    .where(
      and(
        eq(downloadHistory.id, id),
        eq(downloadHistory.profileId, profileId),
      ),
    );

  return c.json({ success: true });
});

export { downloadRoutes };
