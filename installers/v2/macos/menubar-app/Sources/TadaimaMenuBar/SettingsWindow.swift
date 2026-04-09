import SwiftUI
import AppKit
import ServiceManagement

/// Settings window content view. Loaded via the Settings scene in
/// TadaimaMenuBarApp.swift so it gets a real native window.
struct SettingsView: View {
    @State private var relayUrl: String = ""
    @State private var moviesDir: String = ""
    @State private var tvDir: String = ""
    @State private var maxDownloads: Int = 2
    @State private var startOnLogin: Bool = true
    @State private var errorMessage: String?
    @State private var savedIndicator: Bool = false
    @State private var configOnDisk: AgentConfigFile?

    var body: some View {
        Form {
            Section(header: Text("Relay")) {
                TextField("Relay URL", text: $relayUrl)
                    .textFieldStyle(.roundedBorder)
            }
            Section(header: Text("Media Directories")) {
                directoryPicker(label: "Movies", value: $moviesDir)
                directoryPicker(label: "TV Shows", value: $tvDir)
            }
            Section(header: Text("Downloads")) {
                Stepper("Max concurrent downloads: \(maxDownloads)", value: $maxDownloads, in: 1...8)
            }
            Section(header: Text("Startup")) {
                Toggle("Start Tadaima on login", isOn: $startOnLogin)
                    .onChange(of: startOnLogin) { newValue in
                        applyStartOnLogin(newValue)
                    }
            }
            if let err = errorMessage {
                Text(err)
                    .foregroundColor(.red)
                    .font(.footnote)
            }
            if savedIndicator {
                Text("Saved.")
                    .foregroundColor(.green)
                    .font(.footnote)
            }
            HStack {
                Spacer()
                Button("Save") { save() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 480)
        .onAppear(perform: load)
    }

    @ViewBuilder
    private func directoryPicker(label: String, value: Binding<String>) -> some View {
        HStack {
            Text(label + ":")
            TextField("", text: value)
                .textFieldStyle(.roundedBorder)
            Button("Choose...") {
                let panel = NSOpenPanel()
                panel.canChooseFiles = false
                panel.canChooseDirectories = true
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    value.wrappedValue = url.path
                }
            }
        }
    }

    private func load() {
        do {
            let cfg = try AgentConfigFile.load()
            relayUrl = cfg.relay
            moviesDir = cfg.moviesDirectory
            tvDir = cfg.tvDirectory
            maxDownloads = cfg.maxConcurrentDownloads
            configOnDisk = cfg
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() {
        savedIndicator = false
        do {
            guard var cfg = configOnDisk else {
                throw NSError(
                    domain: "TadaimaMenuBar",
                    code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "Config not loaded"]
                )
            }
            let oldRelay = cfg.relay
            cfg.relay = relayUrl
            cfg.moviesDirectory = moviesDir
            cfg.tvDirectory = tvDir
            cfg.maxConcurrentDownloads = maxDownloads
            try cfg.save()
            configOnDisk = cfg
            errorMessage = nil
            savedIndicator = true

            // If the relay URL changed, restart the agent so it picks up
            // the new URL. launchd's KeepAlive brings it back.
            if oldRelay != relayUrl {
                restartAgentByKillingPid()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func restartAgentByKillingPid() {
        guard let pidFile = ConfigPaths.pidFile(),
              let pidStr = try? String(contentsOf: pidFile, encoding: .utf8),
              let pid = Int32(pidStr.trimmingCharacters(in: .whitespacesAndNewlines))
        else { return }
        kill(pid, SIGTERM)
    }

    private func applyStartOnLogin(_ on: Bool) {
        let plist = BundlePaths.launchAgentPlist.path
        let uid = Shell.currentUid()
        if on {
            _ = Shell.run(
                URL(fileURLWithPath: "/bin/launchctl"),
                ["bootstrap", "gui/\(uid)", plist]
            )
        } else {
            _ = Shell.run(
                URL(fileURLWithPath: "/bin/launchctl"),
                ["bootout", "gui/\(uid)", plist]
            )
        }
    }
}
