#!/usr/bin/env bash
# survival-showdown-v2.sh — robust harness with per-step verification.
set -u
LOG_DIR="/home/z/my-project/scripts/cheat-tests/logs"
TRIAL_LOG_DIR="/home/z/my-project/scripts/cheat-tests/trial-logs"
mkdir -p "$LOG_DIR" "$TRIAL_LOG_DIR"

VERSIONS_DEFAULT=("v22.1")
if [[ $# -gt 0 ]]; then
  VERSIONS=("$@")
else
  VERSIONS=("${VERSIONS_DEFAULT[@]}")
fi
TRIALS="${TRIALS:-2}"
DURATION="${DURATION:-90}"
BOT_TYPE="${BOT_TYPE:-passive}"
LEVEL_ID="${LEVEL_ID:-custom-c2738ec4-135}"
MODE="${MODE:-survival}"              # v22.3: support campaign mode for Dodge Training
AIMBOT_OFF="${AIMBOT_OFF:-0}"        # v22.3: 1 = disable aimbot+triggerbot (for pure dodge tests)
# v22.2: support running a SINGLE specific trial number (for retry logic).
# If TRIAL_NUM is set, only that trial number is run (TRIALS is ignored).
# If TRIAL_NUM is not set, runs trials 1..TRIALS as before.

if [[ "$BOT_TYPE" == "chase" ]]; then
  BOT_JS=$(cat /home/z/my-project/scripts/cheat-tests/test-bot-v2.js)
elif [[ "$BOT_TYPE" == "hunter_v3" ]] || [[ "$BOT_TYPE" == "hunter" ]]; then
  BOT_JS=$(cat /home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js)
elif [[ "$BOT_TYPE" == "human" ]]; then
  BOT_JS=$(cat /home/z/my-project/scripts/cheat-tests/human-bot.js)
elif [[ "$BOT_TYPE" == "passive-nofire" ]]; then
  # v22.5: passive bot that NEVER sets input.fire — for pure dodge tests.
  # Cheat's auto-respawn (cfg.autoRespawn=true in Safe profile) handles respawning.
  BOT_JS=$(cat /home/z/my-project/scripts/cheat-tests/passive-nofire-bot.js)
else
  BOT_JS=$(cat /home/z/my-project/scripts/cheat-tests/passive-bot.js)
fi
RESULTS_CSV="/home/z/my-project/scripts/cheat-tests/survival-results.csv"
if [[ ! -f "$RESULTS_CSV" ]]; then
  echo "version,trial,kills,deaths,wave,alive,hp,enemyCount,durationSec,avgFps,minFps,maxEnemies,botType,levelId,mode,aimbotOff,jsonlFile,corrBuckets" > "$RESULTS_CSV"
fi

ab() { agent-browser "$@" 2>&1; }

wait_until() {
  local timeout=$1 expr=$2
  for _ in $(seq 1 "$timeout"); do
    local r; r=$(ab eval "$expr" 2>/dev/null | tr -d '"' || true)
    if [[ "$r" == "true" || "$r" == "1" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

prep_inject() {
  local file=$1
  python3 - "$file" <<'PYEOF'
import json, re, sys
with open(sys.argv[1]) as f: src = f.read()
src = re.sub(r'// ==UserScript==.*?// ==/UserScript==', '', src, count=1, flags=re.DOTALL)
js = "(function(){ var s = " + json.dumps(src) + "; try { (0, eval)(s); return 'OK'; } catch(e) { return 'ERROR: ' + e.message; } })()"
with open('/tmp/inject-ver.js', 'w') as f: f.write(js)
PYEOF
}

open_and_wait() {
  ab close > /dev/null 2>&1 || true; sleep 1
  AGENT_BROWSER_INIT_SCRIPTS=/tmp/webgpu-polyfill.js ab open "https://wanshot.lol/" > /dev/null 2>&1 || true
  if ! wait_until 20 "(!!(window.WANKLE && WANKLE.net && WANKLE.R))"; then
    echo "  ! WANKLE not ready after 20s"; return 1
  fi
  return 0
}

inject_cheat() {
  local r
  r=$(cat /tmp/inject-ver.js | ab eval --stdin 2>/dev/null | tr -d '"')
  echo "$r"
  ab eval "(function(){ if (typeof window._wklCfg !== 'undefined') { window._wklCfg.mineDrill = false; } return 'mines_disabled'; })()" > /dev/null 2>&1 || true
  # v22.5: use Safe profile via window._wklApplyProfile + VERIFY it actually applied.
  # Retry up to 3 times with verification — if Safe isn't applied, the cheat fires
  # intercept shells which muddies the pure dodge test.
  if [[ "$AIMBOT_OFF" == "1" ]]; then
    local profile_verified=false
    for attempt in 1 2 3; do
      ab eval "(function(){ if (typeof window._wklApplyProfile === 'function') { window._wklApplyProfile('Safe'); return 'ok'; } return 'no_fn'; })()" > /dev/null 2>&1 || true
      sleep 0.3
      local verify
      verify=$(ab eval "(function(){ try { return JSON.stringify({a:window._wklCfg.aimbot, t:window._wklCfg.triggerbot, s:window._wklCfg.shellIntercept}); } catch(e){ return 'err:'+e.message; } })()" 2>/dev/null | tr -d '"')
      if echo "$verify" | grep -q '"a":false' && echo "$verify" | grep -q '"t":false' && echo "$verify" | grep -q '"s":false'; then
        profile_verified=true
        echo "  [profile] Safe verified (attempt $attempt): $verify" >&2
        break
      else
        echo "  [profile] Safe NOT applied (attempt $attempt): $verify" >&2
      fi
    done
    if [[ "$profile_verified" != "true" ]]; then
      echo "  [profile] WARNING: could not verify Safe after 3 attempts" >&2
    fi
  fi
}

join_survival() {
  # v22.3: $MODE controls room mode ('survival' or 'campaign')
  local ROOM_JSON
  ROOM_JSON=$(ab eval "(async function(){
    try {
      var res = await fetch('/api/rooms', {
        method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({name:'Bot Test', mode:'$MODE', levelId:'$LEVEL_ID', scoreLimit:0, cap:12, private:true})
      });
      if (!res.ok) return 'ERR: ' + await res.text();
      var data = await res.json(); window._testRoomId = data.id;
      return JSON.stringify({ok:true, id:data.id, levelName:data.levelName, mode:data.mode});
    } catch(e) { return JSON.stringify({ok:false, error:e.message}); }
  })()" 2>/dev/null)
  echo "  [room] $ROOM_JSON"
  local RID
  RID=$(echo "$ROOM_JSON" | python3 -c "
import json, sys
raw = sys.argv[1]
try:
    unwrapped = json.loads(raw)
    payload = unwrapped if isinstance(unwrapped, str) else raw
    d = json.loads(payload)
    print(d.get('id',''))
except: print('')
" "$ROOM_JSON")
  if [[ -z "$RID" ]]; then echo "  ! failed to create private room"; return 1; fi
  ab eval "(function(){
    var s = JSON.parse(localStorage.getItem('wankle3d-settings-v4') || '{}');
    var name = s.name || ('Bot_' + Math.random().toString(36).slice(2,7));
    WANKLE.net.connect(window._testRoomId, name, localStorage.getItem('wankle3d-client-key') || '', s.skin || 'default');
    return 'connected';
  })()" 2>/dev/null | tr -d '"'
  if ! wait_until 15 "(WANKLE.net && WANKLE.net.meta && WANKLE.net.meta.state === 'playing')"; then
    echo "  ! not playing after join"; return 1
  fi
  return 0
}

install_bot() {
  if [[ "$BOT_TYPE" == "hunter_v3" ]] || [[ "$BOT_TYPE" == "hunter" ]]; then
    ab eval "window._tbMode = 'hunter'; 'm'" > /dev/null 2>&1 || true
  else
    ab eval "window._tbMode = 'passive'; 'm'" > /dev/null 2>&1 || true
  fi
  ab eval "delete window._tb; delete window._tbLog; delete window._pb; delete window._bt2; delete window._hb; delete window._hbLog; 'c'" > /dev/null 2>&1 || true
  ab eval "window._bot = setInterval(function(){ try { $BOT_JS } catch(e){} }, 100); 'b'" > /dev/null 2>&1 || true
  sleep 1
}

for VER in "${VERSIONS[@]}"; do
  FILE="/home/z/my-project/download/wankle-cheat-${VER}.user.js"
  if [[ ! -f "$FILE" ]]; then echo "SKIP $VER (file not found)"; continue; fi
  prep_inject "$FILE"
  # v22.2: if TRIAL_NUM is set, run only that trial; otherwise run 1..TRIALS
  if [[ -n "${TRIAL_NUM:-}" ]]; then
    TRIAL_LIST=("$TRIAL_NUM")
  else
    TRIAL_LIST=($(seq 1 $TRIALS))
  fi
  for TRIAL in "${TRIAL_LIST[@]}"; do
    echo "=== $VER trial $TRIAL ==="
    T0=$(date +%s)
    LOG="$LOG_DIR/${VER}-t${TRIAL}.log"; : > "$LOG"
    if ! open_and_wait >> "$LOG" 2>&1; then echo "  FAIL: open"; echo "$VER,$TRIAL,0,0,0,0,0,0,0,0,0,0,$BOT_TYPE,$LEVEL_ID,$MODE,$AIMBOT_OFF,,0" >> "$RESULTS_CSV"; continue; fi
    INJ=$(inject_cheat); echo "  [inject] $INJ"
    if [[ "$INJ" != "OK" ]]; then echo "$VER,$TRIAL,0,0,0,0,0,0,0,0,0,0,$BOT_TYPE,$LEVEL_ID,$MODE,$AIMBOT_OFF,,0" >> "$RESULTS_CSV"; continue; fi
    if ! join_survival >> "$LOG" 2>&1; then echo "  FAIL: join"; echo "$VER,$TRIAL,0,0,0,0,0,0,0,0,0,0,$BOT_TYPE,$LEVEL_ID,$MODE,$AIMBOT_OFF,,0" >> "$RESULTS_CSV"; continue; fi
    install_bot
    echo "  [step 5] running for ${DURATION}s..."
    HALF=$(( DURATION / 2 )); sleep "$HALF"
    REMAIN=$(( DURATION - HALF )); sleep "$REMAIN"
    RAW=$(ab eval "(function(){
      try {
        var v = WANKLE.net.buildView(0); var me = null;
        for (var i=0; i<v.tanks.length; i++) if (v.tanks[i].isLocal) { me = v.tanks[i]; break; }
        var bt = window._tb || window._pb || window._bt2 || window._hb || {};
        var fpsVals = bt.rafTimes || []; var fpsAvg = fpsVals.length > 0 ? fpsVals.reduce(function(a,b){return a+b},0)/fpsVals.length : 0;
        var fpsMin = fpsVals.length > 0 ? Math.min.apply(null, fpsVals) : 0;
        var c = ''; try { c = localStorage.getItem('wankle-aim-corrections') || ''; } catch(e) {}
        var cd = {}; try { if (c && c !== 'null') cd = JSON.parse(c); } catch(e) {}
        var corrBuckets = Object.keys(cd).length;
        // v22.2 fix: bot.totalKills is reliable across match-end boundaries.
        // WANKLE.net.meta.campaignKills resets when the survival match ends,
        // so reading it at final-eval time gives stale (often 0) data.
        // Prefer bot tracker; fall back to meta only if bot tracker is missing.
        var finalKills = bt.totalKills || WANKLE.net.meta.campaignKills || 0;
        var finalDeaths = bt.totalDeaths || 0;
        return JSON.stringify({
          wave: WANKLE.net.meta.wave, kills: finalKills,
          dead: me ? me.dead : true, hp: me ? me.health : 0,
          enemyCount: v.tanks.filter(function(t){return !t.isLocal&&!t.dead;}).length,
          botKills: bt.totalKills || 0, botDeaths: finalDeaths,
          maxEnemies: bt.maxEnemies || 0, avgFps: fpsAvg, minFps: fpsMin,
          state: WANKLE.net.meta.state, corrBuckets: corrBuckets
        });
      } catch(e) { return JSON.stringify({error: e.message}); }
    })()" 2>/dev/null)
    # v22.5: only add -noaim suffix when AIMBOT_OFF is exactly "1" (not "0")
    JSONL_FILE="$TRIAL_LOG_DIR/${VER}-${LEVEL_ID}-t${TRIAL}$([[ "$AIMBOT_OFF" == "1" ]] && echo -noaim).jsonl"
    ab eval "(function(){ var log = window._tbLog || window._hbLog || window._pbLog || []; return JSON.stringify(log); })()" 2>/dev/null > "${JSONL_FILE}.raw"
    python3 -c "
import json, sys
raw = open('${JSONL_FILE}.raw').read()
try:
    unwrapped = json.loads(raw)
    payload = unwrapped if isinstance(unwrapped, str) else raw
    arr = json.loads(payload)
    with open('${JSONL_FILE}', 'w') as f:
        for item in arr:
            # Defensive: item may be a string (double-encoded) or a dict
            if isinstance(item, str):
                try: item = json.loads(item)
                except: pass
            f.write(json.dumps(item) + '\n')
except: open('${JSONL_FILE}', 'w').write('')
" 2>&1 | tail -1
    rm -f "${JSONL_FILE}.raw"
    T1=$(date +%s); ELAPSED=$((T1 - T0))
    PARSED=$(python3 -c "
import json, sys
raw = sys.argv[1]
try:
    unwrapped = json.loads(raw)
    payload = unwrapped if isinstance(unwrapped, str) else raw
    d = json.loads(payload)
    if 'error' in d: print('ERR', d['error'])
    else: print(d.get('kills',0), d.get('botDeaths',0), d.get('wave',0), 0 if d.get('dead',True) else 1, d.get('hp',0), d.get('enemyCount',0), $ELAPSED, round(d.get('avgFps',0),1), round(d.get('minFps',0),1), d.get('maxEnemies',0), d.get('corrBuckets',0))
except Exception as e: print('ERR', str(e))
" "$RAW")
    echo "  [final] $RAW"
    echo "  [parsed] $PARSED"
    # v22.5: only add -noaim suffix when AIMBOT_OFF is exactly "1"
    JSONL_BASENAME="${VER}-${LEVEL_ID}-t${TRIAL}$([[ "$AIMBOT_OFF" == "1" ]] && echo -noaim).jsonl"
    if [[ "$PARSED" == ERR* ]]; then
      echo "$VER,$TRIAL,0,0,0,0,0,0,$ELAPSED,0,0,0,$BOT_TYPE,$LEVEL_ID,$MODE,$AIMBOT_OFF,$JSONL_BASENAME,0" >> "$RESULTS_CSV"
    else
      KILLS=$(echo "$PARSED" | awk '{print $1}'); DEATHS=$(echo "$PARSED" | awk '{print $2}')
      WAVE=$(echo "$PARSED" | awk '{print $3}'); ALIVE=$(echo "$PARSED" | awk '{print $4}')
      HP=$(echo "$PARSED" | awk '{print $5}'); ECOUNT=$(echo "$PARSED" | awk '{print $6}')
      AVG_FPS=$(echo "$PARSED" | awk '{print $8}'); MIN_FPS=$(echo "$PARSED" | awk '{print $9}')
      MAX_ENEMIES=$(echo "$PARSED" | awk '{print $10}'); CORR=$(echo "$PARSED" | awk '{print $11}')
      echo "$VER,$TRIAL,$KILLS,$DEATHS,$WAVE,$ALIVE,$HP,$ECOUNT,$ELAPSED,$AVG_FPS,$MIN_FPS,$MAX_ENEMIES,$BOT_TYPE,$LEVEL_ID,$MODE,$AIMBOT_OFF,$JSONL_BASENAME,$CORR" >> "$RESULTS_CSV"
    fi
    ab eval "clearInterval(window._bot); 's'" > /dev/null 2>&1 || true
    ab close > /dev/null 2>&1 || true; sleep 1
  done
done
echo ""; echo "=== RESULTS ==="; cat "$RESULTS_CSV"
echo ""; echo "=== AVERAGES ==="
python3 << 'PYEOF'
import csv
from collections import defaultdict
data = defaultdict(list)
with open('/home/z/my-project/scripts/cheat-tests/survival-results.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        if row['version'] == 'version': continue
        data[row['version']].append(row)
print(f"{'Version':<8} {'N':>3} {'Avg K':>6} {'Avg D':>6} {'Avg W':>6} {'Surv':>6} {'Avg FPS':>8} {'Corr':>5}")
print("-" * 55)
for ver in sorted(data.keys()):
    rows = data[ver]; n = len(rows)
    avg_k = sum(int(r['kills']) for r in rows) / n
    avg_d = sum(int(r['deaths']) for r in rows) / n
    avg_w = sum(int(r['wave']) for r in rows) / n
    surv = sum(int(r['alive']) for r in rows)
    fps_vals = [float(r.get('avgFps',0)) for r in rows if r.get('avgFps','0')!='0']
    avg_fps = sum(fps_vals)/len(fps_vals) if fps_vals else 0
    corr = sum(int(r.get('corrBuckets',0)) for r in rows) / n
    print(f"{ver:<8} {n:>3} {avg_k:>6.1f} {avg_d:>6.1f} {avg_w:>6.1f} {surv:>3}/{n:<2} {avg_fps:>8.1f} {corr:>5.1f}")
PYEOF
