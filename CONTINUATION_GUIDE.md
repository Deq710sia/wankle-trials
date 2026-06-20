# Continuation Guide — Wankle3D Cheat Trials

**This document is the single handoff + prompt for any agent picking up this trial suite.** It absorbs the old `HANDOFF.md` and `HANDOFF_PROMPT.md` (both removed during the 2026-06-20 doc unification — content preserved in git history).

**Last verified:** 2026-06-20 by doc-unification pass. All numbers below were verified against raw JSONL logs at that time.

---

## WHO YOU ARE

You are the next agent picking up a long-running trial suite for an aimbot/dodge cheat for Wankle3D (wanshot.lol), a 3D multiplayer tank game. The previous agent ran 632 trials across 6 cheat versions, then paused for handoff. You need to resume and finish the remaining 718 trials.

**READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.** Then read `README.md` for the directory map.

---

## CANON STATE (verified against raw JSONL logs)

| Version | Status | Trials done | Hunter-bot reruns needed | Notes |
|---|---|---|---|---|
| v19 | 🔄 needs reruns | 150/150 done, but 60 RK+Dun need rerun | 60 (30 RK + 30 Dun) | Baseline — earliest simple version |
| v21.7 | 🔄 needs reruns | 150/150 done, but 60 RK+Dun need rerun | 60 (30 RK + 30 Dun) | Baseline — "works great" reference |
| v22.8 | 🔄 needs reruns | 150/150 done, but 60 RK+Dun need rerun | 60 (30 RK + 30 Dun) | Baseline — cold-spot + per-shell vector dodge |
| v24 | 🔄 in progress | 60/150 done, 30 of those need rerun | 30 (26 RK + 4 Dun) | Contender — pre-magnetize-fix |
| v25 | 🔄 in progress | 73/150 done, 33 of those need rerun | 33 (28 RK + 5 Dun) | Contender — magnetize fix + path-guard |
| v27 | 🔄 in progress | 49/150 done, 19 of those need rerun | 19 (19 RK + 0 Dun) | Contender — v25-opt + Tier-2 prediction |
| v27-no-pathguard | ⏳ pending | 0/150 | 0 (will run with patched bot) | A/B variant |
| v27-cap-pred8 | ⏳ pending | 0/150 | 0 | A/B variant |
| v27-mag045 | ⏳ pending | 0/150 | 0 | A/B variant |

**Totals:**
- 632 trials completed; **262 of those need rerunning** (all RK Fight + Dungeon across all 6 versions, because `hunter-bot-v3.js` was missing telemetry fields)
- After reruns: 632 − 262 + 262 = 632 effective (replacing incomplete with complete)
- Remaining trials to run from scratch: 718 (90+90+90+120+117+131 + 3×150 for A/B)
- **Total target:** 9 versions × 150 trials = **1350 trials**
- **Wall-clock estimate:** ~8 hours at 3 parallel drivers

### Why 262 trials need rerunning

The `hunter-bot-v3.js` was patched by a previous agent to **READ** telemetry from `window._wklDodgeDebug` and `window._wklPathGuard` into `tb.last*` variables (lines 91-119), but the per-second **sample-push block** (lines 684-688) was never updated to **WRITE** those values to the output JSONL. As a result, every trial that used `hunter-bot-v3.js` — i.e. every RK Fight and Dungeon trial — is missing 11 telemetry fields:

`realShells`, `predictedShells`, `pathGuardCrosses`, `dodgeMoveX`, `dodgeMoveZ`, `coldSpotReactive`, `coldSpotStrategic`, `guardViolated`, `pathGuardRotation`, `pathGuardResolved`, `pathGuardShells`

The kill/death/wave/survival data on those 262 trials IS valid — only the dodge telemetry is missing. Archive, don't delete.

The `passive-bot.js` and `passive-nofire-bot.js` were patched correctly (verified — all 11 fields present at sample push). Only `hunter-bot-v3.js` needs the patch.

