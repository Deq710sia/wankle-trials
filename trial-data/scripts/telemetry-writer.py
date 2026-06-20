#!/usr/bin/env python3
"""
telemetry-writer.py — converts a trial's JSONL log into a Tier-1 telemetry file.

Reads:  /home/z/my-project/scripts/cheat-tests/parallel-{ver}-logs/{ver}-{levelId}-t{N}[-noaim].jsonl
Writes: /home/z/agent-ctx/telemetry/{ver}/{mapName}/trial-{N:03d}.json

Each output file contains:
{
  "trialId": "v27-DTon-001",
  "version": "v27",
  "map": "DT-on",
  "trialDurationMs": 90000,
  "finalKills": 28,
  "finalDeaths": 4,
  "shotsFired": 31,
  "frameData": [ {17 fields per frame, ~5400 frames} ],
  "events": [ {kill/death/shot events} ],
  "summary": { aggregate metrics + killsOverTime + deathsOverTime }
}

Usage: python3 telemetry-writer.py <version> <levelId> <trial_num> <aimbot_off> <jsonl_filename>
"""
import json
import os
import sys
from pathlib import Path
from statistics import mean

TELEMETRY_DIR = Path('/home/z/agent-ctx/telemetry')
JSONL_SOURCE_DIR = Path('/home/z/my-project/scripts/cheat-tests')

MAP_NAMES = {
    'custom-c2738ec4-135': 'CA',
    'custom-c69c5ff7-f4e': 'RK',
    'custom-a6b7c90f-813': 'Dun',
    'custom-5f697a3b-742': 'DT',
}


def map_key(level_id, aimbot_off):
    """Returns short map name like 'CA', 'DT-on', 'DT-off'."""
    base = MAP_NAMES.get(level_id, level_id)
    if base == 'DT':
        return 'DT-on' if not aimbot_off else 'DT-off'
    return base


