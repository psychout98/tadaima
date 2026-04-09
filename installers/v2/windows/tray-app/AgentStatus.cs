using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Tadaima.Tray;

/// <summary>
/// Mirror of the <c>AgentStatus</c> interface in
/// <c>packages/agent/src/status-file.ts</c>. Changing field names or types
/// here must be done in lockstep with the agent module.
/// </summary>
internal sealed class AgentStatus
{
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("pid")] public int Pid { get; set; }
    [JsonPropertyName("connected")] public bool Connected { get; set; }
    [JsonPropertyName("relayUrl")] public string RelayUrl { get; set; } = "";
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = "";
    [JsonPropertyName("deviceName")] public string DeviceName { get; set; } = "";
    [JsonPropertyName("activeDownloads")] public int ActiveDownloads { get; set; }
    [JsonPropertyName("lastHeartbeat")] public string LastHeartbeat { get; set; } = "";
}

internal enum AgentHealth
{
    Connected,
    Disconnected,
    Stale,
}

internal sealed record AgentSnapshot(AgentStatus? Status, AgentHealth Health);

internal sealed class TrayConfig
{
    [JsonPropertyName("statusHeartbeatIntervalMs")]
    public int StatusHeartbeatIntervalMs { get; set; } = 10_000;

    public TimeSpan StaleAfter => TimeSpan.FromMilliseconds(StatusHeartbeatIntervalMs * 3);

    public static TrayConfig Load()
    {
        try
        {
            if (File.Exists(BundlePaths.TrayConfigJson))
            {
                var json = File.ReadAllText(BundlePaths.TrayConfigJson);
                return JsonSerializer.Deserialize<TrayConfig>(json) ?? new TrayConfig();
            }
        }
        catch
        {
            // Fall through to default.
        }
        return new TrayConfig();
    }
}
