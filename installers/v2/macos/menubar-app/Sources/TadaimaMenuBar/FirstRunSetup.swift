import Foundation
import ServiceManagement

/// Handles first-launch setup when the user opens Tadaima.app for the
/// first time after installation. Replaces the old postinstall script.
///
/// The .pkg installer only copies Tadaima.app to /Applications. All
/// setup — config GUI, launchd registration, login item — happens here
/// in userland (no root privileges required).
enum FirstRunSetup {
    enum SetupError: Error, LocalizedError {
        case configGuiMissing
        case configGuiCancelled
        case plistTemplateMissing
        case plistRenderFailed

        var errorDescription: String? {
            switch self {
            case .configGuiMissing:
                return "TadaimaConfig.app is missing from the application bundle."
            case .configGuiCancelled:
                return "Setup was cancelled. Tadaima needs to be configured before it can run. Relaunch the app to try again."
            case .plistTemplateMissing:
                return "LaunchAgent plist template is missing from the application bundle."
            case .plistRenderFailed:
                return "Failed to write the LaunchAgent plist."
            }
        }
    }

    /// Returns true if first-run setup has not been completed yet.
    /// Checks for the existence of the agent config file.
    static var isNeeded: Bool {
        ConfigPaths.configFile() == nil
    }

    /// Runs the full first-launch setup flow. Call from the main app
    /// when `isNeeded` returns true.
    ///
    /// Steps:
    /// 1. Create the log directory
    /// 2. Launch the config GUI and wait for the user to complete pairing
    /// 3. Render and install the launchd plist
    /// 4. Bootstrap the LaunchAgent
    /// 5. Register as a login item
    static func run() throws {
        // 1. Create log directory (user-owned, no root needed)
        let logDir = BundlePaths.agentLog.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: logDir,
            withIntermediateDirectories: true,
            attributes: nil
        )

        // 2. Launch config GUI and wait for completion
        try launchConfigGUI()

        // 3. Render and install the LaunchAgent plist
        try installLaunchAgent()

        // 4. Bootstrap the LaunchAgent via launchctl
        bootstrapLaunchAgent()

        // 5. Register as login item so the menu bar app starts on login
        registerLoginItem()
    }

    // MARK: - Private

    private static func launchConfigGUI() throws {
        let configApp = BundlePaths.resources
            .appendingPathComponent("TadaimaConfig.app")

        guard FileManager.default.fileExists(atPath: configApp.path) else {
            throw SetupError.configGuiMissing
        }

        // Use /usr/bin/open -W to launch the config app and block until
        // it exits. This runs in the user's GUI session (no root needed).
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        proc.arguments = ["-W", configApp.path]

        try proc.run()
        proc.waitUntilExit()

        guard proc.terminationStatus == 0 else {
            throw SetupError.configGuiCancelled
        }
    }

    private static func installLaunchAgent() throws {
        let templateURL = BundlePaths.resources
            .appendingPathComponent("com.tadaima.agent.plist.template")

        guard FileManager.default.fileExists(atPath: templateURL.path) else {
            throw SetupError.plistTemplateMissing
        }

        let template = try String(contentsOf: templateURL, encoding: .utf8)

        // Substitute placeholders with actual paths.
        // __NODE_BIN__: arch-appropriate bundled Node binary
        // __AGENT_ENTRY__: the installed agent CLI entry point
        // __LOG_PATH__: user's log file path
        let rendered = template
            .replacingOccurrences(of: "__NODE_BIN__", with: BundlePaths.nodeBinary.path)
            .replacingOccurrences(of: "__AGENT_ENTRY__", with: BundlePaths.agentBinary.path)
            .replacingOccurrences(of: "__LOG_PATH__", with: BundlePaths.agentLog.path)

        // Ensure ~/Library/LaunchAgents exists
        let destDir = BundlePaths.launchAgentPlist.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: destDir,
            withIntermediateDirectories: true,
            attributes: nil
        )

        // Write the rendered plist atomically
        try rendered.write(
            to: BundlePaths.launchAgentPlist,
            atomically: true,
            encoding: .utf8
        )
    }

    private static func bootstrapLaunchAgent() {
        let uid = Shell.currentUid()
        let plistPath = BundlePaths.launchAgentPlist.path

        // bootout first in case it's already loaded (e.g. reinstall)
        Shell.run(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["bootout", "gui/\(uid)", plistPath]
        )

        // bootstrap to start the agent
        Shell.run(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["bootstrap", "gui/\(uid)", plistPath]
        )
    }

    private static func registerLoginItem() {
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.register()
        }
    }
}
