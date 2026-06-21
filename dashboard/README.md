# wankle-trials // live dashboard

A mobile-friendly, terminal-themed live dashboard for the wankle-trials
cheat-detection experiment. Reads data directly from this GitHub repo
(no VM dependency), so it stays up even if the trial VM resets.

**Live site:** https://deq710sia.github.io/wankle-trials/

## Features

- **Live telemetry** — polls `trial-manifest.json`, `status-snapshot.json`,
  `active-batch.txt`, and all 9 `parallel-*-results.csv` files every 10s
- **ASCII art stream** — generates a fresh themed piece every 5 minutes using
  OpenRouter free models (gemma-4 / llama-3.3 / qwen3). Style is bootstrapped
  from the existing `ascii-art/` folder so new pieces match the established look
- **ETA ticker** — live ETA based on the trial rate since watchdog launch
- **Per-version grid** — progress, per-map breakdown, avg kills/deaths/duration/fps,
  driver heartbeat status
- **Batch tracker** — visualizes the 3-batch sequence (current → A/B variants → reruns)
- **Anomaly feed** — shows anything the anomaly-detector.py flagged
- **Recent log activity** — watchdog / orchestrator / driver log tails
- **Mobile-first responsive** — works on phone or desktop
- **Terminal phosphor theme** — green-on-black with scanlines and glow effects

## How to use (first visit)

1. Open https://deq710sia.github.io/wankle-trials/
2. Click the **"○ set key"** button in the top-right header (or the
   "set OpenRouter key" button in the ASCII art section).
3. Paste your OpenRouter API key (starts with `sk-or-v1-...`).
   Get a free one at https://openrouter.ai/keys.
4. Click **save & test** — the key is validated and stored in your
   browser's localStorage. It never leaves your device except to call
   OpenRouter directly.
5. The ASCII art stream starts immediately and refreshes every 5 minutes.

The rest of the dashboard (telemetry, ETA, anomaly feed, logs) works
without any key — only the ASCII art stream needs it.

## Architecture (zero VM dependency, zero server cost)

- **Static export** — Next.js builds to a static `out/` folder. No server,
  no API routes, no database. Hosted on GitHub Pages (free).
- **All data fetched client-side** from `raw.githubusercontent.com` —
  the repo is public so no auth needed. 8-second in-memory cache smooths
  rapid polls.
- **ASCII art via OpenRouter** — called directly from the browser.
  OpenRouter sends `Access-Control-Allow-Origin: *` so browser calls work.
  The OpenRouter key is stored in `localStorage` and never sent to any
  server other than OpenRouter.
- **GitHub Actions auto-deploys** — every push to `main` that touches
  `dashboard/` triggers `.github/workflows/deploy-dashboard.yml`, which
  rebuilds the static site and pushes it to GitHub Pages.

## Why this design

The original trial VM is unreliable (kernel thread limit, periodic resets).
This dashboard never touches the VM — it only reads files the
`git-backup.sh` script commits to this repo every 5 minutes. So even if
the VM dies, the dashboard keeps serving the last known state and starts
showing fresh data the moment the next agent restores the VM.

The ASCII art generator uses OpenRouter's free tier (NOT GLM, per user
request). It loads 3 style-reference files from the repo's `ascii-art/`
folder as few-shot examples, so every piece matches the established visual
language (box-drawing characters, progress bars, themed vignettes).

## How the 5-minute refresh works

1. The dashboard page polls for live telemetry every **10 seconds**.
2. Every **5 minutes** it calls `fetchAsciiArt()` which:
   - Loads 3 reference files from `ascii-art/` in this repo
   - Loads the current trial status (manifest + snapshot)
   - Picks a unique theme from a 40-item pool (rotates per minute)
   - Calls OpenRouter (tries gemma-4-31b → llama-3.3-70b → qwen3 → gpt-oss)
   - Returns the generated ASCII art with a fade-in animation
3. A progress bar at the top of the ASCII section fills toward the next
   refresh, so you always know when the next piece is coming.

## File structure

```
dashboard/
├── src/
│   ├── app/
│   │   ├── globals.css             # terminal phosphor theme + scanlines
│   │   ├── layout.tsx              # dark mode forced, terminal font
│   │   └── page.tsx                # the dashboard UI (single page)
│   └── lib/
│       ├── github.ts               # raw.githubusercontent.com fetcher + cache
│       ├── status.ts               # aggregates all live data into one payload
│       ├── ascii-art.ts            # OpenRouter → ASCII art generation
│       ├── types.ts                # shared TypeScript types
│       └── format.ts               # progress bar / time / map name helpers
├── .env.example                    # reference only — keys go in localStorage
├── .gitignore
├── package.json
├── next.config.ts                  # output: 'export' + basePath: /wankle-trials
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
└── README.md (this file)

.github/workflows/deploy-dashboard.yml  # builds + deploys to Pages on push
```

## Local dev

```bash
cd dashboard
bun install
bun run dev
# open http://localhost:3000
```

Note: for local dev, you may need to temporarily remove `basePath` and
`output: 'export'` from `next.config.ts` since those are only needed for
the GitHub Pages deployment.

## Notes

- The 9-version batch tracker is hardcoded in `src/lib/status.ts`
  (the `BATCH_SEQUENCE` constant). If the batch sequence changes, update
  it there.
- The `T0` constant (watchdog launch timestamp) is also hardcoded — it's
  used to compute the trial rate. Update it if the watchdog restarts.
- The ASCII theme pool lives in `src/lib/ascii-art.ts` — feel
  free to add new themes to keep things fresh.
- All GitHub fetches go through an 8-second in-memory cache (in
  `src/lib/github.ts`) so rapid polls don't hit rate limits.
- Since the repo is public, no GITHUB_TOKEN is needed for read access.
