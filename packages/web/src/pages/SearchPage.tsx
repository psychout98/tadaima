import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useAuthStore } from "../lib/store";
import { StreamPicker } from "../components/StreamPicker";

interface SearchResult {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  posterPath: string | null;
  overview: string | null;
}

interface RecentItem {
  tmdbId: number;
  mediaType: string;
  title: string;
  year: number;
  posterPath: string | null;
  imdbId: string | null;
}

export function SearchPage() {
  const { profileToken } = useAuthStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [recentlyViewed, setRecentlyViewed] = useState<RecentItem[]>([]);

  const loadRecent = useCallback(async () => {
    if (!profileToken) return;
    try {
      const items = await api.recentlyViewed.list(profileToken);
      setRecentlyViewed(items);
    } catch {
      // ignore
    }
  }, [profileToken]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent, profileToken]);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSelected(null);
    try {
      const data = await api.search(query.trim());
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelect(result: SearchResult) {
    setSelected(result);
    if (profileToken) {
      await api.recentlyViewed.add(
        {
          tmdbId: result.tmdbId,
          mediaType: result.mediaType,
          title: result.title,
          year: result.year,
          posterPath: result.posterPath,
          imdbId: result.imdbId,
        },
        profileToken,
      ).catch(() => {});
      loadRecent();
    }
  }

  function handleRecentClick(item: RecentItem) {
    handleSelect({
      tmdbId: item.tmdbId,
      imdbId: item.imdbId,
      title: item.title,
      year: item.year,
      mediaType: item.mediaType as "movie" | "tv",
      posterPath: item.posterPath,
      overview: null,
    });
  }

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6 flex gap-3">
        <input
          data-testid="search-bar"
          type="text"
          placeholder="Search movies and TV shows..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          data-testid="search-btn"
          type="submit"
          disabled={!query.trim() || searching}
          className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white disabled:opacity-50"
        >
          {searching ? "..." : "Search"}
        </button>
      </form>

      {/* Recently viewed */}
      {recentlyViewed.length > 0 && !selected && (
        <div data-testid="recently-viewed" className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-zinc-400">
            Recently Viewed
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentlyViewed.slice(0, 8).map((item) => (
              <button
                key={`${item.tmdbId}-${item.mediaType}`}
                onClick={() => handleRecentClick(item)}
                className="flex-shrink-0"
              >
                {item.posterPath ? (
                  <img
                    src={api.posterUrl(item.posterPath)}
                    alt={item.title}
                    className="h-24 w-16 rounded object-cover transition-transform hover:scale-105"
                  />
                ) : (
                  <div className="flex h-24 w-16 items-center justify-center rounded bg-zinc-800 text-xs text-zinc-500">
                    {item.title.slice(0, 6)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stream picker */}
      {selected && (
        <StreamPicker
          result={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Results grid */}
      {!selected && results.length > 0 && (
        <div data-testid="results-grid" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {results.map((r) => (
            <button
              data-testid="result-card"
              key={`${r.tmdbId}-${r.mediaType}`}
              onClick={() => handleSelect(r)}
              className="group text-left"
            >
              <div className="overflow-hidden rounded-lg">
                {r.posterPath ? (
                  <img
                    src={api.posterUrl(r.posterPath)}
                    alt={r.title}
                    className="aspect-[2/3] w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-zinc-800 text-zinc-500">
                    No Image
                  </div>
                )}
              </div>
              <div className="mt-2">
                <p className="text-sm font-medium leading-tight line-clamp-1">
                  {r.title}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {r.year && (
                    <span className="text-xs text-zinc-400">{r.year}</span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      r.mediaType === "movie"
                        ? "bg-indigo-500/20 text-indigo-300"
                        : "bg-blue-500/20 text-blue-300"
                    }`}
                  >
                    {r.mediaType === "movie" ? "Movie" : "TV"}
                  </span>
                </div>
                {r.overview && (
                  <p className="mt-1 text-xs leading-tight text-zinc-500 line-clamp-2">
                    {r.overview}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!selected && results.length === 0 && !searching && query && (
        <p data-testid="no-results" className="text-center text-zinc-500">No results found.</p>
      )}
    </div>
  );
}
