#!/usr/bin/env python3
"""
generate-charts.py — Generate charts from v22.2 trial results.
Reads the same JSONL files as analyze-v22.2-trials.py and produces PNG charts.

Charts generated:
1. shell-efficiency.png — shells per kill, grouped by version × map (lower is better)
2. dodge-effectiveness.png — dodge active % + survival %, grouped by version × map
3. kills-by-version.png — average kills per trial, grouped by version × map
4. death-causes.png — stacked bar of death causes per version
5. summary-dashboard.png — 4-panel dashboard combining the above

Output: /home/z/my-project/download/charts/*.png
"""
import json
import os
import sys
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean, median

import matplotlib
matplotlib.use('Agg')
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

TRIAL_LOG_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
RESULTS_CSV = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
OUTPUT_DIR = Path('/home/z/my-project/download/charts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAPS = [
    ('custom-c2738ec4-135', 'Custom Arena'),
    ('custom-c69c5ff7-f4e', 'RK Fight'),
    ('custom-a6b7c90f-813', 'Dungeon'),
]
VERSIONS = ['v19', 'v21.7', 'v22.0', 'v22.2']

# Paul Tol colorblind-safe palette
COLORS = {
    'v19':   '#0077BB',  # blue
    'v21.7': '#33BBEE',  # cyan
    'v22.0': '#EE7733',  # orange
    'v22.2': '#CC3311',  # red
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

def analyze_trial(entries):
    samples = [e for e in entries if e.get('kind') == 'sample']
    events = [e for e in entries if e.get('kind') == 'event']
    if not samples:
        return None
    final = samples[-1]
    death_events = [e for e in events if e.get('sub') == 'death']
    return {
        'kills': final.get('kills', 0),
        'deaths': len(death_events),
        'wave': final.get('wave', 0),
        'survived': not final.get('dead', True),
        'alive_duration_s': final.get('tRel', 0) / 1000.0,
        'shells_fired': final.get('shellsFired', 0),
        'shells_per_kill': (final.get('shellsFired', 0) / final.get('kills', 1)) if final.get('kills', 0) > 0 else None,
        'dodge_active_pct': sum(1 for s in samples if s.get('dodgeActive', False)) / len(samples) * 100,
        'under_fire_pct': sum(1 for s in samples if s.get('incomingShells', 0) > 0) / len(samples) * 100,
        'intercept_active_pct': sum(1 for s in samples if s.get('interceptActive', False)) / len(samples) * 100,
        'aim_err_avg': mean([s.get('aimErr', 0) for s in samples if s.get('aimErr') is not None]) if any(s.get('aimErr') is not None for s in samples) else 0,
        'death_causes': [d.get('cause', 'unknown') for d in death_events],
        'bug_deaths': sum(1 for d in death_events if d.get('dodgeActive', False) and d.get('cause') == 'enemy_shell'),
    }

def load_all_trials():
    """Returns dict: (version, map_name) -> list of trial stats."""
    by_combo = defaultdict(list)
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
        map_name = next((m[1] for m in MAPS if m[0] == level_id), level_id)
        entries = load_trial(jsonl_file)
        stats = analyze_trial(entries)
        if stats:
            stats['version'] = version
            stats['map_name'] = map_name
            stats['trial_num'] = trial_num
            by_combo[(version, map_name)].append(stats)
    return by_combo

def chart_shell_efficiency(by_combo):
    """Grouped bar chart: shells per kill, version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    import numpy as np
    x = np.arange(len(MAPS))
    width = 0.2
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = by_combo.get((ver, map_name), [])
            spks = [t['shells_per_kill'] for t in trials if t['shells_per_kill']]
            vals.append(mean(spks) if spks else 0)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.1, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=9, color='#243447')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=12)
    ax.set_ylabel('Shells per Kill (lower is better)', fontsize=12, color='#243447')
    ax.set_title('Shell Efficiency by Version × Map', fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, max([max([mean([t['shells_per_kill'] for t in by_combo.get((v, m[1]), []) if t['shells_per_kill']] or [0]) for v in VERSIONS]) for m in MAPS]) * 1.25 if by_combo else 10)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)
    fig.savefig(OUTPUT_DIR / 'shell-efficiency.png', dpi=200, facecolor='white')
    plt.close(fig)
    print(f'  ✓ shell-efficiency.png')

def chart_dodge_effectiveness(by_combo):
    """Grouped bar chart: dodge active % + survival %, version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    import numpy as np
    x = np.arange(len(MAPS))
    width = 0.2
    for i, ver in enumerate(VERSIONS):
        dodge_vals = []
        surv_vals = []
        for _, map_name in MAPS:
            trials = by_combo.get((ver, map_name), [])
            dodge_vals.append(mean(t['dodge_active_pct'] for t in trials) if trials else 0)
            surv_vals.append(sum(1 for t in trials if t['survived']) / len(trials) * 100 if trials else 0)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, dodge_vals, width, label=f'{ver} dodge%', color=COLORS[ver], edgecolor='white', linewidth=0.5)
        # Survival as a marker on top
        ax.scatter(x + offset, surv_vals, color=COLORS[ver], marker='_', s=200, zorder=5, linewidths=2.5)
        for bar, val in zip(bars, dodge_vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1, f'{val:.0f}%',
                        ha='center', va='bottom', fontsize=8, color='#243447')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=12)
    ax.set_ylabel('Dodge Active % (bars)  |  Survival % (markers)', fontsize=11, color='#243447')
    ax.set_title('Dodge Activity & Survival Rate by Version × Map', fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 110)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=10)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)
    fig.savefig(OUTPUT_DIR / 'dodge-effectiveness.png', dpi=200, facecolor='white')
    plt.close(fig)
    print(f'  ✓ dodge-effectiveness.png')

