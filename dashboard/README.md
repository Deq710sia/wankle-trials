# wankle-trials // live dashboard

A mobile-friendly, terminal-themed live dashboard for the wankle-trials
cheat-detection experiment. Reads data directly from this GitHub repo
(no VM dependency), so it stays up even if the trial VM resets.

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

## Quick deploy (free, ~3 minutes)

1. **Push this dashboard subfolder to a fresh GitHub repo** (or just use
   `Deq710sia/wankle-trials` itself — Vercel will only build the dashboard
   subfolder).

2. Go to **https://vercel.com/new** → import the repo.

3. In Vercel's "Configure Project" screen:
   - **Root Directory** → click "Edit" → select `dashboard`
   - **Framework Preset** → Next.js (auto-detected)
   - **Build Command** → leave as default (`next build`)
   - **Output Directory** → leave as default
   - **Install Command** → leave as default

4. Open **Environment Variables** and add:
   | Name | Value | Required |
   |---|---|---|
   | `OPENROUTER_API_KEY` | `sk-or-v1-...` (from https://openrouter.ai/keys) | ✅ |
   | `GITHUB_TOKEN` | `ghp_...` (fine-grained PAT, read-only) | ✅ recommended |
   | `GITHUB_REPO` | `Deq710sia/wankle-trials` | optional (default) |
   | `GITHUB_BRANCH` | `main` | optional (default) |

5. Click **Deploy**. Site is live in ~2 minutes at
   `https://wankle-trials.vercel.app` (or whatever Vercel names it).

6. **That's it.** The site will work instantly — no database, no VM, no
   websockets. It just polls GitHub on a 10-second cadence.

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

1. The dashboard page polls `/api/status` every **10 seconds** for live
   telemetry (progress, ETA, anomaly count, log tails).
2. Every **5 minutes** it calls `/api/ascii-art` which:
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
│   │   ├── api/
│   │   │   ├── status/route.ts     # aggregates all live data from GitHub
│   │   │   └── ascii-art/route.ts  # OpenRouter → ASCII art generation
│   │   ├── globals.css             # terminal phosphor theme + scanlines
│   │   ├── layout.tsx              # dark mode forced, terminal font
│   │   └── page.tsx                # the dashboard UI (single page)
│   ├── lib/
│   │   ├── github.ts               # raw.githubusercontent.com fetcher + cache
│   │   ├── types.ts                # shared TypeScript types
│   │   └── format.ts               # progress bar / time / map name helpers
│   └── components/ui/              # shadcn/ui components (unused but kept)
├── .env.example
├── .gitignore
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
└── README.md (this file)
```

## Local dev

```bash
cd dashboard
cp .env.example .env
# fill in OPENROUTER_API_KEY and GITHUB_TOKEN
bun install
bun run dev
# open http://localhost:3000
```

## Notes

- The 9-version batch tracker is hardcoded in `src/app/api/status/route.ts`
  (the `BATCH_SEQUENCE` constant). If the batch sequence changes, update
  it there.
- The `T0` constant (watchdog launch timestamp) is also hardcoded — it's
  used to compute the trial rate. Update it if the watchdog restarts.
- The ASCII theme pool lives in `src/app/api/ascii-art/route.ts` — feel
  free to add new themes to keep things fresh.
- All GitHub fetches go through an 8-second in-memory cache (in
  `src/lib/github.ts`) so rapid polls don't hit rate limits.
