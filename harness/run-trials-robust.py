#!/usr/bin/env python3
"""
run-trials-robust.py — Reliable trial runner with retry + anomaly detection.

Resumable: reads survival-results.csv to see what (version, trial, level) combos
are already done, and only runs the missing ones. This means if the runner dies
mid-way, you can just re-run it and it picks up where it left off.

Per-trial retry: if a trial produces 0 kills OR dies in <15s OR fps<30, retry
up to 2 times before accepting the result.

Anomaly alert: after each trial, checks JSONL has >=30 samples (i.e. telemetry
flowed for at least 30s). If not, flags and retries.

Usage:
  python3 run-trials-robust.py
"""
import csv
import os
import subprocess
import sys
import time
import json
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
DOWNLOAD_DIR = Path('/home/z/my-project/download')
CSV_PATH = CHEAT_DIR / 'survival-results.csv'
JSONL_DIR = CHEAT_DIR / 'trial-logs'
PROGRESS_LOG = CHEAT_DIR / 'robust-progress.log'

# 1 version × 4 maps × 5 trials = 20 trials for v22.5
# Dodge Training runs twice: 5 with aimbot OFF (Safe profile, pure dodge) +
# 5 with aimbot ON (Rage profile, realistic dodge). Total = 25 trials.
VERSIONS = ['v23']
MAPS = [
    ('custom-c2738ec4-135', 'passive', 'Custom Arena', 'survival',  False),
    ('custom-c69c5ff7-f4e', 'hunter',  'RK Fight',     'survival',  False),
    ('custom-a6b7c90f-813', 'hunter',  'Dungeon',      'survival',  False),
    ('custom-5f697a3b-742', 'passive-nofire', 'Dodge Training (aimbot OFF)', 'campaign', True),
    ('custom-5f697a3b-742', 'passive', 'Dodge Training (aimbot ON)',  'campaign', False),
]
TRIALS_PER = 5
DURATION_S = 90
MAX_RETRIES = 2

# Anomaly thresholds
MIN_KILLS_ALERT = 0       # 0 kills in 90s = suspicious
MIN_DURATION_ALERT = 15   # died before 15s = suspicious
MIN_FPS_ALERT = 30        # fps < 30 = unplayable, results unreliable
MIN_JSONL_SAMPLES = 30    # JSONL should have ~90 samples for 90s trial

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    with open(PROGRESS_LOG, 'a') as f:
        f.write(line + '\n')

def load_completed():
    """Returns a set of (version, trial_num, level_id) tuples already done."""
    done = set()
    if not CSV_PATH.exists():
        return done
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('version') == 'version':
                continue
            # v22.5: include aimbotOff in key so Dodge Training can run twice
            key = (row['version'], int(row['trial']), row['levelId'], row.get('aimbotOff', '0') == '1')
            done.add(key)
    return done

def run_single_trial(version, trial_num, level_id, bot_type, mode='survival', aimbot_off=False):
    """Run one trial via survival-showdown-v2.sh. Returns parsed result dict or None."""
    env = os.environ.copy()
    env['TRIALS'] = '1'
    env['TRIAL_NUM'] = str(trial_num)  # v22.2: run only this specific trial number
    env['DURATION'] = str(DURATION_S)
    env['BOT_TYPE'] = bot_type
    env['LEVEL_ID'] = level_id
    env['MODE'] = mode                  # v22.3: 'survival' or 'campaign'
    env['AIMBOT_OFF'] = '1' if aimbot_off else '0'  # v22.3: disable aimbot for pure dodge tests
    cmd = ['bash', 'survival-showdown-v2.sh', version]
    try:
        # 5 minute timeout per trial (90s trial + ~10s setup + buffer)
        result = subprocess.run(
            cmd, cwd=str(CHEAT_DIR), env=env,
            capture_output=True, text=True, timeout=300
        )
        return result
    except subprocess.TimeoutExpired:
        log(f'    TIMEOUT after 300s')
        return None
    except Exception as e:
        log(f'    EXCEPTION: {e}')
        return None

def parse_csv_row(version, trial_num, level_id, aimbot_off=False):
    """Read the LAST matching row from CSV (in case of retries that wrote multiple).
    v22.5: also matches aimbotOff so Dodge Training aimbot-OFF and aimbot-ON trials
    don't conflict.
    """
    if not CSV_PATH.exists():
        return None
    aimbot_val = '1' if aimbot_off else '0'
    matching = []
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('version') == 'version':
                continue
            if (row['version'] == version and int(row['trial']) == trial_num 
                and row['levelId'] == level_id and row.get('aimbotOff', '0') == aimbot_val):
                matching.append(row)
    return matching[-1] if matching else None

