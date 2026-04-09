import Foundation
import Combine

/// Polls the agent's status.json file on a fixed timer and publishes a
/// snapshot. The view observes this object and redraws when `snapshot`
/// changes.
@MainActor
final class StatusPoller: ObservableObject {
    @Published private(set) var snapshot: AgentSnapshot = AgentSnapshot(
        status: nil,
        health: .stale,
        lastReadAt: Date(timeIntervalSince1970: 0)
    )

    private let trayConfig: TrayConfig
    private var timer: Timer?

    init(trayConfig: TrayConfig) {
        self.trayConfig = trayConfig
    }

    func start() {
        guard timer == nil else { return }
        refresh()
        let t = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    func refresh() {
        let now = Date()
        guard let statusURL = ConfigPaths.statusFile() else {
            snapshot = AgentSnapshot(status: nil, health: .stale, lastReadAt: now)
            return
        }

        let fm = FileManager.default
        guard fm.fileExists(atPath: statusURL.path) else {
            snapshot = AgentSnapshot(status: nil, health: .stale, lastReadAt: now)
            return
        }

        // Staleness check: if mtime is older than 3× the heartbeat interval,
        // we render the dot as gray regardless of what the file says.
        let mtime = (try? fm.attributesOfItem(atPath: statusURL.path)[.modificationDate] as? Date) ?? .distantPast
        let age = now.timeIntervalSince(mtime)
        if age > trayConfig.staleAfter {
            snapshot = AgentSnapshot(status: parse(statusURL), health: .stale, lastReadAt: now)
            return
        }

        guard let status = parse(statusURL) else {
            snapshot = AgentSnapshot(status: nil, health: .stale, lastReadAt: now)
            return
        }

        snapshot = AgentSnapshot(
            status: status,
            health: status.connected ? .connected : .disconnected,
            lastReadAt: now
        )
    }

    private func parse(_ url: URL) -> AgentStatus? {
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(AgentStatus.self, from: data)
        } catch {
            NSLog("[TadaimaMenuBar] status.json parse failed: \(error)")
            return nil
        }
    }
}
