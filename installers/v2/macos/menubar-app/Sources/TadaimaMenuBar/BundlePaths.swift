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
