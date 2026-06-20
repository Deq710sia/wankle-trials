# HANDOFF DOCUMENT — Wankle3D Cheat Trials

**Last updated:** 2026-06-20 ~17:30 UTC
**Status:** Trials paused. Ready for new bot to resume.
**GitHub repo:** `https://github.com/Deq710sia/wankle-trials` (private)
**GitHub token:** `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`

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

If it shows v19/v21.7/v22.8 (baselines already done), fix the wrapper:
```bash
sed -i 's/v19 v21.7 v22.8/v24 v25 v27/' /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh
pkill -f "watchdog-wrapper.sh"
pkill -f "watchdog.py v19"
sleep 3
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
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

## A/B VARIANTS (auto-launch when contenders complete)

When v24, v25, v27 all hit 150/150, the watchdog auto-launches:

| Variant | Modification | Cheat file |
|---|---|---|
| v27-no-pathguard | Path-segment guard disabled (crossCount forced to 0) | `cheat-versions/v27-no-pathguard.user.js` |
| v27-cap-pred8 | Predicted shells capped at 8 (`predictedShells.slice(0, 8)`) | `cheat-versions/v27-cap-pred8.user.js` |
| v27-mag045 | Magnetize threshold 0.35→0.45 | `cheat-versions/v27-mag045.user.js` |

All 3 are based on v27 with a single-change patch. The watchdog adds them to its monitoring list automatically.

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
