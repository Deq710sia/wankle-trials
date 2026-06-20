#!/bin/bash
# watchdog-wrapper.sh — keeps watchdog.py alive forever.
#
# THREADED BATCH MODE (kernel.threads-max = 929 on this VM; 6 parallel Chrome
# browsers blow past it mid-trial → EAGAIN fork failures). Run 3 versions at a
# time in 3 sequential batches:
#   Batch 1: v24 v25 v27          (contenders — finish these first)
#   Batch 2: v19 v21.7 v22.8      (baselines — RK+Dun reruns)
#   Batch 3: v27-no-pathguard v27-cap-pred8 v27-mag045  (A/B variants)
#
# The active batch is read from /home/z/agent-ctx/active-batch.txt so this
# wrapper never needs editing when advancing to the next batch — just rewrite
# that file. Wrapper auto-restarts watchdog.py if it dies.
set -u
LOG=/home/z/my-project/scripts/cheat-tests/watchdog.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/watchdog-wrapper.log
BATCH_FILE=/home/z/agent-ctx/active-batch.txt

# Default to batch 1 if file missing
if [ ! -f "$BATCH_FILE" ]; then
  echo "v24 v25 v27" > "$BATCH_FILE"
fi

ts() { date '+%H:%M:%S'; }

while true; do
  BATCH=$(cat "$BATCH_FILE" 2>/dev/null || echo "v24 v25 v27")
  echo "[$(ts)] wrapper: launching watchdog.py with batch: $BATCH" >> "$WRAPPER_LOG"
  WANKLE_BATCH_MODE=1 python3 -u /home/z/my-project/scripts/cheat-tests/watchdog.py $BATCH --trials 30 --duration 90 >> "$LOG" 2>&1
  EXIT=$?
  echo "[$(ts)] wrapper: watchdog.py exited (code=$EXIT) — restarting in 5s (batch: $BATCH)" >> "$WRAPPER_LOG"
  sleep 5
done
