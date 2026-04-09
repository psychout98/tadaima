using System;
using System.IO;
using Microsoft.Win32;

// RegisterTrayStartup.exe
//
// Args:
//   install <INSTALLDIR>   — write HKCU\…\Run\TadaimaTray = <INSTALLDIR>\tray\TadaimaTray.exe
//   uninstall              — delete the HKCU\…\Run\TadaimaTray value
//
// We target HKCU so the task is per-user and does not require elevation.

const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
const string ValueName = "TadaimaTray";

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: RegisterTrayStartup.exe install <INSTALLDIR> | uninstall");
    return 2;
}

var action = args[0].ToLowerInvariant();
try
{
    if (action == "install")
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("missing INSTALLDIR");
            return 2;
        }
        var trayExe = Path.Combine(args[1].TrimEnd('\\'), "tray", "TadaimaTray.exe");
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("cannot open HKCU Run key");
        key.SetValue(ValueName, "\"" + trayExe + "\"", RegistryValueKind.String);
        return 0;
    }
    if (action == "uninstall")
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
        return 0;
    }
    Console.Error.WriteLine($"unknown action: {action}");
    return 2;
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex);
    return 1;
}
