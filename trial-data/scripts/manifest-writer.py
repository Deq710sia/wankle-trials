#!/usr/bin/env python3
"""
manifest-writer.py — atomic manifest + Tier-2 JSONL updater.

- Writes /home/z/agent-ctx/trial-manifest.json (progress + file locations)
- Appends per-trial summary to /home/z/agent-ctx/trials.jsonl (Tier 2)
- For each new trial in CSVs: invokes telemetry-writer.py to create Tier-1 file,
  then appends summary line to trials.jsonl with pointer to telemetry file.

Deduplication: tracks (version, trial, levelId, aimbotOff) tuples already in trials.jsonl.

Called by watchdog every cycle + after every backup.
"""
import csv
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
DOWNLOAD_DIR = Path('/home/z/my-project/download')
BACKUP_DIR = DOWNLOAD_DIR / 'backups' / 'trial-watchdog-backups'
MANIFEST_PATH = Path('/home/z/agent-ctx/trial-manifest.json')
TRIALS_JSONL = Path('/home/z/agent-ctx/trials.jsonl')
TELEMETRY_DIR = Path('/home/z/agent-ctx/telemetry')
ANOMALY_LOG = CHEAT_DIR / 'anomaly-log.jsonl'
WATCHDOG_LOG = CHEAT_DIR / 'trial-watchdog.log'

# All planned versions + targets
ALL_PLANNED_VERSIONS = ['v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27']
TARGET_PER_VERSION = 150  # 30 trials × 5 maps

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


