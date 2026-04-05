# Phase 5: Search & Browse — Detailed Spec

> **Goal**: Users can search for movies and TV shows through the web app, view available streams with filtering, and see the full browse experience — everything up to (but not including) actually triggering a download.

---

## 1. Relay API Proxy Endpoints

All proxy endpoints are authenticated via profile session token (passed as Bearer token in Authorization header or via WebSocket auth context). Response caching is in-memory with TTL eviction; future scaling can swap in Redis without changing the API.

### 1.1 Search Endpoint: `GET /api/search`

**Request:**
```
GET /api/search?q=interstellar
Authorization: Bearer {profileSessionToken}
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "tmdbId": 157336,
      "title": "Interstellar",
      "year": 2014,
      "mediaType": "movie",
      "overview": "A team of explorers travel through a wormhole in space...",
      "posterPath": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
      "imdbId": "tt0816692"
    },
    {
      "tmdbId": 1396,
      "title": "Breaking Bad",
      "year": 2008,
      "mediaType": "tv",
      "overview": "A high school chemistry teacher...",
      "posterPath": "/ggFHVNu6YYI5QC9P2oozNmZc3KA.jpg",
      "imdbId": "tt0903747"
    }
  ]
}
```

**Upstream:** TMDB `/search/multi`
- **Base URL:** `https://api.themoviedb.org/3`
- **Path:** `/search/multi`
- **Query params:** `query={q}&api_key={tmdbApiKey}&page=1`
- **Cache TTL:** 1 hour
- **Max results returned:** 20 (truncate response)

**Response Mapping:**
- `tmdbId` ← `id`
- `title` ← `name` (TV) or `title` (movie)
- `year` ← extract from `first_air_date` or `release_date` (YYYY)
- `mediaType` ← `media_type` (normalize to "movie" or "tv")
- `overview` ← `overview`
- `posterPath` ← `poster_path`
- `imdbId` ← call TMDB `/movie/{id}/external_ids` or `/tv/{id}/external_ids` to get `imdb_id`

**Error Handling:**
- TMDB 4xx/5xx → relay returns `502 Bad Gateway` with standard error envelope:
  ```json
  {
    "error": {
      "code": "UPSTREAM_ERROR",
      "message": "Failed to fetch search results",
      "upstreamStatus": 401
    }
  }
  ```

---

### 1.2 Media Detail Endpoint: `GET /api/media/:type/:tmdbId`

**Request:**
```
GET /api/media/movie/157336
Authorization: Bearer {profileSessionToken}
```

**Response (200 OK) — Movie:**
```json
{
  "tmdbId": 157336,
  "imdbId": "tt0816692",
  "title": "Interstellar",
  "year": 2014,
  "mediaType": "movie",
  "overview": "...",
  "posterPath": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
  "isAnime": false,
  "runtime": 169
}
```

**Response (200 OK) — TV:**
```json
{
  "tmdbId": 1396,
  "imdbId": "tt0903747",
  "title": "Breaking Bad",
  "year": 2008,
  "mediaType": "tv",
  "overview": "...",
  "posterPath": "/ggFHVNu6YYI5QC9P2oozNmZc3KA.jpg",
  "isAnime": false,
  "seasons": [
    {
      "seasonNumber": 0,
      "episodeCount": 2,
      "name": "Specials"
    },
    {
      "seasonNumber": 1,
      "episodeCount": 7,
      "name": "Season 1"
    },
    {
      "seasonNumber": 5,
      "episodeCount": 16,
      "name": "Season 5"
    }
  ]
}
```

**Upstream:** TMDB `/movie/{id}` or `/tv/{id}`
- **Query params:** `api_key={tmdbApiKey}`
- **Cache TTL:** 24 hours

**Anime Detection Logic:**
Query `/tv/{id}` to check for:
- Genre ID `16` (Animation) AND `origin_country` contains "JP"
- OR keyword ID `210024` (Anime) is present

Set `isAnime: true` if either condition is true. (Used later for UX decisions, e.g., episode display format.)

**Response Mapping:**
- For movies: extract `title`, `release_date`, `overview`, `poster_path`, `runtime`, `external_ids.imdb_id`
- For TV: extract `name`, `first_air_date`, `overview`, `poster_path`, `seasons[]` (filter out season 0 for normal shows; include for anime)

**Error Handling:**
- Return `502` if TMDB call fails

---

### 1.3 Streams Endpoint: `GET /api/streams/:type/:imdbId`

