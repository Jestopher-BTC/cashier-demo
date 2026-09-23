# Deploy

Run the Live cashier on your own host with `CASHIER_PACKAGE=core`. Secrets
stay in `.env` on the box (`chmod 600`). Deploy scripts never copy or
overwrite that file. The systemd unit loads it with `EnvironmentFile`. The
Node process does not parse `.env` by itself.

Optional kiosk steps, if you run the booth package:
[docs/booth/RUNBOOK.md](docs/booth/RUNBOOK.md).

## Done when

- The process serves **core** (`public-core/`) on loopback.
- A reverse proxy is the only public door. Port 8080 is not open on a public interface.
- Public `/healthz` is redacted. The loopback view shows the wallet is ready and `checks.send.ok` is true.
- Fund is off (`OPERATOR_PIN` blank or `FUND_ENABLED=false`) unless this host runs a staff giveaway.

---

## 1. Which package

`npm run build` writes core → `public-core/` and booth → `public/`. The Node
process serves **one** of those trees at `/`:

| `CASHIER_PACKAGE` | UI | Use |
|---|---|---|
| `core` | Live cashier | Integrators and production |
| `booth` (default if unset) | Mock / Code / Live, plus Fund | Optional demo chrome |

Set `CASHIER_PACKAGE=core` in `.env` on a new cashier. Leave it unset on a
host that must keep the booth UI. One process, one package.

## 2. Amboss setup

A live wallet needs about 30 minutes before `is_ready` flips.

1. Create a **LIVE** environment at `app.amboss.tech/pay`.
2. Create a wallet for `AMBOSS_ASSET` (`BTC`, `USDT`, or `USDC`).
3. Mint a service API key **scoped to that wallet id**, with:

   | What the server calls | Permission |
   |---|---|
   | `transaction.create_receive` (deposit invoice) | `PAYMENTS: WRITE` |
   | `transaction.create_send` (the payout record) | `PAYMENTS: WRITE` |
   | `transaction.find_one` (polling both) | implied; `WRITE` includes `READ` |
   | `wallet.find_one` (`/healthz`) | `WALLETS: READ` |
   | `wallet.node_permissions` (live send) | `WALLET_CREDENTIALS: READ` |

   **`WALLET_CREDENTIALS: READ` is required for live payouts.** The Payments
   SDK `transactions.send` decrypts the node admin macaroon in-process with
   the team password, then pays the node's REST endpoint. `create_send` alone
   only creates a pending transaction.

   Set `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and `AMBOSS_TEAM_PASSWORD` in
   `.env`. `TEAM_PASSWORD` is accepted as an alias. The SDK derives an Argon2id
   `password_hash` locally and never sends the raw password.

4. Fund the wallet with a little more than `DAILY_FLOAT_USD` if you use Fund.
5. Wait for `is_ready`, then confirm `/healthz` (see below). `checks.send.ok`
   must be true on the **unredacted** operator view.

Rehearse against a **SANDBOX** environment first (`amb_test_` key). Sandbox
invoices settle without a node, and a sandbox key can omit the team password.

### BTC vs stablecoin

| | **BTC wallet** | **USDT / USDC wallet** |
|---|---|---|
| Balance is really dollars | no, converted for display | yes, on-chain stablecoin |
| Deposit by QR | yes | yes |
| Cash out to `$cashtag` | yes | yes, unless the server saw an “unsupported” send and flipped to invoice-only |
| Sats figure under the deposit QR | shown | hidden (unknowable) |

Address payouts default on for every asset. Verify before you rely on cashtags:

```bash
node probe-address-payout.mjs --to you@yourwallet.com --usd 0.50
node probe-address-payout.mjs --to you@yourwallet.com --usd 0.50 --yes
```

If a send is rejected as unsupported, the server logs it, switches to
invoice-only until the process restarts, and refunds the session.
`ADDRESS_PAYOUTS=false` forces that mode from the start.

## 3. Server

Need Node 20+ and a reverse proxy in front of loopback. The files under
`deploy/` default to app dir `/opt/cashier`, system user `cashier`, unit name
`cashier`, and port `8080`. Override those if your layout differs.

```bash
# as root, adjust user/dir as needed
adduser --system --group --home /opt/cashier cashier
mkdir -p /opt/cashier && chown cashier:cashier /opt/cashier

