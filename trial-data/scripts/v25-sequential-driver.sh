#!/usr/bin/env bash
# v25-sequential-driver.sh — run all 25 v25 trials one at a time, crash-resistant.
# Each trial is a separate bash subprocess; if one fails, we still continue.
set -u

LOGROOT="/home/z/my-project/scripts/cheat-tests"
RESULTS_CSV="$LOGROOT/parallel-v25-results.csv"
DRIVER_LOG="$LOGROOT/parallel-v25-master.log"

if [[ ! -f "$RESULTS_CSV" ]]; then
  echo "version,trial,kills,deaths,wave,alive,hp,enemyCount,durationSec,avgFps,minFps,maxEnemies,botType,levelId,mode,aimbotOff,jsonlFile,corrBuckets" > "$RESULTS_CSV"
fi

ts() { date '+%H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$DRIVER_LOG"; }

# Map definitions: level_id|bot_type|map_name|mode|aimbot_off|trial_count
MAPS=(
  "custom-c2738ec4-135|passive|Custom Arena|survival|0|5"
  "custom-c69c5ff7-f4e|hunter|RK Fight|survival|0|5"
  "custom-a6b7c90f-813|hunter|Dungeon|survival|0|5"
  "custom-5f697a3b-742|passive-nofire|Dodge Training OFF|campaign|1|5"
  "custom-5f697a3b-742|passive|Dodge Training ON|campaign|0|5"
)

for mapdef in "${MAPS[@]}"; do
  IFS='|' read -r LEVEL_ID BOT_TYPE MAP_NAME MODE AIMBOT_OFF NTRIALS <<< "$mapdef"
  for TRIAL in $(seq 1 "$NTRIALS"); do
    # Check if already done
    KEY="${LEVEL_ID}|${AIMBOT_OFF}|${TRIAL}"
    if grep -q "^v25,${TRIAL},.*,.*,.*,.*,.*,.*,.*,.*,.*,.*,${BOT_TYPE},${LEVEL_ID},${MODE},${AIMBOT_OFF}," "$RESULTS_CSV" 2>/dev/null; then
      log "SKIP v25 t${TRIAL} ${MAP_NAME} (already done)"
      continue
    fi
    log "RUN v25 t${TRIAL} ${MAP_NAME} (bot=$BOT_TYPE mode=$MODE aimbot_off=$AIMBOT_OFF)"

    # Cleanup any stale browser session
    agent-browser --session pv25 close > /dev/null 2>&1 || true
    sleep 1

    # Run harness with env vars for this trial
    TRIALS=1 TRIAL_NUM="$TRIAL" DURATION=90 \
    BOT_TYPE="$BOT_TYPE" LEVEL_ID="$LEVEL_ID" MODE="$MODE" AIMBOT_OFF="$AIMBOT_OFF" \
    PARALLEL_SESSION="pv25" \
    PARALLEL_CSV="$RESULTS_CSV" \
    PARALLEL_JSONL_DIR="$LOGROOT/parallel-v25-logs" \
    PARALLEL_LOG_DIR="$LOGROOT/parallel-v25-runlogs" \
    timeout 200 bash "$LOGROOT/survival-showdown-parallel.sh" v25 \
      > "$LOGROOT/parallel-v25-runlogs/v25-t${TRIAL}-${MAP_NAME// /_}.log" 2>&1
    EXIT=$?
    log "DONE v25 t${TRIAL} ${MAP_NAME} (exit=$EXIT)"
  done
done

log "=== ALL V25 TRIALS COMPLETE ==="
log "Results CSV:"
cat "$RESULTS_CSV" | tee -a "$DRIVER_LOG"
