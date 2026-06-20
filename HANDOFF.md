# HANDOFF DOCUMENT — Wankle3D Cheat Trials

**Last updated:** 2026-06-20 ~18:00 UTC
**Status:** Trials paused. Ready for new bot to resume.
**GitHub repo:** `https://github.com/Deq710sia/wankle-trials` (private)
**GitHub token:** `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`

---

## GITHUB ACCESS (use this for all git operations)

The repo is private. Use this token in the URL for clone/push/pull:

```
https://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@github.com/Deq710sia/wankle-trials.git
```

Or configure git credentials once:
```bash
git config --global credential.helper store
echo "https://Deq710sia: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@github.com" > ~/.git-credentials
```

Then you can use the plain URL: `https://github.com/Deq710sia/wankle-trials.git`

---

## WHO YOU ARE

You are the next agent picking up a long-running trial suite for an aimbot/dodge cheat for Wankle3D (wanshot.lol), a 3D multiplayer tank game. The previous agent ran ~632 trials across 6 cheat versions, then paused for handoff. You need to resume and finish the remaining ~718 trials.

**READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.**

---

## STEP 0: CLONE THE REPO

Everything you need is in the GitHub repo. Clone it first:

```bash
git clone https://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@github.com/Deq710sia/wankle-trials.git
cd wankle-trials
```

All paths in this document are **relative to the repo root** (the `wankle-trials/` directory you just cloned into).

---

## STEP 1: READ CURRENT STATE

Read the manifest to see where trials left off:

```bash
cat trial-manifest.json | python3 -m json.tool
```

### Current state (as of last backup):

| Version | Status | Trials | Notes |
|---|---|---|---|
| v19 | ✅ complete | 150/150 | Baseline — earliest simple version |
| v21.7 | ✅ complete | 150/150 | Baseline — pre-cold-spot, "works great" reference |
| v22.8 | ✅ complete | 150/150 | Baseline — cold-spot + per-shell vector dodge |
| v24 | 🔄 in progress | 60/150 | Contender — last version before magnetize fix |
| v25 | 🔄 in progress | 73/150 | Contender — magnetize fix + path-guard |
| v27 | 🔄 in progress | 49/150 | Contender — v25 + burst fire + Tier-2 prediction |
| v27-no-pathguard | ⏳ pending | 0/150 | A/B variant — path-segment guard disabled |
| v27-cap-pred8 | ⏳ pending | 0/150 | A/B variant — predicted shells capped at 8 |
| v27-mag045 | ⏳ pending | 0/150 | A/B variant — magnetize threshold 0.35→0.45 |

**Total target:** 9 versions × 150 trials = 1350 trials
**Remaining:** ~718 trials (~8 hours wall clock at 3 parallel)

---

## REPO STRUCTURE

