#!/usr/bin/env python3
"""
analyze-v22.3-deep.py — Deep analysis for v22.3 cold-spot dodge system.

Surfaces ALL telemetry fields including the new v22.3 cold-spot data:
  - dodgeActive %, dodgeUrgency avg/max
  - coldSpotReactive: how often the 32-point scan found a safe direction + avg score
  - coldSpotStrategic: how often the 9x9 grid found a safe cell + avg score
  - guardViolated: how often the dot-product guard kicked in (toward-then-away prevention)
  - predictedShells: avg predicted shells per sample (bot anticipating enemy fire)
  - realShells: avg real incoming shells per sample
  - 2+ shell scenarios: % of samples with 2+ incoming (cold-spot activation condition)
  - Death analysis with full dodge state at moment of death
  - "Bug deaths" = deaths where dodgeActive=True + cause=enemy_shell (cold-spot tried but failed)
  - "Clump deaths" = deaths with 3+ incoming shells (potentially undodgeable)

Output: /home/z/my-project/download/v22.3-deep-analysis.txt
"""
import csv
import json
import os
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean, median

CSV_PATH = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT = Path('/home/z/my-project/download/v22.3-deep-analysis.txt')

MAPS = [
    ('custom-c2738ec4-135', 'Custom Arena'),
    ('custom-c69c5ff7-f4e', 'RK Fight'),
    ('custom-a6b7c90f-813', 'Dungeon'),
    ('custom-5f697a3b-742', 'Dodge Training (aimbot OFF)'),
    ('custom-5f697a3b-742', 'Dodge Training (aimbot ON)'),
]
VERSIONS = ['v22.5']

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
            row['avgFps'] = float(row['avgFps']) if row.get('avgFps') else 0
            row['maxEnemies'] = int(row['maxEnemies'])
            row['corrBuckets'] = int(row['corrBuckets']) if row.get('corrBuckets') else 0
            row['aimbotOff'] = row.get('aimbotOff', '0')
            row['mode'] = row.get('mode', 'survival')
            row['map_name'] = next((m[1] for m in MAPS if m[0] == row['levelId']), row['levelId'])
            rows.append(row)
    return rows

def load_jsonl(version, level_id, trial_num):
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

