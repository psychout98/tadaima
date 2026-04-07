import Foundation

/// Represents the agent's runtime status, read from ~/.config/tadaima/status.json
struct AgentStatus: Codable {
    let pid: Int
    let version: String
    let connected: Bool
    let relay: String
    let deviceName: String
    let activeDownloads: Int
    let lastHeartbeat: String
    let updateAvailable: String?
}

/// Represents the agent's config, read from ~/.config/tadaima/config.json
struct AgentConfig: Codable {
    var relay: String
    var deviceToken: String
    var deviceId: String
    var deviceName: String
    var directories: Directories
    var maxConcurrentDownloads: Int
    var rdPollInterval: Int

    struct Directories: Codable {
        var movies: String
        var tv: String
        var staging: String
    }
}

class StatusReader {
    static let shared = StatusReader()

    private let configDir: String
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        configDir = "\(home)/.config/tadaima"
        encoder.outputFormatting = .prettyPrinted
    }

    var statusPath: String { "\(configDir)/status.json" }
    var configPath: String { "\(configDir)/config.json" }
    var logPath: String { "\(configDir)/logs/tadaima.log" }

    func readStatus() -> AgentStatus? {
        guard let data = FileManager.default.contents(atPath: statusPath) else { return nil }
        return try? decoder.decode(AgentStatus.self, from: data)
    }

    func readConfig() -> AgentConfig? {
        guard let data = FileManager.default.contents(atPath: configPath) else { return nil }
        return try? decoder.decode(AgentConfig.self, from: data)
    }

    func writeConfig(_ config: AgentConfig) {
        guard let data = try? encoder.encode(config) else { return }
        FileManager.default.createFile(atPath: configPath, contents: data)
    }

    /// Returns true if the agent appears to be running (status file exists and heartbeat is recent)
    func isAgentRunning() -> Bool {
        guard let status = readStatus() else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let heartbeat = formatter.date(from: status.lastHeartbeat) else { return false }
        return Date().timeIntervalSince(heartbeat) < 30 // stale if >30s
    }
}
