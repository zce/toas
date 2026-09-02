#!/usr/bin/env bash
set -euo pipefail

ARCHIVE_URL="https://github.com/zce/toas/archive/refs/heads/main.tar.gz"
TEMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TEMP_DIR/toas.tar.gz"
SOURCE_DIR="$TEMP_DIR/toas-main"

cleanup () {
  rm -rf -- "$TEMP_DIR"
}

trap cleanup EXIT

for command_name in curl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

echo "Downloading toas from GitHub..."
curl --fail --silent --show-error --location \
  --retry 3 --retry-delay 1 \
  "$ARCHIVE_URL" \
  --output "$ARCHIVE_PATH"

tar --extract --gzip --file "$ARCHIVE_PATH" --directory "$TEMP_DIR"

if [[ ! -x "$SOURCE_DIR/install.sh" ]]; then
  echo "The downloaded toas archive is missing install.sh" >&2
  exit 1
fi

"$SOURCE_DIR/install.sh"
