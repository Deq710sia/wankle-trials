#!/usr/bin/env python3
"""
merge-archived-data.py — after batch 3 (v19/v21.7/v22.8 reruns) completes,
merge the old archived RK+Dun rows back into the active per-version CSVs
with an `incomplete=1` column.

Why: the old archived trials have valid kill/death/wave/survival data even
though their dodge telemetry was missing (the hunter-bot gap). "More kill
data is more kill data." We preserve it for analysis but clearly mark it
as incomplete so analysis scripts can filter on `incomplete=0` for clean
data only.

What this script does:
  1. For each version in [v19, v21.7, v22.8]:
     a. Read the active CSV (parallel-{v}-results.csv)
     b. Read the archived CSV (archive/incomplete-hunter-telemetry/{v}-RK-Dun-results.csv)
     c. Add an `incomplete` column to the active CSV (default 0)
     d. Append archived rows with `incomplete=1` to the active CSV
  2. Idempotent: if `incomplete` column already exists, skip
  3. Backs up the original active CSV to archive/ before modifying

Run AFTER batch 3 completes (all 9 versions at 150/150).
Run manually: python3 merge-archived-data.py
"""
import csv
import shutil
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
ARCHIVE_DIR = Path('/home/z/agent-ctx/archive/incomplete-hunter-telemetry')
BACKUP_DIR = Path('/home/z/agent-ctx/archive/pre-merge-archived-' + datetime.now().strftime('%Y%m%d-%H%M%S'))

VERSIONS = ['v19', 'v21.7', 'v22.8']


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def merge_version(ver):
    active_csv = CHEAT_DIR / f'parallel-{ver}-results.csv'
    archived_csv = ARCHIVE_DIR / f'{ver}-RK-Dun-results.csv'

    if not active_csv.exists():
        log(f'  {ver}: active CSV missing — skipping')
        return False
    if not archived_csv.exists():
        log(f'  {ver}: archived CSV missing — skipping')
        return False

    # Read active CSV
    with open(active_csv) as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        active_rows = list(reader)

    # Check if incomplete column already exists
    if 'incomplete' in fieldnames:
        log(f'  {ver}: incomplete column already exists — skipping (idempotent)')
        return False

    # Read archived CSV
    with open(archived_csv) as f:
        reader = csv.DictReader(f)
        archived_rows = list(reader)

    # Backup original active CSV
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(active_csv, BACKUP_DIR / f'parallel-{ver}-results.csv')

    # Add incomplete column to fieldnames + active rows
    new_fieldnames = list(fieldnames) + ['incomplete']
    for row in active_rows:
        row['incomplete'] = '0'

    # Add incomplete=1 to archived rows
    for row in archived_rows:
        row['incomplete'] = '1'

    # Write merged CSV
    with open(active_csv, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        for row in active_rows:
            writer.writerow(row)
        for row in archived_rows:
            writer.writerow(row)

    log(f'  {ver}: merged {len(active_rows)} active + {len(archived_rows)} archived = {len(active_rows) + len(archived_rows)} total rows')
    log(f'  {ver}: original backed up to {BACKUP_DIR / f"parallel-{ver}-results.csv"}')
    return True


def main():
    log('merge-archived-data starting')
    log(f'  backup dir: {BACKUP_DIR}')
    log(f'  versions: {VERSIONS}')

    merged = 0
    for ver in VERSIONS:
        log(f'  processing {ver}...')
        if merge_version(ver):
            merged += 1

    log(f'')
    log(f'=== Merge complete ===')
    log(f'  {merged}/{len(VERSIONS)} versions merged')
    log(f'  Originals backed up to: {BACKUP_DIR}')
    log(f'')
    log(f'  The active CSVs now have an `incomplete` column:')
    log(f'    incomplete=0 → clean data (full telemetry)')
    log(f'    incomplete=1 → archived data (valid kills, missing telemetry)')
    log(f'')
    log(f'  Analysis scripts should filter `WHERE incomplete=0` for clean data.')
    log(f'  The archived rows are also preserved in archive/incomplete-hunter-telemetry/')

    # Also update the README in archive/ to document this
    readme = ARCHIVE_DIR / 'README.md'
    readme.write_text(f"""# Incomplete Hunter Telemetry Archive

This folder contains 262 trials (RK Fight + Dungeon across v19, v21.7, v22.8, v24, v25, v27) that were run with the unpatched `hunter-bot-v3.js` — the bot was reading telemetry into variables but never writing them to the sample output. As a result, these trials are missing 11 telemetry fields:

`realShells`, `predictedShells`, `pathGuardCrosses`, `dodgeMoveX`, `dodgeMoveZ`, `coldSpotReactive`, `coldSpotStrategic`, `guardViolated`, `pathGuardRotation`, `pathGuardResolved`, `pathGuardShells`

## What's preserved

- **Kill/death/wave/survival data** — VALID. The cheat still played the game; we just didn't record dodge telemetry.
- **JSONL logs** — frame-by-frame data is here, just missing the 11 fields.
- **CSV rows** — preserved in `{version}-RK-Dun-results.csv` files.

## What's missing

- The 11 telemetry fields listed above (everything else is present).

## How this data is used

After batch 3 completes (reruns of v19/v21.7/v22.8 RK+Dun with the patched bot), the old archived rows are merged back into the active per-version CSVs with an `incomplete=1` column. Analysis scripts can filter `WHERE incomplete=0` for clean data only, or include the archived rows for kill/death statistics (where the data is valid).

## Files

- `trials-incomplete.jsonl` — 262 trial entries moved out of `trials.jsonl`
- `v{X}-RK-Dun-results.csv` — per-version CSV rows (RK Fight + Dungeon)
- `v{X}-logs/` — per-version JSONL logs
- `v{X}-telemetry/` — per-version telemetry JSON (if it existed)

Last updated: {datetime.now().isoformat()}
""")


if __name__ == '__main__':
    main()
