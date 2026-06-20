#!/usr/bin/env python3
"""
generate-charts-v2.py — Generate charts from v22.2 trial results.
Uses CSV (all 60 trials) for kills/deaths/wave/survival.
Uses JSONL (Dungeon 20 trials) for aim error, shells/kill, death causes.

Output: /home/z/my-project/download/charts/*.png
"""
import csv
import json
import os
from collections import defaultdict, Counter
from pathlib import Path
from statistics import mean

import matplotlib
matplotlib.use('Agg')
# Skip explicit font loading — use matplotlib's built-in font discovery.
# The chart text is English so DejaVu Sans (matplotlib default) is sufficient.
import matplotlib.pyplot as plt
import numpy as np
plt.rcParams['font.sans-serif'] = ['DejaVu Sans', 'Liberation Sans', 'sans-serif']
plt.rcParams['axes.unicode_minus'] = False

CSV_PATH = Path('/home/z/my-project/scripts/cheat-tests/survival-results.csv')
JSONL_DIR = Path('/home/z/my-project/scripts/cheat-tests/trial-logs')
OUTPUT_DIR = Path('/home/z/my-project/download/charts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAPS = [
    ('custom-c2738ec4-135', 'Custom Arena'),
    ('custom-c69c5ff7-f4e', 'RK Fight'),
    ('custom-a6b7c90f-813', 'Dungeon'),
]
VERSIONS = ['v19', 'v21.7', 'v22.0', 'v22.2']
COLORS = {
    'v19':   '#0077BB',
    'v21.7': '#33BBEE',
    'v22.0': '#EE7733',
    'v22.2': '#CC3311',
}

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

def chart_kills_per_map(rows):
    """Average kills per trial, grouped by version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    x = np.arange(len(MAPS))
    width = 0.2
    max_val = 0
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = [r for r in rows if r['version'] == ver and r['map_name'] == map_name]
            v = mean(r['kills'] for r in trials) if trials else 0
            vals.append(v)
            max_val = max(max_val, v)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f'{val:.1f}',
                    ha='center', va='bottom', fontsize=10, color='#243447', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=13)
    ax.set_ylabel('Average Kills per Trial', fontsize=12, color='#243447')
    ax.set_title('Kill Rate by Version × Map (90s survival trials, 5 per cell)',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, max_val * 1.25)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'kills-by-version.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ kills-by-version.png')

def chart_wave_per_map(rows):
    """Average wave reached per trial, grouped by version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    x = np.arange(len(MAPS))
    width = 0.2
    max_val = 0
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = [r for r in rows if r['version'] == ver and r['map_name'] == map_name]
            v = mean(r['wave'] for r in trials) if trials else 0
            vals.append(v)
            max_val = max(max_val, v)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.15, f'{val:.1f}',
                    ha='center', va='bottom', fontsize=10, color='#243447')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=13)
    ax.set_ylabel('Average Wave Reached', fontsize=12, color='#243447')
    ax.set_title('Wave Progression by Version × Map (higher = survived longer)',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, max_val * 1.3)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'wave-by-version.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ wave-by-version.png')

