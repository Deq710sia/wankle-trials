#!/usr/bin/env python3
"""
v2 chart set — focused on SPECIFIC NUMERICAL DATA + EXPLICIT WINNERS
so version strengths are immediately visible.

Charts:
  A. Strength matrix — heatmap with all numbers, best-in-row highlighted
  B. Per-version profile — small-multiples radar, normalized 0-1 per metric
  C. Winner matrix — explicit "best version" per (map × metric) with values
  D. Consistency chart — min/median/max kills per version per map (range bars)
  E. K/D ratio matrix — explicit numerical K/D per version per map
  F. Dodge Training deep dive — pure dodge skill (aimbot OFF) per version
"""
import csv
import json
import os
import sys
import importlib.util
from collections import defaultdict
from statistics import mean, median, stdev

import matplotlib
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np

fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

plt.rcParams.update({
    'font.sans-serif': ['DejaVu Sans'],
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

CB_SAFE = ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377', '#BBBBBB']
G900, G700, G500, G400, G300, G200, G100, G50 = '#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB', '#F3F4F6', '#F9FAFB'

# Load data from sibling module
spec = importlib.util.spec_from_file_location('build_mass_charts', '/home/z/my-project/scripts/charts/build-mass-charts.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
AGG = mod.AGG
V25_TELEMETRY_AVG = mod.V25_TELEMETRY_AVG
VERSION_LABELS = mod.VERSION_LABELS

# Versions with FULL trial data (multi-trial CSVs) — reliable for comparison
FULL_VERSIONS = ['v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
# All versions including worklog-archived (single avg, no per-trial)
ALL_VERSIONS = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
SURVIVAL_MAPS = ['Custom Arena', 'RK Fight', 'Dungeon']
DODGE_MAPS = ['Dodge Training (off)', 'Dodge Training (on)']

# ═════════════════════════════════════════════════════════════════
# Helper: get value or None
def getk(v, m, key):
    return AGG.get(v, {}).get(m, {}).get(key)

# ═════════════════════════════════════════════════════════════════
# CHART A — Strength matrix (heatmap with numbers, winners bolded)
# Rows = (map, metric), Cols = versions, cells = values, bold = winner
# ═════════════════════════════════════════════════════════════════
def chartA_strength_matrix():
    # Use full-data versions for fair comparison
    versions = FULL_VERSIONS
    rows = [
        ('Custom Arena', 'avg_k',   'CA · Kills',    'higher_better'),
        ('Custom Arena', 'avg_d',   'CA · Deaths',   'lower_better'),
        ('Custom Arena', 'surv_pct','CA · Surv %',   'higher_better'),
        ('RK Fight',     'avg_k',   'RK · Kills',    'higher_better'),
        ('RK Fight',     'avg_d',   'RK · Deaths',   'lower_better'),
        ('RK Fight',     'surv_pct','RK · Surv %',   'higher_better'),
        ('Dungeon',      'avg_k',   'Dun · Kills',   'higher_better'),
        ('Dungeon',      'avg_d',   'Dun · Deaths',  'lower_better'),
        ('Dungeon',      'surv_pct','Dun · Surv %',  'higher_better'),
        ('Dodge Training (off)', 'avg_k', 'DT-off · Kills', 'higher_better'),
        ('Dodge Training (off)', 'avg_d', 'DT-off · Deaths','lower_better'),
        ('Dodge Training (on)',  'avg_k', 'DT-on · Kills',  'higher_better'),
        ('Dodge Training (on)',  'avg_d', 'DT-on · Deaths', 'lower_better'),
    ]
    
    fig, ax = plt.subplots(figsize=(14, 10))
    ax.set_axis_off()
    
    n_rows = len(rows)
    n_cols = len(versions)
    
    # Build data matrix
    matrix = np.zeros((n_rows, n_cols))
    raw_vals = [[None]*n_cols for _ in range(n_rows)]
    winners = [None]*n_rows  # index of winning version per row
    
    for ri, (mk, key, _, direction) in enumerate(rows):
        vals = []
        for ci, v in enumerate(versions):
            val = getk(v, mk, key)
            raw_vals[ri][ci] = val
            vals.append(val if val is not None else (0 if direction == 'higher_better' else 9999))
        if direction == 'higher_better':
            winners[ri] = vals.index(max(vals))
        else:
            winners[ri] = vals.index(min(vals))
        # For heatmap color, normalize: deaths are inverted (lower = greener)
        if direction == 'higher_better':
            matrix[ri] = vals
        else:
            # Invert deaths for color: lower death = higher number = greener
            max_v = max(vals) if max(vals) > 0 else 1
            matrix[ri] = [max_v - v for v in vals]
    
    # Draw table
    cell_w, cell_h = 1.0, 1.0
    for ri, (mk, key, label, direction) in enumerate(rows):
        # Row label
        ax.text(-0.4, n_rows - 1 - ri, label, ha='right', va='center',
                fontsize=10, color=G900, fontweight='bold')
        for ci, v in enumerate(versions):
            val = raw_vals[ri][ci]
            is_winner = (ci == winners[ri])
            # Cell color: green for good, red for bad — based on direction
            if val is None:
                color = G100
                text = '—'
            else:
                if direction == 'higher_better':
                    # Normalize within row
                    row_max = max(v for v in raw_vals[ri] if v is not None)
                    ratio = val / row_max if row_max > 0 else 0
                else:
                    row_min = min(v for v in raw_vals[ri] if v is not None)
                    row_max = max(v for v in raw_vals[ri] if v is not None)
                    ratio = 1 - (val - row_min) / (row_max - row_min) if row_max > row_min else 0.5
                # Color: red(0) → yellow(0.5) → green(1)
                if ratio > 0.66:
                    color = '#D1FAE5'  # mint
                elif ratio > 0.33:
                    color = '#FEF3C7'  # light amber
                else:
                    color = '#FEE2E2'  # light red
                if key == 'surv_pct':
                    text = f'{val:.0f}%'
                elif key == 'avg_d':
                    text = f'{val:.1f}'
                else:
                    text = f'{val:.1f}'
            
            # Draw cell rect
            rect = plt.Rectangle((ci, n_rows - 1 - ri), 1, 1,
                                  facecolor=color, edgecolor='white', linewidth=2)
            ax.add_patch(rect)
            
            # Value text
            ax.text(ci + 0.5, n_rows - 1 - ri + 0.5, text,
                    ha='center', va='center', fontsize=11,
                    color=G900 if is_winner else G700,
                    fontweight='bold' if is_winner else 'normal')
            
            # Winner crown
            if is_winner:
                ax.text(ci + 0.92, n_rows - 1 - ri + 0.08, '★',
                        ha='right', va='top', fontsize=12, color=CB_SAFE[3])
    
    # Column headers
    for ci, v in enumerate(versions):
        ax.text(ci + 0.5, n_rows + 0.3, VERSION_LABELS.get(v, v),
                ha='center', va='bottom', fontsize=12, fontweight='bold', color=G900)
    
    ax.set_xlim(-0.5, n_cols + 0.5)
    ax.set_ylim(-0.5, n_rows + 0.8)
    ax.set_aspect('equal')
    
    # Title and legend
    fig.suptitle('Version strength matrix — every metric, every map (★ = best in row)',
                 fontsize=15, fontweight='bold', color=G900, y=0.96, x=0.5)
    fig.text(0.5, 0.02,
             'Color: green=best in row, amber=middle, red=worst.   '
             'Pre-v22.5 excluded (single-trial averages, not comparable).   '
             'Dodge Training has no survival metric (campaign mode, 72 enemies, infinite respawns).',
             ha='center', fontsize=9, color=G500, style='italic')
    
    plt.savefig('/home/z/my-project/download/charts/A-strength-matrix.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE A-strength-matrix.png')

# ═════════════════════════════════════════════════════════════════
# CHART B — Per-version profile (small-multiples radar)
# ═════════════════════════════════════════════════════════════════
def chartB_per_version_radar():
    """Each version gets its own radar showing normalized performance on 6 metrics."""
    versions = FULL_VERSIONS
    metrics = [
        ('CA kills',     'Custom Arena',     'avg_k',    'higher'),
        ('RK kills',     'RK Fight',         'avg_k',    'higher'),
        ('Dun kills',    'Dungeon',          'avg_k',    'higher'),
        ('CA survival',  'Custom Arena',     'surv_pct', 'higher'),
        ('RK survival',  'RK Fight',         'surv_pct', 'higher'),
        ('Dun survival', 'Dungeon',          'surv_pct', 'higher'),
        ('DT-on kills',  'Dodge Training (on)', 'avg_k', 'higher'),
    ]
    
    # Find max per metric for normalization
    maxes = []
    for label, mk, key, _ in metrics:
        vals = [getk(v, mk, key) or 0 for v in versions]
        maxes.append(max(vals) if vals else 1)
    
    fig, axes = plt.subplots(2, 3, figsize=(15, 10), subplot_kw=dict(polar=True),
                             constrained_layout=True)
    fig.suptitle('Per-version strength profile (normalized 0-1, each axis = best across all versions = 1.0)',
                 fontsize=14, fontweight='bold', color=G900, y=1.03)
    
    angles = np.linspace(0, 2 * np.pi, len(metrics), endpoint=False).tolist()
    angles += angles[:1]  # close the loop
    
    colors = CB_SAFE[:len(versions)]
    
    for idx, v in enumerate(versions):
        ax = axes[idx // 3, idx % 3]
        # Normalized values
        vals = []
        for i, (label, mk, key, _) in enumerate(metrics):
            raw = getk(v, mk, key) or 0
            vals.append(raw / maxes[i] if maxes[i] > 0 else 0)
        vals += vals[:1]
        
        ax.fill(angles, vals, alpha=0.25, color=colors[idx])
        ax.plot(angles, vals, color=colors[idx], linewidth=2.2)
        
        # Metric labels
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels([m[0] for m in metrics], fontsize=8)
        ax.set_ylim(0, 1.05)
        ax.set_yticks([0.25, 0.5, 0.75, 1.0])
        ax.set_yticklabels(['', '', '', ''], fontsize=7)
        ax.tick_params(pad=2)
        ax.set_title(VERSION_LABELS.get(v, v), fontsize=13, color=colors[idx],
                     fontweight='bold', pad=12)
        
        # Add raw values as text overlay (top-right corner)
        info_lines = []
        for i, (label, mk, key, _) in enumerate(metrics):
            raw = getk(v, mk, key)
            if raw is not None:
                if key == 'surv_pct':
                    info_lines.append(f'{label}: {raw:.0f}%')
                else:
                    info_lines.append(f'{label}: {raw:.1f}')
        # Print 3-4 key stats below title
        ax.text(0, -1.45, '\n'.join(info_lines[:4]),
                ha='center', va='top', fontsize=8, color=G700,
                transform=ax.transData)
    
    plt.savefig('/home/z/my-project/download/charts/B-per-version-radar.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE B-per-version-radar.png')

# ═════════════════════════════════════════════════════════════════
# CHART C — Winner matrix (which version wins each combo)
# ═════════════════════════════════════════════════════════════════
def chartC_winner_matrix():
    """For each (map × metric), find the winning version + value."""
    versions = FULL_VERSIONS
    metrics = [
        ('avg_k',    'Avg kills',    'higher_better', '{:.1f}'),
        ('avg_d',    'Avg deaths',   'lower_better',  '{:.1f}'),
        ('med_k',    'Median kills', 'higher_better', '{:.1f}'),
        ('max_k',    'Max kills',    'higher_better', '{:.0f}'),
        ('surv_pct', 'Survival %',   'higher_better', '{:.0f}%'),
    ]
    maps = SURVIVAL_MAPS + DODGE_MAPS
    
    fig, ax = plt.subplots(figsize=(13, 7))
    ax.set_axis_off()
    
    n_rows = len(maps) * len(metrics)
    n_cols = len(versions)
    
    # Build winner data
    winners_data = []  # list of (map, metric, winner_version, winner_value, all_values)
    for mk in maps:
        for key, mlabel, direction, fmt in metrics:
            # Skip survival for dodge training
            if mk in DODGE_MAPS and key == 'surv_pct':
                continue
            vals = [(v, getk(v, mk, key)) for v in versions]
            valid = [(v, val) for v, val in vals if val is not None]
            if not valid: continue
            if direction == 'higher_better':
                winner = max(valid, key=lambda x: x[1])
            else:
                winner = min(valid, key=lambda x: x[1])
            winners_data.append((mk, mlabel, direction, fmt, winner, valid))
    
    n_rows = len(winners_data)
    
    for ri, (mk, mlabel, direction, fmt, winner, valid) in enumerate(winners_data):
        y_pos = n_rows - 1 - ri
        # Row label
        ax.text(-0.05, y_pos + 0.5, f'{mk} · {mlabel}',
                ha='right', va='center', fontsize=10, color=G900, fontweight='bold')
        # Cells
        for ci, (v, val) in enumerate(valid):
            is_winner = (v == winner[0])
            if is_winner:
                color = '#D1FAE5'
                text_color = G900
                weight = 'bold'
            else:
                # Compare to winner
                if direction == 'higher_better':
                    ratio = (val / winner[1]) if winner[1] > 0 else 0
                else:
                    ratio = (winner[1] / val) if val > 0 else 0
                if ratio > 0.85:
                    color = '#FEF3C7'
                else:
                    color = '#FEE2E2'
                text_color = G700
                weight = 'normal'
            
            rect = plt.Rectangle((ci, y_pos), 1, 1,
                                  facecolor=color, edgecolor='white', linewidth=2)
            ax.add_patch(rect)
            text = fmt.format(val)
            ax.text(ci + 0.5, y_pos + 0.5, text,
                    ha='center', va='center', fontsize=11,
                    color=text_color, fontweight=weight)
            if is_winner:
                ax.text(ci + 0.92, y_pos + 0.92, '★',
                        ha='right', va='top', fontsize=13, color=CB_SAFE[3])
    
    # Column headers
    for ci, v in enumerate(versions):
        ax.text(ci + 0.5, n_rows + 0.3, VERSION_LABELS.get(v, v),
                ha='center', va='bottom', fontsize=12, fontweight='bold', color=G900)
    
    ax.set_xlim(-0.05, n_cols + 0.05)
    ax.set_ylim(-0.5, n_rows + 0.8)
    ax.set_aspect('equal')
    
    fig.suptitle('Winner matrix — explicit best version per (map × metric)',
                 fontsize=15, fontweight='bold', color=G900, y=0.98, x=0.55)
    fig.text(0.5, 0.02,
             '★ = winner (best in row).   '
             'Green = winner, amber = within 15% of winner, red = >15% below.   '
             'Survival % omitted for Dodge Training (campaign mode).',
             ha='center', fontsize=9, color=G500, style='italic')
    
    plt.savefig('/home/z/my-project/download/charts/C-winner-matrix.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE C-winner-matrix.png')

# ═════════════════════════════════════════════════════════════════
# CHART D — Consistency: min/median/max kills per version per map
# ═════════════════════════════════════════════════════════════════
def chartD_consistency():
    versions = FULL_VERSIONS
    
    fig, axes = plt.subplots(1, 3, figsize=(16, 6), constrained_layout=True)
    fig.suptitle('Per-trial consistency — min / median / max kills per version per map',
                 fontsize=14, fontweight='bold', color=G900, y=1.04)
    
    for ax, mk in zip(axes, SURVIVAL_MAPS):
        # For each version, plot min/median/max as range bars
        valid_vs = [v for v in versions if v in AGG and mk in AGG[v] and AGG[v][mk]['trials']]
        if not valid_vs:
            ax.text(0.5, 0.5, 'No data', transform=ax.transAxes, ha='center')
            continue
        
        x = np.arange(len(valid_vs))
        mins = [AGG[v][mk]['min_k'] for v in valid_vs]
        meds = [AGG[v][mk]['med_k'] for v in valid_vs]
        maxs = [AGG[v][mk]['max_k'] for v in valid_vs]
        avgs = [AGG[v][mk]['avg_k'] for v in valid_vs]
        
        # Draw range bar (min to max)
        for i in range(len(valid_vs)):
            ax.plot([x[i], x[i]], [mins[i], maxs[i]], color=G400, linewidth=2, zorder=1)
            # Min marker (downward triangle)
            ax.scatter(x[i], mins[i], marker='v', s=60, color=CB_SAFE[4], zorder=3, edgecolors='white', linewidths=1)
            # Max marker (upward triangle)
            ax.scatter(x[i], maxs[i], marker='^', s=60, color=CB_SAFE[2], zorder=3, edgecolors='white', linewidths=1)
            # Median marker (large dot)
            ax.scatter(x[i], meds[i], marker='o', s=110, color=CB_SAFE[0], zorder=4, edgecolors='white', linewidths=1.5)
            # Avg marker (X)
            ax.scatter(x[i], avgs[i], marker='x', s=80, color=G900, zorder=5, linewidths=2)
            # Value labels
            ax.text(x[i] + 0.15, maxs[i], f'{maxs[i]:.0f}', fontsize=8, color=CB_SAFE[2], va='center')
            ax.text(x[i] + 0.15, mins[i], f'{mins[i]:.0f}', fontsize=8, color=CB_SAFE[4], va='center')
            ax.text(x[i] + 0.15, meds[i], f'{meds[i]:.0f}', fontsize=8, color=CB_SAFE[0], va='center', fontweight='bold')
        
        ax.set_xticks(x)
        ax.set_xticklabels([VERSION_LABELS.get(v, v) for v in valid_vs], rotation=15, ha='right', fontsize=9)
        ax.set_title(mk, loc='left', fontsize=12, color=G900, pad=8)
        ax.set_ylabel('Kills per trial')
        ax.yaxis.grid(True, alpha=0.12, color=G300); ax.set_axisbelow(True)
        # Legend (only on first subplot)
        if mk == 'Custom Arena':
            from matplotlib.lines import Line2D
            legend_elements = [
                Line2D([0], [0], marker='^', color='w', markerfacecolor=CB_SAFE[2], markersize=8, label='Max'),
                Line2D([0], [0], marker='o', color='w', markerfacecolor=CB_SAFE[0], markersize=10, label='Median'),
                Line2D([0], [0], marker='x', color=G900, markersize=8, label='Mean', linewidth=2),
                Line2D([0], [0], marker='v', color='w', markerfacecolor=CB_SAFE[4], markersize=8, label='Min'),
            ]
            ax.legend(handles=legend_elements, loc='upper left', frameon=False, fontsize=8, bbox_to_anchor=(0, -0.18), ncol=4)
    
    plt.savefig('/home/z/my-project/download/charts/D-consistency.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE D-consistency.png')

# ═════════════════════════════════════════════════════════════════
# CHART E — K/D ratio matrix (explicit numerical)
# ═════════════════════════════════════════════════════════════════
def chartE_kd_ratio():
    versions = FULL_VERSIONS
    maps = SURVIVAL_MAPS + DODGE_MAPS
    
    fig, ax = plt.subplots(figsize=(13, 6))
    
    n_v = len(versions)
    bar_w = 0.15
    x = np.arange(len(maps))
    colors = CB_SAFE[:n_v]
    
    for i, v in enumerate(versions):
        ratios = []
        for mk in maps:
            k = getk(v, mk, 'avg_k')
            d = getk(v, mk, 'avg_d')
            if k is None or d is None or d == 0:
                ratios.append(k if k else 0)  # if 0 deaths, K/D = K (capped)
            else:
                ratios.append(k / d)
        offset = (i - (n_v-1)/2) * bar_w
        bars = ax.bar(x + offset, ratios, bar_w, label=VERSION_LABELS.get(v, v),
                      color=colors[i], edgecolor='white', linewidth=0.5)
        # Value labels
        for b, r in zip(bars, ratios):
            if r > 0:
                ax.text(b.get_x() + b.get_width()/2, b.get_height() + 0.3,
                        f'{r:.1f}', ha='center', va='bottom', fontsize=8, color=G700)
    
    ax.set_xticks(x)
    ax.set_xticklabels([m.replace('Dodge Training ', 'DT\n').replace('Custom Arena', 'CA').replace('RK Fight', 'RK') for m in maps])
    ax.set_ylabel('Kills per death (higher = better)')
    ax.set_title('K/D ratio per version per map — explicit numerical comparison',
                 loc='left', color=G900, pad=14)
    ax.yaxis.grid(True, alpha=0.12, color=G300); ax.set_axisbelow(True)
    
    # Find and highlight best version per map
    for mi, mk in enumerate(maps):
        best_v = None; best_r = 0
        for v in versions:
            k = getk(v, mk, 'avg_k'); d = getk(v, mk, 'avg_d')
            r = (k/d if d and d > 0 else (k or 0)) if k else 0
            if r > best_r:
                best_r = r; best_v = v
        if best_v:
            ax.text(mi, -1.5, f'★ {VERSION_LABELS.get(best_v, best_v)}\n  ({best_r:.1f})',
                    ha='center', va='top', fontsize=9, color=CB_SAFE[3], fontweight='bold')
    
    ax.set_ylim(0, max(ratios) * 1.20)
    ax.legend(loc='upper right', frameon=False, ncol=2)
    
    plt.tight_layout()
    plt.savefig('/home/z/my-project/download/charts/E-kd-ratio.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE E-kd-ratio.png')

# ═════════════════════════════════════════════════════════════════
# CHART F — Final summary: explicit text table with all numbers + winners
# ═════════════════════════════════════════════════════════════════
def chartF_summary_table():
    versions = FULL_VERSIONS
    
    fig, ax = plt.subplots(figsize=(14, 9))
    ax.set_axis_off()
    
    # Build table data
    maps_with_metrics = []
    for mk in SURVIVAL_MAPS + DODGE_MAPS:
        maps_with_metrics.append((mk, 'avg_k', 'Kills', '{:.1f}', 'higher_better'))
        maps_with_metrics.append((mk, 'avg_d', 'Deaths', '{:.1f}', 'lower_better'))
        if mk in SURVIVAL_MAPS:
            maps_with_metrics.append((mk, 'surv_pct', 'Surv %', '{:.0f}%', 'higher_better'))
            maps_with_metrics.append((mk, 'med_k', 'Med K', '{:.1f}', 'higher_better'))
    
    n_rows = len(maps_with_metrics)
    n_cols = len(versions) + 1  # +1 for label
    
    # Compute winners per row
    winners = []
    for ri, (mk, key, label, fmt, direction) in enumerate(maps_with_metrics):
        vals = []
        for v in versions:
            val = getk(v, mk, key)
            vals.append(val)
        valid = [(v, val) for v, val in zip(versions, vals) if val is not None]
        if not valid:
            winners.append(None); continue
        if direction == 'higher_better':
            winner = max(valid, key=lambda x: x[1])[0]
        else:
            winner = min(valid, key=lambda x: x[1])[0]
        winners.append(winner)
    
    # Draw table
    cell_h = 1.0
    cell_w = 1.6
    
    # Column headers
    ax.text(0, n_rows + 0.4, 'Metric', ha='left', va='bottom',
            fontsize=11, fontweight='bold', color=G900)
    for ci, v in enumerate(versions):
        ax.text(ci + 1.5, n_rows + 0.4, VERSION_LABELS.get(v, v),
                ha='center', va='bottom', fontsize=11, fontweight='bold', color=G900)
    
    # Find best version overall (count of wins)
    win_counts = defaultdict(int)
    for w in winners:
        if w: win_counts[w] += 1
    
    # Sort versions by win count for ranking
    rankings = sorted(versions, key=lambda v: -win_counts[v])
    
    # Add ranking row
    rank_y = n_rows + 1.5
    ax.text(0, rank_y, 'WINS (out of {}):'.format(n_rows), ha='left', va='center',
            fontsize=10, fontweight='bold', color=G900)
    for ci, v in enumerate(versions):
        rank = rankings.index(v) + 1
        ax.text(ci + 1.5, rank_y, f'#{rank}: {win_counts[v]}',
                ha='center', va='center', fontsize=11,
                color=G900 if rank == 1 else G700,
                fontweight='bold' if rank == 1 else 'normal')
    
    # Data rows
    for ri, (mk, key, label, fmt, direction) in enumerate(maps_with_metrics):
        y = n_rows - 1 - ri
        # Row label
        display_label = f'{mk.replace("Dodge Training ", "DT ").replace("Custom Arena", "CA").replace("RK Fight", "RK")} · {label}'
        ax.text(0, y + 0.5, display_label,
                ha='left', va='center', fontsize=10, color=G900)
        
        for ci, v in enumerate(versions):
            val = getk(v, mk, key)
            is_winner = (v == winners[ri])
            if val is None:
                text = '—'
                color = G100
                text_color = G400
                weight = 'normal'
            else:
                text = fmt.format(val)
                if is_winner:
                    color = '#D1FAE5'
                    text_color = G900
                    weight = 'bold'
                else:
                    # Compare to winner
                    winner_val = getk(winners[ri], mk, key)
                    if direction == 'higher_better':
                        ratio = val / winner_val if winner_val else 0
                    else:
                        ratio = winner_val / val if val else 0
                    if ratio > 0.85:
                        color = '#FEF3C7'
                    else:
                        color = '#FEE2E2'
                    text_color = G700
                    weight = 'normal'
            
            rect = plt.Rectangle((ci + 1, y), 1, 1,
                                  facecolor=color, edgecolor='white', linewidth=2)
            ax.add_patch(rect)
            ax.text(ci + 1.5, y + 0.5, text,
                    ha='center', va='center', fontsize=11,
                    color=text_color, fontweight=weight)
            if is_winner:
                ax.text(ci + 1.92, y + 0.92, '★',
                        ha='right', va='top', fontsize=13, color=CB_SAFE[3])
    
    ax.set_xlim(-0.5, n_cols + 0.5)
    ax.set_ylim(-0.5, n_rows + 2.5)
    
    fig.suptitle('Final strength summary — all versions × all metrics (★ = best in row)',
                 fontsize=15, fontweight='bold', color=G900, y=0.96)
    fig.text(0.5, 0.02,
             'Lower section: total wins per version (out of {} metrics). '
             'Higher wins = more strengths.  Pre-v22.5 excluded for fairness (single-trial data).'.format(n_rows),
             ha='center', fontsize=9, color=G500, style='italic')
    
    plt.savefig('/home/z/my-project/download/charts/F-summary-table.png', dpi=200, bbox_inches='tight')
    plt.close()
    print('  WROTE F-summary-table.png')
    return win_counts

# ═════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    print('Building v2 chart set (numerical data + explicit winners)...')
    print()
    chartA_strength_matrix()
    chartB_per_version_radar()
    chartC_winner_matrix()
    chartD_consistency()
    chartE_kd_ratio()
    win_counts = chartF_summary_table()
    print()
    print('=== WIN COUNT SUMMARY ===')
    for v in sorted(win_counts.keys(), key=lambda x: -win_counts[x]):
        print(f'  {VERSION_LABELS.get(v, v):8s}: {win_counts[v]} wins')
    print()
    print('DONE. 6 charts (A-F) in /home/z/my-project/download/charts/')