**Request:**
```
GET /api/streams/movie/tt0816692?season=5&episode=16
Authorization: Bearer {profileSessionToken}
```

(Query params `season` and `episode` are optional; only used for TV.)

**Response (200 OK):**
```json
{
  "streams": [
    {
      "name": "Interstellar 2014 2160p UHD BluRay x265 10bit HDR10+ DTS-HD.MA 5.1-GROUP",
      "infoHash": "1234567890abcdef1234567890abcdef12345678",
      "sizeBytes": 45000000000,
      "seeders": 150,
      "magnet": "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Interstellar..."
    },
    {
      "name": "Interstellar 2014 1080p BluRay x264 DTS-HD 5.1-GROUP",
      "infoHash": "abcdef1234567890abcdef1234567890abcdef12",
      "sizeBytes": 8500000000,
      "seeders": 300,
      "magnet": "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12&dn=..."
    }
  ]
}
```

**Upstream:** Torrentio addon API
- **URL format (movie):** `https://torrentio.strem.fun/stream/movie/{imdbId}.json`
- **URL format (TV):** `https://torrentio.strem.fun/stream/tv/{imdbId}:{season}:{episode}.json`
- **Cache TTL:** 15 minutes
- **Timeout:** 30 seconds (Torrentio can be slow)

**Response Mapping:** Torrentio returns an array of stream objects. Extract:
- `name` ← `name`
- `infoHash` ← extract from `url` magnet link (`xt=urn:btih:` value)
- `sizeBytes` ← parse from `name` (e.g., "45 GB" → `45000000000`)
- `seeders` ← parse from `name` (e.g., "👤 150" → `150`; use 0 if not found)
- `magnet` ← construct from `infoHash` and name

> **✅ RESOLVED**: Fetch all streams from Torrentio (no server-side limit). Paginate in the UI at 5/10/25 per page. This allows full client-side filtering across the complete dataset.

**Error Handling:**
- Torrentio timeout or 5xx → return `502` with error envelope
- Empty streams array (0 results) → return `200` with empty `streams: []`

---

### 1.4 Poster Proxy Endpoint: `GET /api/poster/:path`

**Request:**
```
GET /api/poster/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg
Authorization: Bearer {profileSessionToken}
```

**Response (200 OK):**
- Content-Type: `image/jpeg`
- Body: binary image data

**Upstream:** TMDB image CDN
- **Base URL:** `https://image.tmdb.org/t/p/w500` (for search results) or `w780` (detail views)
- **Full URL:** `https://image.tmdb.org/t/p/w500{path}`
- **Cache TTL:** 7 days

**Implementation:**
- Fetch from TMDB CDN
- Cache the binary response (with TTL metadata)
- Return with appropriate Content-Type header
- Set `Cache-Control: public, max-age=604800` (7 days)

**Error Handling:**
- TMDB CDN 404 → return `404 Not Found`
- TMDB CDN 5xx → return `502 Bad Gateway`

---

### 1.5 Recently Viewed Endpoints

#### GET `/api/recently-viewed`

**Request:**
```
GET /api/recently-viewed
Authorization: Bearer {profileSessionToken}
```

**Response (200 OK):**
```json
{
  "titles": [
    {
      "tmdbId": 157336,
      "mediaType": "movie",
      "title": "Interstellar",
      "year": 2014,
      "posterPath": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
      "imdbId": "tt0816692",
      "viewedAt": "2026-04-04T15:30:00Z"
    },
    {
      "tmdbId": 1396,
      "mediaType": "tv",
      "title": "Breaking Bad",
      "year": 2008,
      "posterPath": "/ggFHVNu6YYI5QC9P2oozNmZc3KA.jpg",
      "imdbId": "tt0903747",
      "viewedAt": "2026-04-03T10:15:00Z"
    }
  ]
}
```

**Logic:**
- Query `recently_viewed` table filtered by current `profileId`
- Order by `viewed_at DESC`
- Limit to 20 entries
- No caching (always fresh from DB)

---

#### POST `/api/recently-viewed`

**Request:**
```
POST /api/recently-viewed
Authorization: Bearer {profileSessionToken}
Content-Type: application/json

{
  "tmdbId": 157336,
  "mediaType": "movie",
  "title": "Interstellar",
  "year": 2014,
  "posterPath": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
  "imdbId": "tt0816692"
}
```