```
wankle-trials/
├── HANDOFF.md                    ← you are here (this document)
├── README.md                     ← overview + directory map
├── CONTINUATION_GUIDE.md         ← detailed infrastructure guide
├── trial-manifest.json           ← CURRENT STATE (read this first)
├── trials.jsonl                  ← all trial results (one JSON per line)
├── git-backup.sh                 ← auto-push script (run every 5 min)
├── cheat-versions/               ← all cheat .user.js files
│   ├── v19.user.js               ← baselines
│   ├── v21.7.user.js
│   ├── v22.8.user.js
│   ├── v24.user.js               ← contenders
│   ├── v25.user.js
│   ├── v27.user.js
│   ├── v27-no-pathguard.user.js  ← A/B variants
│   ├── v27-cap-pred8.user.js
│   └── v27-mag045.user.js
├── snippets/                     ← drop-in code blocks
│   ├── prediction-engine-snippet.js
│   ├── dodge-magnetize-fix.js
│   └── iteration-agent-prompt.md
├── harness/                      ← test infrastructure scripts
│   ├── watchdog.py               ← monitors drivers, auto-launches A/B
│   ├── watchdog-wrapper.sh       ← auto-restarts watchdog if it dies
│   ├── manifest-updater.py       ← writes manifest + trials.jsonl
│   ├── manifest-updater-wrapper.sh
│   ├── backup-manager.py         ← backups every 30 trials + retention
│   ├── backup-manager-wrapper.sh
│   ├── anomaly-detector.py       ← scans for bad trials, removes for re-run
│   ├── anomaly-detector-wrapper.sh
│   ├── telemetry-backfill.py     ← generates missing telemetry files
│   ├── telemetry-writer.py       ← converts JSONL log → telemetry JSON
│   ├── generic-trials.sh         ← main trial driver (one version, N trials)
│   ├── survival-showdown-parallel.sh ← per-trial harness (browser + inject + run)
│   └── ... (analysis scripts, chart builders)
├── bots/                         ← bot scripts that drive the player tank
│   ├── passive-bot.js            ← passive bot (fires only for respawn)
│   ├── passive-nofire-bot.js     ← pure dodge bot (never fires)
│   ├── hunter-bot-v3.js          ← aggressive hunter bot
│   ├── human-bot.js
│   └── test-bot-v2.js
├── trial-data/                   ← THE RESULTS
│   ├── trials.jsonl              ← summary (MOST IMPORTANT)
│   ├── trial-manifest.json
│   ├── csvs/                     ← per-version CSV files
│   ├── logs/                     ← per-version JSONL logs (frame-by-frame)
│   └── telemetry/                ← per-trial telemetry JSON files
├── docs/
│   └── CONTINUATION_GUIDE.md     ← detailed infrastructure guide
├── ascii-art/                    ← ASCII art archive (murals + doodles)
│   ├── README.md                 ← mural schedule + style notes
│   ├── 01-420-weed-mural.txt
│   ├── 02-armada-tide-turns.txt
│   ├── 03-transition-complete.txt
│   ├── 04-ab-armed.txt
│   ├── 05-smaller-pieces.txt
│   ├── 06-early-monitoring-tanks.txt
│   ├── 07-mid-monitoring-dice.txt
│   └── 08-late-monitoring-contenders.txt
└── archive/                      ← legacy/duplicate files
```

---

## STEP 2: SET UP ENVIRONMENT

The trial infrastructure expects files in specific locations on the VM. You need to copy them from the repo:

```bash
# Create working directories
mkdir -p /home/z/agent-ctx
mkdir -p /home/z/my-project/scripts/cheat-tests
mkdir -p /home/z/my-project/download

# Copy everything from repo to working locations
cp -r wankle-trials/* /home/z/agent-ctx/
cp -r wankle-trials/.git /home/z/agent-ctx/
cp wankle-trials/harness/*.py /home/z/my-project/scripts/cheat-tests/
cp wankle-trials/harness/*.sh /home/z/my-project/scripts/cheat-tests/
cp wankle-trials/bots/*.js /home/z/my-project/scripts/cheat-tests/
cp wankle-trials/cheat-versions/*.user.js /home/z/my-project/download/

# Restore CSVs (trial data) to working location
cp wankle-trials/trial-data/csvs/*.csv /home/z/my-project/scripts/cheat-tests/

# Restore JSONL logs
for v in v19 v21.7 v22.8 v24 v25 v27; do
  if [ -d "wankle-trials/trial-data/logs/${v}-logs" ]; then
    mkdir -p "/home/z/my-project/scripts/cheat-tests/parallel-${v}-logs"
    cp -r wankle-trials/trial-data/logs/${v}-logs/* "/home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/"
  fi
done

# Restore webgpu-polyfill (needed by browser harness)
# (This file should be in the repo root or download/ — check archive/ if missing)
cp wankle-trials/trial-data/webgpu-polyfill.js /tmp/webgpu-polyfill.js 2>/dev/null || \
  find wankle-trials/ -name "webgpu-polyfill.js" -exec cp {} /tmp/webgpu-polyfill.js \;
```

---

## STEP 3: LAUNCH INFRASTRUCTURE

### 3a. Verify cheat files exist
```bash
ls /home/z/my-project/download/wankle-cheat-v*.user.js | wc -l
# Should show 20 files (v19 through v27 + 3 A/B variants)
```

