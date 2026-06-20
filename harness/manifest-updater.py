#!/usr/bin/env python3
"""
manifest-updater.py — lightweight manifest + trials.jsonl updater.

ONLY does:
  - Count trials in CSVs (fast)
  - Write trial-manifest.json
  - Append new trials to trials.jsonl (with summary metrics computed from JSONL log)

Does NOT:
  - Generate telemetry files (that's telemetry-backfill.py)
  - Touch drivers
  - Do backups

Run as a 30s loop. If it dies, just relaunch — it's idempotent.
"""
import csv
import json
import os
import subprocess
import sys
import time
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
WATCHDOG_LOG = CHEAT_DIR / 'watchdog.log'
MANIFEST_UPDATER_LOG = CHEAT_DIR / 'manifest-updater.log'

ALL_PLANNED_VERSIONS = ['v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
                          'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045']
TARGET_PER_VERSION = 150

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
    with open(MANIFEST_UPDATER_LOG, 'a') as f:
        f.write(line + '\n')


def get_watchdog_pid():
    try:
        result = subprocess.run(['ps', '-ef'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if 'watchdog.py' in line and 'grep' not in line and 'manifest' not in line:
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


def load_existing_keys():
    """Load (version, trial, levelId, aimbotOff) tuples already in trials.jsonl."""
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


def quick_summary(version, level_id, trial_num, aimbot_off, jsonl_filename):
    """Fast summary — read JSONL log, compute metrics. NO telemetry file generation."""
    src = CHEAT_DIR / f'parallel-{version}-logs' / jsonl_filename
    if not src.exists():
        return None
    samples = []
    events = []
    try:
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
    except:
        return None
    if not samples:
        return None
    n = len(samples)
    last = samples[-1]
    dodge_active = sum(1 for s in samples if s.get('dodgeActive')) / n
    path_guard = sum(1 for s in samples if s.get('pathGuardCrosses')) / n
    pred_vals = [s.get('predictedShells', 0) for s in samples]
    real_vals = [s.get('realShells', 0) for s in samples]
    # Direction changes
    dir_changes = 0
    last_dx, last_dz = None, None
    for s in samples:
        if not s.get('dodgeActive'): continue
        dx, dz = s.get('dodgeMoveX', 0), s.get('dodgeMoveZ', 0)
        if last_dx is not None and ((last_dx * dx < 0) or (last_dz * dz < 0)):
            dir_changes += 1
        last_dx, last_dz = dx, dz
    return {
        'avgDodgeActive': round(dodge_active, 3),
        'pathGuardPct': round(path_guard, 3),
        'avgPredictedShells': round(mean(pred_vals), 2) if pred_vals else 0,
        'avgRealShells': round(mean(real_vals), 2) if real_vals else 0,
        'dodgeDirectionChanges': dir_changes,
        'shotsFired': last.get('shellsFired', 0),
        'trialDurationMs': last.get('tRel', 0),
        'wave': last.get('wave', 0),
    }


def append_new_trials():
    """Append new CSV rows to trials.jsonl with summary metrics."""
    existing = load_existing_keys()
    appended = 0
    with open(TRIALS_JSONL, 'a') as f:
        for ver in ALL_PLANNED_VERSIONS:
            rows = read_csv_rows(ver)
            for r in rows:
                key = (r['version'], str(r['trial']), r['levelId'],
                       '1' if r['aimbotOff'] else '0')
                if key in existing:
                    continue
                mk = map_key(r['levelId'], r['aimbotOff'])
                # Check if telemetry file exists (set pointer if so, but don't generate)
                tele_path = TELEMETRY_DIR / ver / mk / f'trial-{r["trial"]:03d}.json'
                record = {
                    'trialId': f'{ver}-{mk}-{r["trial"]:03d}',
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
                    'telemetryFile': str(tele_path) if tele_path.exists() else None,
                    'recordedAt': datetime.now(timezone.utc).isoformat(),
                }
                summary = quick_summary(ver, r['levelId'], r['trial'], r['aimbotOff'], r['jsonlFile'])
                if summary:
                    record.update(summary)
                f.write(json.dumps(record) + '\n')
                existing.add(key)
                appended += 1
    return appended


def write_manifest():
    per_version = {}
    completed, in_progress, remaining = [], [], []
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
        'manifestUpdaterLogPath': str(MANIFEST_UPDATER_LOG),
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


def main():
    log('manifest-updater started (30s loop)')
    while True:
        try:
            appended = append_new_trials()
            write_manifest()
            if appended > 0:
                log(f'  appended {appended} new trials, manifest refreshed')
        except Exception as e:
            log(f'  ERROR: {e}')
        time.sleep(30)


if __name__ == '__main__':
    main()