**Response (200 OK):**
```json
{
  "title": {
    "tmdbId": 157336,
    "mediaType": "movie",
    "title": "Interstellar",
    "year": 2014,
    "posterPath": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
    "imdbId": "tt0816692",
    "viewedAt": "2026-04-04T15:30:00Z"
  }
}
```

**Upsert Logic:**
1. Check if entry exists: `WHERE profile_id = ? AND tmdb_id = ? AND media_type = ?`
2. If exists: UPDATE `viewed_at = NOW()`
3. If not: INSERT new row
4. After insert/update, check count of entries for this profile
5. If count > 20: DELETE oldest entries until count == 20 (order by `viewed_at ASC`)

---

## 2. In-Memory Cache Layer

Implement a configurable TTL-based cache in `/packages/relay/src/lib/cache.ts`.

### 2.1 Cache Interface

```typescript
export interface CacheEntry<T> {
  data: T
  expiresAt: number // unix ms
  createdAt: number
}

export interface CacheConfig {
  maxSize?: number // default: 10000 entries
  cleanupInterval?: number // default: 60000 (1 minute)
}

export class TtlCache<T = unknown> {
  constructor(config?: CacheConfig)

  get(key: string): T | null
  set(key: string, data: T, ttlMs: number): void
  delete(key: string): void
  clear(): void
  has(key: string): boolean
  size(): number

  // Cleanup expired entries (called automatically by interval)
  private evictExpired(): void
}
```

### 2.2 Implementation Details

- **Storage:** JavaScript `Map<string, CacheEntry<T>>`
- **Eviction:** On-demand check + scheduled cleanup (every 1 minute)
- **Key format:** `{namespace}:{identifier}` (e.g., `search:interstellar`, `media:movie:157336`)
- **TTL specified per set() call:** allows flexibility (some keys 1 hour, others 24 hours)
- **No persistence:** cache is lost on relay restart (acceptable for search results and posters)

### 2.3 Cache Keys

| Purpose | Key Pattern | TTL |
|---------|-------------|-----|
| Search results | `search:{query}` | 1 hour |
| Movie detail | `media:movie:{tmdbId}` | 24 hours |
| TV detail | `media:tv:{tmdbId}` | 24 hours |
| Streams | `streams:{type}:{imdbId}:{season?}:{episode?}` | 15 min |
| Poster binary | `poster:{path}` | 7 days |

---

## 3. TMDB API Integration

**Base URL:** `https://api.themoviedb.org/3`

**Authentication:** Query parameter `api_key={tmdbApiKey}` (read from `instance_settings` table at startup)

### 3.1 Required Endpoints

1. **Search Multi:** `/search/multi?query={q}&page=1`
   - Returns both movies and TV shows
   - Paginated (we return top 20)

2. **Movie Detail:** `/movie/{id}`
   - Returns full movie details including runtime, budget, revenue

3. **TV Detail:** `/tv/{id}`
   - Returns seasons array (critical for TV browsing)

4. **External IDs:** `/movie/{id}/external_ids` and `/tv/{id}/external_ids`
   - Returns IMDb ID (`imdb_id` field)
   - Called for each search result to enrich with IMDb ID

### 3.2 Response Mapping Examples

**Search result (movie):**
```json
{
  "adult": false,
  "backdrop_path": "/...",
  "genre_ids": [28, 12, 878],
  "id": 157336,
  "original_language": "en",
  "original_title": "Interstellar",
  "overview": "A team of explorers...",
  "popularity": 85.5,
  "poster_path": "/nBNZadXQNSaoRf3rsHuHbIHd0G.jpg",
  "release_date": "2014-11-07",
  "title": "Interstellar",
  "video": false,
  "vote_average": 8.3,
  "media_type": "movie"
}
```

→ Extract: `id`, `title`, `release_date`, `overview`, `poster_path`, `media_type`

**TV detail:**
```json
{
  "id": 1396,
  "name": "Breaking Bad",
  "first_air_date": "2008-01-20",
  "origin_country": ["US"],
  "genres": [{"id": 18, "name": "Drama"}],
  "overview": "A high school chemistry teacher...",
  "poster_path": "/ggFHVNu6YYI5QC9P2oozNmZc3KA.jpg",
  "seasons": [
    {"id": 3957, "name": "Season 1", "season_number": 1, "episode_count": 7},
    {"id": 3958, "name": "Season 2", "season_number": 2, "episode_count": 13},
    {"id": 3959, "name": "Season 5", "season_number": 5, "episode_count": 16}
  ]
}
```

