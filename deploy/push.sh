#!/usr/bin/env bash
#
# Push the cashier to the droplet. Run it from the project directory:
#
#   ./deploy/push.sh                      # defaults to root@boltda.sh
#   HOST=deploy@boltda.sh ./deploy/push.sh
#   SSH_KEY=~/.ssh/id_ed25519 ./deploy/push.sh
#
# It checks it is standing in the right place before it copies anything, so a
# stray "./" from a home directory cannot turn into an upload of your home
# directory.

set -euo pipefail

HOST="${HOST:-root@boltda.sh}"
DEST="${DEST:-/opt/cashier}"
SSH_KEY="${SSH_KEY:-}"

cd "$(dirname "$0")/.."
HERE="$(pwd)"

# --- refuse to run from anywhere that is not this project -------------------
if [ ! -f package.json ] || ! grep -q '"name": "cashier-demo"' package.json; then
  echo "Not in the cashier project (looked in $HERE). Aborting." >&2
  exit 1
fi
if [ ! -f public/app.js ]; then
  echo "public/app.js is missing. Run 'npm run build' first." >&2
  exit 1
fi
case "$HERE" in
  "$HOME") echo "Refusing to sync your home directory." >&2; exit 1 ;;
  "/")     echo "Refusing to sync /." >&2; exit 1 ;;
esac

SSH_CMD="ssh"
[ -n "$SSH_KEY" ] && SSH_CMD="ssh -i $SSH_KEY"

echo "Project   $HERE"
echo "Target    $HOST:$DEST"
echo

# --- prove we can log in before touching anything --------------------------
if ! $SSH_CMD -o BatchMode=yes -o ConnectTimeout=8 "$HOST" true 2>/dev/null; then
  cat >&2 <<EOF
Cannot log in to $HOST.

Work through these in order:

  1. Which keys is your agent offering?
       ssh-add -l
       ssh-add ~/.ssh/id_ed25519        # if the list is empty

  2. Watch the handshake pick a key and get refused:
       ssh -v $HOST 2>&1 | grep -Ei 'offering|authentications|denied'

  3. Are you sure it is root? A droplet you set up with a sudo user wants
     that user instead:
       HOST=youruser@boltda.sh ./deploy/push.sh

  4. Still stuck: open the DigitalOcean web console (Droplet → Access →
     Launch Console), log in there, and add your public key:
       mkdir -p ~/.ssh && chmod 700 ~/.ssh
       echo 'PASTE ~/.ssh/id_ed25519.pub FROM YOUR LAPTOP' >> ~/.ssh/authorized_keys
       chmod 600 ~/.ssh/authorized_keys
     Then check /etc/ssh/sshd_config has PermitRootLogin prohibit-password
     (or without-password) and 'systemctl reload ssh'.
EOF
  exit 1
fi

# --- copy ------------------------------------------------------------------
rsync -av --delete \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  -e "$SSH_CMD" \
  "$HERE/" "$HOST:$DEST/"

echo
echo "Copied. On the droplet:"
echo "  cd $DEST && npm install --omit=dev"
echo "  cp .env.example .env && \$EDITOR .env      # first time only"
echo "  systemctl restart cashier && systemctl status cashier --no-pager"
echo
echo "Then: curl -s https://boltda.sh/cashier/healthz"