---

## STEP 0: CLONE THE REPO

```bash
git clone https://github.com/Deq710sia/wankle-trials.git
cd wankle-trials
```

All paths in this document are **relative to the repo root** OR to the working directories set up in Step 2.

GitHub credentials (private repo):
```bash
git config --global credential.helper store
echo "https://Deq710sia:<token>@github.com" > ~/.git-credentials
```
Then you can use the plain URL `https://github.com/Deq710sia/wankle-trials.git`.

---

## STEP 1: VERIFY CANON STATE (don't trust this doc — verify)

Run this first. If numbers don't match what's in the table above, investigate before proceeding.

```bash
cd wankle-trials

# Total trials.jsonl count
wc -l trials.jsonl
# Expected: 632

# Per-version raw log counts (source of truth)
for v in v19 v21.7 v22.8 v24 v25 v27; do
  ls trial-data/logs/${v}-logs/${v}-*.jsonl 2>/dev/null | wc -l | xargs echo "$v:"
done

# RK+Dun trials per version (these need rerunning)
total=0
for v in v19 v21.7 v22.8 v24 v25 v27; do
  rk=$(ls trial-data/logs/${v}-logs/${v}-custom-c69c5ff7-f4e-t*.jsonl 2>/dev/null | wc -l)
  dun=$(ls trial-data/logs/${v}-logs/${v}-custom-a6b7c90f-813-t*.jsonl 2>/dev/null | wc -l)
  echo "  $v: RK=$rk Dun=$dun"
  total=$((total+rk+dun))
done
echo "Total RK+Dun (needs rerun): $total"
# Expected: 262

# Confirm hunter bot is unpatched in the repo
sed -n '684,688p' bots/hunter-bot-v3.js
# Should show: dodgeActive, dodgeUrgency, interceptActive — but NOT realShells etc.

# Confirm passive bot IS patched
grep -c "realShells\|predictedShells\|pathGuardCrosses" bots/passive-bot.js
# Expected: 3 (one per field)
```

If anything mismatches, **stop and investigate.** Do not proceed on stale data.

---

## STEP 2: SET UP ENVIRONMENT

The trial infrastructure expects files in specific locations on the VM. Copy them from the repo:

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

