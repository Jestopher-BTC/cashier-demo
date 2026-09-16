#!/usr/bin/env bash
#
# Run this ON THE SERVER to update from GitHub instead of pushing files from
# a laptop. Invoke it with sudo (systemd restart needs root); it drops down
# to the app user for git and npm so file ownership stays correct:
#
#   sudo /opt/cashier/deploy/pull-deploy.sh
#
# Requires: the repo already cloned into APP_DIR (see DEPLOY.md section 3),
# APP_USER already owning that checkout, and .env already in place — this
# script never touches .env.
#
# Override APP_USER or APP_DIR if you copied this project somewhere else:
#   sudo APP_USER=myuser APP_DIR=/srv/cashier ./deploy/pull-deploy.sh

set -euo pipefail

APP_USER="${APP_USER:-cashier}"
APP_DIR="${APP_DIR:-/opt/cashier}"
SERVICE="${SERVICE:-cashier}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo — it needs to restart the systemd service." >&2
  exit 1
fi

if [ ! -f "$APP_DIR/package.json" ] || ! grep -q '"name": "cashier-demo"' "$APP_DIR/package.json"; then
  echo "$APP_DIR doesn't look like the cashier project. Aborting." >&2
  exit 1
fi
if [ ! -d "$APP_DIR/.git" ]; then
  echo "$APP_DIR is not a git checkout. Clone it first (DEPLOY.md section 3.4)." >&2
  exit 1
fi

echo "Pulling as $APP_USER..."
sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard origin/main

echo "Installing deps..."
sudo -u "$APP_USER" npm --prefix "$APP_DIR" ci

echo "Building..."
sudo -u "$APP_USER" npm --prefix "$APP_DIR" run build

echo "Restarting $SERVICE..."
systemctl restart "$SERVICE"
systemctl status "$SERVICE" --no-pager --lines 5

echo
echo "Done. Check:"
echo "  curl -s https://boltda.sh/cashier/healthz | jq '{ok, package, packages}'"
echo "  curl -sI https://boltda.sh/cashier/core/ | head"
