import Cocoa

class Uninstaller {
    static func confirmAndUninstall() {
        let alert = NSAlert()
        alert.messageText = "Uninstall Tadaima Agent?"
        alert.informativeText = "This will stop the agent, remove the background service, and delete the binary. Your configuration will be preserved."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Uninstall")
        alert.addButton(withTitle: "Cancel")

        guard alert.runModal() == .alertFirstButtonReturn else { return }

        // Stop and remove the launchd service
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let plistPath = "\(home)/Library/LaunchAgents/com.tadaima.agent.plist"

        let unload = Process()
        unload.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        unload.arguments = ["unload", plistPath]
        try? unload.run()
        unload.waitUntilExit()

        // Remove plist
        try? FileManager.default.removeItem(atPath: plistPath)

        // Remove binary
        try? FileManager.default.removeItem(atPath: "/usr/local/bin/tadaima-agent")

        // Remove status file (conf stores in ~/Library/Preferences/tadaima-nodejs/)
        try? FileManager.default.removeItem(atPath: "\(home)/Library/Preferences/tadaima-nodejs/status.json")

        let done = NSAlert()
        done.messageText = "Uninstall Complete"
        done.informativeText = "The Tadaima Agent has been removed. Your configuration has been preserved."
        done.alertStyle = .informational
        done.runModal()

        NSApplication.shared.terminate(nil)
    }
}
