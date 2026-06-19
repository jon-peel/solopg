#!/usr/bin/env bash
#
# run-local.sh — fetch the latest PR branch and serve the World Oracle locally.
#
# WARNING: this hard-resets the working tree to match the remote branch tip
# (origin/$BRANCH). Any local edits to tracked files will be discarded. It is a
# tester's "always give me exactly what's on the PR" script, not an editing setup.
#
# Usage:  ./run-local.sh [PORT]   (PORT defaults to 8000)

set -euo pipefail

BRANCH="claude/refine-local-plan-lg3hiu"
PORT="${1:-8000}"

# Always operate on the repo this script lives in (so it serves index.html at root).
cd "$(dirname "$0")"

echo "Fetching latest from origin/$BRANCH ..."
git fetch origin "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo
echo "Running unit tests ..."
if ! node --test; then
  echo
  echo "Unit tests FAILED — not starting the server. Fix the failures above." >&2
  exit 1
fi
echo "Unit tests passed."

URL="http://localhost:$PORT"

# Best-effort: open the page in the default browser shortly after the server starts.
( sleep 1; { command -v open >/dev/null 2>&1 && open "$URL"; } \
        || { command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL"; }; ) >/dev/null 2>&1 || true &

echo
echo "Serving $URL  (Ctrl+C to stop)"
python3 -m http.server "$PORT"
