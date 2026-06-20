#!/usr/bin/env bash
# generic-trials.sh — single-process trial driver for any version, N trials per map.
# Usage: bash generic-trials.sh <version> <num_trials> <duration_sec> <session_name>
# Env: MAPS_FILTER="survival|dodge|all" (default: all)
set -u

VER="${1:?usage: $0 <version> <num_trials> <duration_sec> <session_name>}"
NTRIALS="${2:?}"
DURATION="${3:-90}"
SESSION="${4:-p${VER}}"

LOGROOT="/home/z/my-project/scripts/cheat-tests"
RESULTS_CSV="$LOGROOT/parallel-${VER}-results.csv"
DRIVER_LOG="$LOGROOT/parallel-${VER}-master.log"

if [[ ! -f "$RESULTS_CSV" ]]; then
  echo "version,trial,kills,deaths,wave,alive,hp,enemyCount,durationSec,avgFps,minFps,maxEnemies,botType,levelId,mode,aimbotOff,jsonlFile,corrBuckets" > "$RESULTS_CSV"
fi

ts() { date '+%H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$DRIVER_LOG"; }

mkdir -p "$LOGROOT/parallel-${VER}-runlogs" "$LOGROOT/parallel-${VER}-logs"

# v27-watchdog-upgrade: HEARTBEAT — write every 10s while driver runs.
# Watchdog reads this; if file mtime > 30s old, driver is hung → kill+restart.
HEARTBEAT_FILE="$LOGROOT/parallel-${VER}-heartbeat"
HEARTBEAT_PID=""
start_heartbeat() {
  if [ -n "$HEARTBEAT_PID" ] && kill -0 "$HEARTBEAT_PID" 2>/dev/null; then
    return
  fi
  (
    while true; do
      echo "$(date +%s) alive trial=$(grep -c "^${VER}," "$RESULTS_CSV" 2>/dev/null || echo 0)" > "$HEARTBEAT_FILE"
      sleep 10
    done
  ) &
  HEARTBEAT_PID=$!
}
start_heartbeat
trap 'kill $HEARTBEAT_PID 2>/dev/null || true' EXIT

MAPS=(
  "custom-c2738ec4-135|passive|CustomArena|survival|0"
  "custom-c69c5ff7-f4e|hunter|RKFight|survival|0"
  "custom-a6b7c90f-813|hunter|Dungeon|survival|0"
  "custom-5f697a3b-742|passive-nofire|DodgeOFF|campaign|1"
  "custom-5f697a3b-742|passive|DodgeON|campaign|0"
)

trial_done() {
  local lid="$1" ao="$2" tn="$3"
  grep -q "^${VER},${tn},.*,.*,.*,.*,.*,.*,.*,.*,.*,.*.*,${lid},.*,${ao}," "$RESULTS_CSV" 2>/dev/null
}

run_trial() {
  local level_id="$1" bot_type="$2" map_name="$3" mode="$4" aimbot_off="$5" trial="$6"
  log "RUN ${VER} t${trial} ${map_name}"
  agent-browser --session "$SESSION" close > /dev/null 2>&1 || true
  sleep 1
  TRIALS=1 TRIAL_NUM="$trial" DURATION="$DURATION" \
  BOT_TYPE="$bot_type" LEVEL_ID="$level_id" MODE="$mode" AIMBOT_OFF="$aimbot_off" \
  PARALLEL_SESSION="$SESSION" \
  PARALLEL_CSV="$RESULTS_CSV" \
  PARALLEL_JSONL_DIR="$LOGROOT/parallel-${VER}-logs" \
  PARALLEL_LOG_DIR="$LOGROOT/parallel-${VER}-runlogs" \
  timeout 220 bash "$LOGROOT/survival-showdown-parallel.sh" "$VER" \
    > "$LOGROOT/parallel-${VER}-runlogs/${VER}-t${trial}-${map_name}.log" 2>&1
  local exit=$?
  log "DONE ${VER} t${trial} ${map_name} (exit=$exit)"
}

for mapdef in "${MAPS[@]}"; do
  IFS='|' read -r LEVEL_ID BOT_TYPE MAP_NAME MODE AIMBOT_OFF <<< "$mapdef"
  for TRIAL in $(seq 1 "$NTRIALS"); do
    if trial_done "$LEVEL_ID" "$AIMBOT_OFF" "$TRIAL"; then
      log "SKIP ${VER} t${TRIAL} ${MAP_NAME} (already done)"
      continue
    fi
    run_trial "$LEVEL_ID" "$BOT_TYPE" "$MAP_NAME" "$MODE" "$AIMBOT_OFF" "$TRIAL"
  done
done

log "=== ALL ${VER} TRIALS COMPLETE ==="
cat "$RESULTS_CSV" | tee -a "$DRIVER_LOG"
