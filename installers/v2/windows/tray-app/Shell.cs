using System;
using System.Diagnostics;
using System.IO;

namespace Tadaima.Tray;

/// <summary>
/// Helpers for spawning short-lived child processes (schtasks, node,
/// npm-cli, reg). All invocations capture stdout/stderr and return a
/// <see cref="Result"/> so callers can log failures.
/// </summary>
internal static class Shell
{
    public readonly record struct Result(int ExitCode, string StdOut, string StdErr);

    public static Result Run(string executable, string[] args, string? workingDirectory = null)
    {
        var psi = new ProcessStartInfo
        {
            FileName = executable,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = workingDirectory ?? Path.GetDirectoryName(executable) ?? Environment.CurrentDirectory,
        };
        foreach (var arg in args) psi.ArgumentList.Add(arg);

        try
        {
            using var p = Process.Start(psi);
            if (p is null) return new Result(-1, "", "process failed to start");
            var stdout = p.StandardOutput.ReadToEnd();
            var stderr = p.StandardError.ReadToEnd();
            p.WaitForExit();
            return new Result(p.ExitCode, stdout, stderr);
        }
        catch (Exception ex)
        {
            return new Result(-1, "", ex.Message);
        }
    }
}
