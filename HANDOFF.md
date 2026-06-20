# HANDOFF DOCUMENT — Wankle3D Cheat Trials

**Last updated:** 2026-06-20 ~17:00 UTC
**Status:** Recovery from VM reset, trials resuming
**GitHub repo:** https://github.com/Deq710sia/wankle-trials (private)
**GitHub token:** `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`

---

## WHO YOU ARE

You are the next agent picking up a long-running trial suite for an aimbot/dodge cheat for Wankle3D (wanshot.lol), a 3D multiplayer tank game. The previous agent ran ~450 trials, then the VM was reset (user slept their PC). You need to resume from where it left off.

**READ THIS ENTIRE DOCUMENT BEFORE DOING ANYTHING.** Then read `/home/z/agent-ctx/trial-manifest.json` for current state.

---

## CURRENT STATE (as of last known good data)

### Trials completed: 632/1350 (46.8%)

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
**Remaining:** 718 trials (~8 hours wall clock at 3 parallel)

---

## WHAT HAPPENED (VM RESET TIMELINE)

1. **~05:42 UTC Jun 20** — Baseline trials launched (v19, v21.7, v22.8)
2. **~10:02 UTC** — Baselines complete, contenders launched (v24, v25, v27)
3. **~10:14 UTC** — Watchdog patched with A/B auto-launch code
4. **~11:26 UTC** — Last successful git backup (632 trials complete)
5. **~11:26-16:44 UTC** — **VM RESET** (user slept their PC). All processes died.
6. **~16:44 UTC** — VM back up. Agent-ctx dir gone, scripts gone, only base cheat files survived.
7. **~16:46 UTC** — Recovery: cloned GitHub repo, restored everything, relaunched infrastructure.

---

## INFRASTRUCTURE (4 INDEPENDENT PROCESSES)

All scripts live in `/home/z/my-project/scripts/cheat-tests/`. Each process has a bash wrapper that auto-restarts it if it dies. Launch with `setsid -f` so they survive session end.

### 1. watchdog.py (MOST IMPORTANT)
- **Wrapper:** `watchdog-wrapper.sh`
- **Monitors:** v24, v25, v27 (contenders)
- **Auto-launches A/B variants** when v24+v25+v27 all hit 150/150
- **Heartbeat check:** if heartbeat stalled >30s, kill + restart driver
- **Launch:**
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
```

### 2. manifest-updater.py
- **Wrapper:** `manifest-updater-wrapper.sh`
- **Writes:** `/home/z/agent-ctx/trial-manifest.json` + `/home/z/agent-ctx/trials.jsonl`
- **Every 30s:** counts trials in CSVs, appends new ones to trials.jsonl with summary metrics
- **Launch:**
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
```

### 3. backup-manager.py
- **Wrapper:** `backup-manager-wrapper.sh`
- **Every 30 trials per version:** backs up CSV + JSONL to `/home/z/my-project/download/backups/trial-watchdog-backups/`
- **Retention:** keeps last 3 backups per version
- **Pre-switch backup:** when a version completes, backs up before "switching"
- **Launch:**
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
```

### 4. anomaly-detector.py
- **Wrapper:** `anomaly-detector-wrapper.sh`
- **Every 60s:** scans CSVs for anomalies (K=0 D=0 dead in survival = immobile cheat bug, missing JSONL, NaN FPS, etc.)
- **Removes anomalous rows** so drivers re-run them (max 3 retries per trial)
- **Logs to:** `/home/z/my-project/scripts/cheat-tests/anomaly-log.jsonl`
- **Launch:**
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
```

