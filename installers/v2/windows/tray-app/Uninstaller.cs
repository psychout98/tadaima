using System;
using System.IO;
using Microsoft.Win32;

namespace Tadaima.Tray;

/// <summary>
/// One-click uninstall. Stops the scheduled task, deletes it, removes
/// the tray app's Run-key startup entry, removes the install directory,
/// and — importantly — preserves the agent config directory so a
/// reinstall picks up the same device pairing.
/// </summary>
internal static class Uninstaller
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunKeyValue = "TadaimaTray";

    public static void Run()
    {
        // 1. Stop + delete the scheduled task.
        Shell.Run("schtasks.exe", new[] { "/End", "/TN", "Tadaima Agent" });
        Shell.Run("schtasks.exe", new[] { "/Delete", "/TN", "Tadaima Agent", "/F" });

        // 2. Remove the tray app's own startup entry.
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            key?.DeleteValue(RunKeyValue, throwOnMissingValue: false);
        }
        catch
        {
            // non-fatal
        }

        // 3. Remove the install directory. Requires elevation; if we
        // are not elevated, the tray app should relaunch itself with
        // `runas` — that is handled by the caller before invoking
        // this method.
        try
        {
            var installDir = BundlePaths.InstallDir;
            if (Directory.Exists(installDir))
            {
                Directory.Delete(installDir, recursive: true);
            }
        }
        catch
        {
            // Leave any files we cannot delete; the scheduled task is
            // gone and the agent will no longer run regardless.
        }

        // 4. Do NOT delete the agent config directory — config.json,
        // status.json, tadaima.pid stay so a reinstall is seamless.
    }
}
