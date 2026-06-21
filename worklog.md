# Wankle3D Cheat Trials — Worklog

This is the single shared multi-agent worklog. All agents must read this before
starting work, and append a new section after finishing their task.

---
Task ID: setup
Agent: main (super-z, fresh session after VM reset)
Task: Resume the Wankle3D cheat trial suite from scratch — previous session's
working dir was wiped (no /home/z/agent-ctx/, no /home/z/my-project/scripts/cheat-tests/).
Repo at github.com/Deq710sia/wankle-trials (private) had the post-archive state
committed, but the patched hunter-bot-v3.js was NOT committed (lost in reset).

Work Log:
- Cloned repo to /home/z/my-project/wankle-trials/ using fresh PAT
  (ghp_t8K...; previous token ghp_h4AS... was auto-revoked by GitHub,
  probably by secret scanner after appearing in chat).
- Verified canon state from raw JSONL logs:
  * v19: 90 logs (CA=30, RK=0, Dun=0, DT-off=30, DT-on=30) — 60 RK+Dun to rerun
  * v21.7: 90 logs (same as v19)
  * v22.8: 90 logs (same as v19)
  * v24: 48 logs (CA=30, RK=18 with telemetry, Dun=0, DT=0) — 102 to run
  * v25: 57 logs (CA=30, RK=17, Dun=0, DT-off=5, DT-on=5) — 93 to run
  * v27: 48 logs (CA=30, RK=18, Dun=0, DT=0) — 102 to run
  * Total live: 423 trials. Archive has 262 (correctly archived by prev session).
  * Total target: 9 versions × 150 = 1350. Remaining: 927 trials.
- Confirmed previous session DID archive 262 incomplete trials
  (archive/incomplete-hunter-telemetry/ has 262 entries — matches).
- Confirmed previous session DID run ~53 new RK trials with patched bot
  (those logs have all 11 telemetry fields — verified).
- Confirmed hunter-bot-v3.js in repo is UNPATCHED (patch was lost with working dir).
- Set up /home/z/agent-ctx/ as the git-backed working repo (copied full repo +
  .git, then layered in active trial data). git-backup.sh will commit from here.
- Set up /home/z/my-project/scripts/cheat-tests/ with harness scripts, bots,
  CSVs, and per-version log directories.
- Backed up + deduplicated CSV headers (each CSV had 2 header rows — cosmetic
  issue from previous session, now 1 header per CSV).
- Wrote /home/z/my-project/scripts/cheat-tests/patch-hunter-bot-only.sh —
  applies ONLY the bot patch (not the auto-archive step, which was already
  done by previous session). Idempotent.
- Ran patch-hunter-bot-only.sh — hunter bot now has all 11 telemetry fields
  in sample push, syntax OK.
- Ran telemetry-field-validator.py — wrote expected-telemetry-fields.json
  (29 fields for hunter, 0 for passive/passive-nofire due to parser limitation
  with Object.assign syntax — not a problem, anomaly-detector skips empty
  expected field sets).
- Ran ONE 90s test trial (v19 RK Fight, trial 99, session=test-hunter) —
  verified all 29 expected fields PRESENT in JSONL samples. Patch works.
  Closed test-hunter session, cleaned up /tmp test files.
- Modified watchdog-wrapper.sh to read active versions from
  /home/z/agent-ctx/active-batch.txt (instead of hardcoded v19 v21.7 v22.8
  v24 v25 v27). This enables sequential 3-version batches.
- Modified watchdog.py to honor WANKLE_BATCH_MODE=1 env var:
  * Disables A/B auto-launch (was triggering 6 concurrent drivers when
    v24+v25+v27 all hit 150, blowing past kernel.threads-max=929).
  * Exits cleanly when current batch completes (wrapper restarts with next
    batch from active-batch.txt).
- Initialized active-batch.txt = "v24 v25 v27" (batch 1: contenders first).
- Backed up all modified files to /home/z/agent-ctx/archive/.

