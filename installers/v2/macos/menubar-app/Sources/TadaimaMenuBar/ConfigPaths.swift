import Foundation

/// Resolves the directory where the Tadaima agent stores its configuration
/// files (`config.json`, `status.json`, `tadaima.pid`).
///
/// The agent uses the `conf` npm package under the project name "tadaima",
/// which on macOS writes to `~/Library/Application Support/tadaima/`. We
/// check that location first. For developers running the agent in unusual
/// environments we also accept the XDG-style `$XDG_CONFIG_HOME/tadaima/`
/// and `~/.config/tadaima/` fallbacks — same order the agent tries.
///
/// This mirrors the logic in packages/agent/src/config.ts. If the agent's
/// path resolution ever changes, update both places in lockstep.
enum ConfigPaths {
    /// Returns the first candidate directory that contains a `config.json`,
    /// or `nil` if the agent has never been configured.
    static func existingConfigDirectory() -> URL? {
        for dir in candidateDirectories() {
            let configJson = dir.appendingPathComponent("config.json")
            if FileManager.default.fileExists(atPath: configJson.path) {
                return dir
            }
        }
        return nil
    }

    /// Every candidate directory the agent might use, in the same order the
    /// agent itself tries them. We read from whichever one actually has
    /// `config.json`.
    static func candidateDirectories() -> [URL] {
        var dirs: [URL] = []
        let home = FileManager.default.homeDirectoryForCurrentUser

        // macOS canonical (conf package default on darwin)
        dirs.append(
            home
                .appendingPathComponent("Library")
                .appendingPathComponent("Application Support")
                .appendingPathComponent("tadaima")
        )

        // XDG fallback
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"], !xdg.isEmpty {
            dirs.append(URL(fileURLWithPath: xdg).appendingPathComponent("tadaima"))
        }

        // ~/.config fallback
        dirs.append(
            home
                .appendingPathComponent(".config")
                .appendingPathComponent("tadaima")
        )

        return dirs
    }

    /// The URL of the status.json file, if a config directory has been
    /// found. Returns nil if the agent has never been configured.
    static func statusFile() -> URL? {
        existingConfigDirectory()?.appendingPathComponent("status.json")
    }

    /// The URL of the config.json file, if a config directory has been
    /// found.
    static func configFile() -> URL? {
        existingConfigDirectory()?.appendingPathComponent("config.json")
    }

    /// The URL of the tadaima.pid file, if a config directory has been
    /// found.
    static func pidFile() -> URL? {
        existingConfigDirectory()?.appendingPathComponent("tadaima.pid")
    }
}