def chart_kills_by_version(by_combo):
    """Grouped bar chart: average kills per trial, version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    import numpy as np
    x = np.arange(len(MAPS))
    width = 0.2
    max_val = 0
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = by_combo.get((ver, map_name), [])
            v = mean(t['kills'] for t in trials) if trials else 0
            vals.append(v)
            max_val = max(max_val, v)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=9, color='#243447')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=12)
    ax.set_ylabel('Average Kills per Trial', fontsize=12, color='#243447')
    ax.set_title('Kill Rate by Version × Map', fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, max_val * 1.25 if max_val > 0 else 10)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)
    fig.savefig(OUTPUT_DIR / 'kills-by-version.png', dpi=200, facecolor='white')
    plt.close(fig)
    print(f'  ✓ kills-by-version.png')

def chart_death_causes(by_combo):
    """Stacked bar chart: death causes per version (aggregated across all maps)."""
    fig, ax = plt.subplots(figsize=(11, 7), constrained_layout=True)
    import numpy as np
    causes = ['enemy_shell', 'self_shell', 'mine', 'unknown']
    cause_colors = {'enemy_shell': '#CC3311', 'self_shell': '#EE7733', 'mine': '#FFB000', 'unknown': '#888888'}
    cause_labels = {'enemy_shell': 'Enemy Shell', 'self_shell': 'Self Shell', 'mine': 'Mine', 'unknown': 'Unknown'}
    x = np.arange(len(VERSIONS))
    width = 0.6
    bottoms = np.zeros(len(VERSIONS))
    for cause in causes:
        vals = []
        for ver in VERSIONS:
            total = 0
            for _, map_name in MAPS:
                trials = by_combo.get((ver, map_name), [])
                for t in trials:
                    total += t['death_causes'].count(cause)
            vals.append(total)
        ax.bar(x, vals, width, bottom=bottoms, label=cause_labels[cause],
               color=cause_colors[cause], edgecolor='white', linewidth=0.5)
        for i, (v, b) in enumerate(zip(vals, bottoms)):
            if v > 0:
                ax.text(i, b + v/2, str(v), ha='center', va='center', fontsize=10, color='white', fontweight='bold')
        bottoms += np.array(vals)
    ax.set_xticks(x)
    ax.set_xticklabels(VERSIONS, fontsize=12)
    ax.set_ylabel('Total Deaths (across all maps)', fontsize=12, color='#243447')
    ax.set_title('Death Causes by Version', fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)
    fig.savefig(OUTPUT_DIR / 'death-causes.png', dpi=200, facecolor='white')
    plt.close(fig)
    print(f'  ✓ death-causes.png')

def chart_summary_dashboard(by_combo):
    """4-panel dashboard combining all charts."""
    import numpy as np
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Wankle3D Cheat v22.2 Trial Results — Comprehensive Dashboard',
                 fontsize=16, fontweight='bold', color='#243447', y=1.0)

    # Panel 1: Shell efficiency
    ax = axes[0, 0]
    x = np.arange(len(MAPS))
    width = 0.2
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = by_combo.get((ver, map_name), [])
            spks = [t['shells_per_kill'] for t in trials if t['shells_per_kill']]
            vals.append(mean(spks) if spks else 0)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Shell Efficiency (lower = better)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Shells / Kill', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15); ax.set_axisbelow(True)

    # Panel 2: Kills
    ax = axes[0, 1]
    for i, ver in enumerate(VERSIONS):
        vals = [mean(t['kills'] for t in by_combo.get((ver, m[1]), [])) if by_combo.get((ver, m[1]), []) else 0 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Average Kills per Trial', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15); ax.set_axisbelow(True)

    # Panel 3: Dodge active %
    ax = axes[1, 0]
    for i, ver in enumerate(VERSIONS):
        vals = [mean(t['dodge_active_pct'] for t in by_combo.get((ver, m[1]), [])) if by_combo.get((ver, m[1]), []) else 0 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Dodge Active %', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Dodge Active %', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15); ax.set_axisbelow(True)

    # Panel 4: Death causes stacked
    ax = axes[1, 1]
    causes = ['enemy_shell', 'self_shell', 'mine', 'unknown']
    cause_colors = {'enemy_shell': '#CC3311', 'self_shell': '#EE7733', 'mine': '#FFB000', 'unknown': '#888888'}
    cause_labels = {'enemy_shell': 'Enemy Shell', 'self_shell': 'Self Shell', 'mine': 'Mine', 'unknown': 'Unknown'}
    x2 = np.arange(len(VERSIONS))
    bottoms = np.zeros(len(VERSIONS))
    for cause in causes:
        vals = []
        for ver in VERSIONS:
            total = sum(t['death_causes'].count(cause) for _, map_name in MAPS for t in by_combo.get((ver, map_name), []))
            vals.append(total)
        ax.bar(x2, vals, 0.6, bottom=bottoms, label=cause_labels[cause], color=cause_colors[cause], edgecolor='white', linewidth=0.5)
        bottoms += np.array(vals)
    ax.set_xticks(x2); ax.set_xticklabels(VERSIONS, fontsize=10)
    ax.set_title('Death Causes (all maps)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Total Deaths', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15); ax.set_axisbelow(True)

    fig.savefig(OUTPUT_DIR / 'summary-dashboard.png', dpi=200, facecolor='white')
    plt.close(fig)
    print(f'  ✓ summary-dashboard.png')

def main():
    print('Loading trial data...')
    by_combo = load_all_trials()
    total_trials = sum(len(v) for v in by_combo.values())
    print(f'  Loaded {total_trials} trials across {len(by_combo)} (version, map) combos')
    if total_trials == 0:
        print('No trials to chart.')
        return
    print('Generating charts...')
    chart_shell_efficiency(by_combo)
    chart_dodge_effectiveness(by_combo)
    chart_kills_by_version(by_combo)
    chart_death_causes(by_combo)
    chart_summary_dashboard(by_combo)
    print(f'\nAll charts saved to: {OUTPUT_DIR}')

if __name__ == '__main__':
    main()
