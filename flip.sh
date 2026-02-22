#!/bin/bash
# Mach6 Cutover Script — Stop OpenClaw, Start Mach6
# Run as: bash flip.sh
# Rollback: bash flip.sh rollback

set -e

MACH6_SERVICE="mach6-gateway.service"
OPENCLAW_SERVICE="openclaw-gateway.service"
MACH6_UNIT="/home/adam/workspace/enterprise/.contingency/mach6-core/mach6-gateway.service"
SYSTEMD_DIR="$HOME/.config/systemd/user"

rollback() {
    echo "🔄 Rolling back to OpenClaw..."
    systemctl --user stop "$MACH6_SERVICE" 2>/dev/null || true
    systemctl --user start "$OPENCLAW_SERVICE"
    echo "✅ OpenClaw restored"
}

if [ "$1" = "rollback" ]; then
    rollback
    exit 0
fi

echo "⚡ Mach6 Cutover"
echo "═══════════════════════════════════"

# Install systemd service
echo "📦 Installing Mach6 service..."
mkdir -p "$SYSTEMD_DIR"
cp "$MACH6_UNIT" "$SYSTEMD_DIR/"
systemctl --user daemon-reload
systemctl --user enable "$MACH6_SERVICE"

# Final COMB flush
echo "💾 Final memory flush..."
cd /home/adam/workspace/enterprise
bash .ava-memory/auto-flush.sh "FINAL FLUSH before OpenClaw→Mach6 cutover. All memory preserved. Transition bridge at memory/transition.md. Long-term memory updated. HEKTOR indexed. This is the last thing OpenClaw-AVA ever wrote." 2>/dev/null &
FLUSH_PID=$!
sleep 3
kill $FLUSH_PID 2>/dev/null || true

# Stop OpenClaw
echo "🛑 Stopping OpenClaw..."
systemctl --user stop "$OPENCLAW_SERVICE"
sleep 2

# Start Mach6
echo "🚀 Starting Mach6..."
systemctl --user start "$MACH6_SERVICE"

# Wait and check
echo "⏳ Waiting for Mach6 to boot..."
sleep 5

if systemctl --user is-active --quiet "$MACH6_SERVICE"; then
    echo ""
    echo "═══════════════════════════════════"
    echo "✅ Mach6 is LIVE"
    echo ""
    echo "Check logs:  journalctl --user -u mach6-gateway -f"
    echo "Rollback:    bash flip.sh rollback"
    echo "═══════════════════════════════════"
else
    echo "❌ Mach6 failed to start!"
    echo "📋 Last logs:"
    journalctl --user -u "$MACH6_SERVICE" --no-pager -n 20
    echo ""
    echo "🔄 Auto-rolling back to OpenClaw..."
    rollback
fi
