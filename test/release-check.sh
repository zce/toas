#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

rc=0
step() { echo; echo "== $1"; }

step "Package content"
for path in kernel kernel/providers ui schemas; do
  [ -d "$path" ] || { echo "missing $path"; rc=1; }
done
for path in extension.js prefs.js prefs.css stylesheet.css metadata.json; do
  [ -f "$path" ] || { echo "missing $path"; rc=1; }
done
[ "$rc" -eq 0 ] && echo "ok"

step "Schema compiles strictly"
tmp=$(mktemp -d)
cp -R schemas "$tmp/"
glib-compile-schemas --strict "$tmp/schemas" && echo "ok" || rc=1
rm -rf "$tmp"

step "Import graph"
gjs -m test/imports.test.js >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

step "Metadata"
gjs -m test/metadata.test.js >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

step "Full test suite"
./test/run-all.sh >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

echo
if [ "$rc" -eq 0 ]; then
  echo "RELEASE READINESS: all checks passed"
else
  echo "RELEASE READINESS: FAILURES"
fi
exit "$rc"
