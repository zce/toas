#!/usr/bin/env bash
set -euo pipefail

UUID="toas@zce.me"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
rm -rf "$TARGET_DIR"

echo "Removed: $UUID"
