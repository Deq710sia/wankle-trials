#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# setup-and-launch.sh — THE ONE SCRIPT TO RULE THEM ALL
# 
# This script does EVERYTHING from clone to launch:
#   1. Clone the GitHub repo
#   2. Copy files to working directories
#   3. Fix cheat file naming
#   4. Copy webgpu-polyfill to /tmp
#   5. Patch the hunter bot (adds 11 telemetry fields)
#   6. Archive old incomplete hunter-bot data (MOVE, don't delete)
#   7. Run telemetry-backfill
#   8. Run telemetry-field-validator (creates expected-fields.json)
#   9. Launch all 5 infrastructure processes + git-backup
#  10. Verify everything is running
#
# USAGE: bash setup-and-launch.sh
# 
# The new agent just runs this ONE script, then monitors.
# ═══════════════════════════════════════════════════════════════════
set -u

GITHUB_URL="https://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@github.com/Deq710sia/wankle-trials.git"
REPO_DIR="/home/z/agent-ctx"
SCRIPTS_DIR="/home/z/my-project/scripts/cheat-tests"
DOWNLOAD_DIR="/home/z/my-project/download"
BACKUP_BASE="/home/z/agent-ctx/backups/pre-setup-$(date -u +%Y%m%d_%H%M%S)"

ts() { date '+%H:%M:%S'; }
step() { echo ""; echo "[$(ts)] ═══ STEP $1: $2 ═══"; }
verify() { echo "[$(ts)]   ✅ $1"; }
fail() { echo "[$(ts)]   ❌ FAILED: $1"; echo "[$(ts)]   Aborting setup."; exit 1; }

echo "[$(ts)] ═════════════════════════════════════════════════════════"
echo "[$(ts)]  SETUP AND LAUNCH — Wankle3D Trial Suite"
echo "[$(ts)]  This script does everything. Just run it and monitor."
echo "[$(ts)] ═════════════════════════════════════════════════════════"

# ── STEP 1: Clone repo ──
step 1 "Clone GitHub repo"
if [ -d "$REPO_DIR/.git" ]; then
  echo "[$(ts)]   Repo already exists at $REPO_DIR — pulling latest"
  cd "$REPO_DIR" && git pull origin main 2>/dev/null || true
else
  mkdir -p "$REPO_DIR"
  cd "$REPO_DIR"
  git clone "$GITHUB_URL" . 2>/dev/null || fail "git clone failed"
fi
verify "Repo ready at $REPO_DIR"

