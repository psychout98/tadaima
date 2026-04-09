using System.Runtime.InteropServices;

namespace Tadaima.Tray;

/// <summary>
/// Tiny wrapper around the Win32 MessageBox API so the tray app can show
/// yes/no confirmations from any thread without needing a XamlRoot. We
/// use this instead of ContentDialog because the tray icon has no
/// long-lived window, and creating a hidden anchor window just for
/// dialogs is not worth the complexity for the beta.
/// </summary>
internal static class MessageBoxUtil
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(nint hWnd, string text, string caption, uint type);

    private const uint MB_OK = 0x0;
    private const uint MB_YESNO = 0x4;
    private const uint MB_ICONINFORMATION = 0x40;
    private const int IDYES = 6;

    public static bool Show(string title, string body, bool yesNo)
    {
        var type = MB_ICONINFORMATION | (yesNo ? MB_YESNO : MB_OK);
        var result = MessageBoxW(nint.Zero, body, title, type);
        return !yesNo || result == IDYES;
    }
}
