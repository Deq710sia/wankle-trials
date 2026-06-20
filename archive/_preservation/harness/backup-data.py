#!/usr/bin/env python3
"""
backup-data.py — Safety script to back up trial data before it gets wiped.

Run this AFTER every trial batch to preserve data. Creates timestamped backups
of:
  - survival-results.csv (the master results CSV)
  - trial-logs/ (all JSONL files)
  - robust-progress.log (the runner's progress log)

Backups go to /home/z/my-project/download/backups/ with timestamps.

Usage:
  python3 backup-data.py [label]
  python3 backup-data.py v22.5-dodge-training-complete
"""
import csv
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
BACKUP_DIR = Path('/home/z/my-project/download/backups')
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

def backup(label=''):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    label_part = f'-{label}' if label else ''
    backup_name = f'v22.5{label_part}-{ts}'
    backup_path = BACKUP_DIR / backup_name
    backup_path.mkdir(parents=True)

    files_backed_up = []

    # 1. CSV
    csv_src = CHEAT_DIR / 'survival-results.csv'
    if csv_src.exists():
        shutil.copy2(csv_src, backup_path / 'survival-results.csv')
        files_backed_up.append(f'CSV ({sum(1 for _ in open(csv_src)) - 1} rows)')

    # 2. JSONL files
    jsonl_src = CHEAT_DIR / 'trial-logs'
    jsonl_count = 0
    if jsonl_src.exists():
        jsonl_dst = backup_path / 'trial-logs'
        jsonl_dst.mkdir()
        for f in jsonl_src.glob('*.jsonl'):
            shutil.copy2(f, jsonl_dst / f.name)
            jsonl_count += 1
        files_backed_up.append(f'JSONL ({jsonl_count} files)')

    # 3. Progress log
    log_src = CHEAT_DIR / 'robust-progress.log'
    if log_src.exists():
        shutil.copy2(log_src, backup_path / 'robust-progress.log')
        files_backed_up.append('progress log')

    # 4. Summary file
    summary_path = backup_path / 'SUMMARY.txt'
    with open(summary_path, 'w') as f:
        f.write(f'Backup: {backup_name}\n')
        f.write(f'Timestamp: {datetime.now().isoformat()}\n')
        f.write(f'Label: {label or "(none)"}\n\n')
        f.write(f'Files backed up: {", ".join(files_backed_up)}\n\n')

        # Per-map trial counts
        if csv_src.exists():
            from collections import Counter
            counts = Counter()
            with open(csv_src) as cf:
                reader = csv.DictReader(cf)
                for row in reader:
                    counts[(row.get('levelId','?'), row.get('aimbotOff','0'))] += 1
            f.write('Trial counts per (map, aimbotOff):\n')
            for k, v in sorted(counts.items()):
                f.write(f'  {k[0]:30} aimbotOff={k[1]}: {v} trials\n')

    print(f'✓ Backed up to: {backup_path}')
    print(f'  {", ".join(files_backed_up)}')
    return backup_path

if __name__ == '__main__':
    label = sys.argv[1] if len(sys.argv) > 1 else ''
    backup(label)
