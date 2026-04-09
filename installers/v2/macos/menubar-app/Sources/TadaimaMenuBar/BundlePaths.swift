import Foundation

/// Absolute paths to the bundled Node runtime and the installed agent,
/// computed from the running app's own bundle URL so the tray app does not
/// hardcode `/Applications/Tadaima.app`.
enum BundlePaths {
    /// `Tadaima.app/Contents/Resources`
    static var resources: URL {
        Bundle.main.resourceURL ?? Bundle.main.bundleURL.appendingPathComponent("Contents/Resources")
    }

    /// `Contents/Resources/runtime/bin/node`
    ///
    /// The postinstall script creates `runtime` as a symlink to either
    /// `runtime-arm64` or `runtime-x64` depending on the installing
    /// machine, so this path always resolves to the correct architecture.
    static var nodeBinary: URL {
        resources
            .appendingPathComponent("runtime")
            .appendingPathComponent("bin")
            .appendingPathComponent("node")
    }

    /// `Contents/Resources/runtime/lib/node_modules/npm/bin/npm-cli.js`
    static var npmCliJs: URL {
        resources
            .appendingPathComponent("runtime")
            .appendingPathComponent("lib")
            .appendingPathComponent("node_modules")
            .appendingPathComponent("npm")
            .appendingPathComponent("bin")
            .appendingPathComponent("npm-cli.js")
    }

    /// Prefix used for the `npm install -g --prefix …` call. The installed
    /// agent ends up at `<prefix>/bin/tadaima`.
    static var agentPrefix: URL {
        resources.appendingPathComponent("agent")
    }

    /// Absolute path to the installed `tadaima` entry point.
    static var agentBinary: URL {
        agentPrefix.appendingPathComponent("bin").appendingPathComponent("tadaima")
    }

    /// User LaunchAgent plist path.
    static var launchAgentPlist: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("LaunchAgents")
            .appendingPathComponent("com.tadaima.agent.plist")
    }

    /// Agent log file path (matches the plist template's StandardOutPath).
    static var agentLog: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Logs")
            .appendingPathComponent("Tadaima")
            .appendingPathComponent("agent.log")
    }
}
