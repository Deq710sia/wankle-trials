#!/usr/bin/env python3
"""
trial-watchdog.py — autonomous trial runner with anomaly detection + restart.

Runs multiple versions in parallel, each in its own browser session. For each version:
  - Launches generic-trials.sh <ver> 30 90 p<ver>
  - Monitors CSV row count
  - Detects anomalous trials (K=0 + D=0, missing JSONL, NaN FPS, duration < 80s,
    telemetry all-zero on maps where it shouldn't be)
  - Re-runs anomalous trials by removing their CSV row + relaunching
  - Backs up CSV + JSONL every 30 trials per version
  - Restarts crashed/killed drivers
  - Detects server-restart signature (room creation fails, no tanks) and retries

Usage: python3 trial-watchdog.py <version1> <version2> ... [--trials 30] [--duration 90]
"""
import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
DOWNLOAD_DIR = Path('/home/z/my-project/download')
BACKUP_DIR = DOWNLOAD_DIR / 'backups' / 'trial-watchdog-backups'
MASTER_LOG = CHEAT_DIR / 'trial-watchdog.log'

BACKUP_DIR.mkdir(parents=True, exist_ok=True)

MAP_LEVELS = {
    'custom-c2738ec4-135': 'CustomArena',
    'custom-c69c5ff7-f4e': 'RKFight',
    'custom-a6b7c90f-813': 'Dungeon',
    'custom-5f697a3b-742': 'DodgeTraining',
}

# Anomaly thresholds
MIN_DURATION_S = 80  # trial crashed early if < 80s
MIN_FPS = 30  # unplayable
ANOMALY_K0_D0_SURVIVAL = True  # K=0 + D=0 in survival = bot didn't fire (immobile cheat)


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(MASTER_LOG, 'a') as f:
        f.write(line + '\n')


def get_csv_path(ver):
    return CHEAT_DIR / f'parallel-{ver}-results.csv'


def get_jsonl_dir(ver):
    return CHEAT_DIR / f'parallel-{ver}-logs'


def get_runlog_dir(ver):
    return CHEAT_DIR / f'parallel-{ver}-runlogs'


def read_csv_rows(ver):
    """Returns list of dict rows from CSV."""
    csv_path = get_csv_path(ver)
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
                })
            except (ValueError, KeyError):
                continue
    return rows


def count_trials_per_map(rows):
    """Returns {level_id_aimbotOff: count}."""
    counts = {}
    for r in rows:
        key = f"{r['levelId']}|{r['aimbotOff']}"
        counts[key] = counts.get(key, 0) + 1
    return counts


def is_anomalous(row):
    """Returns (is_anomalous, reason)."""
    # Survival maps: K=0 + D=0 + alive=False = bot never fired (immobile cheat bug)
    if row['mode'] == 'survival':
        if row['kills'] == 0 and row['deaths'] == 0 and row['alive'] == 0:
            return True, 'immobile_survival (K=0 D=0 dead)'
        # K=0 + D=0 + alive=True but duration < 80s = early crash
        if row['kills'] == 0 and row['deaths'] == 0 and row['alive'] == 1 and row['duration'] < MIN_DURATION_S:
            return True, f'early_crash (dur={row["duration"]}s)'
    # All maps: missing JSONL file
    if not row['jsonlFile']:
        return True, 'missing_jsonl'
    jsonl_path = get_jsonl_dir(row['version']) / row['jsonlFile']
    if not jsonl_path.exists():
        return True, f'jsonl_file_missing ({row["jsonlFile"]})'
    # All maps: NaN/zero FPS
    if row['avgFps'] == 0 or row['avgFps'] != row['avgFps']:
        return True, 'nan_fps'
    if row['minFps'] < MIN_FPS and row['minFps'] > 0:
        # Low min FPS but non-zero — borderline, log but don't re-run
        pass
    # Dodge Training: 0 deaths in campaign = suspicious (always dies to clumps)
    if row['mode'] == 'campaign' and row['aimbotOff'] and row['deaths'] == 0 and row['duration'] >= MIN_DURATION_S:
        # Check telemetry — if realShells=0 across all samples, server didn't spawn bots
        try:
            samples = []
            with open(jsonl_path) as f:
                for line in f:
                    try:
                        e = json.loads(line)
                        if e.get('kind') == 'sample':
                            samples.append(e)
                    except:
                        pass
            if samples:
                max_real_shells = max(s.get('realShells', 0) for s in samples)
                max_enemies_seen = max(s.get('enemies', 0) for s in samples)
                if max_enemies_seen < 5:
                    return True, f'server_no_bots (max_enemies={max_enemies_seen})'
                if max_real_shells == 0:
                    return True, 'server_no_shells (realShells=0 across all samples)'
        except:
            pass
    return False, ''


