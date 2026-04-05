import { describe, it, expect } from "vitest";
import {
  setupCompleteRequestSchema,
  loginRequestSchema,
  createProfileRequestSchema,
  updateProfileRequestSchema,
  selectProfileRequestSchema,
  pairClaimRequestSchema,
  updateDeviceRequestSchema,
} from "../api-types.js";

describe("setup schemas", () => {
  it("validates a complete setup request", () => {
    const req = {
      username: "admin",
      password: "securepass123",
      tmdbApiKey: "abc123",
      rdApiKey: "def456",
      profileName: "Noah",
      profileAvatar: "blue",
    };
    expect(setupCompleteRequestSchema.parse(req)).toEqual(req);
  });

  it("rejects short password", () => {
    expect(() =>
      setupCompleteRequestSchema.parse({
        username: "admin",
        password: "short",
        tmdbApiKey: "abc",
        rdApiKey: "def",
        profileName: "Noah",
      }),
    ).toThrow();
  });

  it("rejects empty username", () => {
    expect(() =>
      setupCompleteRequestSchema.parse({
        username: "",
        password: "securepass123",
        tmdbApiKey: "abc",
        rdApiKey: "def",
        profileName: "Noah",
      }),
    ).toThrow();
  });
});

describe("auth schemas", () => {
  it("validates login request", () => {
    const req = { username: "admin", password: "pass" };
    expect(loginRequestSchema.parse(req)).toEqual(req);
  });
});

describe("profile schemas", () => {
  it("validates create profile with PIN", () => {
    const req = { name: "Noah", avatar: "blue", pin: "1234" };
    expect(createProfileRequestSchema.parse(req)).toEqual(req);
  });

  it("rejects invalid PIN format", () => {
    expect(() =>
      createProfileRequestSchema.parse({ name: "Noah", pin: "abc" }),
    ).toThrow();
  });

  it("accepts 6-digit PIN", () => {
    const req = { name: "Noah", pin: "123456" };
    expect(createProfileRequestSchema.parse(req)).toEqual(req);
  });

  it("validates update profile with null PIN (to remove)", () => {
    const req = { pin: null };
    expect(updateProfileRequestSchema.parse(req)).toEqual(req);
  });

  it("validates select profile with PIN", () => {
    const req = { pin: "1234" };
    expect(selectProfileRequestSchema.parse(req)).toEqual(req);
  });

  it("validates select profile without PIN", () => {
    expect(selectProfileRequestSchema.parse({})).toEqual({});
  });
});

describe("device schemas", () => {
  it("validates pair claim request", () => {
    const req = { code: "A7X9K2", name: "Noah's MacBook", platform: "macos" };
    expect(pairClaimRequestSchema.parse(req)).toEqual(req);
  });

  it("validates update device request", () => {
    const req = { name: "Living Room NAS", isDefault: true };
    expect(updateDeviceRequestSchema.parse(req)).toEqual(req);
  });
});
