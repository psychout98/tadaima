const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "UNKNOWN", detail: res.statusText }));
    throw new ApiError(res.status, body.error, body.detail);
  }

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(detail ?? code);
  }
}

// ── Setup ──────────────────────────────────────────────────────

export const api = {
  setup: {
    status: () => request<{ needsSetup: boolean }>("/api/setup/status"),
    complete: (data: {
      username: string;
      password: string;
      tmdbApiKey: string;
      rdApiKey: string;
      profileName: string;
      profileAvatar?: string;
    }) =>
      request<{ adminId: string; profile: { id: string; name: string } }>(
        "/api/setup/complete",
        { method: "POST", body: JSON.stringify(data) },
      ),
  },

  auth: {
    login: (username: string, password: string) =>
      request<{ accessToken: string; refreshToken: string }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ username, password }) },
      ),
    refresh: (refreshToken: string) =>
      request<{ accessToken: string; refreshToken: string }>(
        "/api/auth/refresh",
        { method: "POST", body: JSON.stringify({ refreshToken }) },
      ),
    logout: (refreshToken: string) =>
      request<{ success: boolean }>("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      }),
  },

  profiles: {
    list: () =>
      request<
        Array<{
          id: string;
          name: string;
          avatar: string | null;
          hasPin: boolean;
          createdAt: string;
        }>
      >("/api/profiles"),
    create: (
      data: { name: string; avatar?: string; pin?: string },
      token: string,
    ) =>
      request<{
        id: string;
        name: string;
        avatar: string | null;
        hasPin: boolean;
      }>("/api/profiles", { method: "POST", body: JSON.stringify(data) }, token),
    update: (
      id: string,
      data: { name?: string; avatar?: string; pin?: string | null },
      token: string,
    ) =>
      request<{
        id: string;
        name: string;
        avatar: string | null;
        hasPin: boolean;
      }>(
        `/api/profiles/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    delete: (id: string, token: string) =>
      request<{ success: boolean }>(
        `/api/profiles/${id}`,
        { method: "DELETE" },
        token,
      ),
    select: (id: string, pin?: string) =>
      request<{
        token: string;
        profile: {
          id: string;
          name: string;
          avatar: string | null;
          hasPin: boolean;
        };
      }>(`/api/profiles/${id}/select`, {
        method: "POST",
        body: JSON.stringify({ pin }),
      }),
  },

  settings: {
    get: (token: string) =>
      request<{ rdApiKey: string | null; tmdbApiKey: string | null }>(
        "/api/admin/settings",
        {},
        token,
      ),
    update: (
      data: { rdApiKey?: string; tmdbApiKey?: string },
      token: string,
    ) =>
      request<{ success: boolean }>(
        "/api/admin/settings",
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    testRd: (apiKey: string, token: string) =>
      request<{ valid: boolean; detail?: string }>(
        "/api/admin/settings/test-rd",
        { method: "POST", body: JSON.stringify({ apiKey }) },
        token,
      ),
    testTmdb: (apiKey: string, token: string) =>
      request<{ valid: boolean; detail?: string }>(
        "/api/admin/settings/test-tmdb",
        { method: "POST", body: JSON.stringify({ apiKey }) },
        token,
      ),
  },

  devices: {
    list: (token: string) =>
      request<
        Array<{
          id: string;
          name: string;
          platform: string;
          isOnline: boolean;
          isDefault: boolean;
          lastSeenAt: string | null;
          createdAt: string;
        }>
      >("/api/devices", {}, token),
    update: (
      id: string,
      data: { name?: string; isDefault?: boolean },
      token: string,
    ) =>
      request<{
        id: string;
        name: string;
        platform: string;
        isOnline: boolean;
        isDefault: boolean;
      }>(
        `/api/devices/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
        token,
      ),
    delete: (id: string, token: string) =>
      request<{ success: boolean }>(
        `/api/devices/${id}`,
        { method: "DELETE" },
        token,
      ),
    pairRequest: (token: string) =>
      request<{ code: string; expiresAt: string }>(
        "/api/devices/pair/request",
        { method: "POST" },
        token,
      ),
  },
};
