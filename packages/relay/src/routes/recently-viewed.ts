import { Hono } from "hono";
import { db } from "../db.js";
import { recentlyViewed } from "@tadaima/shared";
import { requireAuth, requireProfile } from "../middleware.js";
import { eq, and, desc } from "drizzle-orm";
const recentlyViewedRoutes = new Hono();

recentlyViewedRoutes.use("/*", requireAuth, requireProfile);

recentlyViewedRoutes.get("/", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;

  const rows = await db
    .select()
    .from(recentlyViewed)
    .where(eq(recentlyViewed.profileId, profileId))
    .orderBy(desc(recentlyViewed.viewedAt))
    .limit(20);

  return c.json(
    rows.map((r) => ({
      id: r.id,
      tmdbId: r.tmdbId,
      mediaType: r.mediaType,
      title: r.title,
      year: r.year,
      posterPath: r.posterPath,
      imdbId: r.imdbId,
      viewedAt: r.viewedAt.toISOString(),
    })),
  );
});

recentlyViewedRoutes.post("/", async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = (c as any).get("token") as { sub: string };
  const profileId = token.sub;
  const body = await c.req.json();

  const { tmdbId, mediaType, title, year, posterPath, imdbId } = body;

  if (!tmdbId || !mediaType || !title) {
    return c.json({ error: "VALIDATION_ERROR", detail: "tmdbId, mediaType, and title are required" }, 400);
  }

  // Upsert: update viewedAt if exists, insert if not
  const [existing] = await db
    .select({ id: recentlyViewed.id })
    .from(recentlyViewed)
    .where(
      and(
        eq(recentlyViewed.profileId, profileId),
        eq(recentlyViewed.tmdbId, tmdbId),
        eq(recentlyViewed.mediaType, mediaType),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(recentlyViewed)
      .set({ viewedAt: new Date(), title, year, posterPath, imdbId })
      .where(eq(recentlyViewed.id, existing.id));
  } else {
    await db.insert(recentlyViewed).values({
      profileId,
      tmdbId,
      mediaType,
      title,
      year: year ?? 0,
      posterPath: posterPath ?? null,
      imdbId: imdbId ?? null,
    });

    // Evict oldest beyond 20
    const all = await db
      .select({ id: recentlyViewed.id })
      .from(recentlyViewed)
      .where(eq(recentlyViewed.profileId, profileId))
      .orderBy(desc(recentlyViewed.viewedAt));

    if (all.length > 20) {
      const toDelete = all.slice(20).map((r) => r.id);
      for (const id of toDelete) {
        await db.delete(recentlyViewed).where(eq(recentlyViewed.id, id));
      }
    }
  }

  return c.json({ success: true });
});

export { recentlyViewedRoutes };
