import Foundation

// Minimal test runner — no XCTest dependency required, runs as a plain executable.

var passed = 0
var failed = 0

func assert(_ condition: Bool, _ message: String, file: String = #file, line: Int = #line) {
    if condition {
        passed += 1
        print("  PASS: \(message)")
    } else {
        failed += 1
        print("  FAIL: \(message) (\(file):\(line))")
    }
}

func makeTempDir() -> String {
    let dir = NSTemporaryDirectory() + "tadaima-test-\(UUID().uuidString)"
    try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return dir
}

func writeJSON(_ path: String, _ json: String) {
    FileManager.default.createFile(atPath: path, contents: json.data(using: .utf8))
}

// --- Tests ---

func testDefaultConfigDir() {
    print("\n[StatusReader: default config dir]")
    let reader = StatusReader()
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let expected = "\(home)/Library/Preferences/tadaima-nodejs"
    assert(reader.configPath.hasPrefix(expected), "configPath uses ~/Library/Preferences/tadaima-nodejs")
    assert(reader.statusPath.hasPrefix(expected), "statusPath uses ~/Library/Preferences/tadaima-nodejs")
}

func testCustomConfigDir() {
    print("\n[StatusReader: custom config dir]")
    let dir = "/tmp/custom-tadaima"
    let reader = StatusReader(configDir: dir)
    assert(reader.configPath == "\(dir)/config.json", "configPath uses custom dir")
    assert(reader.statusPath == "\(dir)/status.json", "statusPath uses custom dir")
}

