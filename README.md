# Amboss Payments cashier

Live Lightning cashier (deposit / cash out in dollars) on the Amboss Payments
SDK. MIT licensed. Built as an iGaming reference and as a conference booth
demo.

Two packages live in this repo. **One Node process serves both** when both
build outputs exist (the default):

| Package | What it is | Local | boltda.sh |
|---|---|---|---|
| **Booth** | Conference wrapper: Mock / Code / Live, discovery CTA, staff Fund. **SBC path. Unchanged.** | `http://localhost:8080/` | `https://boltda.sh/cashier/` |
| **Core** | Live-only cashier. No Mock UI, Code View, Calendly, or Fund giveaway chrome. | `http://localhost:8080/core/` | `https://boltda.sh/cashier/core/` |

Both UIs talk to the same Amboss wallet: shared `/api` (and `/core/api` from
the core page), shared sessions, shared Fund gates. Caddy can keep proxying
`/cashier/` as today. Node owns the `/core/` tree.

`CASHIER_PACKAGE=booth` or `core` is the old single-tree fallback (that
package at `/`). Leave it unset for dual-serve.

Integrators who want “core only” should start at [`src/core/`](src/core/README.md)
and [`src/AmbossCashierMock.jsx`](src/AmbossCashierMock.jsx). You should not
need to hunt through [`src/booth/`](src/booth/README.md).

## Quick start

```bash
npm install
cp .env.example .env   # leave keys blank and use mock, or fill them in
npm run build
npm run dev            # MOCK_AMBOSS=1, booth at /, core at /core/
```

Live money needs `AMBOSS_API_KEY`, `AMBOSS_WALLET_ID`, and (for `amb_live_`
keys) `AMBOSS_TEAM_PASSWORD`. See [DEPLOY.md](DEPLOY.md).

```bash
npm start              # dual URLs + real Amboss, reads .env
npm run start:core     # Live-only UI at /  (CASHIER_PACKAGE=core)
npm run start:booth    # booth only at /   (CASHIER_PACKAGE=booth)
```

Do **not** set `CASHIER_PACKAGE=core` on boltda.sh. That would move core to
`/` and take Mock/Code/Fund off the SBC iPad. Dual-serve (unset) keeps booth
at `/cashier/` and adds `/cashier/core/`.

## Fund giveaway

Fund is on only when **both** `FUND_ENABLED` is on (default) **and**
`OPERATOR_PIN` is a non-empty PIN. A blank PIN disables Fund; it does not skip
the prompt. Core UI does not show Fund; the HTTP route is still gated (same
wallet, either origin).

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
node test-dual-static.mjs
node test-fund-gate.mjs
node test-live-csp.mjs
```

More commands: [HANDOFF.md](HANDOFF.md).