def validate_jsonl(version, level_id, trial_num, aimbot_off=False):
    """Check that JSONL file has enough samples. Handles double-encoded entries.
    Returns (sample_count, flags, jsonl_summary) where jsonl_summary has the
    GROUND TRUTH kills/deaths/wave from the last sample (more reliable than CSV).
    Tries multiple filename formats for backward compat.
    v22.5: also tries -noaim suffix for aimbot-off trials.
    """
    # v22.5: try with -noaim suffix first if aimbot_off, then without
    suffix = '-noaim' if aimbot_off else ''
    candidates = [
        f'{version}-{level_id}-t{trial_num}{suffix}.jsonl',
        f'{version}-{level_id}-t{trial_num}.jsonl',
        f'{version}-t{trial_num}.jsonl',
    ]
    jsonl_path = None
    for c in candidates:
        p = JSONL_DIR / c
        if p.exists():
            jsonl_path = p
            break
    if not jsonl_path:
        return 0, 'missing', None
    count = 0
    has_dodge_data = False
    has_death_data = False
    last_sample = None
    death_events = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                # Defensive: handle double-encoded strings
                if isinstance(entry, str):
                    entry = json.loads(entry)
                if not isinstance(entry, dict):
                    continue
                if entry.get('kind') == 'sample':
                    count += 1
                    if 'dodgeActive' in entry:
                        has_dodge_data = True
                    last_sample = entry
                elif entry.get('kind') == 'event' and entry.get('sub') == 'death':
                    has_death_data = True
                    death_events.append(entry)
            except:
                pass
    flags = []
    if not has_dodge_data:
        flags.append('NO_DODGE_DATA')
    # Build ground-truth summary from JSONL (more reliable than CSV's WANKLE.net.meta read)
    summary = None
    if last_sample:
        summary = {
            'kills': last_sample.get('kills', 0),
            'deaths': last_sample.get('deaths', 0),
            'wave': last_sample.get('wave', 0),
            'duration_ms': last_sample.get('tRel', 0),
            'death_count_from_events': len(death_events),
        }
    return count, ','.join(flags) if flags else 'ok', summary

def is_anomalous(row, jsonl_samples, jsonl_flags, jsonl_summary):
    """Returns (is_anomalous, reason). Uses JSONL summary as ground truth for kills.
    Note: in survival mode, death = permadeath (no respawn). So low sample count
    is EXPECTED if the player died early — only flag if player was alive for
    full duration but samples are still low (telemetry failure)."""
    reasons = []
    # Use JSONL ground truth if available
    if jsonl_summary:
        kills = jsonl_summary['kills']
        deaths = jsonl_summary['deaths']
        alive_duration_s = jsonl_summary['duration_ms'] / 1000
        died_early = alive_duration_s < 60 and deaths > 0
    else:
        kills = int(row['kills'])
        deaths = int(row['deaths'])
        alive_duration_s = int(row['durationSec'])
        died_early = False

    # 0 kills in 60+ seconds of ALIVE time = suspicious (cheat not firing)
    if kills == 0 and alive_duration_s >= 60:
        reasons.append(f'0_kills_in_{int(alive_duration_s)}s_alive')
    # Died in <15s of alive time = suspicious (instant death, probably spawn-killed)
    if alive_duration_s < MIN_DURATION_ALERT and deaths > 0:
        reasons.append(f'died_in_{int(alive_duration_s)}s')
    # Low FPS
    if float(row.get('avgFps', 0)) < MIN_FPS_ALERT and float(row.get('avgFps', 0)) > 0:
        reasons.append(f'low_fps={row["avgFps"]}')
    # Low samples — ONLY flag if player was alive for full duration (didn't die early)
    # If player died early, low sample count is expected (bot doesn't log while dead)
    if not died_early and jsonl_samples < MIN_JSONL_SAMPLES:
        reasons.append(f'only_{jsonl_samples}_samples_(alive_{int(alive_duration_s)}s)')
    if 'NO_DODGE_DATA' in jsonl_flags:
        reasons.append('no_dodge_telemetry')
    return (len(reasons) > 0, ','.join(reasons) if reasons else '')

