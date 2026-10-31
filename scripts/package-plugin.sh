#!/bin/sh
# Builds the plugin ZIP for directory submission from the committed files only.
# Usage: sh scripts/package-plugin.sh  →  dist/context-trim-<version>.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
mkdir -p dist
OUT="dist/context-trim-$VERSION.zip"
rm -f "$OUT"
git archive --format=zip -o "$OUT" HEAD -- \
  .claude-plugin .codex-plugin .mcp.json skills assets bin src \
  package.json README.md PRIVACY.md TERMS.md LICENSE
echo "$OUT"