→ Extract: `id`, `name`, `first_air_date`, `overview`, `poster_path`, `seasons[]` (with `season_number` and `episode_count`)

---

## 4. Torrentio API Integration

**Base URL:** `https://torrentio.strem.fun`

### 4.1 Stream Endpoint Format

**Movie:**
```
GET https://torrentio.strem.fun/stream/movie/{imdbId}.json
```

**TV (specific episode):**
```
GET https://torrentio.strem.fun/stream/tv/{imdbId}:{season}:{episode}.json
```

**TV (full season):**
```
GET https://torrentio.strem.fun/stream/tv/{imdbId}:{season}:0.json
```

(Episode 0 = full season pack)

### 4.2 Response Format

Torrentio returns:
```json
{
  "streams": [
    {
      "name": "Interstellar 2014 2160p UHD BluRay x265 10bit HDR10+ DTS-HD.MA 5.1-SPARKS",
      "infoHash": "1234567890abcdef1234567890abcdef12345678",
      "url": "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&tr=...",
      "size": "45 GB",
      "type": "torrent"
    },
    {
      "name": "...",
      "infoHash": "...",
      "url": "magnet:...",
      "size": "8.5 GB",
      "type": "torrent"
    }
  ]
}
```

### 4.3 Stream Name Parsing

The `name` field is a freeform string. Extract attributes using regex:

```typescript
export interface ParsedStream {
  name: string
  resolution?: string // "480p", "720p", "1080p", "2160p"
  hdr?: string // "HDR", "HDR10+", "DV" (Dolby Vision)
  audio?: string // "2.0", "5.1", "7.1", "Atmos"
}

export function parseStreamName(name: string): ParsedStream {
  const result: ParsedStream = { name }

  // Resolution: look for 480p, 720p, 1080p, 2160p, 4K, UHD
  const resMatch = name.match(/\b(480p|720p|1080p|2160p|4K|UHD)\b/i)
  if (resMatch) {
    result.resolution = normalizeResolution(resMatch[1])
  }

  // HDR: look for HDR, HDR10+, HDR10, Dolby Vision, DV
  const hdrMatch = name.match(/\b(HDR10\+|HDR10|Dolby Vision|HDR|DV)\b/i)
  if (hdrMatch) {
    result.hdr = normalizeHdr(hdrMatch[1])
  }

  // Audio: look for 2.0, 5.1, 7.1, DTS, Atmos, TrueHD
  const audioMatch = name.match(/\b(\d\.\d|Atmos|DTS|TrueHD|AC-?3)\b/i)
  if (audioMatch) {
    result.audio = normalizeAudio(audioMatch[1])
  }

  return result
}

// Normalize to standard formats
function normalizeResolution(res: string): string {
  if (res.toUpperCase() === '4K' || res.toUpperCase() === 'UHD') return '2160p'
  return res.toLowerCase()
}

function normalizeHdr(hdr: string): string {
  const upper = hdr.toUpperCase()
  if (upper.includes('DOLBY') || upper === 'DV') return 'DV'
  if (upper.includes('10+')) return 'HDR10+'
  return 'HDR'
}

function normalizeAudio(audio: string): string {
  // Return as-is for now; in future, expand "Atmos" → "7.1.4", etc.
  if (audio.toUpperCase().includes('ATMOS')) return 'Atmos'
  const match = audio.match(/(\d\.\d)/)
  return match ? match[1] : 'Unknown'
}
```

**Notes:**
- These regexes are best-effort; torrent names vary widely
- Missing attributes are acceptable (show what you find)
- Case-insensitive matching
- Store parsed attributes on the stream for UI filtering

---

## 5. Web Search Page — React Components

Implement in `/packages/web/src/pages/SearchPage.tsx`.

### 5.1 Component Tree

```
SearchPage
├── SearchBar
├── RecentlyViewedStrip (conditional: hidden when empty or during active search)
├── ResultsGrid
│   └── SearchCard[] (clickable, fetches streams on click)
└── StreamPicker (conditional: shown when card clicked)
    ├── MediaHeader
    ├── FilterBar
    │   ├── ResolutionFilter (chips: 480p, 720p, 1080p, 2160p)
    │   ├── HdrFilter (chips: HDR, HDR10+, DV)
    │   ├── AudioFilter (chips: 2.0, 5.1, 7.1, Atmos)
    │   ├── CacheFilter (chips: RD Cached — populated after cache check)
    │   ├── FilterCountBadge
    │   └── ClearAllButton
    ├── StreamTable
    │   ├── Header (Name, Size, Seeders, Download)
    │   └── StreamRow[]
    │       ├── Name + parsed badges (resolution, HDR, audio)
    │       ├── HumanReadableSize
    │       ├── Seeders
    │       ├── RDCachedBadge (conditional)
    │       └── DownloadButton
    └── Pagination (5/10/25 per page)

(For TV shows)
StreamPicker
├── MediaHeader
├── SeasonSelector (dropdown)
├── EpisodeList (conditional: shows episodes or "Full Season" option)
├── FilterBar
└── StreamTable + Pagination
```

