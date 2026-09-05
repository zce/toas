#!/usr/bin/env bash
# Release readiness checks (ticket 19): syntax, schema, package content,
# full test suite. Non-zero exit on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."

rc=0
step() { echo; echo "== $1"; }

step "Syntax check: every JS file parses"
for f in $(find . -maxdepth 3 -name "*.js" -not -path "./.git/*" -not -path "./.scratch/*" -not -path "./node_modules/*" -not -path "./docs/*"); do
  if ! gjs -m "$f" >/dev/null 2>&1; then
    # Distinguish parse errors from Shell-only import failures.
    err=$(gjs -m "$f" 2>&1)
    if echo "$err" | grep -qE 'SyntaxError|is not defined|is not a function'; then
      echo "PARSE ERROR in $f:"
      echo "$err" | head -3
      rc=1
    fi
  fi
done
[ "$rc" -eq 0 ] && echo "ok"

step "Schema compiles strictly"
tmp=$(mktemp -d)
cp -R schemas "$tmp/"
glib-compile-schemas --strict "$tmp/schemas" && echo "ok" || rc=1
rm -rf "$tmp"

step "Package content: runtime files present, scratch excluded"
REQUIRED="extension.js prefs.js prefs.css stylesheet.css metadata.json"
for f in $REQUIRED; do
  [ -f "$f" ] || { echo "missing $f"; rc=1; }
done
LIB_FILES=$(find lib -name '*.js' | wc -l)
echo "lib modules: $LIB_FILES"
if find lib -name '*.js' | grep -v 'test-integrated.js' | grep -qE 'test|spec|probe'; then
  echo "scratch-looking files in lib/"; rc=1
fi
[ "$rc" -eq 0 ] && echo "ok"

step "Import graph: relative imports resolve and named exports exist"
gjs -m test/imports.test.js >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

step "Metadata is valid JSON with version and shell versions"
gjs -m test/metadata.test.js >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

step "Full test suite"
./test/run-all.sh >/dev/null 2>&1 && echo "ok" || { echo "FAILED"; rc=1; }

echo
if [ "$rc" -eq 0 ]; then echo "RELEASE READINESS: all checks passed"; else echo "RELEASE READINESS: FAILURES"; fi
exit "$rc"