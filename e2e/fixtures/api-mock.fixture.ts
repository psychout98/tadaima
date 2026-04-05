import { type Page, type Route } from "@playwright/test";

/** TMDB search results fixture */
const TMDB_SEARCH_RESULTS = [
  {
    tmdbId: 27205,
    imdbId: "tt1375666",
    title: "Inception",
    year: 2010,
    mediaType: "movie" as const,
    posterPath: "/9gk7adzbiiIifvniDPMKfRQSFyN.jpg",
    overview: "A thief who steals secrets through dreams is given the task of planting an idea.",
  },
  {
    tmdbId: 1399,
    imdbId: "tt0944947",
    title: "Game of Thrones",
    year: 2011,
    mediaType: "tv" as const,
    posterPath: "/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg",
    overview: "Seven noble families fight for control of the mythical land of Westeros.",
  },
];

/** Stream fixtures */
const STREAM_FIXTURES = [
  {
    title: "Inception.2010.1080p.BluRay.x264",
    infoHash: "abc123def456",
    magnet: "magnet:?xt=urn:btih:abc123def456",
    size: 2_500_000_000,
    seeds: 150,
    resolution: "1080p",
    codec: "x264",
    audio: "5.1",
    hdr: false,
    source: "BluRay",
  },
  {
    title: "Inception.2010.2160p.UHD.BluRay.HDR",
    infoHash: "def789ghi012",
    magnet: "magnet:?xt=urn:btih:def789ghi012",
    size: 8_000_000_000,
    seeds: 50,
    resolution: "2160p",
    codec: "x265",
    audio: "Atmos",
    hdr: true,
    source: "BluRay",
  },
  {
    title: "Inception.2010.720p.WEB-DL",
    infoHash: "ghi345jkl678",
    magnet: "magnet:?xt=urn:btih:ghi345jkl678",
    size: 1_200_000_000,
    seeds: 80,
    resolution: "720p",
    codec: "x264",
    audio: "2.0",
    hdr: false,
    source: "WEB-DL",
  },
];

/** Media detail fixture */
const MEDIA_DETAIL = {
  movie: {
    tmdbId: 27205,
    imdbId: "tt1375666",
    title: "Inception",
    year: 2010,
    mediaType: "movie",
    posterPath: "/9gk7adzbiiIifvniDPMKfRQSFyN.jpg",
    overview: "A thief who steals secrets through dreams.",
    runtime: 148,
    genres: ["Action", "Science Fiction"],
  },
  tv: {
    tmdbId: 1399,
    imdbId: "tt0944947",
    title: "Game of Thrones",
    year: 2011,
    mediaType: "tv",
    posterPath: "/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg",
    overview: "Seven noble families fight for control.",
    seasons: [
      { seasonNumber: 1, name: "Season 1", episodeCount: 10 },
      { seasonNumber: 2, name: "Season 2", episodeCount: 10 },
    ],
  },
};

/**
 * Set up API route mocks for TMDB/stream endpoints.
 * Call this in tests that need deterministic search/stream results.
 */
export async function mockExternalApis(page: Page): Promise<void> {
  // Mock search
  await page.route("**/api/search*", async (route: Route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";

    const results = TMDB_SEARCH_RESULTS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.overview?.toLowerCase().includes(q),
    );

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(results),
    });
  });

  // Mock media detail
  await page.route("**/api/media/**", async (route: Route) => {
    const url = route.request().url();
    const isTV = url.includes("/tv/");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isTV ? MEDIA_DETAIL.tv : MEDIA_DETAIL.movie),
    });
  });

  // Mock streams
  await page.route("**/api/streams/**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STREAM_FIXTURES),
    });
  });

  // Mock poster images
  await page.route("**/api/poster/**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      body: Buffer.alloc(100), // empty placeholder image
    });
  });
}

export { TMDB_SEARCH_RESULTS, STREAM_FIXTURES, MEDIA_DETAIL };
