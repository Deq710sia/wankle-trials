#!/usr/bin/env python3
"""
parallel-trial-runner.py — Run multiple cheat versions in parallel using
separate agent-browser sessions. Each version gets its own:
  - Browser session (--session flag)
  - CSV file (v{version}-results.csv)
  - JSONL directory (trial-logs-{version}/)

Usage:
  python3 parallel-trial-runner.py v23 v24
  python3 parallel-trial-runner.py v23 v24 v25 --trials 3

Each version runs in its own daemon process. The script launches all
versions simultaneously, monitors them, and collects results when done.
"""
import argparse
import csv
import json
import os
import subprocess
import time
from pathlib import Path
from statistics import mean

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
DOWNLOAD_DIR = Path('/home/z/my-project/download')

MAPS_SURVIVAL = [
    ('custom-c2738ec4-135', 'passive', 'Custom Arena', 'survival', False),
    ('custom-c69c5ff7-f4e', 'hunter', 'RK Fight', 'survival', False),
    ('custom-a6b7c90f-813', 'hunter', 'Dungeon', 'survival', False),
]
MAPS_DODGE = [
    ('custom-5f697a3b-742', 'passive-nofire', 'Dodge Training (OFF)', 'campaign', True),
    ('custom-5f697a3b-742', 'passive', 'Dodge Training (ON)', 'campaign', False),
]

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)

def run_version_trial(version, trial_num, level_id, bot_type, map_name, mode, aimbot_off, session_name):
    """Run a single trial for a specific version using a named browser session."""
    csv_file = CHEAT_DIR / f'parallel-{version}-results.csv'
    jsonl_dir = CHEAT_DIR / f'parallel-{version}-logs'
    jsonl_dir.mkdir(exist_ok=True)
    log_dir = CHEAT_DIR / f'parallel-{version}-runlogs'
    log_dir.mkdir(exist_ok=True)

    # Build a modified harness command that uses --session
    env = os.environ.copy()
    env['TRIALS'] = '1'
    env['TRIAL_NUM'] = str(trial_num)
    env['DURATION'] = '90'
    env['BOT_TYPE'] = bot_type
    env['LEVEL_ID'] = level_id
    env['MODE'] = mode
    env['AIMBOT_OFF'] = '1' if aimbot_off else '0'
    env['PARALLEL_SESSION'] = session_name
    env['PARALLEL_CSV'] = str(csv_file)
    env['PARALLEL_JSONL_DIR'] = str(jsonl_dir)
    env['PARALLEL_LOG_DIR'] = str(log_dir)

    # Use a modified harness that respects PARALLEL_SESSION
    cmd = ['bash', str(CHEAT_DIR / 'survival-showdown-parallel.sh'), version]
    try:
        result = subprocess.run(cmd, cwd=str(CHEAT_DIR), env=env,
                                capture_output=True, text=True, timeout=300)
        return result
    except subprocess.TimeoutExpired:
        log(f'  [{version}] TIMEOUT')
        return None
    except Exception as e:
        log(f'  [{version}] ERROR: {e}')
        return None

def get_completed_trials(csv_file):
    """Read CSV and return set of (version, trial, level_id, aimbot_off) tuples."""
    if not csv_file.exists():
        return set()
    done = set()
    with open(csv_file) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('version') == 'version':
                continue
            done.add((row['version'], int(row['trial']), row['levelId'], row.get('aimbotOff', '0')))
    return done