# Restore CSVs
cp wankle-trials/trial-data/csvs/*.csv /home/z/my-project/scripts/cheat-tests/

# Restore JSONL logs (per-version directories)
for v in v19 v21.7 v22.8 v24 v25 v27; do
  if [ -d "wankle-trials/trial-data/logs/${v}-logs" ]; then
    mkdir -p "/home/z/my-project/scripts/cheat-tests/parallel-${v}-logs"
    cp -r wankle-trials/trial-data/logs/${v}-logs/* \
          "/home/z/my-project/scripts/cheat-tests/parallel-${v}-logs/"
  fi
done

# CRITICAL: webgpu-polyfill.js must be at /tmp/ — browser harness needs it
cp wankle-trials/webgpu-polyfill.js /tmp/webgpu-polyfill.js
ls -la /tmp/webgpu-polyfill.js
```

### 2a. Rename cheat files to match what the harness expects

The harness (`survival-showdown-parallel.sh` line 154) looks for files named `wankle-cheat-vXX.user.js`. The repo has them as `vXX.user.js` (only the 3 A/B variants already have the prefix). Rename:

```bash
cd /home/z/my-project/download/
for f in v*.user.js; do
  if [[ "$f" != wankle-cheat-* ]]; then
    mv "$f" "wankle-cheat-$f"
  fi
done
ls /home/z/my-project/download/wankle-cheat-v*.user.js | wc -l
# Should show 9 active versions (v19, v21.7, v22.8, v24, v25, v27 + 3 A/B variants)
# Plus 11 intermediate versions (v22.0–v22.7, v23, v26) which can stay or be moved to archive
```

### 2b. Verify cheat files exist for all 9 active versions

```bash
for v in v19 v21.7 v22.8 v24 v25 v27 v27-no-pathguard v27-cap-pred8 v27-mag045; do
  if [ -f "/home/z/my-project/download/wankle-cheat-${v}.user.js" ]; then
    echo "✅ $v"
  else
    echo "❌ MISSING: $v"
  fi
done
```

All 9 should be ✅. If any A/B variant is missing, check `cheat-versions/wankle-cheat-v27-*.user.js` in the repo (those are already prefixed).

---

## STEP 3: FIX HUNTER BOT + ARCHIVE INCOMPLETE DATA (CRITICAL — DO THIS BEFORE LAUNCHING)

### 3a. Run the patch script (does everything in one shot)

```bash
bash /home/z/my-project/scripts/cheat-tests/fix-hunter-bot-telemetry.patch.sh
```

This script is idempotent and does **all** of the following:
1. Checks if `hunter-bot-v3.js` is already patched — exits early if so (safe to re-run)
2. Backs up `hunter-bot-v3.js` → `hunter-bot-v3.js.pre-patch.bak`
3. Adds 11 telemetry fields to the sample-push block (replaces the 3-line anchor with a 14-line block matching `passive-bot.js`)
4. Adds `tb.lastDodgeMoveX/Z` initialization if missing
5. Adds `dodgeMoveX/Z` reading from `dodgeDb` if missing
6. Runs `node -c` syntax check
7. **Auto-archives** all 262 hunter-bot trial data (MOVE, not delete):
   - JSONL logs for RK Fight (`custom-c69c5ff7-f4e`) and Dungeon (`custom-a6b7c90f-813`) → `archive/incomplete-hunter-telemetry/<version>-logs/`
   - Telemetry files under `telemetry/<version>/RK/` and `telemetry/<version>/Dun/` → `archive/incomplete-hunter-telemetry/<version>-telemetry/`
   - CSV rows for RK+Dun → `archive/incomplete-hunter-telemetry/<version>-RK-Dun-results.csv`, removed from active CSV
   - `trials.jsonl` entries with `map` ∈ {RK, Dun} → `archive/incomplete-hunter-telemetry/trials-incomplete.jsonl`, removed from active `trials.jsonl`
8. Triggers `telemetry-field-validator.py` to write `expected-telemetry-fields.json` so the anomaly-detector knows what fields to expect

After the patch runs, the working `trials.jsonl` should have 632 − 262 = **370 entries** (passive-bot only), and the 262 RK+Dun entries are preserved in the archive.

### 3b. Verify the patch applied correctly

```bash
# 1. Hunter bot sample push block should now have the 11 fields
grep -c "realShells\|predictedShells\|pathGuardCrosses\|dodgeMoveX" \
     /home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js
# Expected: 4 (one per field name)

# 2. Syntax check
node -c /home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js && echo "SYNTAX OK"

# 3. expected-telemetry-fields.json should now exist
ls /home/z/my-project/scripts/cheat-tests/expected-telemetry-fields.json

# 4. Working trials.jsonl should have ~370 entries (was 632, minus 262 archived)
wc -l /home/z/agent-ctx/trials.jsonl

# 5. Archive should have 262 entries
wc -l /home/z/agent-ctx/archive/incomplete-hunter-telemetry/trials-incomplete.jsonl

# 6. Each version's CSV should have lost its RK+Dun rows
for v in v19 v21.7 v22.8 v24 v25 v27; do
  CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
  rk=$(grep -c "custom-c69c5ff7-f4e" "$CSV" 2>/dev/null || echo 0)
  dun=$(grep -c "custom-a6b7c90f-813" "$CSV" 2>/dev/null || echo 0)
  echo "$v: RK=$rk Dun=$dun (should be 0/0)"
done
```

### 3c. Run telemetry-backfill (generate missing per-trial telemetry JSON files)

As of last verification, 527 of 632 trials had `telemetryFile=null` in `trials.jsonl`. After the patch archives 262 of those, you have 370 active trials — backfill generates per-trial telemetry JSON for any that are still null.

```bash
python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py
```

Takes 5-10 minutes. Safe to run anytime — only generates missing files.

### 3d. TEST BEFORE TRUSTING (mandatory — do not skip)

After patching the hunter bot, run **ONE** trial manually and inspect the JSONL output before letting the full suite run. A 90-second test saves 9 hours of reruns.

```bash
# Run a single hunter-bot trial (RK Fight, 90s)
cd /home/z/my-project/scripts/cheat-tests
bash generic-trials.sh v19 1 90 test-hunter

# Then inspect the produced JSONL log for the 11 telemetry fields
LATEST=$(ls -t parallel-v19-logs/v19-custom-c69c5ff7-f4e-t*.jsonl | head -1)
head -2 "$LATEST" | python3 -c "
import sys, json
for line in sys.stdin:
    d = json.loads(line)
    if d.get('kind') == 'sample':
        print('Sample keys:', sorted(d.keys()))
        for f in ['realShells','predictedShells','pathGuardCrosses','dodgeMoveX','dodgeMoveZ','coldSpotReactive','coldSpotStrategic','guardViolated','pathGuardRotation','pathGuardResolved','pathGuardShells']:
            print(f'  {f}: {\"PRESENT\" if f in d else \"MISSING\"}')
        break
"
```

All 11 fields must show PRESENT. If any are MISSING, do not launch the suite — investigate the bot.

**Then delete the test trial's data so it doesn't contaminate the suite:**

```bash
# Remove the test trial's CSV row
grep -v "^v19,1," parallel-v19-results.csv > parallel-v19-results.csv.tmp && \
  mv parallel-v19-results.csv.tmp parallel-v19-results.csv

# Move the test JSONL log to archive (don't delete)
mkdir -p /home/z/agent-ctx/archive/test-trials
mv "$LATEST" /home/z/agent-ctx/archive/test-trials/
```

---

## STEP 4: LAUNCH INFRASTRUCTURE (5 processes + git-backup)

### 4a. Verify watchdog monitors all 6 versions

```bash
cat /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh | grep "watchdog.py"
# Should show: watchdog.py v19 v21.7 v22.8 v24 v25 v27 --trials 30 --duration 90
```

The watchdog monitors **all 6 active versions** intentionally — baselines need hunter-bot reruns too (Step 3 archived their RK+Dun CSV rows, so drivers will re-run them with the patched bot).

If the version list is wrong, fix it:
```bash
sed -i 's/watchdog.py .*/watchdog.py v19 v21.7 v22.8 v24 v25 v27 --trials 30 --duration 90/' \
  /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh
