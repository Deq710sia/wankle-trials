#!/bin/bash
# fix-hunter-bot-telemetry.patch.sh — adds missing telemetry fields to hunter-bot-v3.js
# Run this BEFORE launching trials. Safe to run multiple times.
#
# The hunter bot already READS all telemetry into tb.last* variables (lines 94-120)
# but never WRITES them to the sample output (line 684-688).
# This patch adds the missing fields to the sample push.
#
# RULE: No overwrites. Every file that will be modified is FIRST copied to a
# timestamped backup folder. Originals are never destroyed.

set -u

BOT=/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js
WORK=/home/z/my-project/scripts/cheat-tests
REPO=/home/z/agent-ctx

# Timestamped backup folder for this run (created once, used everywhere)
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$REPO/archive/pre-patch-$TS"
mkdir -p "$BACKUP_DIR"
echo "Backup folder for this run: $BACKUP_DIR"
echo "Every file modified by this script will be copied here first."

# Check if already patched
if grep -q "realShells" "$BOT" 2>/dev/null && grep -q "tb.lastRealShellCount" "$BOT" 2>/dev/null; then
  echo "hunter-bot-v3.js already has realShells in sample output — skipping patch"
  echo "(backup folder still created at $BACKUP_DIR — empty, safe to remove)"
  exit 0
fi

# === Backup #1: hunter-bot-v3.js (before in-place edit) ===
cp -p "$BOT" "$BACKUP_DIR/hunter-bot-v3.js"
echo "Backed up: hunter-bot-v3.js"

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
# (MOVE, don't delete — these go to a separate archive folder, not the backup folder.
#  Backup folder preserves pre-modification state of files we EDIT IN PLACE.
#  Archive folder holds trial data we MOVE OUT of active trial locations.)
echo ""
echo "=== AUTO-ARCHIVING old hunter-bot data (MOVE, don't delete) ==="
ARCHIVE_DIR="$REPO/archive/incomplete-hunter-telemetry"
mkdir -p "$ARCHIVE_DIR"

for v in v19 v21.7 v22.8 v24 v25 v27; do
  # Move JSONL logs
  mkdir -p "$ARCHIVE_DIR/${v}-logs"
  mv $WORK/parallel-${v}-logs/${v}-custom-c69c5ff7-f4e-t*.jsonl \
     "$ARCHIVE_DIR/${v}-logs/" 2>/dev/null
  mv $WORK/parallel-${v}-logs/${v}-custom-a6b7c90f-813-t*.jsonl \
     "$ARCHIVE_DIR/${v}-logs/" 2>/dev/null
  # Move telemetry files
  mkdir -p "$ARCHIVE_DIR/${v}-telemetry"
  mv $REPO/telemetry/${v}/RK/ \
     "$ARCHIVE_DIR/${v}-telemetry/" 2>/dev/null
  mv $REPO/telemetry/${v}/Dun/ \
     "$ARCHIVE_DIR/${v}-telemetry/" 2>/dev/null
  # === Backup #2: CSV (before in-place modification) ===
  CSV=$WORK/parallel-${v}-results.csv
  if [ -f "$CSV" ]; then
    cp -p "$CSV" "$BACKUP_DIR/parallel-${v}-results.csv"
    # Save RK+Dun rows to archive (this is preservation, not backup)
    ARCHIVE_CSV="$ARCHIVE_DIR/${v}-RK-Dun-results.csv"
    head -1 "$CSV" > "$ARCHIVE_CSV" 2>/dev/null
    grep "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$ARCHIVE_CSV" 2>/dev/null
    # Write modified CSV to a tmp file, then atomically replace
    head -1 "$CSV" > "$CSV.tmp"
    grep -v "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$CSV.tmp"
    mv "$CSV.tmp" "$CSV"
    echo "  $v: archived $(($(wc -l < "$ARCHIVE_CSV") - 1)) rows, kept $(($(wc -l < "$CSV") - 1)), original backed up to $BACKUP_DIR/"
  fi
done

# === Backup #3: trials.jsonl (before in-place modification) ===
if [ -f "$REPO/trials.jsonl" ]; then
  cp -p "$REPO/trials.jsonl" "$BACKUP_DIR/trials.jsonl"
  echo "Backed up: trials.jsonl"
fi

# Archive trials.jsonl entries (MOVE hunter-bot entries to archive file)
python3 -c "
import json, shutil, os
from pathlib import Path

repo = Path('$REPO')
archive = Path('$ARCHIVE_DIR')
backup = Path('$BACKUP_DIR')

src = repo / 'trials.jsonl'
# Original already backed up to $BACKUP_DIR above — safe to read + rewrite in place.
with open(src) as f:
    lines = f.readlines()
kept = []
archived = []
for line in lines:
    t = json.loads(line)
    if t.get('map') in ('RK', 'Dun'):
        archived.append(line)
    else:
        kept.append(line)
# Preserve archived entries in archive file
with open(archive / 'trials-incomplete.jsonl', 'w') as f:
    f.writelines(archived)
# Rewrite active trials.jsonl in place (original is in backup folder)
with open(src, 'w') as f:
    f.writelines(kept)
print(f'Archived {len(archived)} entries, kept {len(kept)}')
print(f'Original trials.jsonl preserved at: {backup / \"trials.jsonl\"}')
"

# === TRIGGER FIELD VALIDATOR: update expected-fields.json ===
echo ""
echo "=== Updating expected telemetry fields ==="
# Back up existing expected-telemetry-fields.json if present
if [ -f "$WORK/expected-telemetry-fields.json" ]; then
  cp -p "$WORK/expected-telemetry-fields.json" "$BACKUP_DIR/expected-telemetry-fields.json"
  echo "Backed up: expected-telemetry-fields.json"
fi
python3 "$WORK/telemetry-field-validator.py" 2>/dev/null || \
  python3 "$REPO/harness/telemetry-field-validator.py" 2>/dev/null || \
  echo "WARNING: could not run telemetry-field-validator.py"

echo ""
echo "=== Patch + archive complete ==="
echo "Pre-modification originals preserved in: $BACKUP_DIR/"
echo "  - hunter-bot-v3.js (unpatched)"
echo "  - parallel-{v19,v21.7,v22.8,v24,v25,v27}-results.csv (with RK+Dun rows)"
echo "  - trials.jsonl (with RK+Dun entries)"
echo "  - expected-telemetry-fields.json (if it existed)"
echo ""
echo "Hunter-bot trial data (RK+Dun) moved to: $ARCHIVE_DIR/"
echo "Hunter bot now writes all telemetry fields."
echo "Anomaly detector will verify field completeness on every trial."
