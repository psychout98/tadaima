import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var statusMenuItem: NSMenuItem!
    private var deviceMenuItem: NSMenuItem!
    private var relayMenuItem: NSMenuItem!
    private var downloadsMenuItem: NSMenuItem!
    private var updateMenuItem: NSMenuItem!
    private var refreshTimer: Timer?
    private var settingsController: SettingsWindowController?
    private var pairController: PairWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.title = "T"
            button.toolTip = "Tadaima Agent"
        }

        buildMenu()
        startRefreshTimer()
    }

    /// Creates a main menu with an Edit menu so Cmd+C/V/X/A work in text fields.
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let editMenuItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        NSApplication.shared.mainMenu = mainMenu
    }

    private func buildMenu() {
        let menu = NSMenu()

        statusMenuItem = NSMenuItem(title: "Status: Checking...", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)

        deviceMenuItem = NSMenuItem(title: "Device: —", action: nil, keyEquivalent: "")
        deviceMenuItem.isEnabled = false
        menu.addItem(deviceMenuItem)

        relayMenuItem = NSMenuItem(title: "Relay: —", action: nil, keyEquivalent: "")
        relayMenuItem.isEnabled = false
        menu.addItem(relayMenuItem)

        downloadsMenuItem = NSMenuItem(title: "Downloads: 0", action: nil, keyEquivalent: "")
        downloadsMenuItem.isEnabled = false
        menu.addItem(downloadsMenuItem)

        menu.addItem(NSMenuItem.separator())

        updateMenuItem = NSMenuItem(title: "Check for Updates", action: #selector(checkForUpdates), keyEquivalent: "u")
        updateMenuItem.target = self
        menu.addItem(updateMenuItem)

        let pairItem = NSMenuItem(title: "Pair Device...", action: #selector(openPair), keyEquivalent: "p")
        pairItem.target = self
        menu.addItem(pairItem)

        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settingsItem.target = self
        menu.addItem(settingsItem)

        let logsItem = NSMenuItem(title: "View Logs", action: #selector(viewLogs), keyEquivalent: "l")
        logsItem.target = self
        menu.addItem(logsItem)

        menu.addItem(NSMenuItem.separator())

        let uninstallItem = NSMenuItem(title: "Uninstall...", action: #selector(uninstall), keyEquivalent: "")
        uninstallItem.target = self
        menu.addItem(uninstallItem)

        let quitItem = NSMenuItem(title: "Quit Tadaima Menu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func startRefreshTimer() {
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.refreshStatus()
        }
        refreshStatus() // initial
    }

    private func refreshStatus() {
        let reader = StatusReader.shared

        if let status = reader.readStatus(), reader.isAgentRunning() {
            // Agent is running
            let dot = status.connected ? "🟢" : "🟡"
            let connStr = status.connected ? "Connected" : "Reconnecting..."
            statusMenuItem.title = "\(dot) \(connStr) — v\(status.version)"
            deviceMenuItem.title = "Device: \(status.deviceName)"
            relayMenuItem.title = "Relay: \(status.relay)"
            downloadsMenuItem.title = "Downloads: \(status.activeDownloads)"

            if let button = statusItem.button {
                button.title = status.connected ? "T" : "T!"
            }

            if let update = status.updateAvailable {
                updateMenuItem.title = "Update to v\(update)"
            } else {
                updateMenuItem.title = "Check for Updates"
            }
        } else {
            // Agent is not running
            statusMenuItem.title = "🔴 Agent Not Running"
            deviceMenuItem.title = "Device: —"
            relayMenuItem.title = "Relay: —"
            downloadsMenuItem.title = "Downloads: 0"
            updateMenuItem.title = "Check for Updates"

            if let button = statusItem.button {
                button.title = "T"
            }
        }
    }

    @objc private func checkForUpdates() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/local/bin/tadaima-agent")
        task.arguments = ["update"]
        try? task.run()
    }

    @objc private func openPair() {
        if pairController == nil {
            pairController = PairWindowController()
        }
        pairController?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openSettings() {
        if settingsController == nil {
            settingsController = SettingsWindowController()
        }
        settingsController?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func viewLogs() {
        let logPath = StatusReader.shared.logPath
        NSWorkspace.shared.open(URL(fileURLWithPath: logPath))
    }

    @objc private func uninstall() {
        Uninstaller.confirmAndUninstall()
    }
}

// --- Entry point ---

@main
struct TadaimaMenuApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar only, no dock icon
        app.run()
    }
}
