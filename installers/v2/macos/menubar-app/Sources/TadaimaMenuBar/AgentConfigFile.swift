import Foundation

/// Read/write helper for the agent's config.json — the same file
/// packages/agent/src/config.ts operates on via the `conf` npm package.
/// Only the fields the Settings window edits are modeled; we round-trip
/// the rest as an opaque JSON blob so we don't accidentally drop fields
/// the agent cares about.
struct AgentConfigFile {
    private(set) var json: [String: Any]

    var relay: String {
        get { json["relay"] as? String ?? "" }
        set { json["relay"] = newValue }
    }

    var deviceName: String {
        get { json["deviceName"] as? String ?? "" }
        set { json["deviceName"] = newValue }
    }

    var deviceId: String {
        get { json["deviceId"] as? String ?? "" }
        set { json["deviceId"] = newValue }
    }

    var maxConcurrentDownloads: Int {
        get { json["maxConcurrentDownloads"] as? Int ?? 2 }
        set { json["maxConcurrentDownloads"] = newValue }
    }

    var moviesDirectory: String {
        get {
            guard let dirs = json["directories"] as? [String: Any] else { return "" }
            return dirs["movies"] as? String ?? ""
        }
        set {
            var dirs = (json["directories"] as? [String: Any]) ?? [:]
            dirs["movies"] = newValue
            json["directories"] = dirs
        }
    }

    var tvDirectory: String {
        get {
            guard let dirs = json["directories"] as? [String: Any] else { return "" }
            return dirs["tv"] as? String ?? ""
        }
        set {
            var dirs = (json["directories"] as? [String: Any]) ?? [:]
            dirs["tv"] = newValue
            json["directories"] = dirs
        }
    }

    static func load() throws -> AgentConfigFile {
        guard let url = ConfigPaths.configFile() else {
            throw NSError(
                domain: "TadaimaMenuBar",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No config.json found — agent is not configured yet."]
            )
        }
        let data = try Data(contentsOf: url)
        guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(
                domain: "TadaimaMenuBar",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "config.json is not a JSON object"]
            )
        }
        return AgentConfigFile(json: parsed)
    }

    func save() throws {
        guard let url = ConfigPaths.configFile() else {
            throw NSError(
                domain: "TadaimaMenuBar",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "No config.json path found"]
            )
        }
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
        // Atomic write: write to a sibling .tmp and rename.
        let tmp = url.appendingPathExtension("tmp")
        try data.write(to: tmp, options: .atomic)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    }
}
