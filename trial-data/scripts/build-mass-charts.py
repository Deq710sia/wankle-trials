#!/usr/bin/env python3
"""
Build MASS chart set from archived cheat trial data.
Combines:
  - Per-version CSVs (v22.5, v22.6, v22.8, v23, v24, v25)
  - Worklog-archived averages for v19, v21.7, v22.0, v22.2, v22.3, v22.4
  - JSONL telemetry for v22.x and v25 (dodge-active %, cold-spot activation, etc.)

Produces 6 chart PNGs in /home/z/my-project/download/charts/.
"""
import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median, stdev

import matplotlib
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import numpy as np

# ── Font setup ──
fm.fontManager.addfont('/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

plt.rcParams.update({
    'font.sans-serif': ['DejaVu Sans', 'Noto Sans SC'],
    'axes.unicode_minus': False,
    'figure.facecolor': '#FFFFFF',
    'axes.facecolor': '#FFFFFF',
    'axes.edgecolor': '#E5E7EB',
    'axes.linewidth': 0.8,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.grid': False,
    'xtick.major.size': 0,
    'ytick.major.size': 0,
    'xtick.labelsize': 10,
    'ytick.labelsize': 10,
    'axes.labelsize': 11,
    'axes.titlesize': 14,
    'axes.titleweight': 'bold',
    'axes.titlepad': 14,
    'legend.frameon': False,
    'legend.fontsize': 9,
    'figure.dpi': 200,
    'savefig.dpi': 200,
    'savefig.bbox': 'tight',
    'savefig.facecolor': '#FFFFFF',
    'savefig.pad_inches': 0.3,
})

# ── Color palette (cool, low-saturation, colorblind-safe Paul Tol) ──
CB_SAFE = ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377', '#BBBBBB']
G900, G700, G500, G400, G300, G200, G100 = '#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB', '#F3F4F6'
ACCENT = '#0077BB'
ACCENT_ALT = '#EE7733'

# Map level IDs to friendly names
MAP_NAMES = {
    'custom-c2738ec4-135': 'Custom Arena',
    'custom-c69c5ff7-f4e': 'RK Fight',
    'custom-a6b7c90f-813': 'Dungeon',
    'custom-5f697a3b-742': 'Dodge Training',
}

# ── Load per-version CSVs ──
CSV_PATHS = {
    'v22.5': '/home/z/my-project/download/v22.5-results.csv',
    'v22.6': '/home/z/my-project/download/v22.6-results.csv',
    'v22.8': '/home/z/my-project/download/v22.8-results.csv',
    'v23':   '/home/z/my-project/download/v23-results.csv',
    'v24':   '/home/z/my-project/download/v24-results.csv',
    'v25':   '/home/z/my-project/scripts/cheat-tests/parallel-v25-results.csv',
}

# Worklog-archived averages for older versions (single avg per map, no per-trial)
# Format: { version: { map_name: {kills, deaths, survival_pct} } }
WORKLOG_AVGS = {
    'v19':    {'Custom Arena': {'k': 11.2, 'd': None, 'surv': None}, 'RK Fight': {'k': 5.4, 'd': None, 'surv': None}, 'Dungeon': {'k': 2.8, 'd': None, 'surv': None}},
    'v21.7':  {'Custom Arena': {'k': 9.4,  'd': None, 'surv': None}, 'RK Fight': {'k': 4.0, 'd': None, 'surv': None}, 'Dungeon': {'k': 2.8, 'd': None, 'surv': None}},
    'v22.0':  {'Custom Arena': {'k': 8.0,  'd': None, 'surv': None}, 'RK Fight': {'k': 6.2, 'd': None, 'surv': None}, 'Dungeon': {'k': 3.6, 'd': None, 'surv': None}},
    'v22.2':  {'Custom Arena': {'k': 10.2, 'd': None, 'surv': None}, 'RK Fight': {'k': 3.2, 'd': None, 'surv': None}, 'Dungeon': {'k': 4.0, 'd': None, 'surv': None}},
    'v22.3':  {'Custom Arena': {'k': 10.8, 'd': None, 'surv': None}, 'RK Fight': {'k': 4.8, 'd': None, 'surv': None}, 'Dungeon': {'k': 3.6, 'd': None, 'surv': None}, 'Dodge Training (off)': {'k': 27.4, 'd': None, 'surv': None}},
    'v22.4':  {'Custom Arena': {'k': 10.4, 'd': None, 'surv': None}, 'RK Fight': {'k': 5.2, 'd': None, 'surv': None}, 'Dungeon': {'k': 3.2, 'd': None, 'surv': None}, 'Dodge Training (off)': {'k': 26.0, 'd': None, 'surv': None}},
}

# Version → friendly label
VERSION_LABELS = {
    'v19': 'v19', 'v21.7': 'v21.7', 'v22.0': 'v22.0', 'v22.2': 'v22.2',
    'v22.3': 'v22.3', 'v22.4': 'v22.4', 'v22.5': 'v22.5', 'v22.6': 'v22.6',
    'v22.8': 'v22.8', 'v23': 'v23', 'v24': 'v24', 'v25': 'v25',
}

# Load all CSVs
def load_csv(path):
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for r in reader:
            if r.get('version') == 'version' or not r.get('version'):
                continue
            try:
                rows.append({
                    'version': r['version'],
                    'trial': int(r['trial']),
                    'kills': int(r['kills']),
                    'deaths': int(r['deaths']),
                    'wave': int(r['wave']),
                    'alive': int(r['alive']),
                    'hp': int(r['hp']),
                    'duration': int(r['durationSec']),
                    'avgFps': float(r.get('avgFps', 0) or 0),
                    'maxEnemies': int(r.get('maxEnemies', 0) or 0),
                    'levelId': r['levelId'],
                    'map_name': MAP_NAMES.get(r['levelId'], r['levelId']),
                    'mode': r['mode'],
                    'aimbotOff': r.get('aimbotOff', '0') == '1',
                })
            except (ValueError, KeyError) as e:
                continue
    return rows

ALL_ROWS = []
for ver, path in CSV_PATHS.items():
    if os.path.exists(path):
        ALL_ROWS.extend(load_csv(path))

# Build per-version, per-map aggregates from CSVs
def aggregate(rows):
    """Returns {version: {map_key: {trials: [...], avg_k, avg_d, surv_pct, n}}}"""
    out = defaultdict(lambda: defaultdict(list))
    for r in rows:
        map_key = r['map_name']
        if r['aimbotOff']:
            map_key = f"{r['map_name']} (off)"
        elif r['map_name'] == 'Dodge Training' and not r['aimbotOff']:
            map_key = f"{r['map_name']} (on)"
        out[r['version']][map_key].append(r)
    # Compute aggregates
    agg = {}
    for ver, maps in out.items():
        agg[ver] = {}
        for mk, trials in maps.items():
            ks = [t['kills'] for t in trials]
            ds = [t['deaths'] for t in trials]
            surv = sum(1 for t in trials if t['alive']) / len(trials) * 100
            agg[ver][mk] = {
                'trials': trials,
                'n': len(trials),
                'avg_k': mean(ks),
                'avg_d': mean(ds),
                'max_k': max(ks),
                'min_k': min(ks),
                'med_k': median(ks),
                'std_k': stdev(ks) if len(ks) > 1 else 0,
                'surv_pct': surv,
                'all_k': ks,
                'all_d': ds,
            }
    return agg

AGG = aggregate(ALL_ROWS)

# Merge worklog averages into AGG (treat as single-trial observations)
for ver, maps in WORKLOG_AVGS.items():
    if ver not in AGG:
        AGG[ver] = {}
    for mk, vals in maps.items():
        if mk not in AGG[ver]:
            AGG[ver][mk] = {
                'trials': [], 'n': 1,
                'avg_k': vals['k'], 'avg_d': vals.get('d') or 0,
                'max_k': vals['k'], 'min_k': vals['k'], 'med_k': vals['k'], 'std_k': 0,
                'surv_pct': vals.get('surv') or 0,
                'all_k': [vals['k']], 'all_d': [vals.get('d') or 0],
            }

# ── Load JSONL telemetry for v25 (and v22.x if present) ──
def load_jsonl_samples(path):
    samples = []
    if not os.path.exists(path):
        return samples
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
                if e.get('kind') == 'sample':
                    samples.append(e)
            except: pass
    return samples

def telemetry_summary(samples):
    """Returns dict of aggregate telemetry stats."""
    if not samples:
        return None
    n = len(samples)
    dodge_active = sum(1 for s in samples if s.get('dodgeActive'))
    guard_violated = sum(1 for s in samples if s.get('guardViolated'))
    path_guard_crosses = sum(1 for s in samples if s.get('pathGuardCrosses'))
    real_shells = [s.get('realShells', 0) for s in samples]
    pred_shells = [s.get('predictedShells', 0) for s in samples]
    incoming = [s.get('incomingShells', 0) for s in samples]
    cold_react = sum(1 for s in samples if s.get('coldSpotReactive'))
    return {
        'n': n,
        'dodge_active_pct': 100 * dodge_active / n,
        'guard_violated_pct': 100 * guard_violated / n,
        'path_guard_crosses_pct': 100 * path_guard_crosses / n,
        'avg_real_shells': mean(real_shells),
        'avg_pred_shells': mean(pred_shells),
        'avg_incoming': mean(incoming),
        'cold_react_pct': 100 * cold_react / n if cold_react else 0,
    }

# Aggregate v25 telemetry per map
V25_TELEMETRY = {}
v25_log_dir = Path('/home/z/my-project/scripts/cheat-tests/parallel-v25-logs')
if v25_log_dir.exists():
    for jsonl in sorted(v25_log_dir.glob('*.jsonl')):
        # Filename: v25-{levelId}-t{N}[-noaim].jsonl
        fname = jsonl.stem
        parts = fname.split('-')
        # Find level id (custom-XXXX-XXX) and trial (tN)
        if '-t' not in fname: continue
        # Extract level id
        m = fname.split('-t')[0].replace('v25-', '')
        map_name = MAP_NAMES.get(m, m)
        if 'noaim' in fname:
            map_key = f"{map_name} (off)"
        elif map_name == 'Dodge Training':
            map_key = f"{map_name} (on)"
        else:
            map_key = map_name
        samples = load_jsonl_samples(str(jsonl))
        if not samples: continue
        if map_key not in V25_TELEMETRY:
            V25_TELEMETRY[map_key] = []
        V25_TELEMETRY[map_key].append(telemetry_summary(samples))

# Average v25 telemetry across trials per map
V25_TELEMETRY_AVG = {}
for mk, trials in V25_TELEMETRY.items():
    valid = [t for t in trials if t]
    if not valid: continue
    V25_TELEMETRY_AVG[mk] = {
        'dodge_active_pct': mean(t['dodge_active_pct'] for t in valid),
        'guard_violated_pct': mean(t['guard_violated_pct'] for t in valid),
        'path_guard_crosses_pct': mean(t['path_guard_crosses_pct'] for t in valid),
        'avg_real_shells': mean(t['avg_real_shells'] for t in valid),
        'avg_pred_shells': mean(t['avg_pred_shells'] for t in valid),
        'avg_incoming': mean(t['avg_incoming'] for t in valid),
        'n_trials': len(valid),
    }

# ─────────────────────────────────────────────────────────────────
#  CHART 1 — Version evolution: avg kills per map (grouped bars)
# ─────────────────────────────────────────────────────────────────
def chart1_version_kills():
    survival_maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
    
    fig, ax = plt.subplots(figsize=(14, 7))
    
    n_ver = len(versions)
    n_map = len(survival_maps)
    bar_w = 0.25
    x = np.arange(n_ver)
    
    colors = [CB_SAFE[0], CB_SAFE[3], CB_SAFE[4]]  # blue, orange, red
    
    for i, mk in enumerate(survival_maps):
        ks = []
        for v in versions:
            if v in AGG and mk in AGG[v]:
                ks.append(AGG[v][mk]['avg_k'])
            else:
                ks.append(0)
        offset = (i - 1) * bar_w
        bars = ax.bar(x + offset, ks, bar_w, label=mk, color=colors[i], edgecolor='white', linewidth=0.5)
        # Value labels on top
        for j, b in enumerate(bars):
            if ks[j] > 0:
                ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.4,
                        f'{ks[j]:.1f}', ha='center', va='bottom',
                        fontsize=8, color=G700)
    
    ax.set_xticks(x)
    ax.set_xticklabels([VERSION_LABELS.get(v, v) for v in versions])
    ax.set_ylabel('Average kills per trial (90s)')
    ax.set_title('Cheat version evolution — average kills per map (survival mode)',
                 loc='left', color=G900, pad=18)
    # Compute max kill value across all versions/maps for ylim
    all_k_vals = [AGG[v][m]['avg_k'] for v in versions if v in AGG for m in survival_maps if m in AGG[v]]
    ax.set_ylim(0, max(15, max(all_k_vals) * 1.18) if all_k_vals else 15)
    ax.yaxis.grid(True, alpha=0.15, color=G300)
    ax.set_axisbelow(True)
    ax.legend(loc='upper left', bbox_to_anchor=(0.0, -0.10), ncol=3, frameon=False)
    
    # Annotation: note about pre-v22.5 being worklog-archived
    ax.text(0.99, 0.98,
            'Pre-v22.5: worklog-archived averages (no per-trial data).\nv22.5+: full trial CSVs.',
            transform=ax.transAxes, ha='right', va='top',
            fontsize=8, color=G500, style='italic',
            bbox=dict(boxstyle='round,pad=0.4', fc='#F9FAFB', ec=G200))
    
    plt.tight_layout()
    out = '/home/z/my-project/download/charts/01-version-kills-evolution.png'
    plt.savefig(out)
    plt.close()
    print(f'  WROTE {out}')

