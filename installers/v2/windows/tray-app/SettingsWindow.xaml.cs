using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Microsoft.UI.Xaml;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Tadaima.Tray;

public sealed partial class SettingsWindow : Window
{
    private Dictionary<string, object?> _config = new();
    private string _originalRelay = "";

    public SettingsWindow()
    {
        this.InitializeComponent();
        LoadConfig();
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(BundlePaths.ConfigJson))
            {
                StatusText.Text = "config.json not found — run setup first.";
                return;
            }
            using var doc = JsonDocument.Parse(File.ReadAllText(BundlePaths.ConfigJson));
            _config = JsonUtil.ElementToDictionary(doc.RootElement);

            RelayUrlBox.Text = _config.TryGetValue("relay", out var r) ? r?.ToString() ?? "" : "";
            _originalRelay = RelayUrlBox.Text;

            if (_config.TryGetValue("directories", out var d) && d is Dictionary<string, object?> dirs)
            {
                MoviesDirBox.Text = dirs.TryGetValue("movies", out var m) ? m?.ToString() ?? "" : "";
                TvDirBox.Text = dirs.TryGetValue("tv", out var t) ? t?.ToString() ?? "" : "";
            }
            MaxDownloadsBox.Value = _config.TryGetValue("maxConcurrentDownloads", out var mc) && mc is not null
                ? Convert.ToDouble(mc)
                : 2;
            StartOnLoginToggle.IsOn = true;
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
        }
    }

    private async void OnChooseMovies(object sender, RoutedEventArgs e)
    {
        MoviesDirBox.Text = await PickFolderAsync() ?? MoviesDirBox.Text;
    }

    private async void OnChooseTv(object sender, RoutedEventArgs e)
    {
        TvDirBox.Text = await PickFolderAsync() ?? TvDirBox.Text;
    }

    private async System.Threading.Tasks.Task<string?> PickFolderAsync()
    {
        var picker = new FolderPicker
        {
            SuggestedStartLocation = PickerLocationId.VideosLibrary,
        };
        picker.FileTypeFilter.Add("*");
        var hwnd = WindowNative.GetWindowHandle(this);
        InitializeWithWindow.Initialize(picker, hwnd);
        var folder = await picker.PickSingleFolderAsync();
        return folder?.Path;
    }

    private void OnSave(object sender, RoutedEventArgs e)
    {
        try
        {
            _config["relay"] = RelayUrlBox.Text;

            var dirs = (_config.TryGetValue("directories", out var d) && d is Dictionary<string, object?> existing)
                ? existing
                : new Dictionary<string, object?>();
            dirs["movies"] = MoviesDirBox.Text;
            dirs["tv"] = TvDirBox.Text;
            _config["directories"] = dirs;

            _config["maxConcurrentDownloads"] = (int)MaxDownloadsBox.Value;

            var tmp = BundlePaths.ConfigJson + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_config, new JsonSerializerOptions { WriteIndented = true }));
            if (File.Exists(BundlePaths.ConfigJson)) File.Delete(BundlePaths.ConfigJson);
            File.Move(tmp, BundlePaths.ConfigJson);

            StatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Green);
            StatusText.Text = "Saved.";

            // If the relay URL changed, stop the task so Task Scheduler
            // relaunches the agent with the new config.
            if (!string.Equals(_originalRelay, RelayUrlBox.Text, StringComparison.Ordinal))
            {
                Shell.Run("schtasks.exe", new[] { "/End", "/TN", "Tadaima Agent" });
                Shell.Run("schtasks.exe", new[] { "/Run", "/TN", "Tadaima Agent" });
                _originalRelay = RelayUrlBox.Text;
            }
        }
        catch (Exception ex)
        {
            StatusText.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Red);
            StatusText.Text = ex.Message;
        }
    }
}

internal static class JsonUtil
{
    public static Dictionary<string, object?> ElementToDictionary(JsonElement el)
    {
        var dict = new Dictionary<string, object?>();
        if (el.ValueKind != JsonValueKind.Object) return dict;
        foreach (var prop in el.EnumerateObject()) dict[prop.Name] = ElementToObject(prop.Value);
        return dict;
    }

    private static object? ElementToObject(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Object => ElementToDictionary(el),
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
        foreach (var item in el.EnumerateArray()) list.Add(ElementToObject(item));
        return list;
    }
}