def remove_failed_csv_row(version, trial_num, level_id, aimbot_off=False):
    """Remove the last row matching (version, trial, level, aimbotOff) so re-run writes a fresh one."""
    if not CSV_PATH.exists():
        return
    aimbot_val = '1' if aimbot_off else '0'
    rows = []
    with open(CSV_PATH) as f:
        reader = csv.reader(f)
        rows = list(reader)
    # Find header
    header = rows[0]
    ver_idx = header.index('version')
    trial_idx = header.index('trial')
    level_idx = header.index('levelId')
    aimbot_idx = header.index('aimbotOff') if 'aimbotOff' in header else -1
    # Remove last matching row
    last_match = -1
    for i in range(len(rows) - 1, 0, -1):
        if (rows[i][ver_idx] == version and 
            int(rows[i][trial_idx]) == trial_num and 
            rows[i][level_idx] == level_id and
            (aimbot_idx < 0 or rows[i][aimbot_idx] == aimbot_val)):
            last_match = i
            break
    if last_match > 0:
        del rows[last_match]
        with open(CSV_PATH, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerows(rows)

def main():
    log('=' * 70)
    log('ROBUST TRIAL RUNNER STARTING')
    log(f'Target: {len(VERSIONS)} versions × {len(MAPS)} maps × {TRIALS_PER} trials = {len(VERSIONS)*len(MAPS)*TRIALS_PER} total')
    log('=' * 70)

    done = load_completed()
    log(f'Already completed: {len(done)} trials. Remaining: {len(VERSIONS)*len(MAPS)*TRIALS_PER - len(done)}')

    total_runs = 0
    total_anomalies = 0
    total_retries = 0
    halt_for_human = False

    for level_id, bot_type, map_name, mode, aimbot_off in MAPS:
        if halt_for_human:
            break
        log('')
        mode_label = f'{mode}' + (' +aimbot_off' if aimbot_off else '')
        log(f'### MAP: {map_name} ({level_id}, {bot_type} bot, {mode_label}) ###')
        for version in VERSIONS:
            if halt_for_human:
                break
            for trial_num in range(1, TRIALS_PER + 1):
                # v22.5: include aimbot_off in key so Dodge Training can run twice
                # (once with aimbot OFF, once with aimbot ON) without skip conflicts
                key = (version, trial_num, level_id, aimbot_off)
                if key in done:
                    log(f'  SKIP {version} t{trial_num} (already in CSV)')
                    continue

                log(f'  RUN {version} t{trial_num}/{TRIALS_PER} on {map_name} ({mode_label})')
                attempt = 0
                accepted = False
                while attempt <= MAX_RETRIES and not accepted:
                    attempt += 1
                    total_runs += 1
                    if attempt > 1:
                        log(f'    RETRY #{attempt-1} (of {MAX_RETRIES})')
                        total_retries += 1
                        # Remove the bad row from previous attempt
                        remove_failed_csv_row(version, trial_num, level_id, aimbot_off)

                    result = run_single_trial(version, trial_num, level_id, bot_type, mode=mode, aimbot_off=aimbot_off)
                    if result is None:
                        log(f'    FAILED (no result)')
                        continue

                    row = parse_csv_row(version, trial_num, level_id, aimbot_off)
                    if row is None:
                        log(f'    FAILED (no CSV row written)')
                        continue

                    # Validate JSONL
                    jsonl_samples, jsonl_flags, jsonl_summary = validate_jsonl(version, level_id, trial_num, aimbot_off)
                    anomalous, reason = is_anomalous(row, jsonl_samples, jsonl_flags, jsonl_summary)

                    if anomalous:
                        total_anomalies += 1
                        log(f'    ANOMALY: {reason}')
                        if jsonl_summary:
                            log(f'      JSONL ground truth: K={jsonl_summary["kills"]} D={jsonl_summary["deaths"]} W={jsonl_summary["wave"]} dur={jsonl_summary["duration_ms"]/1000:.0f}s')
                            log(f'      CSV row:           K={row["kills"]} D={row["deaths"]} dur={row["durationSec"]}s fps={row["avgFps"]}')
                        else:
                            log(f'      CSV row: K={row["kills"]} D={row["deaths"]} dur={row["durationSec"]}s fps={row["avgFps"]} jsonl={jsonl_samples}samples')
                        if attempt <= MAX_RETRIES:
                            log(f'      Will retry...')
                            continue
                        else:
                            log(f'      OUT OF RETRIES — accepting bad result, but flagging for human review')
                            # CRITICAL: if 0 kills across all retries (per JSONL ground truth), halt for human inspection
                            if jsonl_summary and jsonl_summary['kills'] == 0 and jsonl_summary['duration_ms'] >= 60000:
                                log(f'      *** HALTING: 0 kills across {attempt} attempts on {version} {map_name} ***')
                                log(f'      *** This suggests the cheat may not be loading or firing. ***')
                                log(f'      *** Inspect manually, fix, then re-run this script. ***')
                                halt_for_human = True
                                break
                            accepted = True
                    else:
                        if jsonl_summary:
                            log(f'    OK: K={jsonl_summary["kills"]} D={jsonl_summary["deaths"]} W={jsonl_summary["wave"]} dur={jsonl_summary["duration_ms"]/1000:.0f}s fps={row["avgFps"]} jsonl={jsonl_samples}samp corr={row.get("corrBuckets","?")}')
                        else:
                            log(f'    OK: K={row["kills"]} D={row["deaths"]} W={row["wave"]} dur={row["durationSec"]}s fps={row["avgFps"]} jsonl={jsonl_samples}samp corr={row.get("corrBuckets","?")}')
                        accepted = True

                if accepted:
                    done.add(key)
                elif halt_for_human:
                    break

        # After each map, dump a quick summary
        log('')
        log(f'--- After {map_name}: {len(done)} total trials in CSV ---')

    log('')
    log('=' * 70)
    log(f'RUNNER COMPLETE')
    log(f'  Total runs attempted: {total_runs}')
    log(f'  Total retries: {total_retries}')
    log(f'  Total anomalies: {total_anomalies}')
    log(f'  Trials in CSV: {len(load_completed())} / {len(VERSIONS)*len(MAPS)*TRIALS_PER}')
    if halt_for_human:
        log(f'  HALTED EARLY for human inspection — see log above')
    log('=' * 70)

if __name__ == '__main__':
    main()
