import { create } from "zustand";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface AuthState {
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
}

export const useAuthStore = create<AuthState>((set) => ({
  adminToken: null,
  adminRefreshToken: null,
  setAdminAuth: (accessToken, refreshToken) =>
    set({ adminToken: accessToken, adminRefreshToken: refreshToken }),
  clearAdminAuth: () => set({ adminToken: null, adminRefreshToken: null }),

  profileToken: null,
  profile: null,
  setProfileSession: (token, profile) => set({ profileToken: token, profile }),
  clearProfileSession: () => set({ profileToken: null, profile: null }),

  connectionStatus: "disconnected",
  setConnectionStatus: (status) => set({ connectionStatus: status }),

  deviceStatuses: new Map(),
  updateDeviceStatus: (deviceId, isOnline, lastSeenAt) =>
    set((state) => {
      const newMap = new Map(state.deviceStatuses);
      newMap.set(deviceId, { isOnline, lastSeenAt });
      return { deviceStatuses: newMap };
    }),
}));
