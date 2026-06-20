#!/usr/bin/env python3
"""
telemetry-backfill.py — generate missing Tier-1 telemetry files.

ONLY does:
  - Scan trials.jsonl for entries with telemetryFile=null
  - For each, generate the telemetry file from the trial's JSONL log
  - Update the trials.jsonl entry to point to the new file
  - Exit when done (one-shot, can be re-run anytime)

Run independently. Slow but safe — one trial at a time.
"""
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from statistics import mean

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
TRIALS_JSONL = Path('/home/z/agent-ctx/trials.jsonl')
TELEMETRY_DIR = Path('/home/z/agent-ctx/telemetry')
LOG_PATH = CHEAT_DIR / 'telemetry-backfill.log'

MAP_NAMES = {
    'custom-c2738ec4-135': 'CA',
    'custom-c69c5ff7-f4e': 'RK',
    'custom-a6b7c90f-813': 'Dun',
    'custom-5f697a3b-742': 'DT',
}


def map_key(level_id, aimbot_off):
    base = MAP_NAMES.get(level_id, level_id)
    if base == 'DT':
        return 'DT-on' if not aimbot_off else 'DT-off'
    return base


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG_PATH, 'a') as f:
        f.write(line + '\n')


def generate_telemetry(trial_record):
    """Generate a Tier-1 telemetry file for a trial. Returns path or None."""
    version = trial_record['version']
    level_id = trial_record['levelId']
    trial_num = trial_record['trial']
    aimbot_off = trial_record.get('aimbotOff', False)
    # Find source JSONL
    src = CHEAT_DIR / f'parallel-{version}-logs'
    # Match pattern: {ver}-{levelId}-t{N}[-noaim].jsonl
    suffix = '-noaim' if aimbot_off else ''
    candidates = list(src.glob(f'{version}-{level_id}-t{trial_num}{suffix}.jsonl'))
    if not candidates:
        # Try without suffix
        candidates = list(src.glob(f'{version}-{levelId}-t{trial_num}*.jsonl'))
    if not candidates:
        return None
    src_file = candidates[0]
    # Read samples + events
    samples, events = [], []
    with open(src_file) as f:
        for line in f:
            try:
                e = json.loads(line)
                if e.get('kind') == 'sample':
                    samples.append(e)
                else:
                    events.append(e)
            except:
                continue
    if not samples:
        return None
    # Build frame data
    frame_data = []
    for s in samples:
        frame_data.append({
            't': s.get('tRel', 0),
            'playerX': s.get('pos', [0, 0])[0],
            'playerZ': s.get('pos', [0, 0])[1],
            'hp': s.get('hp', 0),
            'dodgeActive': bool(s.get('dodgeActive', False)),
            'dodgeMoveX': s.get('dodgeMoveX', 0),
            'dodgeMoveZ': s.get('dodgeMoveZ', 0),
            'dodgeUrgency': s.get('dodgeUrgency', 0),
            'pathGuardEngaged': bool(s.get('pathGuardCrosses', False)),
            'pathGuardCrossCount': 0,
            'predictedShellCount': s.get('predictedShells', 0),
            'realShellCount': s.get('realShells', 0),
            'aimHitProb': s.get('aimErr', None),
            'aimBounces': 0,
            'aimTargetId': None,
            'shellsInFlight': s.get('myShells', 0),
            'shotsFiredCumulative': s.get('shellsFired', 0),
        })
    # Events
    event_list = []
    for e in events:
        sub = e.get('sub')
        if sub in ('kill', 'death', 'shot', 'hp_loss', 'wave', 'spawn', 'boot'):
            event_list.append({
                'type': sub,
                't': e.get('tRel', 0),
                'data': {k: v for k, v in e.items() if k not in ('kind', 'sub', 't', 'tRel')},
            })
    # Summary
    n = len(frame_data)
    last = samples[-1]
    dodge_active_pct = sum(1 for f in frame_data if f['dodgeActive']) / n if n > 0 else 0
    path_guard_pct = sum(1 for f in frame_data if f['pathGuardEngaged']) / n if n > 0 else 0
    pred_vals = [f['predictedShellCount'] for f in frame_data if f['predictedShellCount'] > 0]
    real_vals = [f['realShellCount'] for f in frame_data if f['realShellCount'] > 0]
    # Direction changes
    dir_changes = 0
    last_dx, last_dz = None, None
    for f in frame_data:
        if not f['dodgeActive']: continue
        dx, dz = f['dodgeMoveX'], f['dodgeMoveZ']
        if last_dx is not None and ((last_dx * dx < 0) or (last_dz * dz < 0)):
            dir_changes += 1
        last_dx, last_dz = dx, dz
    # killsOverTime / deathsOverTime from events
    kills_over_time, deaths_over_time = [], []
    cur_k, cur_d = 0, 0
    for ev in event_list:
        if ev['type'] == 'kill':
            cur_k += 1
            kills_over_time.append([ev['t'], cur_k])
        elif ev['type'] == 'death':
            cur_d += 1
            deaths_over_time.append([ev['t'], cur_d])
    summary = {
        'avgDodgeActive': round(dodge_active_pct, 3),
        'pathGuardTriggeredPct': round(path_guard_pct, 3),
        'avgPredictedShells': round(mean(pred_vals), 2) if pred_vals else 0,
        'avgRealShells': round(mean(real_vals), 2) if real_vals else 0,
        'dodgeDirectionChanges': dir_changes,
        'killsOverTime': kills_over_time,
        'deathsOverTime': deaths_over_time,
        'maxEnemies': last.get('maxEnemies', 0),
        'avgFps': last.get('fps', 0),
        'finalHp': last.get('hp', 0),
        'finalAlive': not last.get('dead', True),
        'wave': last.get('wave', 0),
    }
    mk = map_key(level_id, aimbot_off)
    output = {
        'trialId': f'{version}-{mk}-{trial_num:03d}',
        'version': version,
        'map': mk,
        'levelId': level_id,
        'aimbotOff': aimbot_off,
        'trialNum': trial_num,
        'trialDurationMs': last.get('tRel', 0),
        'finalKills': last.get('kills', 0),
        'finalDeaths': last.get('deaths', 0),
        'shotsFired': last.get('shellsFired', 0),
        'frameData': frame_data,
        'events': event_list,
        'summary': summary,
    }
    out_dir = TELEMETRY_DIR / version / mk
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'trial-{trial_num:03d}.json'
    with open(out_file, 'w') as f:
        json.dump(output, f, separators=(',', ':'))
    return out_file


