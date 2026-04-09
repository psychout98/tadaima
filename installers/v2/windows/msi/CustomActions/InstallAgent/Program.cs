using System;
using System.Diagnostics;
using System.IO;

// InstallAgent.exe
//
// Args: <INSTALLDIR>
//
// Runs the bundled Node runtime against the bundled npm-cli.js to install
// the pinned @psychout98/tadaima tarball into <INSTALLDIR>\agent. No live
// registry access — the tarball is embedded in the MSI.

var log = InstallLog.Open("InstallAgent");
try
{
    if (args.Length < 1)
    {
        log.Error("usage: InstallAgent.exe <INSTALLDIR>");
        return 2;
    }
    var installDir = args[0].TrimEnd('\\');
    log.Info($"INSTALLDIR = {installDir}");

    var node = Path.Combine(installDir, "runtime", "node.exe");
    var npm = Path.Combine(installDir, "runtime", "node_modules", "npm", "bin", "npm-cli.js");
    var tarball = Path.Combine(installDir, "agent-tarball.tgz");
    var agentPrefix = Path.Combine(installDir, "agent");

    foreach (var required in new[] { node, npm, tarball })
    {
        if (!File.Exists(required))
        {
            log.Error($"required file missing: {required}");
            return 3;
        }
    }

    Directory.CreateDirectory(agentPrefix);

    var psi = new ProcessStartInfo
    {
        FileName = node,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true,
        WorkingDirectory = installDir,
    };
    psi.ArgumentList.Add(npm);
    psi.ArgumentList.Add("install");
    psi.ArgumentList.Add("-g");
    psi.ArgumentList.Add("--prefix");
    psi.ArgumentList.Add(agentPrefix);
    psi.ArgumentList.Add(tarball);

    log.Info("spawning: node npm-cli.js install -g --prefix agent agent-tarball.tgz");
    using var proc = Process.Start(psi)!;
    var stdout = proc.StandardOutput.ReadToEnd();
    var stderr = proc.StandardError.ReadToEnd();
    proc.WaitForExit();
    if (!string.IsNullOrEmpty(stdout)) log.Info(stdout);
    if (!string.IsNullOrEmpty(stderr)) log.Info(stderr);

    if (proc.ExitCode != 0)
    {
        log.Error($"npm install exited with code {proc.ExitCode}");
        return 4;
    }

    var tadaimaCmd = Path.Combine(agentPrefix, "tadaima.cmd");
    if (!File.Exists(tadaimaCmd))
    {
        log.Error($"agent binary missing after install: {tadaimaCmd}");
        return 5;
    }
    log.Info("done");
    return 0;
}
catch (Exception ex)
{
    log.Error(ex.ToString());
    return 1;
}
finally
{
    log.Close();
}

internal sealed class InstallLog
{
    private readonly StreamWriter _writer;
    private readonly string _tag;

    private InstallLog(StreamWriter writer, string tag)
    {
        _writer = writer;
        _tag = tag;
    }

    public static InstallLog Open(string tag)
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Tadaima");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "install-log.txt");
        var writer = new StreamWriter(path, append: true) { AutoFlush = true };
        writer.WriteLine($"[{DateTime.Now:O}] [{tag}] ---- begin ----");
        return new InstallLog(writer, tag);
    }

    public void Info(string msg) => _writer.WriteLine($"[{DateTime.Now:O}] [{_tag}] {msg}");
    public void Error(string msg) => _writer.WriteLine($"[{DateTime.Now:O}] [{_tag}] ERROR: {msg}");
    public void Close()
    {
        _writer.WriteLine($"[{DateTime.Now:O}] [{_tag}] ---- end ----");
        _writer.Dispose();
    }
}
