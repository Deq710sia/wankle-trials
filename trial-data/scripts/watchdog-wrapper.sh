#!/bin/bash
# watchdog-wrapper.sh — keeps watchdog.py alive forever.
# Monitors ALL 6 versions that need trials (baselines need hunter reruns, contenders need completion).
# Watchdog auto-launches A/B variants when v24+v25+v27 all hit 150/150.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/watchdog.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/watchdog-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching watchdog.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/watchdog.py v19 v21.7 v22.8 v24 v25 v27 --trials 30 --duration 90 >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: watchdog.py exited (code=$EXIT) — restarting in 5s" >> "$WRAPPER_LOG"
  sleep 5
done