# ─────────────────────────────────────────────────────────────────
#  CHART 2 — v25 vs v24 vs v23 head-to-head (4-panel: K/D/surv/wave)
# ─────────────────────────────────────────────────────────────────
def chart2_head_to_head():
    versions = ['v23', 'v24', 'v25']
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    
    fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    fig.suptitle('Head-to-head: v23 vs v24 vs v25 — survival maps',
                 fontsize=15, fontweight='bold', color=G900, y=1.02)
    
    metrics = [
        ('avg_k', 'Average kills', axes[0, 0], 'K per trial'),
        ('avg_d', 'Average deaths', axes[0, 1], 'D per trial'),
        ('surv_pct', 'Survival rate %', axes[1, 0], '% trials survived'),
        ('med_k', 'Median kills', axes[1, 1], 'median K (consistency)'),
    ]
    
    colors = {'v23': CB_SAFE[3], 'v24': CB_SAFE[4], 'v25': CB_SAFE[0]}
    bar_w = 0.25
    x = np.arange(len(maps))
    
    for key, title, ax, ylab in metrics:
        for i, v in enumerate(versions):
            vals = [AGG[v][m][key] if v in AGG and m in AGG[v] else 0 for m in maps]
            offset = (i - 1) * bar_w
            bars = ax.bar(x + offset, vals, bar_w, label=v, color=colors[v],
                          edgecolor='white', linewidth=0.5)
            for b, val in zip(bars, vals):
                if val > 0 or key in ('avg_d',):
                    fmt = '{:.1f}' if key != 'surv_pct' else '{:.0f}%'
                    ax.text(b.get_x() + b.get_width()/2, b.get_height() + 1.5,
                            fmt.format(val), ha='center', va='bottom',
                            fontsize=8, color=G700)
        ax.set_xticks(x)
        ax.set_xticklabels(maps)
        ax.set_title(title, loc='left', fontsize=12, color=G900, pad=8)
        ax.set_ylabel(ylab)
        ax.yaxis.grid(True, alpha=0.12, color=G300)
        ax.set_axisbelow(True)
        # Extend ylim
        all_vals = [AGG[v][m][key] for v in versions for m in maps if v in AGG and m in AGG[v]]
        if all_vals:
            ax.set_ylim(0, max(all_vals) * 1.22)
        ax.legend(loc='upper right', frameon=False)
    
    plt.savefig('/home/z/my-project/download/charts/02-head-to-head-v23-v24-v25.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/02-head-to-head-v23-v24-v25.png')