def analyze_trial_deep(row, samples, events):
    """Deep analysis of a single trial using JSONL telemetry."""
    if not samples:
        return None
    
    result = {
        'version': row['version'],
        'trial': row['trial'],
        'map_name': row['map_name'],
        'mode': row['mode'],
        'aimbot_off': row['aimbotOff'] == '1',
        'csv_kills': row['kills'],
        'csv_deaths': row['deaths'],
        'csv_wave': row['wave'],
        'csv_alive': row['alive'],
        'csv_duration': row['durationSec'],
        'csv_fps': row['avgFps'],
        'max_enemies': row['maxEnemies'],
        'corr_buckets': row['corrBuckets'],
        'sample_count': len(samples),
    }
    
    # JSONL ground truth (last sample)
    last = samples[-1]
    result['jsonl_kills'] = last.get('kills', 0)
    result['jsonl_deaths'] = last.get('deaths', 0)
    result['jsonl_wave'] = last.get('wave', 0)
    result['jsonl_alive_duration_s'] = last.get('tRel', 0) / 1000.0
    
    # === DODGE TELEMETRY (the deep stuff) ===
    dodge_active = [s for s in samples if s.get('dodgeActive')]
    result['dodge_active_pct'] = len(dodge_active) / len(samples) * 100 if samples else 0
    result['dodge_urgency_avg'] = mean(s.get('dodgeUrgency', 0) for s in samples) if samples else 0
    result['dodge_urgency_max'] = max((s.get('dodgeUrgency', 0) for s in samples), default=0)
    
    # Cold-spot specific (v22.3 NEW)
    cs_reactive = [s for s in samples if s.get('coldSpotReactive')]
    cs_strategic = [s for s in samples if s.get('coldSpotStrategic')]
    result['coldspot_reactive_pct'] = len(cs_reactive) / len(samples) * 100 if samples else 0
    result['coldspot_strategic_pct'] = len(cs_strategic) / len(samples) * 100 if samples else 0
    
    # Average cold-spot scores (lower = safer spot found)
    reactive_scores = [s['coldSpotReactive']['score'] for s in cs_reactive if isinstance(s.get('coldSpotReactive'), dict)]
    strategic_scores = [s['coldSpotStrategic']['score'] for s in cs_strategic if isinstance(s.get('coldSpotStrategic'), dict)]
    result['coldspot_reactive_avg_score'] = mean(reactive_scores) if reactive_scores else 0
    result['coldspot_strategic_avg_score'] = mean(strategic_scores) if strategic_scores else 0
    
    # Guard violations (toward-then-away prevention)
    guard_violated = [s for s in samples if s.get('guardViolated')]
    result['guard_violated_pct'] = len(guard_violated) / len(samples) * 100 if samples else 0
    
    # Predicted vs real shells
    result['predicted_shells_total'] = sum(s.get('predictedShells', 0) or 0 for s in samples)
    result['real_shells_total'] = sum(s.get('realShells', 0) or 0 for s in samples)
    result['predicted_shells_avg'] = result['predicted_shells_total'] / len(samples) if samples else 0
    result['real_shells_avg'] = result['real_shells_total'] / len(samples) if samples else 0
    
    # Multi-shell scenarios (cold-spot activation condition: 2+ incoming)
    multi_shell = [s for s in samples if (s.get('incomingShells', 0) or 0) >= 2]
    result['multi_shell_pct'] = len(multi_shell) / len(samples) * 100 if samples else 0
    result['max_incoming_shells'] = max((s.get('incomingShells', 0) or 0 for s in samples), default=0)
    
    # Aim error
    aim_errs = [s.get('aimErr') for s in samples if s.get('aimErr') is not None]
    result['aim_err_avg'] = mean(aim_errs) if aim_errs else 0
    
    # Shells fired (efficiency)
    shells_fired = last.get('shellsFired', 0)
    kills = last.get('kills', 0)
    result['shells_fired'] = shells_fired
    result['shells_per_kill'] = shells_fired / kills if kills > 0 else None
    
    # === DEATH ANALYSIS ===
    death_events = [e for e in events if e.get('sub') == 'death']
    result['death_count'] = len(death_events)
    result['death_details'] = []
    result['cause_counts'] = Counter()
    
    for d in death_events:
        detail = {
            'time_s': round(d.get('tRel', 0) / 1000.0, 1),
            'cause': d.get('cause', 'unknown'),
            'dodgeActive': d.get('dodgeActive', False),
            'dodgeUrgency': d.get('dodgeUrgency', 0),
            'interceptActive': d.get('interceptActive', False),
            'playerSpeed': d.get('playerSpeed', 0),
            'enemies': d.get('enemies', 0),
            'incomingShells': d.get('incomingShells', 0),
            'wave': d.get('wave', 0),
            'kills': d.get('kills', 0),
        }
        result['death_details'].append(detail)
        result['cause_counts'][detail['cause']] += 1
    
    # Bug deaths: dodge was active but enemy shell still killed (cold-spot tried but failed)
    result['bug_deaths'] = sum(1 for d in result['death_details'] if d['dodgeActive'] and d['cause'] == 'enemy_shell')
    # Clump deaths: 3+ incoming shells at death (potentially undodgeable)
    result['clump_deaths'] = sum(1 for d in result['death_details'] if d['incomingShells'] >= 3)
    # Self-shell deaths (ricochet into own shell)
    result['self_shell_deaths'] = result['cause_counts'].get('self_shell', 0)
    
    return result