### 5.2 SearchBar Component

```typescript
interface SearchBarProps {
  onSearch: (query: string) => void
  isLoading?: boolean
}

export function SearchBar({ onSearch, isLoading }: SearchBarProps) {
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) {
      onSearch(input)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search movies and TV shows..."
        className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-indigo-500"
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={!input.trim() || isLoading}
        className="px-6 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700"
      >
        {isLoading ? 'Searching...' : 'Search'}
      </button>
    </form>
  )
}
```

### 5.3 RecentlyViewedStrip Component

```typescript
interface RecentlyViewedStripProps {
  titles: RecentlyViewedTitle[]
  onSelectTitle: (title: RecentlyViewedTitle) => void
  isHidden?: boolean
}

export function RecentlyViewedStrip({
  titles,
  onSelectTitle,
  isHidden
}: RecentlyViewedStripProps) {
  if (isHidden || !titles.length) return null

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Recently Viewed</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {titles.map((title) => (
          <button
            key={`${title.tmdbId}-${title.mediaType}`}
            onClick={() => onSelectTitle(title)}
            className="flex-shrink-0 w-24 cursor-pointer hover:opacity-80 transition"
          >
            <img
              src={`/api/poster/${title.posterPath}`}
              alt={title.title}
              className="w-24 h-36 object-cover rounded-lg"
            />
            <p className="text-xs text-gray-400 mt-1 truncate">{title.title}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
```

### 5.4 ResultsGrid Component

```typescript
interface SearchCard {
  tmdbId: number
  title: string
  year: number
  mediaType: 'movie' | 'tv'
  overview: string
  posterPath: string
  imdbId: string
}

interface ResultsGridProps {
  results: SearchCard[]
  isLoading?: boolean
  onSelectCard: (card: SearchCard) => void
}

export function ResultsGrid({
  results,
  isLoading,
  onSelectCard
}: ResultsGridProps) {
  if (isLoading) {
    return <div className="text-center py-12">Loading results...</div>
  }

  if (!results.length) {
    return <div className="text-center py-12 text-gray-400">No results found</div>
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {results.map((card) => (
        <div
          key={`${card.tmdbId}-${card.mediaType}`}
          onClick={() => onSelectCard(card)}
          className="cursor-pointer group"
        >
          <div className="relative overflow-hidden rounded-lg mb-3">
            <img
              src={`/api/poster/${card.posterPath}`}
              alt={card.title}
              className="w-full aspect-[2/3] object-cover group-hover:scale-105 transition"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
              <span className="text-white font-semibold opacity-0 group-hover:opacity-100 transition">
                View Streams
              </span>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-white truncate">{card.title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">{card.year}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                card.mediaType === 'movie'
                  ? 'bg-indigo-600/30 text-indigo-300'
                  : 'bg-blue-600/30 text-blue-300'
              }`}
            >
              {card.mediaType === 'movie' ? 'Movie' : 'TV'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2 line-clamp-2">{card.overview}</p>
        </div>
      ))}
    </div>
  )
}
```

### 5.5 StreamPicker Component

```typescript
interface StreamPickerProps {
  media: MediaDetail
  streams: Stream[]
  onClose: () => void
  onDownload: (stream: Stream, device: Device) => void
  isLoadingCache?: boolean
}