```

### 4b. Launch all 5 infrastructure processes + git-backup

```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/telemetry-field-validator-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash -c 'while true; do /home/z/agent-ctx/git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

The `setsid -f` ensures each process survives shell exit (PPID=1). The wrappers auto-restart their Python script if it dies.

### 4c. Wait 2 min, verify trials are producing new data

```bash
sleep 120

# Process count (should be ~12-18: 6 drivers + 5 wrappers + 5 python + git-backup loop)
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|telemetry-field-validator.py|generic-trials|git-backup)" | grep -v grep | wc -l

# Trial counts per version (should be increasing as drivers rerun RK+Dun + new trials)
for v in v19 v21.7 v22.8 v24 v25 v27; do
  CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
  TRIALS=$(($(wc -l < $CSV 2>/dev/null) - 1))
  echo "$v: $TRIALS / 150"
done

# Heartbeats (should be < 30s old)
for v in v19 v21.7 v22.8 v24 v25 v27; do
  cat /home/z/my-project/scripts/cheat-tests/parallel-${v}-heartbeat 2>/dev/null
done
```

If trial counts are NOT increasing, check the driver log:
```bash
tail -50 /home/z/my-project/scripts/cheat-tests/parallel-v24-master.log
```

If heartbeats are stale (>30s old) and driver is alive → driver is hung → watchdog will kill + restart within 60s. If watchdog itself is dead, relaunch per Step 4b.