def chart_survival_per_map(rows):
    """Survival rate (% of trials where player was alive at end) per version × map."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    x = np.arange(len(MAPS))
    width = 0.2
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = [r for r in rows if r['version'] == ver and r['map_name'] == map_name]
            v = sum(1 for r in trials if r['alive']) / len(trials) * 100 if trials else 0
            vals.append(v)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val:.0f}%',
                    ha='center', va='bottom', fontsize=10, color='#243447')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=13)
    ax.set_ylabel('Survival Rate % (alive at 90s)', fontsize=12, color='#243447')
    ax.set_title('Survival Rate by Version × Map',
                 fontsize=14, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, 115)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'survival-by-version.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ survival-by-version.png')

def chart_corr_buckets(rows):
    """Aim correction activity (corrBuckets) — only v22.2 has this."""
    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)
    x = np.arange(len(MAPS))
    width = 0.2
    max_val = 0
    for i, ver in enumerate(VERSIONS):
        vals = []
        for _, map_name in MAPS:
            trials = [r for r in rows if r['version'] == ver and r['map_name'] == map_name]
            v = mean(r['corrBuckets'] for r in trials) if trials else 0
            vals.append(v)
            max_val = max(max_val, v)
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        bars = ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
        for bar, val in zip(bars, vals):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f'{val:.1f}',
                        ha='center', va='bottom', fontsize=10, color='#243447', fontweight='bold')
    ax.set_xticks(x)
    ax.set_xticklabels([m[1] for m in MAPS], fontsize=13)
    ax.set_ylabel('Average corrBuckets (aim correction table entries)', fontsize=11, color='#243447')
    ax.set_title('Aim Correction Activity (v22.2 only — v22.1\'s feature, FIXED)\nHigher = aim correction table is learning from more hit/miss outcomes',
                 fontsize=13, fontweight='bold', color='#243447', pad=12)
    ax.set_ylim(0, max_val * 1.4 if max_val > 0 else 20)
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=11)
    style_ax(ax)
    fig.savefig(OUTPUT_DIR / 'aim-correction-activity.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ aim-correction-activity.png')

def chart_dungeon_deep_dive(rows):
    """4-panel deep dive for Dungeon (the only map with JSONL data)."""
    # Load JSONL data for all Dungeon trials
    by_version = defaultdict(list)
    for r in rows:
        if r['map_name'] != 'Dungeon': continue
        samples, events = load_jsonl(r['version'], r['levelId'], r['trial'])
        if samples:
            by_version[r['version']].append((r, samples, events))

    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Dungeon Map Deep Dive — JSONL Telemetry (20 trials, 5 per version)',
                 fontsize=15, fontweight='bold', color='#243447', y=1.0)

    # Panel 1: Aim error (lower = better)
    ax = axes[0, 0]
    x = np.arange(len(VERSIONS))
    vals = []
    for ver in VERSIONS:
        trials = by_version.get(ver, [])
        if trials:
            avg_err = mean(
                mean(s.get('aimErr', 0) for s in samples if s.get('aimErr') is not None)
                if any(s.get('aimErr') is not None for s in samples) else 0
                for r, samples, events in trials
            )
        else:
            avg_err = 0
        vals.append(avg_err)
    bars = ax.bar(x, vals, 0.6, color=[COLORS[v] for v in VERSIONS], edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.03, f'{val:.2f}',
                ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(VERSIONS, fontsize=12)
    ax.set_title('Average Aim Error (radians, lower = better)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Aim Error (rad)', fontsize=11, color='#243447')
    ax.set_ylim(0, max(vals) * 1.25 if max(vals) > 0 else 1)
    style_ax(ax)

    # Panel 2: Shells per kill
    ax = axes[0, 1]
    vals = []
    for ver in VERSIONS:
        trials = by_version.get(ver, [])
        if trials:
            total_shells = sum(samples[-1].get('shellsFired', 0) for r, samples, events in trials)
            total_kills = sum(r['kills'] for r, samples, events in trials)
            spk = total_shells / total_kills if total_kills > 0 else 0
        else:
            spk = 0
        vals.append(spk)
    bars = ax.bar(x, vals, 0.6, color=[COLORS[v] for v in VERSIONS], edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2, f'{val:.2f}',
                ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(VERSIONS, fontsize=12)
    ax.set_title('Shell Efficiency (shells per kill, lower = better)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Shells / Kill', fontsize=11, color='#243447')
    ax.set_ylim(0, max(vals) * 1.3 if max(vals) > 0 else 10)
    style_ax(ax)

    # Panel 3: Death causes (stacked)
    ax = axes[1, 0]
    causes = ['enemy_shell', 'self_shell', 'unknown']
    cause_colors = {'enemy_shell': '#CC3311', 'self_shell': '#EE7733', 'unknown': '#888888'}
    cause_labels = {'enemy_shell': 'Enemy Shell', 'self_shell': 'Self Shell (ricochet)', 'unknown': 'Unknown'}
    bottoms = np.zeros(len(VERSIONS))
    for cause in causes:
        vals = []
        for ver in VERSIONS:
            trials = by_version.get(ver, [])
            count = sum(sum(1 for e in events if e.get('sub') == 'death' and e.get('cause') == cause) for r, samples, events in trials)
            vals.append(count)
        ax.bar(x, vals, 0.6, bottom=bottoms, label=cause_labels[cause],
               color=cause_colors[cause], edgecolor='white', linewidth=0.5)
        for i, (v, b) in enumerate(zip(vals, bottoms)):
            if v > 0:
                ax.text(i, b + v/2, str(v), ha='center', va='center', fontsize=11, color='white', fontweight='bold')
        bottoms += np.array(vals)
    ax.set_xticks(x); ax.set_xticklabels(VERSIONS, fontsize=12)
    ax.set_title('Death Causes on Dungeon (self_shell = ricochet into own shell)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Total Deaths (5 trials)', fontsize=11, color='#243447')
    ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False, fontsize=10)
    style_ax(ax)

    # Panel 4: Kill rate per minute
    ax = axes[1, 1]
    vals = []
    for ver in VERSIONS:
        trials = by_version.get(ver, [])
        if trials:
            total_kills = sum(r['kills'] for r, samples, events in trials)
            total_dur = sum(r['durationSec'] for r, samples, events in trials)
            kpm = total_kills / (total_dur / 60) if total_dur > 0 else 0
        else:
            kpm = 0
        vals.append(kpm)
    bars = ax.bar(x, vals, 0.6, color=[COLORS[v] for v in VERSIONS], edgecolor='white', linewidth=0.5)
    for bar, val in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.2, f'{val:.1f}',
                ha='center', va='bottom', fontsize=11, color='#243447', fontweight='bold')
    ax.set_xticks(x); ax.set_xticklabels(VERSIONS, fontsize=12)
    ax.set_title('Kill Rate (kills per minute, higher = better)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills / Minute', fontsize=11, color='#243447')
    ax.set_ylim(0, max(vals) * 1.3 if max(vals) > 0 else 10)
    style_ax(ax)

    fig.savefig(OUTPUT_DIR / 'dungeon-deep-dive.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ dungeon-deep-dive.png')

def chart_summary_dashboard(rows):
    """4-panel summary dashboard using CSV data (all 60 trials)."""
    fig, axes = plt.subplots(2, 2, figsize=(16, 11), constrained_layout=True)
    fig.suptitle('Wankle3D Cheat v22.2 Trial Results — Summary Dashboard (60 trials, 4 versions × 3 maps × 5 trials)',
                 fontsize=14, fontweight='bold', color='#243447', y=1.0)

    x = np.arange(len(MAPS))
    width = 0.2

    # Panel 1: Kills
    ax = axes[0, 0]
    for i, ver in enumerate(VERSIONS):
        vals = [mean(r['kills'] for r in rows if r['version'] == ver and r['map_name'] == m[1]) if [r for r in rows if r['version'] == ver and r['map_name'] == m[1]] else 0 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Average Kills per Trial', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Kills', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)

    # Panel 2: Wave
    ax = axes[0, 1]
    for i, ver in enumerate(VERSIONS):
        vals = [mean(r['wave'] for r in rows if r['version'] == ver and r['map_name'] == m[1]) if [r for r in rows if r['version'] == ver and r['map_name'] == m[1]] else 0 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Average Wave Reached', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Wave', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)

    # Panel 3: Survival %
    ax = axes[1, 0]
    for i, ver in enumerate(VERSIONS):
        vals = [sum(1 for r in rows if r['version'] == ver and r['map_name'] == m[1] and r['alive']) / max(1, sum(1 for r in rows if r['version'] == ver and r['map_name'] == m[1])) * 100 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Survival Rate % (alive at 90s)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('Survival %', fontsize=10, color='#243447')
    ax.set_ylim(0, 115)
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)

    # Panel 4: corrBuckets
    ax = axes[1, 1]
    for i, ver in enumerate(VERSIONS):
        vals = [mean(r['corrBuckets'] for r in rows if r['version'] == ver and r['map_name'] == m[1]) if [r for r in rows if r['version'] == ver and r['map_name'] == m[1]] else 0 for m in MAPS]
        offset = (i - len(VERSIONS)/2 + 0.5) * width
        ax.bar(x + offset, vals, width, label=ver, color=COLORS[ver], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x); ax.set_xticklabels([m[1] for m in MAPS], fontsize=10)
    ax.set_title('Aim Correction Activity (corrBuckets, v22.2 only)', fontsize=12, fontweight='bold', color='#243447')
    ax.set_ylabel('corrBuckets', fontsize=10, color='#243447')
    ax.legend(fontsize=9, frameon=False)
    style_ax(ax)

    fig.savefig(OUTPUT_DIR / 'summary-dashboard.png', dpi=200, facecolor='white')
    plt.close(fig)
    print('  ✓ summary-dashboard.png')

def main():
    print('Loading CSV data...')
    rows = load_csv()
    print(f'  Loaded {len(rows)} trials')
    print('Generating charts...')
    chart_kills_per_map(rows)
    chart_wave_per_map(rows)
    chart_survival_per_map(rows)
    chart_corr_buckets(rows)
    chart_dungeon_deep_dive(rows)
    chart_summary_dashboard(rows)
    print(f'\nAll charts saved to: {OUTPUT_DIR}')

if __name__ == '__main__':
    main()
