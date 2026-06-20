#!/usr/bin/env python3
"""
Build a single MASS dashboard PNG combining the key insights from all data.
This is the 'executive summary' chart — every panel tells a piece of the story.
"""
import matplotlib
import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
from collections import defaultdict
from statistics import mean, median

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
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'axes.labelsize': 10,
    'axes.titlesize': 12,
    'axes.titleweight': 'bold',
    'axes.titlepad': 10,
    'legend.frameon': False,
    'legend.fontsize': 8,
})

CB_SAFE = ['#0077BB', '#33BBEE', '#009988', '#EE7733', '#CC3311', '#EE3377', '#BBBBBB']
G900, G700, G500, G400, G300, G200, G100 = '#111827', '#374151', '#6B7280', '#9CA3AF', '#D1D5DB', '#E5E7EB', '#F3F4F6'

# Re-import data logic from sibling module (file has hyphen → use importlib)
import sys, importlib.util
sys.path.insert(0, '/home/z/my-project/scripts/charts')
spec = importlib.util.spec_from_file_location('build_mass_charts', '/home/z/my-project/scripts/charts/build-mass-charts.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
AGG = mod.AGG
V25_TELEMETRY_AVG = mod.V25_TELEMETRY_AVG
VERSION_LABELS = mod.VERSION_LABELS

# ─────────────────────────────────────────────────────────────────
# Build MASS dashboard
# ─────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(20, 14))
gs = gridspec.GridSpec(3, 4, figure=fig, hspace=0.45, wspace=0.32,
                       left=0.05, right=0.97, top=0.94, bottom=0.06)

fig.suptitle('Wankle3D Cheat — MASS Dashboard (v19 → v25)',
             fontsize=20, fontweight='bold', color=G900, y=0.985)
fig.text(0.5, 0.955,
         'All archived trial data: 6 versions × 5 maps × ~5 trials each (90s survival/campaign)',
         ha='center', fontsize=11, color=G500, style='italic')

# ── Panel 1 (top-left, spans 2 cols): Version kills trajectory (line chart) ──
ax1 = fig.add_subplot(gs[0, 0:2])
survival_maps = ['Custom Arena', 'RK Fight', 'Dungeon']
versions = ['v19', 'v21.7', 'v22.0', 'v22.2', 'v22.3', 'v22.4', 'v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
colors = {'Custom Arena': CB_SAFE[0], 'RK Fight': CB_SAFE[3], 'Dungeon': CB_SAFE[4]}
markers = {'Custom Arena': 'o', 'RK Fight': 's', 'Dungeon': '^'}
for mk in survival_maps:
    xs, ys = [], []
    for i, v in enumerate(versions):
        if v in AGG and mk in AGG[v]:
            xs.append(i); ys.append(AGG[v][mk]['avg_k'])
    ax1.plot(xs, ys, marker=markers[mk], color=colors[mk], label=mk,
             markersize=7, linewidth=2.0, markeredgecolor='white', markeredgewidth=1.3)
    if ys:
        ax1.text(xs[-1] + 0.1, ys[-1], f' {ys[-1]:.1f}',
                 fontsize=8, color=colors[mk], fontweight='bold', va='center')
ax1.set_xticks(range(len(versions)))
ax1.set_xticklabels([VERSION_LABELS.get(v, v) for v in versions], rotation=20, ha='right', fontsize=8)
ax1.set_ylabel('Avg kills per trial')
ax1.set_title('① Version progression — kills per survival map',
              loc='left', color=G900)
ax1.yaxis.grid(True, alpha=0.12, color=G300); ax1.set_axisbelow(True)
ax1.set_xlim(-0.5, len(versions) - 0.5)
ax1.legend(loc='lower right', frameon=False, ncol=1)

# ── Panel 2 (top-right, spans 2 cols): v25 vs v24 head-to-head (grouped bars) ──
ax2 = fig.add_subplot(gs[0, 2:4])
maps_h2h = ['Custom Arena', 'RK Fight', 'Dungeon', 'Dodge Training (on)']
x = np.arange(len(maps_h2h))
bar_w = 0.35
v24_ks = [AGG['v24'][m]['avg_k'] if 'v24' in AGG and m in AGG['v24'] else 0 for m in maps_h2h]
v25_ks = [AGG['v25'][m]['avg_k'] if 'v25' in AGG and m in AGG['v25'] else 0 for m in maps_h2h]
b1 = ax2.bar(x - bar_w/2, v24_ks, bar_w, label='v24', color=G400, edgecolor='white', linewidth=0.5)
b2 = ax2.bar(x + bar_w/2, v25_ks, bar_w, label='v25', color=CB_SAFE[0], edgecolor='white', linewidth=0.5)
for bars, vals in [(b1, v24_ks), (b2, v25_ks)]:
    for b, v in zip(bars, vals):
        if v > 0:
            ax2.text(b.get_x() + b.get_width()/2, b.get_height() + 0.5,
                     f'{v:.1f}', ha='center', va='bottom', fontsize=8, color=G700)
ax2.set_xticks(x); ax2.set_xticklabels([m.replace('Dodge Training ', 'DT\n').replace('Custom Arena', 'CA').replace('RK Fight', 'RK') for m in maps_h2h], fontsize=8)
ax2.set_ylabel('Avg kills per trial')
ax2.set_title('② v25 vs v24 — kills per map (head-to-head)', loc='left', color=G900)
ax2.yaxis.grid(True, alpha=0.12, color=G300); ax2.set_axisbelow(True)
ax2.set_ylim(0, max(v24_ks + v25_ks) * 1.25)
ax2.legend(loc='upper left', frameon=False)

# ── Panel 3 (mid-left): Survival rate per version (heatmap-like) ──
ax3 = fig.add_subplot(gs[1, 0:2])
versions_surv = ['v22.5', 'v22.6', 'v22.8', 'v23', 'v24', 'v25']
# Heatmap of survival rate: rows = versions, cols = maps
data = np.zeros((len(versions_surv), len(survival_maps)))
for i, v in enumerate(versions_surv):
    for j, m in enumerate(survival_maps):
        if v in AGG and m in AGG[v]:
            data[i, j] = AGG[v][m]['surv_pct']
        else:
            data[i, j] = 0
im = ax3.imshow(data, cmap='RdYlGn', vmin=0, vmax=100, aspect='auto')
ax3.set_xticks(range(len(survival_maps)))
ax3.set_xticklabels(survival_maps, fontsize=9)
ax3.set_yticks(range(len(versions_surv)))
ax3.set_yticklabels([VERSION_LABELS.get(v, v) for v in versions_surv])
# Add value text
for i in range(len(versions_surv)):
    for j in range(len(survival_maps)):
        val = data[i, j]
        color = 'white' if val < 50 or val > 80 else G900
        ax3.text(j, i, f'{val:.0f}%', ha='center', va='center',
                 color=color, fontsize=10, fontweight='bold')
ax3.set_title('③ Survival rate heatmap (v22.5 → v25)', loc='left', color=G900)
# Hide spines
for s in ax3.spines.values(): s.set_visible(False)

# ── Panel 4 (mid-right): v25 telemetry — dodge engagement per map ──
ax4 = fig.add_subplot(gs[1, 2:4])
if V25_TELEMETRY_AVG:
    map_order = ['Custom Arena', 'RK Fight', 'Dungeon', 'Dodge Training (off)', 'Dodge Training (on)']
    maps_present = [m for m in map_order if m in V25_TELEMETRY_AVG]
    dodge_pct = [V25_TELEMETRY_AVG[m]['dodge_active_pct'] for m in maps_present]
    guard_pct = [V25_TELEMETRY_AVG[m]['path_guard_crosses_pct'] for m in maps_present]
    y = np.arange(len(maps_present))
    bar_h = 0.35
    ax4.barh(y + bar_h/2, dodge_pct, bar_h, label='Dodge active %', color=CB_SAFE[0], edgecolor='white', linewidth=0.5)
    ax4.barh(y - bar_h/2, guard_pct, bar_h, label='Path-guard triggered %', color=CB_SAFE[3], edgecolor='white', linewidth=0.5)
    ax4.set_yticks(y)
    ax4.set_yticklabels([m.replace('Dodge Training ', 'DT ').replace('Custom Arena', 'CA').replace('RK Fight', 'RK') for m in maps_present])
    ax4.set_xlabel('% of frames')
    ax4.set_title('④ v25 dodge telemetry — system engagement per map', loc='left', color=G900)
    ax4.xaxis.grid(True, alpha=0.12, color=G300); ax4.set_axisbelow(True)
    ax4.set_xlim(0, 110)
    ax4.legend(loc='lower right', frameon=False)
else:
    ax4.text(0.5, 0.5, 'No v25 telemetry', transform=ax4.transAxes, ha='center')

# ── Panel 5 (bottom-left): Per-trial K/D scatter — v25 only ──
ax5 = fig.add_subplot(gs[2, 0:2])
v25_versions = ['v23', 'v24', 'v25']
for v in v25_versions:
    if v not in AGG: continue
    color = {'v23': CB_SAFE[3], 'v24': CB_SAFE[4], 'v25': CB_SAFE[0]}[v]
    all_ks = []
    all_ds = []
    for mk in ['Custom Arena', 'RK Fight', 'Dungeon']:
        if mk in AGG[v]:
            for t in AGG[v][mk]['trials']:
                all_ks.append(t['kills'])
                all_ds.append(t['deaths'])
    rng = np.random.default_rng(42)
    jx = rng.uniform(-0.18, 0.18, len(all_ks))
    jy = rng.uniform(-0.18, 0.18, len(all_ks))
    ax5.scatter([d + jy[i] for i, d in enumerate(all_ds)],
                [k + jx[i] for i, k in enumerate(all_ks)],
                s=60, alpha=0.7, color=color, label=v,
                edgecolors='white', linewidths=0.8)
ax5.set_xlabel('Deaths per trial')
ax5.set_ylabel('Kills per trial')
ax5.set_title('⑤ Per-trial scatter — v23 vs v24 vs v25 (all survival maps)',
              loc='left', color=G900)
ax5.yaxis.grid(True, alpha=0.12, color=G300); ax5.xaxis.grid(True, alpha=0.12, color=G300)
ax5.set_axisbelow(True)
ax5.axvspan(-0.5, 0.5, alpha=0.05, color=CB_SAFE[2], zorder=0)
ax5.text(0, ax5.get_ylim()[1] * 0.9 if ax5.get_ylim()[1] > 0 else 20,
         '  0-death trials\n  (perfect survival)',
         fontsize=8, color=G500, style='italic', va='top')
ax5.legend(loc='lower right', frameon=False)

# ── Panel 6 (bottom-right): v25 Dodge Training — OFF vs ON comparison ──
ax6 = fig.add_subplot(gs[2, 2:4])
v25_off = AGG.get('v25', {}).get('Dodge Training (off)', {})
v25_on = AGG.get('v25', {}).get('Dodge Training (on)', {})
v24_off = AGG.get('v24', {}).get('Dodge Training (off)', {})
v24_on = AGG.get('v24', {}).get('Dodge Training (on)', {})

groups = ['v24 (off)', 'v24 (on)', 'v25 (off)', 'v25 (on)']
kills = [v24_off.get('avg_k', 0), v24_on.get('avg_k', 0),
         v25_off.get('avg_k', 0), v25_on.get('avg_k', 0)]
deaths = [v24_off.get('avg_d', 0), v24_on.get('avg_d', 0),
          v25_off.get('avg_d', 0), v25_on.get('avg_d', 0)]
x = np.arange(len(groups))
bar_w = 0.38
b1 = ax6.bar(x - bar_w/2, kills, bar_w, label='Kills', color=CB_SAFE[0], edgecolor='white', linewidth=0.5)
b2 = ax6.bar(x + bar_w/2, deaths, bar_w, label='Deaths', color=CB_SAFE[4], edgecolor='white', linewidth=0.5)
for bars, vals in [(b1, kills), (b2, deaths)]:
    for b, v in zip(bars, vals):
        if v > 0:
            ax6.text(b.get_x() + b.get_width()/2, b.get_height() + 0.5,
                     f'{v:.1f}', ha='center', va='bottom', fontsize=8, color=G700)
ax6.set_xticks(x); ax6.set_xticklabels(groups, fontsize=9)
ax6.set_ylabel('Per 90s trial (72 enemies)')
ax6.set_title('⑥ Dodge Training — aimbot OFF vs ON (pure dodge vs realistic)',
              loc='left', color=G900)
ax6.yaxis.grid(True, alpha=0.12, color=G300); ax6.set_axisbelow(True)
ax6.set_ylim(0, max(kills + deaths) * 1.25)
ax6.legend(loc='upper left', frameon=False)

# Footer
fig.text(0.5, 0.015,
         'Sources: per-version CSVs (v22.5 → v25) + worklog-archived averages (v19 → v22.4) + v25 JSONL telemetry. '
         'Pre-v22.5 averages are single observations; v22.5+ are 5-trial means.',
         ha='center', fontsize=9, color=G500, style='italic')

out = '/home/z/my-project/download/charts/00-MASS-dashboard.png'
plt.savefig(out, dpi=180)
print(f'WROTE {out}')
