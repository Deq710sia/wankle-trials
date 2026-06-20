#!/bin/bash
# anomaly-detector-wrapper.sh — keeps anomaly-detector.py alive forever.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/anomaly-detector.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/anomaly-detector-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching anomaly-detector.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/anomaly-detector.py >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: anomaly-detector.py exited (code=$EXIT) — restarting in 5s" >> "$WRAPPER_LOG"
  sleep 5
done
