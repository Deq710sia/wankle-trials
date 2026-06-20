#!/usr/bin/env bash
# manifest-updater-wrapper.sh — keeps manifest-updater.py alive forever.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/manifest-updater.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/manifest-updater-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching manifest-updater.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/manifest-updater.py >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: manifest-updater.py exited (code=$EXIT) — restarting in 5s" >> "$WRAPPER_LOG"
  sleep 5
done
