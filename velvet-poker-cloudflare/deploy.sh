#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
export WRANGLER_SEND_METRICS=false
npm ci --no-audit --no-fund
npx wrangler login
npx wrangler deploy
