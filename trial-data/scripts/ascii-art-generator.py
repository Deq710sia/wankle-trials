#!/usr/bin/env python3
"""
ascii-art-generator.py — generates a fresh ASCII art piece every cycle
using Pollinations.ai (zero-auth, free, NOT GLM, NOT requiring any API key).

Reads:
  - Existing ascii-art folder for style reference (3-4 representative pieces)
  - Current trial status from local files (status-snapshot.json + manifest)
  - Recent art pieces (to avoid repeating themes)

Writes:
  - /home/z/agent-ctx/ascii-art/live/NNNNN-{timestamp}.txt
  - Each piece is a new themed vignette in the established style

The script runs once per invocation (called by a wrapper every 5 min).
It does NOT loop — the wrapper handles restart/timing.
"""
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

AGENT_CTX = Path('/home/z/agent-ctx')
CHEAT_DIR = Path('/home/z/my-project/scripts/cheat-tests')
REPO_ASCII = Path('/home/z/my-project/wankle-trials/ascii-art')
LIVE_DIR = AGENT_CTX / 'ascii-art' / 'live'
LIVE_DIR.mkdir(parents=True, exist_ok=True)

# Style reference: pick 2-3 representative pieces from the existing folder.
# Send these as few-shot examples so the LLM matches the established style.
STYLE_REFERENCE_FILES = [
    '02-armada-tide-turns.txt',   # mural style with progress bars
    '05-smaller-pieces.txt',      # vignette style (multiple short pieces)
    '06-early-monitoring-tanks.txt'  # tank-themed monitoring pieces
]

# Themes already used (per the README) — instruct the LLM to find NEW ones
USED_THEMES = [
    'dice', 'tanks', 'boats/armada', 'rockets', 'pyramids', 'skyscrapers',
    'waterfalls', 'constellations', 'mountains', 'trains', 'tornado',
    'braille rain', 'bar charts', 'burning joint', 'dice cups', 'dice tower',
    'animal faces', 'linked tanks', 'arrow volley', 'lighthouse',
    'oil rig (DAB)', 'weed mural'
]

# Theme pool for variety (pick one per cycle, rotate)
THEME_POOL = [
    'a forest growing toward the sky',
    'an octopus with trial-counting tentacles',
    'a chessboard mid-game with tanks as pieces',
    'a beehive with each cell a trial',
    'a phone switchboard routing trial calls',
    'a sushi conveyor belt with trial plates',
    'a clockwork mechanism with trials as gears',
    'a stained-glass cathedral window',
    'a slot machine hitting the trial jackpot',
    'a map of an archipelago with islands per version',
    'a board game being played (Catan-style)',
    'a thunderstorm raining trials down',
    'a subway map with each line a version',
    'a coral reef teeming with trial-fish',
    'a printing press stamping out trials',
    'a thermos flask keeping trials warm',
    'a cloud datacenter with racks of trials',
    'a music equalizer with version bars',
    'a rope bridge over a trial chasm',
    'a movie theater marquee showing trial count',
    'a magician pulling trials from a hat',
    'a factory assembly line of trials',
    'a koi pond with rippling trial circles',
    'a telegraph station tapping out trial counts',
    'a vending machine dispensing trials',
    'a tree of life with trial leaves',
    'a chess knight moving through trial squares',
    'a windmill grinding out trials',
    'a lighthouse keeper logging trials',
    'a postman delivering trial results',
    'a meteor shower of trials',
    'a typewriter clacking out trials',
    'a bird migration with trial waypoints',
    'a city grid at night with trial-lit windows',
    'a potter throwing trial vases',
    'a knot garden with trial hedgerows',
    'a compass pointing toward completion',
    'a sundial marking trial time',
    'a piano keyboard with trial notes',
    'a constellation map of trial stars',
]


def log(msg):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


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


def load_style_reference():
    """Read 1-2 existing ASCII art pieces as style reference.
    Keep prompt compact to avoid triggering reasoning mode in the LLM."""
    pieces = []
    # Use only 1 file, trimmed to ~40 lines, to keep prompt small
    for fname in ['05-smaller-pieces.txt']:
        path = REPO_ASCII / fname
        text = read_file(path)
        if text:
            lines = text.split('\n')[:40]
            pieces.append(f'### Style example (from {fname}):\n{chr(10).join(lines)}')
    return '\n\n'.join(pieces)


