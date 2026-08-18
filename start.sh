#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
echo "Starting THE WORKSHOP v9.0.2 at http://127.0.0.1:8787/#/home"
exec node server.js
