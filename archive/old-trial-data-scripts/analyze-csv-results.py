#!/usr/bin/env python3
"""
analyze-csv-results.py — CSV-based analysis (all 60 trials).

Uses survival-results.csv as the source of truth for kills/deaths/wave/survival
(reliable, my harness fix reads from bt.totalKills). Supplements with JSONL
data where available (Dungeon trials only — earlier JSONL files were overwritten
by a harness bug that has since been fixed).

Output: /home/z/my-project/download/csv-analysis.txt
"""
import csv
import json
import os
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean, median, stdev

CSV_PATH = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT = Path('/home/z/my-project/download/csv-analysis.txt')

MAPS = {
    'custom-c2738ec4-135': 'Custom Arena',
    'custom-c69c5ff7-f4e': 'RK Fight',
    'custom-a6b7c90f-813': 'Dungeon',
}
VERSIONS = ['v19', 'v21.7', 'v22.0', 'v22.2']

def load_csv():
    rows = []
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['version'] == 'version': continue
            row['trial'] = int(row['trial'])
            row['kills'] = int(row['kills'])
            row['deaths'] = int(row['deaths'])
            row['wave'] = int(row['wave'])
            row['alive'] = int(row['alive'])
            row['durationSec'] = int(row['durationSec'])
            row['avgFps'] = float(row['avgFps']) if row['avgFps'] else 0
            row['maxEnemies'] = int(row['maxEnemies'])
            row['corrBuckets'] = int(row['corrBuckets']) if row.get('corrBuckets') else 0
            row['map_name'] = MAPS.get(row['levelId'], row['levelId'])
            rows.append(row)
    return rows

def load_jsonl(version, level_id, trial_num):
    """Load JSONL for a specific trial. Returns (samples, events) or (None, None) if missing."""
    # Try new naming first (with level_id), then old naming (without)
    for name in [f'{version}-{level_id}-t{trial_num}.jsonl', f'{version}-t{trial_num}.jsonl']:
        path = JSONL_DIR / name
        if path.exists():
            samples, events = [], []
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line: continue
                    try:
                        e = json.loads(line)
                        if isinstance(e, str): e = json.loads(e)
                        if not isinstance(e, dict): continue
                        if e.get('kind') == 'sample': samples.append(e)
                        elif e.get('kind') == 'event': events.append(e)
                    except: pass
            return samples, events
    return None, None