Stage Summary:
- Canon state verified, all setup steps complete.
- Hunter bot patched + verified.
- Batch mode infrastructure ready (3 concurrent drivers max).
- Ready to launch 5 wrappers + git-backup loop.
- Batch plan:
  * Batch 1: v24 v25 v27 (contenders — 297 trials to run, ~3.3 hours)
  * Batch 2: v19 v21.7 v22.8 (baselines — 180 trials to run, ~2 hours)
  * Batch 3: v27-no-pathguard v27-cap-pred8 v27-mag045 (A/B — 450 trials, ~5 hours)
  * Total wall-clock estimate: ~10-11 hours at 3 drivers parallel
- Lesson from previous session: NEVER kill bash drivers without
  `agent-browser --session p{ver} close` — Chrome processes orphan and
  accumulate, hitting thread limit.

---
Task ID: launch
Agent: main (super-z, fresh session after VM reset)
Task: Launch infrastructure and verify healthy operation.

Work Log:
- Verified clean state: 0 chrome procs, 40 threads before launch.
- Launched 5 wrappers + git-backup loop with setsid -f:
  * watchdog-wrapper.sh (monitors 3 versions from active-batch.txt)
  * manifest-updater-wrapper.sh
  * backup-manager-wrapper.sh
  * anomaly-detector-wrapper.sh
  * telemetry-field-validator-wrapper.sh
  * git-backup loop (every 5 min)
- T+30s: 16 infra procs, 6 driver procs (3 versions × 2 each), 42 chrome procs, 669 threads.
- T+3min: First new trials completed:
  * v24: 48→49 (just finished RK Fight t19, now on t20)
  * v25: 57→58 (just finished RK Fight t18, now on t19)
  * v27: 48→49 (just finished RK Fight t19, now on t20)
- All 3 drivers intelligently skipping already-done trials (CA t1-t30, RK t1-t17/18).
- manifest-updater: "appended 2 new trials, manifest refreshed" — working.
- backup-manager: backed up v24/v25/v27 (t30 milestone) — working.
- telemetry-field-validator: "All recent trials have complete telemetry fields" — working.
- git-backup: committed d609c65 to GitHub — working.

Stage Summary:
- Infrastructure fully operational at T+3min.
- Threads stable at 668/929 (headroom: 261).
- 3 drivers producing valid telemetry-rich trials.
- All 5 infra processes + git-backup confirmed working.
- Next: monitor every ~5 min, advance to batch 2 when v24/v25/v27 hit 150.

---
Task ID: batch-orchestrator
Agent: main (super-z)
Task: Set up automatic batch transitions: v24/v25/v27 → v27 A/B variants → v19/v21.7/v22.8 reruns. Do NOT pause running infrastructure.

Work Log:
- Read ascii-art/README.md + 02-armada-tide-turns.txt + 05-smaller-pieces.txt
  to learn the established style (progress bars in murals, themed vignettes
  between checks, every piece unique).
- Created batch-orchestrator.py: monitors watchdog.log for "BATCH COMPLETE"
  messages, advances active-batch.txt through the planned sequence:
    Batch 1: v24 v25 v27 (current)
    Batch 2: v27-no-pathguard v27-cap-pred8 v27-mag045
    Batch 3: v19 v21.7 v22.8
- Created batch-orchestrator-wrapper.sh (auto-restart wrapper).
- Fixed regex bug: needed re.DOTALL flag because the two log lines
  ("BATCH COMPLETE..." and "Batch was: [...]") are on separate lines.
  Verified regex with simulation test — matches correctly.
- Launched orchestrator with setsid -f (no pause to running infra).
- Killed + restarted ONLY the orchestrator python process to pick up the
  regex fix. Wrapper auto-restarted it within 5s. Drivers/watchdog untouched
  (verified same PIDs: 3306, 3329, 3335, 3352).

