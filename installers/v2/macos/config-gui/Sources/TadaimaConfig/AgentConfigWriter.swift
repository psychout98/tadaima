import Foundation

/// Writes the agent's canonical config.json on macOS. The path and field
/// names must match packages/agent/src/config.ts exactly, because the
/// agent reads this file via the `conf` npm package which has fixed
/// conventions per platform.
///
/// On macOS (darwin), the `conf` npm package (v15) uses `env-paths` with
/// suffix "nodejs", resolving to ~/Library/Preferences/tadaima-nodejs/.
enum AgentConfigWriter {
    static func configURL() -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home
            .appendingPathComponent("Library")
            .appendingPathComponent("Preferences")
            .appendingPathComponent("tadaima-nodejs")
            .appendingPathComponent("config.json")
    }

    /// Write config.json with the fields the agent requires. If a
    /// config.json already exists we load it first and merge, to preserve
    /// any fields the agent cares about that we don't model here.
    static func write(
        relayUrl: String,
        deviceId: String,
        deviceToken: String,
        deviceName: String,
        profileName: String,
        rdApiKey: String,
        movies: String,
        tv: String
    ) throws {
        let url = configURL()
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        var existing: [String: Any] = [:]
        if let data = try? Data(contentsOf: url),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        {
            existing = parsed
        }

        existing["relay"] = relayUrl
        existing["deviceId"] = deviceId
        existing["deviceToken"] = deviceToken
        existing["deviceName"] = deviceName
        if !profileName.isEmpty {
            existing["profileName"] = profileName
        }

        var directories = (existing["directories"] as? [String: Any]) ?? [:]
        directories["movies"] = movies
        directories["tv"] = tv
        if directories["staging"] == nil {
            directories["staging"] = "/tmp/tadaima/staging"
        }
        existing["directories"] = directories

        var realDebrid = (existing["realDebrid"] as? [String: Any]) ?? [:]
        if !rdApiKey.isEmpty {
            realDebrid["apiKey"] = rdApiKey
        }
        if realDebrid["apiKey"] == nil {
            realDebrid["apiKey"] = ""
        }
        existing["realDebrid"] = realDebrid
        if existing["maxConcurrentDownloads"] == nil {
            existing["maxConcurrentDownloads"] = 2
        }
        if existing["rdPollInterval"] == nil {
            existing["rdPollInterval"] = 30
        }
        if existing["updateChannel"] == nil {
            existing["updateChannel"] = "stable"
        }

        let data = try JSONSerialization.data(
            withJSONObject: existing,
            options: [.prettyPrinted, .sortedKeys]
        )
        // Atomic write: tmp + replace
        let tmp = url.appendingPathExtension("tmp")
        try data.write(to: tmp, options: .atomic)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    }
}
