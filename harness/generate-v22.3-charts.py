#!/usr/bin/env python3
"""
generate-v22.3-charts.py — Charts comparing v22.3 to previous versions + cold-spot deep dive.
Uses:
  - CSV from PREVIOUS 60-trial run (v19, v21.7, v22.0, v22.2 — in download/csv-analysis.txt source)
  - CSV from CURRENT 20-trial run (v22.3)
  - JSONL from CURRENT run for cold-spot deep dive
"""
import csv
import json
import os
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Liberation Sans', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False

# PREVIOUS run CSV (60 trials: v19, v21.7, v22.0, v22.2 × 3 maps)
# We saved it as part of the previous analysis — reconstruct from download/csv-analysis.txt? No, the CSV was overwritten.
# We'll use the v22.3 CSV + the deep-trial-analysis.txt numbers from the previous run (hardcoded from the analysis we did).
PREV_CSV = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')  # current v22.3 run
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT_DIR = Path('/home/z/my-project/download/charts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAPS = [
    ('custom-c2738ec4-135', 'Custom Arena'),
    ('custom-c69c5ff7-f4e', 'RK Fight'),
    ('custom-a6b7c90f-813', 'Dungeon'),
    ('custom-5f697a3b-742', 'Dodge Training'),
]

# v22.3 data from current CSV
VERSIONS_V223 = ['v22.4']
COLORS = {'v22.4': '#CC3311'}

# Previous run averages (from csv-analysis.txt — hardcoded for comparison charts)
# Format: {version: {map_name: avg_kills}}
PREV_AVG_KILLS = {
    'v19':   {'Custom Arena': 11.2, 'RK Fight': 5.4, 'Dungeon': 2.8},
    'v21.7': {'Custom Arena': 9.4,  'RK Fight': 4.0, 'Dungeon': 2.8},
    'v22.0': {'Custom Arena': 8.0,  'RK Fight': 6.2, 'Dungeon': 3.6},
    'v22.2': {'Custom Arena': 10.2, 'RK Fight': 3.2, 'Dungeon': 4.0},
    'v22.3': {'Custom Arena': 10.8, 'RK Fight': 4.8, 'Dungeon': 3.6},
}
PREV_COLORS = {'v19': '#0077BB', 'v21.7': '#33BBEE', 'v22.0': '#EE7733', 'v22.2': '#AA3399', 'v22.3': '#EE7733', 'v22.4': '#CC3311'}

def load_v223_csv():
    rows = []
    with open(PREV_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['version'] == 'version': continue
            row['kills'] = int(row['kills'])
            row['deaths'] = int(row['deaths'])
            row['wave'] = int(row['wave'])
            row['alive'] = int(row['alive'])
            row['durationSec'] = int(row['durationSec'])
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

def style_ax(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)

def chart_v223_vs_previous(rows):
    """Bar chart: v22.3 vs previous versions, avg kills per map."""
    fig, ax = plt.subplots(figsize=(13, 7), constrained_layout=True)
    prev_maps = ['Custom Arena', 'RK Fight', 'Dungeon']  # previous run only had 3 maps
    x = np.arange(len(prev_maps))
    width = 0.15
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4']
    
    for i, ver in enumerate(versions):
        vals = []
        for map_name in prev_maps:
            if ver == 'v22.4':
                # From current CSV
                trials = [r for r in rows if r['version'] == ver and r['map_name'] == map_name]
                v = mean(r['kills'] for r in trials) if trials else 0
            else:
                v = PREV_AVG_KILLS[ver].get(map_name, 0)
            vals.append(v)
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=PREV_COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2, f'{val:.1f}',
                    ha='center', va='bottom', fontsize=9, color='#243447', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(prev_maps, fontsize=13)
    ax.set_ylabel('Average Kills per Trial', fontsize=12, color='#243447')
    ax.set_title('v22.3 (cold-spot) vs Previous Versions — Average Kills per Trial',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 16)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'v223-vs-previous-kills.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ v223-vs-previous-kills.png')

