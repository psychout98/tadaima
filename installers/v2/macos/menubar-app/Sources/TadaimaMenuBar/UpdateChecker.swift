import Foundation

/// "Check for Updates" action: queries npm for the latest
/// @psychout98/tadaima version, compares it to the installed version,
/// and if newer offers a one-click update.
enum UpdateChecker {
    struct UpdateInfo {
        let current: String
        let latest: String
    }

    enum CheckError: Error, LocalizedError {
        case npmFailed(String)
        case localVersionFailed(String)
        case parseFailed(String)

        var errorDescription: String? {
            switch self {
            case .npmFailed(let msg): return "npm view failed: \(msg)"
            case .localVersionFailed(let msg): return "tadaima --version failed: \(msg)"
            case .parseFailed(let msg): return "could not parse version: \(msg)"
            }
        }
    }

    static func check() throws -> UpdateInfo? {
        // Ask npm for the latest version. We spawn the bundled Node
        // against the bundled npm-cli.js to avoid depending on a system
        // Node that may not exist.
        let npmResult = Shell.run(
            BundlePaths.nodeBinary,
            [
                BundlePaths.npmCliJs.path,
                "view",
                "@psychout98/tadaima",
                "version",
            ]
        )
        guard npmResult.exitCode == 0 else {
            throw CheckError.npmFailed(npmResult.stderr.isEmpty ? npmResult.stdout : npmResult.stderr)
        }
        let latest = npmResult.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !latest.isEmpty else {
            throw CheckError.parseFailed("empty latest version")
        }

        // Local version: spawn the installed tadaima CLI via the bundled
        // Node. `tadaima --version` prints "tadaima-agent vX.Y.Z", we
        // parse the last whitespace-separated token.
        let localResult = Shell.run(
            BundlePaths.nodeBinary,
            [BundlePaths.agentBinary.path, "--version"]
        )
        guard localResult.exitCode == 0 else {
            throw CheckError.localVersionFailed(
                localResult.stderr.isEmpty ? localResult.stdout : localResult.stderr
            )
        }
        let tokens = localResult.stdout
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
        guard let versionToken = tokens.last else {
            throw CheckError.parseFailed("no version token in: \(localResult.stdout)")
        }
        let current = String(versionToken).replacingOccurrences(of: "v", with: "")

        if compareSemver(current, latest) < 0 {
            return UpdateInfo(current: current, latest: latest)
        }
        return nil
    }

    static func applyUpdate() throws {
        // 1. Stop the agent via launchctl.
        _ = Shell.run(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["bootout", "gui/\(Shell.currentUid())", BundlePaths.launchAgentPlist.path]
        )
        // 2. npm install -g --prefix <agent-prefix> @psychout98/tadaima@latest
        let install = Shell.run(
            BundlePaths.nodeBinary,
            [
                BundlePaths.npmCliJs.path,
                "install",
                "-g",
                "--prefix",
                BundlePaths.agentPrefix.path,
                "@psychout98/tadaima@latest",
            ]
        )
        if install.exitCode != 0 {
            throw CheckError.npmFailed(install.stderr)
        }
        // 3. Bring the agent back up.
        _ = Shell.run(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["bootstrap", "gui/\(Shell.currentUid())", BundlePaths.launchAgentPlist.path]
        )
    }

    /// Very small semver comparator — we only need to decide
    /// "current < latest". Pre-release tags are treated as < the same
    /// base version, which matches npm's behavior well enough for the
    /// tray update flow.
    static func compareSemver(_ a: String, _ b: String) -> Int {
        let (ac, ap) = split(a)
        let (bc, bp) = split(b)
        let maxLen = max(ac.count, bc.count)
        for i in 0..<maxLen {
            let ai = i < ac.count ? ac[i] : 0
            let bi = i < bc.count ? bc[i] : 0
            if ai != bi { return ai < bi ? -1 : 1 }
        }
        if ap == bp { return 0 }
        if ap.isEmpty { return 1 }   // a is release, b is prerelease → a > b
        if bp.isEmpty { return -1 }  // b is release, a is prerelease → a < b
        return ap < bp ? -1 : 1
    }

    private static func split(_ v: String) -> ([Int], String) {
        let parts = v.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let core = String(parts[0]).split(separator: ".").compactMap { Int($0) }
        let pre = parts.count > 1 ? String(parts[1]) : ""
        return (core, pre)
    }
}
