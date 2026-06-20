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

**Telemetry integrity system**: 5 infrastructure processes (not 4) — the 5th is `telemetry-field-validator` which auto-detects bot source changes and updates the anomaly detector's field expectations. The anomaly detector now checks ALL telemetry fields on EVERY trial. This prevents bugs like the hunter-bot gap from going undetected. See HANDOFF.md "TELEMETRY INTEGRITY SYSTEM" section.

═══════════════════════════════════════════════════════════════════
FINAL RULES — READ THESE LAST
═══════════════════════════════════════════════════════════════════

1. NEVER BLINDLY TRUST FILES. The manifest said "638 trials" but reality was 632 — 6 phantom entries. The hunter bot "had telemetry" but actually didn't write it to samples. Always VERIFY against raw logs. Raw JSONL logs are the source of truth, not CSVs, not the manifest, not trials.jsonl. If something seems wrong, check the raw logs.

2. ALWAYS DOUBLE-CHECK. Before launching trials, manually inspect ONE trial's JSONL log to confirm telemetry fields are present. Before declaring a version "complete," verify the CSV row count matches the raw log file count. Before trusting the anomaly detector, verify it's actually catching things.

3. KEEP IT SIMPLE. The bot scripts and telemetry collection should be dead simple. If you're adding complexity, you're adding failure modes. The hunter-bot gap happened because the bot READ telemetry into variables but never WROTE them to the sample output — a simple oversight that complex code hides. Prefer explicit, verbose, obvious code over clever abstractions.

4. TEST BEFORE TRUSTING. After patching any bot, run ONE trial manually and inspect the JSONL output before letting the full suite run. A 90-second test saves 9 hours of reruns.

5. THE USER IS WATCHING. They caught the hunter-bot gap. They caught the stale manifest. They caught the phantom entries. They will catch your mistakes too. Be honest about what you find, even if it's bad news.

6. ARCHIVE, DON'T DELETE. Never delete data. Move it to archive/. You might need it later. The old hunter-bot trials still have valid kill/death data even without dodge telemetry.

7. STAY RUNNING. The user wants you to monitor continuously, create ASCII art between checks, and not stop until all 1350 trials are done. If the Bash tool times out, tell the user to restart — but the infrastructure keeps running autonomously.

8. WHEN IN DOUBT, CHECK THE RAW LOGS. They are the single source of truth. Everything else (CSV, manifest, trials.jsonl, telemetry JSON) is derived and can be rebuilt.
