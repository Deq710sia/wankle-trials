#!/usr/bin/env python3
"""
generate-v22.5-final-charts.py — Comprehensive v22.5 final charts.
Includes: v22.5 vs all previous versions, Dodge Training aimbot OFF vs ON,
survival rates, death analysis, cold-spot activation.
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

CSV_PATH = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT_DIR = Path('/home/z/my-project/download/charts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Previous run averages (hardcoded from saved analyses)
PREV_AVG_KILLS = {
    'v19':   {'Custom Arena': 11.2, 'RK Fight': 5.4, 'Dungeon': 2.8},
    'v21.7': {'Custom Arena': 9.4,  'RK Fight': 4.0, 'Dungeon': 2.8},
    'v22.0': {'Custom Arena': 8.0,  'RK Fight': 6.2, 'Dungeon': 3.6},
    'v22.2': {'Custom Arena': 10.2, 'RK Fight': 3.2, 'Dungeon': 4.0},
    'v22.3': {'Custom Arena': 10.8, 'RK Fight': 4.8, 'Dungeon': 3.6},
    'v22.4': {'Custom Arena': 10.4, 'RK Fight': 5.2, 'Dungeon': 3.2},
}
PREV_SURVIVAL = {
    'v19':   {'Custom Arena': 40, 'RK Fight': 80, 'Dungeon': 60},
    'v21.7': {'Custom Arena': 60, 'RK Fight': 80, 'Dungeon': 100},
    'v22.0': {'Custom Arena': 40, 'RK Fight': 80, 'Dungeon': 40},
    'v22.2': {'Custom Arena': 40, 'RK Fight': 60, 'Dungeon': 40},
    'v22.3': {'Custom Arena': 60, 'RK Fight': 40, 'Dungeon': 80},
    'v22.4': {'Custom Arena': 40, 'RK Fight': 100, 'Dungeon': 60},
}
COLORS = {'v19': '#0077BB', 'v21.7': '#33BBEE', 'v22.0': '#EE7733', 'v22.2': '#AA3399', 'v22.3': '#009988', 'v22.4': '#FFB000', 'v22.5': '#CC3311'}

MAP_NAMES = {
    'custom-c2738ec4-135': 'Custom Arena',
    'custom-c69c5ff7-f4e': 'RK Fight',
    'custom-a6b7c90f-813': 'Dungeon',
}

def load_v225_csv():
    rows = []
    with open(CSV_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['version'] != 'v22.5': continue
            row['kills'] = int(row['kills'])
            row['deaths'] = int(row['deaths'])
            row['wave'] = int(row['wave'])
            row['alive'] = int(row['alive'])
            row['durationSec'] = int(row['durationSec'])
            row['aimbotOff'] = row.get('aimbotOff', '0')
            if '5f697a3b' in row['levelId']:
                row['map_name'] = f'Dodge Training ({"OFF" if row["aimbotOff"]=="1" else "ON"})'
            else:
                row['map_name'] = MAP_NAMES.get(row['levelId'], row['levelId'])
            rows.append(row)
    return rows

def load_jsonl(version, level_id, trial_num, aimbot_off=False):
    suffix = '-noaim' if aimbot_off else ''
    for name in [f'{version}-{level_id}-t{trial_num}{suffix}.jsonl', f'{version}-{level_id}-t{trial_num}.jsonl']:
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

def chart_v225_vs_all(rows):
    """Bar chart: v22.5 vs ALL previous versions, avg kills per survival map."""
    fig, ax = plt.subplots(figsize=(14, 7), constrained_layout=True)
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    x = np.arange(len(maps))
    width = 0.11
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5']
    
    for i, ver in enumerate(versions):
        vals = []
        for map_name in maps:
            if ver == 'v22.5':
                trials = [r for r in rows if r['map_name'] == map_name]
                v = mean(r['kills'] for r in trials) if trials else 0
            else:
                v = PREV_AVG_KILLS[ver].get(map_name, 0)
            vals.append(v)
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.15, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=8, color='#243447', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(maps, fontsize=13)
    ax.set_ylabel('Average Kills per Trial', fontsize=12, color='#243447')
    ax.set_title('v22.5 vs ALL Previous Versions — Average Kills per Trial (90s survival)',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 14)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'v225-final-vs-all-versions.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ v225-final-vs-all-versions.png')

def chart_v225_survival_vs_all(rows):
    """Bar chart: v22.5 vs ALL previous versions, survival rate per map."""
    fig, ax = plt.subplots(figsize=(14, 7), constrained_layout=True)
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    x = np.arange(len(maps))
    width = 0.11
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5']
    
    for i, ver in enumerate(versions):
        vals = []
        for map_name in maps:
            if ver == 'v22.5':
                trials = [r for r in rows if r['map_name'] == map_name]
                v = sum(1 for t in trials if t['alive']) / len(trials) * 100 if trials else 0
            else:
                v = PREV_SURVIVAL[ver].get(map_name, 0)
            vals.append(v)
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1.5, f'{val:.0f}%',
                        ha='center', va='bottom', fontsize=8, color='#243447', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels(maps, fontsize=13)
    ax.set_ylabel('Survival Rate %', fontsize=12, color='#243447')
    ax.set_title('v22.5 vs ALL Previous Versions — Survival Rate (alive at 90s)',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 115)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'v225-final-survival-vs-all.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ v225-final-survival-vs-all.png')

def chart_dodge_training_off_vs_on(rows):
    """4-panel deep dive: Dodge Training aimbot OFF vs ON."""
    dt_off = [r for r in rows if r['map_name'] == 'Dodge Training (OFF)']
    dt_on = [r for r in rows if r['map_name'] == 'Dodge Training (ON)']
    
    if not dt_off or not dt_on:
        print('  ✗ Missing Dodge Training data')
        return
    
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Dodge Training (campaign, 72 brown bots) — Aimbot OFF vs ON\nv22.5 cold-spot dodge system pure-dodge test',
                 fontsize=14, fontweight='bold', color='#243447', y=1.0)
    
    trial_labels = [f't{r["trial"]}' for r in dt_off]
    x = np.arange(5)
    w = 0.35
    
    # Panel 1: Kills comparison
    ax = axes[0, 0]
    off_kills = [r['kills'] for r in dt_off]
    on_kills = [r['kills'] for r in dt_on]
    ax.bar(x - w/2, off_kills, w, label='Aimbot OFF (Safe)', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.bar(x + w/2, on_kills, w, label='Aimbot ON (Rage)', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Kills per Trial', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills', fontsize=11, color='#243447')
    ax.legend(fontsize=10, frameon=False)
    style_ax(ax)
    
    # Panel 2: Deaths comparison
    ax = axes[0, 1]
    off_deaths = [r['deaths'] for r in dt_off]
    on_deaths = [r['deaths'] for r in dt_on]
    ax.bar(x - w/2, off_deaths, w, label='Aimbot OFF', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.bar(x + w/2, on_deaths, w, label='Aimbot ON', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Deaths per Trial (lower = better dodge)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Deaths', fontsize=11, color='#243447')
    ax.legend(fontsize=10, frameon=False)
    style_ax(ax)
    
    # Panel 3: Dodge system engagement (from JSONL)
    ax = axes[1, 0]
    off_dodge = []
    on_dodge = []
    off_guard = []
    on_guard = []
    for r in dt_off:
        samples, _ = load_jsonl(r['version'], r['levelId'], r['trial'], aimbot_off=True)
        if samples:
            off_dodge.append(sum(1 for s in samples if s.get('dodgeActive'))/len(samples)*100)
            off_guard.append(sum(1 for s in samples if s.get('guardViolated'))/len(samples)*100)
    for r in dt_on:
        samples, _ = load_jsonl(r['version'], r['levelId'], r['trial'], aimbot_off=False)
        if samples:
            on_dodge.append(sum(1 for s in samples if s.get('dodgeActive'))/len(samples)*100)
            on_guard.append(sum(1 for s in samples if s.get('guardViolated'))/len(samples)*100)
    
    if off_dodge and on_dodge:
        ax.bar(x - w/2, off_dodge, w, label='Dodge Active % (OFF)', color='#0077BB', edgecolor='white', linewidth=0.5)
        ax.bar(x + w/2, on_dodge, w, label='Dodge Active % (ON)', color='#CC3311', edgecolor='white', linewidth=0.5)
        ax.scatter(x - w/2, off_guard, color='#0077BB', marker='_', s=200, zorder=5, linewidths=2.5)
        ax.scatter(x + w/2, on_guard, color='#CC3311', marker='_', s=200, zorder=5, linewidths=2.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Dodge Active % (bars) + Guard Violated % (markers)\nGuard = toward-then-away bug prevented', fontsize=11, fontweight='bold', color='#243447')
    ax.set_ylabel('% of samples', fontsize=11, color='#243447')
    ax.set_ylim(0, 115)
    ax.legend(fontsize=9, frameon=False, loc='lower right')
    style_ax(ax)
    
    # Panel 4: Shell pressure comparison
    ax = axes[1, 1]
    off_real = []
    on_real = []
    off_pred = []
    on_pred = []
    for r in dt_off:
        samples, _ = load_jsonl(r['version'], r['levelId'], r['trial'], aimbot_off=True)
        if samples:
            off_real.append(mean(s.get('realShells', 0) or 0 for s in samples))
            off_pred.append(mean(s.get('predictedShells', 0) or 0 for s in samples))
    for r in dt_on:
        samples, _ = load_jsonl(r['version'], r['levelId'], r['trial'], aimbot_off=False)
        if samples:
            on_real.append(mean(s.get('realShells', 0) or 0 for s in samples))
            on_pred.append(mean(s.get('predictedShells', 0) or 0 for s in samples))
    
    if off_real and on_real:
        ax.bar(x - w*0.7, off_real, w*0.5, label='Real shells (OFF)', color='#33BBEE', edgecolor='white', linewidth=0.5)
        ax.bar(x - w*0.2, off_pred, w*0.5, label='Predicted (OFF)', color='#0077BB', edgecolor='white', linewidth=0.5)
        ax.bar(x + w*0.3, on_real, w*0.5, label='Real shells (ON)', color='#FFB000', edgecolor='white', linewidth=0.5)
        ax.bar(x + w*0.8, on_pred, w*0.5, label='Predicted (ON)', color='#CC3311', edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels(trial_labels, fontsize=11)
    ax.set_title('Shell Pressure: Real vs Predicted (avg per sample)\nPredicted > Real = bot anticipates enemy fire', fontsize=11, fontweight='bold', color='#243447')
    ax.set_ylabel('Shells per sample', fontsize=11, color='#243447')
    ax.legend(fontsize=8, frameon=False, loc='upper right')
    style_ax(ax)
    
    fig.savefig(OUTPUT_DIR / 'v225-dodge-training-off-vs-on.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ v225-dodge-training-off-vs-on.png')

def chart_v225_summary_dashboard(rows):
    """4-panel summary dashboard for v22.5."""
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Wankle3D Cheat v22.5 — Final Results Dashboard (25 trials: 3 survival maps × 5 + Dodge Training × 10)',
                 fontsize=14, fontweight='bold', color='#243447', y=1.0)
    
    # Panel 1: Kills per map (all 5 configs)
    ax = axes[0, 0]
    configs = ['Custom Arena', 'RK Fight', 'Dungeon', 'Dodge Training (OFF)', 'Dodge Training (ON)']
    kills = []
    for c in configs:
        trials = [r for r in rows if r['map_name'] == c]
        kills.append(mean(r['kills'] for r in trials) if trials else 0)
    colors = ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311']
    bars = ax.bar(range(5), kills, 0.6, color=colors, edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, kills):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5, f'{val:.1f}',
                ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(range(5)); ax.set_xticklabels(configs, fontsize=10, rotation=15, ha='right')
    ax.set_title('Average Kills per Trial', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills', fontsize=11, color='#243447')
    style_ax(ax)
    
    # Panel 2: Deaths per map
    ax = axes[0, 1]
    deaths = []
    for c in configs:
        trials = [r for r in rows if r['map_name'] == c]
        deaths.append(mean(r['deaths'] for r in trials) if trials else 0)
    bars = ax.bar(range(5), deaths, 0.6, color=colors, edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, deaths):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f'{val:.1f}',
                ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(range(5)); ax.set_xticklabels(configs, fontsize=10, rotation=15, ha='right')
    ax.set_title('Average Deaths per Trial (lower = better survival)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Deaths', fontsize=11, color='#243447')
    style_ax(ax)
    
    # Panel 3: Survival rate (survival maps only)
    ax = axes[1, 0]
    surv_maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    surv = []
    for m in surv_maps:
        trials = [r for r in rows if r['map_name'] == m]
        surv.append(sum(1 for t in trials if t['alive']) / len(trials) * 100 if trials else 0)
    bars = ax.bar(range(3), surv, 0.6, color=['#0077BB', '#33BBEE', '#009988'], edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, surv):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val:.0f}%',
                ha='center', va='bottom', fontsize=12, color='#243447', fontweight='bold')
    ax.set_xticks(range(3)); ax.set_xticklabels(surv_maps, fontsize=11)
    ax.set_title('Survival Rate % (alive at 90s)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Survival %', fontsize=11, color='#243447')
    ax.set_ylim(0, 115)
    style_ax(ax)
    
    # Panel 4: Dodge Training OFF vs ON summary
    ax = axes[1, 1]
    dt_off = [r for r in rows if r['map_name'] == 'Dodge Training (OFF)']
    dt_on = [r for r in rows if r['map_name'] == 'Dodge Training (ON)']
    categories = ['Kills', 'Deaths', 'K/D Ratio']
    off_vals = [mean(r['kills'] for r in dt_off), mean(r['deaths'] for r in dt_off), 
                mean(r['kills'] for r in dt_off) / mean(r['deaths'] for r in dt_off)]
    on_vals = [mean(r['kills'] for r in dt_on), mean(r['deaths'] for r in dt_on),
               mean(r['kills'] for r in dt_on) / mean(r['deaths'] for r in dt_on)]
    x = np.arange(3)
    w = 0.35
    ax.bar(x - w/2, off_vals, w, label='Aimbot OFF', color='#0077BB', edgecolor='white', linewidth=0.5)
    ax.bar(x + w/2, on_vals, w, label='Aimbot ON', color='#CC3311', edgecolor='white', linewidth=0.5)
    for i, (ov, nv) in enumerate(zip(off_vals, on_vals)):
        ax.text(i - w/2, ov + 0.5, f'{ov:.1f}', ha='center', va='bottom', fontsize=10, color='#243447')
        ax.text(i + w/2, nv + 0.5, f'{nv:.1f}', ha='center', va='bottom', fontsize=10, color='#243447')
    ax.set_xticks(x); ax.set_xticklabels(categories, fontsize=11)
    ax.set_title('Dodge Training: Aimbot OFF vs ON\n(deaths nearly identical = fire-stun doesn\'t hurt dodge)', fontsize=11, fontweight='bold', color='#243447')
    ax.legend(fontsize=10, frameon=False)
    style_ax(ax)
    
    fig.savefig(OUTPUT_DIR / 'v225-final-summary-dashboard.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ v225-final-summary-dashboard.png')

def main():
    print('Loading v22.5 CSV data...')
    rows = load_v225_csv()
    print(f'  Loaded {len(rows)} v22.5 trials')
    print('Generating final charts...')
    chart_v225_vs_all(rows)
    chart_v225_survival_vs_all(rows)
    chart_dodge_training_off_vs_on(rows)
    chart_v225_summary_dashboard(rows)
    print(f'\nAll charts saved to: {OUTPUT_DIR}')

if __name__ == '__main__':
    main()
