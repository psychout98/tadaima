using System.Diagnostics;

namespace TadaimaTray;

public static class Uninstaller
{
    public static void ConfirmAndUninstall()
    {
        var result = MessageBox.Show(
            "This will stop the agent, remove the Windows Service, and delete the binary.\n\nYour configuration will be preserved.",
            "Uninstall Tadaima Agent?",
            MessageBoxButtons.OKCancel,
            MessageBoxIcon.Warning);

        if (result != DialogResult.OK) return;

        // Stop and delete the service
        RunCommand("sc", "stop TadaimaAgent");
        RunCommand("sc", "delete TadaimaAgent");

        // Remove binary
        try
        {
            var installDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tadaima");
            if (Directory.Exists(installDir))
                Directory.Delete(installDir, true);
        }
        catch { /* may need admin */ }

        // Remove startup registry entry
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", true);
            key?.DeleteValue("TadaimaAgent", false);
        }
        catch { /* non-fatal */ }

        // Remove status file
        try
        {
            var statusPath = StatusReader.StatusPath;
            if (File.Exists(statusPath)) File.Delete(statusPath);
        }
        catch { /* non-fatal */ }

        MessageBox.Show(
            "The Tadaima Agent has been removed.\n\nYour configuration in %APPDATA%\\tadaima\\ has been preserved.",
            "Uninstall Complete",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);

        Application.Exit();
    }

    private static void RunCommand(string fileName, string arguments)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                CreateNoWindow = true,
                UseShellExecute = false
            };
            Process.Start(psi)?.WaitForExit(5000);
        }
        catch { /* non-fatal */ }
    }
}
