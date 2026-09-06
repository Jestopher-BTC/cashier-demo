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

## 3. Server setup (one time)

This is a single sequential runbook. Run the blocks in order, top to bottom,
on a fresh box. Skip straight to **3.6** if the server already exists and you
just need to add the cashier to it (that's the actual situation for
`boltda.sh`: it already runs Bolt Dash, already has Node and Caddy, and you
already have working SSH access to it via your `boltdash` alias).

Filled in below: domain `boltda.sh`, path `/cashier`, app dir `/opt/cashier`,
system user `cashier`, repo `Jestopher-BTC/cashier-demo`. Deploying this for
someone else's booth or a different iGaming company's server means swapping
those four things and nothing else — everything downstream (systemd unit,
Caddy route, deploy script) already reads from the checkout, not from
hardcoded values.

**What a "deploy key" is**, since it's the one unfamiliar piece: it's a second,
separate SSH keypair that lives only on this server, is registered on GitHub
as read-only access to this one repo, and can't do anything else — not push,
not touch your other repos, not log in as you. If the server were ever
compromised, the blast radius is "someone can read the cashier's source code,"
nothing more. It exists so the server can `git pull` on its own, on a
schedule or on demand, without you copying your personal GitHub key onto a
box that sits at a conference booth.

### 3.1 Log in and confirm the basics

```bash
ssh boltdash
node -v          # want 20 or newer
caddy version     # already installed if Bolt Dash is running
whoami            # note this — you'll need it for the next block if it isn't root
```

If Node is missing or older than 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs
```

### 3.2 Create the `cashier` system user

Still on the server. Use `sudo` in front of each line below if `whoami` above
wasn't `root`.

```bash
adduser --system --group --home /opt/cashier cashier
mkdir -p /opt/cashier
chown cashier:cashier /opt/cashier
```

This user owns nothing but `/opt/cashier` and can't log in interactively
(`--system` gives it no password and no shell). It exists so the cashier's
files, process, and GitHub deploy key are isolated from the `boltdash` user
running the game next to it.

### 3.3 Generate the deploy key and register it on GitHub

```bash
sudo -u cashier ssh-keygen -t ed25519 -f /opt/cashier/.ssh/deploy_key -N "" -C "cashier-demo@boltda.sh"
sudo -u cashier mkdir -p /opt/cashier/.ssh
sudo cat /opt/cashier/.ssh/deploy_key.pub
```

Copy that output (one line, starts `ssh-ed25519`). In a browser, on your
laptop: open `github.com/Jestopher-BTC/cashier-demo` → **Settings → Deploy
keys → Add deploy key**. Paste the key, give it a title like "boltda.sh
cashier", and leave **Allow write access** unchecked — read-only is all this
server ever needs. Click **Add key**.

Back on the server, tell SSH to use that key specifically when talking to
GitHub for this user:

```bash
sudo -u cashier bash -c 'cat > /opt/cashier/.ssh/config' <<'EOF'
Host github.com
  IdentityFile /opt/cashier/.ssh/deploy_key
  IdentitiesOnly yes
EOF
sudo chmod 600 /opt/cashier/.ssh/deploy_key
sudo chmod 700 /opt/cashier/.ssh
sudo chown -R cashier:cashier /opt/cashier/.ssh
```

### 3.4 Clone the repo

```bash
sudo -u cashier git clone git@github.com:Jestopher-BTC/cashier-demo.git /opt/cashier
```

If this is the very first thing landing in `/opt/cashier`, `git clone` needs
the directory empty (not just owned by `cashier` — actually empty). If step
3.2 already created it empty, this just works.

### 3.5 Secrets, build, and the systemd service

```bash
cd /opt/cashier
sudo -u cashier cp .env.example .env
sudo -u cashier $EDITOR .env          # paste the Amboss key, wallet id, operator pin
sudo chmod 600 /opt/cashier/.env

sudo -u cashier npm ci                # full install, the build step needs devDependencies
sudo -u cashier npm run build

sudo cp deploy/cashier.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cashier
sudo systemctl status cashier --no-pager
```

### 3.6 Add the Caddy route

`boltda.sh` already has a Caddy block for Bolt Dash. Don't add a second
`boltda.sh { }` block — open `/etc/caddy/Caddyfile` and add these two lines
*inside* the existing one (they're also in `deploy/Caddyfile` in the repo, as
a copy-paste reference):

```
	redir /cashier /cashier/
	handle_path /cashier/* {
		reverse_proxy 127.0.0.1:8080
	}
```

Bolt Dash listens on port 3000; the cashier defaults to 8080. No collision.

```bash
sudo systemctl reload caddy
curl -s https://boltda.sh/cashier/healthz | jq
```

`ok: true` means the API answered, the wallet is ready, and a real BTC/USD
spot is available (Coinbase, then CoinGecko). That rate is required even when
`AMBOSS_ASSET=USDT`, because BOLT11 invoice cash-outs are sat-denominated.
`usdPerBtc: 1` with `source: "n/a"` is a bug, not a stablecoin shortcut.
Anything else prints which check failed and why.

## Every deploy after the first

From wherever you're editing (your laptop, or here):

```bash
git push
```

Then on the server:

```bash
ssh boltdash
sudo /opt/cashier/deploy/pull-deploy.sh
```

That script does `git fetch` + `git reset --hard origin/main`, `npm ci`,
`npm run build`, and restarts the `cashier` service, running the git/npm steps
as the `cashier` user (so file ownership stays correct) and the restart as
root (systemd needs it). It never touches `.env`.

### Fallback: pushing files directly instead of through GitHub

If GitHub is ever unreachable from the server, or you just want to push a
one-off build straight from your laptop without touching the repo, the old
path still works: `npm run build` locally, then `./deploy/push.sh` (defaults
to `root@boltda.sh:/opt/cashier` — override with `HOST=cashier@boltda.sh
./deploy/push.sh` to go straight to the app user; it needs write access to
`/opt/cashier`, so check that user actually has a login-capable key first).
It refuses to run from your home directory and proves it can log in before it
copies anything.

### If ssh ever says `Permission denied (publickey)`

Not the current situation on `boltda.sh` — your `boltdash` alias already
works — but useful the next time you set this up on a fresh box:

```bash
ssh-add -l                       # is any key loaded?
ssh-add ~/.ssh/id_ed25519        # load it if not
ssh -v root@thathost 2>&1 | grep -Ei 'offering|authentications|denied'
```

If it offers a key and still gets refused, the box doesn't have that public
key for that user yet. Fix it from the cloud provider's web console (for
DigitalOcean: Droplet → Access → Launch Console), log in there, and add the
key by hand:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... your key' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
grep PermitRootLogin /etc/ssh/sshd_config     # want prohibit-password
systemctl reload ssh
```

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
