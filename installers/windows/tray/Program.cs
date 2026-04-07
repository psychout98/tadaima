namespace TadaimaTray;

static class Program
{
    private static NotifyIcon trayIcon = null!;
    private static ToolStripMenuItem statusItem = null!;
    private static ToolStripMenuItem deviceItem = null!;
    private static ToolStripMenuItem relayItem = null!;
    private static ToolStripMenuItem downloadsItem = null!;
    private static ToolStripMenuItem updateItem = null!;
    private static System.Windows.Forms.Timer refreshTimer = null!;

    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        trayIcon = new NotifyIcon
        {
            Text = "Tadaima Agent",
            Icon = SystemIcons.Application, // TODO: replace with custom icon
            Visible = true,
            ContextMenuStrip = BuildMenu()
        };

        refreshTimer = new System.Windows.Forms.Timer { Interval = 5000 };
        refreshTimer.Tick += (_, _) => RefreshStatus();
        refreshTimer.Start();
        RefreshStatus();

        Application.Run();

        trayIcon.Visible = false;
        trayIcon.Dispose();
    }

    private static ContextMenuStrip BuildMenu()
    {
        var menu = new ContextMenuStrip();

        statusItem = new ToolStripMenuItem("Status: Checking...") { Enabled = false };
        menu.Items.Add(statusItem);

        deviceItem = new ToolStripMenuItem("Device: \u2014") { Enabled = false };
        menu.Items.Add(deviceItem);

        relayItem = new ToolStripMenuItem("Relay: \u2014") { Enabled = false };
        menu.Items.Add(relayItem);

        downloadsItem = new ToolStripMenuItem("Downloads: 0") { Enabled = false };
        menu.Items.Add(downloadsItem);

        menu.Items.Add(new ToolStripSeparator());

        updateItem = new ToolStripMenuItem("Check for Updates");
        updateItem.Click += (_, _) => CheckForUpdates();
        menu.Items.Add(updateItem);

        var settingsItem = new ToolStripMenuItem("Settings...");
        settingsItem.Click += (_, _) => OpenSettings();
        menu.Items.Add(settingsItem);

        var logsItem = new ToolStripMenuItem("View Logs");
        logsItem.Click += (_, _) => ViewLogs();
        menu.Items.Add(logsItem);

        menu.Items.Add(new ToolStripSeparator());

        var uninstallItem = new ToolStripMenuItem("Uninstall...");
        uninstallItem.Click += (_, _) => Uninstaller.ConfirmAndUninstall();
        menu.Items.Add(uninstallItem);

        var quitItem = new ToolStripMenuItem("Quit");
        quitItem.Click += (_, _) => Application.Exit();
        menu.Items.Add(quitItem);

        return menu;
    }

    private static void RefreshStatus()
    {
        var status = StatusReader.ReadStatus();
        bool running = StatusReader.IsAgentRunning();

        if (status != null && running)
        {
            string dot = status.Connected ? "\U0001f7e2" : "\U0001f7e1"; // green/yellow circle
            string connStr = status.Connected ? "Connected" : "Reconnecting...";
            statusItem.Text = $"{dot} {connStr} \u2014 v{status.Version}";
            deviceItem.Text = $"Device: {status.DeviceName}";
            relayItem.Text = $"Relay: {status.Relay}";
            downloadsItem.Text = $"Downloads: {status.ActiveDownloads}";

            if (!string.IsNullOrEmpty(status.UpdateAvailable))
            {
                updateItem.Text = $"Update to v{status.UpdateAvailable}";
                trayIcon.ShowBalloonTip(5000, "Tadaima Update",
                    $"Version {status.UpdateAvailable} is available.", ToolTipIcon.Info);
            }
            else
            {
                updateItem.Text = "Check for Updates";
            }
        }
        else
        {
            statusItem.Text = "\U0001f534 Agent Not Running"; // red circle
            deviceItem.Text = "Device: \u2014";
            relayItem.Text = "Relay: \u2014";
            downloadsItem.Text = "Downloads: 0";
            updateItem.Text = "Check for Updates";
        }
    }

    private static void CheckForUpdates()
    {
        RunAgent("update");
    }

    private static void OpenSettings()
    {
        var form = new SettingsForm();
        form.ShowDialog();
    }

    private static void ViewLogs()
    {
        var logPath = StatusReader.LogPath;
        if (File.Exists(logPath))
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = logPath,
                UseShellExecute = true
            });
        else
            MessageBox.Show("Log file not found.", "Tadaima", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static void RunAgent(string args)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = StatusReader.AgentExePath,
                Arguments = args,
                CreateNoWindow = true,
                UseShellExecute = false
            });
        }
        catch { /* non-fatal */ }
    }
}
