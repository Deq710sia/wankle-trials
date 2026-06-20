# Trial Infrastructure — Continuation Guide

**This document assumes you have already cloned the GitHub repo and followed `HANDOFF.md` Step 0-2.** All paths here are relative to the repo root OR to the working directories set up in HANDOFF.md Step 2.

## GitHub Access

The repo is private. Use this token for all git operations:

```
https://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@github.com/Deq710sia/wankle-trials.git
```

Or configure git credentials once:
```bash
git config --global credential.helper store
echo "https://Deq710sia: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@github.com" > ~/.git-credentials
```

## Autonomous Trial Clump Handoff (contenders → A/B variants)

The watchdog handles the handoff between trial clumps **automatically**. No manual intervention needed.

### How it works:

1. **Watchdog starts** monitoring v24, v25, v27 (contenders)
2. **When all 3 contenders hit 150/150**, the watchdog:
   - Verifies v27 specifically is complete
   - Auto-launches 3 A/B variant drivers: v27-no-pathguard, v27-cap-pred8, v27-mag045
   - Adds them to its monitoring list
   - Writes a flag file (`ab-variants-launched.flag`) so watchdog restarts don't re-launch
3. **Watchdog monitors A/B variants** until they all hit 150/150
4. **When all 9 versions complete**, watchdog logs `🎉 ALL TRIALS COMPLETE` and exits

### Crash recovery (VM reset):

If the VM dies and watchdog restarts:
- **If A/B not yet launched:** watchdog checks if contenders are complete → launches A/B normally
- **If A/B already launched:** watchdog sees the flag file OR sees A/B CSVs have data → adds A/B variants to monitoring → resumes watching them
- **If A/B was mid-run:** drivers may be dead → watchdog relaunches them (CSV skip logic prevents re-running completed trials)

The flag file (`ab-variants-launched.flag`) is the persistent marker. It lives in the cheat-tests directory and gets backed up to GitHub by git-backup.sh.

### What you need to do:

**Nothing.** Just launch the infrastructure (see below), monitor, and wait for `🎉 ALL TRIALS COMPLETE` in the watchdog log.

## Architecture (4 independent processes)

Each process is wrapped in a bash wrapper that auto-restarts it if it dies. All launched with `setsid -f` so they survive shell exit (PPID=1).

### Process 1: watchdog.py (MOST IMPORTANT — monitors drivers)
- **Script (in repo):** `harness/watchdog.py`
- **Script (working):** `/home/z/my-project/scripts/cheat-tests/watchdog.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/watchdog.log`
- **Function:** Check drivers alive every 30s, restart if dead/hung (heartbeat stalled 30s+)
- **Auto-launches A/B variants** when v24+v25+v27 all hit 150/150
- **Does NOT touch:** manifest, telemetry, backups

### Process 2: manifest-updater.py (writes manifest + trials.jsonl)
- **Script (in repo):** `harness/manifest-updater.py`
- **Script (working):** `/home/z/my-project/scripts/cheat-tests/manifest-updater.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/manifest-updater.log`
- **Function:** Every 30s, count trials in CSVs, write manifest, append new trials to trials.jsonl with summary metrics
- **Does NOT generate telemetry files**

### Process 3: backup-manager.py (backups + retention)
- **Script (in repo):** `harness/backup-manager.py`
- **Script (working):** `/home/z/my-project/scripts/cheat-tests/backup-manager.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/backup-manager.log`
- **Function:** Every 30s, check trial counts; backup at every 30-trial milestone + pre-switch on completion; retain last 3

### Process 4: anomaly-detector.py (scans for bad trials)
- **Script (in repo):** `harness/anomaly-detector.py`
- **Script (working):** `/home/z/my-project/scripts/cheat-tests/anomaly-detector.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/anomaly-detector.log`
- **Function:** Every 60s, scan CSVs for anomalies (K=0 D=0 dead in survival, missing JSONL, NaN FPS, etc.). Remove anomalous rows so drivers re-run them. Max 3 retries per trial.

### Process 5: telemetry-backfill.py (ONE-SHOT, run as needed)
- **Script (in repo):** `harness/telemetry-backfill.py`
- **Script (working):** `/home/z/my-project/scripts/cheat-tests/telemetry-backfill.py`
- **Log:** `/home/z/my-project/scripts/cheat-tests/telemetry-backfill.log`
- **Function:** Scan trials.jsonl for entries with `telemetryFile=null`, generate Tier-1 telemetry files, update pointer in trials.jsonl
- **Run periodically** (e.g., every hour) to catch up

