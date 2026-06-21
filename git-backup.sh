#!/bin/bash
# git-backup.sh — runs every 5 minutes, commits + pushes all trial data.
# Survives session end because it's launched with setsid -f.
#
# v2 (2026-06-21): extended to also push:
#   - Patched hunter-bot-v3.js → bots/ (overwrite unpatched)
#   - All bot .js files → bots/
#   - expected-telemetry-fields.json → harness/
#   - active-batch.txt → repo root
#   - status-snapshot.json → repo root (live VM state for dashboard)
#   - ascii-art/live/*.txt → ascii-art/live/ (generated art pieces)
#   - worklog.md → repo root (multi-agent worklog)
cd /home/z/agent-ctx || exit 1

# Refresh trial data copies from source locations
mkdir -p trial-data/csvs trial-data/scripts trial-data/logs
cp /home/z/my-project/scripts/cheat-tests/parallel-*-results.csv trial-data/csvs/ 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/*.py trial-data/scripts/ 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/*.sh trial-data/scripts/ 2>/dev/null
cp /home/z/my-project/download/wankle-cheat-v*.user.js trial-data/ 2>/dev/null

# v2: Copy patched bots to bots/ (overwrite unpatched versions in repo)
mkdir -p bots
cp /home/z/my-project/scripts/cheat-tests/hunter-bot-v3.js bots/hunter-bot-v3.js 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/passive-bot.js bots/passive-bot.js 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/passive-nofire-bot.js bots/passive-nofire-bot.js 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/human-bot.js bots/human-bot.js 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/test-bot-v2.js bots/test-bot-v2.js 2>/dev/null

# v2: Copy expected-telemetry-fields.json to harness/ (so anomaly detector
# knows what fields to expect without re-running the validator)
mkdir -p harness
cp /home/z/my-project/scripts/cheat-tests/expected-telemetry-fields.json harness/ 2>/dev/null

# v2: Copy active-batch.txt to repo root (batch orchestrator state)
cp /home/z/agent-ctx/active-batch.txt . 2>/dev/null

# v2: Copy status-snapshot.json to repo root (live VM state for dashboard site)
cp /home/z/agent-ctx/status-snapshot.json . 2>/dev/null

# v2: Copy all-batches-complete.flag if it exists
cp /home/z/agent-ctx/all-batches-complete.flag . 2>/dev/null

# v2: Copy generated ASCII art pieces to ascii-art/live/
mkdir -p ascii-art/live
cp /home/z/agent-ctx/ascii-art/live/*.txt ascii-art/live/ 2>/dev/null

# v2: Copy worklog.md to repo root
cp /home/z/my-project/worklog.md . 2>/dev/null

# Refresh JSONL logs (rsync-style: remove stale, copy new)
# Includes ALL versions: baselines + contenders + A/B variants
for v in v19 v21.7 v22.8 v24 v25 v27 v27-no-pathguard v27-cap-pred8 v27-mag045; do
  src="/home/z/my-project/scripts/cheat-tests/parallel-${v}-logs"
  dst="trial-data/logs/${v}-logs"
  if [ -d "$src" ]; then
    rm -rf "$dst"
    cp -r "$src" "$dst"
  fi
done

# Commit + push
git add -A
git commit -m "auto-backup $(date -u +%Y%m%d_%H%M%S)" 2>/dev/null
git push origin main 2>/dev/null || git push origin master 2>/dev/null
