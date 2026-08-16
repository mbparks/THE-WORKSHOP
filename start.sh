#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo "Starting THE WORKSHOP v5.8.1 at http://127.0.0.1:8787"
exec node server.js
