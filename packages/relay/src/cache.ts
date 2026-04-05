interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

// Pre-configured caches
export const searchCache = new TtlCache<unknown>();
export const mediaCache = new TtlCache<unknown>();
export const streamCache = new TtlCache<unknown>();
export const posterCache = new TtlCache<Buffer>();

// TTLs
export const SEARCH_TTL = 60 * 60 * 1000; // 1 hour
export const MEDIA_TTL = 24 * 60 * 60 * 1000; // 24 hours
export const STREAM_TTL = 15 * 60 * 1000; // 15 minutes
export const POSTER_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
