#!/usr/bin/env bash
# Run the headless GJS test suite; Shell-only tests require a real GNOME Shell session.
set -uo pipefail
cd "$(dirname "$0")/.."

rc=0
for f in test/*.test.js; do
  case "$f" in
    test/output-strategy.test.js|test/overlay-presenter.test.js|test/window-role.test.js)
      echo "== $f (shell-only, skipped headless)"
      continue
      ;;
  esac

  echo "== $f"
  gjs -m "$f" || rc=1
done

exit "$rc"
