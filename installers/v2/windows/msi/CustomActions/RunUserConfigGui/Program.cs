using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

// RunUserConfigGui.exe
//
// Args: <INSTALLDIR>
//
// Launches TadaimaConfig.exe in the installing user's interactive
// session. We use WTSQueryUserToken to obtain the interactive user's
// primary token, then CreateProcessAsUserW to spawn the GUI in that
// session. Waits for the child and propagates its exit code.

if (args.Length < 1)
{
    Console.Error.WriteLine("usage: RunUserConfigGui.exe <INSTALLDIR>");
    return 2;
}
var installDir = args[0].TrimEnd('\\');
var configExe = Path.Combine(installDir, "config", "TadaimaConfig.exe");
if (!File.Exists(configExe))
{
    Console.Error.WriteLine($"config GUI missing: {configExe}");
    return 3;
}

try
{
    var sessionId = Native.WTSGetActiveConsoleSessionId();
    if (sessionId == 0xFFFFFFFFu)
    {
        Console.Error.WriteLine("no interactive console session");
        return 4;
    }

    if (!Native.WTSQueryUserToken(sessionId, out var userToken))
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), "WTSQueryUserToken failed");
    }

    try
    {
        var si = new Native.STARTUPINFO
        {
            cb = Marshal.SizeOf<Native.STARTUPINFO>(),
            lpDesktop = "winsta0\\default",
        };

        // CommandLine MUST be a writable buffer (docs requirement).
        var cmd = new System.Text.StringBuilder("\"" + configExe + "\"");

        if (!Native.CreateProcessAsUser(
                userToken,
                null,
                cmd,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                0,
                IntPtr.Zero,
                installDir,
                ref si,
                out var pi))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser failed");
        }

        try
        {
            Native.WaitForSingleObject(pi.hProcess, Native.INFINITE);
            Native.GetExitCodeProcess(pi.hProcess, out var code);
            return (int)code;
        }
        finally
        {
            if (pi.hProcess != IntPtr.Zero) Native.CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) Native.CloseHandle(pi.hThread);
        }
    }
    finally
    {
        Native.CloseHandle(userToken);
    }
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex);
    return 1;
}

internal static class Native
{
    public const uint INFINITE = 0xFFFFFFFFu;

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSQueryUserToken(uint sessionId, out IntPtr Token);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string? lpApplicationName,
        System.Text.StringBuilder lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll")]
    public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);
}