Stage Summary:
- Batch sequence is now fully autonomous:
  1. v24/v25/v27 currently running (58/67/58 of 150)
  2. When all hit 150 → watchdog exits cleanly → orchestrator detects
     BATCH COMPLETE → writes next batch to active-batch.txt → wrapper
     restarts watchdog with A/B variants
  3. When A/B variants hit 150 → same flow → v19/v21.7/v22.8 reruns
  4. When reruns hit 150 → orchestrator writes DONE marker
- All transitions happen without manual intervention.
- T+18min progress: +30 trials (5/min aggregate). Batch 1 ETA ~53 min.
- Total remaining ETA: ~3 hours (batch 1: 53min + batch 2: 90min + batch 3: 36min).

---
Task ID: preservation-and-backup
Agent: main (super-z)
Task: (1) Set up rerun data preservation — don't delete old data, separate it.
(2) Backup all my scripts + file edits to GitHub. (3) Evaluate OpenRouter for
ASCII generator.

Work Log:
- Verified archive folder IS already in GitHub (287 files including all 262
  incomplete trials at archive/incomplete-hunter-telemetry/).
- Created merge-archived-data.py: runs AFTER batch 3 completes. Adds an
  `incomplete` column to active per-version CSVs, then merges the old
  archived RK+Dun rows back in with incomplete=1. This preserves kill data
  while clearly marking it as telemetry-incomplete. Originals backed up to
  archive/pre-merge-archived-<timestamp>/ before modification. Idempotent.
- Wired merge-archived-data.py into batch-orchestrator.py: when all 3 batches
  complete + DONE marker is written, orchestrator runs the merge script
  automatically. No manual intervention needed.
- Also writes a README.md into archive/incomplete-hunter-telemetry/ documenting
  what's preserved, what's missing, and how the incomplete column works.
- Extended git-backup.sh (v2) to also push:
  * Patched hunter-bot-v3.js → bots/ (CRITICAL — was unpatched in repo)
  * All other bot .js files → bots/
  * expected-telemetry-fields.json → harness/
  * active-batch.txt → repo root
  * status-snapshot.json → repo root (live VM state for dashboard site)
  * all-batches-complete.flag → repo root (when batch 3 done)
  * ascii-art/live/*.txt → ascii-art/live/
  * worklog.md → repo root
- Backed up original git-backup.sh to archive/pre-git-backup-edit-<timestamp>/
  before modifying.
- Ran git-backup once to push everything immediately. Verified:
  * bots/hunter-bot-v3.js has 3 telemetry field references (patched version)
  * active-batch.txt, status-snapshot.json, worklog.md all in repo
  * expected-telemetry-fields.json in both bots/ and harness/
  * merge-archived-data.py in trial-data/scripts/
- Restarted batch-orchestrator.py (killed python, wrapper auto-restarted
  within 5s). Trials untouched — verified same driver PIDs.

Stage Summary:
- All my scripts + edits are now in GitHub. If the VM dies, the next agent
  clones the repo and gets:
  * Patched hunter bot (no need to re-patch)
  * All batch orchestration logic
  * Status snapshot generator
  * Merge script for rerun preservation
  * Full worklog of what was done
- Rerun preservation plan:
  * Old 262 archived trials stay in archive/incomplete-hunter-telemetry/
  * After batch 3 completes, merge-archived-data.py auto-runs
  * Active CSVs get an `incomplete` column
  * Old RK+Dun rows merged back in with incomplete=1
  * Analysis scripts filter WHERE incomplete=0 for clean data
  * Kill/death stats can include incomplete=1 rows (data is valid)
- OpenRouter evaluation:
  * YES, OpenRouter key would work much better than Pollinations
  * Pollinations free tier only has openai-fast (reasoning model that
    returns JSON reasoning traces instead of plain text)
  * GET endpoint works but hits 414 URI Too Large for prompts >3KB
  * OpenRouter has free models: google/gemini-2.0-flash-exp:free,
    meta-llama/llama-3.2-3b-instruct:free, mistralai/mistral-7b-instruct:free
  * Standard OpenAI-compatible POST API (no URL length limits)
  * Returns clean text (no reasoning traces)
  * User offered to provide an OpenRouter key — waiting for it.
