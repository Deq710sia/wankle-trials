# Wankle3D Cheat Trials

Trial infrastructure for A/B testing Wankle3D cheat versions against bot fleets.

## Quick Navigation

| Looking for... | Go to... |
|---|---|
| **v27 (current contender)** | `cheat-versions/v27.user.js` |
| **All cheat versions v19→v27** | `cheat-versions/` |
| **Trial results summary** | `trial-data/trials.jsonl` (one line per trial) |
| **Progress manifest** | `trial-data/trial-manifest.json` |
| **Per-trial frame data** | `trial-data/telemetry/{version}/{map}/trial-NNN.json` |
| **Test infrastructure scripts** | `harness/` |
| **Bot scripts (passive/hunter)** | `bots/` |
| **Drop-in code snippets** | `snippets/` |
| **Continuation guide** | `docs/CONTINUATION_GUIDE.md` |

## Directory Structure

```
wankle-trials/
├── README.md                    ← you are here
├── cheat-versions/              ← all cheat .user.js files (v19 → v27)
│   ├── v27.user.js              ← CURRENT CONTENDER (v25 + magnetize fix + Tier-2 prediction)
│   ├── v25.user.js              ← path-segment guard + 360° dodge + burst fire
│   ├── v24.user.js              ← pre-magnetize-fix baseline
│   ├── v22.8.user.js            ← baseline (cold-spot + per-shell vector dodge)
│   ├── v21.7.user.js            ← baseline (pre-cold-spot, simple vector dodge)
│   ├── v19.user.js              ← earliest simple version
│   └── ... (all versions v19-v27)
├── snippets/                    ← drop-in code blocks for porting into cheat versions
│   ├── prediction-engine-snippet.js   ← Tier 1+2 leadAim rewrite
│   ├── dodge-magnetize-fix.js         ← root-cause fix for "moves toward bullets"
│   └── iteration-agent-prompt.md      ← design doc for v26/v27 changes
├── harness/                     ← test infrastructure (scripts)
│   ├── generic-trials.sh        ← main trial driver (one version, N trials)
│   ├── survival-showdown-parallel.sh  ← per-trial harness (browser + inject + run)
│   ├── watchdog.py              ← bare-minimum driver monitor (restart on death)
│   ├── manifest-updater.py      ← writes trial-manifest.json + trials.jsonl
│   ├── backup-manager.py        ← backups + retention (every 30 trials)
│   ├── anomaly-detector.py      ← scans for bad trials, removes for re-run
│   ├── telemetry-backfill.py    ← generates missing Tier-1 telemetry files
│   ├── telemetry-writer.py      ← converts JSONL log → Tier-1 telemetry JSON
│   └── ... (analysis scripts, chart builders, old harness versions)
├── bots/                        ← bot scripts that drive the player tank
│   ├── passive-bot.js           ← passive bot (fires only for respawn, logs telemetry)
│   ├── passive-nofire-bot.js    ← pure dodge bot (never fires)
│   ├── hunter-bot-v3.js         ← aggressive hunter bot
│   └── human-bot.js             ← human-like bot
├── trial-data/                  ← THE RESULTS
│   ├── trials.jsonl             ← summary JSONL (one line per trial) — MOST IMPORTANT
│   ├── trial-manifest.json      ← progress tracking (single source of truth)
│   ├── csvs/                    ← per-version CSV files (raw trial rows)
│   ├── logs/                    ← per-version JSONL logs (frame-by-frame samples)
│   └── telemetry/               ← Tier-1 telemetry files (per-trial JSON with frame data)
├── docs/
│   └── CONTINUATION_GUIDE.md    ← how to resume if context resets
├── archive/                     ← legacy/duplicate files (don't rely on these)
├── git-backup.sh                ← auto-pushes to GitHub every 5 min
└── .gitignore
```

## Trial Plan (Current)

**Phase 1 — Baselines (running now):**
- v19, v21.7, v22.8 × 30 trials × 5 maps = 450 trials

**Phase 2 — Contenders (after baselines):**
- v24, v25, v27 × 30 trials × 5 maps = 450 trials

**Phase 3 — A/B variants (if v27 wins):**
- v27 + path-guard disabled
- v27 + predicted-shell cap at 8
- v27 + magnetize threshold 0.35→0.45

**Total: 900-1350 trials, ~6-12 hours wall clock**

## Maps

| Code | Map name | Mode | Notes |
|---|---|---|---|
| CA | Custom Arena | survival | open map, 6-7 enemies |
| RK | RK Fight | survival | wall-dense, bank shots |
| Dun | Dungeon | survival | small map, corner deaths |
| DT-off | Dodge Training (aimbot OFF) | campaign | 72 enemies, pure dodge test |
| DT-on | Dodge Training (aimbot ON) | campaign | 72 enemies, realistic (fire-stun) |

## Running Infrastructure

4 independent processes (each auto-restarts via bash wrapper):

1. **watchdog.py** — monitors drivers, restarts if dead/hung
2. **manifest-updater.py** — writes manifest + trials.jsonl every 30s
3. **backup-manager.py** — backups every 30 trials + pre-switch on completion
4. **anomaly-detector.py** — scans for bad trials every 60s, removes for re-run

Plus:
- **git-backup.sh** — pushes to GitHub every 5 min
- **generic-trials.sh** — one per version, runs trials sequentially

## GitHub Repo

`https://github.com/Deq710sia/wankle-trials` (private)

Auto-pushed every 5 minutes by `git-backup.sh`. Even if the VM dies, you lose at most 5 minutes of data.

## Known Issues (read before starting)

1. **Telemetry gap:** 533 of 638 trials have `telemetryFile=null` in trials.jsonl. Run `python3 harness/telemetry-backfill.py` once after setup to generate the missing per-trial telemetry JSON files. See HANDOFF.md Step 3a-ter.

2. **webgpu-polyfill.js:** This file is in the repo root and MUST be copied to `/tmp/webgpu-polyfill.js` before starting trials. Without it, the browser harness fails to load Wankle3D and all trials produce K=0 D=0 (immobile cheat bug). See HANDOFF.md Step 3a-bis.

3. **watchdog-wrapper.sh version list:** The wrapper monitors `v24 v25 v27` (contenders still in progress). If you need to change which versions are monitored (e.g., after contenders complete), edit the wrapper and restart. See HANDOFF.md Step 3c.

4. **HUNTER-BOT TELEMETRY GAP (CRITICAL):** The `hunter-bot-v3.js` is missing dodge telemetry fields (realShells, predictedShells, pathGuardCrosses, dodgeMoveX/Z) in its sample output. 262 existing trials (RK Fight + Dungeon) + 180 future A/B variant trials need (re)running with the fixed bot. See HANDOFF.md "CRITICAL: HUNTER-BOT TELEMETRY GAP" for fix steps.

5. **A/B variant auto-launch:** When v24+v25+v27 all hit 150/150, the watchdog auto-launches 3 A/B variants (v27-no-pathguard, v27-cap-pred8, v27-mag045). No manual intervention needed.

## Key Files for New Session

If your context resets, read these first:
1. `HANDOFF.md` — complete setup + monitoring guide (START HERE)
2. `trial-manifest.json` — current progress + file locations
3. `CONTINUATION_GUIDE.md` — detailed infrastructure reference
4. `trials.jsonl` — all trial results (one line per trial)
5. `ascii-art/README.md` — mural schedule + style notes for monitoring art
