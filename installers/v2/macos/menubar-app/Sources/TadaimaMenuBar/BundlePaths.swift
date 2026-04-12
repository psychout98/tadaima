import Foundation

/// Absolute paths to the bundled Node runtime and the installed agent,
/// computed from the running app's own bundle URL so the tray app does not
/// hardcode `/Applications/Tadaima.app`.
enum BundlePaths {
    /// `Tadaima.app/Contents/Resources`
    static var resources: URL {
        Bundle.main.resourceURL ?? Bundle.main.bundleURL.appendingPathComponent("Contents/Resources")
    }

    /// The runtime directory name for the current machine's architecture.
    /// Both `runtime-arm64` and `runtime-x64` are embedded in the bundle;
    /// this picks the right one at runtime so no symlink is needed.
    static var runtimeDirectoryName: String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) {
                String(cString: $0)
            }
        }
        return machine == "arm64" ? "runtime-arm64" : "runtime-x64"
    }

    /// `Contents/Resources/runtime-{arch}/bin/node`
    static var nodeBinary: URL {
        resources
            .appendingPathComponent(runtimeDirectoryName)
            .appendingPathComponent("bin")
            .appendingPathComponent("node")
    }

    /// `Contents/Resources/runtime-{arch}/lib/node_modules/npm/bin/npm-cli.js`
    static var npmCliJs: URL {
        resources
            .appendingPathComponent(runtimeDirectoryName)
            .appendingPathComponent("lib")
            .appendingPathComponent("node_modules")
            .appendingPathComponent("npm")
            .appendingPathComponent("bin")
            .appendingPathComponent("npm-cli.js")
    }

    // MARK: - Bundled agent (read-only, factory default inside app bundle)

    /// The pre-installed agent inside the signed app bundle. This is the
    /// factory default installed at build time. It is read-only because
    /// the bundle is root-owned after pkg installation.
    static var bundledAgentPrefix: URL {
        resources.appendingPathComponent("agent")
    }

    // MARK: - User-writable agent (for updates and runtime use)

    /// User-writable support directory for mutable Tadaima data.
    /// `~/Library/Application Support/tadaima/`
    static var supportDir: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("tadaima")
    }

    /// User-writable agent prefix. First-run setup copies the bundled
    /// agent here; updates write here too. The launchd plist and all
    /// runtime references use this location.
    static var agentPrefix: URL {
        supportDir.appendingPathComponent("agent")
    }

    /// Absolute path to the user-writable `tadaima` entry point.
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
