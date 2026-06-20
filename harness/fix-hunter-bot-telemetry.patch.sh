#!/bin/bash
# fix-hunter-bot-telemetry.patch.sh — adds missing telemetry fields to hunter-bot-v3.js
# Run this BEFORE launching trials. Safe to run multiple times.
#
# The hunter bot already READS all telemetry into tb.last* variables (lines 94-120)
# but never WRITES them to the sample output (line 684-688).
# This patch adds the missing fields to the sample push.

BOT=/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js

# Check if already patched
if grep -q "realShells" "$BOT" 2>/dev/null && grep -q "tb.lastRealShellCount" "$BOT" 2>/dev/null; then
  echo "hunter-bot-v3.js already has realShells in sample output — skipping patch"
  exit 0
fi

# Backup
cp "$BOT" "${BOT}.pre-patch.bak"

# The old sample output block ends with:
#   dodgeActive: tb.lastDodgeActive, dodgeUrgency: tb.lastDodgeUrgency,
#   interceptActive: tb.lastInterceptActive
#   });
#
# We replace it with the same + all missing fields:

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
    print("ERROR: could not find the anchor text — bot may already be patched or code changed")
    print("Looking for 'interceptActive: tb.lastInterceptActive' near sample push...")
PY

# Also add tb.lastDodgeMoveX/Z initialization if not present
if ! grep -q "tb.lastDodgeMoveX" "$BOT" 2>/dev/null; then
  # Add initialization near other tb.last* inits
  sed -i 's/lastDodgeActive: false, lastDodgeUrgency: 0,/lastDodgeActive: false, lastDodgeUrgency: 0, lastDodgeMoveX: 0, lastDodgeMoveZ: 0,/' "$BOT"
  echo "Added tb.lastDodgeMoveX/Z initialization"
fi

# Also add dodgeMoveX/Z reading from dodgeDb if not present
if ! grep -q "lastDodgeMoveX = dodgeDb" "$BOT" 2>/dev/null; then
  sed -i 's/tb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0;/tb.lastDodgeUrgency = dodgeDb.lastDodgeVec.urgency || 0; tb.lastDodgeMoveX = dodgeDb.lastDodgeVec.moveX || 0; tb.lastDodgeMoveZ = dodgeDb.lastDodgeVec.moveZ || 0;/' "$BOT"
  echo "Added dodgeMoveX/Z reading from dodgeDb"
fi

# Verify
echo ""
echo "=== Verify patch ==="
grep -c "realShells\|predictedShells\|pathGuardCrosses\|dodgeMoveX" "$BOT"
echo "telemetry fields now in sample output"
node -c "$BOT" && echo "SYNTAX OK" || echo "SYNTAX ERROR"
