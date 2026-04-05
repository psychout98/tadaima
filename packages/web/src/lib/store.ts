import { create } from "zustand";

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
}));
