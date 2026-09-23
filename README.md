# Amboss Payments cashier

MIT reference implementation of a simple Bitcoin/Lightning cashier for iGaming
(online casino, sportsbook, or gaming wallet) on
[Amboss Payments](https://app.amboss.tech/pay).

Amboss is the rail. This repo is the cashier: a player UI and a small Node
server that mints invoices and sends payouts. The player balance is a
**house-ledger account** on the platform, not a withdrawable custodial wallet.
The player UI talks dollars.

**Integrators start with core.** `CASHIER_PACKAGE=core`, `npm run dev:core`,
`npm run start:core`.

## Done when

Someone new to the repo can:

1. Run the Live core cashier locally, against the mock API or a real wallet.
2. Keep the player experience in the next section when they brand or embed it.
3. Deploy core behind a reverse proxy, with `/healthz` redacted and caps they chose.
4. Treat booth as optional demo chrome.

## Constraints

- Package names stay `core` and `booth`. Ship **core**.
- If `CASHIER_PACKAGE` is unset, the server serves **booth** (so an existing kiosk deploy stays put). Set `core` on a new cashier.
- One process serves one package. This tree has no second URL for the other package.
- Player copy stays **Account balance** and “credited to your account.” Dollars on screen. The only sat figure is a muted hint under a BTC deposit QR.
- This demo settles by poll. It has no inbound webhook.
- Secrets live in `.env` on the host (`chmod 600`). The systemd unit loads that file. The Node process does not read `.env` by itself, and deploy scripts never copy or overwrite it.
- A live wallet needs `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and (for `amb_live_` keys) `AMBOSS_TEAM_PASSWORD`. Key scopes: `PAYMENTS: WRITE`, `WALLETS: READ`, `WALLET_CREDENTIALS: READ`.

## Recommended player experience

These are what the core widget already does
([`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx), hosted by
[`src/core/`](src/core/README.md)). Keep them when you restyle.

### Dollars first

Deposit, balance, and cash-out are in dollars. The widget does not show an
exchange rate or a sat balance. On a BTC wallet the deposit QR adds one muted
line: “Your app may show this as N sats.” A USDT or USDC wallet omits that
line, because the sat amount is not known up front.

### Account framing

The home card is labeled **Account balance**, with the caption “Available to
play or cash out” and the actions **Deposit** and **Cash out**. Deposit opens
with “How much do you want credited to your account?”

### Deposit

An amount field, then four quick amounts: **$1, $5, $20, $100**. Continue
stays disabled outside `MIN_DEPOSIT_USD` / `MAX_DEPOSIT_USD` (defaults **$1**
and **$5**). Raise the max if $20 and $100 should go through; the chips are
fixed in the widget.

The next screen is a Lightning QR, the dollar amount, **Copy invoice**, **Open
in wallet**, and a countdown (`INVOICE_SECONDS`, default 180). The live client
polls until the invoice is paid. A webhook is not required.

### Cash out

The player types a destination. The placeholder is `$cashtag, address, or invoice`.

- `$name` and `name@cash.app` are Cash App cashtags (a Lightning address on `cash.app`).
- `user@domain` is a Lightning address.
- A `lnbc…` BOLT11 invoice uses the amount on the invoice when it has one.
- A bare username (no `@`, and not a `$` cashtag) becomes `name@walletofsatoshi.com`. The field hint says: “Start a cashtag with $. A name goes to Wallet of Satoshi.”

**Scan a code** is optional. With no camera, or on plain HTTP, the player still
types a destination. The widget says so.

On-chain addresses are rejected in the field. If address payouts are off
(`ADDRESS_PAYOUTS=false`, or the server has flipped to invoice-only after an
unsupported send), cashtags and Lightning addresses are refused and the player
is asked for an invoice with an amount. That flip lasts until the process
restarts, which returns to the `ADDRESS_PAYOUTS` setting.

### Short confirmations

Deposit success: “$X added” and “Credited to your account. Ready to play.”

Cash-out success: “$X paid out from your account” and “{destination} has the
money. Your balance is $Y.”

A failed cash-out puts the amount back: “$X is back in your balance and no fee
was charged.” The amount screens already say there is no deposit fee and no
cash-out fee.

### Theme in one object

