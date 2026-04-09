using System;
using System.IO;
using System.Text.Json;
using System.Threading;

namespace Tadaima.Tray;

/// <summary>
/// Polls status.json on a 2-second timer and raises <see cref="Changed"/>
/// whenever the snapshot changes.
/// </summary>
internal sealed class StatusPoller : IDisposable
{
    private readonly TrayConfig _cfg;
    private Timer? _timer;
    private AgentSnapshot _current = new(null, AgentHealth.Stale);

    public event Action<AgentSnapshot>? Changed;

    public StatusPoller(TrayConfig cfg)
    {
        _cfg = cfg;
    }

    public AgentSnapshot Current => _current;

    public void Start()
    {
        _timer ??= new Timer(_ => Refresh(), null, TimeSpan.Zero, TimeSpan.FromSeconds(2));
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
    }

    public void Dispose() => Stop();

    private void Refresh()
    {
        var path = BundlePaths.StatusJson;
        AgentSnapshot next;
        try
        {
            if (!File.Exists(path))
            {
                next = new AgentSnapshot(null, AgentHealth.Stale);
            }
            else
            {
                var mtime = File.GetLastWriteTimeUtc(path);
                var age = DateTime.UtcNow - mtime;
                var json = File.ReadAllText(path);
                var status = JsonSerializer.Deserialize<AgentStatus>(json);
                if (age > _cfg.StaleAfter)
                {
                    next = new AgentSnapshot(status, AgentHealth.Stale);
                }
                else if (status is null)
                {
                    next = new AgentSnapshot(null, AgentHealth.Stale);
                }
                else
                {
                    next = new AgentSnapshot(status, status.Connected ? AgentHealth.Connected : AgentHealth.Disconnected);
                }
            }
        }
        catch
        {
            next = new AgentSnapshot(null, AgentHealth.Stale);
        }

        if (!Equals(next, _current))
        {
            _current = next;
            Changed?.Invoke(next);
        }
    }
}
