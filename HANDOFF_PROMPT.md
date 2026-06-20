You are picking up a long-running trial suite for a Wankle3D tank game cheat. The previous agent ran 632/1350 trials across 9 cheat versions, then paused for handoff.

**IMMEDIATE FIRST STEP:** Clone the GitHub repo and read HANDOFF.md:

```bash
git clone https://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@github.com/Deq710sia/wankle-trials.git
cd wankle-trials
cat HANDOFF.md
```

The HANDOFF.md has everything you need:
- Current state (632/1350 trials, 3 baselines done, 3 contenders in progress, 3 A/B variants pending)
- Step-by-step setup (clone → copy files to working dirs → fix hunter bot → archive incomplete data → launch infrastructure)
- How to monitor (check every 5 min, create ASCII art between checks)
- How to troubleshoot (relaunch dead processes, watchdog monitors all 6 versions)
- Winner declaration criteria (when all 1350 trials done)

**Key points:**
1. All files are in the GitHub repo — clone it first, then copy to working directories per HANDOFF.md Step 2
2. **CRITICAL: Before launching, run `bash fix-hunter-bot-telemetry.patch.sh`** — the hunter bot was missing 11 telemetry fields. 262 trials need rerun with the fixed bot.
3. **Archive incomplete data (MOVE, don't delete)** — hunter-bot trials (RK Fight + Dungeon) have incomplete telemetry. Move them to `archive/incomplete-hunter-telemetry/` so nothing is overwritten.
4. Watchdog monitors ALL 6 versions (v19 v21.7 v22.8 v24 v25 v27) — baselines need hunter reruns too
5. Watchdog auto-launches A/B variants when v24+v25+v27 all hit 150/150 (no manual switching)
6. Git backup pushes to GitHub every 5 min — no data loss if VM dies
7. **Stay running** — check every 5 min, create ASCII art between checks (see `ascii-art/` for the tradition + upcoming milestones like 710 = DAB mural)
8. When all 1350 trials done → build comparison charts → declare winner → commit to GitHub

Read `ascii-art/README.md` for the mural schedule and style notes. The user specifically wants creative, non-repeating ASCII art between checks, and themed murals at milestones (675=halfway, 710=DAB/oil rig, 900=contenders done, 1350=final).

Do NOT ask the user questions. Read HANDOFF.md, set up, fix the bot, archive incomplete data, launch, monitor, finish.