sudo -u cashier git clone git@github.com:Jestopher-BTC/cashier-demo.git /opt/cashier
cd /opt/cashier
sudo -u cashier cp .env.example .env
sudo -u cashier $EDITOR .env          # keys, wallet id, CASHIER_PACKAGE=core
sudo chmod 600 /opt/cashier/.env

sudo -u cashier npm ci
sudo -u cashier npm run build

sudo cp deploy/cashier.service /etc/systemd/system/
# edit WorkingDirectory / EnvironmentFile / User if you did not use /opt/cashier
sudo systemctl daemon-reload
sudo systemctl enable --now cashier
```

A read-only GitHub deploy key on the server is enough for `git pull`. Keep
that private key on the server.

### Reverse proxy

The systemd unit sets `NODE_ENV=production`, which binds **127.0.0.1**. Do not
open port 8080 on a public interface. The app uses relative URLs, so a subpath
works. Example Caddy:

```
	redir /cashier /cashier/
	handle_path /cashier/* {
		reverse_proxy 127.0.0.1:8080
	}
```

Paste those lines **inside** an existing site block. A copy-paste reference is
[`deploy/Caddyfile`](deploy/Caddyfile).

### Health

From the public URL, `/healthz` is **redacted** (no wallet id, no balances, no
remaining float). The full operator view is loopback, or `HEALTHZ_TOKEN` via
`?token=` or `X-Healthz-Token`.

```bash
curl -s http://127.0.0.1:8080/healthz | jq
```

`usdPerBtc: 1` with `source: "n/a"` means the feed is not a usable BTC/USD
rate. Invoice cash-outs need a real rate even on a stablecoin wallet.

## 4. Every deploy after the first

On the server:

```bash
sudo /opt/cashier/deploy/pull-deploy.sh
```

That script does `git fetch` + `git reset --hard origin/main`, `npm ci`,
`npm run build`, and restarts the unit. It never touches `.env`. Override
`APP_USER` / `APP_DIR` / `SERVICE` if needed.

Fallback from a laptop (after `npm run build`): `./deploy/push.sh`. The
default target is the reference host; set `HOST` and `DEST` for yours. It
refuses to run from `$HOME` and never copies `.env`.

## 5. Sessions, caps, Fund

A session is a server-side balance with an id. The id lives in the browser’s
`localStorage` (`cashier.session`); money, caps, and history live in process
memory.

- Sessions start at **$0**. A player can only cash out what they deposited, or what Fund credited.
- Idle expiry is **6 hours**. A service restart clears sessions and the daily float.
- Caps: `MIN_*` / `MAX_*` on deposit and cash-out. Defaults are $1–$5. The deposit screen’s $20 and $100 chips need a higher `MAX_DEPOSIT_USD`.
- **Fund** is on only when `FUND_ENABLED` is on **and** `OPERATOR_PIN` is non-empty. Every Fund tap asks for the PIN again. Core UI does not show Fund; `/api/session/fund` is still gated. Restart after changing either value.

The day’s giveaway ceiling is `DAILY_FLOAT_USD`. For a public cashier, leave
`OPERATOR_PIN` blank or set `FUND_ENABLED=false`.

## 6. Local

```bash
npm ci
npm run build
npm run dev:core     # mock API, Live-only UI, no .env required
```

Live against Amboss from a laptop: fill `.env`, then
`set -a && . ./.env && set +a && npm run start:core`.

## 7. When something goes wrong

| Symptom | Look at |
|---|---|
| `healthz` says wallet not ready | Live wallets need ~30 min after creation |
| Deposit QR never settles | `journalctl -u cashier -f`, then the transaction in the Amboss dashboard |
| `FORBIDDEN` on any call | Key is valid but missing a permission. Sends and invoices need `PAYMENTS: WRITE`; `/healthz` needs `WALLETS: READ` |
| Cash out fails instantly | Usually routing or liquidity. The money returns to the session balance |
| `Invoice network ... not allowed` | A testnet invoice against a live wallet |
| Cashtag rejected in Live | A send came back unsupported; server switched to invoice-only. Check logs and run the probe |
| Balance vanished after a reload | Session expired (6h) or the service restarted |
