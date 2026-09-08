#!/usr/bin/env bash
set -euo pipefail

LABEL="com.alexfan.ai-daily"
SRC="/Users/fwp-mac/dev/Split-Bill2.0/miniapp/tools/ai_daily/${LABEL}.plist"
DST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
AWAKE_LABEL="com.alexfan.ai-daily-awake"
AWAKE_SRC="/Users/fwp-mac/dev/Split-Bill2.0/miniapp/tools/ai_daily/${AWAKE_LABEL}.plist"
AWAKE_DST="${HOME}/Library/LaunchAgents/${AWAKE_LABEL}.plist"
SCRIPT_DIR="/Users/fwp-mac/dev/Split-Bill2.0/miniapp/tools/ai_daily"
VENV_DIR="${SCRIPT_DIR}/.venv"

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs" "${HOME}/.codex/ai_daily/out"
chmod +x "/Users/fwp-mac/dev/Split-Bill2.0/miniapp/tools/ai_daily/ai_daily.py"
chmod +x "/Users/fwp-mac/dev/Split-Bill2.0/miniapp/tools/ai_daily/ai_daily_awake.sh"
chmod +x "${SCRIPT_DIR}/run_ai_daily.sh"
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  /opt/homebrew/bin/python3 -m venv "${VENV_DIR}"
fi
"${VENV_DIR}/bin/python" -m pip install -r "${SCRIPT_DIR}/requirements.txt"
plutil -lint "${SRC}"
cp "${SRC}" "${DST}"
chmod 644 "${DST}"
plutil -lint "${AWAKE_SRC}"
cp "${AWAKE_SRC}" "${AWAKE_DST}"
chmod 644 "${AWAKE_DST}"

launchctl bootout "gui/$(id -u)" "${DST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${DST}"
launchctl enable "gui/$(id -u)/${LABEL}"
launchctl bootout "gui/$(id -u)" "${AWAKE_DST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${AWAKE_DST}"
launchctl enable "gui/$(id -u)/${AWAKE_LABEL}"
launchctl print "gui/$(id -u)/${LABEL}" | sed -n '1,80p'
launchctl print "gui/$(id -u)/${AWAKE_LABEL}" | sed -n '1,80p'
