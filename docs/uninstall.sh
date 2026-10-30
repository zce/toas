#!/usr/bin/env bash
set -euo pipefail

UUID="toas@zce.me"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
DCONF_PATH="/org/gnome/shell/extensions/toas/"

CLEAN_DCONF=false

for arg in "$@"; do
  case "$arg" in
    --clean-dconf)
      CLEAN_DCONF=true
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--clean-dconf]" >&2
      exit 2
      ;;
  esac
done

if command -v gnome-extensions >/dev/null 2>&1; then
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
else
  echo "gnome-extensions was not found; removing the extension files anyway." >&2
fi

rm -rf -- "$TARGET_DIR"
# Only Toas-owned generated cue files; do not touch any other user cache.
rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/toas/earcons-v1"
rm -rf -- "${XDG_CACHE_HOME:-$HOME/.cache}/toas/earcons-v2"
rmdir -- "${XDG_CACHE_HOME:-$HOME/.cache}/toas" 2>/dev/null || true

if "$CLEAN_DCONF"; then
  if command -v dconf >/dev/null 2>&1; then
    dconf reset -f "$DCONF_PATH"
    echo "Cleared dconf: $DCONF_PATH"
  else
    echo "dconf was not found; settings were not cleared." >&2
  fi
fi

echo "Removed: $UUID"
