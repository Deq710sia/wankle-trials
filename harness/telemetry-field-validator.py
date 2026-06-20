#!/usr/bin/env python3
"""
telemetry-field-validator.py — reactive deterministic script that:
  1. Parses bot source files to extract expected telemetry fields per bot type
  2. Writes expected-fields.json (read by anomaly-detector.py)
  3. Scans recent trial JSONL logs to verify fields ARE present
  4. If fields missing in logs → logs warning (anomaly-detector will catch + rerun)

This script is REACTIVE: if someone patches a bot to add new fields,
re-running this script updates the expected-fields.json automatically.
No code changes needed in anomaly-detector.py.

Run:
  - After patching any bot file
  - Periodically (every 5 min via wrapper) to catch bot changes
  - Manually anytime: python3 telemetry-field-validator.py

Does NOT halt any running process. Reads source files, writes JSON.
"""
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
REPO_DIR = Path('/home/z/agent-ctx')
EXPECTED_FIELDS_FILE = CHEAT_DIR / 'expected-telemetry-fields.json'
LOG_PATH = CHEAT_DIR / 'telemetry-field-validator.log'

# Map: level_id → bot type (from generic-trials.sh)
MAP_BOT_MAP = {
    'custom-c2738ec4-135': 'passive',      # Custom Arena
    'custom-c69c5ff7-f4e': 'hunter',        # RK Fight
    'custom-a6b7c90f-813': 'hunter',        # Dungeon
    'custom-5f697a3b-742': 'passive-nofire', # Dodge Training OFF
    # Dodge Training ON uses 'passive' bot — same as CA
}

BOT_FILES = {
    'passive': CHEAT_DIR / 'passive-bot.js',
    'passive-nofire': CHEAT_DIR / 'passive-nofire-bot.js',
    'hunter': CHEAT_DIR / 'hunter-bot-v3.js',
}


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG_PATH, 'a') as f:
        f.write(line + '\n')


def extract_sample_fields(bot_path):
    """Parse bot JS source to find the sample push block and extract field names.
    
    Looks for the pattern: kind: 'sample' ... { field1: ..., field2: ..., ... }
    Returns a set of field names.
    """
    if not bot_path.exists():
        return set()
    
    src = bot_path.read_text()
    
    # Find all blocks that push a sample (kind: 'sample')
    # Pattern: { kind: 'sample', ... field: value, ... }
    # We look for the object literal after "kind: 'sample'"
    fields = set()
    
    # Find all occurrences of "kind: 'sample'" (or "kind: 'sample'" with different quotes)
    pattern = r"kind:\s*['\"]sample['\"]\s*,"
    for match in re.finditer(pattern, src):
        # Get the surrounding object literal (look forward for closing })
        start = match.start()
        # Find the opening { before this match
        brace_start = src.rfind('{', 0, start)
        if brace_start == -1:
            continue
        # Find the closing } after this match
        brace_count = 0
        brace_end = brace_start
        for i in range(brace_start, len(src)):
            if src[i] == '{':
                brace_count += 1
            elif src[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    brace_end = i
                    break
        
        block = src[brace_start:brace_end+1]
        
        # Extract field names from the object literal
        # Pattern: fieldName: value (where fieldName is a valid JS identifier)
        field_pattern = r"^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:"
        for line in block.split('\n'):
            fm = re.match(field_pattern, line.strip())
            if fm:
                fname = fm.group(1)
                if fname not in ('kind',):  # skip 'kind' itself
                    fields.add(fname)
    
    return fields


def validate_recent_logs(expected_fields, max_check=5):
    """Scan recent trial JSONL logs to verify expected fields are present.
    Returns list of (version, trial_file, missing_fields) tuples."""
    issues = []
    
    for v in ['v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
              'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045']:
        log_dir = CHEAT_DIR / f'parallel-{v}-logs'
        if not log_dir.exists():
            continue
        
        # Check the most recent JSONL files
        jsonl_files = sorted(log_dir.glob('*.jsonl'), key=lambda p: p.stat().st_mtime, reverse=True)
        for jf in jsonl_files[:max_check]:
            # Determine bot type from filename (level_id)
            # Filename: v19-custom-c69c5ff7-f4e-t1.jsonl
            parts = jf.stem.split('-')
            if len(parts) < 4:
                continue
            
            # Extract level_id from filename
            # v19-custom-c69c5ff7-f4e-t1 → custom-c69c5ff7-f4e
            level_id_match = re.search(r'custom-[a-f0-9]+-[a-f0-9]+', jf.name)
            if not level_id_match:
                continue
            level_id = level_id_match.group()
            
            # Determine bot type
            # Check aimbot off (noaim in filename)
            is_aimbot_off = 'noaim' in jf.name
            if is_aimbot_off:
                bot_type = 'passive-nofire'
            elif level_id in MAP_BOT_MAP:
                bot_type = MAP_BOT_MAP[level_id]
            else:
                bot_type = 'passive'  # default
            
            # Get expected fields for this bot type
            expected = expected_fields.get(bot_type, set())
            if not expected:
                continue
            
            # Read first sample from JSONL
            try:
                with open(jf) as f:
                    for line in f:
                        e = json.loads(line)
                        if e.get('kind') == 'sample':
                            actual_fields = set(e.keys())
                            missing = expected - actual_fields
                            if missing:
                                issues.append((v, jf.name, bot_type, sorted(missing)))
                            break
            except:
                continue
    
    return issues


def main():
    log('telemetry-field-validator starting')
    
    # Step 1: Extract expected fields from each bot source
    expected_fields = {}
    for bot_type, bot_path in BOT_FILES.items():
        fields = extract_sample_fields(bot_path)
        expected_fields[bot_type] = sorted(fields)
        log(f'  {bot_type}: {len(fields)} expected fields from {bot_path.name}')
        if fields:
            log(f'    fields: {", ".join(sorted(fields)[:10])}{"..." if len(fields) > 10 else ""}')
    
    # Also map: Dodge Training ON uses passive bot
    expected_fields['passive-dt-on'] = expected_fields.get('passive', [])
    
    # Write expected-fields.json
    output = {
        'lastUpdated': datetime.now().isoformat(),
        'botFields': expected_fields,
        'mapBotMap': MAP_BOT_MAP,
        'note': 'Auto-generated by telemetry-field-validator.py. Do not edit manually.',
    }
    EXPECTED_FIELDS_FILE.write_text(json.dumps(output, indent=2))
    log(f'  wrote {EXPECTED_FIELDS_FILE.name}')
    
    # Step 2: Validate recent logs against expected fields
    # Convert to sets for comparison
    expected_sets = {k: set(v) for k, v in expected_fields.items()}
    issues = validate_recent_logs(expected_sets)
    
    if issues:
        log(f'  ⚠️ Found {len(issues)} trials with missing telemetry fields:')
        for v, fname, bot_type, missing in issues[:10]:
            log(f'    {v}/{fname} ({bot_type}): missing {", ".join(missing[:5])}')
        if len(issues) > 10:
            log(f'    ... and {len(issues) - 10} more')
        log(f'  These trials will be flagged by anomaly-detector.py and re-run.')
    else:
        log(f'  ✅ All recent trials have complete telemetry fields.')
    
    log(f'telemetry-field-validator complete')


if __name__ == '__main__':
    main()
