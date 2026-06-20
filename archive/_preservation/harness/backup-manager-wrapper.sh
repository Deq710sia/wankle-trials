#!/usr/bin/env bash
# backup-manager-wrapper.sh — keeps backup-manager.py alive forever.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/backup-manager.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/backup-manager-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching backup-manager.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/backup-manager.py >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: backup-manager.py exited (code=$EXIT) — restarting in 5s" >> "$WRAPPER_LOG"
  sleep 5
done
