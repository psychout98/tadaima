namespace TadaimaTray;

public class SettingsForm : Form
{
    private TextBox relayField = null!;
    private TextBox moviesField = null!;
    private TextBox tvField = null!;
    private NumericUpDown concurrentField = null!;
    private CheckBox startOnLoginCheckbox = null!;

    public SettingsForm()
    {
        Text = "Tadaima Agent Settings";
        Size = new Size(500, 320);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BuildUI();
        LoadConfig();
    }

    private void BuildUI()
    {
        var labels = new[] { "Relay URL:", "Movies Folder:", "TV Shows Folder:", "Concurrent Downloads:" };
        int y = 20;

        for (int i = 0; i < labels.Length; i++)
        {
            var lbl = new Label { Text = labels[i], Location = new Point(20, y + 3), AutoSize = true };
            Controls.Add(lbl);

            switch (i)
            {
                case 0:
                    relayField = new TextBox { Location = new Point(170, y), Width = 280 };
                    Controls.Add(relayField);
                    break;
                case 1:
                    moviesField = new TextBox { Location = new Point(170, y), Width = 220 };
                    Controls.Add(moviesField);
                    AddBrowseButton(y, moviesField);
                    break;
                case 2:
                    tvField = new TextBox { Location = new Point(170, y), Width = 220 };
                    Controls.Add(tvField);
                    AddBrowseButton(y, tvField);
                    break;
                case 3:
                    concurrentField = new NumericUpDown
                    {
                        Location = new Point(170, y), Width = 60,
                        Minimum = 1, Maximum = 10, Value = 2
                    };
                    Controls.Add(concurrentField);
                    break;
            }
            y += 35;
        }

        startOnLoginCheckbox = new CheckBox
        {
            Text = "Start on login",
            Location = new Point(170, y),
            AutoSize = true,
            Checked = IsStartupEnabled()
        };
        Controls.Add(startOnLoginCheckbox);

        y += 40;

        var saveBtn = new Button { Text = "Save", Location = new Point(360, y), Width = 80 };
        saveBtn.Click += (_, _) => Save();
        Controls.Add(saveBtn);

        var cancelBtn = new Button { Text = "Cancel", Location = new Point(270, y), Width = 80 };
        cancelBtn.Click += (_, _) => Close();
        Controls.Add(cancelBtn);

        AcceptButton = saveBtn;
    }

    private void AddBrowseButton(int y, TextBox target)
    {
        var btn = new Button { Text = "Browse...", Location = new Point(400, y), Width = 70 };
        btn.Click += (_, _) =>
        {
            using var dlg = new FolderBrowserDialog();
            if (dlg.ShowDialog() == DialogResult.OK)
                target.Text = dlg.SelectedPath;
        };
        Controls.Add(btn);
    }

    private void LoadConfig()
    {
        var config = StatusReader.ReadConfig();
        if (config == null) return;
        relayField.Text = config.Relay;
        moviesField.Text = config.Directories.Movies;
        tvField.Text = config.Directories.Tv;
        concurrentField.Value = Math.Clamp(config.MaxConcurrentDownloads, 1, 10);
    }

    private void Save()
    {
        var config = StatusReader.ReadConfig() ?? new AgentConfig();
        config.Relay = relayField.Text;
        config.Directories.Movies = moviesField.Text;
        config.Directories.Tv = tvField.Text;
        config.MaxConcurrentDownloads = (int)concurrentField.Value;
        StatusReader.WriteConfig(config);

        // Toggle startup
        if (startOnLoginCheckbox.Checked && !IsStartupEnabled())
            RunAgent("install-service");
        else if (!startOnLoginCheckbox.Checked && IsStartupEnabled())
            RunAgent("uninstall-service");

        Close();
    }

    private static bool IsStartupEnabled()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", false);
            return key?.GetValue("TadaimaAgent") != null;
        }
        catch { return false; }
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
