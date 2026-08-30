# Cashier demo: deploy and run it at a booth

Three modes behind one URL. **Mock UI** needs nothing. **Code View** is the
integration story. **Live UI** moves real money through the Amboss Payments API.

    boltda.sh/cashier          the demo
    boltda.sh/cashier/check.html   device check, run this first on the iPad
    boltda.sh/cashier/healthz      is the wallet reachable and funded

---

## 1. Which wallet the booth runs on

The published docs say:

> Lightning Address sends from Taproot Asset wallets are not yet supported.

The Amboss team says that note is stale. The code now trusts the team: address
payouts default to on for every asset, so cashtag withdrawals work on a USDT
wallet too. **Verify it before the event** rather than at the booth:

```bash
# dry run, spends nothing
node probe-address-payout.mjs --to you@yourwallet.com --usd 0.50

# the real thing
node probe-address-payout.mjs --to you@yourwallet.com --usd 0.50 --yes
```

It prints a paste-ready report either way. If it fails, send that block to the
team; if it works, send it anyway so the docs page gets fixed.

If a send is ever rejected as unsupported at the booth, the server notices,
logs it, flips itself to invoice-only for the rest of the day, and the withdraw
screen starts asking for an invoice instead. The money goes back to the balance.
You do not have to do anything. `ADDRESS_PAYOUTS=false` forces that mode from
the start, and `/healthz` reports what the server currently believes and whether
it has actually seen a send succeed.

That leaves the wallet choice as a straight product question:

| | **BTC wallet** | **USDT wallet** |
|---|---|---|
| Balance is really dollars | no, converted for display | **yes, on-chain USDT** |
| Deposit by QR | yes | yes |
| Cash out to `$cashtag` | yes | yes, pending the probe |
| Sats figure under the deposit QR | shown | hidden, we cannot know it |

Run USDT if the probe passes. The stablecoin balance is the honest version of
the story the mock has been telling all along, and nothing in the UI changes.

## 2. Amboss setup

Do this a day early. A live wallet needs about 30 minutes before `is_ready` flips.

1. Create a **LIVE** environment at `app.amboss.tech/pay`.
2. Create a wallet on that environment for your chosen asset.
3. Mint a service API key with `PAYMENTS: WRITE` and `WALLETS: READ`, scoped to
   the wallet id from step 2. The plaintext key is shown once.

   Why exactly those two:

   | What the server calls | Permission |
   |---|---|
   | `transaction.create_receive` (deposit invoice) | `PAYMENTS: WRITE` |
   | `transaction.create_send` (the payout) | `PAYMENTS: WRITE` |
   | `transaction.find_one` (polling both) | implied, `WRITE` includes `READ` |
   | `wallet.find_one` (`/healthz`) | `WALLETS: READ` |

   **`WALLET_CREDENTIALS` is not needed and should not be granted.** It gates one
   read-only field, `wallet.node_permissions`, which hands back encrypted node
   macaroons for driving LND directly. This server never talks to a daemon. Worse,
   a key carrying it must be wallet-scoped *and* the team must have a team
   password, with an Argon2id `password_hash` sent on every request. We send no
   such header, so granting it would break the key rather than empower it.

   Scoping to a single `wallet_id` is worth doing on its own: a key that leaks at
   a conference can then only touch the demo wallet.
4. Fund the wallet with a little more than `DAILY_FLOAT_USD`.
5. Wait for `is_ready`, then confirm with `curl https://boltda.sh/cashier/healthz`.

Rehearse against a **SANDBOX** environment first with the same code. Sandbox
invoices settle without a node, so you can walk the whole flow at your desk.

---

## 3. Droplet

Ubuntu 22.04 or newer, Node 20+, Caddy for TLS.

**On the droplet**, once:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
adduser --system --group --home /opt/cashier cashier
mkdir -p /opt/cashier
```

**From your laptop**, from inside the unpacked project directory:

```bash
cd ~/wherever/you/unpacked/cashier-demo    # ls should show package.json and server/
npm run build
./deploy/push.sh                            # defaults to root@boltda.sh:/opt/cashier
```

`push.sh` checks it is standing in the project and that a build exists before it
copies anything, and it proves it can log in before it starts. Override the
target if you need to:

```bash
HOST=youruser@boltda.sh ./deploy/push.sh
SSH_KEY=~/.ssh/id_ed25519 ./deploy/push.sh
```

Do not run a bare `rsync ... ./ host:/opt/cashier/` without checking your working
directory first. From a home directory that copies your home directory, keys and
all, to a public server.

**Back on the droplet** (after either `push.sh` or the GitHub clone below):

```bash
cd /opt/cashier
npm install --omit=dev      # skip this if you used the GitHub path; npm ci already ran
cp .env.example .env && $EDITOR .env          # paste the key, wallet id, pin
chown -R cashier:cashier /opt/cashier
chmod 600 .env

