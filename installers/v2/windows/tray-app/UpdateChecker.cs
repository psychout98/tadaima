using System;

namespace Tadaima.Tray;

/// <summary>
/// "Check for Updates" — query npm for the latest
/// @psychout98/tadaima version, compare to the installed version, and
/// optionally apply the update by stopping the scheduled task, running
/// npm install, and restarting the task.
/// </summary>
internal static class UpdateChecker
{
    public readonly record struct UpdateInfo(string Current, string Latest);

    public static UpdateInfo? Check()
    {
        var npmResult = Shell.Run(BundlePaths.NodeExe, new[]
        {
            BundlePaths.NpmCliJs,
            "view",
            "@psychout98/tadaima",
            "version",
        });
        if (npmResult.ExitCode != 0)
        {
            throw new InvalidOperationException(
                "npm view failed: " +
                (string.IsNullOrWhiteSpace(npmResult.StdErr) ? npmResult.StdOut : npmResult.StdErr));
        }

        var latest = npmResult.StdOut.Trim();
        var local = Shell.Run(BundlePaths.NodeExe, new[]
        {
            System.IO.Path.Combine(BundlePaths.AgentPrefix, "node_modules", "@psychout98", "tadaima", "dist", "index.js"),
            "--version",
        });
        if (local.ExitCode != 0)
        {
            throw new InvalidOperationException("tadaima --version failed: " + local.StdErr);
        }

        var current = ParseVersion(local.StdOut);
        if (CompareSemver(current, latest) < 0)
        {
            return new UpdateInfo(current, latest);
        }
        return null;
    }

    public static void Apply()
    {
        // 1. Stop the scheduled task.
        Shell.Run("schtasks.exe", new[] { "/End", "/TN", "Tadaima Agent" });

        // 2. npm install -g --prefix <install>\agent @psychout98/tadaima@latest
        var install = Shell.Run(BundlePaths.NodeExe, new[]
        {
            BundlePaths.NpmCliJs,
            "install",
            "-g",
            "--prefix",
            BundlePaths.AgentPrefix,
            "@psychout98/tadaima@latest",
        });
        if (install.ExitCode != 0)
        {
            throw new InvalidOperationException("npm install failed: " + install.StdErr);
        }

        // 3. Restart the scheduled task.
        Shell.Run("schtasks.exe", new[] { "/Run", "/TN", "Tadaima Agent" });
    }

    private static string ParseVersion(string cliOutput)
    {
        var s = cliOutput.Trim();
        var lastSpace = s.LastIndexOf(' ');
        if (lastSpace >= 0 && lastSpace + 1 < s.Length) s = s[(lastSpace + 1)..];
        return s.StartsWith('v') ? s[1..] : s;
    }

    // Very small semver comparator — good enough for "current < latest".
    private static int CompareSemver(string a, string b)
    {
        var (ac, ap) = Split(a);
        var (bc, bp) = Split(b);
        var max = Math.Max(ac.Length, bc.Length);
        for (var i = 0; i < max; i++)
        {
            var ai = i < ac.Length ? ac[i] : 0;
            var bi = i < bc.Length ? bc[i] : 0;
            if (ai != bi) return ai < bi ? -1 : 1;
        }
        if (ap == bp) return 0;
        if (string.IsNullOrEmpty(ap)) return 1;
        if (string.IsNullOrEmpty(bp)) return -1;
        return string.CompareOrdinal(ap, bp);
    }

    private static (int[] core, string pre) Split(string v)
    {
        var parts = v.Split('-', 2);
        var core = Array.ConvertAll(parts[0].Split('.'), int.Parse);
        var pre = parts.Length > 1 ? parts[1] : "";
        return (core, pre);
    }
}
