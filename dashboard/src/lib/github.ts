// Client-side GitHub fetch helpers.
// All reads go to raw.githubusercontent.com (CORS-enabled, no auth needed
// for public repos). Tiny in-memory cache to smooth rapid polls.

const RAW_BASE = 'https://raw.githubusercontent.com/Deq710sia/wankle-trials/main/';

interface CacheEntry<T> {
  ts: number;
  data: T | null;
  err: string | null;
}
const cache = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 8_000;

async function fetchRaw<T>(path: string, asJson: boolean): Promise<T | string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    if (cached.err) throw new Error(cached.err);
    return cached.data as T | string | null;
  }

  const url = RAW_BASE + path;
  try {
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      cache: 'no-store',
    });
    if (res.status === 404) {
      cache.set(path, { ts: Date.now(), data: null, err: null });
      return null;
    }
    if (!res.ok) {
      const err = `GitHub ${res.status} for ${path}`;
      cache.set(path, { ts: Date.now(), data: null, err });
      throw new Error(err);
    }
    const text = await res.text();
    const data = asJson ? JSON.parse(text) as T : text;
    cache.set(path, { ts: Date.now(), data, err: null });
    return data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    cache.set(path, { ts: Date.now(), data: null, err: msg });
    throw e;
  }
}

export function fetchJson<T>(path: string): Promise<T | null> {
  return fetchRaw<T>(path, true);
}

export function fetchText(path: string): Promise<string | null> {
  return fetchRaw(path, false) as Promise<string | null>;
}

export const TRACKED_VERSIONS = [
  'v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
  'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045',
];

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"' && cur === '') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