cp deploy/cashier.service /etc/systemd/system/
systemctl enable --now cashier
systemctl status cashier --no-pager
```

### Alternative: deploy from GitHub instead of rsync

The cashier now lives in its own repo (`Jestopher-BTC/cashier-demo`, private).
Instead of pushing files from your laptop, the droplet can pull the repo
itself over a read-only deploy key. This sidesteps needing your personal
laptop-to-droplet SSH key to work at all; it only needs to work once, to add
the deploy key.

**Once, on the droplet:**

```bash
sudo -u cashier ssh-keygen -t ed25519 -f /opt/cashier-deploy-key -N ""
cat /opt/cashier-deploy-key.pub
```

Paste that public key into the GitHub repo: **Settings → Deploy keys → Add
deploy key**. Leave "Allow write access" unchecked; the droplet only ever
reads.

```bash
sudo -u cashier git -C /opt/cashier init 2>/dev/null || true
sudo -u cashier mkdir -p /opt/cashier/.ssh
sudo -u cashier bash -c 'cat > /opt/cashier/.ssh/config' <<'EOF'
Host github.com
  IdentityFile /opt/cashier-deploy-key
  IdentitiesOnly yes
EOF

# first clone (directory must be empty or absent)
sudo -u cashier git clone git@github.com:Jestopher-BTC/cashier-demo.git /opt/cashier
```

**Every deploy after that**, from an SSH session on the droplet (or from your
laptop's terminal once its own SSH access works, running a remote command):

```bash
cd /opt/cashier && ./deploy/pull-deploy.sh
```

`pull-deploy.sh` does `git fetch` + `git reset --hard origin/main`, `npm ci`,
`npm run build`, then restarts the `cashier` service. It never touches `.env`.
Because the build now happens on the droplet, it needs the full dependency
list (`npm ci`, not `--omit=dev`) — plan for that the first time you set this
up, even though runtime itself needs nothing beyond Node and `server/`.

### If ssh says `Permission denied (publickey)`

The host is fine, the key is not. In order:

```bash
ssh-add -l                       # is any key loaded?
ssh-add ~/.ssh/id_ed25519        # load it if not

ssh -v root@boltda.sh 2>&1 | grep -Ei 'offering|authentications|denied'
```

That last line shows which keys get offered and what the server will accept. If
it offers a key and still gets refused, the droplet does not have that public
key for that user. Two likely causes: the droplet was built with a sudo user
rather than root, so try `HOST=youruser@boltda.sh`, or the key lives on a
different machine.

To fix it from scratch, use the DigitalOcean web console (Droplet → Access →
Launch Console), log in there, and add your key by hand:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... your key' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
grep PermitRootLogin /etc/ssh/sshd_config     # want prohibit-password
systemctl reload ssh
```

Get the public key from your laptop with `cat ~/.ssh/id_ed25519.pub`.

Over the `push.sh` path, the build output ships in `public/`, so the droplet
needs no build toolchain — run `npm run build` on your laptop and
`./deploy/push.sh` again after a UI change. Over the GitHub path, the droplet
builds it itself; `git push` then `./deploy/pull-deploy.sh` on the droplet.

Then merge `deploy/Caddyfile` into `/etc/caddy/Caddyfile` and
`systemctl reload caddy`.

Check it:

```bash
curl -s https://boltda.sh/cashier/healthz | jq
```

`ok: true` means the API answered, the wallet is ready, and the rate source is
alive. Anything else prints which check failed and why.

---

## 4. The iPad

1. Open `boltda.sh/cashier/check.html`. Green means go. Amber items are
   cosmetic. Red means that iPad cannot run it: the floor is roughly iOS 12, and
   iOS 15 or newer looks right in every detail.
2. Open `boltda.sh/cashier`, then Share → **Add to Home Screen**. It launches
   full screen with no Safari chrome.