export function StreamPicker({
  media,
  streams,
  onClose,
  onDownload,
  isLoadingCache
}: StreamPickerProps) {
  const [filters, setFilters] = useState<StreamFilters>({
    resolutions: [],
    hdrs: [],
    audios: [],
    rdCached: false
  })
  const [pageSize, setPageSize] = useState(10)
  const [currentPage, setCurrentPage] = useState(1)

  const filteredStreams = applyFilters(streams, filters)
  const paginatedStreams = filteredStreams.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  return (
    <div className="fixed inset-0 bg-black/50 z-40 overflow-y-auto">
      <div className="bg-gray-900 min-h-screen py-6">
        <div className="max-w-6xl mx-auto px-4 mb-4">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ← Back to Results
          </button>
        </div>

        <MediaHeader media={media} />

        {media.mediaType === 'tv' && <SeasonEpisodeSelector media={media} />}

        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          filteredCount={filteredStreams.length}
          totalCount={streams.length}
          isLoadingCache={isLoadingCache}
        />

        <StreamTable
          streams={paginatedStreams}
          onDownload={onDownload}
        />

        <div className="max-w-6xl mx-auto px-4 mt-6 flex items-center justify-between">
          <div className="flex gap-2">
            {[5, 10, 25].map((size) => (
              <button
                key={size}
                onClick={() => {
                  setPageSize(size)
                  setCurrentPage(1)
                }}
                className={`px-3 py-1 rounded text-sm ${
                  pageSize === size
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-400">
            Page {currentPage} of {Math.ceil(filteredStreams.length / pageSize)}
          </span>
        </div>
      </div>
    </div>
  )
}
```

### 5.6 FilterBar Component

```typescript
interface FilterBarProps {
  filters: StreamFilters
  onFiltersChange: (filters: StreamFilters) => void
  filteredCount: number
  totalCount: number
  isLoadingCache?: boolean
}

export function FilterBar({
  filters,
  onFiltersChange,
  filteredCount,
  totalCount,
  isLoadingCache
}: FilterBarProps) {
  const activeCount = Object.values(filters).flat().length

  const handleToggleResolution = (res: string) => {
    const newResolutions = filters.resolutions.includes(res)
      ? filters.resolutions.filter((r) => r !== res)
      : [...filters.resolutions, res]
    onFiltersChange({ ...filters, resolutions: newResolutions })
  }

  // Similar handlers for HDR, Audio, Cache

  return (
    <div className="max-w-6xl mx-auto px-4 my-6 p-4 bg-gray-800/50 rounded-lg">
      {isLoadingCache && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
          <div className="animate-spin w-4 h-4 border border-gray-600 border-t-indigo-600 rounded-full" />
          Checking RD cache...
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-gray-300 mb-2">Resolution</h4>
        <div className="flex gap-2 flex-wrap">
          {['480p', '720p', '1080p', '2160p'].map((res) => (
            <button
              key={res}
              onClick={() => handleToggleResolution(res)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                filters.resolutions.includes(res)
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-700">
        <span className="text-sm text-gray-400">
          Showing {filteredCount} of {totalCount} streams
          {activeCount > 0 && ` (${activeCount} filter${activeCount > 1 ? 's' : ''} active)`}
        </span>
        {activeCount > 0 && (
          <button
            onClick={() => onFiltersChange({
              resolutions: [],
              hdrs: [],
              audios: [],
              rdCached: false
            })}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}
```

### 5.7 StreamTable Component

```typescript
interface StreamTableProps {
  streams: Stream[]
  onDownload: (stream: Stream) => void
}

export function StreamTable({ streams, onDownload }: StreamTableProps) {
  return (
    <div className="max-w-6xl mx-auto px-4">
      <div className="overflow-x-auto bg-gray-800/30 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Name</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Size</th>
              <th className="px-4 py-3 text-left text-gray-300 font-semibold">Seeders</th>
              <th className="px-4 py-3 text-right text-gray-300 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((stream) => (
              <tr
                key={stream.infoHash}
                className="border-b border-gray-700/50 hover:bg-gray-700/20 transition"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2 items-start">
                    <span className="text-gray-200 break-all">{stream.name}</span>
                    <div className="flex gap-1 flex-wrap">
                      {stream.parsed?.resolution && (
                        <span className="px-2 py-1 bg-gray-700 text-xs text-gray-300 rounded">
                          {stream.parsed.resolution}
                        </span>
                      )}
                      {stream.parsed?.hdr && (
                        <span className="px-2 py-1 bg-purple-700/40 text-xs text-purple-300 rounded">
                          {stream.parsed.hdr}
                        </span>
                      )}
                      {stream.parsed?.audio && (
                        <span className="px-2 py-1 bg-green-700/40 text-xs text-green-300 rounded">
                          {stream.parsed.audio}
                        </span>
                      )}
                      {stream.rdCached && (
                        <span className="px-2 py-1 bg-indigo-700/40 text-xs text-indigo-300 rounded">
                          RD Cached
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {formatBytes(stream.sizeBytes)}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {stream.seeders}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onDownload(stream)}
                    className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 transition"
                  >
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

### 5.8 TV SeasonEpisodeSelector Component

```typescript
interface SeasonEpisodeSelectorProps {
  media: MediaDetail
  onSeasonSelect: (season: number) => void
  onEpisodeSelect: (season: number, episode: number) => void
  onFullSeasonSelect: (season: number) => void
}

export function SeasonEpisodeSelector({
  media,
  onSeasonSelect,
  onEpisodeSelect,
  onFullSeasonSelect
}: SeasonEpisodeSelectorProps) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)

  const handleSeasonChange = (seasonNumber: number) => {
    setSelectedSeason(seasonNumber)
    onSeasonSelect(seasonNumber)
  }

  const currentSeason = media.seasons?.find((s) => s.seasonNumber === selectedSeason)

  return (
    <div className="max-w-6xl mx-auto px-4 my-6 p-4 bg-gray-800/30 rounded-lg">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Season</h3>

      <select
        value={selectedSeason ?? ''}
        onChange={(e) => handleSeasonChange(parseInt(e.target.value))}
        className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white mb-4 w-full sm:w-64"
      >
        <option value="">Select a season...</option>
        {media.seasons?.map((season) => (
          <option key={season.seasonNumber} value={season.seasonNumber}>
            {season.name || `Season ${season.seasonNumber}`} ({season.episodeCount} episodes)
          </option>
        ))}
      </select>

      {selectedSeason !== null && (
        <div className="mb-4">
          <button
            onClick={() => onFullSeasonSelect(selectedSeason)}
            className="px-4 py-2 bg-indigo-600/20 border border-indigo-500 text-indigo-300 rounded hover:bg-indigo-600/30 transition"
          >
            Download Full Season {selectedSeason}
          </button>
        </div>
      )}

      {currentSeason && (
        <div>
          <h4 className="text-sm font-semibold text-gray-300 mb-2">Episodes</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {Array.from({ length: currentSeason.episodeCount }, (_, i) => i + 1).map((ep) => (
              <button
                key={ep}
                onClick={() => onEpisodeSelect(selectedSeason, ep)}
                className="px-3 py-2 text-left text-sm rounded bg-gray-700/50 text-gray-200 hover:bg-gray-700 transition"
              >
                Episode {ep}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

### 5.9 DeviceSelector Component

```typescript
interface DeviceSelectorProps {
  devices: Device[]
  selectedDeviceId: string | null
  onSelectDevice: (deviceId: string) => void
}

export function DeviceSelector({
  devices,
  selectedDeviceId,
  onSelectDevice
}: DeviceSelectorProps) {
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)

  return (
    <div className="inline-block">
      <label className="text-sm text-gray-400 mr-2">Download to:</label>
      <select
        value={selectedDeviceId ?? ''}
        onChange={(e) => onSelectDevice(e.target.value)}
        className="px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white"
      >
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name} — {device.isOnline ? 'Online' : 'Offline (will queue)'}
          </option>
        ))}
      </select>
    </div>
  )
}
```

---

## 6. RD Cache Check Integration

When the stream picker is displayed and the user's default (or selected) agent is online:

1. **Web app sends:** WebSocket message `cache:check` with all infoHashes
2. **Relay routes** to the agent via persistent WebSocket
3. **Agent calls:** RD `GET /torrents/instantAvailability/{hashes}` (comma-separated)
4. **Agent sends back:** `cache:result` with mapping of `infoHash → isCached`
5. **Web app updates:** stream table with "RD Cached" badges

### 6.1 WebSocket Message Format

**Web → Relay:**
```json
{
  "id": "msg-uuid",
  "type": "cache:check",
  "timestamp": 1712282400000,
  "payload": {
    "infoHashes": [
      "1234567890abcdef1234567890abcdef12345678",
      "abcdef1234567890abcdef1234567890abcdef12"
    ]
  }
}
```

**Agent → Relay → Web:**
```json
{
  "id": "msg-uuid",
  "type": "cache:result",
  "timestamp": 1712282400000,
  "payload": {
    "results": {
      "1234567890abcdef1234567890abcdef12345678": true,
      "abcdef1234567890abcdef1234567890abcdef12": false
    }
  }
}
```

### 6.2 UI Behavior

- Show "Checking RD cache..." spinner in filter bar while waiting
- On `cache:result`, map hashes to stream rows and add `rdCached: true` flag
- Re-render stream table to show "RD Cached" badges
- If no agent online, cache badges simply don't appear (no error, graceful degradation)

---

## 7. Zustand Store Additions

Update `/packages/web/src/store/search.ts`:

```typescript
export interface SearchState {
  searchQuery: string
  searchResults: SearchCard[]
  isSearching: boolean

  selectedMedia: MediaDetail | null
  streams: Stream[]
  isLoadingStreams: boolean

  filters: {
    resolutions: string[]
    hdrs: string[]
    audios: string[]
    rdCached: boolean
  }

  selectedSeason: number | null
  selectedEpisode: number | null

  isCheckingCache: boolean
  cachedHashes: Set<string>

  recentlyViewed: RecentlyViewedTitle[]

  selectedDeviceId: string | null

  search: (query: string) => Promise<void>
  selectMedia: (media: SearchCard) => Promise<void>
  setFilters: (filters: FilterState) => void
  selectSeason: (season: number) => Promise<void>
  selectEpisode: (season: number, episode: number) => Promise<void>
  startCacheCheck: (infoHashes: string[]) => void
  updateCacheResults: (results: Record<string, boolean>) => void
  loadRecentlyViewed: () => Promise<void>
  addRecentlyViewed: (title: RecentlyViewedTitle) => Promise<void>
  setSelectedDevice: (deviceId: string) => void
}
```

---

## 8. Filter Logic Implementation

```typescript
interface StreamFilters {
  resolutions: string[]
  hdrs: string[]
  audios: string[]
  rdCached: boolean
}

export function applyFilters(streams: Stream[], filters: StreamFilters): Stream[] {
  return streams.filter((stream) => {
    if (filters.resolutions.length > 0) {
      if (!stream.parsed?.resolution || !filters.resolutions.includes(stream.parsed.resolution)) {
        return false
      }
    }

    if (filters.hdrs.length > 0) {
      if (!stream.parsed?.hdr || !filters.hdrs.includes(stream.parsed.hdr)) {
        return false
      }
    }

    if (filters.audios.length > 0) {
      if (!stream.parsed?.audio || !filters.audios.includes(stream.parsed.audio)) {
        return false
      }
    }

    if (filters.rdCached && !stream.rdCached) {
      return false
    }

    return true
  })
}
```

---

## 9. Dependencies

No new dependencies required. Uses existing packages from Phases 0-4.

---

## 10. File Structure

```
packages/relay/src/
├── routes/
│   └── api.ts (new)
├── lib/
│   ├── cache.ts (new)
│   └── torrent-parser.ts (new)
└── services/
    └── tmdb.ts (new)

packages/web/src/
├── pages/
│   └── SearchPage.tsx (new)
├── components/
│   ├── SearchBar.tsx (new)
│   ├── RecentlyViewedStrip.tsx (new)
│   ├── ResultsGrid.tsx (new)
│   ├── StreamPicker.tsx (new)
│   ├── FilterBar.tsx (new)
│   ├── StreamTable.tsx (new)
│   ├── SeasonEpisodeSelector.tsx (new)
│   └── DeviceSelector.tsx (new)
├── store/
│   └── search.ts (new)
└── hooks/
    └── useWebSocket.ts (update)

packages/shared/src/
└── types.ts (update)
```

---

## 11. Common Pitfalls

### Backend

1. **TMDB IMDb ID fetch latency**
   - Decision: Lazy fetch external IDs on stream picker open, not on search

2. **Torrentio timeout**
   - Set 30-second timeout; return empty gracefully on timeout

3. **Cache eviction performance**
   - Background cleanup interval, max 10k entries

4. **TMDB rate limiting**
   - Implement exponential backoff on 429 responses

5. **Anime detection edge cases**
   - Best-effort; accept false negatives

### Frontend

6. **Stream name parsing robustness**
   - Test against real-world torrents; missing attributes are acceptable

7. **Filter logic clarity**
   - Document OR-within-group, AND-across-groups pattern thoroughly

8. **Recently viewed upsert race condition**
   - Use unique constraint for idempotency

9. **RD cache check timeout**
   - 45-second timeout with "taking a while" message after 15 seconds

10. **Device selector offline handling**
    - Pre-select default device; show clear offline warning

---

## Summary

Phase 5 delivers search, browsing, and stream selection. The relay proxy architecture secures API keys while enabling caching. The in-memory cache is simple and effective. The torrent name parser extracts attributes reliably. The React UI is polished with zustand state management and WebSocket real-time updates for RD cache checks.
