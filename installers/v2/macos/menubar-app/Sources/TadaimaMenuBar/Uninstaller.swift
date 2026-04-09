import Foundation
import AppKit
import ServiceManagement

/// One-click uninstall. Stops the agent, removes the LaunchAgent plist,
/// unregisters the Login Item, moves Tadaima.app to Trash, and — critically
/// — does NOT touch the agent's config directory so a reinstall picks up
/// where the user left off.
enum Uninstaller {
    static func runUninstall() -> Bool {
        // 1. Stop the agent.
        _ = Shell.run(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["bootout", "gui/\(Shell.currentUid())", BundlePaths.launchAgentPlist.path]
        )

        // 2. Delete the LaunchAgent plist file.
        try? FileManager.default.removeItem(at: BundlePaths.launchAgentPlist)

        // 3. Unregister the Login Item via SMAppService. Login Items and
        // LaunchAgents are different mechanisms: the LaunchAgent runs the
        // headless agent, the Login Item launches the menu bar UI on login.
        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.unregister()
        }

        // 4. Move /Applications/Tadaima.app to Trash. The app is still
        // running at this point; the move happens asynchronously and the
        // app quits itself once the user dismisses the confirmation.
        let appURL = Bundle.main.bundleURL
        var trashed: NSURL?
        try? FileManager.default.trashItem(at: appURL, resultingItemURL: &trashed)

        // 5. Intentionally do NOT delete the agent config directory —
        // config.json, status.json, and tadaima.pid are preserved so a
        // reinstall picks up the same device pairing.

        return true
    }
}
