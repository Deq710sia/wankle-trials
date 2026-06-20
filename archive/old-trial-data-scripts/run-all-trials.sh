#!/usr/bin/env bash
# Master script: runs all 60 trials (4 versions × 3 maps × 5 trials)
# Writes progress to /home/z/my-project/scripts/cheat-tests/master-progress.log
# Each line: <timestamp> <phase> <message>
LOG=/home/z/my-project/scripts/cheat-tests/master-progress.log
cd /home/z/my-project/scripts/cheat-tests

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "START 60 trials (v19, v21.7, v22.0, v22.2 × 3 maps × 5 trials)"

# Phase 1: Custom Arena (passive bot, open map)
log "PHASE 1/3: Custom Arena (passive) — 20 trials"
TRIALS=5 DURATION=90 BOT_TYPE=passive LEVEL_ID=custom-c2738ec4-135 \
  bash survival-showdown-v2.sh v19 v21.7 v22.0 v22.2 >> "$LOG" 2>&1
log "PHASE 1/3 COMPLETE"

# Phase 2: RK Fight (hunter bot, wall-dense)
log "PHASE 2/3: RK Fight (hunter) — 20 trials"
TRIALS=5 DURATION=90 BOT_TYPE=hunter LEVEL_ID=custom-c69c5ff7-f4e \
  bash survival-showdown-v2.sh v19 v21.7 v22.0 v22.2 >> "$LOG" 2>&1
log "PHASE 2/3 COMPLETE"

# Phase 3: Dungeon (hunter bot, maze)
log "PHASE 3/3: Dungeon (hunter) — 20 trials"
TRIALS=5 DURATION=90 BOT_TYPE=hunter LEVEL_ID=custom-a6b7c90f-813 \
  bash survival-showdown-v2.sh v19 v21.7 v22.0 v22.2 >> "$LOG" 2>&1
log "PHASE 3/3 COMPLETE"

# Count results
RESULTS_COUNT=$(wc -l < /home/z/my-project/scripts/cheat-tests/survival-results.csv)
TRIAL_LOG_COUNT=$(ls /home/z/my-project/scripts/cheat-tests/trial-logs/*.jsonl 2>/dev/null | wc -l)
log "DONE. CSV rows: $RESULTS_COUNT (incl header). Trial logs: $TRIAL_LOG_COUNT"
