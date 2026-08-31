#!/usr/bin/env bash
set -euo pipefail

UUID="voice-prompt@local"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

for cmd in glib-compile-schemas gnome-extensions; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

if ! command -v pw-record >/dev/null 2>&1; then
  echo "Missing pw-record. On Fedora: sudo dnf install pipewire-utils" >&2
  exit 1
fi

gnome-extensions disable "$UUID" >/dev/null 2>&1 || true

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

cp "$SOURCE_DIR/metadata.json" "$TARGET_DIR/"
cp "$SOURCE_DIR/extension.js" "$TARGET_DIR/"
cp "$SOURCE_DIR/prefs.js" "$TARGET_DIR/"
cp "$SOURCE_DIR/stylesheet.css" "$TARGET_DIR/"
cp -R "$SOURCE_DIR/lib" "$TARGET_DIR/"
cp -R "$SOURCE_DIR/schemas" "$TARGET_DIR/"

glib-compile-schemas "$TARGET_DIR/schemas"

if gnome-extensions enable "$UUID" 2>/dev/null; then
  echo "Installed and enabled: $UUID"
else
  echo "Installed: $UUID"
  echo "GNOME may need to discover the new extension first."
  echo "Log out/in once, then run: gnome-extensions enable $UUID"
fi

echo
echo "Open preferences:"
echo "  gnome-extensions prefs $UUID"
