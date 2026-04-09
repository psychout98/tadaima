import Foundation

/// Loaded from `Tadaima.app/Contents/Resources/tray-config.json`, which the
/// macOS build script writes at build time by reading the agent's
/// `STATUS_HEARTBEAT_INTERVAL_MS` constant. The tray app uses the heartbeat
/// interval to compute when status.json is considered stale (3× the
/// interval).
struct TrayConfig: Decodable {
    let statusHeartbeatIntervalMs: Int

    var staleAfter: TimeInterval {
        TimeInterval(statusHeartbeatIntervalMs * 3) / 1000.0
    }

    static let fallbackIntervalMs = 10_000

    /// Load the tray config JSON from the app bundle. If the file is
    /// missing or malformed we log and fall back to 10s, because an
    /// unusable config should degrade the tray to "gray dot + warning"
    /// rather than refuse to start.
    static func load() -> TrayConfig {
        guard let url = Bundle.main.url(forResource: "tray-config", withExtension: "json") else {
            NSLog("[TadaimaMenuBar] tray-config.json missing from bundle; using fallback 10s interval")
            return TrayConfig(statusHeartbeatIntervalMs: fallbackIntervalMs)
        }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            // We accept either camelCase or snake_case so the build script
            // can write whichever is convenient.
            if let cfg = try? decoder.decode(TrayConfig.self, from: data) {
                return cfg
            }
            let plain = JSONDecoder()
            return try plain.decode(TrayConfig.self, from: data)
        } catch {
            NSLog("[TadaimaMenuBar] tray-config.json parse failed: \(error); using fallback")
            return TrayConfig(statusHeartbeatIntervalMs: fallbackIntervalMs)
        }
    }
}
