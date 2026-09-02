#!/usr/bin/env bash
# Run every GJS test file; non-zero exit on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."

rc=0
for f in test/*.test.js; do
  echo "== $f"
  gjs -m "$f" || rc=1
done

exit "$rc"