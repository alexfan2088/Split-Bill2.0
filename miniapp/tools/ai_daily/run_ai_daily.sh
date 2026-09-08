#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${SCRIPT_DIR}/.venv/bin/python"

if [[ ! -x "${PYTHON}" ]]; then
  echo "AI 日报依赖尚未安装，请先运行 ${SCRIPT_DIR}/install_launchd.sh" >&2
  exit 1
fi

exec "${PYTHON}" "${SCRIPT_DIR}/ai_daily.py" --send
