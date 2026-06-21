// Client-side ASCII art generator. Calls OpenRouter directly from the
// browser (OpenRouter sends `Access-Control-Allow-Origin: *`).
// OpenRouter key is stored in localStorage — see src/lib/keys.ts.

import { fetchText, fetchJson } from './github';
import type { StatusSnapshot, TrialManifest, AggregatedStatus } from './types';

const STYLE_FILES = [
  'ascii-art/02-armada-tide-turns.txt',
  'ascii-art/05-smaller-pieces.txt',
  'ascii-art/06-early-monitoring-tanks.txt',
];

const USED_THEMES = [
  'dice', 'tanks', 'boats/armada', 'rockets', 'pyramids', 'skyscrapers',
  'waterfalls', 'constellations', 'mountains', 'trains', 'tornado',
  'braille rain', 'bar charts', 'burning joint', 'dice cups', 'dice tower',
  'animal faces', 'linked tanks', 'arrow volley', 'lighthouse',
  'oil rig (DAB)', 'weed mural', 'forest', 'octopus', 'chessboard',
  'beehive', 'switchboard', 'sushi conveyor', 'clockwork', 'stained glass',
  'slot machine', 'archipelago', 'board game', 'thunderstorm', 'subway map',
  'coral reef', 'printing press', 'thermos flask', 'datacenter racks',
  'music equalizer', 'rope bridge', 'movie marquee', 'magician hat',
  'assembly line', 'koi pond', 'telegraph station', 'vending machine',
  'tree of life', 'chess knight', 'fiber optic', 'pulse link',
];

const THEME_POOL = [
  'a satellite ground station downloading trial packets',
  'a wind farm with each turbine spinning out trials',
  'a sand mandala being drawn trial by trial',
  'a deep-sea anglerfish luring in trial results',
  'a meteor shower streaking across the trial sky',
  'a pipeline valve maze routing trials to completion',
  'an origami crane being folded from trial paper',
  'a hot air balloon fleet drifting past 50%',
  'a vinyl record press stamping out trial tracks',
  'a clock tower with each gear a different version',
  'a desert oasis with trial camels drinking',
  'an arcade cabinet high-score screen',
  'a lighthouse keeper logging each passing ship',
  'a violin bow drawing sustained trial notes',
  'a kiln firing trial ceramics',
  'a high-altitude weather balloon releasing trials',
  'a frozen lake with cracks spreading per trial',
  'a vineyard harvest with each barrel a version',
  'a meteor crater with trials as ejecta rays',
  'a steampunk difference engine computing trials',
  'a ski lift carrying trials up the mountain',
  'a gladiator arena with trial waves',
  'a zen garden with raked trial patterns',
  'a glassblower shaping a trial vessel',
  'a router with blinking trial-link LEDs',
  'a pinball machine with trial bumpers',
  'a fishing trawler hauling trial nets',
  'a dirigible mooring tower with trial zeppelins',
  'a transistor radio tuning into trial static',
  'a coal mine cart rolling out trial ore',
  'a stamping press punching out trial tokens',
  'a stone skipping across the trial pond',
  'a topographer drawing trial contour lines',
  'a soda fountain dispensing trial cups',
  'a tower of hanoi with trial disks',
  'a tape spool unwinding trial footage',
  'a popcorn popper bursting with trial kernels',
  'a slot-car track with trial laps',
  'a train switchyard routing trial cars',
  'a hot spring with trial steam rising',
];

const MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'openai/gpt-oss-20b:free',
];

export interface AsciiPiece {
  art: string;
  theme: string;
  model: string;
  generatedAt: string;
}

function pickTheme(seed: number): string {
  return THEME_POOL[seed % THEME_POOL.length];
}

