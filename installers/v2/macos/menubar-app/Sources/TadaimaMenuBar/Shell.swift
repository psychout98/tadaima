import Foundation

/// Synchronous shell helpers for spawning the bundled Node runtime and
/// `launchctl`. These are used by the update + uninstall flows.
enum Shell {
    struct Result {
        let exitCode: Int32
        let stdout: String
        let stderr: String
    }

    @discardableResult
    static func run(_ executable: URL, _ args: [String]) -> Result {
        let p = Process()
        p.executableURL = executable
        p.arguments = args

        let outPipe = Pipe()
        let errPipe = Pipe()
        p.standardOutput = outPipe
        p.standardError = errPipe

        do {
            try p.run()
        } catch {
            return Result(exitCode: -1, stdout: "", stderr: "failed to launch: \(error)")
        }
        p.waitUntilExit()

        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        return Result(
            exitCode: p.terminationStatus,
            stdout: String(data: outData, encoding: .utf8) ?? "",
            stderr: String(data: errData, encoding: .utf8) ?? ""
        )
    }

    /// Returns the current user's numeric uid as a String (for
    /// `launchctl bootstrap gui/<uid>` targets).
    static func currentUid() -> String {
        String(getuid())
    }
}
