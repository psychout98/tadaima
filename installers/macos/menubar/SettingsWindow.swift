import Cocoa

class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private var relayField: NSTextField!
    private var moviesField: NSTextField!
    private var tvField: NSTextField!
    private var concurrentField: NSTextField!
    private var startOnLoginCheckbox: NSButton!

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Tadaima Agent Settings"
        window.center()
        self.init(window: window)
        window.delegate = self
        setupUI()
        loadConfig()
    }

    private func setupUI() {
        guard let contentView = window?.contentView else { return }

        let labels = ["Relay URL:", "Movies Folder:", "TV Shows Folder:", "Concurrent Downloads:"]
        var y = 260

        for (i, label) in labels.enumerated() {
            let lbl = NSTextField(labelWithString: label)
            lbl.frame = NSRect(x: 20, y: y, width: 150, height: 22)
            lbl.alignment = .right
            contentView.addSubview(lbl)

            let field = NSTextField()
            field.frame = NSRect(x: 180, y: y, width: 220, height: 22)
            field.isEditable = true
            contentView.addSubview(field)

            switch i {
            case 0: relayField = field
            case 1:
                moviesField = field
                let btn = NSButton(title: "Browse…", target: self, action: #selector(browseMovies))
                btn.frame = NSRect(x: 410, y: y, width: 60, height: 22)
                btn.bezelStyle = .inline
                contentView.addSubview(btn)
            case 2:
                tvField = field
                let btn = NSButton(title: "Browse…", target: self, action: #selector(browseTV))
                btn.frame = NSRect(x: 410, y: y, width: 60, height: 22)
                btn.bezelStyle = .inline
                contentView.addSubview(btn)
            case 3: concurrentField = field
            default: break
            }

            y -= 40
        }

        startOnLoginCheckbox = NSButton(checkboxWithTitle: "Start on login", target: nil, action: nil)
        startOnLoginCheckbox.frame = NSRect(x: 180, y: y, width: 200, height: 22)
        startOnLoginCheckbox.state = plistExists() ? .on : .off
        contentView.addSubview(startOnLoginCheckbox)

        y -= 50

        let saveBtn = NSButton(title: "Save", target: self, action: #selector(save))
        saveBtn.frame = NSRect(x: 350, y: y, width: 80, height: 30)
        saveBtn.bezelStyle = .rounded
        saveBtn.keyEquivalent = "\r"
        contentView.addSubview(saveBtn)

        let cancelBtn = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelBtn.frame = NSRect(x: 260, y: y, width: 80, height: 30)
        cancelBtn.bezelStyle = .rounded
        cancelBtn.keyEquivalent = "\u{1b}"
        contentView.addSubview(cancelBtn)
    }

    private func loadConfig() {
        guard let config = StatusReader.shared.readConfig() else { return }
        relayField.stringValue = config.relay
        moviesField.stringValue = config.directories.movies
        tvField.stringValue = config.directories.tv
        concurrentField.stringValue = String(config.maxConcurrentDownloads)
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

    @objc private func save() {
        guard var config = StatusReader.shared.readConfig() else { return }
        config.relay = relayField.stringValue
        config.directories.movies = moviesField.stringValue
        config.directories.tv = tvField.stringValue
        config.maxConcurrentDownloads = Int(concurrentField.stringValue) ?? 2
        StatusReader.shared.writeConfig(config)

        // Toggle login item
        let shouldStart = startOnLoginCheckbox.state == .on
        if shouldStart && !plistExists() {
            // Agent will create the plist via install-service
            runAgent(args: ["install-service"])
        } else if !shouldStart && plistExists() {
            runAgent(args: ["uninstall-service"])
        }

        window?.close()
    }

    @objc private func cancel() {
        window?.close()
    }

    private func plistExists() -> Bool {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return FileManager.default.fileExists(atPath: "\(home)/Library/LaunchAgents/com.tadaima.agent.plist")
    }

    private func runAgent(args: [String]) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/local/bin/tadaima-agent")
        task.arguments = args
        try? task.run()
    }
}