def get_watchdog_pid():
    try:
        result = subprocess.run(['ps', '-ef'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if 'trial-watchdog.py' in line and 'grep' not in line:
                parts = line.split()
                return int(parts[1])
    except:
        pass
    return None


def read_csv_rows(ver):
    csv_path = CHEAT_DIR / f'parallel-{ver}-results.csv'
    if not csv_path.exists():
        return []
    rows = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for r in reader:
            if r.get('version') == 'version' or not r.get('version'):
                continue
            try:
                rows.append({
                    'version': r['version'],
                    'trial': int(r['trial']),
                    'kills': int(r['kills']),
                    'deaths': int(r['deaths']),
                    'wave': int(r['wave']),
                    'alive': int(r['alive']),
                    'hp': int(r['hp']),
                    'duration': int(r['durationSec']),
                    'avgFps': float(r.get('avgFps', 0) or 0),
                    'minFps': float(r.get('minFps', 0) or 0),
                    'maxEnemies': int(r.get('maxEnemies', 0) or 0),
                    'levelId': r['levelId'],
                    'mode': r['mode'],
                    'aimbotOff': r.get('aimbotOff', '0') == '1',
                    'jsonlFile': r.get('jsonlFile', ''),
                    'corrBuckets': int(r.get('corrBuckets', 0) or 0),
                    'botType': r.get('botType', ''),
                })
            except (ValueError, KeyError):
                continue
    return rows


def load_existing_trials_keys():
    """Load set of (version, trial, levelId, aimbotOff) already in trials.jsonl."""
    keys = set()
    if not TRIALS_JSONL.exists():
        return keys
    with open(TRIALS_JSONL) as f:
        for line in f:
            try:
                t = json.loads(line)
                keys.add((t['version'], str(t['trial']), t['levelId'],
                          '1' if t.get('aimbotOff') else '0'))
            except:
                continue
    return keys


def compute_trial_summary(version, level_id, trial_num, aimbot_off, jsonl_filename):
    """Read the trial's JSONL log and compute summary metrics."""
    src = CHEAT_DIR / f'parallel-{version}-logs' / jsonl_filename
    if not src.exists():
        return None
    samples = []
    events = []
    with open(src) as f:
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
    n = len(samples)
    last = samples[-1]
    dodge_active_pct = sum(1 for s in samples if s.get('dodgeActive')) / n
    path_guard_pct = sum(1 for s in samples if s.get('pathGuardCrosses')) / n
    pred_vals = [s.get('predictedShells', 0) for s in samples]
    real_vals = [s.get('realShells', 0) for s in samples]
    avg_pred = mean(pred_vals) if pred_vals else 0
    avg_real = mean(real_vals) if real_vals else 0
    # Direction changes (jitter)
    dir_changes = 0
    last_dx, last_dz = None, None
    for s in samples:
        if not s.get('dodgeActive'):
            continue
        dx, dz = s.get('dodgeMoveX', 0), s.get('dodgeMoveZ', 0)
        if last_dx is not None and ((last_dx * dx < 0) or (last_dz * dz < 0)):
            dir_changes += 1
        last_dx, last_dz = dx, dz
    return {
        'avgDodgeActive': round(dodge_active_pct, 3),
        'pathGuardPct': round(path_guard_pct, 3),
        'avgPredictedShells': round(avg_pred, 2),
        'avgRealShells': round(avg_real, 2),
        'dodgeDirectionChanges': dir_changes,
        'shotsFired': last.get('shellsFired', 0),
        'finalKills': last.get('kills', 0),
        'finalDeaths': last.get('deaths', 0),
        'wave': last.get('wave', 0),
        'maxEnemies': last.get('maxEnemies', 0),
        'avgFps': last.get('fps', 0),
        'trialDurationMs': last.get('tRel', 0),
    }


def append_new_trials_to_jsonl():
    """For each new CSV row: invoke telemetry-writer, then append summary to trials.jsonl."""
    existing_keys = load_existing_trials_keys()
    appended = 0
    with open(TRIALS_JSONL, 'a') as f:
        for ver in ALL_PLANNED_VERSIONS:
            rows = read_csv_rows(ver)
            for r in rows:
                key = (r['version'], str(r['trial']), r['levelId'],
                       '1' if r['aimbotOff'] else '0')
                if key in existing_keys:
                    continue
                # Invoke telemetry-writer to create Tier-1 file
                telemetry_file = None
                try:
                    result = subprocess.run(
                        ['python3', str(CHEAT_DIR / 'telemetry-writer.py'),
                         ver, r['levelId'], str(r['trial']),
                         '1' if r['aimbotOff'] else '0', r['jsonlFile']],
                        capture_output=True, text=True, timeout=30
                    )
                    if result.returncode == 0:
                        # Extract path from "WROTE <path>"
                        out = result.stdout.strip()
                        if out.startswith('WROTE '):
                            telemetry_file = out[6:]
                except Exception as e:
                    pass
                # Compute summary metrics
                summary = compute_trial_summary(ver, r['levelId'], r['trial'],
                                                 r['aimbotOff'], r['jsonlFile'])
                # Build JSONL record
                mk = map_key(r['levelId'], r['aimbotOff'])
                record = {
                    'trialId': f"{ver}-{mk}-{r['trial']:03d}",
                    'version': ver,
                    'map': mk,
                    'levelId': r['levelId'],
                    'trial': r['trial'],
                    'kills': r['kills'],
                    'deaths': r['deaths'],
                    'duration': r['duration'],
                    'avgFps': r['avgFps'],
                    'minFps': r['minFps'],
                    'maxEnemies': r['maxEnemies'],
                    'mode': r['mode'],
                    'aimbotOff': r['aimbotOff'],
                    'botType': r['botType'],
                    'wave': r['wave'],
                    'alive': bool(r['alive']),
                    'telemetryFile': telemetry_file,
                }
                if summary:
                    record.update(summary)
                record['recordedAt'] = datetime.now(timezone.utc).isoformat()
                f.write(json.dumps(record) + '\n')
                existing_keys.add(key)
                appended += 1
    return appended


def write_manifest():
    per_version = {}
    completed = []
    in_progress = []
    remaining = []
    total_done = 0
    for ver in ALL_PLANNED_VERSIONS:
        rows = read_csv_rows(ver)
        n = len(rows)
        total_done += n
        if n >= TARGET_PER_VERSION:
            status = 'complete'
            completed.append(ver)
        elif n > 0:
            status = 'in_progress'
            in_progress.append(ver)
        else:
            status = 'pending'
            remaining.append(ver)
        per_version[ver] = {
            'completed': n,
            'target': TARGET_PER_VERSION,
            'status': status,
            'csvPath': str(CHEAT_DIR / f'parallel-{ver}-results.csv'),
            'jsonlDir': str(CHEAT_DIR / f'parallel-{ver}-logs'),
            'telemetryDir': str(TELEMETRY_DIR / ver),
        }
    backups = []
    if BACKUP_DIR.exists():
        for entry in sorted(BACKUP_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            backups.append(str(entry))
    manifest = {
        'lastUpdated': datetime.now(timezone.utc).isoformat(),
        'watchdogPid': get_watchdog_pid(),
        'watchdogLogPath': str(WATCHDOG_LOG),
        'anomalyLogPath': str(ANOMALY_LOG),
        'trialsJsonlPath': str(TRIALS_JSONL),
        'telemetryDir': str(TELEMETRY_DIR),
        'versionsCompleted': completed,
        'versionsInProgress': in_progress,
        'versionsRemaining': remaining,
        'trialsCompleted': total_done,
        'trialsTotal': TARGET_PER_VERSION * len(ALL_PLANNED_VERSIONS),
        'perVersion': per_version,
        'backupLocations': backups,
        'plannedVersions': ALL_PLANNED_VERSIONS,
        'targetPerVersion': TARGET_PER_VERSION,
        'continuationGuide': '/home/z/agent-ctx/CONTINUATION_GUIDE.md',
        'note': 'Single source of truth. Read this first to reconstruct state.',
    }
    tmp = MANIFEST_PATH.with_suffix('.json.tmp')
    with open(tmp, 'w') as f:
        json.dump(manifest, f, indent=2)
    tmp.rename(MANIFEST_PATH)
    return manifest


def main():
    appended = append_new_trials_to_jsonl()
    manifest = write_manifest()
    print(f'Manifest: {manifest["trialsCompleted"]}/{manifest["trialsTotal"]} trials, '
          f'{len(manifest["versionsCompleted"])} complete, {appended} new trials appended')


if __name__ == '__main__':
    main()
