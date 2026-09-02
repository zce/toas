#!/usr/bin/env bash
set -euo pipefail

UUID="toas@zce.me"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
else
  echo "gnome-extensions was not found; removing the extension files anyway." >&2
fi

rm -rf -- "$TARGET_DIR"

echo "Removed: $UUID"
