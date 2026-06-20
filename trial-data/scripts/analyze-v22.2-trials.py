#!/usr/bin/env python3
"""
analyze-v22.2-trials.py — Custom deep analysis for v22.2 trial results.

Reads JSONL files from trial-logs/ and produces:
1. Per-trial summary with ground-truth kills/deaths from JSONL (not CSV)
2. Cross-version comparison table
3. Shell efficiency analysis (shells fired vs kills)
4. Dodge effectiveness analysis (dodge active % vs survival)
5. Death cause breakdown (self_shell vs enemy_shell vs mine vs unknown)
6. The "toward-then-away" bug detector (deaths where dodgeActive=true + cause=enemy_shell)
7. Aim correction effectiveness (for v22.2 — did corrBuckets correlate with hit rate?)

Output: /home/z/my-project/download/v22.2-trial-analysis.txt
"""
import json
import os
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean, median, stdev

TRIAL_LOG_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
RESULTS_CSV = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
OUTPUT = Path('/home/z/my-project/download/v22.2-trial-analysis.txt')

MAPS = {
    'custom-c2738ec4-135': 'Custom Arena',
    'custom-c69c5ff7-f4e': 'RK Fight',
    'custom-a6b7c90f-813': 'Dungeon',
}

def load_trial(jsonl_path):
    entries = []
    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try:
                e = json.loads(line)
                if isinstance(e, str): e = json.loads(e)
                if isinstance(e, dict):
                    entries.append(e)
            except: pass
    return entries

def analyze_trial(entries, version, trial_num, level_id):
    samples = [e for e in entries if e.get('kind') == 'sample']
    events = [e for e in entries if e.get('kind') == 'event']
    if not samples:
        return {'version': version, 'trial': trial_num, 'level_id': level_id, 'error': 'no samples'}

    final = samples[-1]
    alive_duration_s = final.get('tRel', 0) / 1000.0
    kill_events = [e for e in events if e.get('sub') == 'kill']
    death_events = [e for e in events if e.get('sub') == 'death']
    wave_events = [e for e in events if e.get('sub') == 'wave']

    # FPS
    fps_values = [s.get('fps', 0) for s in samples if s.get('fps', 0) > 0]
    fps_avg = mean(fps_values) if fps_values else 0

    # Aim
    aim_errs = [s.get('aimErr') for s in samples if s.get('aimErr') is not None]
    if aim_errs:
        aim_avg = mean(aim_errs)
        aim_locked = sum(1 for e in aim_errs if e < 0.1) / len(aim_errs) * 100
        aim_close = sum(1 for e in aim_errs if e < 0.3) / len(aim_errs) * 100
    else:
        aim_avg = 0; aim_locked = 0; aim_close = 0

    # Enemy pressure
    enemy_counts = [s.get('enemies', 0) for s in samples]
    max_enemies = max(enemy_counts) if enemy_counts else 0
    incoming_counts = [s.get('incomingShells', 0) for s in samples]
    under_fire = sum(1 for c in incoming_counts if c > 0)
    under_fire_pct = under_fire / len(incoming_counts) * 100 if incoming_counts else 0

    # Shell efficiency
    shells_fired = final.get('shellsFired', 0)
    kills = final.get('kills', 0)
    shells_per_kill = shells_fired / kills if kills > 0 else None

    # Dodge
    dodge_active_count = sum(1 for s in samples if s.get('dodgeActive', False))
    dodge_pct = dodge_active_count / len(samples) * 100 if samples else 0
    intercept_active_count = sum(1 for s in samples if s.get('interceptActive', False))
    intercept_pct = intercept_active_count / len(samples) * 100 if samples else 0

    # Player speed
    speed_values = [s.get('playerSpeed', 0) for s in samples if s.get('playerSpeed', 0) > 0]
    avg_speed = mean(speed_values) if speed_values else 0

    # Death analysis
    death_details = []
    for d in death_events:
        death_details.append({
            'time': round(d.get('tRel', 0) / 1000.0, 1),
            'cause': d.get('cause', 'unknown'),
            'dodgeActive': d.get('dodgeActive', False),
            'dodgeUrgency': d.get('dodgeUrgency', 0),
            'interceptActive': d.get('interceptActive', False),
            'playerSpeed': d.get('playerSpeed', 0),
            'wave': d.get('wave', 0),
            'kills': d.get('kills', 0),
        })

    # The "toward-then-away" bug signature: died while dodge was active (dodge tried but failed)
    # This is the bug v22.2's cold-spot system would fix
    bug_deaths = [d for d in death_details if d['dodgeActive'] and d['cause'] == 'enemy_shell']

    return {
        'version': version, 'trial': trial_num, 'level_id': level_id,
        'map_name': MAPS.get(level_id, level_id),
        'alive_duration_s': round(alive_duration_s, 1),
        'final_kills': kills,
        'final_deaths': len(death_events),
        'final_wave': final.get('wave', 0),
        'survived': not final.get('dead', True),
        'kill_rate_per_min': round((kills / alive_duration_s) * 60, 1) if alive_duration_s > 0 else 0,
        'fps_avg': round(fps_avg, 1),
        'aim_err_avg_rad': round(aim_avg, 3),
        'aim_locked_pct': round(aim_locked, 1),
        'aim_close_pct': round(aim_close, 1),
        'max_enemies': max_enemies,
        'under_fire_pct': round(under_fire_pct, 1),
        'shells_fired': shells_fired,
        'shells_per_kill': round(shells_per_kill, 2) if shells_per_kill else None,
        'dodge_active_pct': round(dodge_pct, 1),
        'intercept_active_pct': round(intercept_pct, 1),
        'avg_player_speed': round(avg_speed, 1),
        'death_details': death_details,
        'bug_deaths': bug_deaths,  # deaths where dodge was active but enemy shell still killed
    }

