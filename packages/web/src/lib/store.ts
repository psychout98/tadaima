import { create } from "zustand";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

// ── Active download tracking ───────────────────────────────────

export interface ActiveDownload {
  jobId: string;
  requestId: string;
  title: string;
  mediaType: string;
  phase: string;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  eta?: number;
  deviceId?: string;
}

// ── Toast system ───────────────────────────────────────────────

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  createdAt: number;
}

// ── Store ──────────────────────────────────────────────────────

interface AppState {
  // Admin auth
  adminToken: string | null;
  adminRefreshToken: string | null;
  setAdminAuth: (accessToken: string, refreshToken: string) => void;
  clearAdminAuth: () => void;

  // Profile session
  profileToken: string | null;
  profile: { id: string; name: string; avatar: string | null } | null;
  setProfileSession: (
    token: string,
    profile: { id: string; name: string; avatar: string | null },
  ) => void;
  clearProfileSession: () => void;

  // WebSocket connection status
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // Device status from WebSocket
  deviceStatuses: Map<string, { isOnline: boolean; lastSeenAt: number }>;
  updateDeviceStatus: (
    deviceId: string,
    isOnline: boolean,
    lastSeenAt: number,
  ) => void;

  // Active downloads
  activeDownloads: Map<string, ActiveDownload>;
  setActiveDownload: (download: ActiveDownload) => void;
  removeActiveDownload: (jobId: string) => void;
  clearActiveDownloads: () => void;

  // Toasts
  toasts: Toast[];
  addToast: (type: Toast["type"], message: string) => void;
  removeToast: (id: string) => void;
}

export const useAuthStore = create<AppState>((set) => ({
  adminToken: null,
  adminRefreshToken: null,
  setAdminAuth: (accessToken, refreshToken) =>
    set({ adminToken: accessToken, adminRefreshToken: refreshToken }),
  clearAdminAuth: () => set({ adminToken: null, adminRefreshToken: null }),

  profileToken: null,
  profile: null,
  setProfileSession: (token, profile) => set({ profileToken: token, profile }),
  clearProfileSession: () =>
    set({
      profileToken: null,
      profile: null,
      activeDownloads: new Map(),
      toasts: [],
    }),

  connectionStatus: "disconnected",
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  deviceStatuses: new Map(),
  updateDeviceStatus: (deviceId, isOnline, lastSeenAt) =>
    set((state) => {
      const newMap = new Map(state.deviceStatuses);
      newMap.set(deviceId, { isOnline, lastSeenAt });
      return { deviceStatuses: newMap };
    }),

  activeDownloads: new Map(),
  setActiveDownload: (download) =>
    set((state) => {
      const newMap = new Map(state.activeDownloads);
      newMap.set(download.jobId, download);
      return { activeDownloads: newMap };
    }),
  removeActiveDownload: (jobId) =>
    set((state) => {
      const newMap = new Map(state.activeDownloads);
      newMap.delete(jobId);
      return { activeDownloads: newMap };
    }),
  clearActiveDownloads: () => set({ activeDownloads: new Map() }),

  toasts: [],
  addToast: (type, message) =>
    set((state) => ({
      toasts: [
        { id: `toast-${Date.now()}-${Math.random()}`, type, message, createdAt: Date.now() },
        ...state.toasts,
      ].slice(0, 5),
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