# ── STEP 2: Copy scripts to working dir ──
step 2 "Copy harness + bots to working directory"
mkdir -p "$SCRIPTS_DIR" "$DOWNLOAD_DIR"
cp "$REPO_DIR"/harness/*.py "$SCRIPTS_DIR/" 2>/dev/null
cp "$REPO_DIR"/harness/*.sh "$SCRIPTS_DIR/" 2>/dev/null
cp "$REPO_DIR"/bots/*.js "$SCRIPTS_DIR/" 2>/dev/null
# Copy CSVs (trial data)
mkdir -p "$SCRIPTS_DIR"
cp "$REPO_DIR"/trial-data/csvs/*.csv "$SCRIPTS_DIR/" 2>/dev/null
# Copy JSONL logs
for v in v19 v21.7 v22.8 v24 v25 v27; do
  if [ -d "$REPO_DIR/trial-data/logs/${v}-logs" ]; then
    mkdir -p "$SCRIPTS_DIR/parallel-${v}-logs"
    cp -r "$REPO_DIR/trial-data/logs/${v}-logs/"* "$SCRIPTS_DIR/parallel-${v}-logs/" 2>/dev/null
  fi
done
# Verify
SCRIPT_COUNT=$(ls "$SCRIPTS_DIR"/*.py "$SCRIPTS_DIR"/*.sh 2>/dev/null | wc -l)
[ "$SCRIPT_COUNT" -gt 10 ] && verify "$SCRIPT_COUNT scripts copied" || fail "Only $SCRIPT_COUNT scripts copied (expected 20+)"

# ── STEP 3: Fix cheat file naming ──
step 3 "Copy + rename cheat versions"
for f in "$REPO_DIR"/cheat-versions/*.user.js; do
  cp "$f" "$DOWNLOAD_DIR/"
done
# Rename: vXX.user.js → wankle-cheat-vXX.user.js
cd "$DOWNLOAD_DIR"
for f in v*.user.js; do
  if [[ "$f" != wankle-cheat-* ]] && [ -f "$f" ]; then
    mv "$f" "wankle-cheat-$f"
  fi
done
CHEAT_COUNT=$(ls wankle-cheat-v*.user.js 2>/dev/null | wc -l)
[ "$CHEAT_COUNT" -ge 9 ] && verify "$CHEAT_COUNT cheat versions present" || fail "Only $CHEAT_COUNT cheat files (expected 9+)"

# ── STEP 4: webgpu-polyfill ──
step 4 "Copy webgpu-polyfill to /tmp"
if [ -f "$REPO_DIR/webgpu-polyfill.js" ]; then
  cp "$REPO_DIR/webgpu-polyfill.js" /tmp/webgpu-polyfill.js
elif [ -f "$DOWNLOAD_DIR/webgpu-polyfill.js" ]; then
  cp "$DOWNLOAD_DIR/webgpu-polyfill.js" /tmp/webgpu-polyfill.js
else
  fail "webgpu-polyfill.js not found in repo"
fi
[ -f /tmp/webgpu-polyfill.js ] && verify "webgpu-polyfill at /tmp/" || fail "webgpu-polyfill copy failed"

# ── STEP 5: Patch hunter bot ──
step 5 "Patch hunter-bot-v3.js (add 11 telemetry fields)"
BOT="$SCRIPTS_DIR/hunter-bot-v3.js"

# Backup FIRST (to a timestamped folder, not a sibling file)
mkdir -p "$BACKUP_BASE"
cp "$BOT" "$BACKUP_BASE/hunter-bot-v3.js.pre-patch" 2>/dev/null

# Check if already patched
if grep -q "tb.lastRealShellCount" "$BOT" 2>/dev/null && grep -q "realShells" "$BOT" 2>/dev/null; then
  echo "[$(ts)]   Hunter bot already patched — skipping"
else
  # Apply patch via python (more reliable than sed for multi-line)
  python3 << 'PATCH'
path = "/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js"
with open(path) as f:
    src = f.read()

old = """        // ENHANCED telemetry (same as passive-bot.js)
        playerSpeed: Math.round(tb.lastMySpeed),
        dodgeActive: tb.lastDodgeActive, dodgeUrgency: tb.lastDodgeUrgency,
        interceptActive: tb.lastInterceptActive
      });"""

new = """        // ENHANCED telemetry (same as passive-bot.js) — PATCHED by setup-and-launch.sh
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
    print("PATCHED: 11 telemetry fields added to hunter-bot-v3.js")
else:
    print("WARNING: anchor not found — bot may already be patched or code changed")
PATCH
fi

# Verify patch
FIELD_COUNT=$(grep -c "realShells\|predictedShells\|pathGuardCrosses\|dodgeMoveX\|coldSpotReactive\|guardViolated" "$BOT" 2>/dev/null)
[ "$FIELD_COUNT" -ge 6 ] && verify "Hunter bot has $FIELD_COUNT telemetry field references" || fail "Patch verification failed (only $FIELD_COUNT fields found)"

# Syntax check
node -c "$BOT" 2>/dev/null && verify "Hunter bot syntax OK" || fail "Hunter bot syntax error"

# ── STEP 6: Archive old incomplete hunter-bot data ──
step 6 "Archive old hunter-bot trial data (MOVE, don't delete)"
ARCHIVE_DIR="$REPO_DIR/archive/incomplete-hunter-telemetry"
mkdir -p "$ARCHIVE_DIR"

ARCHIVED_TOTAL=0
for v in v19 v21.7 v22.8 v24 v25 v27; do
  # Move JSONL logs for RK Fight (c69c5ff7) and Dungeon (a6b7c90f)
  mkdir -p "$ARCHIVE_DIR/${v}-logs"
  RK_MOVED=$(ls "$SCRIPTS_DIR/parallel-${v}-logs/${v}-custom-c69c5ff7-f4e-t"*.jsonl 2>/dev/null | wc -l)
  DUN_MOVED=$(ls "$SCRIPTS_DIR/parallel-${v}-logs/${v}-custom-a6b7c90f-813-t"*.jsonl 2>/dev/null | wc -l)
  mv "$SCRIPTS_DIR/parallel-${v}-logs/${v}-custom-c69c5ff7-f4e-t"*.jsonl "$ARCHIVE_DIR/${v}-logs/" 2>/dev/null
  mv "$SCRIPTS_DIR/parallel-${v}-logs/${v}-custom-a6b7c90f-813-t"*.jsonl "$ARCHIVE_DIR/${v}-logs/" 2>/dev/null
  
  # Move telemetry files
  mkdir -p "$ARCHIVE_DIR/${v}-telemetry"
  mv "$REPO_DIR/telemetry/${v}/RK" "$ARCHIVE_DIR/${v}-telemetry/" 2>/dev/null
  mv "$REPO_DIR/telemetry/${v}/Dun" "$ARCHIVE_DIR/${v}-telemetry/" 2>/dev/null
  
  # Archive CSV rows then remove from active CSV
  CSV="$SCRIPTS_DIR/parallel-${v}-results.csv"
  if [ -f "$CSV" ]; then
    ARCHIVE_CSV="$ARCHIVE_DIR/${v}-RK-Dun-results.csv"
    head -1 "$CSV" > "$ARCHIVE_CSV"
    grep "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$ARCHIVE_CSV" 2>/dev/null
    head -1 "$CSV" > "$CSV.tmp"
    grep -v "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$CSV.tmp"
    mv "$CSV.tmp" "$CSV"
    REMAINING=$(($(wc -l < "$CSV") - 1))
    ARCHIVED=$(($(wc -l < "$ARCHIVE_CSV") - 1))
    echo "[$(ts)]   $v: archived $ARCHIVED rows, kept $REMAINING"
    ARCHIVED_TOTAL=$((ARCHIVED_TOTAL + ARCHIVED))
  fi
done

# Archive trials.jsonl entries
python3 << 'JSONL'
import json
path = "/home/z/agent-ctx/trials.jsonl"
archive_path = "/home/z/agent-ctx/archive/incomplete-hunter-telemetry/trials-incomplete.jsonl"
kept = []
archived = []
with open(path) as f:
    for line in f:
        t = json.loads(line)
        if t.get('map') in ('RK', 'Dun'):
            archived.append(line)
        else:
            kept.append(line)
with open(archive_path, 'w') as f:
    f.writelines(archived)
with open(path, 'w') as f:
    f.writelines(kept)
print(f"Archived {len(archived)} JSONL entries, kept {len(kept)}")
JSONL

verify "Archived $ARCHIVED_TOTAL CSV rows + JSONL entries to $ARCHIVE_DIR"

# Verify no RK+Dun left in active CSVs
RK_LEFT=$(grep -rh "c69c5ff7" "$SCRIPTS_DIR"/parallel-*-results.csv 2>/dev/null | wc -l)
DUN_LEFT=$(grep -rh "a6b7c90f" "$SCRIPTS_DIR"/parallel-*-results.csv 2>/dev/null | wc -l)
[ "$RK_LEFT" -eq 0 ] && [ "$DUN_LEFT" -eq 0 ] && verify "No RK+Dun rows left in active CSVs" || echo "[$(ts)]   ⚠️ $RK_LEFT RK + $DUN_LEFT Dun rows still in CSVs (may be from A/B variants)"

# ── STEP 7: Run telemetry-field-validator ──
step 7 "Generate expected-telemetry-fields.json"
python3 "$SCRIPTS_DIR/telemetry-field-validator.py" 2>/dev/null || \
  python3 "$REPO_DIR/harness/telemetry-field-validator.py" 2>/dev/null || \
  echo "[$(ts)]   ⚠️ Validator failed — anomaly-detector will run without field checks"
[ -f "$SCRIPTS_DIR/expected-telemetry-fields.json" ] && verify "expected-telemetry-fields.json created" || echo "[$(ts)]   ⚠️ expected-telemetry-fields.json missing"

# ── STEP 8: Run telemetry-backfill ──
step 8 "Backfill missing telemetry files"
python3 "$SCRIPTS_DIR/telemetry-backfill.py" 2>/dev/null || \
  python3 "$REPO_DIR/harness/telemetry-backfill.py" 2>/dev/null || \
  echo "[$(ts)]   ⚠️ Backfill failed — some telemetry files may be missing"
verify "Telemetry backfill attempted"

# ── STEP 9: Launch all 5 infrastructure processes + git-backup ──
step 9 "Launch infrastructure (5 processes + git-backup)"

# Kill any stale processes first
pkill -f "generic-trials" 2>/dev/null
pkill -f "agent-browser" 2>/dev/null
pkill -f "chrome.*agent-browser" 2>/dev/null
sleep 2

# Launch all 5 + git-backup
setsid -f bash "$SCRIPTS_DIR/watchdog-wrapper.sh" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched watchdog"
setsid -f bash "$SCRIPTS_DIR/manifest-updater-wrapper.sh" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched manifest-updater"
setsid -f bash "$SCRIPTS_DIR/backup-manager-wrapper.sh" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched backup-manager"
setsid -f bash "$SCRIPTS_DIR/anomaly-detector-wrapper.sh" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched anomaly-detector"
setsid -f bash "$SCRIPTS_DIR/telemetry-field-validator-wrapper.sh" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched telemetry-field-validator"
setsid -f bash -c "cd $REPO_DIR && while true; do bash git-backup.sh; sleep 300; done" > /dev/null 2>&1 < /dev/null
echo "[$(ts)]   Launched git-backup (every 5 min)"

sleep 10

# ── STEP 10: Verify everything ──
step 10 "Verify everything is running"
PROC_COUNT=$(ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup|telemetry-field)" | grep -v grep | wc -l)
echo "[$(ts)]   Processes running: $PROC_COUNT"
[ "$PROC_COUNT" -ge 8 ] && verify "$PROC_COUNT processes alive" || echo "[$(ts)]   ⚠️ Only $PROC_COUNT processes (expected 8+)"

# Check drivers are launching
sleep 10
DRIVER_COUNT=$(ps -ef | grep "generic-trials" | grep -v grep | wc -l)
echo "[$(ts)]   Trial drivers: $DRIVER_COUNT"
[ "$DRIVER_COUNT" -ge 3 ] && verify "$DRIVER_COUNT drivers running" || echo "[$(ts)]   ⚠️ Only $DRIVER_COUNT drivers (watchdog may still be starting them)"

echo ""
echo "[$(ts)] ═════════════════════════════════════════════════════════"
echo "[$(ts)]  SETUP COMPLETE"
echo "[$(ts)]  Monitor with: cat /home/agent-ctx/trial-manifest.json | python3 -m json.tool"
echo "[$(ts)]  Check processes: ps -ef | grep -E '(watchdog|generic-trials)' | grep -v grep"
echo "[$(ts)]  Watchdog log: tail -20 /home/z/my-project/scripts/cheat-tests/watchdog.log"
echo "[$(ts)] ═════════════════════════════════════════════════════════"
