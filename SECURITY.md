# Security overview

This repo is a small Amboss Payments cashier: a static UI plus a Node server
that mints invoices and sends Lightning payouts. Treat any internet-facing
deploy as hostile. The reference kiosk is `boltda.sh/cashier`.

Nothing in git history on this clone contained a live Amboss key, team
password, operator PIN, or SSH private key. Rotate production secrets anyway
before the repo is public. Go-public checklist:
[docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md). See also
[before public MIT](#before-this-repository-is-public).

---

## 1. Secrets handling

| Secret | Where it should live | Shipped to the browser? |
|---|---|---|
| `AMBOSS_API_KEY` | `.env` on the box (`chmod 600`) | No |
| `AMBOSS_WALLET_ID` | `.env` | Not in the UI. Public `/healthz` used to echo it; that is redacted now. |
| `AMBOSS_TEAM_PASSWORD` / `TEAM_PASSWORD` | `.env`. Decrypts the node macaroon **in-process** via `@ambosstech/payments`. Never sent to Amboss GraphQL as plaintext. | No |
| `OPERATOR_PIN` | `.env`. Fund is off when this is blank. | No. Typed into the PIN dialog, POSTed to `/api/session/fund`. |
| `HEALTHZ_TOKEN` | Optional `.env`. Unlocks full `/healthz` through Caddy. | Only if you put it in a bookmark or chat. |
| GitHub deploy key | `/opt/cashier/.ssh/deploy_key` on the server, **read-only** on this repo | No. Never copy it into the repo. |
| SSH keys to the host | Operator laptops / cloud console | No |

`.gitignore` ignores `.env`, `.env.local`, `.env.*` (except `.env.example`),
plus `*.pem` / `*.key` / `*.macaroon` / `deploy_key*` / `.ssh/`.
`deploy/push.sh` and `deploy/pull-deploy.sh` never copy or overwrite `.env`.

**Git history:** the only env file ever added is `.env.example`, with blank
`AMBOSS_API_KEY` / `AMBOSS_TEAM_PASSWORD` / `OPERATOR_PIN`. Test fixtures use
obviously fake values (`amb_live_fake`, `4242`, `booth-team-password`). No
`BEGIN * PRIVATE KEY` blobs. Details: [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

That does **not** prove a key was never pasted into a GitHub issue, a Slack
thread, or an old disk image. Rotate before going public.

### What must be rotated

1. **Amboss service API key** (`amb_live_…` / `amb_test_…`). Mint a new one
   scoped to the booth wallet; revoke the old one in the Amboss dashboard.
2. **Amboss team password** if it was ever written down outside `.env`.
3. **Operator PIN** if the booth used a short or shared PIN (tests use `4242`
   and `424242` — those are fixtures, never a production PIN).
4. **GitHub deploy key** only if you ever committed it or enabled write access.
   Read-only is correct; making the repo public does not leak the private half
   unless it left the server.
5. Host `authorized_keys` if a laptop key was shared too widely.

Do not put replacements in this repo. Put them in `.env` on the box only.

---

## 2. AuthZ: Fund / admin / float

There is no operator login. Two controls gate free money:

1. `FUND_ENABLED` — default on if unset. `false` / `0` / `no` / `off` kill Fund
   even when a PIN is still set.
2. `OPERATOR_PIN` — blank or missing **disables** Fund. An empty PIN is not
   “unlocked”.

Both must be on for `/api/session/fund` to credit `SESSION_START_USD`, and
credits stop at `DAILY_FLOAT_USD` per UTC day. Every Fund click asks for the
PIN again (no session unlock).

The player UI does not see Fund unless the **booth** shell passes `staff`.
The **core** package never renders Fund. The HTTP endpoint still exists on
both packages; leave `OPERATOR_PIN` blank in production if you are not running
a giveaway.

**Fixes in this pass**

- Timing-safe PIN compare (`crypto.timingSafeEqual`).
- Per-IP lockout after 8 failures / 15 minutes, plus a global 40-failure trip.
- Dedicated rate limit on Fund (20/min after X-Forwarded-For).
- Boot warning if a live PIN is shorter than 6 characters.

**Still medium:** a 6-digit PIN is brute-forceable from the internet given
enough time and IPs. For a public cashier that is not a booth giveaway, keep
Fund off (`OPERATOR_PIN=` or `FUND_ENABLED=false`). For the booth, use 6+
digits and stand next to the iPad.

---

## 3. Public attack surface

Default production bind: the systemd unit sets `NODE_ENV=production`, which
binds the Node process to **loopback** (`BIND_HOST=127.0.0.1`). Put a reverse
proxy in front. Do not open port 8080 on the public interface. The reference
kiosk uses Caddy `handle_path /cashier/*` → `127.0.0.1:8080`.

| Surface | Auth | Notes |
|---|---|---|
| `GET /` static UI | None | CSP (`script-src 'self'`, no `unsafe-inline`), `X-Frame-Options: DENY`, `nosniff`. Camera policy is `self` for cash-out scan. Live flag is `cashier-config.js` on the same origin — not an inline `<script>` (that is blocked and the UI falls back to `{ live: false }`). |
| `GET /api/config` | None | Caps, asset, `fundEnabled`. No secrets. |
| `POST /api/session` | None | Creates an unguessable session id (`s_` + 32 hex from `crypto.randomBytes`). |
| `GET /api/state` | Session id | Header `X-Cashier-Session`, body, or `?s=` (logs may still see `?s=`). |
| `POST /api/deposit` | Session + dollar cap | Mints a real invoice when not in mock. |
| `POST /api/withdraw` | Session + balance + cap | Pays a cashtag, Lightning address, or BOLT11. This **moves wallet funds**. |
| `POST /api/session/fund` | Session + PIN + Fund gates | Giveaway. |
| `GET /healthz` | None (redacted) | Booleans + public BTC/USD rate. Wallet id, balances, float remaining, and raw errors only on **direct loopback** or `HEALTHZ_TOKEN`. |
| `POST /api/dev/settle/*` | Mock only | 404 when `NODE_ENV=production`, even if `MOCK_AMBOSS=1`. |

**CORS.** The API does not send `Access-Control-Allow-Origin`. Browser JS on
another origin cannot read responses. JSON POSTs are non-simple, so classic
CSRF form posts do not apply. Session ids in query strings can still leak via
access logs and Referer; Live UI also sends `X-Cashier-Session`.

**SSRF.** User input is a cashtag / Lightning address / BOLT11. This server
does not fetch attacker URLs; Amboss does LNURL resolution. `AMBOSS_GRAPHQL_URL`
is env-only. Do not point it at an internal host.

**Path traversal.** Static files resolve under `public/` or `public-core/` with
`path.relative` confinement. SPA fallback is `index.html` only.

**Injection.** JSON body parse, no SQL, no shell. GraphQL variables are
server-built (wallet id and amounts from config / caps), not raw user GraphQL.

**Rate limits.** Token bucket keyed by client IP. Behind Caddy the socket peer
is `127.0.0.1`, so the limiter now uses the **rightmost** `X-Forwarded-For`
hop (the address Caddy appended) and `X-Real-IP`. Untrusted XFF from a
non-loopback peer is ignored.

**Error leakage (fixed).** 502s no longer return Amboss / GraphQL / team-password
strings. Failed withdrawals no longer stash `entry.error` on the public
session. Deposit/withdraw poll `warning` fields are gone.

---

## 4. Client exposure

The browser bundle must not contain `AMBOSS_API_KEY`, the team password, or
the operator PIN. Live calls go to same-origin `/api`.

What **is** in the booth bundle, on purpose:

- Calendly URL and sales CTA (`src/booth/booth-sales.js`)
- Official SDK snippets that mention `process.env.AMBOSS_API_KEY` as a
  **placeholder**, not a value
- Caps and `fundEnabled` from `/api/config`

The **core** bundle (`public-core/`) must not include Mock/Code tabs, Calendly,
or the sales CTA. `src/AmbossCashierMock.jsx` no longer imports booth-sales.

`usdPerBtc` is a provider prop. The player UI still does not show an exchange
rate, a sat balance, or the word Bitcoin, except the muted sats hint under a
BTC deposit QR.

---

## 5. Float / session abuse

- Sessions start at $0. The visitor can only withdraw what they deposited, or
  what Fund credited.
- Caps: `MIN_*` / `MAX_*` on deposit and cash-out. BOLT11 amounts are priced
  with a real BTC/USD feed, including on USDT wallets (a previous bug let a
  large invoice through a dollar cap).
- Daily float is in-memory UTC. A restart resets it (and all sessions).
- Session ids were `Math.random()` (~10 base36 chars). They are now 128 bits
  of CSPRNG. Guessing a funded session is the main theft path; unguessable
  ids are the control.
- Idle expiry: 6 hours. “New visitor” (booth) mints a new id.

A visitor who deposits and walks away with the iPad unlocked can cash out
their own deposit. Guided Access is an operational control, not an app one.

---

## 6. Dependency / supply chain

Production runtime: Node 20+, `@ambosstech/payments`, plus the static bundle
(React compiled in, no CDN).

`npm audit` (production): **0** vulnerabilities.

`npm audit` (dev): one **moderate** esbuild issue (dev-server request
forgery, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)).
This project uses esbuild as a **build** step, not a hosted dev server. Leave
it until a non-breaking bump; do not `npm audit fix --force` on the booth box.

Lockfile is committed. Deploy with `npm ci`. The `cashier` system user owns
`/opt/cashier`. The unit sets `NoNewPrivileges`, `ProtectSystem=strict`,
`PrivateTmp`.

---

## 7. Severity board

### Fixed here (critical / high)

| Issue | Fix |
|---|---|
| Predictable session ids (`Math.random`) | `crypto.randomBytes` |
| PIN brute force, timing compare, shared 127.0.0.1 bucket behind Caddy | Timing-safe compare, lockout, XFF-aware limiter |
| Unauthenticated `/healthz` leaked wallet id, balance, remaining float, send errors | Redact unless loopback or `HEALTHZ_TOKEN` |
| Amboss/GraphQL errors returned on 502 and on session history | Generic client errors; log server-side |
| Node listened on `0.0.0.0` in production | `BIND_HOST=127.0.0.1` when `NODE_ENV=production` |
| `/api/dev/settle` if someone shipped `MOCK_AMBOSS=1` | 404 when `NODE_ENV=production` |
| Weak static-path join / missing security headers | Confined resolve + CSP / frame deny / nosniff |

### Medium / low — fix plan (not all landed)

| Issue | Plan |
|---|---|
| Session id still accepted as `?s=` (log / Referer leak) | Header is primary; drop the query param after clients send `X-Cashier-Session` only. |
| Short PIN still allowed | Boot warns. Optionally refuse to enable Fund if `OPERATOR_PIN.length < 6`. |
| In-memory sessions / float (restart = wipe, no audit log) | Acceptable for a kiosk. Production integrators should persist and log payouts on their side. |
| No webhook signature path (polling only) | Documented. Add Amboss webhooks when this outgrows polling. |
| esbuild moderate (dev) | Wait for a minor bump; not in the runtime image. |
| Offline HTML is a full booth bundle | Intentional for venue wifi death. Do not put secrets in it. |

---

## Before this repository is public

Do these on the Amboss dashboard and the host. Do **not** commit the new
values. Full scan notes: [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

- [ ] Mint a new Amboss API key; revoke the previous one.
- [ ] Confirm `AMBOSS_TEAM_PASSWORD` was never in git, tickets, or screenshots; change it if unsure.
- [ ] Set a new 6+ digit `OPERATOR_PIN`, or leave it blank to disable Fund.
- [ ] `chmod 600 /opt/cashier/.env` and confirm it is not world-readable.
- [ ] Confirm the GitHub deploy key is **read-only** and its private half is only on the server.
- [ ] After `NODE_ENV=production` lands, confirm `ss -lntp | grep 8080` shows `127.0.0.1` only.
- [ ] Public `/healthz` must **not** show wallet id or balances. On the box, `curl -s http://127.0.0.1:8080/healthz` still can.
- [ ] Optional: set `HEALTHZ_TOKEN` in `.env` for a private full-health URL; do not paste it into this repo.
- [ ] Flip the GitHub repo to public only after the checklist above. Do not have an agent flip visibility.
- [ ] Keep `CASHIER_PACKAGE` unset (booth) on the kiosk host until you explicitly want core.

---

## Running tests that cover this

```bash
npm run build
node test-security.mjs
node test-live-csp.mjs
node test-fund-gate.mjs
node test-session.mjs
node test-api.mjs
node test-core-split.mjs
```
