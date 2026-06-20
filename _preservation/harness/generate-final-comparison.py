#!/usr/bin/env python3
"""
generate-final-comparison.py — Comprehensive comparison charts for ALL versions.
v19, v21.7, v22.0, v22.2, v22.3, v22.4, v22.5, v22.6
Includes: kills, survival, deaths, dodge data, shell efficiency, death causes.
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

V226_CSV = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
V225_CSV = Path('/home/z/my-project/download/v22.5-results.csv')
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT_DIR = Path('/home/z/my-project/download/charts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Previous versions (hardcoded from saved analyses — 60-trial run)
PREV_KILLS = {
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
PREV_DEATHS = {
    'v19':   {'Custom Arena': 0.8, 'RK Fight': 0.6, 'Dungeon': 0.4},
    'v21.7': {'Custom Arena': 1.4, 'RK Fight': 0.6, 'Dungeon': 0.2},
    'v22.0': {'Custom Arena': 1.6, 'RK Fight': 0.8, 'Dungeon': 1.6},
    'v22.2': {'Custom Arena': 1.2, 'RK Fight': 0.8, 'Dungeon': 1.0},
    'v22.3': {'Custom Arena': 0.8, 'RK Fight': 0.8, 'Dungeon': 0.6},
    'v22.4': {'Custom Arena': 0.8, 'RK Fight': 0.0, 'Dungeon': 0.8},
}

COLORS = {
    'v19': '#0077BB', 'v21.7': '#33BBEE', 'v22.0': '#EE7733',
    'v22.2': '#AA3399', 'v22.3': '#009988', 'v22.4': '#FFB000',
    'v22.5': '#FF5533', 'v22.6': '#CC0000',
}

MAP_NAMES = {
    'custom-c2738ec4-135': 'Custom Arena',
    'custom-c69c5ff7-f4e': 'RK Fight',
    'custom-a6b7c90f-813': 'Dungeon',
}

def load_csv(path, version):
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['version'] != version: continue
            map_name = MAP_NAMES.get(row['levelId'], row['levelId'])
            rows.append({
                'map_name': map_name,
                'kills': int(row['kills']),
                'deaths': int(row['deaths']),
                'wave': int(row['wave']),
                'alive': int(row['alive']),
                'corrBuckets': int(row.get('corrBuckets', 0)),
            })
    return rows

def style_ax(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.grid(axis='y', alpha=0.15, linestyle='-')
    ax.set_axisbelow(True)

def get_all_versions_data():
    """Returns {version: {map: {avg_kills, survival_pct, avg_deaths}}}"""
    data = {}
    # Previous versions
    for ver in PREV_KILLS:
        data[ver] = {}
        for m in ['Custom Arena', 'RK Fight', 'Dungeon']:
            data[ver][m] = {
                'kills': PREV_KILLS[ver][m],
                'survival': PREV_SURVIVAL[ver][m],
                'deaths': PREV_DEATHS[ver][m],
            }
    # v22.5
    v225 = load_csv(V225_CSV, 'v22.5')
    data['v22.5'] = {}
    for m in ['Custom Arena', 'RK Fight', 'Dungeon']:
        trials = [r for r in v225 if r['map_name'] == m]
        data['v22.5'][m] = {
            'kills': mean(r['kills'] for r in trials) if trials else 0,
            'survival': sum(1 for r in trials if r['alive']) / len(trials) * 100 if trials else 0,
            'deaths': mean(r['deaths'] for r in trials) if trials else 0,
        }
    # v22.6
    v226 = load_csv(V226_CSV, 'v22.6')
    data['v22.6'] = {}
    for m in ['Custom Arena', 'RK Fight', 'Dungeon']:
        trials = [r for r in v226 if r['map_name'] == m]
        data['v22.6'][m] = {
            'kills': mean(r['kills'] for r in trials) if trials else 0,
            'survival': sum(1 for r in trials if r['alive']) / len(trials) * 100 if trials else 0,
            'deaths': mean(r['deaths'] for r in trials) if trials else 0,
        }
    return data

def chart_kills_all_versions(data):
    fig, ax = plt.subplots(figsize=(15, 8), constrained_layout=True)
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6']
    x = np.arange(len(maps))
    width = 0.10
    
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['kills'] for m in maps]
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.15, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=7, color='#243447', fontweight='bold')
    
    ax.set_xticks(x)
    ax.set_xticklabels(maps, fontsize=14)
    ax.set_ylabel('Average Kills per Trial', fontsize=13, color='#243447')
    ax.set_title('ALL Versions — Average Kills per Trial (90s survival, 5 trials each)',
                 fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 14)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'FINAL-kills-all-versions.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ FINAL-kills-all-versions.png')

def chart_survival_all_versions(data):
    fig, ax = plt.subplots(figsize=(15, 8), constrained_layout=True)
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6']
    x = np.arange(len(maps))
    width = 0.10
    
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['survival'] for m in maps]
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1.5, f'{val:.0f}%',
                        ha='center', va='bottom', fontsize=7, color='#243447', fontweight='bold')
    
    ax.set_xticks(x)
    ax.set_xticklabels(maps, fontsize=14)
    ax.set_ylabel('Survival Rate %', fontsize=13, color='#243447')
    ax.set_title('ALL Versions — Survival Rate (alive at 90s)',
                 fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 115)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'FINAL-survival-all-versions.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ FINAL-survival-all-versions.png')

def chart_deaths_all_versions(data):
    fig, ax = plt.subplots(figsize=(15, 8), constrained_layout=True)
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6']
    x = np.arange(len(maps))
    width = 0.10
    
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['deaths'] for m in maps]
        offset = (i - len(versions)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.05, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=7, color='#243447')
    
    ax.set_xticks(x)
    ax.set_xticklabels(maps, fontsize=14)
    ax.set_ylabel('Average Deaths per Trial (lower = better)', fontsize=13, color='#243447')
    ax.set_title('ALL Versions — Average Deaths per Trial',
                 fontsize=15, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 3)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'FINAL-deaths-all-versions.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ FINAL-deaths-all-versions.png')

def chart_v226_dashboard(data):
    """4-panel dashboard: v22.6 vs v22.5 vs v19 (best baseline)"""
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('v22.6 (radical firing) vs v22.5 (best dodge) vs v19 (best kills) — Comprehensive Comparison',
                 fontsize=14, fontweight='bold', color='#243447', y=1.0)
    
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v22.5', 'v22.6']
    x = np.arange(len(maps))
    width = 0.25
    
    # Panel 1: Kills
    ax = axes[0, 0]
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['kills'] for m in maps]
        offset = (i - 1) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2, f'{val:.1f}',
                    ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(maps, fontsize=12)
    ax.set_title('Average Kills', fontsize=13, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills', fontsize=12, color='#243447')
    ax.legend(fontsize=11, frameon=False)
    ax.set_ylim(0, 14)
    style_ax(ax)
    
    # Panel 2: Survival
    ax = axes[0, 1]
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['survival'] for m in maps]
        offset = (i - 1) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val:.0f}%',
                    ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(maps, fontsize=12)
    ax.set_title('Survival Rate', fontsize=13, fontweight='bold', color='#243447')
    ax.set_ylabel('Survival %', fontsize=12, color='#243447')
    ax.set_ylim(0, 115)
    ax.legend(fontsize=11, frameon=False)
    style_ax(ax)
    
    # Panel 3: Deaths
    ax = axes[1, 0]
    for i, ver in enumerate(versions):
        vals = [data[ver][m]['deaths'] for m in maps]
        offset = (i - 1) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.05, f'{val:.1f}',
                    ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(maps, fontsize=12)
    ax.set_title('Average Deaths (lower = better)', fontsize=13, fontweight='bold', color='#243447')
    ax.set_ylabel('Deaths', fontsize=12, color='#243447')
    ax.legend(fontsize=11, frameon=False)
    ax.set_ylim(0, 2.5)
    style_ax(ax)
    
    # Panel 4: Shell efficiency (shells per kill) from JSONL for v22.5 + v22.6
    ax = axes[1, 1]
    # Load shell efficiency from JSONL
    def get_shell_eff(version, csv_path):
        results = {}
        rows_by_map = defaultdict(list)
        with open(csv_path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row['version'] != version: continue
                map_name = MAP_NAMES.get(row['levelId'], row['levelId'])
                rows_by_map[map_name].append(row)
        for m in maps:
            trials = rows_by_map.get(m, [])
            effs = []
            for t in trials:
                jsonl_name = t.get('jsonlFile', '')
                jsonl_path = JSONL_DIR / jsonl_name
                if jsonl_path.exists():
                    samples = []
                    with open(jsonl_path) as f:
                        for line in f:
                            line = line.strip()
                            if not line: continue
                            try:
                                e = json.loads(line)
                                if isinstance(e, str): e = json.loads(e)
                                if isinstance(e, dict) and e.get('kind') == 'sample':
                                    samples.append(e)
                            except: pass
                    if samples:
                        shells = samples[-1].get('shellsFired', 0)
                        kills = int(t['kills'])
                        if kills > 0:
                            effs.append(shells / kills)
            results[m] = mean(effs) if effs else 0
        return results
    
    v225_eff = get_shell_eff('v22.5', V225_CSV)
    v226_eff = get_shell_eff('v22.6', V226_CSV)
    
    v225_vals = [v225_eff[m] for m in maps]
    v226_vals = [v226_eff[m] for m in maps]
    ax.bar(x - width/2, v225_vals, width, label='v22.5', color=COLORS['v22.5'], edgecolor='white', linewidth=0.5)
    ax.bar(x + width/2, v226_vals, width, label='v22.6', color=COLORS['v22.6'], edgecolor='white', linewidth=0.5)
    for i, (v5, v6) in enumerate(zip(v225_vals, v226_vals)):
        if v5 > 0: ax.text(i - width/2, v5 + 0.3, f'{v5:.1f}', ha='center', va='bottom', fontsize=10, color='#243447')
        if v6 > 0: ax.text(i + width/2, v6 + 0.3, f'{v6:.1f}', ha='center', va='bottom', fontsize=10, color='#243447')
    ax.set_xticks(x); ax.set_xticklabels(maps, fontsize=12)
    ax.set_title('Shell Efficiency (shells per kill, lower = better)', fontsize=13, fontweight='bold', color='#243447')
    ax.set_ylabel('Shells / Kill', fontsize=12, color='#243447')
    ax.legend(fontsize=11, frameon=False)
    style_ax(ax)
    
    fig.savefig(OUTPUT_DIR / 'FINAL-v226-dashboard.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ FINAL-v226-dashboard.png')

def main():
    print('Loading all version data...')
    data = get_all_versions_data()
    print('Generating final comparison charts...')
    chart_kills_all_versions(data)
    chart_survival_all_versions(data)
    chart_deaths_all_versions(data)
    chart_v226_dashboard(data)
    print(f'\nAll charts saved to: {OUTPUT_DIR}')

if __name__ == '__main__':
    main()
