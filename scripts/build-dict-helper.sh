#!/usr/bin/env bash
# Builds the universal (arm64 + x86_64, macOS 13+) dict-lookup helper into resources/bin/dict-lookup.
# macOS only: elsewhere it prints a note and exits 0 so other scripts keep working.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-dict-helper: skipped (needs macOS: swiftc + lipo). Run 'npm run dist:mac' on a Mac."
  exit 0
fi
cd "$(dirname "$0")/.."
OUT="resources/bin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
swiftc -O -target arm64-apple-macos13 native/dict-lookup.swift -o "$TMP/dict-lookup-arm64"
swiftc -O -target x86_64-apple-macos13 native/dict-lookup.swift -o "$TMP/dict-lookup-x86_64"
lipo -create "$TMP/dict-lookup-arm64" "$TMP/dict-lookup-x86_64" -output "$OUT/dict-lookup"
chmod 755 "$OUT/dict-lookup"
echo "build-dict-helper: built $OUT/dict-lookup ($(lipo -archs "$OUT/dict-lookup"))"
