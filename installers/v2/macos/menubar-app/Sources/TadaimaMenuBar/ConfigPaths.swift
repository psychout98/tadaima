import Foundation

/// Resolves the directory where the Tadaima agent stores its configuration
/// files (`config.json`, `status.json`, `tadaima.pid`).
///
/// The agent uses the `conf` npm package (v15) under the project name
/// "tadaima", which on macOS resolves via env-paths to
/// `~/Library/Preferences/tadaima-nodejs/`. We check that location first.
/// For developers running the agent in unusual
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

        // macOS canonical (conf@15 default on darwin: env-paths "config" + suffix "nodejs")
        dirs.append(
            home
                .appendingPathComponent("Library")
                .appendingPathComponent("Preferences")
                .appendingPathComponent("tadaima-nodejs")
        )

        // XDG fallback (matches env-paths linux behavior with suffix)
        if let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"], !xdg.isEmpty {
            dirs.append(URL(fileURLWithPath: xdg).appendingPathComponent("tadaima-nodejs"))
        }

        // ~/.config fallback
        dirs.append(
            home
                .appendingPathComponent(".config")
                .appendingPathComponent("tadaima-nodejs")
        )

        // Legacy: check old path in case a pre-fix install wrote config here.
        // This lets existing users upgrade without re-pairing.
        dirs.append(
            home
                .appendingPathComponent("Library")
                .appendingPathComponent("Application Support")
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