3. Settings → Display → **Auto-Lock: Never**, and turn on **Guided Access**
   (Accessibility → Guided Access) so a visitor cannot wander out of the app.
4. Set the brightness high. Booth lighting is bad and the QR has to scan.

---

## 5. Booth runbook

**Before doors open**

- `healthz` green, wallet balance above the day's float.
- Phone wallet installed, funded, and already paired to the venue wifi.
- Run one full loop on Live: deposit $1, cash out $1. Then tap **New visitor**.
- Note the daily float number. When it is gone, funding stops and Live becomes
  deposit-then-withdraw-your-own-money, which still demos fine.

**The 90 second demo**

1. Open on **Mock UI**. Walk the deposit and cash out screens. Point out that
   the player never sees a rate, a sat, or the word Bitcoin.
2. Tap **Code View** → **SDK seams**. Three calls. That is the integration.
3. Tap **Live UI**. Deposit a dollar, scan the QR with your phone wallet, watch
   the balance land. Cash out to your own cashtag. Money arrives while they
   watch.
4. Tap **New visitor** before the next person.

**If the venue network dies**

Switch to **Mock UI** and keep talking. It is the same interface and needs
nothing. Live mode says so plainly if it cannot reach the server.

If the iPad itself is offline, use `offline/cashier-offline.html`:

- AirDrop it to the iPad and open it from Files, or
- serve it from your laptop over a phone hotspot and point the iPad at it.

It carries the whole app inline, mock and code, no network at all.

---

## 6. Sessions, refreshes, and what a visitor can take

**A session is a server-side balance with an id.** The id lives in the iPad's
localStorage; the balance, the history, and every cap live on the droplet. The
browser never holds money, only a pointer to it.

**Refreshing does not lose the balance.** On load the app finds the stored id
and resumes that session. Reload, sleep the iPad, force-quit the home-screen
app, come back an hour later: same balance. What clears it is tapping **New
visitor**, which is the point of that button.

Two edges worth knowing:

- Sessions are held in memory and expire after **6 hours** idle. Restarting the
  service clears them all. Do your restarts before the doors open.
- If a session is lost while a visitor still has a balance, their deposit is not
  gone in any real sense: it settled into your Amboss wallet. It is just no
  longer attributable in the demo. Cap sizes keep that boring.

**What a visitor can walk away with:**

- A session starts at **$0**. The only money in it is money that visitor just
  deposited, so cashing out returns their own dollar.
- **Fund** is the only source of free money. It needs `OPERATOR_PIN`, grants
  `SESSION_START_USD`, and stops at `DAILY_FLOAT_USD` per day across all
  visitors.
- Every deposit and cash out is capped at `MAX_*_USD`.
- Leave `OPERATOR_PIN` blank and funding is off entirely.

Worst case for the day is `DAILY_FLOAT_USD`. Set it to what you would be
relaxed about losing.

## 7. Running it locally

```bash
npm install
npm run build
npm run dev      # MOCK_AMBOSS=1, no key and no money
```

Then open `http://localhost:8080`. In mock mode, settle a deposit by hand:

```bash
curl -X POST localhost:8080/api/dev/settle/all -d '{}' -H 'content-type: application/json'
```

Tests:

```bash
node test-api.mjs       # server flow: caps, credits, refunds, validation
node test-browser.mjs   # all three modes in jsdom against a live server
node test-session.mjs   # a reload resumes the balance instead of dropping it
node test-theme.mjs     # chrome and card switch theme together
```

---

## 8. When something goes wrong

| Symptom | Look at |
|---|---|
| `healthz` says wallet not ready | Live wallets need ~30 min of provisioning after creation |
| Deposit QR never settles | `journalctl -u cashier -f`, then the transaction in the Amboss dashboard |
| `FORBIDDEN` on any call | The key is valid but missing a permission. Sends and invoices need `PAYMENTS: WRITE`; `/healthz` needs `WALLETS: READ` |
| Cash out fails instantly | Usually routing or liquidity. The failure reason comes back on the transaction and the money returns to the session balance |
| `Invoice network ... not allowed` | A testnet invoice against a live wallet |
| Cashtag rejected in Live | A send came back unsupported and the server switched to invoice-only. Check `journalctl -u cashier` for the message and run the probe |
| Balance vanished after a reload | The session expired (6h) or the service restarted. Both clear sessions |
| Everything is slow | Venue wifi. The poll interval is 1.5s; it will catch up |
