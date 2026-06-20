#!/bin/bash
# Runs telemetry-field-validator.py every 5 minutes.
# Re-parses bot source files to detect new telemetry fields.
# Updates expected-telemetry-fields.json (read by anomaly-detector).
set -u
LOG=/home/z/my-project/scripts/cheat-tests/telemetry-field-validator.log
WRAPPER_LOG=/home/z/my-project/scripts/cheat-tests/telemetry-field-validator-wrapper.log

ts() { date '+%H:%M:%S'; }

while true; do
  echo "[$(ts)] wrapper: launching telemetry-field-validator.py" >> "$WRAPPER_LOG"
  python3 -u /home/z/my-project/scripts/cheat-tests/telemetry-field-validator.py >> "$LOG" 2>&1
  sleep 300  # every 5 min
done
