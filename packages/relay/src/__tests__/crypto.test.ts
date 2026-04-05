import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

describe("encrypt/decrypt", () => {
  const originalKey = process.env.ENCRYPTION_MASTER_KEY;

  beforeAll(() => {
    // Set a test key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_MASTER_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  afterAll(() => {
    if (originalKey) {
      process.env.ENCRYPTION_MASTER_KEY = originalKey;
    } else {
      delete process.env.ENCRYPTION_MASTER_KEY;
    }
  });

  it("encrypts and decrypts a string", () => {
    const plaintext = "my-secret-api-key";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);
    expect(enc1).not.toBe(enc2); // Different IVs
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("handles unicode characters", () => {
    const plaintext = "ただいま — test 🎬";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("encrypted format is iv:tag:ciphertext (hex)", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    // IV = 12 bytes = 24 hex chars
    expect(parts[0].length).toBe(24);
    // Auth tag = 16 bytes = 32 hex chars
    expect(parts[1].length).toBe(32);
    // Ciphertext is variable length hex
    expect(parts[2].length).toBeGreaterThan(0);
  });
});
