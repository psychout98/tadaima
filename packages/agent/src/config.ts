import Conf from "conf";

export interface AgentConfig {
  relay: string;
  deviceToken: string;
  deviceId: string;
  deviceName: string;
  profileName: string;
  directories: {
    movies: string;
    tv: string;
    staging: string;
  };
  realDebrid: {
    apiKey: string;
  };
  maxConcurrentDownloads: number;
  rdPollInterval: number;
  lastUpdateCheck: string;
  updateChannel: "stable";
  previousBinaryPath: string;
}

export const config = new Conf<AgentConfig>({
  projectName: "tadaima",
  defaults: {
    relay: "",
    deviceToken: "",
    deviceId: "",
    deviceName: "",
    profileName: "",
    directories: {
      movies: "",
      tv: "",
      staging: "",
    },
    realDebrid: {
      apiKey: "",
    },
    maxConcurrentDownloads: 2,
    rdPollInterval: 30,
    lastUpdateCheck: "",
    updateChannel: "stable",
    previousBinaryPath: "",
  },
});
