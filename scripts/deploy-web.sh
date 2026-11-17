#!/usr/bin/env bash
# Builds the web app and deploys it to Cloud Run.
#   deploy-web.sh                    build + deploy
#   deploy-web.sh --context-only DIR build + assemble the Docker context in DIR (used by tests)
set -euo pipefail
cd "$(dirname "$0")/.."

CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-}"
if [ -z "$CLIENT_ID" ] && [ -f .env.production ]; then
  CLIENT_ID="$(grep -E '^VITE_GOOGLE_CLIENT_ID=' .env.production | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')"
fi
if [ -z "$CLIENT_ID" ]; then
  echo "VITE_GOOGLE_CLIENT_ID is empty: set it in the environment or in .env.production" >&2
  exit 1
fi
export VITE_GOOGLE_CLIENT_ID="$CLIENT_ID"

npm run build:web
[ -d out/web/foliate-js ] || { echo "out/web/foliate-js is missing from the build" >&2; exit 1; }

if [ "${1:-}" = "--context-only" ]; then
  CTX="${2:?usage: deploy-web.sh --context-only DIR}"
  mkdir -p "$CTX"
else
  CTX="$(mktemp -d)"
  trap 'rm -rf "$CTX"' EXIT
fi
cp web/Dockerfile web/nginx.conf "$CTX/"
rm -rf "$CTX/site"
cp -R out/web "$CTX/site"

if [ "${1:-}" = "--context-only" ]; then
  echo "Context ready: $CTX"
  exit 0
fi

gcloud run deploy smart-reader --source "$CTX" --region us-central1 --project my-productivity-suite \
  --max-instances 2 --memory 256Mi --port 8080 --quiet

URL="$(gcloud run services describe smart-reader --region us-central1 --project my-productivity-suite --format='value(status.url)')"
echo "Deployed: $URL"