def main():
    parser = argparse.ArgumentParser(description='Run parallel cheat trials')
    parser.add_argument('versions', nargs='+', help='Versions to test (e.g. v23 v24)')
    parser.add_argument('--trials', type=int, default=5, help='Trials per map per version')
    parser.add_argument('--duration', type=int, default=90, help='Trial duration in seconds')
    parser.add_argument('--maps', choices=['survival', 'dodge', 'all'], default='all',
                       help='Which maps to test')
    parser.add_argument('--sequential', action='store_true',
                       help='Run versions sequentially (for debugging)')
    args = parser.parse_args()

    maps = []
    if args.maps in ('survival', 'all'):
        maps.extend(MAPS_SURVIVAL)
    if args.maps in ('dodge', 'all'):
        maps.extend(MAPS_DODGE)

    total_per_version = len(maps) * args.trials
    log(f'PARALLEL TRIAL RUNNER')
    log(f'  Versions: {args.versions}')
    log(f'  Maps: {len(maps)}')
    log(f'  Trials per map: {args.trials}')
    log(f'  Total per version: {total_per_version}')
    log(f'  Total trials: {total_per_version * len(args.versions)}')
    log(f'  Duration: {args.duration}s each')
    log(f'  Mode: {"sequential" if args.sequential else "parallel"}')
    log('')

    for version in args.versions:
        # Check cheat file exists
        cheat_file = DOWNLOAD_DIR / f'wankle-cheat-{version}.user.js'
        if not cheat_file.exists():
            log(f'ERROR: {cheat_file} not found, skipping {version}')
            continue

    # Run trials
    for level_id, bot_type, map_name, mode, aimbot_off in maps:
        for trial_num in range(1, args.trials + 1):
            if args.sequential:
                # Run one at a time
                for version in args.versions:
                    session = f'p{version}'
                    csv_file = CHEAT_DIR / f'parallel-{version}-results.csv'
                    done = get_completed_trials(csv_file)
                    key = (version, trial_num, level_id, '1' if aimbot_off else '0')
                    if key in done:
                        log(f'  SKIP {version} t{trial_num} {map_name} (already done)')
                        continue
                    log(f'  RUN {version} t{trial_num} {map_name}')
                    result = run_version_trial(version, trial_num, level_id, bot_type,
                                             map_name, mode, aimbot_off, session)
                    if result:
                        log(f'  DONE {version} t{trial_num}')
            else:
                # Run all versions in parallel for this trial
                processes = []
                for version in args.versions:
                    csv_file = CHEAT_DIR / f'parallel-{version}-results.csv'
                    done = get_completed_trials(csv_file)
                    key = (version, trial_num, level_id, '1' if aimbot_off else '0')
                    if key in done:
                        log(f'  SKIP {version} t{trial_num} {map_name} (already done)')
                        continue

                    session = f'p{version}'
                    log(f'  START {version} t{trial_num} {map_name} (session: {session})')

                    env = os.environ.copy()
                    env['TRIALS'] = '1'
                    env['TRIAL_NUM'] = str(trial_num)
                    env['DURATION'] = str(args.duration)
                    env['BOT_TYPE'] = bot_type
                    env['LEVEL_ID'] = level_id
                    env['MODE'] = mode
                    env['AIMBOT_OFF'] = '1' if aimbot_off else '0'
                    env['PARALLEL_SESSION'] = session
                    env['PARALLEL_CSV'] = str(csv_file)
                    env['PARALLEL_JSONL_DIR'] = str(CHEAT_DIR / f'parallel-{version}-logs')
                    env['PARALLEL_LOG_DIR'] = str(CHEAT_DIR / f'parallel-{version}-runlogs')

                    p = subprocess.Popen(
                        ['bash', str(CHEAT_DIR / 'survival-showdown-parallel.sh'), version],
                        cwd=str(CHEAT_DIR), env=env,
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
                    )
                    processes.append((version, p))

                # Wait for all parallel processes
                for version, p in processes:
                    try:
                        stdout, stderr = p.communicate(timeout=300)
                        log(f'  DONE {version} t{trial_num} (exit {p.returncode})')
                    except subprocess.TimeoutExpired:
                        p.kill()
                        log(f'  TIMEOUT {version} t{trial_num}')

    # Summary
    log('')
    log('=== RESULTS SUMMARY ===')
    for version in args.versions:
        csv_file = CHEAT_DIR / f'parallel-{version}-results.csv'
        if not csv_file.exists():
            log(f'  {version}: no results')
            continue
        by_map = {}
        with open(csv_file) as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get('version') == 'version':
                    continue
                m = row.get('map_name', row['levelId'])
                if m not in by_map:
                    by_map[m] = []
                by_map[m].append({'K': int(row['kills']), 'D': int(row['deaths']),
                                  'alive': int(row['alive'])})
        log(f'  {version}:')
        for m, trials in sorted(by_map.items()):
            if trials:
                avg_k = mean(t['K'] for t in trials)
                avg_d = mean(t['D'] for t in trials)
                surv = sum(1 for t in trials if t['alive']) / len(trials) * 100
                log(f'    {m}: K={avg_k:.1f} D={avg_d:.1f} Surv={surv:.0f}% (n={len(trials)})')

if __name__ == '__main__':
    main()