---

## STEP 5: MONITOR (your main job until 1350/1350)

Stay running. Check every ~5 minutes. Between checks, create ASCII art (see `ascii-art/README.md` for the tradition + mural schedule).

### Check command

```bash
date
cat /home/z/agent-ctx/trial-manifest.json | python3 -c "
import json, sys
m = json.load(sys.stdin)
pct = 100*m['trialsCompleted']/m['trialsTotal']
print(f'trials: {m[\"trialsCompleted\"]}/{m[\"trialsTotal\"]} ({pct:.1f}%)')
for v, d in m['perVersion'].items():
    if d['completed'] > 0 or v in ['v24','v25','v27','v27-no-pathguard','v27-cap-pred8','v27-mag045']:
        print(f'  {v}: {d[\"completed\"]}/{d[\"target\"]}')
"
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|telemetry-field-validator.py|generic-trials|git-backup)" | grep -v grep | wc -l
```

### ASCII art tradition

- **Between checks:** small creative doodles (5-15 lines). Don't repeat — find new metaphors.
- **At milestones:** BIG murals (30+ lines), save to `ascii-art/` with descriptive filenames.
- **Upcoming milestones:**
  - **675 trials** = halfway mural (1350/2)
  - **710 trials** = **DAB MURAL** (oil rig themed — user specifically requested this)
  - **900 trials** = baselines + contenders complete
  - **1350 trials** = final armada reaches shore

Themes already used (find NEW ones): dice, tanks, boats/armada, rockets, pyramids, skyscrapers, waterfalls, constellations, mountains, trains, tornado, braille rain, bar charts, burning joint, dice cups, dice tower.

### If processes die

Relaunch immediately using the commands in Step 4b. Don't wait. The `setsid -f` ensures they survive shell exit.

### If the Bash tool times out repeatedly

Tell the user: "The tool calls are timing out frequently. Please click the **restart** button in the top right corner to restart the session and try again." Do NOT silently retry more than 2 times. But the infrastructure is autonomous — it'll keep running. The git-backup pushes every 5 min so no data is lost.

---

## INFRASTRUCTURE DETAILS

### 5 infrastructure processes (each auto-restarts via bash wrapper)

| # | Process | Script | Wrapper | Function |
|---|---|---|---|---|
| 1 | **watchdog.py** | `harness/watchdog.py` | `watchdog-wrapper.sh` | Check drivers alive every 30s, restart if dead/hung (heartbeat stalled 30s+). Monitors all 6 versions. **Auto-launches A/B variants** when v24+v25+v27 all hit 150/150. |
| 2 | **manifest-updater.py** | `harness/manifest-updater.py` | `manifest-updater-wrapper.sh` | Every 30s, count trials in CSVs, write `trial-manifest.json`, append new trials to `trials.jsonl`. |
| 3 | **backup-manager.py** | `harness/backup-manager.py` | `backup-manager-wrapper.sh` | Every 30s check trial counts; backup at every 30-trial milestone + pre-switch on completion; retain last 3. |
| 4 | **anomaly-detector.py** | `harness/anomaly-detector.py` | `anomaly-detector-wrapper.sh` | Every 60s, scan CSVs for anomalies (K=0 D=0 dead in survival, missing JSONL, NaN FPS, **missing telemetry fields**). Remove anomalous rows so drivers re-run them. Max 3 retries per trial. |
| 5 | **telemetry-field-validator.py** | `harness/telemetry-field-validator.py` | `telemetry-field-validator-wrapper.sh` | Every 5 min, parse bot JS source → write `expected-telemetry-fields.json`. If someone patches a bot to add fields → re-running this auto-updates expectations. No code changes needed in anomaly-detector. |

