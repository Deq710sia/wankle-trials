#!/usr/bin/env python3
"""
watchdog.py — BARE MINIMUM driver monitor.

ONLY does:
  - Check if each version's driver (generic-trials.sh) is alive
  - Check heartbeat file (stalled = hung → kill + restart)
  - Restart dead/stalled drivers
  - Log to watchdog.log

Does NOT touch:
  - Manifest
  - Telemetry
  - Backups
  - Anomaly detection (drivers handle their own retry via CSV skip logic)

Usage: python3 watchdog.py v19 v21.7 v22.8 --trials 30 --duration 90
"""
import argparse
import subprocess
import time
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
WATCHDOG_LOG = CHEAT_DIR / 'watchdog.log'


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(WATCHDOG_LOG, 'a') as f:
        f.write(line + '\n')


def driver_running(ver):
    """Check if generic-trials.sh is running for this version."""
    try:
        result = subprocess.run(['ps', '-ef'], capture_output=True, text=True, timeout=5)
        for line in result.stdout.split('\n'):
            if f'generic-trials.sh {ver}' in line and 'grep' not in line:
                return True
        return False
    except:
        return False


def heartbeat_age(ver):
    """Returns age in seconds of heartbeat file, or None if missing."""
    hb = CHEAT_DIR / f'parallel-{ver}-heartbeat'
    if not hb.exists():
        return None
    try:
        return time.time() - hb.stat().st_mtime
    except:
        return None


def kill_driver(ver):
    """Kill driver + browser session for this version."""
    subprocess.run(['pkill', '-f', f'generic-trials.sh {ver}'], timeout=5, capture_output=True)
    subprocess.run(['pkill', '-f', f'--session p{ver}'], timeout=5, capture_output=True)
    time.sleep(3)