def main():
    rows = load_csv()
    out = []
    out.append('=' * 110)
    out.append('  WANKLE3D CHEAT v22.3 DEEP ANALYSIS — COLD-SPOT DODGE TELEMETRY')
    out.append('=' * 110)
    out.append('')
    out.append(f'  Trials in CSV: {len(rows)}')
    out.append(f'  Versions: {sorted(set(r["version"] for r in rows))}')
    out.append('')
    
    # Load + analyze all trials with JSONL
    all_analyses = []
    for row in rows:
        samples, events = load_jsonl(row['version'], row['levelId'], row['trial'])
        if samples:
            analysis = analyze_trial_deep(row, samples, events)
            if analysis:
                all_analyses.append(analysis)
    
    out.append(f'  Trials with JSONL telemetry: {len(all_analyses)}')
    out.append('')
    
    # Group by map
    by_map = defaultdict(list)
    for a in all_analyses:
        by_map[a['map_name']].append(a)
    
    # === PER-MAP DEEP SUMMARY ===
    out.append('=' * 110)
    out.append('  PER-MAP DEEP DODGE TELEMETRY (averages across 5 trials per map)')
    out.append('=' * 110)
    out.append('')
    out.append(f'  {"Map":<16} {"Mode":<10} {"Aim":<4} {"K":>4} {"D":>3} {"W":>3} {"Dur":>5} {"Dodge%":>7} {"UrgAvg":>7} {"CSreact%":>9} {"CSstrat%":>9} {"Guard%":>7} {"PredSh":>7} {"RealSh":>7} {"2+sh%":>6} {"BugD":>5} {"ClumpD":>7}')
    out.append(f'  {"-"*140}')
    
    for level_id, map_name in MAPS:
        trials = by_map.get(map_name, [])
        if not trials: continue
        n = len(trials)
        avg_k = mean(a['jsonl_kills'] for a in trials)
        avg_d = mean(a['death_count'] for a in trials)
        avg_w = mean(a['jsonl_wave'] for a in trials)
        avg_dur = mean(a['jsonl_alive_duration_s'] for a in trials)
        avg_dodge = mean(a['dodge_active_pct'] for a in trials)
        avg_urg = mean(a['dodge_urgency_avg'] for a in trials)
        avg_csr = mean(a['coldspot_reactive_pct'] for a in trials)
        avg_css = mean(a['coldspot_strategic_pct'] for a in trials)
        avg_guard = mean(a['guard_violated_pct'] for a in trials)
        avg_pred = mean(a['predicted_shells_avg'] for a in trials)
        avg_real = mean(a['real_shells_avg'] for a in trials)
        avg_multi = mean(a['multi_shell_pct'] for a in trials)
        total_bug = sum(a['bug_deaths'] for a in trials)
        total_clump = sum(a['clump_deaths'] for a in trials)
        mode = trials[0]['mode']
        aim = 'OFF' if trials[0]['aimbot_off'] else 'ON'
        out.append(f'  {map_name:<16} {mode:<10} {aim:<4} {avg_k:>4.1f} {avg_d:>3.1f} {avg_w:>3.1f} {avg_dur:>4.0f}s {avg_dodge:>6.1f}% {avg_urg:>7.3f} {avg_csr:>8.1f}% {avg_css:>8.1f}% {avg_guard:>6.1f}% {avg_pred:>7.1f} {avg_real:>7.1f} {avg_multi:>5.1f}% {total_bug:>5} {total_clump:>7}')
    
    # === DODGE EFFECTIVENESS ANALYSIS ===
    out.append('')
    out.append('=' * 110)
    out.append('  DODGE EFFECTIVENESS — does cold-spot activation correlate with survival?')
    out.append('=' * 110)
    out.append('')
    out.append(f'  {"Map":<16} {"DodgeActive%":>13} {"ColdSpotReact%":>15} {"GuardViolated%":>15} {"2+ShellScenarios%":>19} {"Survival%":>10}')
    out.append(f'  {"-"*90}')
    for level_id, map_name in MAPS:
        trials = by_map.get(map_name, [])
        if not trials: continue
        avg_dodge = mean(a['dodge_active_pct'] for a in trials)
        avg_csr = mean(a['coldspot_reactive_pct'] for a in trials)
        avg_guard = mean(a['guard_violated_pct'] for a in trials)
        avg_multi = mean(a['multi_shell_pct'] for a in trials)
        surv_pct = sum(1 for a in trials if a['csv_alive']) / len(trials) * 100
        out.append(f'  {map_name:<16} {avg_dodge:>12.1f}% {avg_csr:>14.1f}% {avg_guard:>14.1f}% {avg_multi:>18.1f}% {surv_pct:>9.0f}%')
    
    # === DEATH CAUSE BREAKDOWN ===
    out.append('')
    out.append('=' * 110)
    out.append('  DEATH CAUSE BREAKDOWN (all trials per map)')
    out.append('=' * 110)
    out.append('')
    out.append(f'  {"Map":<16} {"enemy_shell":>12} {"self_shell":>11} {"mine":>6} {"unknown":>8} {"TOTAL":>6} {"BugDeaths":>10} {"ClumpDeaths":>12}')
    out.append(f'  {"-"*90}')
    for level_id, map_name in MAPS:
        trials = by_map.get(map_name, [])
        if not trials: continue
        total_causes = Counter()
        total_bug = 0
        total_clump = 0
        for a in trials:
            total_causes.update(a['cause_counts'])
            total_bug += a['bug_deaths']
            total_clump += a['clump_deaths']
        total = sum(total_causes.values())
        out.append(f'  {map_name:<16} {total_causes.get("enemy_shell",0):>12} {total_causes.get("self_shell",0):>11} {total_causes.get("mine",0):>6} {total_causes.get("unknown",0):>8} {total:>6} {total_bug:>10} {total_clump:>12}')
    
    out.append('')
    out.append('  Legend:')
    out.append('    BugDeaths   = deaths where dodgeActive=True + cause=enemy_shell (cold-spot tried but failed)')
    out.append('    ClumpDeaths = deaths with 3+ incoming shells (potentially undodgeable clumps)')
    
    # === PER-TRIAL DETAIL ===
    out.append('')
    out.append('=' * 110)
    out.append('  PER-TRIAL DETAIL (every trial with full dodge telemetry)')
    out.append('=' * 110)
    for level_id, map_name in MAPS:
        trials = by_map.get(map_name, [])
        if not trials: continue
        out.append('')
        out.append(f'  --- {map_name} ---')
        for a in sorted(trials, key=lambda x: x['trial']):
            aim = 'OFF' if a['aimbot_off'] else 'ON'
            out.append(f'  t{a["trial"]}: K={a["jsonl_kills"]} D={a["death_count"]} W={a["jsonl_wave"]} dur={a["jsonl_alive_duration_s"]:.0f}s aim={aim}')
            out.append(f'    dodge: active={a["dodge_active_pct"]:.1f}% urgAvg={a["dodge_urgency_avg"]:.3f} urgMax={a["dodge_urgency_max"]:.3f}')
            out.append(f'    coldspot: reactive={a["coldspot_reactive_pct"]:.1f}% (avgScore={a["coldspot_reactive_avg_score"]:.2f}) strategic={a["coldspot_strategic_pct"]:.1f}% (avgScore={a["coldspot_strategic_avg_score"]:.2f})')
            out.append(f'    guard: violated={a["guard_violated_pct"]:.1f}% (toward-then-away prevented)')
            out.append(f'    shells: predicted={a["predicted_shells_avg"]:.1f}/samp real={a["real_shells_avg"]:.1f}/samp maxIncoming={a["max_incoming_shells"]} multiShell%={a["multi_shell_pct"]:.1f}')
            out.append(f'    aim: errAvg={a["aim_err_avg"]:.3f}rad shellsFired={a["shells_fired"]} shellsPerKill={a["shells_per_kill"]}')
            out.append(f'    corrBuckets={a["corr_buckets"]} maxEnemies={a["max_enemies"]} fps={a["csv_fps"]:.1f}')
            if a['death_details']:
                out.append(f'    deaths ({a["death_count"]}):')
                for d in a['death_details']:
                    bug_flag = ' *** BUG' if (d['dodgeActive'] and d['cause'] == 'enemy_shell') else ''
                    clump_flag = ' *** CLUMP' if d['incomingShells'] >= 3 else ''
                    out.append(f'      t={d["time_s"]}s cause={d["cause"]} dodge={d["dodgeActive"]} urg={d["dodgeUrgency"]:.2f} intercept={d["interceptActive"]} speed={d["playerSpeed"]} enemies={d["enemies"]} incoming={d["incomingShells"]}{bug_flag}{clump_flag}')
    
    # === KEY FINDINGS ===
    out.append('')
    out.append('=' * 110)
    out.append('  KEY FINDINGS')
    out.append('=' * 110)
    out.append('')
    
    # Overall stats
    all_trials = all_analyses
    if all_trials:
        out.append(f'  Overall across {len(all_trials)} v22.3 trials:')
        out.append(f'    Avg dodge active: {mean(a["dodge_active_pct"] for a in all_trials):.1f}%')
        out.append(f'    Avg cold-spot reactive activation: {mean(a["coldspot_reactive_pct"] for a in all_trials):.1f}%')
        out.append(f'    Avg guard violated (toward-shell prevented): {mean(a["guard_violated_pct"] for a in all_trials):.1f}%')
        out.append(f'    Avg predicted shells per sample: {mean(a["predicted_shells_avg"] for a in all_trials):.1f}')
        out.append(f'    Avg real shells per sample: {mean(a["real_shells_avg"] for a in all_trials):.1f}')
        out.append(f'    Avg multi-shell scenarios (2+ incoming): {mean(a["multi_shell_pct"] for a in all_trials):.1f}%')
        out.append(f'    Total bug deaths (dodge active + enemy shell): {sum(a["bug_deaths"] for a in all_trials)}')
        out.append(f'    Total clump deaths (3+ incoming): {sum(a["clump_deaths"] for a in all_trials)}')
        out.append(f'    Total self-shell deaths: {sum(a["self_shell_deaths"] for a in all_trials)}')
    
    out.append('')
    out.append('  Interpretation guide:')
    out.append('    - dodgeActive% > 50% = dodge system is engaged most of the time (good)')
    out.append('    - coldspotReactive% high = 32-point scan finding safe directions (cold-spot working)')
    out.append('    - guardViolated% high = dot-product guard actively preventing toward-shell movement (bug fix working)')
    out.append('    - predictedShells > realShells = bot anticipating enemy fire (proactive dodging)')
    out.append('    - multiShell% high = many 2+ shell scenarios (cold-spot activation condition)')
    out.append('    - bugDeaths = cold-spot tried but failed to save (indicates cold-spot needs tuning)')
    out.append('    - clumpDeaths = 3+ shells at death (potentially undodgeable — 8-dir fallback tried)')
    out.append('    - self_shell_deaths = own ricochet (aimbot off should reduce these to ~0)')
    
    out.append('')
    out.append('=' * 110)
    out.append('  END OF DEEP ANALYSIS')
    out.append('=' * 110)
    
    text = '\n'.join(out)
    print(text)
    with open(OUTPUT, 'w') as f:
        f.write(text)
    print(f'\n  Saved to: {OUTPUT}')

if __name__ == '__main__':
    main()