Plus:
- **git-backup.sh** — pushes to GitHub every 5 min (runs in a loop)
- **generic-trials.sh** — one per version, runs trials sequentially (launched by watchdog)

### Heartbeat system

Each driver writes a heartbeat file every 10s: `parallel-<ver>-heartbeat`. If heartbeat stalled >30s AND driver process alive → driver is hung → watchdog kills + restarts it.

---

## A/B VARIANTS (FULLY AUTONOMOUS — no manual intervention needed)

### How the contender→A/B handoff works

1. **Watchdog starts** monitoring all 6 versions: v19, v21.7, v22.8, v24, v25, v27
2. **When v24+v25+v27 all hit 150/150**, the watchdog:
   - Checks that v27 specifically is complete (only launches A/B if v27 finished)
   - Auto-launches 3 A/B variant drivers: v27-no-pathguard, v27-cap-pred8, v27-mag045
   - Adds them to its monitoring list
   - Writes a flag file (`ab-variants-launched.flag`) so watchdog restarts don't re-launch
3. **Watchdog monitors A/B variants** until they all hit 150/150
4. **When all 9 versions complete**, watchdog logs `🎉 ALL TRIALS COMPLETE` and exits

### A/B variant details

| Variant | Modification | Cheat file |
|---|---|---|
| v27-no-pathguard | Path-segment guard disabled (`crossCount` forced to 0) | `cheat-versions/wankle-cheat-v27-no-pathguard.user.js` |
| v27-cap-pred8 | Predicted shells capped at 8 (`predictedShells.slice(0, 8)`) | `cheat-versions/wankle-cheat-v27-cap-pred8.user.js` |
| v27-mag045 | Magnetize threshold 0.35→0.45 | `cheat-versions/wankle-cheat-v27-mag045.user.js` |

All 3 are based on v27 with a single-change patch.

### Crash recovery (VM reset scenario)

If the VM dies and watchdog restarts:
- **If A/B not yet launched:** watchdog checks if contenders are complete → launches A/B normally
- **If A/B already launched:** watchdog sees the flag file OR sees A/B CSVs have data → adds A/B variants to monitoring → resumes watching them
- **If A/B was mid-run:** drivers may be dead → watchdog relaunches them (CSV skip logic prevents re-running completed trials)

The flag file (`ab-variants-launched.flag`) is the persistent marker. It lives in the cheat-tests directory and gets backed up to GitHub by `git-backup.sh`.

### What you need to do

**Nothing.** The watchdog handles everything. Just:
1. Launch the infrastructure (Step 4b)
2. Monitor (Step 5) — create ASCII art, check progress every 5 min
3. When watchdog logs `🎉 ALL TRIALS COMPLETE` → build charts → declare winner → commit to GitHub

---

## TELEMETRY INTEGRITY SYSTEM (self-healing — prevents future gaps)

The hunter-bot telemetry gap (262 trials needing rerun) happened because the bot READ telemetry into variables but never WROTE them to the sample output. Complex code hid a simple oversight. This system prevents that class of bug from going undetected again.

### How it works (3 components)

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
   - All in one script — next agent runs 1 command and everything is handled

### What this means for the next agent

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

All 5 components can be updated without halting any running process:
- Bot source files can be edited while drivers are running (drivers read the file at inject time, not at process start)
- `expected-telemetry-fields.json` can be rewritten while anomaly-detector is running (it reads the file fresh each cycle)
- The anomaly-detector can be killed + restarted via its wrapper (wrapper auto-restarts within 5s)
- The field validator can be killed + restarted via its wrapper

---

## WINNER DECLARATION (when all 1350 trials done)

From the user's original plan:
- 95% confidence intervals don't overlap with baseline
- Effect size > baseline's standard deviation
- Difference reproduces across all 5 maps (not just one)

When all 1350 trials complete:
1. Build comparison charts (matplotlib — see `harness/build-mass-charts.py` for reference)
2. Declare the winner based on the criteria above
3. Save charts to `trial-data/charts/` and commit to GitHub

