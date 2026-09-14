# Amboss Payments cashier

MIT reference for an [Amboss Payments](https://app.amboss.tech/pay) Live
cashier: deposit and cash out in dollars, with a house-ledger style player
balance (an account on the platform, not a withdrawable custodial wallet).

Amboss is the rail. The player UI talks dollars, not sats, except a muted
hint under a BTC deposit QR (Lightning wallets show sats). Built as an
iGaming-style integrator sample and as a conference booth demo. It is a
reference implementation, not a hosted product.

Two packages live in this repo:

| Package | What it is | How to run |
|---|---|---|
| **Core** | Live-only cashier. No Mock UI, Code View, Calendly, or Fund giveaway chrome. **This is the production path.** | `npm run build && npm run start:core` |
| **Booth** | Conference wrapper: Mock / Code / Live, discovery CTA, staff Fund. **Default.** This is the `boltda.sh/cashier` path. | `npm run build && npm run start` |

Integrators who want “core only” should start at [`src/core/`](src/core/README.md)
and [`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx). You should not
need to hunt through [`src/booth/`](src/booth/README.md).

## Quick start

```bash
npm install
cp .env.example .env   # chmod 600; leave keys blank and use mock, or fill them in
npm run build
npm run dev            # MOCK_AMBOSS=1, booth UI, http://localhost:8080
```

Live money needs `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and (for `amb_live_`
keys) `AMBOSS_TEAM_PASSWORD`. Every knob is listed in [`.env.example`](.env.example)
and explained in [`server/config.js`](server/config.js).

```bash
npm start              # booth + real Amboss, reads .env
npm run start:core     # same server, Live-only UI (CASHIER_PACKAGE=core)
npm run dev:core       # mock API, Live-only UI
```

`CASHIER_PACKAGE=core` serves `public-core/`. Leave it unset (booth,
`public/`) on boltda.sh until that split is what you want on stage.

## Environment

Copy `.env.example`. Required for a real wallet:

| Variable | Role |
|---|---|
| `AMBOSS_API_KEY` | Service key from app.amboss.tech/pay. Wallet-scoped. `PAYMENTS: WRITE`, `WALLETS: READ`, `WALLET_CREDENTIALS: READ`. |
| `AMBOSS_WALLET_ID` | Wallet that key is scoped to. |
| `AMBOSS_TEAM_PASSWORD` | Team password. The SDK decrypts node credentials in-process. Needed for live payouts. |

Leave those blank and set `MOCK_AMBOSS=1` (or use `npm run dev`) to run
without the API. Never commit `.env`.

## Strip booth / sales chrome

Three independent switches:

1. **Production package:** `CASHIER_PACKAGE=core` (or `npm run start:core`).
   Core never imports booth files.
2. **Keep booth, hide Calendly / CTA:** set `SHOW_DISCOVERY_CTA` to `false`
   in [`src/booth/booth-sales.js`](src/booth/booth-sales.js).
3. **Disable Fund:** leave `OPERATOR_PIN` blank and/or set
   `FUND_ENABLED=false`. Fund is on only when both the flag is on and a PIN
   is set. A blank PIN does not skip the prompt. Core UI does not show Fund;
   the HTTP route is still gated.

## Security

Read [SECURITY.md](SECURITY.md) before you put this on the internet. The
go-public checklist (secret scan, rotate, history rewrite if needed) is
[docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

Fund is on only when **both** `FUND_ENABLED` is on (default) **and**
`OPERATOR_PIN` is a non-empty PIN.

## Deploy

[DEPLOY.md](DEPLOY.md) is a worked runbook for `boltda.sh/cashier`.
Substitute your host, path, and system user. The droplet `.env` stays on
the box; deploy scripts never copy it.

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

## License

[MIT](LICENSE). Copyright Jesse Shrader / Amboss.
