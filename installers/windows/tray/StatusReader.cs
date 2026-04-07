using System.Text.Json;
using System.Text.Json.Serialization;

namespace TadaimaTray;

public class AgentStatus
{
    [JsonPropertyName("pid")] public int Pid { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("connected")] public bool Connected { get; set; }
    [JsonPropertyName("relay")] public string Relay { get; set; } = "";
    [JsonPropertyName("deviceName")] public string DeviceName { get; set; } = "";
    [JsonPropertyName("activeDownloads")] public int ActiveDownloads { get; set; }
    [JsonPropertyName("lastHeartbeat")] public string LastHeartbeat { get; set; } = "";
    [JsonPropertyName("updateAvailable")] public string? UpdateAvailable { get; set; }
}

public class AgentConfig
{
    [JsonPropertyName("relay")] public string Relay { get; set; } = "";
    [JsonPropertyName("deviceToken")] public string DeviceToken { get; set; } = "";
    [JsonPropertyName("deviceId")] public string DeviceId { get; set; } = "";
    [JsonPropertyName("deviceName")] public string DeviceName { get; set; } = "";
    [JsonPropertyName("directories")] public DirectoriesConfig Directories { get; set; } = new();
    [JsonPropertyName("maxConcurrentDownloads")] public int MaxConcurrentDownloads { get; set; } = 2;
    [JsonPropertyName("rdPollInterval")] public int RdPollInterval { get; set; } = 30;

    public class DirectoriesConfig
    {
        [JsonPropertyName("movies")] public string Movies { get; set; } = "";
        [JsonPropertyName("tv")] public string Tv { get; set; } = "";
        [JsonPropertyName("staging")] public string Staging { get; set; } = "";
    }
}

public static class StatusReader
{
    private static readonly string ConfigDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "tadaima");

    public static string StatusPath => Path.Combine(ConfigDir, "status.json");
    public static string ConfigPath => Path.Combine(ConfigDir, "config.json");
    public static string LogPath => Path.Combine(ConfigDir, "logs", "tadaima.log");
    public static string AgentExePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tadaima", "tadaima-agent.exe");

    public static AgentStatus? ReadStatus()
    {
        try
        {
            if (!File.Exists(StatusPath)) return null;
            var json = File.ReadAllText(StatusPath);
            return JsonSerializer.Deserialize<AgentStatus>(json);
        }
        catch { return null; }
    }

    public static AgentConfig? ReadConfig()
    {
        try
        {
            if (!File.Exists(ConfigPath)) return null;
            var json = File.ReadAllText(ConfigPath);
            return JsonSerializer.Deserialize<AgentConfig>(json);
        }
        catch { return null; }
    }

    public static void WriteConfig(AgentConfig config)
    {
        try
        {
            Directory.CreateDirectory(ConfigDir);
            var json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(ConfigPath, json);
        }
        catch { /* non-fatal */ }
    }

    public static bool IsAgentRunning()
    {
        var status = ReadStatus();
        if (status == null) return false;
        if (DateTime.TryParse(status.LastHeartbeat, out var heartbeat))
            return (DateTime.UtcNow - heartbeat.ToUniversalTime()).TotalSeconds < 30;
        return false;
    }
}
