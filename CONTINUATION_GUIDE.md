# Trial Infrastructure — Continuation Guide

## Architecture (4 independent processes)

Each process is wrapped in a bash wrapper that auto-restarts it if it dies. All launched with `setsid -f` so they survive shell exit (PPID=1).

### Process 1: watchdog.py (MOST IMPORTANT — monitors drivers)
- **Script:** `/home/z/my-project/scripts/cheat-tests/watchdog.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/watchdog.log`
- **Function:** Check drivers alive every 30s, restart if dead/hung (heartbeat stalled 30s+)
- **Does NOT touch:** manifest, telemetry, backups

### Process 2: manifest-updater.py (writes manifest + trials.jsonl)
- **Script:** `/home/z/my-project/scripts/cheat-tests/manifest-updater.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/manifest-updater.log`
- **Function:** Every 30s, count trials in CSVs, write manifest, append new trials to trials.jsonl with summary metrics
- **Does NOT generate telemetry files**

### Process 3: backup-manager.py (backups + retention)
- **Script:** `/home/z/my-project/scripts/cheat-tests/backup-manager.py`
- **Wrapper:** `/home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh`
- **Log:** `/home/z/my-project/scripts/cheat-tests/backup-manager.log`
- **Function:** Every 30s, check trial counts; backup at every 30-trial milestone + pre-switch on completion; retain last 3

### Process 4: telemetry-backfill.py (ONE-SHOT, run as needed)
- **Script:** `/home/z/my-project/scripts/cheat-tests/telemetry-backfill.py`
- **Log:** `/home/z/my-project/scripts/cheat-tests/telemetry-backfill.log`
- **Function:** Scan trials.jsonl for entries with `telemetryFile=null`, generate Tier-1 telemetry files, update pointer in trials.jsonl
- **Run periodically** (e.g., every hour) to catch up

## Single Source of Truth

**`/home/z/agent-ctx/trial-manifest.json`** — read this FIRST when continuing.

```bash
cat /home/z/agent-ctx/trial-manifest.json | python3 -m json.tool
```

Key fields:
- `watchdogPid` — check `ps -p <pid>` to see if watchdog is alive
- `versionsCompleted` / `versionsInProgress` / `versionsRemaining`
- `trialsCompleted` / `trialsTotal` — overall progress
- `perVersion` — per-version CSV path + completion count
- `backupLocations` — where backups live

## How to check if everything is running

```bash
ps -ef | grep -E "(wrapper.sh|watchdog.py|manifest-updater.py|backup-manager.py)" | grep -v grep
```

Should show 6 processes: 3 bash wrappers + 3 python scripts.

If any are missing, relaunch the missing one:
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/<missing>-wrapper.sh > /dev/null 2>&1 < /dev/null
```

## How to check trial progress

```bash
# Quick count
for v in v19 v21.7 v22.8 v24 v25 v27; do
  CSV=/home/z/my-project/scripts/cheat-tests/parallel-${v}-results.csv
  echo "$v: $(($(wc -l < $CSV 2>/dev/null) - 1)) / 150"
done

# Or read the manifest
python3 -c "import json; m=json.load(open('/home/z/agent-ctx/trial-manifest.json')); print(f'{m[\"trialsCompleted\"]}/{m[\"trialsTotal\"]} trials, {len(m[\"versionsCompleted\"])} versions complete')"
```

## How to run telemetry backfill (catch up on missing telemetry files)

```bash
python3 /home/z/my-project/scripts/cheat-tests/telemetry-backfill.py
```

This is a one-shot — run it whenever you want to generate telemetry files for trials that don't have them yet. Safe to re-run.

## How to start a new batch (e.g., contenders after baselines)

When baselines (v19, v21.7, v22.8) are all complete:

1. Kill the current watchdog wrapper:
```bash
pkill -f "watchdog-wrapper.sh"
pkill -f "watchdog.py"
```

2. Launch new watchdog with contender versions:
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
```

But FIRST edit `watchdog-wrapper.sh` to use the new version list:
```bash
sed -i 's/v19 v21.7 v22.8/v24 v25 v27/' /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh
```

3. The manifest-updater and backup-manager don't need restarting — they already handle all 6 planned versions.

## Anomaly detection

The watchdog does NOT do anomaly detection (kept bare-minimum). Anomaly detection is built into the harness itself: `generic-trials.sh` skips trials already in the CSV, so anomalous trials would need to be manually removed from the CSV to be re-run.

If you need to re-run an anomalous trial:
```bash
# Find the trial row
grep "^v19,5," /home/z/my-project/scripts/cheat-tests/parallel-v19-results.csv
# Delete that row manually, then the next driver run will redo it
```

## File locations summary

- Manifest: `/home/z/agent-ctx/trial-manifest.json`
- Trials JSONL: `/home/z/agent-ctx/trials.jsonl`
- Telemetry files: `/home/z/agent-ctx/telemetry/{version}/{map}/trial-{N:03d}.json`
- Per-version CSVs: `/home/z/my-project/scripts/cheat-tests/parallel-{ver}-results.csv`
- Per-version JSONL logs: `/home/z/my-project/scripts/cheat-tests/parallel-{ver}-logs/`
- Backups: `/home/z/my-project/download/backups/trial-watchdog-backups/`
- Process logs: `/home/z/my-project/scripts/cheat-tests/{watchdog,manifest-updater,backup-manager,telemetry-backfill}.log`
- Wrapper auto-restart logs: `/home/z/my-project/scripts/cheat-tests/{watchdog,manifest-updater,backup-manager}-wrapper.log`

## Rules

1. **The manifest is the single source of truth.** Read it first.
2. **Never manually edit CSVs** unless re-running an anomalous trial.
3. **Never kill the drivers** (generic-trials.sh) — only the watchdog should do that.
4. **If a wrapper dies, relaunch with `setsid -f`** — that's the only way processes survive shell exit in this environment.
5. **Telemetry backfill is safe to run anytime** — it only generates missing files.
