#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="tauri-app"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kill_existing() {
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
}

run_tauri_dev() {
  cd "$ROOT_DIR"
  npm run tauri dev
}

case "$MODE" in
  run)
    kill_existing
    run_tauri_dev
    ;;
  --debug|debug)
    kill_existing
    cd "$ROOT_DIR"
    RUST_BACKTRACE=1 npm run tauri dev
    ;;
  --logs|logs)
    kill_existing
    run_tauri_dev
    ;;
  --telemetry|telemetry)
    kill_existing
    run_tauri_dev
    ;;
  --verify|verify)
    kill_existing
    cd "$ROOT_DIR"
    npm run tauri dev > /tmp/tauri-app-dev.log 2>&1 &
    TauriPid=$!
    for _ in {1..60}; do
      if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
        echo "tauri-app is running"
        exit 0
      fi
      sleep 1
    done
    echo "tauri-app did not start. See /tmp/tauri-app-dev.log" >&2
    kill "$TauriPid" >/dev/null 2>&1 || true
    exit 1
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
