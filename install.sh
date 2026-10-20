#!/usr/bin/env bash
# Smart Reader installer/updater for macOS.
# Usage: curl -fsSL <raw url>/install.sh | bash      (or: bash install.sh)
set -euo pipefail

REPO="${SMART_READER_REPO:-afreeelfdobby934-sys/mac-smart-reader}"
APP="/Applications/Smart Reader.app"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "Smart Reader runs on macOS only."

if ! command -v gh >/dev/null 2>&1; then
  die "GitHub CLI not found. Install it with:  brew install gh && gh auth login   then re-run this installer."
fi
gh auth status >/dev/null 2>&1 || die "Please log in to GitHub first:  gh auth login"

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) die "Unsupported CPU architecture: $(uname -m)" ;;
esac

TMP="$(mktemp -d)"
trap 'hdiutil detach "$TMP/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

say "Downloading the latest Smart Reader for $ARCH…"
gh release download --repo "$REPO" --pattern "*-${ARCH}.dmg" --dir "$TMP" --clobber
DMG="$(ls "$TMP"/*.dmg | head -n1)"
[[ -f "$DMG" ]] || die "No $ARCH build found in the latest release of $REPO."

say "Installing to /Applications…"
mkdir -p "$TMP/mnt"
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$TMP/mnt"
if pgrep -x "Smart Reader" >/dev/null 2>&1; then
  say "Quitting the running Smart Reader…"
  osascript -e 'quit app "Smart Reader"' || true
  sleep 1
fi
rm -rf "$APP"
cp -R "$TMP/mnt/Smart Reader.app" "$APP"
hdiutil detach "$TMP/mnt" -quiet

# The app is not signed with a paid Apple Developer ID; clear the quarantine flag so macOS opens it.
xattr -dr com.apple.quarantine "$APP" || true

say "Done. Opening Smart Reader…"
open "$APP"
