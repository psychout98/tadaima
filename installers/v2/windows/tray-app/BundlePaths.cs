using System;
using System.IO;

namespace Tadaima.Tray;

/// <summary>
/// Absolute paths to the bundled Node runtime, the installed agent, and
/// the agent's config / status / log files. Computed from the tray app's
/// own executable path so we do not hardcode
/// <c>C:\Program Files\Tadaima\</c>.
/// </summary>
internal static class BundlePaths
{
    /// <summary>
    /// The installer lays out:
    ///   [INSTALLDIR]\
    ///     TadaimaTray.exe            ← AppContext.BaseDirectory
    ///     runtime\node.exe
    ///     runtime\node_modules\npm\bin\npm-cli.js
    ///     agent\tadaima.cmd          ← after `npm install -g --prefix agent`
    ///     tray-config.json
    /// </summary>
    public static string InstallDir => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    public static string NodeExe => Path.Combine(InstallDir, "runtime", "node.exe");
    public static string NpmCliJs => Path.Combine(InstallDir, "runtime", "node_modules", "npm", "bin", "npm-cli.js");
    public static string AgentPrefix => Path.Combine(InstallDir, "agent");
    public static string AgentCmd => Path.Combine(AgentPrefix, "tadaima.cmd");
    public static string TrayConfigJson => Path.Combine(InstallDir, "tray-config.json");

    /// <summary>
    /// %APPDATA%\tadaima\ — the agent's config directory, where
    /// config.json / status.json / tadaima.pid live.
    /// </summary>
    public static string AgentConfigDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "tadaima");

    public static string StatusJson => Path.Combine(AgentConfigDir, "status.json");
    public static string ConfigJson => Path.Combine(AgentConfigDir, "config.json");
    public static string PidFile => Path.Combine(AgentConfigDir, "tadaima.pid");

    /// <summary>
    /// %LOCALAPPDATA%\Tadaima\agent.log — where the scheduled task writes
    /// stdout/stderr. The task XML points at this file.
    /// </summary>
    public static string AgentLog => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Tadaima",
        "agent.log");
}
