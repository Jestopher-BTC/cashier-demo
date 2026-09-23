# Core Live cashier

Production package: a Live-only Amboss Payments cashier for an iGaming
account balance (a house-ledger account on the platform). Mock UI, Code View,
Calendly, cha-ching, and Fund chrome live in the booth package only.

```bash
npm run build
npm run dev:core       # MOCK_AMBOSS=1, http://localhost:8080
npm run start:core     # CASHIER_PACKAGE=core; load .env yourself, or use systemd
```

The Node process does not parse `.env`. `npm run start:core` only forces
`CASHIER_PACKAGE=core`. On a host, `deploy/cashier.service` loads `.env` with
`EnvironmentFile`. Locally, `set -a && . ./.env && set +a` before
`npm run start:core`. See the [README](../../README.md).

Copy [`src/AmbossCashierMock.jsx`](../AmbossCashierMock.jsx) plus
[`src/live-api.js`](../live-api.js) and [`server/`](../../server/) to embed the
widget in another host. The hosted build reuses
[`src/booth/page.html`](../booth/page.html) for page-chrome CSS. You do not
need the rest of `src/booth/`.

## Player experience

Keep this when you restyle. Fuller notes are in the [README](../../README.md).

- Dollars on screen. No exchange rate and no sat balance. A BTC deposit QR adds one muted line: “Your app may show this as N sats.”
- Home card: **Account balance**, “Available to play or cash out”, **Deposit** and **Cash out**.
- Deposit: amount, quick amounts **$1 / $5 / $20 / $100**, then a Lightning QR. Continue stays disabled outside `MIN_DEPOSIT_USD` / `MAX_DEPOSIT_USD` (defaults $1 and $5). The live client polls. This demo has no webhook.
- Cash out: typed cashtag, Lightning address, or BOLT11. A bare username becomes `name@walletofsatoshi.com` (`defaultWalletOfSatoshi` in [`src/scan-payload.js`](../scan-payload.js)). Camera scan is optional.
- Success copy stays short: “$X added” / “Credited to your account. Ready to play.” and “$X paid out from your account.”
- Colours: the `THEMES` object in `AmbossCashierMock.jsx`. One object, dark and light. `PaymentsProvider` takes `defaultTheme`.

The cash-out screen ships a demo “recently used” row, `$jestoph`
(`BOOTH.sampleCashtag`). Replace that constant when you brand the widget.

Core sets `demo={false}`, so the simulate-payment bar stays off. Mock
development settles with `POST /api/dev/settle/all` (404 in production).

## Seams

The widget talks to the network through four functions. `mockApi` in
`AmbossCashierMock.jsx` implements them locally; `createLiveApi` in
`live-api.js` implements them against `/api`. The component tree is the same
in both modes; only the object passed to `<PaymentsProvider api={} />` changes.

1. `createInvoice({ amountUsd, usdPerBtc })` → `{ id, invoice, satAmount, amountUsd, expiresAt }`
2. `watchInvoice(request, onPaid)` → unsubscribe function. Live mode polls `GET /api/deposit/:id`.
3. `sendPayment({ amountUsd, destination })` → `{ status: complete | pending | failed }`. The destination is already normalized: a cashtag arrives as a Lightning address, an invoice as the raw BOLT11 string.
4. `loadState()` optional → `{ balanceUsd, transactions }`. When present, the provider treats the server as authoritative.

Live sends use `@ambosstech/payments` `transactions.send` with
`AMBOSS_TEAM_PASSWORD`. GraphQL `create_send` alone does not pay a live wallet.
The session id is stored in `localStorage` under `cashier.session` and sent as
`X-Cashier-Session`.

`parseDestination` accepts a cashtag, a Lightning address, or a BOLT11 invoice.
A cashtag is `$name` → `name@cash.app`. On-chain addresses are rejected in the
field.

Hosted Live boot reads `window.__CASHIER__` from same-origin
`cashier-config.js`. CSP is `script-src 'self'`. Keep the flag in that file.

## Fund

Core does not render Fund. `/api/session/fund` still exists and is gated:
on only when `FUND_ENABLED` is on **and** `OPERATOR_PIN` is non-empty. Leave
the PIN blank on a public cashier.
