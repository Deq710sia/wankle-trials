#!/bin/bash
# git-backup.sh — runs every 5 minutes, commits + pushes all trial data.
# Survives session end because it's launched with setsid -f.
cd /home/z/agent-ctx || exit 1

# Refresh trial data copies from source locations
mkdir -p trial-data/csvs trial-data/scripts trial-data/logs
cp /home/z/my-project/scripts/cheat-tests/parallel-*-results.csv trial-data/csvs/ 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/*.py trial-data/scripts/ 2>/dev/null
cp /home/z/my-project/scripts/cheat-tests/*.sh trial-data/scripts/ 2>/dev/null
cp /home/z/my-project/download/wankle-cheat-v*.user.js trial-data/ 2>/dev/null

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
