#!/bin/bash
# patch-hunter-bot-only.sh — applies ONLY the hunter bot telemetry patch.
# Does NOT run the auto-archive step (already done by previous session —
# 262 trials archived in archive/incomplete-hunter-telemetry/).
# Idempotent: skips if already patched.

set -u

BOT=/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/home/z/agent-ctx/archive/bot-patch-$TS"
mkdir -p "$BACKUP_DIR"

# Check if already patched
if grep -q "realShells" "$BOT" 2>/dev/null && grep -q "tb.lastRealShellCount" "$BOT" 2>/dev/null; then
  echo "hunter-bot-v3.js already patched — skipping"
  rmdir "$BACKUP_DIR" 2>/dev/null
  exit 0
fi

# Backup
cp -p "$BOT" "$BACKUP_DIR/hunter-bot-v3.js"
echo "Backed up: $BACKUP_DIR/hunter-bot-v3.js"

# Apply the Python patch (same logic as fix-hunter-bot-telemetry.patch.sh)
python3 << 'PY'
path = "/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js"
with open(path) as f:
    src = f.read()

old = """        // ENHANCED telemetry (same as passive-bot.js)
        playerSpeed: Math.round(tb.lastMySpeed),
        dodgeActive: tb.lastDodgeActive, dodgeUrgency: tb.lastDodgeUrgency,
        interceptActive: tb.lastInterceptActive
      });"""

new = """        // ENHANCED telemetry (same as passive-bot.js)
        playerSpeed: Math.round(tb.lastMySpeed),
        dodgeActive: tb.lastDodgeActive, dodgeUrgency: tb.lastDodgeUrgency,
        dodgeMoveX: Math.round((tb.lastDodgeMoveX || 0) * 100) / 100,
        dodgeMoveZ: Math.round((tb.lastDodgeMoveZ || 0) * 100) / 100,
        interceptActive: tb.lastInterceptActive,
        coldSpotReactive: tb.lastColdSpotReactive ? {score: tb.lastColdSpotReactive.score} : null,
        coldSpotStrategic: tb.lastColdSpotStrategic ? {score: tb.lastColdSpotStrategic.score} : null,
        predictedShells: tb.lastPredictedShellCount || 0,
        realShells: tb.lastRealShellCount || 0,
        guardViolated: tb.lastDodgeGuardViolated || false,
        pathGuardCrosses: tb.lastPathGuardCrosses || false,
        pathGuardRotation: tb.lastPathGuardRotation || 0,
        pathGuardResolved: tb.lastPathGuardResolved || false,
        pathGuardShells: tb.lastPathGuardShells || 0
      });"""

if old in src:
    src = src.replace(old, new, 1)
    with open(path, 'w') as f:
        f.write(src)
    print("PATCHED: added 11 telemetry fields to hunter-bot-v3.js sample output")
else:
    print("ERROR: anchor text not found — bot may already be patched or code changed")
    exit(1)
PY

# Add tb.lastDodgeMoveX/Z initialization if not present
if ! grep -q "tb.lastDodgeMoveX" "$BOT" 2>/dev/null; then
  sed -i 's/lastDodgeActive: false, lastDodgeUrgency: 0,/lastDodgeActive: false, lastDodgeUrgency: 0, lastDodgeMoveX: 0, lastDodgeMoveZ: 0,/' "$BOT"
  echo "Added tb.lastDodgeMoveX/Z initialization"
fi

# Add dodgeMoveX/Z reading from dodgeDb if not present
if ! grep -q "lastDodgeMoveX = dodgeDb" "$BOT" 2>/dev/null; then
  sed -i 's/tb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0;/tb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0; tb.lastDodgeMoveX = dodgeDb.lastDodgeVec.moveX || 0; tb.lastDodgeMoveZ = dodgeDb.lastDodgeVec.moveZ || 0;/' "$BOT"
  echo "Added dodgeMoveX/Z reading from dodgeDb"
fi

# Verify
echo ""
echo "=== Verify patch ==="
grep -c "realShells\|predictedShells\|pathGuardCrosses\|dodgeMoveX" "$BOT"
echo "telemetry fields now in sample output (expected: 4+)"
node -c "$BOT" && echo "SYNTAX OK" || echo "SYNTAX ERROR"