# ─────────────────────────────────────────────────────────────────
#  CHART 3 — Per-trial scatter (K vs D), v22.5 → v25
# ─────────────────────────────────────────────────────────────────
def chart3_scatter_kd():
    versions = ['v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
    maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    
    fig, axes = plt.subplots(1, 3, figsize=(15, 5.5), constrained_layout=True)
    fig.suptitle('Per-trial performance: kills vs deaths (each dot = 1 trial, 90s)',
                 fontsize=14, fontweight='bold', color=G900, y=1.04)
    
    color_map = {v: CB_SAFE[i % len(CB_SAFE)] for i, v in enumerate(versions)}
    
    for ax, mk in zip(axes, maps):
        for v in versions:
            if v not in AGG or mk not in AGG[v]: continue
            trials = AGG[v][mk]['trials']
            if not trials: continue
            ks = [t['kills'] for t in trials]
            ds = [t['deaths'] for t in trials]
            # Jitter to separate overlapping points
            rng = np.random.default_rng(42)
            jx = rng.uniform(-0.15, 0.15, len(ks))
            jy = rng.uniform(-0.15, 0.15, len(ks))
            ax.scatter([d + jy[i] for i, d in enumerate(ds)],
                       [k + jx[i] for i, k in enumerate(ks)],
                       s=70, alpha=0.75, color=color_map[v], label=v,
                       edgecolors='white', linewidths=0.8)
        # Ideal zone: high K, 0 D (top-left)
        ax.set_xlabel('Deaths')
        ax.set_ylabel('Kills')
        ax.set_title(mk, loc='left', fontsize=12, color=G900, pad=8)
        ax.set_xlim(-0.7, max(8, max(t['deaths'] for v in versions if v in AGG and mk in AGG[v] for t in AGG[v][mk]['trials']) + 1))
        ax.set_ylim(-0.7, None)
        ax.yaxis.grid(True, alpha=0.12, color=G300)
        ax.xaxis.grid(True, alpha=0.12, color=G300)
        ax.set_axisbelow(True)
        # Mark "sweet spot" (top-left): 0 deaths, high kills
        ax.axvspan(-0.5, 0.5, alpha=0.05, color=CB_SAFE[2], zorder=0)
        ax.text(0, ax.get_ylim()[1] * 0.95, ' sweet spot\n 0 deaths',
                fontsize=8, color=G500, style='italic', va='top')
        ax.legend(loc='lower right', frameon=False, fontsize=8)
    
    plt.savefig('/home/z/my-project/download/charts/03-per-trial-scatter.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/03-per-trial-scatter.png')

# ─────────────────────────────────────────────────────────────────
#  CHART 4 — v25 Dodge Training: aimbot OFF vs ON
# ─────────────────────────────────────────────────────────────────
def chart4_dodge_training():
    versions = ['v22.5', 'v22.8', 'v23', 'v24', 'v25']
    maps = ['Dodge Training (off)', 'Dodge Training (on)']
    
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.5), constrained_layout=True)
    fig.suptitle('Dodge Training — aimbot OFF (pure dodge) vs ON (realistic)',
                 fontsize=14, fontweight='bold', color=G900, y=1.04)
    
    for ax, mk, title in zip(axes, maps, ['Aimbot OFF — pure dodge', 'Aimbot ON — realistic (fire-stun + dodge)']):
        valid_vs = [v for v in versions if v in AGG and mk in AGG[v]]
        if not valid_vs:
            ax.text(0.5, 0.5, 'No data', transform=ax.transAxes, ha='center')
            continue
        ks = [AGG[v][mk]['avg_k'] for v in valid_vs]
        ds = [AGG[v][mk]['avg_d'] for v in valid_vs]
        x = np.arange(len(valid_vs))
        bar_w = 0.38
        b1 = ax.bar(x - bar_w/2, ks, bar_w, label='Avg kills', color=CB_SAFE[0], edgecolor='white', linewidth=0.5)
        b2 = ax.bar(x + bar_w/2, ds, bar_w, label='Avg deaths', color=CB_SAFE[4], edgecolor='white', linewidth=0.5)
        for b, v in zip(b1, ks):
            ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.7,
                    f'{v:.1f}', ha='center', va='bottom', fontsize=9, color=G700)
        for b, v in zip(b2, ds):
            ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.7,
                    f'{v:.1f}', ha='center', va='bottom', fontsize=9, color=G700)
        ax.set_xticks(x)
        ax.set_xticklabels([VERSION_LABELS.get(v, v) for v in valid_vs])
        ax.set_title(title, loc='left', fontsize=12, color=G900, pad=8)
        ax.set_ylabel('Per 90s trial (72 enemies)')
        ax.yaxis.grid(True, alpha=0.12, color=G300)
        ax.set_axisbelow(True)
        ax.set_ylim(0, max(ks + ds) * 1.30)
        ax.legend(loc='upper left', frameon=False)
    
    plt.savefig('/home/z/my-project/download/charts/04-dodge-training-off-vs-on.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/04-dodge-training-off-vs-on.png')

