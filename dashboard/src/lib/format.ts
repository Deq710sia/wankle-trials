// Small client-side formatting + UI helpers shared across the dashboard.

export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number): string {
  return n.toLocaleString();
}

export function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function fmtRelative(iso: string | number): string {
  const ts = typeof iso === 'string' ? new Date(iso).getTime() : iso * 1000;
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ASCII progress bar builder
export function progressBar(done: number, total: number, width = 20): string {
  if (total <= 0) return `[${'░'.repeat(width)}] 0/${total}`;
  const pct = Math.min(1, Math.max(0, done / total));
  const filled = Math.round(pct * width);
  const bar =
    '█'.repeat(filled) +
    (filled < width && pct > filled / width ? '▓' : '') +
    '░'.repeat(Math.max(0, width - filled - (filled < width && pct > filled / width ? 1 : 0)));
  return `[${bar}] ${done}/${total}`;
}

// Map map-id prefixes to friendly names (matches the wankle maps).
const MAP_NAMES: Record<string, string> = {
  'custom-c2738ec4-135': 'CA (Combat Arena)',
  'custom-a6b7c90f-813': 'RK Fight Survival',
  'custom-c69c5ff7-f4e': 'Dungeon',
  'custom-4a2d5e8b-777': 'DT-off (DeathTrap)',
  'custom-9f3c1d6b-221': 'DT-on (DeathTrap)',
};

export function mapName(levelId: string): string {
  return MAP_NAMES[levelId] || levelId.slice(0, 16);
}

export function shortMap(levelId: string): string {
  if (levelId.startsWith('custom-c2738ec4')) return 'CA';
  if (levelId.startsWith('custom-a6b7c90f')) return 'RK';
  if (levelId.startsWith('custom-c69c5ff7')) return 'Dun';
  if (levelId.startsWith('custom-4a2d5e8b')) return 'DT-';
  if (levelId.startsWith('custom-9f3c1d6b')) return 'DT+';
  return levelId.slice(0, 4);
}

// Compute per-version-per-map progress from CSV rows.
export function perMapBreakdown(
  rows: { levelId: string; trial: number }[] | undefined,
): { map: string; short: string; count: number }[] {
  if (!rows || rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.levelId, (counts.get(r.levelId) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([levelId, count]) => ({
    map: mapName(levelId),
    short: shortMap(levelId),
    count,
  })).sort((a, b) => a.short.localeCompare(b.short));
}