If any are missing, the naming might differ. The harness expects `wankle-cheat-vXX.user.js`. Rename if needed:
```bash
cd /home/z/my-project/download/
for f in v*.user.js; do
  if [[ "$f" != wankle-cheat-* ]]; then
    mv "$f" "wankle-cheat-$f"
  fi
done
```

### 3a-bis. Restore webgpu-polyfill.js (CRITICAL — browser harness needs it)
```bash
# The file is in the repo root (webgpu-polyfill.js). Copy it to /tmp:
cp webgpu-polyfill.js /tmp/webgpu-polyfill.js
# Verify it exists:
ls -la /tmp/webgpu-polyfill.js
```

Without this file, the browser harness will fail to load Wankle3D and all trials will produce K=0 D=0 (immobile cheat bug).

### 3a-ter. Run telemetry-backfill to generate missing telemetry files (IMPORTANT)

533 of 638 trials have `telemetryFile=null` in trials.jsonl (telemetry files were never generated for them). Run backfill ONCE before starting trials:

```bash
python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py
```

This scans trials.jsonl for entries with `telemetryFile=null`, generates the per-trial telemetry JSON files from the JSONL logs, and updates the pointer in trials.jsonl. It's safe to run anytime — it only generates missing files. This may take 5-10 minutes for 533 trials.

After backfill, verify:
```bash
grep -c '"telemetryFile": null' /home/z/agent-ctx/trials.jsonl
# Should be much lower (ideally 0, but some trials may have missing JSONL logs)
```

### 3b. Launch the 4 infrastructure processes + git-backup

```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash -c 'while true; do /home/z/agent-ctx/git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

### 3c. Verify watchdog is monitoring the right versions

The watchdog-wrapper.sh should monitor v24, v25, v27 (the contenders still in progress). Check:

```bash
ps -ef | grep "watchdog.py" | grep -v grep
# Should show: watchdog.py v24 v25 v27 --trials 30 --duration 90
```

The watchdog-wrapper.sh monitors ALL 6 versions: `v19 v21.7 v22.8 v24 v25 v27`.
This is intentional — baselines need hunter-bot trial reruns (RK Fight + Dungeon had incomplete telemetry), so the watchdog must monitor them too. The watchdog auto-launches A/B variants when v24+v25+v27 all hit 150/150.

If the wrapper shows a different version list, fix it:
```bash
sed -i 's/v19 v21.7 v22.8 v24 v25 v27/v19 v21.7 v22.8 v24 v25 v27/' /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh
# (this is a no-op if already correct — the 6-version list is intentional)
```

### 3d. Wait 2 min, verify trials are producing new data

```bash
sleep 120
for v in v24 v25 v27; do
  CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
  TRIALS=$(($(wc -l < $CSV 2>/dev/null) - 1))
  echo "$v: $TRIALS / 150"
done
```

Trial counts should be increasing. If stuck, check heartbeats:
```bash
for v in v24 v25 v27; do
  cat /home/z/my-project/scripts/cheat-tests/parallel-${v}-heartbeat 2>/dev/null
done
```

---

## STEP 4: MONITOR (YOUR MAIN JOB)

Stay running. Check every ~5 minutes. Between checks, create ASCII art.

### Check command:
```bash
date
cat /home/z/agent-ctx/trial-manifest.json | python3 -c "
import json, sys
m = json.load(sys.stdin)
pct = 100*m['trialsCompleted']/m['trialsTotal']
print(f'trials: {m[\"trialsCompleted\"]}/{m[\"trialsTotal\"]} ({pct:.1f}%)')
for v, d in m['perVersion'].items():
    if d['completed'] > 0 or v in ['v24','v25','v27']:
        print(f'  {v}: {d[\"completed\"]}/{d[\"target\"]}')