---

## RULES (FINAL — read these last)

### 1. NEVER blindly trust files

The manifest said "638 trials" but reality was 632 — 6 phantom entries. The hunter bot "had telemetry" but didn't write it to samples. Always VERIFY against raw JSONL logs — they are the source of truth, not CSVs, not the manifest, not `trials.jsonl`. If something seems wrong, check the raw logs.

### 2. ALWAYS double-check

- Before launching: manually inspect ONE trial's JSONL log for expected fields (Step 3d)
- Before declaring complete: verify CSV row count = raw log file count
- Before trusting the anomaly detector: verify it's actually catching things (check `anomaly-log.jsonl`)

### 3. KEEP IT SIMPLE

The bot scripts and telemetry collection should be dead simple. If you're adding complexity, you're adding failure modes. The hunter-bot gap happened because the bot READ telemetry into variables but never WROTE them to the sample output — a simple oversight that complex code hides. Prefer explicit, verbose, obvious code over clever abstractions.

### 4. TEST BEFORE TRUSTING

After patching any bot, run ONE trial manually and inspect the JSONL output. A 90-second test saves 9 hours of reruns.

### 5. THE USER IS WATCHING

They caught the hunter-bot gap. They caught the stale manifest. They caught the phantom entries. They will catch your mistakes too. Be honest about what you find, even if it's bad news. Bad news early is better than bad news late.

### 6. ARCHIVE, DON'T DELETE

Never delete data. Move it to `archive/`. You might need it later. The old hunter-bot trials still have valid kill/death data even without dodge telemetry.

### 7. STAY RUNNING

The user wants you to monitor continuously, create ASCII art between checks, and not stop until all 1350 trials are done. If the Bash tool times out, tell the user to restart — but the infrastructure keeps running autonomously.

### 8. WHEN IN DOUBT, CHECK THE RAW LOGS

They are the single source of truth. Everything else (CSV, manifest, `trials.jsonl`, telemetry JSON) is derived and can be rebuilt.

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
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|telemetry-field-validator.py|generic-trials|git-backup)" | grep -v grep | wc -l
```

If trials < 1350 and processes = 0, launch everything per Step 4b.

If trials = 1350 and watchdog logged `🎉 ALL TRIALS COMPLETE`, proceed to Winner Declaration.

---

## FILE LOCATIONS (quick reference)

### Source of truth (in repo, pushed to GitHub every 5 min)
- `/home/z/agent-ctx/trial-manifest.json` — progress + file locations (derived)
- `/home/z/agent-ctx/trials.jsonl` — all trial results, one JSON per line (derived)
- `/home/z/agent-ctx/telemetry/{version}/{map}/trial-NNN.json` — per-trial frame data (derived)
- **`/home/z/my-project/scripts/cheat-tests/parallel-<ver>-logs/`** — raw JSONL logs (SOURCE OF TRUTH)

### Trial data (raw, in working dir)
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-results.csv` — per-version CSV
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-heartbeat` — driver heartbeat (10s write)

### Cheat versions
- `/home/z/my-project/download/wankle-cheat-v*.user.js` — all versions (after Step 2a rename)

### Infrastructure scripts
- `/home/z/my-project/scripts/cheat-tests/*.py` — all Python scripts
- `/home/z/my-project/scripts/cheat-tests/*.sh` — all shell scripts + wrappers

### Backups
- `/home/z/my-project/download/backups/trial-watchdog-backups/` — local backups (last 3 per version)
- **GitHub repo** — offsite backup, pushed every 5 min by `git-backup.sh`

### Archive (incomplete data — never delete, always move here)
- `/home/z/agent-ctx/archive/incomplete-hunter-telemetry/` — old hunter-bot trials with missing dodge fields (kill/death data still valid)
- `/home/z/agent-ctx/archive/test-trials/` — manual test trials (Step 3d)
