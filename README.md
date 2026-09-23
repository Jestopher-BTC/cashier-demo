# Amboss Payments cashier

MIT reference for a Live [Amboss Payments](https://app.amboss.tech/pay) cashier:
deposit and cash out in dollars. The player balance is a **house-ledger
account** on the platform, not a withdrawable custodial wallet. Amboss is the
rail.

The player UI talks dollars, not sats, except a muted hint under a BTC deposit
QR (Lightning wallets show sats). It is a reference implementation, not a
hosted product.

**Integrators: start with core.** Copy
[`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx) and
[`src/live-api.js`](src/live-api.js), or run the Live-only package. You should
not need [`src/booth/`](src/booth/README.md).

## Quick start (Live core)

```bash
npm ci
cp .env.example .env && chmod 600 .env   # leave keys blank for mock
npm run build
npm run dev:core                         # MOCK_AMBOSS=1, http://localhost:8080
```

With a real wallet, fill `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and (for
`amb_live_` keys) `AMBOSS_TEAM_PASSWORD`, then:

```bash
npm run start:core                       # CASHIER_PACKAGE=core, reads .env
```

Settle a mock deposit while developing:

```bash
curl -X POST localhost:8080/api/dev/settle/all \
  -H 'content-type: application/json' -d '{}'
```

## Environment

Copy [`.env.example`](.env.example). Every knob is explained in
[`server/config.js`](server/config.js). Required for a real wallet:

| Variable | Role |
|---|---|
| `AMBOSS_API_KEY` | Service key from app.amboss.tech/pay. Wallet-scoped. `PAYMENTS: WRITE`, `WALLETS: READ`, `WALLET_CREDENTIALS: READ`. |
| `AMBOSS_WALLET_ID` | Wallet that key is scoped to. |
| `AMBOSS_TEAM_PASSWORD` | Team password. The SDK decrypts node credentials in-process. Needed for live payouts. |

Leave those blank and use `npm run dev:core` (`MOCK_AMBOSS=1`) to run without
the API. Never commit `.env`.

Fund giveaway (booth staff chrome; core UI does not show it) is on only when
**both** `FUND_ENABLED` is on (default) **and** `OPERATOR_PIN` is a non-empty
PIN. A blank PIN disables Fund; it does not skip the prompt. The HTTP route is
still gated on both packages.

| Variable | Role |
|---|---|
| `CASHIER_PACKAGE` | `core` (Live-only) or `booth` (optional demo chrome). Default `booth` if unset. |
| `FUND_ENABLED` | `false` / `0` / `no` kills Fund even when a PIN is set. |
| `OPERATOR_PIN` | Blank disables Fund. Use 6+ digits if you run a giveaway. |
| `AMBOSS_ASSET` | `BTC`, `USDT`, or `USDC`. Must match the wallet. |
| `ADDRESS_PAYOUTS` | Cashtag / Lightning-address cash-out. Default `true`; the server falls back to invoice-only if a send is rejected. |

## Theming

Widget colour is the `THEMES` object in
[`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx) (dark / light palettes).
Brand changes are a one-object edit. `PaymentsProvider` takes `defaultTheme`.

Page chrome (top bar, status strip) uses CSS variables in
[`src/booth/page.html`](src/booth/page.html). Core currently shares that shell
file at build time. Live boot is `cashier-config.js` on the same origin
(`window.__CASHIER__ = { live: true }`). Do not put that flag in an inline
`<script>`: CSP is `script-src 'self'`.

Player copy is house-ledger on purpose: **Account balance**, “credited to your
account”, not a custodial wallet. Keep that if you restyle.

## Browser floor

Hosted core and booth boot on **Safari 10 / iOS 10.3 class WebKit** (an iPad
that reports `AppleWebKit/603` and `Version/10.0 Safari/602`). The floor is
Promise, CSS grid, and flexbox. Shipped `app.js` is ES5: no optional chaining
or nullish coalescing. `globalThis` and `Function()` / `eval` are not required.
CSP stays `script-src 'self'` (Live still comes from `cashier-config.js`).

A dark empty cashier on that iPad was a startup exception, not a dead network.
`regenerator-runtime` assigns an implicit global; the strict bundle throws;
the fallback calls `Function()`, which that CSP blocks; React never paints.

`getUserMedia` is **not** on this floor (it shows up around iOS 11). Deposit
QR still renders; pay from another phone. Cash out by typing a cashtag or
Lightning address. Scan a code is optional.

Open `check.html` on the device. It says **Good to go** only when the floor
passes and the camera API is present. Missing `getUserMedia` is called out
as “App can run. Camera cannot.” Below the floor it says so, and does not
say good to go. Flex gap, `inset`, and unprefixed `sticky` are cosmetic
(about iOS 15 / Safari 14.1).

## Optional booth chrome

[`src/booth/`](src/booth/README.md) is conference demo wrapping, not the
integrator path: Mock / Code / Live tabs, Calendly discovery CTA, staff Fund.
The server still defaults to booth (`public/`) so an existing kiosk deploy does
not flip to core by surprise.

```bash
npm run dev          # mock API, booth UI
npm start            # live Amboss, booth UI
```

Hide Calendly without switching packages: set `SHOW_DISCOVERY_CTA` to `false`
in [`src/booth/booth-sales.js`](src/booth/booth-sales.js). Kiosk runbook:
[docs/booth/RUNBOOK.md](docs/booth/RUNBOOK.md).

This tree serves **one package per process** (`CASHIER_PACKAGE=booth` or
`core`). Dual-URL hosting (booth at `/` and core at `/core/` from one Node
process) is not on `main`; that work lives on unmerged PR #23.

## Deploy and security

- [DEPLOY.md](DEPLOY.md) — generic host, systemd, reverse proxy, healthz.
- [SECURITY.md](SECURITY.md) — attack surface, Fund gates, `/healthz` redaction.
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
node test-static-fallback.mjs
node test-safari-floor.mjs
node test-session.mjs
```

Also: `test-theme.mjs`, `test-usdt-send-amount.mjs`, `test-invoice-rate.mjs`,
`test-sdk-guide.mjs`, `test-code-view.mjs`, `test-qr-scan.mjs`,
`test-booth-compat.mjs`, `test-booth-ux.mjs`.

## License

[MIT](LICENSE). Copyright Jesse Shrader / Amboss.