### 5. git-backup loop (every 5 min)
- **Script:** `/home/z/agent-ctx/git-backup.sh`
- **Pushes** all trial data to GitHub every 5 minutes
- **Launch:**
```bash
setsid -f bash -c 'while true; do /home/z/agent-ctx/git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

---

## TRIAL DRIVERS

Each version has a driver (`generic-trials.sh`) that runs trials sequentially. Launched by watchdog.

**Driver command:** `bash generic-trials.sh <version> <num_trials> <duration> <session_name>`

- **Trials per version:** 30 per map × 5 maps = 150
- **Maps:** Custom Arena (survival), RK Fight (survival), Dungeon (survival), Dodge Training OFF (campaign, aimbot off), Dodge Training ON (campaign, aimbot on)
- **Duration:** 90 seconds per trial
- **Browser session:** each version gets its own (e.g. `pv24`, `pv25`, `pv27`)

**Driver writes heartbeat every 10s:** `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-heartbeat`

---

## FILE LOCATIONS

### Source of truth
- `/home/z/agent-ctx/trial-manifest.json` — **READ THIS FIRST** (progress + file locations)
- `/home/z/agent-ctx/trials.jsonl` — all trial results, one JSON per line
- `/home/z/agent-ctx/telemetry/{version}/{map}/trial-NNN.json` — per-trial frame data

### Trial data (raw)
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-results.csv` — per-version CSV
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-logs/` — per-version JSONL logs

### Cheat versions
- `/home/z/my-project/download/wankle-cheat-v*.user.js` — all versions v19 through v27 + 3 A/B variants

### Infrastructure scripts
- `/home/z/my-project/scripts/cheat-tests/*.py` — watchdog, manifest-updater, backup-manager, anomaly-detector, telemetry-backfill
- `/home/z/my-project/scripts/cheat-tests/*.sh` — wrappers + generic-trials.sh + survival-showdown-parallel.sh (per-trial harness)

### Bots
- `/home/z/my-project/scripts/cheat-tests/passive-bot.js` — passive bot (fires only for respawn)
- `/home/z/my-project/scripts/cheat-tests/passive-nofire-bot.js` — pure dodge bot (never fires)
- `/home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js` — aggressive hunter bot

### Backups
- `/home/z/my-project/download/backups/trial-watchdog-backups/` — local backups (last 3 per version)
- **GitHub repo** — offsite backup, pushed every 5 min

### ASCII art archive
- `/home/z/agent-ctx/ascii-art/` — all murals + between-check doodles from previous agent

---

## HOW TO RESUME (if processes are dead)

### Step 1: Read the manifest
```bash
cat /home/z/agent-ctx/trial-manifest.json | python3 -m json.tool
```

### Step 2: Check what's running
```bash
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup)" | grep -v grep
```

### Step 3: If nothing running, launch everything
```bash
# Restore webgpu-polyfill (harness needs it)
cp /home/z/my-project/download/webgpu-polyfill.js /tmp/webgpu-polyfill.js

# Launch all 4 infrastructure processes + git-backup
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash -c 'while true; do /home/z/agent-ctx/git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

### Step 4: Verify watchdog is monitoring the right versions
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

### Step 5: Wait 2 min, verify trials are producing new data
```bash
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

## MONITORING BEHAVIOR (IMPORTANT)

The previous agent stayed running for 6+ hours, checking every ~5 minutes. Between checks it created ASCII art to fill the time. **You should do the same:**

1. **Check every 5 minutes:**
```bash
date; cat /home/z/agent-ctx/trial-manifest.json | python3 -c "
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

2. **Between checks: create ASCII art.** Be creative — don't repeat. Themes used so far: dice, tanks, boats/armada, rockets, pyramids, skyscrapers, waterfalls, constellations, mountains, trains, tornado, braille rain, bar charts, burning joint. Find NEW metaphors.

3. **At major milestones, create BIG murals** (30+ lines):
   - **675 trials** = halfway mural (1350/2)
   - **710 trials** = **DAB MURAL** (oil rig themed — user specifically requested this)
   - **900 trials** = baselines + contenders complete
   - **1350 trials** = final armada reaches shore
   - Save murals to `/home/z/agent-ctx/ascii-art/` with descriptive filenames

4. **Always include in checks:** trial count, percentage, process count (expect ~12-15), per-version progress bars

5. **If processes die:** relaunch immediately using the commands above. Don't wait.

6. **If Bash tool times out repeatedly:** tell the user to restart the session, but the infrastructure is autonomous — it'll keep running.

---

## A/B VARIANT DETAILS

When v24, v25, v27 all hit 150/150, the watchdog auto-launches 3 A/B variants:

| Variant | Modification | File |
|---|---|---|
| v27-no-pathguard | Path-segment guard disabled (crossCount forced to 0) | `wankle-cheat-v27-no-pathguard.user.js` |
| v27-cap-pred8 | Predicted shells capped at 8 (`predictedShells.slice(0, 8)`) | `wankle-cheat-v27-cap-pred8.user.js` |
| v27-mag045 | Magnetize threshold 0.35→0.45 | `wankle-cheat-v27-mag045.user.js` |

All 3 are based on v27 with a single-change patch. The watchdog adds them to its monitoring list automatically.

---

## CHEAT VERSION HISTORY (for context)

- **v19** — earliest simple version, minimal dodge complexity
- **v21.7** — pre-cold-spot, simple vector dodge ("works great" reference)
- **v22.8** — cold-spot + per-shell vector dodge
- **v24** — last version before magnetize fix
- **v25** — magnetize fix + path-guard + 360° dodge + burst fire + no stickiness
- **v26** — v25 + Tier-2 prediction engine + randomized safe-direction (intermediate, not in trial suite)
- **v27** — v25-opt (slimmed) + v26's features properly ported + dead-code cuts

### v27 bug fixes applied:
1. **Fire decision broken** — `shellsInFlight` was undefined in canFire check. Fixed: re-added `var shellsInFlight = myShells;`
2. **Pattern memory silently dead** — typo in prediction engine (`h.length - 2]` instead of `h[h.length - 2]`). Fixed.

---

## MAPS

| Code | Map name | Mode | Notes |
|---|---|---|---|
| CA | Custom Arena | survival | open map, 6-7 enemies |
| RK | RK Fight | survival | wall-dense, bank shots |
| Dun | Dungeon | survival | small map, corner deaths |
| DT-off | Dodge Training (aimbot OFF) | campaign | 72 enemies, pure dodge test |
| DT-on | Dodge Training (aimbot ON) | campaign | 72 enemies, realistic (fire-stun) |

Level IDs:
- Custom Arena: `custom-c2738ec4-135`
- RK Fight: `custom-c69c5ff7-f4e`
- Dungeon: `custom-a6b7c90f-813`
- Dodge Training: `custom-5f697a3b-742`

---

## RULES

1. **The manifest is the single source of truth.** Read it first.
2. **Never manually edit CSVs** unless re-running an anomalous trial.
3. **Never kill the drivers** (generic-trials.sh) — only the watchdog should do that.
4. **If a wrapper dies, relaunch with `setsid -f`** — that's the only way processes survive shell exit.
5. **Telemetry backfill is safe to run anytime** — `python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py`
6. **Git backup runs every 5 min automatically** — don't interfere unless it's broken.
7. **Stay running.** The user wants you to monitor continuously, create ASCII art between checks, and only stop when trials are done.
8. **When trials complete (1350/1350)** — make MASS charts comparing all versions, declare winner based on 95% confidence intervals.

---

## WINNER DECLARATION CRITERIA

From the user's original plan:
- 95% confidence intervals don't overlap with baseline
- Effect size > baseline's standard deviation
- Difference reproduces across all 5 maps (not just one)

When all 1350 trials are done, build comparison charts and declare the winner.

---

## ASCII ART REFERENCE

See `/home/z/agent-ctx/ascii-art/` for all previous murals + doodles. Read the `README.md` there for the mural schedule and style notes. **Continue the tradition** — the user specifically wants creative, non-repeating ASCII art between checks, and themed murals at milestones.

---

## QUICK SANITY CHECK COMMAND

Run this first to verify everything is healthy:
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

If trials < 1350 and processes = 0, launch everything per "HOW TO RESUME" above.