# ─────────────────────────────────────────────────────────────────
#  CHART 5 — v25 telemetry: dodge engagement & path-guard (4-panel)
# ─────────────────────────────────────────────────────────────────
def chart5_v25_telemetry():
    if not V25_TELEMETRY_AVG:
        print('  SKIP chart5 — no v25 telemetry')
        return
    
    maps = list(V25_TELEMETRY_AVG.keys())
    # Order: survival maps first, then dodge training
    map_order = ['Custom Arena', 'RK Fight', 'Dungeon', 'Dodge Training (off)', 'Dodge Training (on)']
    maps = [m for m in map_order if m in V25_TELEMETRY_AVG]
    
    fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    fig.suptitle('v25 in-game telemetry — dodge system engagement across maps',
                 fontsize=14, fontweight='bold', color=G900, y=1.02)
    
    colors = [CB_SAFE[0], CB_SAFE[3], CB_SAFE[2], CB_SAFE[4], CB_SAFE[5]]
    
    # Panel 1: dodge active % per map
    ax = axes[0, 0]
    vals = [V25_TELEMETRY_AVG[m]['dodge_active_pct'] for m in maps]
    bars = ax.barh(maps, vals, color=colors[:len(maps)], edgecolor='white', linewidth=0.5)
    for b, v in zip(bars, vals):
        ax.text(b.get_width() + 1, b.get_y() + b.get_height()/2,
                f'{v:.1f}%', va='center', fontsize=9, color=G700)
    ax.set_title('Dodge active (% of frames)', loc='left', fontsize=12, color=G900, pad=8)
    ax.set_xlim(0, 105)
    ax.xaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    
    # Panel 2: path-guard crosses % (v25 NEW)
    ax = axes[0, 1]
    vals = [V25_TELEMETRY_AVG[m]['path_guard_crosses_pct'] for m in maps]
    bars = ax.barh(maps, vals, color=colors[:len(maps)], edgecolor='white', linewidth=0.5)
    for b, v in zip(bars, vals):
        ax.text(b.get_width() + 1, b.get_y() + b.get_height()/2,
                f'{v:.1f}%', va='center', fontsize=9, color=G700)
    ax.set_title('v25 path-guard triggered (% of dodge frames)',
                 loc='left', fontsize=12, color=G900, pad=8)
    ax.set_xlim(0, max(vals) * 1.25 if vals else 100)
    ax.xaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    
    # Panel 3: avg shells (real + predicted) per map
    ax = axes[1, 0]
    real_vals = [V25_TELEMETRY_AVG[m]['avg_real_shells'] for m in maps]
    pred_vals = [V25_TELEMETRY_AVG[m]['avg_pred_shells'] for m in maps]
    x = np.arange(len(maps))
    bar_w = 0.4
    ax.bar(x - bar_w/2, real_vals, bar_w, label='Real shells', color=CB_SAFE[0], edgecolor='white', linewidth=0.5)
    ax.bar(x + bar_w/2, pred_vals, bar_w, label='Predicted shells', color=CB_SAFE[3], edgecolor='white', linewidth=0.5)
    ax.set_xticks(x)
    ax.set_xticklabels([m.replace('Dodge Training ', 'DT ').replace('Custom Arena', 'CA').replace('RK Fight', 'RK') for m in maps],
                       rotation=15, ha='right', fontsize=8)
    ax.set_title('Average shell density per frame', loc='left', fontsize=12, color=G900, pad=8)
    ax.set_ylabel('Shells per sample')
    ax.yaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    ax.legend(loc='upper left', frameon=False)
    
    # Panel 4: K/D ratio summary per map (from CSV)
    ax = axes[1, 1]
    ks = [AGG['v25'][m]['avg_k'] if m in AGG.get('v25', {}) else 0 for m in maps]
    ds = [AGG['v25'][m]['avg_d'] if m in AGG.get('v25', {}) else 0.1 for m in maps]
    ratios = [k/d if d > 0 else k for k, d in zip(ks, ds)]
    bars = ax.bar(maps, ratios, color=colors[:len(maps)], edgecolor='white', linewidth=0.5)
    for b, v in zip(bars, ratios):
        ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.15,
                f'{v:.1f}', ha='center', va='bottom', fontsize=9, color=G700)
    ax.set_title('v25 K/D ratio per map (higher = better)',
                 loc='left', fontsize=12, color=G900, pad=8)
    ax.set_ylabel('Kills per death')
    ax.set_xticklabels([m.replace('Dodge Training ', 'DT ').replace('Custom Arena', 'CA').replace('RK Fight', 'RK') for m in maps],
                       rotation=15, ha='right', fontsize=8)
    ax.yaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    ax.set_ylim(0, max(ratios) * 1.25 if ratios else 10)
    
    plt.savefig('/home/z/my-project/download/charts/05-v25-telemetry-deep.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/05-v25-telemetry-deep.png')

