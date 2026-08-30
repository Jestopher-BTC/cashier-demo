#!/usr/bin/env bash
#
# Run this ON THE DROPLET, from /opt/cashier, to update from GitHub instead of
# receiving an rsync push from a laptop:
#
#   cd /opt/cashier && ./deploy/pull-deploy.sh
#
# Requires: the repo already cloned into /opt/cashier (git clone over the
# deploy key, see DEPLOY.md), and .env already in place (this script never
# touches it).

set -euo pipefail

cd "$(dirname "$0")/.."
HERE="$(pwd)"

if [ ! -f package.json ] || ! grep -q '"name": "cashier-demo"' package.json; then
  echo "Not in the cashier project (looked in $HERE). Aborting." >&2
  exit 1
fi
if [ ! -d .git ]; then
  echo "$HERE is not a git checkout. Clone the repo first (see DEPLOY.md)." >&2
  exit 1
fi

echo "Pulling..."
git fetch origin
git reset --hard origin/main

echo "Installing deps..."
npm ci

echo "Building..."
npm run build

echo "Restarting service..."
systemctl restart cashier
systemctl status cashier --no-pager --lines 5

echo
echo "Done. Check: curl -s https://boltda.sh/cashier/healthz"
