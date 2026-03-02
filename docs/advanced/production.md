# Production Deployment

Mach6 is designed to run as a persistent daemon in production. One process, no containers, no orchestration.

## Linux (systemd)

Mach6 includes a systemd service file:

```bash
sudo cp mach6-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mach6-gateway
```

Edit the service file to set your paths, user, and working directory:

```ini
[Unit]
Description=Mach6 AI Gateway
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/mach6
ExecStart=/usr/bin/node dist/gateway/daemon.js --config=mach6.json
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Hot Reload

Apply config changes without restarting:

```bash
kill -USR1 $(pgrep -f "gateway/daemon.js")
```

### Logs

```bash
journalctl -u mach6-gateway -f
```

## macOS (launchd)

Create `~/Library/LaunchAgents/com.mach6.gateway.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mach6.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/mach6/dist/gateway/daemon.js</string>
        <string>--config=mach6.json</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/mach6</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.mach6.gateway.plist
```

## Windows

Use [NSSM](https://nssm.cc/) to run as a Windows service:

```powershell
nssm install Mach6 "C:\Program Files\nodejs\node.exe" "dist\gateway\daemon.js --config=mach6.json"
nssm set Mach6 AppDirectory "C:\path\to\mach6"
nssm start Mach6
```

Alternatively, use Task Scheduler for a simpler setup.

> **Note:** `SIGUSR1` hot-reload is not available on Windows. Restart the service to apply config changes.

## Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2+ cores |
| RAM | 256 MB | 512 MB |
| Disk | 100 MB | 1 GB (for sessions) |
| Network | Required for cloud LLM providers | — |
| GPU | Not required | Not required |

Mach6 is CPU-only. No GPU needed. The same binary runs on a $5/month VPS or bare metal.

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3006/api/v1/health
```

### Heartbeat

Mach6 includes an activity-aware heartbeat scheduler that adapts check frequency based on system load:

- **Active** — frequent checks during message processing
- **Idle** — reduced frequency when no messages are flowing
- **Sleeping** — minimal checks during quiet hours

Configure quiet hours in `mach6.json`:

```json
{
  "heartbeat": {
    "activeIntervalMin": 1,
    "idleIntervalMin": 5,
    "sleepingIntervalMin": 30,
    "quietHoursStart": 0,
    "quietHoursEnd": 6
  }
}
```

## Graceful Shutdown

Mach6 handles `SIGTERM` and `SIGINT` gracefully:

1. Stops accepting new messages
2. Completes the active agent turn (with timeout)
3. Persists all session state
4. Disconnects channels
5. Exits cleanly
