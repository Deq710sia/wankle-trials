// GitHub raw-content fetch helpers.
// All reads go to raw.githubusercontent.com so the site can be hosted
// anywhere (Vercel free tier) without touching the trial VM.

import 'server-only';

const GITHUB_REPO = process.env.GITHUB_REPO || 'Deq710sia/wankle-trials';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/`;

// Tiny in-memory cache to avoid hammering GitHub on every poll.
// Vercel serverless functions are short-lived, so this just smooths bursts.
interface CacheEntry<T> {
  ts: number;
  data: T | null;
  err: string | null;
}
const cache = new Map<string, CacheEntry<unknown>>();
const TTL_MS = 8_000; // 8 seconds

async function fetchRaw<T>(path: string, asJson: true): Promise<T | null>;
async function fetchRaw(path: string, asJson: false): Promise<string | null>;
async function fetchRaw<T>(path: string, asJson: boolean): Promise<T | string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    if (cached.err) throw new Error(cached.err);
    return cached.data as T | string | null;
  }

  const url = RAW_BASE + path;
  const headers: Record<string, string> = {
    'User-Agent': 'wankle-dashboard/1.0',
    'Cache-Control': 'no-cache',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;

  try {
    const res = await fetch(url, { headers, next: { revalidate: 8 } });
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
  return fetchRaw(path, false);
}

// List files in a directory via the GitHub REST API (contents endpoint).
export async function listDir(path: string): Promise<string[]> {
  const API = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const headers: Record<string, string> = {
    'User-Agent': 'wankle-dashboard/1.0',
    'Accept': 'application/vnd.github+json',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  try {
    const res = await fetch(API, { headers, next: { revalidate: 30 } });
    if (!res.ok) return [];
    const data = await res.json() as Array<{ name: string; type: string }>;
    return data.filter(x => x.type === 'file').map(x => x.name);
  } catch {
    return [];
  }
}

// Versions we track. Used to know which CSVs to fetch.
export const TRACKED_VERSIONS = [
  'v19', 'v21.7', 'v22.8', 'v24', 'v25', 'v27',
  'v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045',
];

// Parse a CSV string into typed rows (very small parser, no deps).
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

// Handles simple quoted CSV cells (no embedded newlines).
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
