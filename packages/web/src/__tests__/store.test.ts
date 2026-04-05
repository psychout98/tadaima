import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "../lib/store";

describe("useAuthStore", () => {
  beforeEach(() => {
    // Reset store between tests
    const { getState } = useAuthStore;
    getState().clearAdminAuth();
    getState().clearProfileSession();
    getState().clearActiveDownloads();
  });

  describe("admin auth", () => {
    it("sets and clears admin auth", () => {
      const { setAdminAuth, clearAdminAuth } = useAuthStore.getState();

      setAdminAuth("access-token", "refresh-token");
      expect(useAuthStore.getState().adminToken).toBe("access-token");
      expect(useAuthStore.getState().adminRefreshToken).toBe("refresh-token");

      clearAdminAuth();
      expect(useAuthStore.getState().adminToken).toBeNull();
      expect(useAuthStore.getState().adminRefreshToken).toBeNull();
    });
  });

  describe("profile session", () => {
    it("sets and clears profile session", () => {
      const { setProfileSession, clearProfileSession } =
        useAuthStore.getState();

      setProfileSession("profile-token", {
        id: "p1",
        name: "Noah",
        avatar: "bg-blue-500",
      });
      expect(useAuthStore.getState().profileToken).toBe("profile-token");
      expect(useAuthStore.getState().profile?.name).toBe("Noah");

      clearProfileSession();
      expect(useAuthStore.getState().profileToken).toBeNull();
      expect(useAuthStore.getState().profile).toBeNull();
    });

    it("clears active downloads when clearing profile", () => {
      const { setActiveDownload, clearProfileSession, setProfileSession } =
        useAuthStore.getState();

      setProfileSession("token", {
        id: "p1",
        name: "Noah",
        avatar: null,
      });

      setActiveDownload({
        jobId: "j1",
        requestId: "r1",
        title: "Test",
        mediaType: "movie",
        phase: "downloading",
        progress: 50,
      });

      expect(useAuthStore.getState().activeDownloads.size).toBe(1);

      clearProfileSession();
      expect(useAuthStore.getState().activeDownloads.size).toBe(0);
    });
  });

  describe("active downloads", () => {
    it("sets and removes active downloads", () => {
      const { setActiveDownload, removeActiveDownload } =
        useAuthStore.getState();

      setActiveDownload({
        jobId: "j1",
        requestId: "r1",
        title: "Inception",
        mediaType: "movie",
        phase: "downloading",
        progress: 45,
        speedBps: 20000000,
        eta: 300,
      });

      const dl = useAuthStore.getState().activeDownloads.get("j1");
      expect(dl?.title).toBe("Inception");
      expect(dl?.progress).toBe(45);

      removeActiveDownload("j1");
      expect(useAuthStore.getState().activeDownloads.size).toBe(0);
    });

    it("updates existing download by jobId", () => {
      const { setActiveDownload } = useAuthStore.getState();

      setActiveDownload({
        jobId: "j1",
        requestId: "r1",
        title: "Inception",
        mediaType: "movie",
        phase: "downloading",
        progress: 10,
      });

      setActiveDownload({
        jobId: "j1",
        requestId: "r1",
        title: "Inception",
        mediaType: "movie",
        phase: "downloading",
        progress: 80,
      });

      expect(useAuthStore.getState().activeDownloads.size).toBe(1);
      expect(useAuthStore.getState().activeDownloads.get("j1")?.progress).toBe(
        80,
      );
    });
  });

  describe("toasts", () => {
    it("adds and removes toasts", () => {
      const { addToast, removeToast } = useAuthStore.getState();

      addToast("success", "Download complete!");
      const toasts = useAuthStore.getState().toasts;
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].message).toBe("Download complete!");

      removeToast(toasts[0].id);
      expect(useAuthStore.getState().toasts.length).toBe(0);
    });

    it("limits to 5 toasts", () => {
      const { addToast } = useAuthStore.getState();

      for (let i = 0; i < 8; i++) {
        addToast("info", `Toast ${i}`);
      }

      expect(useAuthStore.getState().toasts.length).toBeLessThanOrEqual(5);
    });
  });

  describe("device statuses", () => {
    it("updates device status", () => {
      const { updateDeviceStatus } = useAuthStore.getState();

      updateDeviceStatus("d1", true, Date.now());
      const status = useAuthStore.getState().deviceStatuses.get("d1");
      expect(status?.isOnline).toBe(true);

      updateDeviceStatus("d1", false, Date.now());
      const updated = useAuthStore.getState().deviceStatuses.get("d1");
      expect(updated?.isOnline).toBe(false);
    });
  });

  describe("connection status", () => {
    it("tracks connection status", () => {
      const { setConnectionStatus } = useAuthStore.getState();

      expect(useAuthStore.getState().connectionStatus).toBe("disconnected");

      setConnectionStatus("connecting");
      expect(useAuthStore.getState().connectionStatus).toBe("connecting");

      setConnectionStatus("connected");
      expect(useAuthStore.getState().connectionStatus).toBe("connected");
    });
  });
});