def main():
    rows = load_csv()
    out = []
    out.append('=' * 100)
    out.append('  WANKLE3D CHEAT v22.2 TRIAL ANALYSIS — CSV-BASED (all 60 trials)')
    out.append('=' * 100)
    out.append('')
    out.append(f'  Total trials: {len(rows)}')
    out.append(f'  Versions: {VERSIONS}')
    out.append(f'  Maps: {list(MAPS.values())}')
    out.append('')
    out.append('  NOTE: CSV deaths column may overcount (bot tracker counts match-end resets')
    out.append('  as deaths in survival mode). JSONL death-event count is more accurate but')
    out.append('  only available for Dungeon trials (20 of 60) due to a harness filename bug')
    out.append('  that has since been fixed.')
    out.append('')

    # Group by (version, map)
    by_combo = defaultdict(list)
    for r in rows:
        by_combo[(r['version'], r['map_name'])].append(r)

    # CROSS-VERSION SUMMARY (all maps combined)
    out.append('=' * 100)
    out.append('  CROSS-VERSION SUMMARY (all 3 maps, 15 trials each)')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"N":>3} {"AvgK":>6} {"AvgD":>6} {"AvgW":>6} {"Surv%":>6} {"AvgDur":>7} {"AvgFPS":>7} {"CorrBkt":>8}')
    out.append(f'  {"-"*70}')
    by_version = defaultdict(list)
    for r in rows:
        by_version[r['version']].append(r)
    for ver in VERSIONS:
        trials = by_version[ver]
        n = len(trials)
        avg_k = mean(t['kills'] for t in trials)
        avg_d = mean(t['deaths'] for t in trials)
        avg_w = mean(t['wave'] for t in trials)
        surv = sum(1 for t in trials if t['alive']) / n * 100
        avg_dur = mean(t['durationSec'] for t in trials)
        avg_fps = mean(t['avgFps'] for t in trials)
        avg_corr = mean(t['corrBuckets'] for t in trials)
        out.append(f'  {ver:<8} {n:>3} {avg_k:>6.1f} {avg_d:>6.1f} {avg_w:>6.1f} {surv:>5.0f}% {avg_dur:>6.0f}s {avg_fps:>7.1f} {avg_corr:>8.1f}')

    # PER-MAP BREAKDOWN
    out.append('')
    out.append('=' * 100)
    out.append('  PER-MAP CROSS-VERSION COMPARISON')
    out.append('=' * 100)
    for level_id, map_name in MAPS.items():
        out.append('')
        out.append(f'  --- {map_name} ({level_id}) ---')
        out.append(f'  {"Version":<8} {"N":>3} {"AvgK":>6} {"AvgD":>6} {"AvgW":>6} {"Surv%":>6} {"AvgDur":>7} {"BestK":>6} {"WorstK":>7} {"AvgCorr":>8}')
        out.append(f'  {"-"*80}')
        for ver in VERSIONS:
            trials = by_combo.get((ver, map_name), [])
            if not trials: continue
            n = len(trials)
            avg_k = mean(t['kills'] for t in trials)
            avg_d = mean(t['deaths'] for t in trials)
            avg_w = mean(t['wave'] for t in trials)
            surv = sum(1 for t in trials if t['alive']) / n * 100
            avg_dur = mean(t['durationSec'] for t in trials)
            best_k = max(t['kills'] for t in trials)
            worst_k = min(t['kills'] for t in trials)
            avg_corr = mean(t['corrBuckets'] for t in trials)
            out.append(f'  {ver:<8} {n:>3} {avg_k:>6.1f} {avg_d:>6.1f} {avg_w:>6.1f} {surv:>5.0f}% {avg_dur:>6.0f}s {best_k:>6} {worst_k:>7} {avg_corr:>8.1f}')

    # PER-TRIAL DETAIL
    out.append('')
    out.append('=' * 100)
    out.append('  PER-TRIAL DETAIL (all 60 trials)')
    out.append('=' * 100)
    for level_id, map_name in MAPS.items():
        out.append('')
        out.append(f'  --- {map_name} ---')
        for ver in VERSIONS:
            trials = sorted(by_combo.get((ver, map_name), []), key=lambda x: x['trial'])
            for t in trials:
                out.append(f'    {ver:<8} t{t["trial"]}: K={t["kills"]:>3} D={t["deaths"]} W={t["wave"]} alive={t["alive"]} dur={t["durationSec"]}s fps={t["avgFps"]:.1f} maxE={t["maxEnemies"]} corr={t["corrBuckets"]}')

    # JSONL-BASED DEEP ANALYSIS (Dungeon only — only map with intact JSONL)
    out.append('')
    out.append('=' * 100)
    out.append('  JSONL DEEP ANALYSIS (Dungeon only — 20 trials with intact per-second telemetry)')
    out.append('=' * 100)
    out.append('  Note: JSONL files for Custom Arena and RK Fight were overwritten by a harness')
    out.append('  filename bug (missing level_id in filename). Bug is fixed for future runs.')
    out.append('')
    out.append(f'  {"Version":<8} {"N":>3} {"AvgDodge%":>10} {"AvgAimErr":>10} {"AvgShells":>10} {"AvgKills":>9} {"Shells/K":>9} {"EnemyShellDeaths":>18} {"SelfShellDeaths":>17}')
    out.append(f'  {"-"*100}')
    for ver in VERSIONS:
        # Only Dungeon JSONLs survived
        trials_with_jsonl = []
        for t in by_combo.get((ver, 'Dungeon'), []):
            samples, events = load_jsonl(ver, 'custom-a6b7c90f-813', t['trial'])
            if samples:
                trials_with_jsonl.append((t, samples, events))
        if not trials_with_jsonl: continue
        n = len(trials_with_jsonl)
        dodge_pcts = []
        aim_errs = []
        shells_list = []
        kills_list = []
        death_causes = Counter()
        for t, samples, events in trials_with_jsonl:
            dodge_pcts.append(sum(1 for s in samples if s.get('dodgeActive', False)) / len(samples) * 100)
            aim_errs.append(mean([s.get('aimErr', 0) for s in samples if s.get('aimErr') is not None]) if any(s.get('aimErr') is not None for s in samples) else 0)
            shells_list.append(t['kills'] and samples[-1].get('shellsFired', 0))
            kills_list.append(t['kills'])
            for e in events:
                if e.get('sub') == 'death':
                    death_causes[e.get('cause', 'unknown')] += 1
        avg_dodge = mean(dodge_pcts)
        avg_aim = mean(aim_errs)
        avg_shells = mean(shells_list)
        avg_kills = mean(kills_list)
        spk = avg_shells / avg_kills if avg_kills > 0 else 0
        out.append(f'  {ver:<8} {n:>3} {avg_dodge:>9.1f}% {avg_aim:>10.3f} {avg_shells:>10.0f} {avg_kills:>9.1f} {spk:>9.2f} {death_causes.get("enemy_shell",0):>18} {death_causes.get("self_shell",0):>17}')

    # SHELL EFFICIENCY FROM CSV (corrBuckets is a proxy for aim correction activity)
    out.append('')
    out.append('=' * 100)
    out.append('  AIM CORRECTION ACTIVITY (corrBuckets — only v22.2 has this, higher = more learning)')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"Map":<15} {"Avg corrBuckets":>16} {"Max":>5} {"Min":>5}')
    out.append(f'  {"-"*55}')
    for ver in VERSIONS:
        for level_id, map_name in MAPS.items():
            trials = by_combo.get((ver, map_name), [])
            if not trials: continue
            avg_corr = mean(t['corrBuckets'] for t in trials)
            max_corr = max(t['corrBuckets'] for t in trials)
            min_corr = min(t['corrBuckets'] for t in trials)
            out.append(f'  {ver:<8} {map_name:<15} {avg_corr:>16.1f} {max_corr:>5} {min_corr:>5}')

    # KEY FINDINGS
    out.append('')
    out.append('=' * 100)
    out.append('  KEY FINDINGS')
    out.append('=' * 100)
    out.append('')
    # Compute per-version per-map averages for findings
    findings = []
    for ver in VERSIONS:
        for level_id, map_name in MAPS.items():
            trials = by_combo.get((ver, map_name), [])
            if not trials: continue
            avg_k = mean(t['kills'] for t in trials)
            findings.append((ver, map_name, avg_k, len(trials)))
    # Best version per map
    out.append('  Best version per map (by avg kills):')
    for level_id, map_name in MAPS.items():
        map_trials = [(f[0], f[2]) for f in findings if f[1] == map_name]
        map_trials.sort(key=lambda x: -x[1])
        winner = map_trials[0]
        out.append(f'    {map_name:<15}: {winner[0]:<8} ({winner[1]:.1f} avg kills)  |  runner-up: {map_trials[1][0]} ({map_trials[1][1]:.1f})')
    out.append('')
    out.append('  Overall best version (all maps combined, by avg kills):')
    overall = defaultdict(list)
    for ver, map_name, avg_k, n in findings:
        overall[ver].append((map_name, avg_k, n))
    overall_avg = []
    for ver in VERSIONS:
        total_kills = sum(avg_k * n for map_name, avg_k, n in overall[ver])
        total_n = sum(n for map_name, avg_k, n in overall[ver])
        overall_avg.append((ver, total_kills / total_n if total_n > 0 else 0))
    overall_avg.sort(key=lambda x: -x[1])
    for i, (ver, avg) in enumerate(overall_avg):
        medal = ['🥇', '🥈', '🥉', ''][i] if i < 4 else ''
        out.append(f'    {medal} {ver:<8} {avg:.2f} avg kills/trial')
    out.append('')
    out.append('  Aim correction (v22.2 only):')
    v222_trials = [t for t in rows if t['version'] == 'v22.2']
    v222_with_corr = [t for t in v222_trials if t['corrBuckets'] > 0]
    out.append(f'    {len(v222_with_corr)}/{len(v222_trials)} v22.2 trials had non-zero corrBuckets (aim correction table populated)')
    out.append(f'    Other versions: 0 corrBuckets (no aim correction feature)')
    out.append('')
    out.append('  v22.2 vs v22.0 head-to-head (v22.2 = v22.0 + fixed aim correction + shot tracker):')
    for level_id, map_name in MAPS.items():
        v222_k = mean(t['kills'] for t in by_combo.get(('v22.2', map_name), []))
        v220_k = mean(t['kills'] for t in by_combo.get(('v22.0', map_name), []))
        diff = v222_k - v220_k
        winner = 'v22.2 wins' if diff > 0 else 'v22.0 wins'
        out.append(f'    {map_name:<15}: v22.2={v222_k:.1f}  v22.0={v220_k:.1f}  diff={diff:+.1f}  ({winner})')

    out.append('')
    out.append('=' * 100)
    out.append('  END OF ANALYSIS')
    out.append('=' * 100)

    text = '\n'.join(out)
    print(text)
    with open(OUTPUT, 'w') as f:
        f.write(text)
    print(f'\n  Saved to: {OUTPUT}')

if __name__ == '__main__':
    main()