def main():
    all_stats = []
    for jsonl_file in sorted(TRIAL_LOG_DIR.glob('*.jsonl')):
        name = jsonl_file.stem
        parts = name.split('-t')
        if len(parts) != 2: continue
        version, trial_num = parts[0], int(parts[1])
        # Find level_id from CSV
        level_id = 'unknown'
        if RESULTS_CSV.exists():
            import csv
            with open(RESULTS_CSV) as f:
                reader = csv.DictReader(f)
                for row in reader:
                    if row['version'] == version and int(row['trial']) == trial_num:
                        level_id = row['levelId']
                        break
        entries = load_trial(jsonl_file)
        stats = analyze_trial(entries, version, trial_num, level_id)
        all_stats.append(stats)

    if not all_stats:
        print('No trials found.')
        return

    out = []
    out.append('=' * 100)
    out.append('  WANKLE3D CHEAT v22.2 TRIAL ANALYSIS — GROUND TRUTH FROM JSONL')
    out.append('=' * 100)
    out.append('')
    out.append(f'  Total trials analyzed: {len(all_stats)}')
    out.append(f'  Versions: {sorted(set(s["version"] for s in all_stats))}')
    out.append(f'  Maps: {sorted(set(s["map_name"] for s in all_stats if "map_name" in s))}')
    out.append('')

    # Group by (version, map)
    by_combo = defaultdict(list)
    for s in all_stats:
        if 'error' in s: continue
        key = (s['version'], s['map_name'])
        by_combo[key].append(s)

    out.append('=' * 100)
    out.append('  CROSS-VERSION SUMMARY (averages across all maps)')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"N":>3} {"AvgK":>5} {"AvgD":>5} {"AvgW":>5} {"Surv":>5} {"AvgFPS":>7} {"AimErr":>7} {"UnderFire%":>11} {"Shells/K":>9} {"Dodge%":>7} {"Spd":>5}')
    out.append(f'  {"-"*95}')
    by_version = defaultdict(list)
    for s in all_stats:
        if 'error' in s: continue
        by_version[s['version']].append(s)
    for ver in sorted(by_version.keys()):
        trials = by_version[ver]; n = len(trials)
        avg_k = mean(t['final_kills'] for t in trials)
        avg_d = mean(t['final_deaths'] for t in trials)
        avg_w = mean(t['final_wave'] for t in trials)
        surv = sum(1 for t in trials if t['survived'])
        avg_fps = mean(t['fps_avg'] for t in trials)
        avg_aim = mean(t['aim_err_avg_rad'] for t in trials)
        avg_uf = mean(t['under_fire_pct'] for t in trials)
        spks = [t['shells_per_kill'] for t in trials if t['shells_per_kill']]
        avg_spk = mean(spks) if spks else 0
        avg_dodge = mean(t['dodge_active_pct'] for t in trials)
        avg_spd = mean(t['avg_player_speed'] for t in trials)
        out.append(f'  {ver:<8} {n:>3} {avg_k:>5.1f} {avg_d:>5.1f} {avg_w:>5.1f} {surv:>3}/{n:<2} {avg_fps:>7.1f} {avg_aim:>7.3f} {avg_uf:>11.1f} {avg_spk:>9.2f} {avg_dodge:>7.1f} {avg_spd:>5.0f}')

    # Per-map breakdown
    out.append('')
    out.append('=' * 100)
    out.append('  PER-MAP CROSS-VERSION COMPARISON')
    out.append('=' * 100)
    for level_id, map_name in MAPS.items():
        out.append('')
        out.append(f'  --- {map_name} ({level_id}) ---')
        out.append(f'  {"Version":<8} {"N":>3} {"AvgK":>5} {"AvgD":>5} {"AvgW":>5} {"Surv":>5} {"AimErr":>7} {"Shells/K":>9} {"Dodge%":>7} {"AvgSpd":>7} {"BugDeaths":>10}')
        out.append(f'  {"-"*90}')
        for ver in sorted(by_version.keys()):
            trials = [t for t in by_version[ver] if t.get('map_name') == map_name]
            if not trials: continue
            n = len(trials)
            avg_k = mean(t['final_kills'] for t in trials)
            avg_d = mean(t['final_deaths'] for t in trials)
            avg_w = mean(t['final_wave'] for t in trials)
            surv = sum(1 for t in trials if t['survived'])
            avg_aim = mean(t['aim_err_avg_rad'] for t in trials)
            spks = [t['shells_per_kill'] for t in trials if t['shells_per_kill']]
            avg_spk = mean(spks) if spks else 0
            avg_dodge = mean(t['dodge_active_pct'] for t in trials)
            avg_spd = mean(t['avg_player_speed'] for t in trials)
            total_bug_deaths = sum(len(t['bug_deaths']) for t in trials)
            out.append(f'  {ver:<8} {n:>3} {avg_k:>5.1f} {avg_d:>5.1f} {avg_w:>5.1f} {surv:>3}/{n:<2} {avg_aim:>7.3f} {avg_spk:>9.2f} {avg_dodge:>7.1f} {avg_spd:>7.0f} {total_bug_deaths:>10}')

    # Shell efficiency deep dive
    out.append('')
    out.append('=' * 100)
    out.append('  SHELL EFFICIENCY ANALYSIS — LOWER IS BETTER (shells per kill)')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"Map":<15} {"Trials":>6} {"TotalShells":>12} {"TotalKills":>11} {"Shells/Kill":>12} {"Best Trial":>11} {"Worst Trial":>12}')
    out.append(f'  {"-"*100}')
    for ver in sorted(by_version.keys()):
        for map_name in [MAPS[l] for l in MAPS]:
            trials = [t for t in by_version[ver] if t.get('map_name') == map_name]
            if not trials: continue
            total_shells = sum(t['shells_fired'] for t in trials)
            total_kills = sum(t['final_kills'] for t in trials)
            overall_eff = total_shells / total_kills if total_kills > 0 else float('inf')
            per_trial_eff = [t['shells_per_kill'] for t in trials if t['shells_per_kill']]
            best = min(per_trial_eff) if per_trial_eff else 0
            worst = max(per_trial_eff) if per_trial_eff else 0
            out.append(f'  {ver:<8} {map_name:<15} {len(trials):>6} {total_shells:>12} {total_kills:>11} {overall_eff:>12.2f} {best:>11.2f} {worst:>12.2f}')

    # Death cause breakdown
    out.append('')
    out.append('=' * 100)
    out.append('  DEATH CAUSE BREAKDOWN')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"Map":<15} {"enemy_shell":>12} {"self_shell":>11} {"mine":>6} {"unknown":>8} {"TOTAL":>6} {"BugDeaths":>10} (dodge active + enemy_shell)')
    out.append(f'  {"-"*100}')
    for ver in sorted(by_version.keys()):
        for map_name in [MAPS[l] for l in MAPS]:
            trials = [t for t in by_version[ver] if t.get('map_name') == map_name]
            if not trials: continue
            causes = Counter()
            bug_count = 0
            for t in trials:
                for d in t['death_details']:
                    causes[d['cause']] += 1
                bug_count += len(t['bug_deaths'])
            total = sum(causes.values())
            out.append(f'  {ver:<8} {map_name:<15} {causes.get("enemy_shell",0):>12} {causes.get("self_shell",0):>11} {causes.get("mine",0):>6} {causes.get("unknown",0):>8} {total:>6} {bug_count:>10}')

    # Dodge effectiveness
    out.append('')
    out.append('=' * 100)
    out.append('  DODGE EFFECTIVENESS — does high dodge activity correlate with survival?')
    out.append('=' * 100)
    out.append('')
    out.append(f'  {"Version":<8} {"Map":<15} {"AvgDodge%":>10} {"AvgSurvived%":>13} {"AvgKills":>9} {"AvgUnderFire%":>15} {"DodgeReactRatio":>16}')
    out.append(f'  {"-"*100}')
    for ver in sorted(by_version.keys()):
        for map_name in [MAPS[l] for l in MAPS]:
            trials = [t for t in by_version[ver] if t.get('map_name') == map_name]
            if not trials: continue
            avg_dodge = mean(t['dodge_active_pct'] for t in trials)
            surv_pct = sum(1 for t in trials if t['survived']) / len(trials) * 100
            avg_kills = mean(t['final_kills'] for t in trials)
            avg_uf = mean(t['under_fire_pct'] for t in trials)
            # Dodge reaction ratio = dodge_active / under_fire (1.0 = dodged whenever under fire)
            ratio = avg_dodge / avg_uf if avg_uf > 0 else 0
            out.append(f'  {ver:<8} {map_name:<15} {avg_dodge:>10.1f} {surv_pct:>13.0f} {avg_kills:>9.1f} {avg_uf:>15.1f} {ratio:>16.2f}')

    # Per-trial detail for anomaly inspection
    out.append('')
    out.append('=' * 100)
    out.append('  PER-TRIAL DETAIL')
    out.append('=' * 100)
    for s in all_stats:
        if 'error' in s:
            out.append(f'  {s["version"]} t{s["trial"]} {s.get("level_id","?")}: ERROR — {s["error"]}')
            continue
        out.append(f'  {s["version"]} t{s["trial"]} {s["map_name"]}: K={s["final_kills"]} D={s["final_deaths"]} W={s["final_wave"]} dur={s["alive_duration_s"]}s fps={s["fps_avg"]} aimErr={s["aim_err_avg_rad"]} shells={s["shells_fired"]} ({s["shells_per_kill"]}/K) dodge={s["dodge_active_pct"]}%')
        for d in s['death_details']:
            bug_flag = ' *** BUG DEATH (dodge active + enemy shell)' if (d['dodgeActive'] and d['cause'] == 'enemy_shell') else ''
            out.append(f'      death at t={d["time"]}s: cause={d["cause"]} dodgeActive={d["dodgeActive"]} urgency={d["dodgeUrgency"]} intercept={d["interceptActive"]} speed={d["playerSpeed"]}{bug_flag}')

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