def convert_trial(version, level_id, trial_num, aimbot_off, jsonl_filename):
    """Convert a single trial's JSONL to a Tier-1 telemetry file."""
    src = JSONL_SOURCE_DIR / f'parallel-{version}-logs' / jsonl_filename
    if not src.exists():
        return None

    # Read all events from source JSONL
    events_raw = []
    with open(src) as f:
        for line in f:
            try:
                events_raw.append(json.loads(line))
            except:
                continue

    if not events_raw:
        return None

    # Separate samples from events
    samples = [e for e in events_raw if e.get('kind') == 'sample']
    other_events = [e for e in events_raw if e.get('kind') != 'sample']

    if not samples:
        return None

    # Build frame data — only the 17 required fields per user spec
    frame_data = []
    for s in samples:
        frame = {
            't': s.get('tRel', 0),
            'playerX': s.get('pos', [0, 0])[0],
            'playerZ': s.get('pos', [0, 0])[1],
            'hp': s.get('hp', 0),
            'dodgeActive': bool(s.get('dodgeActive', False)),
            'dodgeMoveX': s.get('dodgeMoveX', 0),
            'dodgeMoveZ': s.get('dodgeMoveZ', 0),
            'dodgeUrgency': s.get('dodgeUrgency', 0),
            'pathGuardEngaged': bool(s.get('pathGuardCrosses', False)),
            'pathGuardCrossCount': 0,  # not directly captured, default 0
            'predictedShellCount': s.get('predictedShells', 0),
            'realShellCount': s.get('realShells', 0),
            'aimHitProb': s.get('aimErr', None),  # closest proxy
            'aimBounces': 0,  # not captured in sample, default 0
            'aimTargetId': None,  # not captured in sample
            'shellsInFlight': s.get('myShells', 0),
            'shotsFiredCumulative': s.get('shellsFired', 0),
        }
        frame_data.append(frame)

    # Build events list (kill/death/shot)
    events = []
    for e in other_events:
        sub = e.get('sub')
        if sub in ('kill', 'death', 'shot', 'hp_loss', 'wave', 'spawn', 'boot'):
            events.append({
                'type': sub,
                't': e.get('tRel', 0),
                'data': {k: v for k, v in e.items() if k not in ('kind', 'sub', 't', 'tRel')},
            })

    # Compute summary metrics
    n = len(frame_data)
    dodge_active_count = sum(1 for f in frame_data if f['dodgeActive'])
    path_guard_count = sum(1 for f in frame_data if f['pathGuardEngaged'])
    pred_shells_vals = [f['predictedShellCount'] for f in frame_data if f['predictedShellCount'] > 0]
    real_shells_vals = [f['realShellCount'] for f in frame_data if f['realShellCount'] > 0]

    # Compute dodge direction changes (jitter detection)
    direction_changes = 0
    last_dx, last_dz = None, None
    for f in frame_data:
        if not f['dodgeActive']:
            continue
        dx, dz = f['dodgeMoveX'], f['dodgeMoveZ']
        if last_dx is not None:
            # Detect sign flip on either axis
            if (last_dx * dx < 0) or (last_dz * dz < 0):
                direction_changes += 1
        last_dx, last_dz = dx, dz

    # killsOverTime and deathsOverTime
    kills_over_time = []
    deaths_over_time = []
    cur_k, cur_d = 0, 0
    last_t = 0
    for f in frame_data:
        # We don't have per-frame kills, so derive from events
        pass
    # Use events for kill/death timing
    for ev in events:
        if ev['type'] == 'kill':
            cur_k += 1
            kills_over_time.append([ev['t'], cur_k])
        elif ev['type'] == 'death':
            cur_d += 1
            deaths_over_time.append([ev['t'], cur_d])

    # Last sample for final state
    last = samples[-1]
    final_kills = last.get('kills', 0)
    final_deaths = last.get('deaths', 0)
    shots_fired = last.get('shellsFired', 0)
    duration_ms = last.get('tRel', 0)

    summary = {
        'avgDodgeActive': round(dodge_active_count / n, 3) if n > 0 else 0,
        'pathGuardTriggeredPct': round(path_guard_count / n, 3) if n > 0 else 0,
        'avgPredictedShells': round(mean(pred_shells_vals), 2) if pred_shells_vals else 0,
        'avgRealShells': round(mean(real_shells_vals), 2) if real_shells_vals else 0,
        'dodgeDirectionChanges': direction_changes,
        'killsOverTime': kills_over_time,
        'deathsOverTime': deaths_over_time,
        'maxEnemies': last.get('maxEnemies', 0),
        'avgFps': last.get('fps', 0),
        'finalHp': last.get('hp', 0),
        'finalAlive': not last.get('dead', True),
        'wave': last.get('wave', 0),
    }

    # Build output
    mk = map_key(level_id, aimbot_off)
    trial_id = f'{version}-{mk}-{trial_num:03d}'
    output = {
        'trialId': trial_id,
        'version': version,
        'map': mk,
        'levelId': level_id,
        'aimbotOff': aimbot_off,
        'trialNum': trial_num,
        'trialDurationMs': duration_ms,
        'finalKills': final_kills,
        'finalDeaths': final_deaths,
        'shotsFired': shots_fired,
        'frameData': frame_data,
        'events': events,
        'summary': summary,
    }

    # Write to disk
    out_dir = TELEMETRY_DIR / version / mk
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f'trial-{trial_num:03d}.json'
    with open(out_file, 'w') as f:
        json.dump(output, f, separators=(',', ':'))  # compact JSON for size

    return out_file


def main():
    if len(sys.argv) < 6:
        print('Usage: telemetry-writer.py <version> <levelId> <trial_num> <aimbot_off> <jsonl_filename>')
        sys.exit(1)
    version = sys.argv[1]
    level_id = sys.argv[2]
    trial_num = int(sys.argv[3])
    aimbot_off = sys.argv[4] == '1'
    jsonl_filename = sys.argv[5]

    result = convert_trial(version, level_id, trial_num, aimbot_off, jsonl_filename)
    if result:
        print(f'WROTE {result}')
    else:
        print(f'SKIP (no source data)')


if __name__ == '__main__':
    main()
