# Core Live cashier

This folder is the **production** package: Live-only Amboss Payments cashier
for a house-ledger style player balance (an account on the platform, not a
withdrawable custodial wallet). No Mock UI, Code View, Calendly QR, sales CTA,
or Fund giveaway chrome.

```bash
npm run build
npm run dev:core       # MOCK_AMBOSS=1, http://localhost:8080
npm run start:core     # real Amboss, needs .env (CASHIER_PACKAGE=core)
```

Copy [`src/AmbossCashierMock.jsx`](../AmbossCashierMock.jsx) plus
[`src/live-api.js`](../live-api.js) / [`server/`](../../server/) if you are
embedding the widget in another host. You should not need anything under
`src/booth/` except that the hosted build currently reuses
[`src/booth/page.html`](../booth/page.html) for page chrome CSS.

## Seams

The widget talks to the network through four functions. `mockApi` in
`AmbossCashierMock.jsx` implements them locally; `createLiveApi` in
`live-api.js` implements them against `/api`. The component tree is the same
in both modes; only the object passed to `<PaymentsProvider api={} />` changes.

1. `createInvoice({ amountUsd, usdPerBtc })` → `{ id, invoice, satAmount, amountUsd, expiresAt }`
2. `watchInvoice(request, onPaid)` → unsubscribe function
3. `sendPayment({ amountUsd, destination })` → `{ status: complete | pending | failed }`
4. `loadState()` optional → `{ balanceUsd, transactions }`. When present the
   provider treats the server as authoritative.

Live sends use `@ambosstech/payments` `transactions.send` with
`AMBOSS_TEAM_PASSWORD`. GraphQL `create_send` alone does not pay a live wallet.
This demo polls; it has no inbound webhook URL.

Hosted core uses the same ES5 bundle floor as booth: Safari 10 / iOS 10.3
class WebKit (Promise, CSS grid, flexbox). See the [README](../../README.md)
browser floor. Deposit QR does not need a camera. Cash out accepts a typed
cashtag or Lightning address when `getUserMedia` is missing.

## Theming and copy

- Colours: `THEMES` in `AmbossCashierMock.jsx`. One object, dark and light.
- Player copy stays dollars. Do not surface an exchange rate, a sat balance,
  or the word Bitcoin in the player UI, except the muted “Your app may show
  this as N sats” line under a BTC deposit QR.
- Balance is an **account**: “Account balance”, “credited to your account.”
- Cash-out accepts a cashtag, a Lightning address, or a BOLT11 invoice.
  A cashtag is a Lightning address (`$name` → `name@cash.app`) resolved in
  `parseDestination`. A bare username (no `@`, not a `$` cashtag) becomes
  `name@walletofsatoshi.com`.

## Fund

Core does not render Fund. `/api/session/fund` still exists and is gated:
on only when `FUND_ENABLED` is on **and** `OPERATOR_PIN` is non-empty. Leave
the PIN blank in production if you are not running a giveaway.
