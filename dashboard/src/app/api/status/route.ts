// /api/status — aggregates all live data from GitHub into one payload.
// Frontend polls this every 10 seconds.

import { NextResponse } from 'next/server';
import {
  fetchJson, fetchText, parseCsv, TRACKED_VERSIONS,
} from '@/lib/github';
import type {
  AggregatedStatus, CsvRow, StatusSnapshot, TrialManifest,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Hardcoded batch sequence (mirrors batch-orchestrator.py in the repo).
const BATCH_SEQUENCE: string[][] = [
  ['v24', 'v25', 'v27'],
  ['v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045'],
  ['v19', 'v21.7', 'v22.8'], // reruns of RK Fight + Dungeon only
];

const T0 = new Date('2026-06-20T22:30:00Z').getTime(); // watchdog launch

function fmtEta(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${m}m`;
}

export async function GET() {
  const errors: string[] = [];

  // Fire all independent reads in parallel.
  const [manifest, snapshot, activeBatch, ...csvResults] = await Promise.all([
    fetchJson<TrialManifest>('trial-manifest.json').catch(() => null),
    fetchJson<StatusSnapshot>('status-snapshot.json').catch(() => null),
    fetchText('active-batch.txt').catch(() => null),
    ...TRACKED_VERSIONS.map(v =>
      fetchText(`trial-data/csvs/parallel-${v}-results.csv`)
        .then(text => ({ v, text }))
        .catch(() => ({ v, text: null as string | null }))
    ),
  ]);

  if (!manifest) errors.push('manifest 404');
  if (!snapshot) errors.push('snapshot 404');

  // Build CSVs map + per-version stats.
  const csvs: Record<string, CsvRow[]> = {};
  const csvStats: AggregatedStatus['csvStats'] = {};
  for (const { v, text } of csvResults) {
    if (!text) continue;
    const rows = parseCsv(text).map(r => ({
      version: r.version,
      trial: parseInt(r.trial, 10) || 0,
      kills: parseInt(r.kills, 10) || 0,
      deaths: parseInt(r.deaths, 10) || 0,
      wave: parseInt(r.wave, 10) || 0,
      alive: parseInt(r.alive, 10) || 0,
      hp: parseInt(r.hp, 10) || 0,
      enemyCount: parseInt(r.enemyCount, 10) || 0,
      durationSec: parseInt(r.durationSec, 10) || 0,
      avgFps: parseFloat(r.avgFps) || 0,
      minFps: parseFloat(r.minFps) || 0,
      maxEnemies: parseInt(r.maxEnemies, 10) || 0,
      botType: r.botType,
      levelId: r.levelId,
      mode: r.mode,
      aimbotOff: parseInt(r.aimbotOff, 10) || 0,
      jsonlFile: r.jsonlFile,
      corrBuckets: r.corrBuckets,
    }));
    csvs[v] = rows;
    if (rows.length > 0) {
      const sumK = rows.reduce((a, r) => a + r.kills, 0);
      const sumD = rows.reduce((a, r) => a + r.deaths, 0);
      const sumT = rows.reduce((a, r) => a + r.durationSec, 0);
      const sumF = rows.reduce((a, r) => a + r.avgFps, 0);
      const levels = new Set(rows.map(r => r.levelId));
      csvStats[v] = {
        rows: rows.length,
        avgKills: sumK / rows.length,
        avgDeaths: sumD / rows.length,
        avgDuration: sumT / rows.length,
        avgFps: sumF / rows.length,
        uniqueLevels: levels.size,
      };
    }
  }

  // Progress.
  const trialsDone = manifest?.trialsCompleted ?? 0;
  const trialsTotal = manifest?.trialsTotal ?? 1350;
  const progressPct = trialsTotal > 0 ? (trialsDone / trialsTotal) * 100 : 0;

  // ETA from elapsed time and trial rate.
  const now = Date.now();
  const elapsedMin = (now - T0) / 60000;
  let ratePerMin: number | null = null;
  let etaMinutes: number | null = null;
  if (trialsDone > 0 && elapsedMin > 1) {
    ratePerMin = trialsDone / elapsedMin;
    if (ratePerMin > 0) {
      const remaining = trialsTotal - trialsDone;
      etaMinutes = remaining / ratePerMin;
    }
  }

  // Batch tracker.
  const currentBatchStr = (activeBatch ?? snapshot?.activeBatch ?? '').trim();
  const currentBatch = currentBatchStr.split(/\s+/).filter(Boolean);
  let currentIndex = -1;
  for (let i = 0; i < BATCH_SEQUENCE.length; i++) {
    const b = BATCH_SEQUENCE[i];
    if (b.join(' ') === currentBatchStr ||
        (currentBatch.length > 0 && currentBatch.every(v => b.includes(v)))) {
      currentIndex = i;
      break;
    }
  }
  if (currentIndex === -1 && currentBatch.length > 0) currentIndex = 0;

  // Driver status (heartbeats).
  const driverStatus: AggregatedStatus['driverStatus'] = {};
  if (snapshot) {
    for (const [v, hb] of Object.entries(snapshot.heartbeats)) {
      driverStatus[v] = {
        alive: hb.alive,
        ageSec: hb.ageSec,
        trialCount: hb.trialCount,
      };
    }
  }

  // Recent log lines (newest first, capped).
  const recentLogLines: { source: string; line: string }[] = [];
  if (snapshot?.logs) {
    for (const [source, lines] of Object.entries(snapshot.logs)) {
      const tail = lines.slice(-4).reverse();
      for (const line of tail) {
        recentLogLines.push({ source, line });
        if (recentLogLines.length >= 18) break;
      }
      if (recentLogLines.length >= 18) break;
    }
  }

  const result: AggregatedStatus = {
    fetchedAt: new Date().toISOString(),
    manifest,
    snapshot,
    activeBatch: currentBatchStr,
    csvs,
    csvStats,
    progressPct,
    trialsDone,
    trialsTotal,
    etaMinutes,
    etaFormatted: fmtEta(etaMinutes),
    ratePerMin,
    threadsPct: snapshot?.threads.pct ?? 0,
    anomalyCount: snapshot?.anomalies.length ?? 0,
    batches: {
      current: currentBatch,
      sequence: BATCH_SEQUENCE,
      currentIndex,
    },
    driverStatus,
    recentLogLines,
    asciiLiveFiles: snapshot?.asciiArtLive ?? [],
    rawError: errors.length ? errors.join('; ') : undefined,
  };

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=2',
    },
  });
}