def launch_driver(ver, trials, duration):
    """Launch a driver in background."""
    session = f'p{ver}'
    log_file = CHEAT_DIR / f'parallel-{ver}-driver.out'
    cmd = ['setsid', '-f', 'bash', str(CHEAT_DIR / 'generic-trials.sh'),
           ver, str(trials), str(duration), session]
    with open(log_file, 'a') as lf:
        subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    log(f'  LAUNCHED {ver} (session={session})')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('versions', nargs='+')
    ap.add_argument('--trials', type=int, default=30)
    ap.add_argument('--duration', type=int, default=90)
    args = ap.parse_args()

    log('=' * 60)
    log(f'WATCHDOG START (bare minimum)')
    log(f'  Versions: {args.versions}')
    log(f'  Trials per version: {args.trials * 5}')
    log(f'  Duration: {args.duration}s')
    log('=' * 60)

    # Initial launch
    for ver in args.versions:
        if not driver_running(ver):
            launch_driver(ver, args.trials, args.duration)
        else:
            log(f'  {ver} driver already running')

    # Main loop — just check drivers + heartbeat
    last_counts = {v: 0 for v in args.versions}
    no_progress = {v: 0 for v in args.versions}

    # v27-A/B-auto: track whether we've launched A/B variants
    # Persist to file so watchdog restarts don't re-launch or skip A/B
    ab_variants = ['v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045']
    AB_FLAG_FILE = CHEAT_DIR / 'ab-variants-launched.flag'

    def ab_already_launched():
        """Check if A/B variants were already launched (by this or a previous watchdog)."""
        if AB_FLAG_FILE.exists():
            return True
        # Also check if any A/B CSV has trials (means a previous watchdog launched them)
        for abv in ab_variants:
            csv = CHEAT_DIR / f'parallel-{abv}-results.csv'
            if csv.exists():
                try:
                    with open(csv) as f:
                        n = sum(1 for _ in f) - 1
                    if n > 0:
                        return True
                except:
                    pass
        return False

    def mark_ab_launched():
        """Persist that A/B variants have been launched."""
        AB_FLAG_FILE.write_text(str(int(time.time())))

    ab_launched = ab_already_launched()
    if ab_launched:
        log(f'  A/B variants already launched (flag file or CSV data exists) — will monitor them')
        # Add A/B variants to monitored versions
        for abv in ab_variants:
            if abv not in args.versions:
                args.versions.append(abv)
                last_counts[abv] = 0
                no_progress[abv] = 0
        log(f'  Monitoring: {args.versions}')

    while True:
        all_complete = True
        for ver in args.versions:
            # Count CSV rows (lightweight — just wc -l)
            csv_path = CHEAT_DIR / f'parallel-{ver}-results.csv'
            cur_count = 0
            if csv_path.exists():
                try:
                    with open(csv_path) as f:
                        cur_count = sum(1 for _ in f) - 1  # minus header
                        if cur_count < 0: cur_count = 0
                except:
                    pass

            target = args.trials * 5
            if cur_count < target:
                all_complete = False
            else:
                continue  # version complete, skip

            # Check heartbeat
            hb = heartbeat_age(ver)
            dr = driver_running(ver)

            if dr and hb is not None and hb > 30:
                # Hung
                log(f'  {ver}: HEARTBEAT STALLED ({hb:.0f}s) — kill + restart')
                kill_driver(ver)
                launch_driver(ver, args.trials, args.duration)
                no_progress[ver] = 0
                continue

            if not dr:
                log(f'  {ver}: driver dead ({cur_count}/{target}) — relaunch')
                launch_driver(ver, args.trials, args.duration)
                no_progress[ver] = 0
                continue

            # Track progress
            if cur_count == last_counts[ver]:
                no_progress[ver] += 1
                if no_progress[ver] >= 6:  # 3min no progress
                    log(f'  {ver}: no progress 3min ({cur_count}/{target}) — kill + restart')
                    kill_driver(ver)
                    launch_driver(ver, args.trials, args.duration)
                    no_progress[ver] = 0
            else:
                no_progress[ver] = 0

            last_counts[ver] = cur_count

        # v27-A/B-auto: if all monitored versions complete + A/B not yet launched, launch them
        # This handles the contender→A/B handoff automatically.
        # Checks: (1) all args.versions complete, (2) v27 specifically complete, (3) A/B not yet launched
        if all_complete and not ab_launched:
            # Verify v27 (the contender) is complete — only launch A/B if v27 finished
            v27_csv = CHEAT_DIR / 'parallel-v27-results.csv'
            v27_count = 0
            if v27_csv.exists():
                try:
                    with open(v27_csv) as f:
                        v27_count = sum(1 for _ in f) - 1
                except:
                    pass
            if v27_count >= args.trials * 5:
                log(f'  🚀 CONTENDER PHASE COMPLETE — auto-launching A/B variants: {ab_variants}')
                for abv in ab_variants:
                    if not driver_running(abv):
                        launch_driver(abv, args.trials, args.duration)
                        time.sleep(2)
                ab_launched = True
                mark_ab_launched()  # Persist so watchdog restarts don't re-launch
                # Add A/B variants to monitored versions so watchdog keeps an eye on them
                for abv in ab_variants:
                    if abv not in args.versions:
                        args.versions.append(abv)
                        last_counts[abv] = 0
                        no_progress[abv] = 0
                log(f'  A/B variants added to monitoring: {args.versions}')
            elif v27_count < args.trials * 5 and 'v27' not in args.versions:
                # v27 not in args.versions but needs to complete before A/B
                # This handles the case where watchdog was started with only v24/v25
                # but v27 also needs to finish
                log(f'  ⚠️ v27 not complete ({v27_count}/{args.trials * 5}) and not in monitored list — adding it')
                args.versions.append('v27')
                last_counts['v27'] = 0
                no_progress['v27'] = 0
                if not driver_running('v27'):
                    launch_driver('v27', args.trials, args.duration)

        # Check if everything (including A/B) is complete
        if ab_launched:
            all_ab_complete = True
            for abv in ab_variants:
                csv = CHEAT_DIR / f'parallel-{abv}-results.csv'
                n = 0
                if csv.exists():
                    try:
                        with open(csv) as f:
                            n = sum(1 for _ in f) - 1
                    except:
                        pass
                if n < args.trials * 5:
                    all_ab_complete = False
                    break
            if all_ab_complete and all_complete:
                log(f'  🎉 ALL TRIALS COMPLETE — all 9 versions hit {args.trials * 5} trials')
                log(f'  Total: {sum(args.trials * 5 for _ in range(9))} trials done')
                log(f'  Watchdog exiting — trials finished.')
                break

        time.sleep(30)


if __name__ == '__main__':
    main()
