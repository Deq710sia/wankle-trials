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
// Note: DT-off and DT-on share the same levelId (custom-5f697a3b-742) —
// they're the same "Dodge Training" level with different aimbot settings.
// Distinguish them using the aimbotOff field, not the levelId.
const MAP_NAMES: Record<string, string> = {
  'custom-c2738ec4-135': 'CA (Custom Arena)',
  'custom-c69c5ff7-f4e': 'RK Fight',
  'custom-a6b7c90f-813': 'Dungeon',
  'custom-5f697a3b-742': 'Dodge Training',
};

export function mapName(levelId: string): string {
  return MAP_NAMES[levelId] || levelId.slice(0, 16);
}

// Short label for a trial. Uses levelId + aimbotOff to distinguish
// DT-off (aimbotOff=1/true) from DT-on (aimbotOff=0/false).
export function shortMap(levelId: string, aimbotOff?: number | string | boolean): string {
  if (levelId.startsWith('custom-c2738ec4')) return 'CA';
  if (levelId.startsWith('custom-c69c5ff7')) return 'RK';
  if (levelId.startsWith('custom-a6b7c90f')) return 'Dun';
  if (levelId.startsWith('custom-5f697a3b')) {
    // Dodge Training — same level, two variants by aimbot setting
    let off: number | boolean;
    if (typeof aimbotOff === 'string') off = parseInt(aimbotOff, 10);
    else off = aimbotOff ?? 0;
    // off===1 or off===true means aimbot is OFF (pure dodge test)
    return (off === 1 || off === true) ? 'DT-off' : 'DT-on';
  }
  return levelId.slice(0, 4);
}

// Full label including the map name + variant
export function fullMapLabel(levelId: string, aimbotOff?: number | string | boolean): string {
  if (levelId.startsWith('custom-5f697a3b')) {
    let off: number | boolean;
    if (typeof aimbotOff === 'string') off = parseInt(aimbotOff, 10);
    else off = aimbotOff ?? 0;
    return (off === 1 || off === true) ? 'Dodge Training (aimbot OFF)' : 'Dodge Training (aimbot ON)';
  }
  return mapName(levelId);
}

// Compute per-version-per-map progress from CSV rows.
// Distinguishes DT-off from DT-on via the aimbotOff field.
export function perMapBreakdown(
  rows: { levelId: string; trial: number; aimbotOff?: number | string | boolean }[] | undefined,
): { map: string; short: string; count: number }[] {
  if (!rows || rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = shortMap(r.levelId, r.aimbotOff);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Sort in canonical order: CA, RK, Dun, DT-off, DT-on
  const order = ['CA', 'RK', 'Dun', 'DT-off', 'DT-on'];
  return Array.from(counts.entries()).map(([short, count]) => ({
    map: short === 'CA' ? 'Custom Arena'
      : short === 'RK' ? 'RK Fight'
      : short === 'Dun' ? 'Dungeon'
      : short === 'DT-off' ? 'Dodge Training (OFF)'
      : short === 'DT-on' ? 'Dodge Training (ON)'
      : short,
    short,
    count,
  })).sort((a, b) => {
    const ai = order.indexOf(a.short);
    const bi = order.indexOf(b.short);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
