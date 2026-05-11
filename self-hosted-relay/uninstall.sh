#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-legax-relay}"
INSTALL_DIR="${INSTALL_DIR:-/opt/legax-relay}"
CONFIG_DIR="${CONFIG_DIR:-/etc/legax-relay}"
DATA_DIR="${DATA_DIR:-/var/lib/legax-relay}"
PURGE=0

usage() {
  cat <<'USAGE'
Legax Relay uninstaller

Usage:
  sudo ./uninstall.sh [--purge]

Options:
  --purge     Remove config and relay data as well as service files
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "$@"
  fi
  echo "Please run as root or install sudo." >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICE_NAME.service"
  systemctl daemon-reload 2>/dev/null || true
fi

if command -v rc-service >/dev/null 2>&1; then
  rc-service "$SERVICE_NAME" stop 2>/dev/null || true
fi

if command -v rc-update >/dev/null 2>&1; then
  rc-update del "$SERVICE_NAME" default 2>/dev/null || true
fi

rm -f "/etc/init.d/$SERVICE_NAME"
rm -rf "$INSTALL_DIR"

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$CONFIG_DIR" "$DATA_DIR"
fi

echo "Legax Relay uninstalled."
if [ "$PURGE" -ne 1 ]; then
  echo "Config and data were kept. Rerun with --purge to remove them."
fi
