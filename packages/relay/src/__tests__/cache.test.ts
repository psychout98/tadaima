import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../cache.js";

describe("TtlCache", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache();
  });

  it("stores and retrieves a value", () => {
    cache.set("key1", "value1", 60000);
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing key", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts expired entries", () => {
    vi.useFakeTimers();

    cache.set("key1", "value1", 1000);
    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(1500);
    expect(cache.get("key1")).toBeUndefined();

    vi.useRealTimers();
  });

  it("does not evict before TTL", () => {
    vi.useFakeTimers();

    cache.set("key1", "value1", 5000);

    vi.advanceTimersByTime(3000);
    expect(cache.get("key1")).toBe("value1");

    vi.useRealTimers();
  });

  it("overwrites existing entries", () => {
    cache.set("key1", "old", 60000);
    cache.set("key1", "new", 60000);
    expect(cache.get("key1")).toBe("new");
  });

  it("clears all entries", () => {
    cache.set("a", "1", 60000);
    cache.set("b", "2", 60000);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
