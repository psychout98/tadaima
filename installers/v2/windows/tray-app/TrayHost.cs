using System;
using System.Diagnostics;
using System.Threading.Tasks;
using H.NotifyIcon;
using H.NotifyIcon.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;

namespace Tadaima.Tray;

/// <summary>
/// Owns the tray icon, the status poller, and the popup context menu.
/// Instantiated once from <see cref="App.OnLaunched"/>.
/// </summary>
internal sealed class TrayHost
{
    private readonly TrayConfig _cfg;
    private readonly StatusPoller _poller;
    private TaskbarIcon? _icon;

    public TrayHost()
    {
        _cfg = TrayConfig.Load();
        _poller = new StatusPoller(_cfg);
        _poller.Changed += OnSnapshotChanged;
    }

    public void Start()
    {
        _icon = new TaskbarIcon
        {
            ToolTipText = "Tadaima",
            IconSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(
                new Uri("ms-appx:///Assets/tray-gray.ico", UriKind.Absolute)),
            ContextFlyout = BuildMenu(),
        };
        _icon.ForceCreate();
        _poller.Start();
    }

    private MenuFlyout BuildMenu()
    {
        var menu = new MenuFlyout();

        var header = new MenuFlyoutItem { Text = "Tadaima", IsEnabled = false };
        menu.Items.Add(header);
        menu.Items.Add(new MenuFlyoutSeparator());

        var settings = new MenuFlyoutItem { Text = "Settings…" };
        settings.Click += (_, _) => OpenSettings();
        menu.Items.Add(settings);

        var update = new MenuFlyoutItem { Text = "Check for Updates" };
        update.Click += (_, _) => CheckForUpdates();
        menu.Items.Add(update);

        var logs = new MenuFlyoutItem { Text = "View Logs…" };
        logs.Click += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo(BundlePaths.AgentLog) { UseShellExecute = true }); }
            catch { /* file may not exist yet */ }
        };
        menu.Items.Add(logs);

        menu.Items.Add(new MenuFlyoutSeparator());

        var uninstall = new MenuFlyoutItem { Text = "Uninstall Tadaima…" };
        uninstall.Click += (_, _) => RunUninstall();
        menu.Items.Add(uninstall);

        menu.Items.Add(new MenuFlyoutSeparator());

        var quit = new MenuFlyoutItem { Text = "Quit" };
        quit.Click += (_, _) => Application.Current.Exit();
        menu.Items.Add(quit);

        return menu;
    }

    private void OnSnapshotChanged(AgentSnapshot snap)
    {
        if (_icon is null) return;
        // WinUI 3 requires UI updates on the dispatcher thread.
        _icon.DispatcherQueue.TryEnqueue(() =>
        {
            var iconName = snap.Health switch
            {
                AgentHealth.Connected => "tray-green.ico",
                AgentHealth.Disconnected => "tray-red.ico",
                _ => "tray-gray.ico",
            };
            _icon.IconSource = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(
                new Uri($"ms-appx:///Assets/{iconName}", UriKind.Absolute));

            var device = snap.Status?.DeviceName ?? "Tadaima";
            var state = snap.Health switch
            {
                AgentHealth.Connected => "Connected",
                AgentHealth.Disconnected => "Disconnected",
                _ => "No heartbeat",
            };
            _icon.ToolTipText = $"{device} — {state}";
        });
    }

    private void OpenSettings()
    {
        var window = new SettingsWindow();
        window.Activate();
    }

    private async void CheckForUpdates()
    {
        try
        {
            var info = await Task.Run(() => UpdateChecker.Check());
            if (info is null)
            {
                await ShowDialog("Tadaima", "You are up to date.");
                return;
            }
            var result = await ShowYesNoDialog(
                "Tadaima",
                $"Version {info.Value.Latest} is available (you have {info.Value.Current}). Update now?");
            if (!result) return;

            await Task.Run(UpdateChecker.Apply);
            await ShowDialog("Tadaima", $"Updated to {info.Value.Latest}.");
        }
        catch (Exception ex)
        {
            await ShowDialog("Tadaima", $"Update failed: {ex.Message}");
        }
    }

    private async void RunUninstall()
    {
        var confirm = await ShowYesNoDialog(
            "Uninstall Tadaima?",
            "This will stop the agent and remove Tadaima from your system. Your media files and configuration will be kept.");
        if (!confirm) return;

        Uninstaller.Run();
        Application.Current.Exit();
    }

    private static Task ShowDialog(string title, string body)
    {
        // WinUI 3 ContentDialog needs an XamlRoot; we grab the primary
        // window's root. For brevity we show a message box via
        // MessageBox.Show on the UI thread.
        return Task.Run(() =>
        {
            _ = MessageBoxUtil.Show(title, body, yesNo: false);
        });
    }

    private static Task<bool> ShowYesNoDialog(string title, string body)
    {
        return Task.Run(() => MessageBoxUtil.Show(title, body, yesNo: true));
    }
}
