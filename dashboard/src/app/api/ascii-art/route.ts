// /api/ascii-art — generates a fresh ASCII art piece using OpenRouter
// (Gemini 2.0 Flash free tier, NOT GLM). Style reference is loaded from
// the existing ascii-art/ folder in the GitHub repo so the output matches
// the established style. Frontend polls this every ~60s for a continuous
// stream.

import { NextResponse } from 'next/server';
import { fetchText, fetchJson } from '@/lib/github';
import type { StatusSnapshot, TrialManifest } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel hobby tier cap

// Style reference files (the user said: "look at the small ones and the
// armada" — these are exactly those).
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
  'tree of life', 'chess knight',
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
  'a fiber optic cable pulsing with trial light',
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
];

interface StatusPayload {
  trialsDone: number;
  trialsTotal: number;
  progressPct: number;
  etaFormatted: string;
  ratePerMin: number | null;
  activeBatch: string;
  threadsPct: number;
  anomalyCount: number;
  perVersion: { version: string; completed: number; target: number }[];
}

function pickTheme(seed: number): string {
  // Pick a theme that has NOT been used yet, falling back to the pool
  // if everything has been used. Seed from current minute so the same
  // theme doesn't repeat within an hour.
  const idx = seed % THEME_POOL.length;
  return THEME_POOL[idx];
}

function buildPrompt(
  styleRef: string,
  status: StatusPayload,
  theme: string,
): string {
  // Trim style ref to keep prompt small — Gemini 2.0 Flash free has
  // 1M context but we don't need to send the entire file.
  const trimmedRef = styleRef.length > 4000
    ? styleRef.slice(0, 2000) + '\n...[snip]...\n' + styleRef.slice(-2000)
    : styleRef;

  const perVersionLines = status.perVersion
    .map(v => `  ${v.version.padEnd(20)} ${v.completed}/${v.target}`)
    .join('\n');

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

interface OpenRouterChoice {
  message?: { content?: string };
  error?: { message?: string };
}
interface OpenRouterResp {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
}

export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not set', art: null },
      { status: 500 },
    );
  }

  // Load style reference + status in parallel (all from GitHub, no localhost).
  const [styleTexts, snapshot, manifest] = await Promise.all([
    Promise.all(STYLE_FILES.map(f => fetchText(f).catch(() => ''))),
    fetchJson<StatusSnapshot>('status-snapshot.json').catch(() => null),
    fetchJson<TrialManifest>('trial-manifest.json').catch(() => null),
  ]);

  const styleRef = styleTexts.filter(t => t.length > 0).join('\n\n--- next file ---\n\n');
  if (!styleRef) {
    return NextResponse.json(
      { error: 'could not load style reference from GitHub', art: null },
      { status: 502 },
    );
  }

  // Build per-version list from manifest.
  const perVersion: StatusPayload['perVersion'] = [];
  if (manifest?.perVersion) {
    for (const [version, v] of Object.entries(manifest.perVersion)) {
      perVersion.push({
        version,
        completed: v.completed,
        target: v.target,
      });
    }
  }

  // Compute progress + ETA inline (mirror of /api/status logic).
  const T0 = new Date('2026-06-20T22:30:00Z').getTime();
  const trialsDone = manifest?.trialsCompleted ?? 0;
  const trialsTotal = manifest?.trialsTotal ?? 1350;
  const progressPct = trialsTotal > 0 ? (trialsDone / trialsTotal) * 100 : 0;
  const elapsedMin = (Date.now() - T0) / 60000;
  const ratePerMin = trialsDone > 0 && elapsedMin > 1 ? trialsDone / elapsedMin : null;
  const etaMin = ratePerMin !== null && ratePerMin > 0
    ? (trialsTotal - trialsDone) / ratePerMin
    : null;
  const etaFormatted = etaMin === null
    ? '—'
    : etaMin < 60
      ? `${Math.round(etaMin)} min`
      : `${Math.floor(etaMin / 60)}h ${Math.round(etaMin - Math.floor(etaMin / 60) * 60)}m`;

  const status: StatusPayload = {
    trialsDone,
    trialsTotal,
    progressPct,
    etaFormatted,
    ratePerMin,
    activeBatch: snapshot?.activeBatch ?? '',
    threadsPct: snapshot?.threads.pct ?? 0,
    anomalyCount: snapshot?.anomalies.length ?? 0,
    perVersion,
  };

  const seed = Math.floor(Date.now() / 60000); // changes each minute
  const theme = pickTheme(seed);
  const prompt = buildPrompt(styleRef, status, theme);

  // Call OpenRouter. Models we'll try in order.
  // GLM-4.5-air is the primary — cheap ($0.0001/gen), fast, good at ASCII art.
  // We disable reasoning so it returns content directly (not thinking tokens).
  // Free gemma models are fallback when GLM is unavailable.
  const models = [
    { id: 'z-ai/glm-4.5-air', disableReasoning: true },  // primary — cheap + fast
    { id: 'z-ai/glm-4.6', disableReasoning: true },       // bigger GLM fallback
    { id: 'google/gemma-4-31b-it:free', disableReasoning: false },  // free fallback
    { id: 'google/gemma-4-26b-a4b-it:free', disableReasoning: false },
    { id: 'openai/gpt-oss-20b:free', disableReasoning: false },
  ];

  let lastErr = 'unknown error';
  let rateLimited = false;
  for (const { id: model, disableReasoning } of models) {
    try {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 1800,
      };
      // GLM reasoning models burn tokens on "thinking" — disable so we get
      // actual content. Free models don't support this flag.
      if (disableReasoning) {
        body.reasoning = { enabled: false, exclude: true };
      }

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wankle-trials.vercel.app',
          'X-Title': 'Wankle Trials Dashboard',
        },
        body: JSON.stringify(body),
        next: { revalidate: 0 },
      });

      if (!res.ok) {
        lastErr = `${model}: HTTP ${res.status}`;
        if (res.status === 429) rateLimited = true;
        continue;
      }

      const data = await res.json() as OpenRouterResp;
      if (data.error) {
        lastErr = `${model}: ${data.error.message}`;
        if (data.error.message?.includes('rate limit') || data.error.message?.includes('Rate limit')) {
          rateLimited = true;
        }
        continue;
      }

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastErr = `${model}: empty content (reasoning burned all tokens?)`;
        continue;
      }

      // Clean: strip code fences if model wrapped output.
      const cleaned = content
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

      return NextResponse.json({
        art: cleaned,
        theme,
        model,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      lastErr = `${model}: ${e instanceof Error ? e.message : String(e)}`;
      continue;
    }
  }

  // OpenRouter exhausted (rate-limited or all models failed).
  // Fall back to Pollinations.ai — truly free, no key, no rate limit.
  // Quality is lower but always works. Better than a broken dashboard.
  if (rateLimited || lastErr.includes('rate')) {
    try {
      const pollRes = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt), {
        method: 'GET',
        headers: { 'User-Agent': 'wankle-dashboard/1.0' },
        next: { revalidate: 0 },
      });
      if (pollRes.ok) {
        const content = (await pollRes.text()).trim();
        if (content && content.length > 50) {
          const cleaned = content
            .replace(/^```[a-zA-Z]*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();
          return NextResponse.json({
            art: cleaned,
            theme,
            model: 'pollinations-openai-fast (fallback)',
            generatedAt: new Date().toISOString(),
            note: 'OpenRouter rate-limited, used Pollinations fallback',
          });
        }
      }
    } catch (e) {
      lastErr += ` | pollinations: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json(
    { error: lastErr, art: null },
    { status: 502 },
  );
}