Widget colour is the `THEMES` object in
[`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx) (dark and light).
Brand changes are a one-object edit. `PaymentsProvider` takes `defaultTheme`.
The hosted core page stores the player’s choice in `localStorage`
(`cashier.theme`).

Page chrome (top bar, status strip) uses CSS variables in
[`src/booth/page.html`](src/booth/page.html). The core build reuses that file.
The status strip shows `LIVE`, the asset, and the in/out caps.

Live boot is `cashier-config.js` on the same origin
(`window.__CASHIER__ = { live: true }`). CSP is `script-src 'self'`, so that
flag stays in the file.

### Caps and session

Operator knobs, set in `.env`:

- Caps: `MIN_DEPOSIT_USD`, `MAX_DEPOSIT_USD`, `MIN_WITHDRAW_USD`, `MAX_WITHDRAW_USD`. Deposit entry enforces the deposit pair. Cash-out entry enforces the minimum and the session balance. The server also rejects cash-outs outside the withdraw pair.
- A session is a server-side balance. The id lives in the browser’s `localStorage` (`cashier.session`). Money, caps, and history live in process memory. Sessions start at **$0**. A player can cash out what they deposited.
- Idle expiry is **6 hours**. A service restart clears sessions.

## Quick start

Node 20+.

```bash
npm ci
npm run build
npm run dev:core                         # MOCK_AMBOSS=1, http://localhost:8080
```

Settle a mock deposit while developing:

```bash
curl -X POST localhost:8080/api/dev/settle/all \
  -H 'content-type: application/json' -d '{}'
```

`/api/dev/settle` is 404 when `NODE_ENV=production`, even if `MOCK_AMBOSS=1`.

For a real wallet, copy [`.env.example`](.env.example), fill the Amboss
fields, set `CASHIER_PACKAGE=core`, and load that file into the environment.
`npm run start:core` sets `CASHIER_PACKAGE=core` for the process; it does not
parse `.env` on its own. On a host, [`deploy/cashier.service`](deploy/cashier.service)
does, via `EnvironmentFile`. Locally:

```bash
cp .env.example .env && chmod 600 .env
set -a && . ./.env && set +a
npm run start:core
```

The command-line `CASHIER_PACKAGE=core` wins over a `booth` value sourced from
`.env`.

## Environment

Every knob is explained in [`server/config.js`](server/config.js) and
[`.env.example`](.env.example).

| Variable | Role |
|---|---|
| `AMBOSS_API_KEY` | Service key from app.amboss.tech/pay, scoped to the wallet. `PAYMENTS: WRITE`, `WALLETS: READ`, `WALLET_CREDENTIALS: READ`. |
| `AMBOSS_WALLET_ID` | Wallet that key is scoped to. |
| `AMBOSS_TEAM_PASSWORD` | Team password. The SDK decrypts node credentials in-process. Needed for live payouts. `TEAM_PASSWORD` is an alias. Sandbox keys (`amb_test_`) can omit it. |
| `CASHIER_PACKAGE` | `core` or `booth`. Default `booth` if unset. |
| `AMBOSS_ASSET` | `BTC`, `USDT`, or `USDC`. Must match the wallet. |
| `ADDRESS_PAYOUTS` | Cashtag and Lightning-address cash-out. Default `true`. An unsupported send flips the server to invoice-only until restart. `false` forces that mode from the start. |
| `MIN_*` / `MAX_*` | Deposit and cash-out caps, in dollars. Defaults are $1–$5. |
| `HEALTHZ_TOKEN` | Optional. Unlocks the full `/healthz` body through the proxy. |

## Copying the widget

Copy [`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx) and
[`src/live-api.js`](src/live-api.js), or run the hosted core package. The
widget talks to the network through four functions. `mockApi` implements them
locally; `createLiveApi` implements them against `/api`. Pass either object to
`<PaymentsProvider api={} />`.

1. `createInvoice({ amountUsd, usdPerBtc })` → `{ id, invoice, satAmount, amountUsd, expiresAt }`
2. `watchInvoice(request, onPaid)` → unsubscribe. Live mode polls.
3. `sendPayment({ amountUsd, destination })` → `{ status: complete | pending | failed }`
4. `loadState()` optional → `{ balanceUsd, transactions }`. When present, the server owns the balance.

Details: [`src/core/README.md`](src/core/README.md).

The cash-out screen includes one demo “recently used” row (`$jestoph`, the
`BOOTH.sampleCashtag` constant). Replace that when you brand the widget.

## Deploy and security

- [DEPLOY.md](DEPLOY.md) — host, systemd, reverse proxy, healthz, caps.
- [SECURITY.md](SECURITY.md) — attack surface and `/healthz` redaction.
- [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md) — go-public checklist.

## Tests

```bash
npm run build
node test-api.mjs
node test-browser.mjs
node test-security.mjs
node test-core-split.mjs
node test-fund-gate.mjs
node test-live-csp.mjs
node test-session.mjs
```

Also: `test-theme.mjs`, `test-usdt-send-amount.mjs`, `test-invoice-rate.mjs`,
`test-sdk-guide.mjs`, `test-send-config.mjs`, `test-qr-scan.mjs`,
`test-static-fallback.mjs`, `test-safari-floor.mjs`, `test-code-view.mjs`,
`test-booth-compat.mjs`, `test-booth-ux.mjs`, `test-cha-ching.mjs`.

## Optional: booth demo

[`src/booth/`](src/booth/README.md) is conference wrapping around the same
widget: Mock / Code / Live tabs, a Calendly discovery CTA, and a cha-ching on
success. Optional staff Fund (a PIN-gated giveaway) lives only in this chrome.
You do not need any of it to ship a cashier.

```bash
npm run dev          # mock API, booth UI
npm start            # live Amboss, booth UI
```

Hide the Calendly block without switching packages: set `SHOW_DISCOVERY_CTA`
to `false` in [`src/booth/booth-sales.js`](src/booth/booth-sales.js). Kiosk
steps, if you run that chrome: [docs/booth/RUNBOOK.md](docs/booth/RUNBOOK.md).

## License

[MIT](LICENSE). Copyright Jesse Shrader / Amboss.
