#!/bin/bash
# batch-orchestrator-wrapper.sh — keeps batch-orchestrator.py alive forever.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/batch-orchestrator.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/batch-orchestrator-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching batch-orchestrator.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/batch-orchestrator.py >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: batch-orchestrator.py exited (code=$EXIT) — restarting in 5s" >> "$WRAPPER_LOG"
  sleep 5
done
