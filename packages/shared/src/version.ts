// Version infrastructure — shared constants for GitHub Releases

export const GITHUB_REPO = "psychout98/tadaima";
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** Maps platform+arch to the expected binary asset name on GitHub Releases */
export const BINARY_ASSET_NAMES: Record<string, string> = {
  "darwin-arm64": "tadaima-agent-darwin-arm64",
  "darwin-x64": "tadaima-agent-darwin-x64",
  "win32-x64": "tadaima-agent-win-x64.exe",
  "linux-x64": "tadaima-agent-linux-x64",
};

/** Returns the correct binary asset name for the current platform, or null if unsupported */
export function getAssetNameForPlatform(): string | null {
  const key = `${process.platform}-${process.arch}`;
  return BINARY_ASSET_NAMES[key] ?? null;
}

export interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface ReleaseInfo {
  version: string;
  assets: ReleaseAsset[];
  checksumsUrl: string;
}