func testReadStatusMissing() {
    print("\n[StatusReader: read missing status]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)
    assert(reader.readStatus() == nil, "returns nil when status.json does not exist")
}

func testReadStatusValid() {
    print("\n[StatusReader: read valid status]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    let json = """
    {
      "pid": 12345,
      "version": "0.2.0",
      "connected": true,
      "relay": "https://relay.example.com",
      "deviceName": "macbook",
      "activeDownloads": 3,
      "lastHeartbeat": "2025-01-01T00:00:00.000Z",
      "updateAvailable": "0.3.0"
    }
    """
    writeJSON("\(dir)/status.json", json)

    let status = reader.readStatus()
    assert(status != nil, "parses valid status.json")
    assert(status?.pid == 12345, "pid is correct")
    assert(status?.version == "0.2.0", "version is correct")
    assert(status?.connected == true, "connected is correct")
    assert(status?.relay == "https://relay.example.com", "relay is correct")
    assert(status?.deviceName == "macbook", "deviceName is correct")
    assert(status?.activeDownloads == 3, "activeDownloads is correct")
    assert(status?.updateAvailable == "0.3.0", "updateAvailable is correct")
}

func testReadStatusInvalidJSON() {
    print("\n[StatusReader: read invalid JSON]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    writeJSON("\(dir)/status.json", "not json at all")
    assert(reader.readStatus() == nil, "returns nil for invalid JSON")
}

func testReadStatusNullUpdateAvailable() {
    print("\n[StatusReader: null updateAvailable]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    let json = """
    {
      "pid": 1,
      "version": "0.1.0",
      "connected": false,
      "relay": "https://r.test",
      "deviceName": "test",
      "activeDownloads": 0,
      "lastHeartbeat": "2025-01-01T00:00:00.000Z",
      "updateAvailable": null
    }
    """
    writeJSON("\(dir)/status.json", json)
    let status = reader.readStatus()
    assert(status != nil, "parses status with null updateAvailable")
    assert(status?.updateAvailable == nil, "updateAvailable is nil")
}

func testReadConfigMissing() {
    print("\n[StatusReader: read missing config]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)
    assert(reader.readConfig() == nil, "returns nil when config.json does not exist")
}

func testReadConfigValid() {
    print("\n[StatusReader: read valid config]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    let json = """
    {
      "relay": "https://relay.example.com",
      "deviceToken": "tok123",
      "deviceId": "dev456",
      "deviceName": "macbook",
      "directories": {
        "movies": "/Users/me/Movies",
        "tv": "/Users/me/TV",
        "staging": "/tmp/staging"
      },
      "maxConcurrentDownloads": 3,
      "rdPollInterval": 60
    }
    """
    writeJSON("\(dir)/config.json", json)

    let config = reader.readConfig()
    assert(config != nil, "parses valid config.json")
    assert(config?.relay == "https://relay.example.com", "relay is correct")
    assert(config?.deviceId == "dev456", "deviceId is correct")
    assert(config?.directories.movies == "/Users/me/Movies", "movies dir is correct")
    assert(config?.directories.tv == "/Users/me/TV", "tv dir is correct")
    assert(config?.maxConcurrentDownloads == 3, "maxConcurrentDownloads is correct")
}

func testWriteConfig() {
    print("\n[StatusReader: write config]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    let config = AgentConfig(
        relay: "https://relay.test",
        deviceToken: "t1",
        deviceId: "d1",
        deviceName: "test-mac",
        directories: AgentConfig.Directories(
            movies: "/Movies",
            tv: "/TV",
            staging: "/tmp/s"
        ),
        maxConcurrentDownloads: 5,
        rdPollInterval: 15
    )
    reader.writeConfig(config)

    let readBack = reader.readConfig()
    assert(readBack != nil, "config can be read back after write")
    assert(readBack?.relay == "https://relay.test", "relay roundtrips correctly")
    assert(readBack?.deviceName == "test-mac", "deviceName roundtrips correctly")
    assert(readBack?.maxConcurrentDownloads == 5, "maxConcurrentDownloads roundtrips correctly")
    assert(readBack?.directories.movies == "/Movies", "movies dir roundtrips correctly")
}

func testIsAgentRunningNoStatusFile() {
    print("\n[StatusReader: isAgentRunning — no status file]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)
    assert(reader.isAgentRunning() == false, "returns false when no status file")
}

func testIsAgentRunningStaleHeartbeat() {
    print("\n[StatusReader: isAgentRunning — stale heartbeat]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    // Heartbeat from 2 minutes ago — should be stale
    let staleDate = Date().addingTimeInterval(-120)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let heartbeat = formatter.string(from: staleDate)

    let json = """
    {
      "pid": 999,
      "version": "0.1.0",
      "connected": true,
      "relay": "https://r.test",
      "deviceName": "test",
      "activeDownloads": 0,
      "lastHeartbeat": "\(heartbeat)",
      "updateAvailable": null
    }
    """
    writeJSON("\(dir)/status.json", json)
    assert(reader.isAgentRunning() == false, "returns false when heartbeat is >30s old")
}

func testIsAgentRunningRecentHeartbeat() {
    print("\n[StatusReader: isAgentRunning — recent heartbeat]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    // Heartbeat from 5 seconds ago — should be running
    let recentDate = Date().addingTimeInterval(-5)
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let heartbeat = formatter.string(from: recentDate)

    let json = """
    {
      "pid": 999,
      "version": "0.1.0",
      "connected": true,
      "relay": "https://r.test",
      "deviceName": "test",
      "activeDownloads": 0,
      "lastHeartbeat": "\(heartbeat)",
      "updateAvailable": null
    }
    """
    writeJSON("\(dir)/status.json", json)
    assert(reader.isAgentRunning() == true, "returns true when heartbeat is <30s old")
}

func testIsAgentRunningInvalidHeartbeat() {
    print("\n[StatusReader: isAgentRunning — invalid heartbeat format]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    let json = """
    {
      "pid": 999,
      "version": "0.1.0",
      "connected": true,
      "relay": "https://r.test",
      "deviceName": "test",
      "activeDownloads": 0,
      "lastHeartbeat": "not-a-date",
      "updateAvailable": null
    }
    """
    writeJSON("\(dir)/status.json", json)
    assert(reader.isAgentRunning() == false, "returns false when heartbeat is not parseable")
}

func testLogPath() {
    print("\n[StatusReader: log path]")
    let dir = "/tmp/test-config"
    let reader = StatusReader(configDir: dir)
    assert(reader.logPath == "\(dir)/logs/tadaima.log", "logPath is inside configDir/logs/")
}

func testReadConfigIgnoresExtraFields() {
    print("\n[StatusReader: config ignores extra fields]")
    let dir = makeTempDir()
    defer { try? FileManager.default.removeItem(atPath: dir) }
    let reader = StatusReader(configDir: dir)

    // Config JSON from conf has extra fields the Swift struct doesn't model
    let json = """
    {
      "relay": "https://relay.example.com",
      "deviceToken": "tok",
      "deviceId": "dev",
      "deviceName": "mac",
      "profileName": "default",
      "directories": {
        "movies": "/m",
        "tv": "/t",
        "staging": "/s"
      },
      "realDebrid": { "apiKey": "abc" },
      "maxConcurrentDownloads": 2,
      "rdPollInterval": 30,
      "lastUpdateCheck": "",
      "updateChannel": "stable",
      "previousBinaryPath": ""
    }
    """
    writeJSON("\(dir)/config.json", json)

    let config = reader.readConfig()
    assert(config != nil, "parses config with extra fields (profileName, realDebrid, etc.)")
    assert(config?.relay == "https://relay.example.com", "core fields still parse correctly")
}

// --- Entry point ---

@main
struct TestRunner {
    static func main() {
        print("=== Tadaima Menu Bar App Tests ===")

        testDefaultConfigDir()
        testCustomConfigDir()
        testReadStatusMissing()
        testReadStatusValid()
        testReadStatusInvalidJSON()
        testReadStatusNullUpdateAvailable()
        testReadConfigMissing()
        testReadConfigValid()
        testWriteConfig()
        testIsAgentRunningNoStatusFile()
        testIsAgentRunningStaleHeartbeat()
        testIsAgentRunningRecentHeartbeat()
        testIsAgentRunningInvalidHeartbeat()
        testLogPath()
        testReadConfigIgnoresExtraFields()

        print("\n=== Results: \(passed) passed, \(failed) failed ===")
        exit(failed > 0 ? 1 : 0)
    }
}
