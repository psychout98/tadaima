using System;
using Microsoft.UI.Xaml;

namespace Tadaima.Tray;

public partial class App : Application
{
    private TrayHost? _host;

    public App()
    {
        this.InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _host = new TrayHost();
        _host.Start();
    }
}
