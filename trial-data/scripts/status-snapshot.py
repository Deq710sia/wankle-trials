#!/usr/bin/env python3
"""
status-snapshot.py — captures live VM state into a single JSON file
that gets committed to GitHub by git-backup.sh.

The dashboard site reads this file to display:
  - Driver heartbeats (liveness)
  - Active batch
  - Thread/process counts
  - Anomaly log tail
  - Driver master log tails
  - Watchdog log tail
  - ASCII art index

Runs every 30s, writes to /home/z/agent-ctx/status-snapshot.json.
git-backup.sh picks it up on the next push (every 5 min).
"""
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

AGENT_CTX = Path('/home/z/agent-ctx')
CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
ASCII_ART_LIVE = AGENT_CTX / 'ascii-art' / 'live'
OUTPUT = AGENT_CTX / 'status-snapshot.json'

ALL_VERSIONS = [
    'v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
    'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045'
]


def read_file(path, default=''):
    try:
        return Path(path).read_text()
    except:
        return default


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except:
        return default


def read_heartbeat(ver):
    hb_path = CHEAT_DIR / f'parallel-{ver}-heartbeat'
    text = read_file(hb_path).strip()
    if not text:
        return None
    parts = text.split()
    ts = int(parts[0]) if parts else 0
    trial = int(parts[3]) if len(parts) > 3 else 0
    now = int(time.time())
    return {
        'ts': ts,
        'ageSec': now - ts,
        'alive': (now - ts) < 60,
        'trialCount': trial,
    }


def count_threads():
    used = 0
    try:
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                used += len(os.listdir(f'/proc/{pid}/task'))
            except:
                pass
    except:
        pass
    limit = 929
    try:
        limit = int(read_file('/proc/sys/kernel/threads-max').strip())
    except:
        pass
    return {'used': used, 'limit': limit, 'pct': round(used / limit * 100) if limit else 0}


def count_processes(pattern):
    try:
        out = subprocess.run(['ps', '-ef'], capture_output=True, text=True, timeout=5).stdout
        return sum(1 for line in out.split('\n') if pattern in line and 'grep' not in line)
    except:
        return 0


def read_log_tail(path, lines=15):
    text = read_file(path).strip()
    if not text:
        return []
    return text.split('\n')[-lines:]


def read_anomaly_log(max_entries=50):
    path = CHEAT_DIR / 'anomaly-log.jsonl'
    text = read_file(path).strip()
    if not text:
        return []
    entries = []
    for line in text.split('\n'):
        try:
            entries.append(json.loads(line))
        except:
            pass
    return entries[-max_entries:]


def list_ascii_art_live():
    """List all ASCII art pieces in the live folder, sorted newest first."""
    if not ASCII_ART_LIVE.exists():
        return []
    items = []
    for f in ASCII_ART_LIVE.glob('*.txt'):
        try:
            stat = f.stat()
            items.append({
                'filename': f.name,
                'size': stat.st_size,
                'mtime': stat.st_mtime,
                'mtimeIso': datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            })
        except:
            pass
    items.sort(key=lambda x: x['mtime'], reverse=True)
    return items


def main():
    snapshot = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'timestampUnix': int(time.time()),
    }

    # Per-version heartbeats
    heartbeats = {}
    for v in ALL_VERSIONS:
        hb = read_heartbeat(v)
        if hb:
            heartbeats[v] = hb
    snapshot['heartbeats'] = heartbeats

    # Active batch
    snapshot['activeBatch'] = read_file(AGENT_CTX / 'active-batch.txt').strip()
    snapshot['allBatchesCompleteFlag'] = (AGENT_CTX / 'all-batches-complete.flag').exists()

    # Threads / processes
    snapshot['threads'] = count_threads()
    snapshot['processes'] = {
        'chrome': count_processes('chrome'),
        'drivers': count_processes('generic-trials'),
        'watchdog': count_processes('watchdog.py'),
        'manifestUpdater': count_processes('manifest-updater.py'),
        'backupManager': count_processes('backup-manager.py'),
        'anomalyDetector': count_processes('anomaly-detector.py'),
        'telemetryValidator': count_processes('telemetry-field-validator.py'),
        'batchOrchestrator': count_processes('batch-orchestrator.py'),
        'gitBackup': count_processes('git-backup'),
        'asciiArtGenerator': count_processes('ascii-art-generator'),
    }

    # Anomalies
    snapshot['anomalies'] = read_anomaly_log(50)
    retry_counts = read_json(CHEAT_DIR / 'anomaly-retry-counts.json', {})
    snapshot['retryCounts'] = len(retry_counts) if isinstance(retry_counts, dict) else 0

    # Log tails
    snapshot['logs'] = {
        'watchdog': read_log_tail(CHEAT_DIR / 'watchdog.log', 20),
        'batchOrchestrator': read_log_tail(CHEAT_DIR / 'batch-orchestrator.log', 20),
        'anomalyDetector': read_log_tail(CHEAT_DIR / 'anomaly-detector.log', 10),
        'manifestUpdater': read_log_tail(CHEAT_DIR / 'manifest-updater.log', 10),
        'backupManager': read_log_tail(CHEAT_DIR / 'backup-manager.log', 10),
        'telemetryValidator': read_log_tail(CHEAT_DIR / 'telemetry-field-validator.log', 10),
    }
    # Per-version driver logs
    driver_logs = {}
    for v in ALL_VERSIONS:
        tail = read_log_tail(CHEAT_DIR / f'parallel-{v}-master.log', 8)
        if tail:
            driver_logs[v] = tail
    snapshot['driverLogs'] = driver_logs

    # ASCII art live index
    snapshot['asciiArtLive'] = list_ascii_art_live()

    # Last manifest update
    manifest = read_json(AGENT_CTX / 'trial-manifest.json', {})
    snapshot['lastManifestUpdate'] = manifest.get('lastUpdated') if isinstance(manifest, dict) else None

    # Write atomically
    tmp = OUTPUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(snapshot, indent=2))
    tmp.rename(OUTPUT)


if __name__ == '__main__':
    main()
