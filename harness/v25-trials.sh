#!/usr/bin/env bash
# v25-trials.sh — single-process trial driver. No subprocess management.
# Each trial runs synchronously; results appended to CSV.
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
  "custom-c2738ec4-135|passive|CustomArena|survival|0|5"
  "custom-c69c5ff7-f4e|hunter|RKFight|survival|0|5"
  "custom-a6b7c90f-813|hunter|Dungeon|survival|0|5"
  "custom-5f697a3b-742|passive-nofire|DodgeOFF|campaign|1|5"
  "custom-5f697a3b-742|passive|DodgeON|campaign|0|5"
)

# trial_done LEVEL_ID AIMBOT_OFF TRIAL  — returns 0 if already in CSV
trial_done() {
  local lid="$1" ao="$2" tn="$3"
  grep -q "^v25,${tn},.*,.*,.*,.*,.*,.*,.*,.*,.*,.*.*,${lid},.*,${ao}," "$RESULTS_CSV" 2>/dev/null
}

run_trial() {
  local level_id="$1" bot_type="$2" map_name="$3" mode="$4" aimbot_off="$5" trial="$6"
  log "RUN v25 t${trial} ${map_name} (bot=$bot_type mode=$mode aimbot_off=$aimbot_off)"
  agent-browser --session pv25 close > /dev/null 2>&1 || true
  sleep 1
  TRIALS=1 TRIAL_NUM="$trial" DURATION=90 \
  BOT_TYPE="$bot_type" LEVEL_ID="$level_id" MODE="$mode" AIMBOT_OFF="$aimbot_off" \
  PARALLEL_SESSION="pv25" \
  PARALLEL_CSV="$RESULTS_CSV" \
  PARALLEL_JSONL_DIR="$LOGROOT/parallel-v25-logs" \
  PARALLEL_LOG_DIR="$LOGROOT/parallel-v25-runlogs" \
  timeout 220 bash "$LOGROOT/survival-showdown-parallel.sh" v25 \
    > "$LOGROOT/parallel-v25-runlogs/v25-t${trial}-${map_name}.log" 2>&1
  local exit=$?
  log "DONE v25 t${trial} ${map_name} (exit=$exit)"
}

for mapdef in "${MAPS[@]}"; do
  IFS='|' read -r LEVEL_ID BOT_TYPE MAP_NAME MODE AIMBOT_OFF NTRIALS <<< "$mapdef"
  for TRIAL in $(seq 1 "$NTRIALS"); do
    if trial_done "$LEVEL_ID" "$AIMBOT_OFF" "$TRIAL"; then
      log "SKIP v25 t${TRIAL} ${MAP_NAME} (already done)"
      continue
    fi
    run_trial "$LEVEL_ID" "$BOT_TYPE" "$MAP_NAME" "$MODE" "$AIMBOT_OFF" "$TRIAL"
  done
done

log "=== ALL V25 TRIALS COMPLETE ==="
cat "$RESULTS_CSV" | tee -a "$DRIVER_LOG"