# ─────────────────────────────────────────────────────────────────
#  CHART 6 — Version progression: kills trajectory per map (line)
# ─────────────────────────────────────────────────────────────────
def chart6_progression_lines():
    survival_maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
    
    fig, ax = plt.subplots(figsize=(13, 6.5))
    
    colors = {'Custom Arena': CB_SAFE[0], 'RK Fight': CB_SAFE[3], 'Dungeon': CB_SAFE[4]}
    markers = {'Custom Arena': 'o', 'RK Fight': 's', 'Dungeon': '^'}
    
    for mk in survival_maps:
        xs = []
        ys = []
        for i, v in enumerate(versions):
            if v in AGG and mk in AGG[v]:
                xs.append(i)
                ys.append(AGG[v][mk]['avg_k'])
        ax.plot(xs, ys, '-o', color=colors[mk], label=mk,
                marker=markers[mk], markersize=8, linewidth=2.2,
                markeredgecolor='white', markeredgewidth=1.5)
        # Annotate endpoint
        if ys:
            ax.text(xs[-1] + 0.1, ys[-1], f' {ys[-1]:.1f}',
                    fontsize=9, color=colors[mk], fontweight='bold', va='center')
        # Annotate v19 baseline (start)
        if ys:
            ax.text(xs[0] - 0.1, ys[0], f'{ys[0]:.1f} ',
                    fontsize=9, color=colors[mk], ha='right', va='center')
    
    ax.set_xticks(range(len(versions)))
    ax.set_xticklabels([VERSION_LABELS.get(v, v) for v in versions], rotation=20, ha='right')
    ax.set_ylabel('Average kills per trial')
    ax.set_title('Version progression — kills trajectory per survival map (v19 → v25)',
                 loc='left', color=G900, pad=18)
    ax.yaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    ax.set_xlim(-0.5, len(versions) - 0.5)
    
    # Highlight v25 (the latest, current best on RK Fight + CA)
    ax.axvspan(len(versions) - 1.5, len(versions) - 0.5, alpha=0.05, color=CB_SAFE[2], zorder=0)
    ax.text(len(versions) - 1, ax.get_ylim()[1] * 0.97,
            'current', fontsize=8, color=G500, style='italic',
            ha='center', va='top')
    
    ax.legend(loc='upper left', frameon=False, bbox_to_anchor=(0, -0.12), ncol=3)
    plt.tight_layout()
    plt.savefig('/home/z/my-project/download/charts/06-progression-trajectory.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/06-progression-trajectory.png')