### Process 6: git-backup loop (every 5 min)
- **Script (in repo):** `git-backup.sh`
- **Script (working):** `/home/z/agent-ctx/git-backup.sh`
- **Function:** Copy trial data from working dirs into repo, commit, push to GitHub
- **Survives session end** because launched with `setsid -f`

## Single Source of Truth

**`trial-manifest.json`** (in repo root) — read this FIRST when continuing.

```bash
cat trial-manifest.json | python3 -m json.tool
```

Key fields:
- `watchdogPid` — check `ps -p <pid>` to see if watchdog is alive
- `versionsCompleted` / `versionsInProgress` / `versionsRemaining`
- `trialsCompleted` / `trialsTotal` — overall progress
- `perVersion` — per-version CSV path + completion count
- `backupLocations` — where backups live

## How to check if everything is running

```bash
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup)" | grep -v grep | wc -l
# Should show ~12-15 processes
```

## How to launch everything (if nothing running)

```bash
# Ensure webgpu-polyfill exists (browser harness needs it)
ls /tmp/webgpu-polyfill.js || find /home/z/agent-ctx/ -name "webgpu-polyfill.js" -exec cp {} /tmp/webgpu-polyfill.js \;

# Launch all 4 infrastructure processes + git-backup
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash -c 'while true; do /home/z/agent-ctx/git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

## How to start a new batch (AUTOMATIC — no manual action needed)

**The watchdog auto-launches A/B variants when contenders complete.** You do NOT need to manually switch versions. This is handled by the "Autonomous Trial Clump Handoff" section at the top of this document.

The only time you'd need to manually intervene is if the watchdog itself dies AND the wrapper fails to restart it. In that case:

1. Verify the watchdog-wrapper.sh is running:
```bash
ps -ef | grep "watchdog-wrapper" | grep -v grep
```

2. If not running, relaunch:
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
```

3. The wrapper will start watchdog.py which will:
   - Check if contenders (v24/v25/v27) are complete
   - If yes, check if A/B variants need launching (using flag file + CSV check)
   - Launch A/B variants or resume monitoring them
   - Continue until all 9 versions hit 150/150

**Do NOT edit the version list in watchdog-wrapper.sh.** The watchdog handles version switching internally via the A/B auto-launch code.

## File locations (working directories on VM)

### Source of truth (in repo, pushed to GitHub every 5 min)
- `/home/z/agent-ctx/trial-manifest.json` — progress + file locations
- `/home/z/agent-ctx/trials.jsonl` — all trial results, one JSON per line
- `/home/z/agent-ctx/telemetry/{version}/{map}/trial-NNN.json` — per-trial frame data

### Trial data (raw, in working dir)
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-results.csv` — per-version CSV
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-logs/` — per-version JSONL logs
- `/home/z/my-project/scripts/cheat-tests/parallel-<ver>-heartbeat` — driver heartbeat (10s write)

### Cheat versions
- `/home/z/my-project/download/wankle-cheat-v*.user.js` — all versions

### Infrastructure scripts
- `/home/z/my-project/scripts/cheat-tests/*.py` — all Python scripts
- `/home/z/my-project/scripts/cheat-tests/*.sh` — all shell scripts + wrappers

### Backups
- `/home/z/my-project/download/backups/trial-watchdog-backups/` — local backups (last 3 per version)
- **GitHub repo** — offsite backup, pushed every 5 min by git-backup.sh

## Anomaly detection

The anomaly-detector scans for:
- Survival mode + K=0 + D=0 + dead = immobile cheat bug
- Missing JSONL file
- NaN/zero FPS
- Campaign mode + 0 deaths + few enemies = server didn't spawn bots

Anomalous trials are removed from CSV + retried up to 3 times. After 3 retries, they're left in CSV with reason logged to `anomaly-log.jsonl`.

## Rules

1. **The manifest is the single source of truth.** Read it first.
2. **Never manually edit CSVs** unless re-running an anomalous trial.
3. **Never kill the drivers** (generic-trials.sh) — only the watchdog should do that.
4. **If a wrapper dies, relaunch with `setsid -f`** — that's the only way processes survive shell exit.
5. **Telemetry backfill is safe to run anytime** — `python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py`
6. **Git backup runs every 5 min automatically** — don't interfere unless it's broken.
