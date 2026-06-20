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

# === AUTO-ARCHIVE: move old hunter-bot trial data to archive ===
echo ""
echo "=== AUTO-ARCHIVING old hunter-bot data (MOVE, don't delete) ==="
mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry

for v in v19 v21.7 v22.8 v24 v25 v27; do
  # Move JSONL logs
  mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs
  mv /home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/${v}-custom-c69c5ff7-f4e-t*.jsonl \
     /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs/ 2>/dev/null
  mv /home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/${v}-custom-a6b7c90f-813-t*.jsonl \
     /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs/ 2>/dev/null
  # Move telemetry files
  mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry
  mv /home/z/agent-ctx/telemetry/${v}/RK/ \
     /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry/ 2>/dev/null
  mv /home/z/agent-ctx/telemetry/${v}/Dun/ \
     /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry/ 2>/dev/null
  # Archive CSV rows
  CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
  if [ -f "$CSV" ]; then
    ARCHIVE_CSV=/home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-RK-Dun-results.csv
    head -1 "$CSV" > "$ARCHIVE_CSV" 2>/dev/null
    grep "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$ARCHIVE_CSV" 2>/dev/null
    head -1 "$CSV" > "$CSV.tmp"
    grep -v "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$CSV.tmp"
    mv "$CSV.tmp" "$CSV"
    echo "  $v: archived $(($(wc -l < "$ARCHIVE_CSV") - 1)) rows, kept $(($(wc -l < "$CSV") - 1))"
  fi
done

# Archive trials.jsonl entries
python3 -c "
import json
with open('/home/z/agent-ctx/trials.jsonl') as f:
    lines = f.readlines()
kept = []
archived = []
for line in lines:
    t = json.loads(line)
    if t.get('map') in ('RK', 'Dun'):
        archived.append(line)
    else:
        kept.append(line)
with open('/home/z/agent-ctx/archive/incomplete-hunter-telemetry/trials-incomplete.jsonl', 'w') as f:
    f.writelines(archived)
with open('/home/z/agent-ctx/trials.jsonl', 'w') as f:
    f.writelines(kept)
print(f'Archived {len(archived)} entries, kept {len(kept)}')
"

# === TRIGGER FIELD VALIDATOR: update expected-fields.json ===
echo ""
echo "=== Updating expected telemetry fields ==="
python3 /home/z/my-project/scripts/cheat-tests/telemetry-field-validator.py 2>/dev/null || \
  python3 /home/z/agent-ctx/harness/telemetry-field-validator.py 2>/dev/null || \
  echo "WARNING: could not run telemetry-field-validator.py"

echo ""
echo "=== Patch + archive complete ==="
echo "Old data preserved in: /home/z/agent-ctx/archive/incomplete-hunter-telemetry/"
echo "Hunter bot now writes all telemetry fields."
echo "Anomaly detector will verify field completeness on every trial."