function buildPrompt(
  styleRef: string,
  status: AggregatedStatus,
  theme: string,
): string {
  const trimmedRef = styleRef.length > 4000
    ? styleRef.slice(0, 2000) + '\n...[snip]...\n' + styleRef.slice(-2000)
    : styleRef;

  const perVersionLines = status.manifest?.perVersion
    ? Object.entries(status.manifest.perVersion)
        .map(([v, p]) => `  ${v.padEnd(20)} ${p.completed}/${p.target}`)
        .join('\n')
    : '  (no per-version data)';

  return `You are an ASCII artist for a game-cheat telemetry dashboard called "wankle-trials".
Your job: create ONE fresh ASCII art piece in the EXACT established style below.

=== ESTABLISHED STYLE REFERENCE (from the repo's ascii-art/ folder) ===
${trimmedRef}

=== STYLE RULES (NON-NEGOTIABLE) ===
1. Use box-drawing characters (═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬ ╭ ╮ ╯ ╰), shade blocks (█ ▓ ▒ ░ ▉ ▊ ▋ ▌ ▍ ▎ ▏), and Unicode symbols (◆ ◇ ● ○ ★ ☆ ⚀⚁⚂⚃⚄⚅ ☁ ⚓ ⚡ ▲ △ ▽ ▼ ◢ ◣ ◤ ◥ ⚙ ⚑ ⚔ ⚕).
2. Always include a header line with the piece's title and current progress like: "[█████████░░░░░░░] 588/1350 (43%)".
3. Always include a one-line status row: trials, target, eta, rate, threads, anomalies.
4. The art MUST be a single coherent scene — ${theme}. Do NOT mix multiple unrelated scenes.
5. Keep width to ~80 columns max so it renders cleanly in a <pre> tag.
6. Height: 18-32 lines (sweet spot ~24). Do NOT pad with empty lines.
7. Use ONLY plain ASCII + the Unicode characters listed above. No emoji, no \\uXXXX escapes, no markdown.
8. Do NOT include any explanation, no "Here is your art", no code fences. Output ONLY the ASCII art itself.

=== CURRENT LIVE STATUS (use these EXACT numbers) ===
trials: ${status.trialsDone}/${status.trialsTotal} (${status.progressPct.toFixed(1)}%)
eta: ${status.etaFormatted}
rate: ${status.ratePerMin !== null ? status.ratePerMin.toFixed(2) + ' trials/min' : '—'}
active batch: ${status.activeBatch || '—'}
threads: ${status.threadsPct}%
anomalies: ${status.anomalyCount}

per-version progress:
${perVersionLines}

=== THEMES ALREADY USED (avoid these, find fresh metaphors) ===
${USED_THEMES.join(', ')}

=== YOUR THEME FOR THIS PIECE ===
${theme}

Now produce ONE fresh ASCII art piece. Output the art and NOTHING else.`;
}

export async function fetchAsciiArt(status: AggregatedStatus): Promise<AsciiPiece> {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  const [styleTexts] = await Promise.all([
    Promise.all(STYLE_FILES.map(f => fetchText(f).catch(() => ''))),
  ]);

  const styleRef = styleTexts.filter(t => t.length > 0).join('\n\n--- next file ---\n\n');
  if (!styleRef) {
    throw new Error('could not load style reference from GitHub');
  }

  const seed = Math.floor(Date.now() / 60000);
  const theme = pickTheme(seed);
  const prompt = buildPrompt(styleRef, status, theme);

  let lastErr = 'unknown error';
  for (const model of MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://deq710sia.github.io',
          'X-Title': 'Wankle Trials Dashboard',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 1800,
        }),
      });

      if (!res.ok) {
        lastErr = `${model}: HTTP ${res.status}`;
        continue;
      }

      const data = await res.json();
      if (data.error) {
        lastErr = `${model}: ${data.error.message}`;
        continue;
      }

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastErr = `${model}: empty response`;
        continue;
      }

      const cleaned = content
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      return {
        art: cleaned,
        theme,
        model,
        generatedAt: new Date().toISOString(),
      };
    } catch (e) {
      lastErr = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
  }

  throw new Error(lastErr);
}

// ── localStorage key management ─────────────────────────────────
const KEY_STORAGE = 'wankle_openrouter_key';

export function getOpenRouterKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY_STORAGE);
}

export function setOpenRouterKey(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY_STORAGE, key);
}

export function clearOpenRouterKey(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY_STORAGE);
}

// Type-only re-export to satisfy TS unused import warning if any
export type { StatusSnapshot, TrialManifest };