# ─────────────────────────────────────────────────────────────────
#  CHART 7 — Survival rate per version per map (stacked area)
# ─────────────────────────────────────────────────────────────────
def chart7_survival_rate():
    survival_maps = ['Custom Arena', 'RK Fight', 'Dungeon']
    # Survival rate only available for v22.5+
    versions = ['v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
    
    fig, ax = plt.subplots(figsize=(12, 6))
    
    n_ver = len(versions)
    bar_w = 0.25
    x = np.arange(n_ver)
    colors = [CB_SAFE[0], CB_SAFE[3], CB_SAFE[4]]
    
    for i, mk in enumerate(survival_maps):
        survs = []
        for v in versions:
            if v in AGG and mk in AGG[v]:
                survs.append(AGG[v][mk]['surv_pct'])
            else:
                survs.append(0)
        offset = (i - 1) * bar_w
        bars = ax.bar(x + offset, survs, bar_w, label=mk, color=colors[i],
                      edgecolor='white', linewidth=0.5)
        for b, s in zip(bars, survs):
            if s > 0:
                ax.text(b.get_x() + b.get_width()/2, b.get_height() + 2,
                        f'{s:.0f}%', ha='center', va='bottom',
                        fontsize=8, color=G700)
    
    ax.set_xticks(x)
    ax.set_xticklabels([VERSION_LABELS.get(v, v) for v in versions])
    ax.set_ylabel('% of trials survived (alive at end)')
    ax.set_title('Survival rate per version per map — v22.5 → v25',
                 loc='left', color=G900, pad=18)
    ax.set_ylim(0, 115)
    ax.yaxis.grid(True, alpha=0.12, color=G300)
    ax.set_axisbelow(True)
    ax.legend(loc='upper left', bbox_to_anchor=(0, -0.10), ncol=3, frameon=False)
    
    # Highlight 100% survival
    ax.axhline(100, linestyle='--', color=G300, alpha=0.5, linewidth=1)
    ax.text(n_ver - 0.5, 102, '100% = perfect survival',
            fontsize=8, color=G500, style='italic', ha='right')
    
    plt.tight_layout()
    plt.savefig('/home/z/my-project/download/charts/07-survival-rate.png')
    plt.close()
    print('  WROTE /home/z/my-project/download/charts/07-survival-rate.png')


if __name__ == '__main__':
    print('Building MASS chart set from archived trial data...')
    print()
    print(f'Loaded {len(ALL_ROWS)} trial rows from CSVs')
    print(f'Loaded worklog-archived averages for {len(WORKLOG_AVGS)} older versions')
    print(f'Loaded v25 telemetry for {len(V25_TELEMETRY_AVG)} maps')
    print()
    chart1_version_kills()
    chart2_head_to_head()
    chart3_scatter_kd()
    chart4_dodge_training()
    chart5_v25_telemetry()
    chart6_progression_lines()
    chart7_survival_rate()
    print()
    print('DONE. 7 charts in /home/z/my-project/download/charts/')
