import Foundation

/// Mirror of the `AgentStatus` interface in
/// packages/agent/src/status-file.ts. Changing the field names or types
/// here must be done in lockstep with the agent module.
struct AgentStatus: Codable, Equatable {
    let version: String
    let pid: Int
    let connected: Bool
    let relayUrl: String
    let deviceId: String
    let deviceName: String
    let activeDownloads: Int
    let lastHeartbeat: String
}

/// Computed view of the agent's connection state, including staleness.
enum AgentHealth: Equatable {
    /// status.json is present, recently updated, and reports `connected: true`.
    case connected
    /// status.json is present and recently updated, but reports `connected: false`.
    case disconnected
    /// status.json is missing or older than 3× STATUS_HEARTBEAT_INTERVAL_MS.
    case stale
}

struct AgentSnapshot: Equatable {
    let status: AgentStatus?
    let health: AgentHealth
    let lastReadAt: Date

    var dotSymbolName: String {
        switch health {
        case .connected: return "circle.fill"
        case .disconnected: return "circle.fill"
        case .stale: return "circle.fill"
        }
    }
}
