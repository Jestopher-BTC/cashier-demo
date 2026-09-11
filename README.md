# Amboss Payments cashier

Live Lightning cashier (deposit / cash out in dollars) on the Amboss Payments
SDK. MIT licensed. Built as an iGaming reference and as a conference booth
demo.

Two packages live in this repo:

| Package | What it is | How to run |
|---|---|---|
| **Core** | Live-only cashier. No Mock UI, Code View, Calendly, or Fund giveaway chrome. | `npm run build && npm run dev:core` |
| **Booth** | Conference wrapper: Mock / Code / Live, discovery CTA, staff Fund. **Default.** This is the `boltda.sh/cashier` path. | `npm run build && npm run dev` |

Integrators who want “core only” should start at [`src/core/`](src/core/README.md)
and [`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx). You should not
need to hunt through [`src/booth/`](src/booth/README.md).

## Quick start

```bash
npm install
cp .env.example .env   # leave keys blank and use mock, or fill them in
npm run build
npm run dev            # MOCK_AMBOSS=1, booth UI, http://localhost:8080
```

Live money needs `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and (for `amb_live_`
keys) `AMBOSS_TEAM_PASSWORD`. See [DEPLOY.md](DEPLOY.md).

```bash
npm start              # booth + real Amboss, reads .env
npm run start:core     # same server, Live-only UI (CASHIER_PACKAGE=core)
```

`boltda.sh` must keep the default (booth, `public/`). Do not set
`CASHIER_PACKAGE=core` on that box until the split is what you want on stage.

## Fund giveaway

Fund is on only when **both** `FUND_ENABLED` is on (default) **and**
`OPERATOR_PIN` is a non-empty PIN. A blank PIN disables Fund; it does not skip
the prompt. Core UI does not show Fund; the HTTP route is still gated.

## Security

Read [SECURITY.md](SECURITY.md) before making this repository public. Rotate
Amboss keys, the team password, and the operator PIN even though git history
on this clone does not contain live secrets.

## Tests

```bash
npm run build
node test-api.mjs
node test-browser.mjs
node test-security.mjs
node test-core-split.mjs
node test-fund-gate.mjs
```

More commands: [HANDOFF.md](HANDOFF.md).
