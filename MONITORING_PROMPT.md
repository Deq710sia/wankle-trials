# MONITORING PROMPT — For after setup-and-launch.sh has been run

You are monitoring a trial suite that's already running. The infrastructure is live. Your job: monitor, create ASCII art, and wait for completion.

## What's already done (don't redo)
- Repo cloned, files in working directories
- Hunter bot patched (11 telemetry fields added)
- Old incomplete data archived (262 trials moved to archive/)
- All 5 infrastructure processes launched + git-backup running
- Watchdog monitors all 6 versions (v19 v21.7 v22.8 v24 v25 v27)
- Watchdog will auto-launch A/B variants when contenders complete

## Your job: MONITOR
Every 5 minutes, check:

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
ps -ef | grep -E "(wrapper|watchdog.py|manifest-updater.py|backup-manager.py|anomaly-detector.py|generic-trials|git-backup|telemetry-field)" | grep -v grep | wc -l
```

## Between checks: ASCII ART
Read `ascii-art/README.md` for the mural schedule + style notes. Create unique, creative ASCII art between checks. Don't repeat themes. Save murals to `ascii-art/`.

Upcoming milestones:
- 675 trials = HALFWAY mural
- 710 trials = **DAB MURAL** (oil rig themed — user specifically requested this)
- 900 trials = baselines + contenders complete
- 1350 trials = FINAL mural + build comparison charts + declare winner

## If processes die
Relaunch with:
```bash
setsid -f bash /home/z/my-project/scripts/cheat-tests/watchdog-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash /home/z/my-project/scripts/cheat-tests/telemetry-field-validator-wrapper.sh > /dev/null 2>&1 < /dev/null
setsid -f bash -c 'cd /home/z/agent-ctx && while true; do bash git-backup.sh; sleep 300; done' > /dev/null 2>&1 < /dev/null
```

## Rules
1. NEVER blindly trust files — verify against raw JSONL logs
2. ALWAYS double-check before declaring anything complete
3. STAY RUNNING — don't stop until 1350/1350 trials done
4. Archive, don't delete
5. Be honest about problems
6. When all 1350 done → build charts → declare winner → commit to GitHub
