import Foundation
import ServiceManagement

/// Handles first-launch setup when the user opens Tadaima.app for the
/// first time after installation. Replaces the old postinstall script.
///
/// The .pkg installer only copies Tadaima.app to /Applications (read-only,
/// root-owned). All mutable data lives in user-writable locations:
///   - Agent install: ~/Library/Application Support/tadaima/agent/
///   - Config:        ~/Library/Preferences/tadaima-nodejs/
///   - LaunchAgent:   ~/Library/LaunchAgents/com.tadaima.agent.plist
///   - Logs:          ~/Library/Logs/Tadaima/
enum FirstRunSetup {
    enum SetupError: Error, LocalizedError {
        case configGuiMissing
        case configGuiCancelled
        case plistTemplateMissing
        case agentCopyFailed(String)

        var errorDescription: String? {
            switch self {
            case .configGuiMissing:
                return "TadaimaConfig.app is missing from the application bundle."
            case .configGuiCancelled:
                return "Setup was cancelled. Relaunch the app to try again."
            case .plistTemplateMissing:
                return "LaunchAgent plist template is missing from the application bundle."
            case .agentCopyFailed(let detail):
                return "Failed to install agent: \(detail)"
            }
        }
    }

    /// Returns true if first-run setup has not been completed yet.
    /// Checks for config file, user-writable agent binary, AND launchd plist.
    /// All three must exist for setup to be considered complete.
    static var isNeeded: Bool {
        let fm = FileManager.default
        let configExists = ConfigPaths.configFile() != nil
        let agentExists = fm.fileExists(atPath: BundlePaths.agentBinary.path)
        let plistExists = fm.fileExists(atPath: BundlePaths.launchAgentPlist.path)
        return !configExists || !agentExists || !plistExists
    }

    /// Runs the full first-launch setup flow.
    ///
    /// Steps:
    /// 1. Copy the bundled agent to the user-writable location
    /// 2. Create the log directory
    /// 3. Launch the config GUI and wait for the user to complete pairing
    /// 4. Render and install the launchd plist
    /// 5. Bootstrap the LaunchAgent
    /// 6. Register as a login item
    static func run() throws {
        // 1. Copy bundled agent to user-writable location
        try installAgentFromBundle()

        // 2. Create log directory (user-owned, no root needed)
        let logDir = BundlePaths.agentLog.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: logDir,
            withIntermediateDirectories: true,
            attributes: nil
        )

        // 3. Launch config GUI and wait for completion (skip if already configured)
        if ConfigPaths.configFile() == nil {
            try launchConfigGUI()
        }

        // 4. Render and install the LaunchAgent plist
        try installLaunchAgent()

        // 5. Bootstrap the LaunchAgent via launchctl
        bootstrapLaunchAgent()

        // 6. Register as login item so the menu bar app starts on login
        registerLoginItem()
    }

    // MARK: - Private

    /// Copies the pre-installed agent from the read-only app bundle to the
    /// user-writable location at ~/Library/Application Support/tadaima/agent/.
    /// If the destination already exists, it is replaced (handles upgrades).
    private static func installAgentFromBundle() throws {
        let fm = FileManager.default
        let source = BundlePaths.bundledAgentPrefix
        let dest = BundlePaths.agentPrefix

        guard fm.fileExists(atPath: source.path) else {
            throw SetupError.agentCopyFailed("Bundled agent not found at \(source.path)")
        }

        // Create parent directory
        try fm.createDirectory(
            at: dest.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: nil
        )

        // Remove existing agent if present (clean slate for upgrades)
        if fm.fileExists(atPath: dest.path) {
            try fm.removeItem(at: dest)
        }

        // Copy the entire agent directory tree
        try fm.copyItem(at: source, to: dest)

        // Verify the binary landed
        guard fm.fileExists(atPath: BundlePaths.agentBinary.path) else {
            throw SetupError.agentCopyFailed("Agent binary missing after copy")
        }
    }

    private static func launchConfigGUI() throws {
        let configApp = BundlePaths.resources
            .appendingPathComponent("TadaimaConfig.app")

        guard FileManager.default.fileExists(atPath: configApp.path) else {
            throw SetupError.configGuiMissing
        }

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