def chart_dodge_training_deep(rows):
    """4-panel deep dive on Dodge Training (the pure dodge test)."""
    # Load JSONL for all Dodge Training trials
    trials_with_jsonl = []
    for r in rows:
        if r['map_name'] != 'Dodge Training': continue
        samples, events = load_jsonl(r['version'], r['levelId'], r['trial'])
        if samples:
            trials_with_jsonl.append((r, samples, events))
    
    if not trials_with_jsonl:
        print('  ✗ No Dodge Training JSONL data')
        return
    
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Dodge Training (campaign, aimbot OFF) — Cold-Spot System Deep Dive\nPure dodge test: 72 brown bots shooting from the walls',
                 fontsize=14, fontweight='bold', color='#243447', y=1.0)
    
    trial_labels = [f't{r["trial"]}' for r, s, e in trials_with_jsonl]
    x = np.arange(len(trials_with_jsonl))
    
    # Panel 1: Dodge activity + cold-spot activation
    ax = axes[0, 0]
    dodge_pct = [sum(1 for s in samples if s.get('dodgeActive'))/len(samples)*100 for r, samples, e in trials_with_jsonl]
    csr_pct = [sum(1 for s in samples if s.get('coldSpotReactive'))/len(samples)*100 for r, samples, e in trials_with_jsonl]
    guard_pct = [sum(1 for s in samples if s.get('guardViolated'))/len(samples)*100 for r, samples, e in trials_with_jsonl]
    w = 0.25
    ax.bar(x - w, dodge_pct, w, label='Dodge Active %', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.bar(x, csr_pct, w, label='Cold-Spot Reactive %', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.bar(x + w, guard_pct, w, label='Guard Violated % (bug prevented)', color='#EE7733', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Dodge System Engagement', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('% of samples', fontsize=11, color='#243447')
    ax.set_ylim(0, 115)
    ax.legend(fontsize=9, frameon=False, loc='lower right')
    style_ax(ax)
    
    # Panel 2: Predicted vs Real shells
    ax = axes[0, 1]
    pred_avg = [mean(s.get('predictedShells', 0) or 0 for s in samples) for r, samples, e in trials_with_jsonl]
    real_avg = [mean(s.get('realShells', 0) or 0 for s in samples) for r, samples, e in trials_with_jsonl]
    ax.bar(x - w/2, pred_avg, w, label='Predicted Shells (avg/sample)', color='#33BBEE', edgecolor='white', linewidth=0.5)
    ax.bar(x + w/2, real_avg, w, label='Real Shells (avg/sample)', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Predicted vs Real Incoming Shells\n(bot anticipates enemy fire)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Shells per sample', fontsize=11, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)
    
    # Panel 3: Death causes
    ax = axes[1, 0]
    enemy_deaths = []
    self_deaths = []
    unknown_deaths = []
    for r, samples, events in trials_with_jsonl:
        causes = Counter()
        for e in events:
            if e.get('sub') == 'death':
                causes[e.get('cause', 'unknown')] += 1
        enemy_deaths.append(causes.get('enemy_shell', 0))
        self_deaths.append(causes.get('self_shell', 0))
        unknown_deaths.append(causes.get('unknown', 0))
    ax.bar(x - w, enemy_deaths, w, label='Enemy Shell', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.bar(x, self_deaths, w, label='Self Shell (ricochet)', color='#EE7733', edgecolor='white', linewidth=0.5)
    ax.bar(x + w, unknown_deaths, w, label='Unknown', color='#888888', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Death Causes per Trial', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Deaths', fontsize=11, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)
    
    # Panel 4: Kills + deaths + survival time
    ax = axes[1, 1]
    kills = [r['kills'] for r, s, e in trials_with_jsonl]
    deaths = [r['deaths'] for r, s, e in trials_with_jsonl]
    ax.bar(x - w/2, kills, w, label='Kills', color='#009988', edgecolor='white', linewidth=0.5)
    ax.bar(x + w/2, deaths, w, label='Deaths', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Kills vs Deaths (campaign mode, respawns)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Count', fontsize=11, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)
    
    fig.savefig(OUTPUT_DIR / 'dodge-training-deep-dive.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ dodge-training-deep-dive.png')

def chart_coldspot_activation_by_map(rows):
    """Bar chart: cold-spot activation % per map (shows where cold-spot actually kicks in)."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    
    maps_with_data = []
    dodge_pcts = []
    csr_pcts = []
    guard_pcts = []
    multi_pcts = []
    
    for level_id, map_name in MAPS:
        trials_with_jsonl = []
        for r in rows:
            if r['map_name'] != map_name: continue
            samples, events = load_jsonl(r['version'], r['levelId'], r['trial'])
            if samples:
                trials_with_jsonl.append((r, samples, events))
        if not trials_with_jsonl: continue
        maps_with_data.append(map_name)
        dodge_pcts.append(mean(sum(1 for s in samples if s.get('dodgeActive'))/len(samples)*100 for r, samples, e in trials_with_jsonl))
        csr_pcts.append(mean(sum(1 for s in samples if s.get('coldSpotReactive'))/len(samples)*100 for r, samples, e in trials_with_jsonl))
        guard_pcts.append(mean(sum(1 for s in samples if s.get('guardViolated'))/len(samples)*100 for r, samples, e in trials_with_jsonl))
        multi_pcts.append(mean(sum(1 for s in samples if (s.get('incomingShells',0) or 0) >= 2)/len(samples)*100 for r, samples, e in trials_with_jsonl))
    
    x = np.arange(len(maps_with_data))
    w = 0.2
    ax.bar(x - 1.5*w, dodge_pcts, w, label='Dodge Active %', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.bar(x - 0.5*w, csr_pcts, w, label='Cold-Spot Reactive %', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.bar(x + 0.5*w, guard_pcts, w, label='Guard Violated % (bug fix)', color='#EE7733', edgecolor='white', linewidth=0.5)
    ax.bar(x + 1.5*w, multi_pcts, w, label='2+ Shell Scenarios %', color='#009988', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(maps_with_data, fontsize=12)
    ax.set_ylabel('% of samples', fontsize=12, color='#243447')
    ax.set_title('Cold-Spot System Activation by Map\n(cold-spot only activates at 2+ incoming shells)',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 115)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=10)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'coldspot-activation-by-map.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ coldspot-activation-by-map.png')

def chart_death_analysis(rows):
    """Bar chart: death causes + bug/clump deaths per map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    
    maps_with_data = []
    enemy_deaths = []
    self_deaths = []
    unknown_deaths = []
    bug_deaths = []
    clump_deaths = []
    
    for level_id, map_name in MAPS:
        trials_with_jsonl = []
        for r in rows:
            if r['map_name'] != map_name: continue
            samples, events = load_jsonl(r['version'], r['levelId'], r['trial'])
            if samples:
                trials_with_jsonl.append((r, samples, events))
        if not trials_with_jsonl: continue
        maps_with_data.append(map_name)
        total_enemy = 0
        total_self = 0
        total_unknown = 0
        total_bug = 0
        total_clump = 0
        for r, samples, events in trials_with_jsonl:
            for e in events:
                if e.get('sub') != 'death': continue
                cause = e.get('cause', 'unknown')
                if cause == 'enemy_shell': total_enemy += 1
                elif cause == 'self_shell': total_self += 1
                else: total_unknown += 1
                if e.get('dodgeActive') and cause == 'enemy_shell': total_bug += 1
                if (e.get('incomingShells', 0) or 0) >= 3: total_clump += 1
        enemy_deaths.append(total_enemy)
        self_deaths.append(total_self)
        unknown_deaths.append(total_unknown)
        bug_deaths.append(total_bug)
        clump_deaths.append(total_clump)
    
    x = np.arange(len(maps_with_data))
    w = 0.15
    ax.bar(x - 2*w, enemy_deaths, w, label='Enemy Shell', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.bar(x - w, self_deaths, w, label='Self Shell', color='#EE7733', edgecolor='white', linewidth=0.5)
    ax.bar(x, unknown_deaths, w, label='Unknown', color='#888888', edgecolor='white', linewidth=0.5)
    ax.bar(x + w, bug_deaths, w, label='Bug Deaths (dodge active + enemy shell)', color='#AA3399', edgecolor='white', linewidth=0.5)
    ax.bar(x + 2*w, clump_deaths, w, label='Clump Deaths (3+ incoming)', color='#FFB000', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(maps_with_data, fontsize=12)
    ax.set_ylabel('Total Deaths (5 trials)', fontsize=12, color='#243447')
    ax.set_title('Death Analysis by Map — Cold-Spot Bug Deaths vs Undodgeable Clumps',
                 fontsize=13, fontweight='bold', color='#243447', pad=12)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=10)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'death-analysis-by-map.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ death-analysis-by-map.png')

def main():
    print('Loading v22.3 CSV data...')
    rows = load_v223_csv()
    print(f'  Loaded {len(rows)} v22.3 trials')
    print('Generating charts...')
    chart_v223_vs_previous(rows)
    chart_dodge_training_deep(rows)
    chart_coldspot_activation_by_map(rows)
    chart_death_analysis(rows)
    print(f'\nAll charts saved to: {OUTPUT_DIR}')

if __name__ == '__main__':
    main()
