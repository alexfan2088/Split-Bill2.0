#!/usr/bin/env bash
set -euo pipefail

LOG="${HOME}/Library/Logs/ai-daily-awake.log"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Keeping Mac awake and prewarming Chrome/Gmail"
  /usr/bin/caffeinate -dimsu -t 1800 &
  CAFFEINATE_PID=$!

  /usr/bin/osascript \
    -e 'with timeout of 60 seconds' \
    -e 'tell application "Google Chrome" to activate' \
    -e 'delay 5' \
    -e 'tell application "Google Chrome" to open location "https://mail.google.com/mail/u/0/#inbox"' \
    -e 'delay 15' \
    -e 'tell application "System Events" to set frontmost of process "Google Chrome" to true' \
    -e 'end timeout' || true

  wait "${CAFFEINATE_PID}"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Awake window completed"
} >>"${LOG}" 2>&1
