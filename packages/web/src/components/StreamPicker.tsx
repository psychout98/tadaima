import { useState, useEffect, useMemo } from "react";
import { api } from "../lib/api";
import { useAuthStore } from "../lib/store";

interface SearchResult {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  posterPath: string | null;
  overview: string | null;
}

interface Stream {
  title: string;
  infoHash: string;
  magnet: string;
  size: number | null;
  seeds: number | null;
  resolution: string | null;
  codec: string | null;
  audio: string | null;
  hdr: boolean | null;
  source: string | null;
}

interface Season {
  seasonNumber: number;
  name: string;
  episodeCount: number;
}

interface Device {
  id: string;
  name: string;
  platform: string;
  isOnline: boolean;
  isDefault: boolean;
}

const RESOLUTIONS = ["480p", "720p", "1080p", "2160p"];
const AUDIO_OPTIONS = ["2.0", "5.1", "7.1", "Atmos"];

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export function StreamPicker({
  result,
  onClose,
}: {
  result: SearchResult;
  onClose: () => void;
}) {
  const { profileToken } = useAuthStore();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loading, setLoading] = useState(true);
  const [imdbId, setImdbId] = useState(result.imdbId);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  // TV state
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);

  // Filters
  const [resFilter, setResFilter] = useState<Set<string>>(new Set());
  const [audioFilter, setAudioFilter] = useState<Set<string>>(new Set());
  const [hdrFilter, setHdrFilter] = useState(false);

  // Pagination
  const [perPage, setPerPage] = useState(10);
  const [page, setPage] = useState(0);

  // Load media detail (for imdbId and TV seasons)
  useEffect(() => {
    api.media(result.mediaType, result.tmdbId).then((detail) => {
      setImdbId(detail.imdbId);
      if (detail.seasons) {
        const filtered = detail.seasons.filter((s) => s.seasonNumber > 0);
        setSeasons(filtered);
        if (filtered.length > 0) {
          setSelectedSeason(filtered[0].seasonNumber);
          setSelectedEpisode(1);
        }
      }
    });
  }, [result.tmdbId, result.mediaType]);

  // Load devices
  useEffect(() => {
    if (!profileToken) return;
    api.devices.list(profileToken).then((d) => {
      setDevices(d);
      const def = d.find((x) => x.isDefault);
      if (def) setSelectedDevice(def.id);
    });
  }, [profileToken]);

  // Load streams
  useEffect(() => {
    if (!imdbId) return;
    if (result.mediaType === "tv" && (selectedSeason === null || selectedEpisode === null)) return;

    setLoading(true);
    setPage(0);
    api
      .streams(
        result.mediaType,
        imdbId,
        result.mediaType === "tv" ? selectedSeason! : undefined,
        result.mediaType === "tv" ? selectedEpisode! : undefined,
      )
      .then(setStreams)
      .catch(() => setStreams([]))
      .finally(() => setLoading(false));
  }, [imdbId, result.mediaType, selectedSeason, selectedEpisode]);

  // Filtered streams
  const filtered = useMemo(() => {
    return streams.filter((s) => {
      if (resFilter.size > 0 && (!s.resolution || !resFilter.has(s.resolution)))
        return false;
      if (audioFilter.size > 0 && (!s.audio || !audioFilter.has(s.audio)))
        return false;
      if (hdrFilter && !s.hdr) return false;
      return true;
    });
  }, [streams, resFilter, audioFilter, hdrFilter]);

  const paged = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  const activeFilterCount =
    resFilter.size + audioFilter.size + (hdrFilter ? 1 : 0);

  function toggleFilter(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function clearFilters() {
    setResFilter(new Set());
    setAudioFilter(new Set());
    setHdrFilter(false);
  }

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="mb-4 flex gap-4">
        {result.posterPath && (
          <img
            src={api.posterUrl(result.posterPath)}
            alt={result.title}
            className="h-36 w-24 rounded-lg object-cover"
          />
        )}
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold">{result.title}</h2>
              <div className="mt-1 flex items-center gap-2">
                {result.year && (
                  <span className="text-sm text-zinc-400">{result.year}</span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    result.mediaType === "movie"
                      ? "bg-indigo-500/20 text-indigo-300"
                      : "bg-blue-500/20 text-blue-300"
                  }`}
                >
                  {result.mediaType === "movie" ? "Movie" : "TV"}
                </span>
                {imdbId && (
                  <a
                    href={`https://www.imdb.com/title/${imdbId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300"
                  >
                    IMDb
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-sm text-zinc-500 hover:text-white"
            >
              Close
            </button>
          </div>
          {result.overview && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400 line-clamp-3">
              {result.overview}
            </p>
          )}
        </div>
      </div>

      {/* TV Season/Episode selector */}
      {result.mediaType === "tv" && seasons.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <select
            value={selectedSeason ?? ""}
            onChange={(e) => {
              setSelectedSeason(Number(e.target.value));
              setSelectedEpisode(1);
            }}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          >
            {seasons.map((s) => (
              <option key={s.seasonNumber} value={s.seasonNumber}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedSeason !== null && (
            <select
              value={selectedEpisode ?? ""}
              onChange={(e) => setSelectedEpisode(Number(e.target.value))}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
            >
              {Array.from(
                {
                  length:
                    seasons.find((s) => s.seasonNumber === selectedSeason)
                      ?.episodeCount ?? 0,
                },
                (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    Episode {i + 1}
                  </option>
                ),
              )}
            </select>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setResFilter(toggleFilter(resFilter, r))}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              resFilter.has(r)
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {r}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-zinc-700" />
        <button
          onClick={() => setHdrFilter(!hdrFilter)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            hdrFilter
              ? "bg-blue-600 text-white"
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          HDR
        </button>
        <div className="mx-1 h-4 w-px bg-zinc-700" />
        {AUDIO_OPTIONS.map((a) => (
          <button
            key={a}
            onClick={() => setAudioFilter(toggleFilter(audioFilter, a))}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              audioFilter.has(a)
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {a}
          </button>
        ))}
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="text-xs text-zinc-500 hover:text-white"
          >
            Clear ({activeFilterCount})
          </button>
        )}
        <span className="ml-auto text-xs text-zinc-500">
          Showing {filtered.length} of {streams.length} streams
        </span>
      </div>

      {/* Device selector */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs text-zinc-400">Download to:</label>
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isDefault ? " (default)" : ""}
              {!d.isOnline ? " — Offline, will queue" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Stream table */}
      {loading ? (
        <p className="text-center text-zinc-500">Loading streams...</p>
      ) : paged.length === 0 ? (
        <p className="text-center text-zinc-500">No streams available.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Attributes</th>
                  <th className="px-4 py-2">Size</th>
                  <th className="px-4 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {paged.map((s) => (
                  <tr key={s.infoHash} className="hover:bg-zinc-900/50">
                    <td className="max-w-xs truncate px-4 py-3 text-xs">
                      {s.title}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.resolution && (
                          <Badge color="blue">{s.resolution}</Badge>
                        )}
                        {s.hdr && <Badge color="amber">HDR</Badge>}
                        {s.audio && <Badge color="purple">{s.audio}</Badge>}
                        {s.codec && <Badge color="zinc">{s.codec}</Badge>}
                        {s.source && <Badge color="zinc">{s.source}</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-400">
                      {formatSize(s.size)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500">
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Per page:</span>
                {[5, 10, 25].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setPerPage(n);
                      setPage(0);
                    }}
                    className={`rounded px-2 py-1 text-xs ${
                      perPage === n
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="disabled:opacity-30"
                >
                  Prev
                </button>
                <span>
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  className="disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-500/20 text-blue-300",
    amber: "bg-amber-500/20 text-amber-300",
    purple: "bg-purple-500/20 text-purple-300",
    zinc: "bg-zinc-700 text-zinc-300",
    emerald: "bg-emerald-500/20 text-emerald-300",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colors[color] ?? colors.zinc}`}
    >
      {children}
    </span>
  );
}