"
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup)" | grep -v grep | wc -l
```

### ASCII art tradition:

The previous agent created ASCII art between checks to fill time. **Continue this tradition.** See `ascii-art/README.md` for the full mural schedule + style notes. Key points:

- **Between checks:** small creative doodles (5-15 lines). Don't repeat — find new metaphors.
- **At milestones:** BIG murals (30+ lines), save to `ascii-art/` with descriptive filenames.
- **Upcoming milestones:**
  - **675 trials** = halfway mural (1350/2)
  - **710 trials** = **DAB MURAL** (oil rig themed — user specifically requested this)
  - **900 trials** = baselines + contenders complete
  - **1350 trials** = final armada reaches shore

Themes already used (find NEW ones): dice, tanks, boats/armada, rockets, pyramids, skyscrapers, waterfalls, constellations, mountains, trains, tornado, braille rain, bar charts, burning joint, dice cups, dice tower.

### If processes die:

Relaunch immediately using the commands in Step 3b. Don't wait. The `setsid -f` ensures they survive shell exit.

### If Bash tool times out repeatedly:

Tell the user to restart the session. But the infrastructure is autonomous — it'll keep running. The git-backup pushes every 5 min so no data is lost.

---

## INFRASTRUCTURE DETAILS

### 4 independent processes (each auto-restarts via bash wrapper):

1. **watchdog.py** — monitors drivers, restarts if dead/hung, **auto-launches A/B variants when v24+v25+v27 all hit 150/150**
2. **manifest-updater.py** — writes `trial-manifest.json` + appends to `trials.jsonl` every 30s
3. **backup-manager.py** — backups every 30 trials per version (retains last 3) + pre-switch backup on completion
4. **anomaly-detector.py** — scans CSVs every 60s for bad trials (K=0 D=0 dead, missing JSONL, NaN FPS), removes for re-run (max 3 retries)

Plus:
- **git-backup.sh** — pushes to GitHub every 5 min (runs in a loop)
- **generic-trials.sh** — one per version, runs trials sequentially (launched by watchdog)

### Heartbeat system:
Each driver writes a heartbeat file every 10s: `parallel-<ver>-heartbeat`. If heartbeat stalled >30s AND driver process alive → driver is hung → watchdog kills + restarts it.

---

## A/B VARIANTS (FULLY AUTONOMOUS — no manual intervention needed)

### How the contender→A/B handoff works

The watchdog handles the handoff between trial clumps automatically. You do NOT need to manually switch versions. Here's what happens:

1. **Watchdog starts** monitoring v24, v25, v27 (contenders)
2. **When all 3 contenders hit 150/150**, the watchdog:
   - Checks that v27 specifically is complete (only launches A/B if v27 finished)
   - Auto-launches 3 A/B variant drivers: v27-no-pathguard, v27-cap-pred8, v27-mag045
   - Adds them to its monitoring list
   - Writes a flag file (`ab-variants-launched.flag`) so watchdog restarts don't re-launch
3. **Watchdog monitors A/B variants** until they all hit 150/150
4. **When all 9 versions complete**, watchdog logs `🎉 ALL TRIALS COMPLETE` and exits

### A/B variant details

| Variant | Modification | Cheat file |
|---|---|---|
| v27-no-pathguard | Path-segment guard disabled (crossCount forced to 0) | `cheat-versions/v27-no-pathguard.user.js` |
| v27-cap-pred8 | Predicted shells capped at 8 (`predictedShells.slice(0, 8)`) | `cheat-versions/v27-cap-pred8.user.js` |
| v27-mag045 | Magnetize threshold 0.35→0.45 | `cheat-versions/v27-mag045.user.js` |

All 3 are based on v27 with a single-change patch.

### Crash recovery (VM reset scenario)

If the VM dies and watchdog restarts:
- **If A/B not yet launched:** watchdog checks if contenders are complete → launches A/B normally
- **If A/B already launched:** watchdog sees the flag file OR sees A/B CSVs have data → adds A/B variants to monitoring → resumes watching them
- **If A/B was mid-run:** drivers may be dead → watchdog relaunches them (CSV skip logic prevents re-running completed trials)

The flag file (`ab-variants-launched.flag`) is the persistent marker. It lives in the cheat-tests directory and gets backed up to GitHub by git-backup.sh.

### What you need to do

**Nothing.** The watchdog handles everything. Just:
1. Launch the infrastructure (Step 3b)
2. Monitor (Step 4) — create ASCII art, check progress every 5 min
3. When watchdog logs `🎉 ALL TRIALS COMPLETE` → build charts → declare winner → commit to GitHub

---

## MAPS

| Code | Map name | Mode | Level ID | Notes |
|---|---|---|---|---|
| CA | Custom Arena | survival | `custom-c2738ec4-135` | open map, 6-7 enemies |
| RK | RK Fight | survival | `custom-c69c5ff7-f4e` | wall-dense, bank shots |
| Dun | Dungeon | survival | `custom-a6b7c90f-813` | small map, corner deaths |
| DT-off | Dodge Training (aimbot OFF) | campaign | `custom-5f697a3b-742` | 72 enemies, pure dodge test |
| DT-on | Dodge Training (aimbot ON) | campaign | `custom-5f697a3b-742` | 72 enemies, realistic (fire-stun) |

---

## CHEAT VERSION HISTORY

- **v19** — earliest simple version, minimal dodge complexity
- **v21.7** — pre-cold-spot, simple vector dodge ("works great" reference)
- **v22.8** — cold-spot + per-shell vector dodge
- **v24** — last version before magnetize fix
- **v25** — magnetize fix + path-guard + 360° dodge + burst fire + no stickiness
- **v26** — v25 + Tier-2 prediction engine + randomized safe-direction (intermediate, not in trial suite)
- **v27** — v25-opt (slimmed) + v26's features properly ported + dead-code cuts

### v27 bug fixes applied (already in the cheat file):
1. **Fire decision broken** — `shellsInFlight` was undefined in canFire check. Fixed: re-added `var shellsInFlight = myShells;`
2. **Pattern memory silently dead** — typo in prediction engine. Fixed.

---

## WINNER DECLARATION (when all 1350 trials done)

From the user's original plan:
- 95% confidence intervals don't overlap with baseline
- Effect size > baseline's standard deviation
- Difference reproduces across all 5 maps (not just one)

When all 1350 trials complete:
1. Build comparison charts (matplotlib, see `harness/build-strength-charts.py` for reference)
2. Declare the winner based on the criteria above
3. Save charts to `trial-data/charts/` and commit to GitHub

---

## RULES

1. **The manifest is the single source of truth.** Read it first.
2. **Never manually edit CSVs** unless re-running an anomalous trial.
3. **Never kill the drivers** (generic-trials.sh) — only the watchdog should do that.
4. **If a wrapper dies, relaunch with `setsid -f`** — that's the only way processes survive shell exit.
5. **Telemetry backfill is safe to run anytime** — `python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py`
6. **Git backup runs every 5 min automatically** — don't interfere unless it's broken.
7. **Stay running.** The user wants you to monitor continuously, create ASCII art between checks, and only stop when trials are done.
8. **When trials complete (1350/1350)** — make MASS charts comparing all versions, declare winner, commit to GitHub.

---

## QUICK SANITY CHECK

Run this first to verify everything is healthy after setup:
```bash
date
cat /home/z/agent-ctx/trial-manifest.json | python3 -c "
import json, sys
m = json.load(sys.stdin)
pct = 100*m['trialsCompleted']/m['trialsTotal']
print(f'trials: {m[\"trialsCompleted\"]}/{m[\"trialsTotal\"]} ({pct:.1f}%)')
print(f'completed: {m[\"versionsCompleted\"]}')
print(f'in progress: {m[\"versionsInProgress\"]}')
"
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup)" | grep -v grep | wc -l
```

If trials < 1350 and processes = 0, launch everything per Step 3.

---

## CRITICAL: HUNTER-BOT TELEMETRY GAP (MUST FIX BEFORE RUNNING)

### The Problem

The `hunter-bot-v3.js` in `bots/` is MISSING telemetry field writes in its sample logging block. It reads `_wklDodgeDebug` and `_wklPathGuard` into internal variables but never writes them to the sample output. This means ALL hunter-bot trials (RK Fight + Dungeon across ALL versions) are missing:

- `realShells` (real shell count)
- `predictedShells` (predicted shell count)
- `pathGuardCrosses` (path guard engagement)
- `dodgeMoveX` / `dodgeMoveZ` (dodge vector)
- `coldSpotReactive` / `coldSpotStrategic`
- `guardViolated`

The passive-bot.js and passive-nofire-bot.js are CORRECT — they have all fields. Only hunter-bot-v3.js is broken.

### What was collected correctly

| Map | Bot | Telemetry | Status |
|---|---|---|---|
| Custom Arena (CA) | passive-bot.js | ✅ Full | OK |
| Dodge Training OFF | passive-nofire-bot.js | ✅ Full | OK |
| Dodge Training ON | passive-bot.js | ✅ Full | OK |
| RK Fight (RK) | hunter-bot-v3.js | ❌ Missing fields | MUST RERUN |
| Dungeon (Dun) | hunter-bot-v3.js | ❌ Missing fields | MUST RERUN |

### Trials needing rerun (262 total)

| Version | RK Fight | Dungeon | Total |
|---|---|---|---|
| v19 | 30 | 30 | 60 |
| v21.7 | 30 | 30 | 60 |
| v22.8 | 30 | 30 | 60 |
| v24 | 26 | 4 | 30 |
| v25 | 28 | 5 | 33 |
| v27 | 19 | 0 | 19 |
| **Subtotal** | | | **262** |
| A/B variants (new) | 90 | 90 | 180 |
| **Grand total** | | | **442** |

### Fix steps (DO THIS BEFORE LAUNCHING TRIALS)

1. **Fix hunter-bot-v3.js** — Run the provided patch script:
   ```bash
   bash /home/z/my-project/scripts/cheat-tests/fix-hunter-bot-telemetry.patch.sh
   ```
   This adds 11 missing telemetry fields to the hunter bot's sample output. The bot already READS the data (lines 94-120) but never WROTE it to samples. The patch script handles everything automatically (backup, patch, verify syntax). See `harness/fix-hunter-bot-telemetry.patch.sh` in the repo for the exact code.

2. **MOVE (do NOT delete) all hunter-bot trial data to archive** — Preserve the incomplete data in case it's useful later. The kill/death/wave/survival data IS valid — only the dodge telemetry fields are missing.
   ```bash
   # Create archive folder for incomplete hunter-bot data
   mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry
   
   for v in v19 v21.7 v22.8 v24 v25 v27; do
     # Move JSONL logs for RK Fight (c69c5ff7) and Dungeon (a6b7c90f)
     mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs
     mv /home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/${v}-custom-c69c5ff7-f4e-t*.jsonl \
        /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs/ 2>/dev/null
     mv /home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/${v}-custom-a6b7c90f-813-t*.jsonl \
        /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-logs/ 2>/dev/null
     # Move telemetry files for RK and Dun
     mkdir -p /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry
     mv /home/z/agent-ctx/telemetry/${v}/RK/ \
        /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry/ 2>/dev/null
     mv /home/z/agent-ctx/telemetry/${v}/Dun/ \
        /home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-telemetry/ 2>/dev/null
   done
   ```

3. **MOVE (do NOT delete) hunter-bot rows from CSVs** — Preserve them in an archive CSV, then remove from the active CSV so drivers re-run them:
   ```bash
   for v in v19 v21.7 v22.8 v24 v25 v27; do
     CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
     ARCHIVE_CSV=/home/z/agent-ctx/archive/incomplete-hunter-telemetry/${v}-RK-Dun-results.csv
     # Save header + hunter-bot rows to archive
     head -1 "$CSV" > "$ARCHIVE_CSV"
     grep "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$ARCHIVE_CSV"
     # Remove hunter-bot rows from active CSV
     head -1 "$CSV" > "$CSV.tmp"
     grep -v "custom-c69c5ff7-f4e\|custom-a6b7c90f-813" "$CSV" >> "$CSV.tmp"
     mv "$CSV.tmp" "$CSV"
     echo "$v: archived $(($(wc -l < "$ARCHIVE_CSV") - 1)) hunter-bot rows, kept $(($(wc -l < "$CSV") - 1)) passive-bot rows"
   done
   ```

4. **MOVE (do NOT delete) hunter-bot entries from trials.jsonl** — Preserve them in an archive file:
   ```bash
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
   
   # Write archive file
   with open('/home/z/agent-ctx/archive/incomplete-hunter-telemetry/trials-incomplete.jsonl', 'w') as f:
       f.writelines(archived)
   
   # Write cleaned trials.jsonl
   with open('/home/z/agent-ctx/trials.jsonl', 'w') as f:
       f.writelines(kept)
   
   print(f'Archived {len(archived)} hunter-bot entries to trials-incomplete.jsonl')
   print(f'Kept {len(kept)} passive-bot entries in trials.jsonl')
   "
   ```

5. **Verify the fix** — After patching hunter-bot-v3.js, syntax check:
   ```bash
   node -c /home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js
   ```

6. **Then launch infrastructure** — The watchdog will detect missing trials (because CSV rows were removed) and re-run them with the fixed hunter bot. New data will be written to the same CSV/JSONL/telemetry locations — nothing overwritten because the old data was moved to archive.

7. **After reruns complete** — The archive folder at `archive/incomplete-hunter-telemetry/` contains the old incomplete data. The kill/death/survival numbers there ARE valid and can be cross-referenced with the new complete data if needed.

### Note on why this happened

The hunter-bot-v3.js was patched to READ `_wklDodgeDebug` and `_wklPathGuard` (lines 94-115) but the sample output block (lines 668-688) was never updated to WRITE those values. The passive-bot.js was patched correctly because it was the primary test bot. The hunter bot was an afterthought.

The deep-analyze scripts (`harness/analyze-csv-results.py`, `harness/analyze-v22.3-deep.py`) were not used during this session — they exist in the repo but were written for earlier trial phases. They would have caught this if run.

---

## TELEMETRY INTEGRITY SYSTEM (self-healing — prevents future gaps)

### How it works

3 components work together to ensure ALL telemetry fields are collected on EVERY trial:

1. **telemetry-field-validator.py** (runs every 5 min via wrapper)
   - Parses bot JS source files to extract expected telemetry fields per bot type
   - Writes `expected-telemetry-fields.json`
   - If someone patches a bot to add new fields → re-running this auto-updates expectations
   - No code changes needed in anomaly-detector

2. **anomaly-detector.py** (runs every 60s, UPGRADED)
   - Now reads `expected-telemetry-fields.json`
   - For each trial, checks first JSONL sample has ALL expected fields for that bot type
   - If fields missing → flags as anomaly → removes CSV row → driver reruns
   - This would have caught the hunter-bot gap automatically on the FIRST trial

3. **fix-hunter-bot-telemetry.patch.sh** (one-shot, UPGRADED)
   - After patching the bot, AUTO-ARCHIVES old incomplete data (MOVE, don't delete)
   - Archives JSONL logs, telemetry files, CSV rows, trials.jsonl entries
   - Triggers telemetry-field-validator to update expected fields
   - All in one script — next bot runs 1 command and everything is handled

### What this means for the next bot

If a bot is missing telemetry fields:
1. The anomaly detector catches it on the FIRST trial (within 60s)
2. The trial is removed from CSV → driver reruns it
3. After 3 retries, it's left in CSV with reason logged
4. The bot must be fixed before those trials will pass

If someone patches a bot to add NEW fields:
1. The field validator re-parses the bot source (every 5 min)
2. `expected-telemetry-fields.json` is updated automatically
3. The anomaly detector picks up the new expectations on its next cycle
4. No manual code changes needed anywhere

### No-halt patching

All 3 components can be updated without halting any running process:
- Bot source files can be edited while drivers are running (drivers read the file at inject time, not at process start)
- `expected-telemetry-fields.json` can be rewritten while anomaly-detector is running (it reads the file fresh each cycle)
- The anomaly-detector can be killed + restarted via its wrapper (wrapper auto-restarts within 5s)
- The field validator can be killed + restarted via its wrapper

### Launching the field validator (Step 3b addition)

Add this to the infrastructure launch commands:
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/telemetry-field-validator-wrapper.sh > /dev/null 2>&1 < /dev/null
```

This makes 5 infrastructure processes total:
1. watchdog (monitors drivers)
2. manifest-updater (writes manifest + trials.jsonl)
3. backup-manager (backups every 30 trials)
4. anomaly-detector (scans for bad trials + telemetry gaps)
5. telemetry-field-validator (updates expected fields every 5 min)

Plus git-backup loop (every 5 min).
