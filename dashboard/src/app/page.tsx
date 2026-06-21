'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AggregatedStatus } from '@/lib/types';
import {
  fmtAge, fmtNum, fmtPct, fmtRelative, fmtTime,
  progressBar, perMapBreakdown, shortMap,
} from '@/lib/format';
import { fetchStatus } from '@/lib/status';
import {
  fetchAsciiArt, getOpenRouterKey, setOpenRouterKey, clearOpenRouterKey,
  type AsciiPiece,
} from '@/lib/ascii-art';

const STATUS_POLL_MS = 10_000;
const ASCII_POLL_MS = 5 * 60_000;

export default function Home() {
  const [status, setStatus] = useState<AggregatedStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [ascii, setAscii] = useState<AsciiPiece | null>(null);
  const [asciiLoading, setAsciiLoading] = useState(false);
  const [asciiErr, setAsciiErr] = useState<string | null>(null);
  const [asciiHistory, setAsciiHistory] = useState<AsciiPiece[]>([]);
  const [nextAsciiIn, setNextAsciiIn] = useState(ASCII_POLL_MS);
  const [booted, setBooted] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  // Check if OpenRouter key is set (on mount)
  useEffect(() => {
    setHasKey(!!getOpenRouterKey());
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setStatusErr(null);
      setBooted(true);
    } catch (e) {
      setStatusErr(e instanceof Error ? e.message : String(e));
      setBooted(true);
    }
  }, []);

  // Keep a ref to the latest status so fetchAscii doesn't depend on it
  const statusRef = useRef<AggregatedStatus | null>(null);
  useEffect(() => { statusRef.current = status; }, [status]);

  const fetchAscii = useCallback(async () => {
    if (!getOpenRouterKey()) {
      setShowKeyModal(true);
      return;
    }
    setAsciiLoading(true);
    setAsciiErr(null);
    try {
      // Need a status snapshot for the prompt — fetch fresh if we don't have one.
      let s = statusRef.current;
      if (!s) {
        s = await fetchStatus();
        setStatus(s);
      }
      const piece = await fetchAsciiArt(s);
      setAscii(piece);
      setAsciiHistory(prev => [piece, ...prev].slice(0, 6));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'NO_API_KEY') {
        setShowKeyModal(true);
      } else {
        setAsciiErr(msg);
      }
    } finally {
      setAsciiLoading(false);
    }
  }, []);

  // Initial mount
  useEffect(() => {
    pollStatus();
    if (getOpenRouterKey()) fetchAscii();
  }, [pollStatus, fetchAscii]);

  // Status interval (10s)
  useEffect(() => {
    const id = setInterval(pollStatus, STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [pollStatus]);

  // ASCII countdown + interval (5 min)
  useEffect(() => {
    setNextAsciiIn(ASCII_POLL_MS);
    const id = setInterval(() => {
      setNextAsciiIn(prev => {
        const next = prev - 1000;
        if (next <= 0) {
          if (getOpenRouterKey()) fetchAscii();
          return ASCII_POLL_MS;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [fetchAscii]);

  const onKeySaved = useCallback(() => {
    setHasKey(true);
    setShowKeyModal(false);
    fetchAscii();
  }, [fetchAscii]);

  if (!booted) {
    return <BootSplash />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header
        status={status}
        hasKey={hasKey}
        onOpenKeyModal={() => setShowKeyModal(true)}
      />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
        <TopRow status={status} err={statusErr} />
        <BatchTracker status={status} />
        <VersionGrid status={status} />

        <AsciiStream
          current={ascii}
          history={asciiHistory}
          loading={asciiLoading}
          err={asciiErr}
          nextIn={nextAsciiIn}
          status={status}
          onRefresh={fetchAscii}
          hasKey={hasKey}
          onOpenKeyModal={() => setShowKeyModal(true)}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <AnomalyFeed status={status} />
          <LogFeed status={status} />
        </div>

        <Footer status={status} err={statusErr} />
      </main>

      {showKeyModal && (
        <ApiKeyModal
          onClose={() => setShowKeyModal(false)}
          onSaved={onKeySaved}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOOT SPLASH
// ═══════════════════════════════════════════════════════════════════
function BootSplash() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <pre className="ascii-pre text-primary glow text-center">
{`╔══════════════════════════════════════╗
║                                      ║
║   ███╗    ██╗ █████╗ ██████╗ ███╗   ██╗
║   ████╗   ██║██╔══██╗██╔══██╗████╗  ██║
║   ██╔██╗  ██║███████║██████╔╝██╔██╗ ██║
║   ██║╚██╗ ██║██╔══██║██╔══██╗██║╚██╗██║
║   ██║ ╚████║██║  ██║██║  ██║██║ ╚████║
║   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝
║                                      ║
║         LIVE TELEMETRY DASHBOARD      ║
║                                      ║
╚══════════════════════════════════════╝`}
        </pre>
        <div className="space-y-2">
          <div className="h-1 w-full bg-secondary rounded-full overflow-hidden">
            <div className="h-full bg-primary glow animate-pulse" style={{ width: '60%' }} />
          </div>
          <div className="text-xs text-muted-foreground text-center font-mono">
            connecting to github.com/Deq710sia/wankle-trials<span className="cursor-blink">▊</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// API KEY MODAL
// ═══════════════════════════════════════════════════════════════════
function ApiKeyModal({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-or-v1-')) {
      setError('OpenRouter keys start with "sk-or-v1-" — double-check what you pasted.');
      return;
    }
    setTesting(true);
    setError(null);
    try {
      // Quick validation: list models (cheap call)
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setOpenRouterKey(trimmed);
      onSaved();
    } catch (e) {
      setError(`Key check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-primary/40 bg-card p-5 md:p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-base md:text-lg font-bold text-primary glow">
            ▚ OpenRouter API Key
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-xs md:text-sm text-muted-foreground mb-4 leading-relaxed">
          The ASCII art stream is powered by OpenRouter&apos;s free tier. Your key
          is stored only in this browser&apos;s localStorage — it never leaves
          your device except to call OpenRouter directly. Get a free key at{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:opacity-80"
          >
            openrouter.ai/keys
          </a>.
        </p>
        <textarea
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="sk-or-v1-..."
          rows={3}
          className="w-full px-3 py-2 rounded border border-border bg-secondary/50 text-foreground text-xs md:text-sm font-mono resize-none focus:outline-none focus:border-primary"
          autoFocus
        />
        {error && (
          <div className="mt-2 text-xs text-destructive font-mono">
            ⚠ {error}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={() => { clearOpenRouterKey(); onClose(); }}
            className="text-xs text-muted-foreground hover:text-destructive font-mono"
          >
            clear saved key
          </button>
          <button
            onClick={handleSave}
            disabled={!key.trim() || testing}
            className="px-4 py-2 rounded bg-primary text-background text-xs md:text-sm font-bold disabled:opacity-40 hover:opacity-90 transition"
          >
            {testing ? 'validating...' : 'save & test'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════
function Header({
  status, hasKey, onOpenKeyModal,
}: {
  status: AggregatedStatus | null;
  hasKey: boolean;
  onOpenKeyModal: () => void;
}) {
  const live = status?.snapshot?.heartbeats
    ? Object.values(status.snapshot.heartbeats).some(h => h.alive)
    : false;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-2.5 md:py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <div className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-primary pulse-green' : 'bg-destructive'}`} />
          <div className="min-w-0">
            <div className="text-sm md:text-base font-bold text-primary glow truncate">
              wankle-trials
            </div>
            <div className="text-[10px] md:text-xs text-muted-foreground font-mono truncate">
              {live ? 'LIVE · github.com/Deq710sia/wankle-trials' : 'connecting…'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm font-mono shrink-0">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-muted-foreground text-[10px]">THREADS</span>
            <span className={threadColor(status?.threadsPct ?? 0)}>
              {status?.snapshot?.threads.used ?? '—'}/{status?.snapshot?.threads.limit ?? '—'} ({status?.threadsPct ?? 0}%)
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground text-[10px]">LAST SYNC</span>
            <span className="text-foreground">
              {status ? fmtRelative(status.fetchedAt) : '—'}
            </span>
          </div>
          <button
            onClick={onOpenKeyModal}
            className={`px-2 py-1 rounded border text-[10px] md:text-xs font-mono ${
              hasKey
                ? 'border-success/40 text-success hover:bg-success/10'
                : 'border-warning/60 text-warning hover:bg-warning/10'
            }`}
            title="OpenRouter API key"
          >
            {hasKey ? '● key set' : '○ set key'}
          </button>
        </div>
      </div>
    </header>
  );
}

function threadColor(pct: number): string {
  if (pct >= 90) return 'text-destructive glow';
  if (pct >= 75) return 'text-warning';
  return 'text-foreground';
}

// ═══════════════════════════════════════════════════════════════════
// TOP ROW
// ═══════════════════════════════════════════════════════════════════
function TopRow({ status, err }: { status: AggregatedStatus | null; err: string | null }) {
  if (err && !status) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        ⚠ Could not fetch status: {err}. The trial VM may be offline, or GitHub rate-limited the request. Retrying every 10s.
      </div>
    );
  }

  const done = status?.trialsDone ?? 0;
  const total = status?.trialsTotal ?? 1350;
  const pct = status?.progressPct ?? 0;
  const bar = progressBar(done, total, 40);

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-6 space-y-3 md:space-y-4">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <div className="text-[10px] md:text-xs text-muted-foreground font-mono uppercase tracking-wider">
            Trial Progress
          </div>
          <div className="text-2xl md:text-4xl font-bold text-primary glow font-mono">
            {fmtNum(done)} <span className="text-muted-foreground text-base md:text-xl">/ {fmtNum(total)}</span>
          </div>
          <div className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {fmtPct(pct)} complete
          </div>
        </div>
        <div className="grid grid-cols-3 md:flex md:gap-6 gap-2 text-right">
          <Stat label="ETA" value={status?.etaFormatted ?? '—'} highlight />
          <Stat label="RATE" value={status?.ratePerMin !== null && status?.ratePerMin !== undefined ? `${status.ratePerMin.toFixed(2)}/min` : '—'} />
          <Stat label="ANOMALIES" value={fmtNum(status?.anomalyCount ?? 0)} warn={!!status && status.anomalyCount > 0} />
        </div>
      </div>

      <div className="space-y-1.5">
        <pre className="ascii-pre text-primary glow text-xs md:text-sm overflow-x-auto">
{bar}  {fmtPct(pct)}
        </pre>
      </div>

      {err && (
        <div className="text-xs text-warning font-mono">
          ⚠ partial: {err}
        </div>
      )}
    </section>
  );
}

function Stat({
  label, value, highlight, warn,
}: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  const cls = warn ? 'text-destructive glow'
    : highlight ? 'text-primary glow'
    : 'text-foreground';
  return (
    <div className="flex flex-col md:items-end">
      <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{label}</span>
      <span className={`text-lg md:text-xl font-bold font-mono ${cls}`}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BATCH TRACKER
// ═══════════════════════════════════════════════════════════════════
function BatchTracker({ status }: { status: AggregatedStatus | null }) {
  const seq = status?.batches.sequence ?? [
    ['v24', 'v25', 'v27'],
    ['v27-no-pathguard', 'v27-cap-pred8', 'v27-mag045'],
    ['v19', 'v21.7', 'v22.8'],
  ];
  const currentIdx = status?.batches.currentIndex ?? 0;

  return (
    <section className="rounded-lg border border-border bg-card p-3 md:p-4">
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <h2 className="text-xs md:text-sm font-mono uppercase tracking-wider text-muted-foreground">
          Batch Sequence
        </h2>
        <span className="text-[10px] md:text-xs text-muted-foreground font-mono">
          {status?.activeBatch ? `running: ${status.activeBatch}` : 'idle'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-3">
        {seq.map((batch, idx) => {
          const state =
            idx < currentIdx ? 'done' :
            idx === currentIdx ? 'active' :
            'pending';
          return (
            <div
              key={idx}
              className={`rounded border p-2.5 md:p-3 font-mono text-xs ${
                state === 'done' ? 'border-success/30 bg-success/5 text-success' :
                state === 'active' ? 'border-primary bg-primary/10 text-primary glow' :
                'border-border bg-secondary/30 text-muted-foreground'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold">
                  {state === 'done' ? '✓' : state === 'active' ? '▶' : '○'} batch {idx + 1}
                </span>
                <span className="text-[10px] opacity-70">
                  {state === 'done' ? 'complete' : state === 'active' ? 'running' : 'queued'}
                </span>
              </div>
              <div className="space-y-0.5">
                {batch.map(v => (
                  <div key={v} className="flex items-center justify-between">
                    <span>{v}</span>
                    <BatchVersionStatus v={v} status={status} state={state} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BatchVersionStatus({
  v, status, state,
}: { v: string; status: AggregatedStatus | null; state: string }) {
  const prog = status?.manifest?.perVersion?.[v];
  if (!prog) return <span className="text-[10px] opacity-50">—</span>;
  const pct = prog.target > 0 ? (prog.completed / prog.target) * 100 : 0;
  return (
    <span className="text-[10px] opacity-80">
      {prog.completed}/{prog.target} ({pct.toFixed(0)}%)
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
// VERSION GRID
// ═══════════════════════════════════════════════════════════════════
function VersionGrid({ status }: { status: AggregatedStatus | null }) {
  const versions = status?.manifest?.perVersion
    ? Object.entries(status.manifest.perVersion)
    : [];

  if (versions.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        No version data yet.
      </section>
    );
  }

  return (
    <section className="space-y-2 md:space-y-3">
      <h2 className="text-xs md:text-sm font-mono uppercase tracking-wider text-muted-foreground px-1">
        Per-Version Progress
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {versions.map(([v, prog]) => (
          <VersionCard
            key={v}
            version={v}
            completed={prog.completed}
            target={prog.target}
            status={prog.status}
            csvStats={status?.csvStats?.[v]}
            csvRows={status?.csvs?.[v]}
            driver={status?.driverStatus?.[v]}
          />
        ))}
      </div>
    </section>
  );
}

function VersionCard({
  version, completed, target, status, csvStats, csvRows, driver,
}: {
  version: string;
  completed: number;
  target: number;
  status: string;
  csvStats?: { rows: number; avgKills: number; avgDeaths: number; avgDuration: number; avgFps: number; uniqueLevels: number };
  csvRows?: { levelId: string; trial: number }[];
  driver?: { alive: boolean; ageSec: number; trialCount: number };
}) {
  const pct = target > 0 ? (completed / target) * 100 : 0;
  const bar = progressBar(completed, target, 16);
  const maps = perMapBreakdown(csvRows);
  const isLive = driver?.alive && driver.ageSec < 60;
  const isComplete = status === 'complete' || completed >= target;

  return (
    <div className={`rounded-lg border p-3 md:p-4 bg-card ${
      isComplete ? 'border-success/40' :
      isLive ? 'border-primary/60' :
      'border-border'
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${
            isComplete ? 'bg-success' :
            isLive ? 'bg-primary pulse-green' :
            'bg-muted-foreground'
          }`} />
          <span className="font-bold text-sm md:text-base text-foreground">{version}</span>
        </div>
        <span className={`text-[10px] font-mono uppercase ${
          isComplete ? 'text-success' :
          isLive ? 'text-primary' :
          'text-muted-foreground'
        }`}>
          {isComplete ? 'done' : isLive ? 'live' : status}
        </span>
      </div>

      <pre className="ascii-pre text-[10px] md:text-xs text-primary glow mb-2 overflow-x-auto">
{bar}
      </pre>

      <div className="text-[10px] md:text-xs text-muted-foreground font-mono mb-2">
        {pct.toFixed(1)}% · {completed}/{target}
      </div>

      {maps.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {maps.map(m => (
            <span
              key={m.short}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary/60 text-foreground border border-border"
              title={m.map}
            >
              {m.short}:{m.count}
            </span>
          ))}
        </div>
      )}

      {csvStats && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
          <div>kills <span className="text-foreground">{csvStats.avgKills.toFixed(1)}</span></div>
          <div>deaths <span className="text-foreground">{csvStats.avgDeaths.toFixed(1)}</span></div>
          <div>dur <span className="text-foreground">{csvStats.avgDuration.toFixed(0)}s</span></div>
          <div>fps <span className="text-foreground">{csvStats.avgFps.toFixed(1)}</span></div>
        </div>
      )}

      {driver && (
        <div className="mt-2 pt-2 border-t border-border text-[10px] font-mono text-muted-foreground">
          hb: <span className={driver.alive ? 'text-success' : 'text-destructive'}>
            {driver.alive ? 'alive' : 'dead'}
          </span> · age {fmtAge(driver.ageSec)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ASCII STREAM
// ═══════════════════════════════════════════════════════════════════
function AsciiStream({
  current, history, loading, err, nextIn, status, onRefresh, hasKey, onOpenKeyModal,
}: {
  current: AsciiPiece | null;
  history: AsciiPiece[];
  loading: boolean;
  err: string | null;
  nextIn: number;
  status: AggregatedStatus | null;
  onRefresh: () => void;
  hasKey: boolean;
  onOpenKeyModal: () => void;
}) {
  const mins = Math.floor(nextIn / 60_000);
  const secs = Math.floor((nextIn % 60_000) / 1000);
  const countdown = `${mins}:${secs.toString().padStart(2, '0')}`;

  const totalMs = ASCII_POLL_MS;
  const elapsed = totalMs - nextIn;
  const refreshPct = Math.min(100, (elapsed / totalMs) * 100);

  return (
    <section className="rounded-lg border border-primary/40 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs md:text-sm font-mono uppercase tracking-wider text-primary glow">
            ▚ ASCII Art Stream
          </span>
          {current && (
            <span className="text-[10px] md:text-xs text-muted-foreground font-mono truncate">
              · theme: {current.theme}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] md:text-xs font-mono text-muted-foreground">
            next refresh in <span className="text-primary">{countdown}</span>
          </span>
          <button
            onClick={hasKey ? onRefresh : onOpenKeyModal}
            disabled={loading}
            className="text-[10px] md:text-xs px-2 py-1 rounded border border-border hover:border-primary hover:text-primary transition disabled:opacity-40 font-mono"
          >
            {loading ? '...' : '↻ now'}
          </button>
        </div>
      </div>

      <div className="h-0.5 bg-secondary">
        <div
          className={`h-full bg-primary glow transition-all duration-1000 ${loading ? 'animate-pulse' : ''}`}
          style={{ width: `${loading ? 100 : refreshPct}%` }}
        />
      </div>

      <div className="p-3 md:p-4">
        {!hasKey && (
          <div className="text-center py-6 space-y-3">
            <pre className="ascii-pre text-muted-foreground inline-block">
{`╔══════════════════════════════════════════╗
║  ASCII art stream needs an OpenRouter key ║
║   click below to set it (stored locally)  ║
╚══════════════════════════════════════════╝`}
            </pre>
            <div>
              <button
                onClick={onOpenKeyModal}
                className="px-4 py-2 rounded bg-primary text-background text-xs md:text-sm font-bold hover:opacity-90 transition"
              >
                set OpenRouter key
              </button>
            </div>
          </div>
        )}

        {hasKey && err && !current && (
          <div className="text-sm text-destructive font-mono">
            ⚠ ascii gen failed: {err}
          </div>
        )}

        {hasKey && loading && !current && (
          <div className="py-12 text-center">
            <pre className="ascii-pre text-primary glow inline-block text-left">
{`  ╔══════════════════════════╗
  ║  generating ascii art... ║
  ║  querying gemma-4-31b... ║
  ╚══════════════════════════╝
        ▓▓▓░░░░░░░`}
            </pre>
          </div>
        )}

        {current && (
          <pre className="ascii-pre text-primary glow fade-in-up overflow-x-auto" key={current.generatedAt}>
{current.art}
          </pre>
        )}

        {current && (
          <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2 text-[10px] md:text-xs font-mono text-muted-foreground">
            <div>
              generated {fmtRelative(current.generatedAt)} via{' '}
              <span className="text-primary">{current.model}</span>
            </div>
            <div className="hidden md:block">
              trials: {status?.trialsDone ?? '—'}/{status?.trialsTotal ?? '—'} ·
              eta: {status?.etaFormatted ?? '—'} ·
              threads: {status?.threadsPct ?? '—'}%
            </div>
          </div>
        )}

        {history.length > 1 && (
          <details className="mt-3 group">
            <summary className="text-[10px] md:text-xs font-mono text-muted-foreground cursor-pointer hover:text-primary">
              ▼ previous pieces ({history.length - 1})
            </summary>
            <div className="mt-2 space-y-3 max-h-96 overflow-y-auto">
              {history.slice(1).map((p, i) => (
                <div key={i} className="border-t border-border pt-2">
                  <div className="text-[10px] font-mono text-muted-foreground mb-1">
                    {p.theme} · {fmtRelative(p.generatedAt)} · {p.model}
                  </div>
                  <pre className="ascii-pre text-success/80 text-[10px] overflow-x-auto">
{p.art}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ANOMALY FEED
// ═══════════════════════════════════════════════════════════════════
function AnomalyFeed({ status }: { status: AggregatedStatus | null }) {
  const anomalies = status?.snapshot?.anomalies ?? [];
  return (
    <section className="rounded-lg border border-border bg-card p-3 md:p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs md:text-sm font-mono uppercase tracking-wider text-muted-foreground">
          ⚠ Anomaly Detector
        </h2>
        <span className={`text-[10px] md:text-xs font-mono ${
          anomalies.length === 0 ? 'text-success' : 'text-warning'
        }`}>
          {anomalies.length === 0 ? '● clean' : `${anomalies.length} flagged`}
        </span>
      </div>
      {anomalies.length === 0 ? (
        <div className="text-xs md:text-sm text-muted-foreground font-mono py-3">
          no anomalies detected across current batch
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {anomalies.slice().reverse().map((a, i) => (
            <div key={i} className="text-[10px] md:text-xs font-mono p-2 rounded border border-warning/30 bg-warning/5">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-warning">
                  {a.version} · trial {a.trial} · {shortMap(a.levelId)}
                </span>
                <span className="text-muted-foreground">{fmtTime(a.timestamp)}</span>
              </div>
              <div className="text-foreground">
                reason: <span className="text-warning">{a.reason}</span>
              </div>
              <div className="text-muted-foreground mt-0.5">
                K={a.kills} D={a.deaths} dur={a.duration}s · action: {a.action}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOG FEED
// ═══════════════════════════════════════════════════════════════════
function LogFeed({ status }: { status: AggregatedStatus | null }) {
  const lines = status?.recentLogLines ?? [];
  return (
    <section className="rounded-lg border border-border bg-card p-3 md:p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs md:text-sm font-mono uppercase tracking-wider text-muted-foreground">
          ▤ Recent Log Activity
        </h2>
        <span className="text-[10px] md:text-xs text-muted-foreground font-mono">
          {lines.length} lines
        </span>
      </div>
      {lines.length === 0 ? (
        <div className="text-xs md:text-sm text-muted-foreground font-mono py-3">
          no log lines available
        </div>
      ) : (
        <div className="space-y-0.5 max-h-72 overflow-y-auto font-mono text-[10px] md:text-xs">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 hover:bg-secondary/30 px-1 py-0.5 rounded">
              <span className="text-muted-foreground shrink-0 w-24 md:w-28 truncate" title={l.source}>
                [{l.source}]
              </span>
              <span className="text-foreground/90 truncate">{l.line}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FOOTER
// ═══════════════════════════════════════════════════════════════════
function Footer({ status, err }: { status: AggregatedStatus | null; err: string | null }) {
  return (
    <footer className="mt-6 pt-4 border-t border-border text-[10px] md:text-xs text-muted-foreground font-mono space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          data source: github.com/Deq710sia/wankle-trials (raw · public)
        </div>
        <div>
          ascii backend: OpenRouter · free models (gemma-4 / llama-3.3 / qwen3)
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 opacity-70">
        <div>
          status poll: 10s · ascii refresh: 5min · hosted on GitHub Pages
        </div>
        <div>
          {status?.rawError
            ? `partial: ${status.rawError}`
            : err
              ? `error: ${err}`
              : 'all systems nominal'}
        </div>
      </div>
    </footer>
  );
}
