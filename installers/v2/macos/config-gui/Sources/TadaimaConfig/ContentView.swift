import SwiftUI
import AppKit

struct ContentView: View {
    @State private var relayUrl: String = "https://"
    @State private var pairingCode: String = ""
    @State private var moviesDir: String = ""
    @State private var tvDir: String = ""
    @State private var isPairing: Bool = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Welcome to Tadaima")
                .font(.title2).bold()
            Text("Pair this Mac with your Tadaima instance. Copy the 6-character pairing code from your Tadaima web app, then choose where downloaded media should live.")
                .font(.footnote)
                .foregroundColor(.secondary)

            Form {
                TextField("Relay URL", text: $relayUrl)
                TextField("Pairing Code", text: $pairingCode)
                    .onChange(of: pairingCode) { newValue in
                        // Normalize to uppercase and cap at 6 characters.
                        pairingCode = String(newValue.uppercased().prefix(6))
                    }

                HStack {
                    Text("Movies:")
                    TextField("", text: $moviesDir)
                    Button("Choose…") { pickDirectory($moviesDir) }
                }
                HStack {
                    Text("TV Shows:")
                    TextField("", text: $tvDir)
                    Button("Choose…") { pickDirectory($tvDir) }
                }
            }

            if let err = errorMessage {
                Text(err).foregroundColor(.red).font(.footnote)
            }
            if let ok = successMessage {
                Text(ok).foregroundColor(.green).font(.footnote)
            }

            HStack {
                Spacer()
                Button("Pair and Save") {
                    Task { await pairAndSave() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isPairing || !formValid)
            }
        }
        .padding(24)
    }

    private var formValid: Bool {
        !relayUrl.isEmpty && pairingCode.count == 6 && !moviesDir.isEmpty && !tvDir.isEmpty
    }

    private func pickDirectory(_ binding: Binding<String>) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            binding.wrappedValue = url.path
        }
    }

    @MainActor
    private func pairAndSave() async {
        errorMessage = nil
        successMessage = nil
        isPairing = true
        defer { isPairing = false }
        do {
            let result = try await PairingClient.claim(relayUrl: relayUrl, pairingCode: pairingCode)
            try AgentConfigWriter.write(
                relayUrl: relayUrl,
                deviceId: result.deviceId,
                deviceToken: result.deviceToken,
                deviceName: result.deviceName,
                profileName: "",
                rdApiKey: result.rdApiKey ?? "",
                movies: moviesDir,
                tv: tvDir
            )
            successMessage = "Paired as \(result.deviceName). Completing setup…"
            // Give the user a beat to read the message before we exit.
            try? await Task.sleep(nanoseconds: 700_000_000)
            // The .pkg postinstall invokes TadaimaConfig.app via `open -W`
            // and checks our exit code, so a clean exit(0) is what tells
            // the installer it can proceed to register the launchd job.
            exit(0)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
