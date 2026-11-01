#!/usr/bin/env bash
set -euo pipefail

UUID="toas@zce.me"
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

PARENT_DIR="$(dirname "$TARGET_DIR")"
mkdir -p "$PARENT_DIR"
STAGING_DIR="$(mktemp -d "$PARENT_DIR/.toas-staging.XXXXXX")"
BACKUP_DIR=""
INSTALL_STARTED=false
REPLACEMENT_STARTED=false

cleanup() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    if [[ -n "$BACKUP_DIR" && ( -e "$BACKUP_DIR" || -L "$BACKUP_DIR" ) ]]; then
      rm -rf -- "$TARGET_DIR"
      mv -- "$BACKUP_DIR" "$TARGET_DIR" || echo "Could not restore previous installation: $BACKUP_DIR" >&2
    elif [[ "$REPLACEMENT_STARTED" == true ]]; then
      rm -rf -- "$TARGET_DIR"
    fi
    if [[ "$INSTALL_STARTED" == true ]]; then
      gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
    fi
  elif [[ -n "$BACKUP_DIR" ]]; then
    rm -rf -- "$BACKUP_DIR"
  fi
  rm -rf -- "$STAGING_DIR"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp "$SOURCE_DIR"/*.js "$STAGING_DIR/"
cp "$SOURCE_DIR"/metadata.json "$STAGING_DIR/"
cp "$SOURCE_DIR"/prefs.css "$STAGING_DIR/"
cp "$SOURCE_DIR"/stylesheet.css "$STAGING_DIR/"
cp -R "$SOURCE_DIR"/host "$STAGING_DIR/"
cp -R "$SOURCE_DIR"/kernel "$STAGING_DIR/"
cp -R "$SOURCE_DIR"/ui "$STAGING_DIR/"
cp -R "$SOURCE_DIR"/schemas "$STAGING_DIR/"

glib-compile-schemas --strict "$STAGING_DIR/schemas"

gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
INSTALL_STARTED=true
if [[ -e "$TARGET_DIR" || -L "$TARGET_DIR" ]]; then
  BACKUP_DIR="$(mktemp -d "$PARENT_DIR/.toas-backup.XXXXXX")"
  rmdir "$BACKUP_DIR"
  mv -- "$TARGET_DIR" "$BACKUP_DIR"
fi
REPLACEMENT_STARTED=true
mv -- "$STAGING_DIR" "$TARGET_DIR"

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
