import Cocoa

class PairWindowController: NSWindowController, NSWindowDelegate {
    private var relayField: NSTextField!
    private var codeField: NSTextField!
    private var moviesField: NSTextField!
    private var tvField: NSTextField!
    private var statusLabel: NSTextField!
    private var pairButton: NSButton!
    private var cancelButton: NSButton!

    // Step tracking — step 1: relay+code, step 2: folders
    private var currentStep = 1
    private var pairingRelay = ""
    private var pairingDeviceId = ""
    private var pairingDeviceToken = ""
    private var pairingDeviceName = ""
    private var pairingRdApiKey = ""

    // Step 2 views
    private var step2Views: [NSView] = []
    // Step 1 views
    private var step1Views: [NSView] = []

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 300),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Pair Device"
        window.center()
        self.init(window: window)
        window.delegate = self
        setupUI()
        prefillRelay()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        // --- Step 1: Relay + Code ---

        let relayLabel = NSTextField(labelWithString: "Relay URL:")
        relayLabel.frame = NSRect(x: 20, y: 240, width: 110, height: 22)
        relayLabel.alignment = .right
        contentView.addSubview(relayLabel)
        step1Views.append(relayLabel)

        relayField = NSTextField()
        relayField.frame = NSRect(x: 140, y: 240, width: 300, height: 22)
        relayField.placeholderString = "https://your-relay.example.com"
        contentView.addSubview(relayField)
        step1Views.append(relayField)

        let codeLabel = NSTextField(labelWithString: "Pairing Code:")
        codeLabel.frame = NSRect(x: 20, y: 200, width: 110, height: 22)
        codeLabel.alignment = .right
        contentView.addSubview(codeLabel)
        step1Views.append(codeLabel)

        codeField = NSTextField()
        codeField.frame = NSRect(x: 140, y: 200, width: 300, height: 22)
        codeField.placeholderString = "6-character code from web app"
        contentView.addSubview(codeField)
        step1Views.append(codeField)

        let hint = NSTextField(labelWithString: "Get a pairing code from the Tadaima web app → Devices → Pair New Device")
        hint.frame = NSRect(x: 140, y: 165, width: 300, height: 30)
        hint.font = NSFont.systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor
        hint.maximumNumberOfLines = 2
        hint.cell?.wraps = true
        contentView.addSubview(hint)
        step1Views.append(hint)

        // --- Step 2: Folders (hidden initially) ---

        let moviesLabel = NSTextField(labelWithString: "Movies Folder:")
        moviesLabel.frame = NSRect(x: 20, y: 240, width: 110, height: 22)
        moviesLabel.alignment = .right
        moviesLabel.isHidden = true
        contentView.addSubview(moviesLabel)
        step2Views.append(moviesLabel)

        moviesField = NSTextField()
        moviesField.frame = NSRect(x: 140, y: 240, width: 220, height: 22)
        moviesField.isEditable = true
        moviesField.isHidden = true
        contentView.addSubview(moviesField)
        step2Views.append(moviesField)

        let moviesBrowse = NSButton(title: "Browse…", target: self, action: #selector(browseMovies))
        moviesBrowse.frame = NSRect(x: 370, y: 240, width: 70, height: 22)
        moviesBrowse.bezelStyle = .inline
        moviesBrowse.isHidden = true
        contentView.addSubview(moviesBrowse)
        step2Views.append(moviesBrowse)

        let tvLabel = NSTextField(labelWithString: "TV Shows Folder:")
        tvLabel.frame = NSRect(x: 20, y: 200, width: 110, height: 22)
        tvLabel.alignment = .right
        tvLabel.isHidden = true
        contentView.addSubview(tvLabel)
        step2Views.append(tvLabel)

        tvField = NSTextField()
        tvField.frame = NSRect(x: 140, y: 200, width: 220, height: 22)
        tvField.isEditable = true
        tvField.isHidden = true
        contentView.addSubview(tvField)
        step2Views.append(tvField)

        let tvBrowse = NSButton(title: "Browse…", target: self, action: #selector(browseTV))
        tvBrowse.frame = NSRect(x: 370, y: 200, width: 70, height: 22)
        tvBrowse.bezelStyle = .inline
        tvBrowse.isHidden = true
        contentView.addSubview(tvBrowse)
        step2Views.append(tvBrowse)

        // --- Shared UI ---

        statusLabel = NSTextField(labelWithString: "")
        statusLabel.frame = NSRect(x: 20, y: 110, width: 420, height: 40)
        statusLabel.isEditable = false
        statusLabel.isBordered = false
        statusLabel.backgroundColor = .clear
        statusLabel.alignment = .center
        statusLabel.maximumNumberOfLines = 2
        statusLabel.cell?.wraps = true
        statusLabel.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        contentView.addSubview(statusLabel)

        pairButton = NSButton(title: "Pair", target: self, action: #selector(nextStep))
        pairButton.frame = NSRect(x: 350, y: 20, width: 80, height: 30)
        pairButton.bezelStyle = .rounded
        pairButton.keyEquivalent = "\r"
        contentView.addSubview(pairButton)

        cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelButton.frame = NSRect(x: 260, y: 20, width: 80, height: 30)
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        contentView.addSubview(cancelButton)
    }

    private func prefillRelay() {
        if let config = StatusReader.shared.readConfig(), !config.relay.isEmpty {
            relayField.stringValue = config.relay
        }
    }

    @objc private func nextStep() {
        if currentStep == 1 {
            doPair()
        } else {
            doFinish()
        }
    }

    // MARK: - Step 1: Pair

    private func doPair() {
        let relay = relayField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let code = codeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        guard !relay.isEmpty else {
            showStatus("Please enter a relay URL.", error: true)
            return
        }
        guard code.count == 6 else {
            showStatus("Pairing code must be 6 characters.", error: true)
            return
        }

        pairButton.isEnabled = false
        showStatus("Pairing...", error: false)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.callPairingAPI(relay: relay, code: code)
        }
    }

    private func callPairingAPI(relay: String, code: String) {
        guard let url = URL(string: "\(relay)/api/devices/pair/claim") else {
            showStatusOnMain("Invalid relay URL.", error: true)
            return
        }

        let deviceName = ProcessInfo.processInfo.hostName
            .components(separatedBy: ".").first?
            .lowercased() ?? "mac"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "code": code,
            "name": deviceName,
            "platform": "macos"
        ])

        let task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            if let error = error {
                self?.showStatusOnMain("Network error: \(error.localizedDescription)", error: true)
                return
            }

            guard let http = response as? HTTPURLResponse else {
                self?.showStatusOnMain("Invalid response from relay.", error: true)
                return
            }

            guard http.statusCode == 200, let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let deviceId = json["deviceId"] as? String,
                  let deviceToken = json["deviceToken"] as? String else {
                let msg: String
                switch http.statusCode {
                case 404: msg = "Pairing code not found or expired."
                case 409: msg = "Pairing code already claimed."
                default: msg = "Pairing failed (HTTP \(http.statusCode))."
                }
                self?.showStatusOnMain(msg, error: true)
                return
            }

            self?.pairingRelay = relay
            self?.pairingDeviceId = deviceId
            self?.pairingDeviceToken = deviceToken
            self?.pairingDeviceName = deviceName
            self?.pairingRdApiKey = (json["rdApiKey"] as? String) ?? ""

            DispatchQueue.main.async {
                self?.transitionToStep2()
            }
        }
        task.resume()
    }

    // MARK: - Step 2: Folders

    private func transitionToStep2() {
        currentStep = 2
        showStatus("Paired as \"\(pairingDeviceName)\"! Now choose your media folders.", error: false)
        statusLabel.textColor = .systemGreen

        for view in step1Views { view.isHidden = true }
        for view in step2Views { view.isHidden = false }

        pairButton.title = "Finish"
        pairButton.isEnabled = true

        // Pre-fill from existing config if available
        if let config = StatusReader.shared.readConfig() {
            if !config.directories.movies.isEmpty { moviesField.stringValue = config.directories.movies }
            if !config.directories.tv.isEmpty { tvField.stringValue = config.directories.tv }
        }
    }

    @objc private func browseMovies() {
        if let path = pickFolder(prompt: "Choose Movies folder") {
            moviesField.stringValue = path
        }
    }

    @objc private func browseTV() {
        if let path = pickFolder(prompt: "Choose TV Shows folder") {
            tvField.stringValue = path
        }
    }

    private func pickFolder(prompt: String) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = prompt
        return panel.runModal() == .OK ? panel.url?.path : nil
    }

    private func doFinish() {
        let movies = moviesField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let tv = tvField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard !movies.isEmpty, !tv.isEmpty else {
            showStatus("Please choose both a Movies and TV Shows folder.", error: true)
            return
        }

        // Build config, preserving existing fields if present
        var config = StatusReader.shared.readConfig() ?? AgentConfig(
            relay: pairingRelay,
            deviceToken: pairingDeviceToken,
            deviceId: pairingDeviceId,
            deviceName: pairingDeviceName,
            directories: AgentConfig.Directories(movies: "", tv: "", staging: "/tmp/tadaima/staging"),
            maxConcurrentDownloads: 2,
            rdPollInterval: 30
        )

        config.relay = pairingRelay
        config.deviceToken = pairingDeviceToken
        config.deviceId = pairingDeviceId
        config.deviceName = pairingDeviceName
        config.directories.movies = "/" + movies
        config.directories.tv = "/" + tv
        if config.directories.staging.isEmpty {
            config.directories.staging = "/tmp/tadaima/staging"
        }
        StatusReader.shared.writeConfig(config)

        // Install/restart the launchd service
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/local/bin/tadaima-agent")
        task.arguments = ["install-service"]
        try? task.run()
        task.waitUntilExit()

        showStatus("Setup complete! The agent is now running.", error: false)
        statusLabel.textColor = .systemGreen
        pairButton.title = "Done"
        pairButton.action = #selector(close)
        cancelButton.isHidden = true
    }

    // MARK: - Helpers

    private func showStatus(_ message: String, error: Bool) {
        statusLabel.textColor = error ? .systemRed : .secondaryLabelColor
        statusLabel.stringValue = message
        if error { pairButton.isEnabled = true }
    }

    private func showStatusOnMain(_ message: String, error: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.showStatus(message, error: error)
        }
    }

    @objc private func cancel() {
        window?.close()
    }

    @objc override func close() {
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        // Reset state for next open
        currentStep = 1
        for view in step1Views { view.isHidden = false }
        for view in step2Views { view.isHidden = true }
        statusLabel.stringValue = ""
        pairButton.title = "Pair"
        pairButton.action = #selector(nextStep)
        pairButton.isEnabled = true
        cancelButton.isHidden = false
    }
}
