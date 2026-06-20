#!/usr/bin/env python3
"""
backup-manager.py — handles backups + retention.

ONLY does:
  - Every 30s, check each version's trial count
  - When a version crosses a 30-trial milestone, back up CSV+JSONL
  - When a version completes, do pre-switch backup
  - Retain only last 3 backups per version

Independent of watchdog. If it dies, just relaunch.
"""
import csv
import shutil
import time
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
BACKUP_DIR = Path('/home/z/my-project/download/backups/trial-watchdog-backups')
LOG_PATH = CHEAT_DIR / 'backup-manager.log'

ALL_PLANNED_VERSIONS = ['v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27']
TARGET_PER_VERSION = 150
KEEP_LAST = 3

BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG_PATH, 'a') as f:
        f.write(line + '\n')


def count_trials(ver):
    csv_path = CHEAT_DIR / f'parallel-{ver}-results.csv'
    if not csv_path.exists():
        return 0
    try:
        with open(csv_path) as f:
            return sum(1 for _ in f) - 1
    except:
        return 0


def backup_version(ver, label):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    bk = BACKUP_DIR / f'{ver}-{label}-{ts}'
    bk.mkdir(parents=True, exist_ok=True)
    csv_src = CHEAT_DIR / f'parallel-{ver}-results.csv'
    if csv_src.exists():
        shutil.copy2(csv_src, bk / csv_src.name)
    jsonl_src = CHEAT_DIR / f'parallel-{ver}-logs'
    if jsonl_src.exists():
        shutil.copytree(jsonl_src, bk / jsonl_src.name, dirs_exist_ok=True)
    log(f'  BACKUP {ver} ({label}) → {bk}')
    # Retention: keep only KEEP_LAST most recent
    backups = sorted(BACKUP_DIR.glob(f'{ver}-*'), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[KEEP_LAST:]:
        try:
            shutil.rmtree(old)
            log(f'  RETENTION deleted {old.name}')
        except Exception as e:
            log(f'  RETENTION failed {old.name}: {e}')


def main():
    log('backup-manager started (30s loop)')
    milestones_hit = {v: set() for v in ALL_PLANNED_VERSIONS}
    completed = set()
    while True:
        try:
            for ver in ALL_PLANNED_VERSIONS:
                n = count_trials(ver)
                # Milestone backup every 30 trials
                milestone = n // 30
                if milestone > 0 and milestone not in milestones_hit[ver]:
                    milestones_hit[ver].add(milestone)
                    backup_version(ver, f't{milestone*30}')
                # Pre-switch backup on completion
                if n >= TARGET_PER_VERSION and ver not in completed:
                    completed.add(ver)
                    backup_version(ver, 'pre-switch-complete')
                    log(f'  {ver} COMPLETE — pre-switch backup done')
        except Exception as e:
            log(f'  ERROR: {e}')
        time.sleep(30)


if __name__ == '__main__':
    main()
