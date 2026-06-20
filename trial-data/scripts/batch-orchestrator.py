#!/usr/bin/env python3
"""
batch-orchestrator.py — watches the watchdog log for BATCH COMPLETE events,
advances the active batch through the planned sequence.

Planned sequence:
  Batch 1: v24 v25 v27                        (contenders — currently running)
  Batch 2: v27-no-pathguard v27-cap-pred8 v27-mag045  (A/B variants)
  Batch 3: v19 v21.7 v22.8                    (baseline RK+Dun reruns)

How it works:
  - Reads /home/z/agent-ctx/active-batch.txt to know current batch
  - Tails watchdog.log for "BATCH COMPLETE" message
  - When detected, writes next batch to active-batch.txt
  - watchdog-wrapper.sh (already running) will pick up the new batch on next
    watchdog.py restart (within ~5s of BATCH COMPLETE)
  - When all 3 batches done, writes "DONE" marker and exits

This script does NOT touch the running drivers or wrappers. It only updates
the batch file. The wrapper handles the actual restart.

Launch with: setsid -f python3 batch-orchestrator.py
"""
import re
import time
from datetime import datetime
from pathlib import Path

BATCH_FILE = Path('/home/z/agent-ctx/active-batch.txt')
WATCHDOG_LOG = Path('/home/z/my-project/scripts/cheat-tests/watchdog.log')
ORCHESTRATOR_LOG = Path('/home/z/my-project/scripts/cheat-tests/batch-orchestrator.log')
DONE_MARKER = Path('/home/z/agent-ctx/all-batches-complete.flag')

# Ordered batch sequence
BATCH_SEQUENCE = [
    'v24 v25 v27',
    'v27-no-pathguard v27-cap-pred8 v27-mag045',
    'v19 v21.7 v22.8',
]


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(ORCHESTRATOR_LOG, 'a') as f:
        f.write(line + '\n')


def current_batch():
    if not BATCH_FILE.exists():
        return None
    return BATCH_FILE.read_text().strip()


def current_batch_index():
    cb = current_batch()
    if cb is None:
        return -1
    for i, b in enumerate(BATCH_SEQUENCE):
        if b == cb:
            return i
    return -1


def advance_batch():
    """Write the next batch to the batch file. Returns True if advanced, False if done."""
    idx = current_batch_index()
    if idx == -1:
        log(f'ERROR: current batch "{current_batch()}" not in sequence — staying put')
        return False
    if idx + 1 >= len(BATCH_SEQUENCE):
        log(f'All {len(BATCH_SEQUENCE)} batches complete — writing DONE marker')
        DONE_MARKER.write_text(str(int(time.time())))
        return False
    next_batch = BATCH_SEQUENCE[idx + 1]
    log(f'Advancing: batch {idx+1} "{BATCH_SEQUENCE[idx]}" → batch {idx+2} "{next_batch}"')
    BATCH_FILE.write_text(next_batch)
    return True


def scan_for_batch_complete(since_offset):
    """Scan watchdog log from given offset for BATCH COMPLETE messages.
    Returns (new_offset, list_of_batches_completed)."""
    if not WATCHDOG_LOG.exists():
        return 0, []
    try:
        with open(WATCHDOG_LOG) as f:
            f.seek(since_offset)
            new_text = f.read()
            new_offset = f.tell()
    except Exception as e:
        log(f'ERROR reading watchdog log: {e}')
        return since_offset, []
    completions = []
    # Use re.DOTALL so .*? matches across newlines (the two log lines are
    # on separate lines in watchdog.log)
    for m in re.finditer(r'BATCH COMPLETE.*?Batch was: \[([^\]]+)\]', new_text, re.DOTALL):
        completions.append(m.group(1))
    return new_offset, completions


def main():
    log('batch-orchestrator started (15s loop)')
    log(f'  Current batch: "{current_batch()}"')
    log(f'  Sequence: {BATCH_SEQUENCE}')

    if DONE_MARKER.exists():
        log(f'DONE marker already present — all batches complete. Exiting.')
        return

    # Start scanning from current end of log (don't reprocess old BATCH COMPLETE msgs)
    last_offset = WATCHDOG_LOG.stat().st_size if WATCHDOG_LOG.exists() else 0
    log(f'  Starting log scan at offset {last_offset}')

    while True:
        try:
            if DONE_MARKER.exists():
                log('DONE marker detected — exiting.')
                break

            new_offset, completions = scan_for_batch_complete(last_offset)
            last_offset = new_offset

            for completed_batch in completions:
                log(f'Detected BATCH COMPLETE: {completed_batch}')
                advance_batch()

            time.sleep(15)
        except Exception as e:
            log(f'ERROR: {e}')
            time.sleep(30)


if __name__ == '__main__':
    main()
