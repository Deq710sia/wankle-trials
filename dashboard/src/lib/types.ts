// Shared types for the wankle-trials dashboard

export type VersionId =
  | 'v19' | 'v21.7' | 'v22.8' | 'v24' | 'v25' | 'v27'
  | 'v27-no-pathguard' | 'v27-cap-pred8' | 'v27-mag045';

export interface Heartbeat {
  ts: number;
  ageSec: number;
  alive: boolean;
  trialCount: number;
}

export interface Threads {
  used: number;
  limit: number;
  pct: number;
}

export interface Processes {
  chrome: number;
  drivers: number;
  watchdog: number;
  manifestUpdater: number;
  backupManager: number;
  anomalyDetector: number;
  telemetryValidator: number;
  batchOrchestrator: number;
  gitBackup: number;
  asciiArtGenerator: number;
  [k: string]: number;
}

export interface AnomalyEntry {
  timestamp: string;
  version: string;
  trial: number;
  levelId: string;
  aimbotOff: boolean;
  reason: string;
  action: string;
  kills: number;
  deaths: number;
  duration: number;
  avgFps: number;
}

export interface StatusSnapshot {
  timestamp: string;
  timestampUnix: number;
  heartbeats: Record<string, Heartbeat>;
  activeBatch: string;
  allBatchesCompleteFlag: boolean;
  threads: Threads;
  processes: Processes;
  anomalies: AnomalyEntry[];
  retryCounts: number;
  logs: Record<string, string[]>;
  driverLogs?: Record<string, string[]>;
  asciiArtLive?: string[];
  lastManifestUpdate?: string;
}

export interface VersionProgress {
  completed: number;
  target: number;
  status: 'in_progress' | 'pending' | 'complete';
  csvPath?: string;
  jsonlDir?: string;
  telemetryDir?: string;
}

export interface TrialManifest {
  lastUpdated: string;
  versionsCompleted: string[];
  versionsInProgress: string[];
  versionsRemaining: string[];
  trialsCompleted: number;
  trialsTotal: number;
  perVersion: Record<string, VersionProgress>;
}

export interface CsvRow {
  version: string;
  trial: number;
  kills: number;
  deaths: number;
  wave: number;
  alive: number;
  hp: number;
  enemyCount: number;
  durationSec: number;
  avgFps: number;
  minFps: number;
  maxEnemies: number;
  botType: string;
  levelId: string;
  mode: string;
  aimbotOff: number;
  jsonlFile: string;
  corrBuckets: string;
}

export interface AggregatedStatus {
  fetchedAt: string;
  manifest: TrialManifest | null;
  snapshot: StatusSnapshot | null;
  activeBatch: string;
  csvs: Record<string, CsvRow[]>;
  csvStats: Record<string, {
    rows: number;
    avgKills: number;
    avgDeaths: number;
    avgDuration: number;
    avgFps: number;
    uniqueLevels: number;
  }>;
  progressPct: number;
  trialsDone: number;
  trialsTotal: number;
  etaMinutes: number | null;
  etaFormatted: string;
  ratePerMin: number | null;
  threadsPct: number;
  anomalyCount: number;
  batches: {
    current: string[];
    sequence: string[][];
    currentIndex: number;
  };
  driverStatus: Record<string, { alive: boolean; ageSec: number; trialCount: number }>;
  recentLogLines: { source: string; line: string }[];
  asciiLiveFiles: string[];
  rawError?: string;
}
