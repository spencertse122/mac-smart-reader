#!/usr/bin/env bash
# Smart Reader installer/updater for macOS.
# Usage: curl -fsSL https://raw.githubusercontent.com/spencertse122/mac-smart-reader/main/install.sh | bash
#    or: bash install.sh
# Downloads with the GitHub CLI when it is installed and logged in (works for a private repo too),
# otherwise with curl from the public GitHub API.
set -euo pipefail

REPO="${SMART_READER_REPO:-spencertse122/mac-smart-reader}"
APP="/Applications/Smart Reader.app"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Prints the browser_download_url of the first "*-<arch>.dmg" asset ($1 = arm64 or x64),
# reading the GitHub "latest release" JSON on stdin. No jq on a stock Mac, so grep/sed it.
asset_url() {
  grep -o "\"browser_download_url\"[[:space:]]*:[[:space:]]*\"[^\"]*-${1}[.]dmg\"" \
    | head -n1 \
    | sed -e 's/^"browser_download_url"[[:space:]]*:[[:space:]]*"//' -e 's/"$//'
}

download_with_gh() {
  command -v gh >/dev/null 2>&1 || return 1
  gh auth status >/dev/null 2>&1 || return 1
  say "Downloading with the GitHub CLI..."
  gh release download --repo "${REPO}" --pattern "*-${ARCH}.dmg" --dir "$TMP" --clobber
}

download_with_curl() {
  local json url
  json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/${REPO}/releases/latest")" || return 1
  url="$(printf '%s\n' "$json" | asset_url "${ARCH}" || true)"
  [[ -n "$url" ]] || return 1
  curl -fL --progress-bar -o "$TMP/${url##*/}" "$url"
}

main() {
  [[ "$(uname -s)" == "Darwin" ]] || die "Smart Reader runs on macOS only."

  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac

  TMP="$(mktemp -d)"
  # Preserve the exit status: macOS's bash 3.2 otherwise exits with the trap's last command status.
  trap 'rc=$?; hdiutil detach "$TMP/mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"; exit $rc' EXIT

  say "Downloading the latest Smart Reader for ${ARCH}..."
  if ! download_with_gh && ! download_with_curl; then
    die "Could not download Smart Reader from https://github.com/${REPO}/releases.
If the repository is private, install and log in to the GitHub CLI, then re-run this installer:
  brew install gh && gh auth login"
  fi
  DMG="$(ls "$TMP"/*.dmg 2>/dev/null | head -n1 || true)"
  [[ -n "$DMG" && -f "$DMG" ]] || die "No ${ARCH} build found in the latest release of ${REPO}."

  say "Installing to /Applications..."
  mkdir -p "$TMP/mnt"
  hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$TMP/mnt"
  if pgrep -x "Smart Reader" >/dev/null 2>&1; then
    say "Quitting the running Smart Reader..."
    osascript -e 'quit app "Smart Reader"' || true
    sleep 1
  fi
  rm -rf "$APP"
  cp -R "$TMP/mnt/Smart Reader.app" "$APP"
  hdiutil detach "$TMP/mnt" -quiet

  # The app is not signed with a paid Apple Developer ID; clear the quarantine flag so macOS opens it.
  xattr -dr com.apple.quarantine "$APP" || true

  say "Done. Opening Smart Reader..."
  open "$APP"
}

# Wrapped in main so a truncated `curl | bash` download never runs half a script.
# SMART_READER_INSTALL_NO_MAIN=1 lets the unit test source the helpers without installing.
if [[ -z "${SMART_READER_INSTALL_NO_MAIN:-}" ]]; then
  main
fi
