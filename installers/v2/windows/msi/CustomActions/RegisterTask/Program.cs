using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Xml.Linq;

// RegisterTask.exe
//
// Args:
//   install <INSTALLDIR>   — create the "Tadaima Agent" task
//   uninstall              — delete the task
//
// The task triggers on logon and restarts on failure. We use an XML
// task definition passed to `schtasks /XML` because the CLI flags don't
// express restart-on-failure triggers.

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: RegisterTask.exe install <INSTALLDIR> | RegisterTask.exe uninstall");
    return 2;
}

var action = args[0].ToLowerInvariant();
if (action == "uninstall")
{
    var p = Process.Start(new ProcessStartInfo
    {
        FileName = "schtasks.exe",
        Arguments = "/Delete /TN \"Tadaima Agent\" /F",
        UseShellExecute = false,
        CreateNoWindow = true,
    });
    p?.WaitForExit();
    // Deleting a task that doesn't exist returns non-zero; we don't
    // care during uninstall.
    return 0;
}

if (action != "install" || args.Length < 2)
{
    Console.Error.WriteLine("usage: RegisterTask.exe install <INSTALLDIR>");
    return 2;
}

var installDir = args[1].TrimEnd('\\');
var tadaimaCmd = Path.Combine(installDir, "agent", "tadaima.cmd");
if (!File.Exists(tadaimaCmd))
{
    Console.Error.WriteLine($"agent not installed: {tadaimaCmd}");
    return 3;
}

XNamespace ns = "http://schemas.microsoft.com/windows/2004/02/mit/task";
var doc = new XDocument(
    new XDeclaration("1.0", "UTF-16", null),
    new XElement(ns + "Task", new XAttribute("version", "1.2"),
        new XElement(ns + "RegistrationInfo",
            new XElement(ns + "Description", "Tadaima media download agent")),
        new XElement(ns + "Triggers",
            new XElement(ns + "LogonTrigger",
                new XElement(ns + "Enabled", "true"))),
        new XElement(ns + "Principals",
            new XElement(ns + "Principal", new XAttribute("id", "Author"),
                new XElement(ns + "LogonType", "InteractiveToken"),
                new XElement(ns + "RunLevel", "LeastPrivilege"))),
        new XElement(ns + "Settings",
            new XElement(ns + "MultipleInstancesPolicy", "IgnoreNew"),
            new XElement(ns + "DisallowStartIfOnBatteries", "false"),
            new XElement(ns + "StopIfGoingOnBatteries", "false"),
            new XElement(ns + "AllowHardTerminate", "true"),
            new XElement(ns + "StartWhenAvailable", "true"),
            new XElement(ns + "RunOnlyIfNetworkAvailable", "false"),
            new XElement(ns + "IdleSettings",
                new XElement(ns + "StopOnIdleEnd", "false"),
                new XElement(ns + "RestartOnIdle", "false")),
            new XElement(ns + "AllowStartOnDemand", "true"),
            new XElement(ns + "Enabled", "true"),
            new XElement(ns + "Hidden", "false"),
            new XElement(ns + "RunOnlyIfIdle", "false"),
            new XElement(ns + "WakeToRun", "false"),
            new XElement(ns + "ExecutionTimeLimit", "PT0S"),
            new XElement(ns + "Priority", "7"),
            new XElement(ns + "RestartOnFailure",
                new XElement(ns + "Interval", "PT1M"),
                new XElement(ns + "Count", "999"))),
        new XElement(ns + "Actions", new XAttribute("Context", "Author"),
            new XElement(ns + "Exec",
                new XElement(ns + "Command", tadaimaCmd),
                new XElement(ns + "Arguments", "start"),
                new XElement(ns + "WorkingDirectory", installDir)))));

var tempXml = Path.Combine(Path.GetTempPath(), "tadaima-task.xml");
File.WriteAllText(tempXml, doc.Declaration?.ToString() + "\n" + doc.ToString(), Encoding.Unicode);

var result = Process.Start(new ProcessStartInfo
{
    FileName = "schtasks.exe",
    Arguments = $"/Create /TN \"Tadaima Agent\" /XML \"{tempXml}\" /F",
    UseShellExecute = false,
    CreateNoWindow = true,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
});
if (result is null)
{
    Console.Error.WriteLine("failed to spawn schtasks.exe");
    return 4;
}
var stdout = result.StandardOutput.ReadToEnd();
var stderr = result.StandardError.ReadToEnd();
result.WaitForExit();
Console.WriteLine(stdout);
if (!string.IsNullOrEmpty(stderr)) Console.Error.WriteLine(stderr);

return result.ExitCode;