def backup_version(ver, trial_count_label='batch', keep_last=3):
    """Back up CSV + JSONL to timestamped dir. Retain only `keep_last` most recent per version."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    bk = BACKUP_DIR / f'{ver}-{trial_count_label}-{ts}'
    bk.mkdir(parents=True, exist_ok=True)
    csv_src = get_csv_path(ver)
    if csv_src.exists():
        shutil.copy2(csv_src, bk / csv_src.name)
    jsonl_src = get_jsonl_dir(ver)
    if jsonl_src.exists():
        jsonl_dst = bk / jsonl_src.name
        shutil.copytree(jsonl_src, jsonl_dst)
    log(f'  BACKUP {ver} → {bk}')
    # Retention: keep only `keep_last` backups per version (most recent)
    # Sort by mtime descending, delete everything past keep_last
    pattern = f'{ver}-*'
    backups = sorted(BACKUP_DIR.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[keep_last:]:
        try:
            shutil.rmtree(old)
            log(f'  BACKUP-RETENTION deleted old: {old.name}')
        except Exception as e:
            log(f'  BACKUP-RETENTION failed to delete {old.name}: {e}')
    # v27-manifest: update manifest after every backup
    update_manifest()
    return bk


def update_manifest():
    """Invoke manifest-writer.py to refresh /home/z/agent-ctx/trial-manifest.json + trials.jsonl."""
    try:
        subprocess.run(['python3', str(CHEAT_DIR / 'manifest-writer.py')],
                       capture_output=True, timeout=15)
    except Exception as e:
        log(f'  manifest update failed: {e}')


def log_anomaly(ver, row, reason, action):
    """Append anomaly to /home/z/my-project/scripts/cheat-tests/anomaly-log.jsonl."""
    anomaly = {
        'timestamp': datetime.now().isoformat(),
        'version': ver,
        'trial': row.get('trial'),
        'levelId': row.get('levelId'),
        'aimbotOff': row.get('aimbotOff'),
        'reason': reason,
        'action': action,  # 'retry' or 'max_retries_exceeded'
        'kills': row.get('kills'),
        'deaths': row.get('deaths'),
        'duration': row.get('duration'),
        'avgFps': row.get('avgFps'),
    }
    ANOMALY_LOG = CHEAT_DIR / 'anomaly-log.jsonl'
    try:
        with open(ANOMALY_LOG, 'a') as f:
            f.write(json.dumps(anomaly) + '\n')
    except Exception as e:
        log(f'  anomaly log write failed: {e}')


def remove_anomalous_rows(ver, anomalous_rows):
    """Remove anomalous rows from CSV so they get re-run."""
    if not anomalous_rows:
        return 0
    csv_path = get_csv_path(ver)
    if not csv_path.exists():
        return 0
    # Read all rows
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        all_rows = list(reader)
    # Filter out anomalous rows (match by trial + levelId + aimbotOff)
    keys_to_remove = set()
    for ar in anomalous_rows:
        keys_to_remove.add((str(ar['trial']), ar['levelId'], '1' if ar['aimbotOff'] else '0'))
    kept = []
    removed = 0
    for r in all_rows:
        if r.get('version') == 'version':
            kept.append(r); continue
        key = (r.get('trial', ''), r.get('levelId', ''), r.get('aimbotOff', '0'))
        if key in keys_to_remove:
            removed += 1
            # Also delete the JSONL file
            jf = r.get('jsonlFile', '')
            if jf:
                jp = get_jsonl_dir(ver) / jf
                if jp.exists():
                    try: jp.unlink()
                    except: pass
        else:
            kept.append(r)
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in kept:
            writer.writerow(r)
    return removed


def driver_running(ver):
    """Check if a generic-trials.sh driver is running for this version."""
    try:
        result = subprocess.run(['ps', '-ef'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if f'generic-trials.sh {ver}' in line and 'grep' not in line:
                return True
        return False
    except:
        return False


def launch_driver(ver, trials, duration):
    """Launch a driver in background via setsid -f."""
    session = f'p{ver}'
    log_file = CHEAT_DIR / f'parallel-{ver}-driver.out'
    cmd = ['setsid', '-f', 'bash', str(CHEAT_DIR / 'generic-trials.sh'),
           ver, str(trials), str(duration), session]
    with open(log_file, 'w') as lf:
        subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    log(f'  LAUNCHED {ver} driver (session={session})')


def get_heartbeat_age(ver):
    """Returns age in seconds of heartbeat file, or None if missing."""
    hb = CHEAT_DIR / f'parallel-{ver}-heartbeat'
    if not hb.exists():
        return None
    try:
        mtime = hb.stat().st_mtime
        return time.time() - mtime
    except:
        return None


def kill_driver(ver):
    """Kill driver + heartbeat + browser session."""
    session = f'p{ver}'
    subprocess.run(['pkill', '-f', f'generic-trials.sh {ver}'], timeout=5,
                   capture_output=True)
    subprocess.run(['pkill', '-f', f'--session {session}'], timeout=5,
                   capture_output=True)
    # Kill heartbeat background process
    subprocess.run(['pkill', '-f', f'parallel-{ver}-heartbeat'], timeout=5,
                   capture_output=True)
    time.sleep(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('versions', nargs='+')
    ap.add_argument('--trials', type=int, default=30)
    ap.add_argument('--duration', type=int, default=90)
    ap.add_argument('--max-retries', type=int, default=3, help='Max retries per anomalous trial')
    args = ap.parse_args()

    log('=' * 70)
    log(f'TRIAL WATCHDOG STARTING')
    log(f'  Versions: {args.versions}')
    log(f'  Trials per map: {args.trials}')
    log(f'  Duration: {args.duration}s')
    log(f'  Max retries: {args.max_retries}')
    log(f'  Total trials per version: {args.trials * 5}')
    log(f'  Total trials: {args.trials * 5 * len(args.versions)}')
    log(f'  Features: heartbeat (10s/30s), backup retention (last 3), pre-switch backup')
    log('=' * 70)

    # Track backup milestones per version (backup after every 30 trials per version)
    backup_milestones = {v: set() for v in args.versions}  # milestone numbers hit
    # Track retry counts per (version, trial, level_id, aimbot_off)
    retry_counts = {}
    # Track per-version completion (for pre-switch backup)
    completed_versions = set()

    # Initial launch of all versions in parallel
    for ver in args.versions:
        # Verify cheat file exists
        cheat_file = DOWNLOAD_DIR / f'wankle-cheat-{ver}.user.js'
        if not cheat_file.exists():
            log(f'ERROR: {cheat_file} missing — skipping {ver}')
            continue
        if not driver_running(ver):
            launch_driver(ver, args.trials, args.duration)
        else:
            log(f'  {ver} driver already running, will monitor')
        # Initial backup of empty state
        backup_version(ver, 'start')

    # Main monitoring loop
    target_per_version = args.trials * 5  # 5 maps
    last_check_counts = {v: 0 for v in args.versions}
    no_progress_count = {v: 0 for v in args.versions}
    heartbeat_warned = {v: False for v in args.versions}

    while True:
        all_done = True
        for ver in args.versions:
            rows = read_csv_rows(ver)
            cur_count = len(rows)

            # Check for backup milestone (every 30 trials)
            milestone = cur_count // 30
            if milestone > 0 and milestone not in backup_milestones[ver]:
                backup_milestones[ver].add(milestone)
                backup_version(ver, f't{milestone*30}')

            # Check completion
            if cur_count < target_per_version:
                all_done = False
            elif ver not in completed_versions:
                # v27-watchdog-upgrade: PRE-VERSION-SWITCH BACKUP
                # First time we hit target — back up before "switching" (ending this version)
                log(f'  {ver}: reached {cur_count}/{target_per_version} — PRE-SWITCH BACKUP')
                backup_version(ver, 'pre-switch-complete')
                completed_versions.add(ver)

            # v27-watchdog-upgrade: HEARTBEAT CHECK (10s write, 30s stall = hung)
            hb_age = get_heartbeat_age(ver)
            dr = driver_running(ver)
            if dr and hb_age is not None and hb_age > 30:
                # Heartbeat stalled — driver hung (not just slow)
                if not heartbeat_warned[ver]:
                    log(f'  {ver}: HEARTBEAT STALLED ({hb_age:.0f}s old) — hung, killing + restarting')
                    heartbeat_warned[ver] = True
                kill_driver(ver)
                launch_driver(ver, args.trials, args.duration)
                no_progress_count[ver] = 0
            elif dr and hb_age is not None and hb_age <= 30:
                heartbeat_warned[ver] = False  # reset warning once healthy

            # Check driver is running
            if not dr and cur_count < target_per_version:
                log(f'  {ver}: driver dead, {cur_count}/{target_per_version} done — relaunching')
                launch_driver(ver, args.trials, args.duration)
                no_progress_count[ver] = 0
            elif dr and cur_count == last_check_counts[ver]:
                no_progress_count[ver] += 1
                if no_progress_count[ver] >= 6:  # 6 * 30s = 3min no progress
                    log(f'  {ver}: no progress for 3min (heartbeat age: {hb_age}), killing + restarting driver')
                    kill_driver(ver)
                    launch_driver(ver, args.trials, args.duration)
                    no_progress_count[ver] = 0
            elif cur_count > last_check_counts[ver]:
                no_progress_count[ver] = 0

            # Detect anomalous rows (only when driver is not currently mid-run on that trial)
            # To avoid race conditions, only check rows that are at least 1 trial old
            if cur_count > 1:
                # Check last completed row for anomaly
                last_row = rows[-1]
                anomalous, reason = is_anomalous(last_row)
                if anomalous:
                    key = f"{ver}|{last_row['trial']}|{last_row['levelId']}|{last_row['aimbotOff']}"
                    retry_counts[key] = retry_counts.get(key, 0) + 1
                    if retry_counts[key] <= args.max_retries:
                        log(f'  {ver} t{last_row["trial"]} {last_row["levelId"]}: ANOMALY ({reason}) — retry {retry_counts[key]}/{args.max_retries}')
                        log_anomaly(ver, last_row, reason, f'retry_{retry_counts[key]}')
                        remove_anomalous_rows(ver, [last_row])
                    else:
                        log(f'  {ver} t{last_row["trial"]} {last_row["levelId"]}: ANOMALY ({reason}) — MAX RETRIES, leaving in CSV')
                        log_anomaly(ver, last_row, reason, 'max_retries_exceeded')

            last_check_counts[ver] = cur_count

        if all_done:
            log('ALL VERSIONS COMPLETE — final anomaly sweep')
            for ver in args.versions:
                rows = read_csv_rows(ver)
                anomalies = []
                for r in rows:
                    a, reason = is_anomalous(r)
                    if a:
                        anomalies.append((r, reason))
                if anomalies:
                    log(f'  {ver}: {len(anomalies)} anomalous rows in final sweep')
                    for r, reason in anomalies:
                        key = f"{ver}|{r['trial']}|{r['levelId']}|{r['aimbotOff']}"
                        retry_counts[key] = retry_counts.get(key, 0) + 1
                        if retry_counts[key] <= args.max_retries:
                            log(f'    RE-RUN t{r["trial"]} {r["levelId"]} ({reason})')
                            log_anomaly(ver, r, reason, f'final_sweep_retry_{retry_counts[key]}')
                            remove_anomalous_rows(ver, [r])
                    # Relaunch driver for re-runs
                    if not driver_running(ver):
                        launch_driver(ver, args.trials, args.duration)
                    all_done = False  # not actually done, re-runs in progress
                else:
                    log(f'  {ver}: all {len(rows)} trials valid — backing up')
                    backup_version(ver, 'final')
            log(f'  FOR LOOP DONE — all_done={all_done}')
        if all_done:
                break

        # v27-manifest: refresh manifest every cycle (but make it non-blocking — fire-and-forget)
        # Don't block the monitoring loop on manifest updates
        try:
            subprocess.Popen(['python3', str(CHEAT_DIR / 'manifest-writer.py')],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             stdin=subprocess.DEVNULL, start_new_session=True)
        except Exception as e:
            log(f'  manifest update failed: {e}')

        log(f'  CYCLE COMPLETE — sleeping 30s')
        time.sleep(30)  # check every 30s

    log('=' * 70)
    log('TRIAL WATCHDOG COMPLETE — all versions, all trials, all valid')
    for ver in args.versions:
        rows = read_csv_rows(ver)
        log(f'  {ver}: {len(rows)} trials')
    log('=' * 70)


if __name__ == '__main__':
    main()
