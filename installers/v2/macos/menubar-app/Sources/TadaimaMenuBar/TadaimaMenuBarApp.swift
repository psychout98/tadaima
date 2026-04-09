import SwiftUI
import AppKit

/// Entry point for the Tadaima menu bar app.
///
/// This is the outer container for everything the installer ships:
///   - Bundled Node runtime (Contents/Resources/runtime)
///   - Pinned @psychout98/tadaima agent (Contents/Resources/agent)
///   - First-run config GUI bundle (Contents/Resources/TadaimaConfig.app)
///   - launchd plist template (Contents/Resources/com.tadaima.agent.plist.template)
///
/// The app itself is a thin SwiftUI MenuBarExtra that reads status.json
/// on a 2-second timer and offers Settings / Check for Updates /
/// View Logs / Uninstall / Quit.
@main
struct TadaimaMenuBarApp: App {
    @StateObject private var poller: StatusPoller

    init() {
        let cfg = TrayConfig.load()
        _poller = StateObject(wrappedValue: StatusPoller(trayConfig: cfg))
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarContent(poller: poller)
        } label: {
            StatusDotLabel(snapshot: poller.snapshot)
        }
        .menuBarExtraStyle(.menu)

        Settings {
            SettingsView()
        }
    }
}

struct StatusDotLabel: View {
    let snapshot: AgentSnapshot

    var body: some View {
        // A simple colored circle using SF Symbols + tinting. We'd ship a
        // template icon for GA so the label respects dark mode contrast
        // automatically.
        let color: Color = {
            switch snapshot.health {
            case .connected: return .green
            case .disconnected: return .red
            case .stale: return .gray
            }
        }()
        Image(systemName: "circle.fill")
            .foregroundColor(color)
    }
}

struct MenuBarContent: View {
    @ObservedObject var poller: StatusPoller
    @State private var updateStatusMessage: String?

    var body: some View {
        Group {
            header
            Divider()
            Button("Settings…") { openSettings() }
            Button("Check for Updates") { runUpdateCheck() }
            Button("View Logs…") { openLogs() }
            if let msg = updateStatusMessage {
                Text(msg).font(.footnote)
            }
            Divider()
            Button("Uninstall Tadaima…") { runUninstall() }
            Divider()
            Button("Quit") { NSApplication.shared.terminate(nil) }
                .keyboardShortcut("q")
        }
        .onAppear { poller.start() }
    }

    @ViewBuilder
    private var header: some View {
        if let status = poller.snapshot.status {
            Text(status.deviceName.isEmpty ? "Tadaima" : status.deviceName)
                .font(.headline)
            Text(status.relayUrl).font(.footnote).foregroundColor(.secondary)
            Text("Active downloads: \(status.activeDownloads)")
                .font(.footnote)
                .foregroundColor(.secondary)
            Text(stateText).font(.footnote).foregroundColor(.secondary)
        } else {
            Text("Tadaima").font(.headline)
            Text("Agent not reporting").font(.footnote).foregroundColor(.secondary)
        }
    }

    private var stateText: String {
        switch poller.snapshot.health {
        case .connected: return "Connected"
        case .disconnected: return "Disconnected"
        case .stale: return "No heartbeat"
        }
    }

    private func openSettings() {
        if #available(macOS 14.0, *) {
            NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        } else {
            NSApp.sendAction(Selector(("showPreferencesWindow:")), to: nil, from: nil)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openLogs() {
        NSWorkspace.shared.open(BundlePaths.agentLog)
    }

    private func runUpdateCheck() {
        updateStatusMessage = "Checking…"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if let info = try UpdateChecker.check() {
                    DispatchQueue.main.async {
                        let alert = NSAlert()
                        alert.messageText = "Update available"
                        alert.informativeText = "Version \(info.latest) is available (you have \(info.current)). Update now?"
                        alert.addButton(withTitle: "Update")
                        alert.addButton(withTitle: "Not now")
                        if alert.runModal() == .alertFirstButtonReturn {
                            DispatchQueue.global(qos: .userInitiated).async {
                                do {
                                    try UpdateChecker.applyUpdate()
                                    DispatchQueue.main.async {
                                        updateStatusMessage = "Updated to \(info.latest)"
                                    }
                                } catch {
                                    DispatchQueue.main.async {
                                        updateStatusMessage = "Update failed: \(error.localizedDescription)"
                                    }
                                }
                            }
                        } else {
                            updateStatusMessage = nil
                        }
                    }
                } else {
                    DispatchQueue.main.async { updateStatusMessage = "Up to date." }
                }
            } catch {
                DispatchQueue.main.async {
                    updateStatusMessage = "Check failed: \(error.localizedDescription)"
                }
            }
        }
    }

    private func runUninstall() {
        let alert = NSAlert()
        alert.messageText = "Uninstall Tadaima?"
        alert.informativeText = "This will stop the agent and remove Tadaima from your system. Your media files and configuration will be kept."
        alert.addButton(withTitle: "Uninstall")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            _ = Uninstaller.runUninstall()
            NSApplication.shared.terminate(nil)
        }
    }
}
