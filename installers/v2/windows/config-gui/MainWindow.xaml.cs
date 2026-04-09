using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Tadaima.Config;

public sealed partial class MainWindow : Window
{
    private static readonly HttpClient Http = new();

    public MainWindow()
    {
        this.InitializeComponent();
        // Default the relay URL so the text field isn't empty; the user
        // must still replace it with their actual URL.
        RelayUrlBox.Text = "https://";
    }

    private async void OnChooseMovies(object sender, RoutedEventArgs e)
    {
        MoviesDirBox.Text = await PickFolderAsync() ?? MoviesDirBox.Text;
    }

    private async void OnChooseTv(object sender, RoutedEventArgs e)
    {
        TvDirBox.Text = await PickFolderAsync() ?? TvDirBox.Text;
    }

    private async Task<string?> PickFolderAsync()
    {
        var picker = new FolderPicker
        {
            SuggestedStartLocation = PickerLocationId.VideosLibrary,
        };
        picker.FileTypeFilter.Add("*");
        // WinUI 3 file pickers need the window handle.
        var hwnd = WindowNative.GetWindowHandle(this);
        InitializeWithWindow.Initialize(picker, hwnd);
        var folder = await picker.PickSingleFolderAsync();
        return folder?.Path;
    }

    private async void OnPair(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "";
        PairButton.IsEnabled = false;
        try
        {
            var relay = RelayUrlBox.Text?.Trim().TrimEnd('/') ?? "";
            var code = (PairingCodeBox.Text ?? "").Trim().ToUpperInvariant();
            var movies = MoviesDirBox.Text?.Trim() ?? "";
            var tv = TvDirBox.Text?.Trim() ?? "";

            if (string.IsNullOrEmpty(relay) || code.Length != 6 ||
                string.IsNullOrEmpty(movies) || string.IsNullOrEmpty(tv))
            {
                StatusText.Text = "Fill in all fields; the pairing code must be 6 characters.";
                return;
            }

            // POST /api/devices/pair/claim with { code, name, platform }.
            // Response: { deviceId, deviceToken, rdApiKey, wsUrl }.
            // Shape must match packages/agent/src/setup.ts exactly.
            var deviceName = Environment.MachineName;
            var body = new Dictionary<string, object>
            {
                ["code"] = code,
                ["name"] = deviceName,
                ["platform"] = "win32",
            };
            using var resp = await Http.PostAsJsonAsync($"{relay}/api/devices/pair/claim", body);
            if (!resp.IsSuccessStatusCode)
            {
                var detail = await resp.Content.ReadAsStringAsync();
                StatusText.Text = $"Relay returned HTTP {(int)resp.StatusCode}: {detail}";
                return;
            }
            var claim = await resp.Content.ReadFromJsonAsync<PairResponse>();
            if (claim is null)
            {
                StatusText.Text = "Relay returned an empty response.";
                return;
            }

            AgentConfigWriter.Write(relay, claim, deviceName, movies, tv);

            StatusText.Text = "";
            // Exit 0 — the MSI custom action waits for this and then
            // proceeds to register the scheduled task.
            Application.Current.Exit();
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
        }
        finally
        {
            PairButton.IsEnabled = true;
        }
    }

    private sealed class PairResponse
    {
        public string? deviceId { get; set; }
        public string? deviceToken { get; set; }
        public string? rdApiKey { get; set; }
        public string? wsUrl { get; set; }
    }

    /// <summary>
    /// Writes (or merges into) the agent's config.json in the canonical
    /// per-user location Node's `conf` package uses on Windows.
    /// </summary>
    private static class AgentConfigWriter
    {
        public static string ConfigPath()
        {
            // conf on Windows uses %APPDATA%\tadaima\config.json via the
            // env-paths package. AppData\Roaming is Environment.SpecialFolder.ApplicationData.
            var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            return Path.Combine(roaming, "tadaima", "config.json");
        }

        public static void Write(string relay, PairResponse claim, string deviceName, string movies, string tv)
        {
            var path = ConfigPath();
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);

            Dictionary<string, object?> json;
            if (File.Exists(path))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                json = JsonElementToDictionary(doc.RootElement);
            }
            else
            {
                json = new Dictionary<string, object?>();
            }

            json["relay"] = relay;
            json["deviceId"] = claim.deviceId ?? "";
            json["deviceToken"] = claim.deviceToken ?? "";
            json["deviceName"] = deviceName;

            var dirs = (json.TryGetValue("directories", out var d) && d is Dictionary<string, object?> existing)
                ? existing
                : new Dictionary<string, object?>();
            dirs["movies"] = movies;
            dirs["tv"] = tv;
            if (!dirs.ContainsKey("staging"))
            {
                dirs["staging"] = Path.Combine(Path.GetTempPath(), "tadaima", "staging");
            }
            json["directories"] = dirs;

            if (!json.ContainsKey("realDebrid"))
            {
                json["realDebrid"] = new Dictionary<string, object?> { ["apiKey"] = claim.rdApiKey ?? "" };
            }
            if (!json.ContainsKey("maxConcurrentDownloads")) json["maxConcurrentDownloads"] = 2;
            if (!json.ContainsKey("rdPollInterval")) json["rdPollInterval"] = 30;
            if (!json.ContainsKey("updateChannel")) json["updateChannel"] = "stable";

            var options = new JsonSerializerOptions { WriteIndented = true };
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(json, options));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        private static Dictionary<string, object?> JsonElementToDictionary(JsonElement el)
        {
            var dict = new Dictionary<string, object?>();
            foreach (var prop in el.EnumerateObject())
            {
                dict[prop.Name] = JsonElementToObject(prop.Value);
            }
            return dict;
        }

        private static object? JsonElementToObject(JsonElement el) => el.ValueKind switch
        {
            JsonValueKind.Object => JsonElementToDictionary(el),
            JsonValueKind.Array => ArrayToList(el),
            JsonValueKind.String => el.GetString(),
            JsonValueKind.Number => el.TryGetInt64(out var n) ? (object)n : el.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => el.ToString(),
        };

        private static List<object?> ArrayToList(JsonElement el)
        {
            var list = new List<object?>();
            foreach (var item in el.EnumerateArray()) list.Add(JsonElementToObject(item));
            return list;
        }
    }
}