def load_current_status():
    """Read current trial status to embed in the prompt."""
    snapshot = read_json(AGENT_CTX / 'status-snapshot.json', {}) or {}
    manifest = read_json(AGENT_CTX / 'trial-manifest.json', {}) or {}

    per_version = manifest.get('perVersion', {}) if isinstance(manifest, dict) else {}
    trials_done = manifest.get('trialsCompleted', 0) if isinstance(manifest, dict) else 0
    trials_total = manifest.get('trialsTotal', 1350) if isinstance(manifest, dict) else 1350
    pct = round(trials_done / trials_total * 100, 1) if trials_total else 0

    # Per-version progress lines
    version_lines = []
    for v in ['v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
              'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045']:
        info = per_version.get(v, {})
        completed = info.get('completed', 0) if isinstance(info, dict) else 0
        target = info.get('target', 150) if isinstance(info, dict) else 150
        vpct = round(completed / target * 100) if target else 0
        filled = completed * 20 // target if target else 0
        empty = 20 - filled
        bar = '█' * filled + '░' * empty
        version_lines.append(f'  {v:<18} [{bar}] {completed:>3}/{target} ({vpct}%)')

    # Active batch
    active_batch = read_file(AGENT_CTX / 'active-batch.txt').strip()

    # Threads
    threads = snapshot.get('threads', {})

    # Anomalies
    anomalies = snapshot.get('anomalies', [])
    anomaly_count = len(anomalies)

    # Heartbeats
    heartbeats = snapshot.get('heartbeats', {})
    alive_versions = [v for v, hb in heartbeats.items() if hb.get('alive')]

    # Driver activity (current trial)
    driver_logs = snapshot.get('driverLogs', {})
    current_activities = []
    for v, lines in driver_logs.items():
        for line in reversed(lines):
            m = re.search(r'\[(\d{2}:\d{2}:\d{2})\]\s+(RUN|DONE|SKIP)\s+\S+\s+t(\d+)\s+(\S+)', line)
            if m:
                current_activities.append(f'  {v}: {m.group(2)} t{m.group(3)} {m.group(4)} @ {m.group(1)}')
                break

    # Recent ASCII art pieces (last 3) — tell LLM what was just made so it varies
    recent_pieces = sorted(LIVE_DIR.glob('*.txt'), key=lambda p: p.stat().st_mtime, reverse=True)[:3]
    recent_themes = []
    for p in recent_pieces:
        # Extract theme from first comment line
        first_lines = p.read_text().split('\n')[:5]
        for line in first_lines:
            m = re.match(r'#\s*---\s*(.+?)\s*---', line)
            if m:
                recent_themes.append(m.group(1))
                break

    return f"""CURRENT STATUS (as of {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}):
- Total trials: {trials_done}/{trials_total} ({pct}%)
- Active batch: {active_batch}
- Drivers alive: {', '.join(alive_versions) if alive_versions else 'none'}
- Threads: {threads.get('used', '?')}/{threads.get('limit', '?')} ({threads.get('pct', '?')}%)
- Anomalies detected: {anomaly_count}
- Recent themes used (DO NOT REPEAT): {', '.join(recent_themes) if recent_themes else 'none yet'}

PER-VERSION PROGRESS:
{chr(10).join(version_lines)}

CURRENT DRIVER ACTIVITY:
{chr(10).join(current_activities) if current_activities else '  (no driver activity)'}
"""


def pick_theme():
    """Pick a theme for this cycle. Avoid recent themes."""
    # Check what themes were recently used
    recent_pieces = sorted(LIVE_DIR.glob('*.txt'), key=lambda p: p.stat().st_mtime, reverse=True)[:10]
    recent_themes = set()
    for p in recent_pieces:
        text = p.read_text()
        for theme in THEME_POOL:
            # Match theme keywords in the file
            keywords = theme.split()
            if all(kw.lower() in text.lower() for kw in keywords[:2]):
                recent_themes.add(theme)
                break
    available = [t for t in THEME_POOL if t not in recent_themes]
    if not available:
        available = THEME_POOL
    return random.choice(available)