def update_jsonl_pointer(trial_id, telemetry_path):
    """Update trials.jsonl entry to point to the new telemetry file."""
    if not TRIALS_JSONL.exists():
        return
    # Read all lines
    with open(TRIALS_JSONL) as f:
        lines = f.readlines()
    # Update matching line
    updated = 0
    with open(TRIALS_JSONL, 'w') as f:
        for line in lines:
            try:
                t = json.loads(line)
                if t.get('trialId') == trial_id:
                    t['telemetryFile'] = str(telemetry_path)
                    f.write(json.dumps(t) + '\n')
                    updated += 1
                else:
                    f.write(line)
            except:
                f.write(line)


def main():
    log('telemetry-backfill starting')
    if not TRIALS_JSONL.exists():
        log('no trials.jsonl — nothing to backfill')
        return
    # Scan for trials with telemetryFile=null or missing
    missing = []
    with open(TRIALS_JSONL) as f:
        for line in f:
            try:
                t = json.loads(line)
                tele = t.get('telemetryFile')
                if not tele or not Path(tele).exists():
                    missing.append(t)
            except:
                continue
    log(f'  found {len(missing)} trials missing telemetry')
    generated = 0
    for t in missing:
        try:
            result = generate_telemetry(t)
            if result:
                update_jsonl_pointer(t['trialId'], result)
                generated += 1
                if generated % 10 == 0:
                    log(f'  generated {generated}/{len(missing)}')
            else:
                log(f'  SKIP {t.get("trialId")} — no source data')
        except Exception as e:
            log(f'  ERROR on {t.get("trialId")}: {e}')
    log(f'telemetry-backfill complete: {generated}/{len(missing)} generated')


if __name__ == '__main__':
    main()