def build_prompt(theme, status_text, style_reference):
    """Build the full prompt for the LLM."""
    is_milestone = False
    milestone_type = None
    # Check if we're at a milestone (675, 710, 900, 1350)
    manifest = read_json(AGENT_CTX / 'trial-manifest.json', {}) or {}
    trials_done = manifest.get('trialsCompleted', 0) if isinstance(manifest, dict) else 0
    for target, name in [(675, 'HALFWAY'), (710, 'DAB_OIL_RIG'), (900, 'BASELINES_CONTENDERS_DONE'), (1350, 'FINAL_ARMADA')]:
        # Check if we just crossed this milestone (within last 30 trials)
        recent_pieces = sorted(LIVE_DIR.glob('*.txt'), key=lambda p: p.stat().st_mtime, reverse=True)
        already_done = any(name in p.read_text()[:500] for p in recent_pieces[:5])
        if trials_done >= target and not already_done:
            is_milestone = True
            milestone_type = name
            break

    if is_milestone:
        size_instruction = "BIG MURAL (40-60 lines)"
        if milestone_type == 'DAB_OIL_RIG':
            theme = 'an oil rig (DAB theme — user specifically requested this mural at trial 710)'
        elif milestone_type == 'HALFWAY':
            theme = 'halfway mark — a mountain peak crested, the descent visible ahead'
        elif milestone_type == 'BASELINES_CONTENDERS_DONE':
            theme = 'a finish line crossed by baseline and contender runners, A/B variants waiting their turn'
        elif milestone_type == 'FINAL_ARMADA':
            theme = 'the final armada reaching the shore after a long voyage — celebration'
    else:
        size_instruction = "small between-check vignette (10-20 lines)"

    prompt = f"""You are the resident ASCII artist for a long-running trial suite monitoring dashboard. The project: an aimbot/dodge cheat for Wankle3D (wanshot.lol), a 3D multiplayer tank game. We are running 1350 trials across 9 cheat versions × 5 maps, monitoring them continuously and creating ASCII art between checks.

ESTABLISHED STYLE (study these examples carefully — your output MUST match this style):

{style_reference}

STYLE RULES:
- Use ONLY standard ASCII chars + box drawing chars (█░▓▒║╗╚╔│┌┐└┘├┤┬┴┼─━┃┏┓┗┛) + occasional Unicode symbols (🌊🛶☁ etc.)
- ALWAYS include a progress bar for at least the running versions (format: `[██████░░░░░░░░░] N/150 (XX%)`)
- ALWAYS show process/thread status line (e.g. `procs: 18 | threads: 683/929 (74%) | chrome: 42`)
- BE CREATIVE — find new metaphors every time, do NOT repeat themes already used
- AVOID these themes (already used): {', '.join(USED_THEMES)}
- Output ONLY the ASCII art, no markdown code fences, no explanation
- Start with a comment line: `# --- <THEME NAME> (one-line context) ---`
- Include the current trial count somewhere visible

THEME FOR THIS PIECE: {theme}
SIZE: {size_instruction}

{status_text}

Now generate ONE new ASCII art piece in the established style. Output ONLY the art, starting with the comment line. No markdown fences, no explanation."""

    return prompt, is_milestone, milestone_type


def call_pollinations(prompt, max_retries=2):
    """Call Pollinations.ai (zero-auth, free, NOT GLM).
    Uses 'openai' (non-reasoning) model — reasoning models return JSON
    with reasoning traces instead of plain text."""
    payload = json.dumps({
        'messages': [
            {'role': 'user', 'content': prompt}
        ],
        'model': 'openai',  # NOT openai-fast (that triggers reasoning mode)
    }).encode()

    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(
                'https://text.pollinations.ai/',
                data=payload,
                headers={
                    'Content-Type': 'application/json',
                    'Referer': 'https://pollinations.ai',
                    'User-Agent': 'curl/8.0',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read().decode('utf-8')
        except Exception as e:
            log(f'  attempt {attempt+1} failed: {e}')
            if attempt < max_retries:
                time.sleep(10)
            else:
                return None


def clean_output(text):
    """Strip markdown code fences if present, trim whitespace.
    Returns None if the response looks like a reasoning trace (JSON)."""
    if not text:
        return None
    text = text.strip()
    # If response starts with { it's likely a reasoning-trace JSON, not art
    if text.startswith('{') and '"reasoning"' in text[:200]:
        log('  WARNING: response looks like reasoning trace JSON — discarding')
        return None
    # Remove markdown code fences
    text = re.sub(r'^```\w*\n?', '', text)
    text = re.sub(r'\n?```\s*$', '', text)
    # Trim
    text = text.strip()
    return text


def save_piece(content, is_milestone, milestone_type):
    """Save the generated piece to the live folder."""
    # Find next available number
    existing = sorted(LIVE_DIR.glob('*.txt'))
    next_num = len(existing) + 1
    ts = int(time.time())
    ts_human = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    if is_milestone:
        fname = f'{next_num:05d}-MILESTONE-{milestone_type}-{ts_human}.txt'
    else:
        fname = f'{next_num:05d}-{ts_human}.txt'
    path = LIVE_DIR / fname
    path.write_text(content)
    log(f'  saved: {path.name} ({len(content)} bytes)')
    return path


def main():
    log('ascii-art-generator starting cycle')
    style_ref = load_style_reference()
    if not style_ref:
        log('  ERROR: no style reference loaded — aborting')
        return 1
    log(f'  loaded style reference ({len(style_ref)} chars)')

    status = load_current_status()
    log(f'  loaded status ({len(status)} chars)')

    theme = pick_theme()
    log(f'  picked theme: {theme}')

    prompt, is_milestone, milestone_type = build_prompt(theme, status, style_ref)
    log(f'  built prompt ({len(prompt)} chars){" [MILESTONE: " + milestone_type + "]" if is_milestone else ""}')

    output = call_pollinations(prompt)
    if not output:
        log('  ERROR: LLM call failed — skipping this cycle')
        return 1
    log(f'  LLM responded ({len(output)} chars)')

    cleaned = clean_output(output)
    if not cleaned or len(cleaned) < 50:
        log(f'  ERROR: output too short after cleaning ({len(cleaned) if cleaned else 0} chars) — skipping')
        return 1

    saved = save_piece(cleaned, is_milestone, milestone_type)
    log(f'  cycle complete: {saved.name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
