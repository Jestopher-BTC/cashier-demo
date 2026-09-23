# Security overview

This repo is a small Amboss Payments cashier: a static UI plus a Node server
that mints invoices and sends Lightning payouts. Treat any internet-facing
deploy as hostile.

Nothing in git history on this clone contained a live Amboss key, team
password, or SSH private key. Rotate production secrets anyway
before the repo is public. Checklist:
[docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

Integrators run **core** (`CASHIER_PACKAGE=core`). See the
[README](README.md).

---

## 1. Secrets handling

| Secret | Where it should live | Shipped to the browser? |
|---|---|---|
| `AMBOSS_API_KEY` | `.env` on the box (`chmod 600`), loaded by systemd `EnvironmentFile` | No |
| `AMBOSS_WALLET_ID` | `.env` | Not in the UI. Public `/healthz` does not echo it. |
| `AMBOSS_TEAM_PASSWORD` / `TEAM_PASSWORD` | `.env`. Decrypts the node macaroon **in-process** via `@ambosstech/payments`. Never sent to Amboss GraphQL as plaintext. | No |
| `HEALTHZ_TOKEN` | Optional `.env`. Unlocks full `/healthz` through the proxy. | Only if you put it in a bookmark or chat. |
| GitHub deploy key | On the server, **read-only** on this repo | No. Never copy it into the repo. |
| SSH keys to the host | Operator laptops / cloud console | No |

`.gitignore` ignores `.env`, `.env.local`, `.env.*` (except `.env.example`),
plus `*.pem` / `*.key` / `*.macaroon` / `deploy_key*` / `.ssh/`.
`deploy/push.sh` and `deploy/pull-deploy.sh` never copy or overwrite `.env`.

The only env file in git is `.env.example`, with blank `AMBOSS_API_KEY` and
`AMBOSS_TEAM_PASSWORD`. Test fixtures use obviously fake values
(`amb_live_fake`, `booth-team-password`). No `BEGIN * PRIVATE KEY`
blobs. Scan notes: [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

That does not prove a key was never pasted into a GitHub issue, a chat, or an
old disk image. Rotate before going public.

### What must be rotated

1. **Amboss service API key** (`amb_live_…` / `amb_test_…`). Mint a new one scoped to the cashier wallet; revoke the old one in the Amboss dashboard.
2. **Amboss team password** if it was ever written down outside `.env`.
3. **GitHub deploy key** only if you ever committed it or enabled write access. Read-only is correct. Making the repo public does not leak the private half unless it left the server.
4. Host `authorized_keys` if a laptop key was shared too widely.

Put replacements in `.env` on the box only.

---

## 2. Public attack surface

Default production bind: the systemd unit sets `NODE_ENV=production`, which
binds the Node process to **loopback** (`BIND_HOST=127.0.0.1`). Put a reverse
proxy in front. Do not open port 8080 on the public interface. An example
path prefix is Caddy `handle_path /cashier/*` → `127.0.0.1:8080`.

| Surface | Auth | Notes |
|---|---|---|
| `GET /` static UI | None | CSP (`script-src 'self'`, no `unsafe-inline`), `X-Frame-Options: DENY`, `nosniff`. Camera policy is `self` for cash-out scan. Live flag is `cashier-config.js` on the same origin. An inline `<script>` is blocked, and the UI then falls back to `{ live: false }`. |
| `GET /api/config` | None | Caps and asset. No secrets. |
| `POST /api/session` | None | Creates an unguessable session id (`s_` + 32 hex from `crypto.randomBytes`). |
| `GET /api/state` | Session id | Header `X-Cashier-Session`, body, or `?s=` (logs may still see `?s=`). |
| `POST /api/deposit` | Session + dollar cap | Mints a real invoice when not in mock. |
| `POST /api/withdraw` | Session + balance + cap | Pays a cashtag, Lightning address, or BOLT11. This **moves wallet funds**. |
| `POST /api/session/fund` | Booth staff | Booth-only staff Fund endpoint. Leave it disabled and unused for core. |
| `GET /healthz` | None (redacted) | Booleans + public BTC/USD rate. Wallet id, balances, and raw errors only on **direct loopback** or `HEALTHZ_TOKEN`. |
| `POST /api/dev/settle/*` | Mock only | 404 when `NODE_ENV=production`, even if `MOCK_AMBOSS=1`. |

**CORS.** The API does not send `Access-Control-Allow-Origin`. Browser JS on
another origin cannot read responses. JSON POSTs are non-simple, so classic
CSRF form posts do not apply. Session ids in query strings can still leak via
access logs and Referer. The Live UI also sends `X-Cashier-Session`.

**SSRF.** User input is a cashtag, Lightning address, or BOLT11. This server
does not fetch attacker URLs; Amboss does LNURL resolution. `AMBOSS_GRAPHQL_URL`
is env-only. Do not point it at an internal host.

**Path traversal.** Static files resolve under `public/` or `public-core/` with
`path.relative` confinement. SPA fallback is `index.html` for extensionless
paths only. `check.html`, `check.js`, `cashier-config.js`, `app.js`, and any
other static asset 404 when the file is missing, so the cashier document is
never returned in their place.

**Injection.** JSON body parse, no SQL, no shell. GraphQL variables are
server-built (wallet id and amounts from config and caps), not raw user GraphQL.

**Rate limits.** Token bucket keyed by client IP. Behind a reverse proxy the
socket peer is `127.0.0.1`, so the limiter uses the **rightmost**
`X-Forwarded-For` hop (the address the proxy appended) and `X-Real-IP`.
Untrusted XFF from a non-loopback peer is ignored.

**Errors.** 502s return a generic message. Amboss, GraphQL, and team-password
strings stay in the server log. Failed withdrawals do not stash `entry.error`
on the public session.

---

## 3. Client exposure

The browser bundle must not contain `AMBOSS_API_KEY` or the team password.
Live calls go to same-origin `/api`.

The booth bundle includes, on purpose:

- Calendly URL and sales CTA (`src/booth/booth-sales.js`)
- Official SDK snippets that mention `process.env.AMBOSS_API_KEY` as a **placeholder**, not a value
- Caps and `fundEnabled` from `/api/config`

The **core** bundle (`public-core/`) does not include Mock/Code tabs, Calendly,
or the sales CTA. `src/AmbossCashierMock.jsx` does not import booth-sales.

`usdPerBtc` is a provider prop. The player widget does not show an exchange
rate or a sat balance. A BTC deposit QR may show a muted sats hint.

---

## 4. Session abuse

- Sessions start at $0. The visitor can only withdraw what they deposited.
- Caps: `MIN_*` / `MAX_*` on deposit and cash-out. BOLT11 amounts are priced with a real BTC/USD feed, including on USDT and USDC wallets.
- Sessions are in process memory. A restart clears them.
- Session ids are 128 bits from `crypto.randomBytes`. Guessing a session that holds a balance is the main theft path; unguessable ids are the control.
- Idle expiry: 6 hours. Booth **New visitor** mints a new id. Core resumes the stored id until it expires.

An open browser can cash out that session’s own balance until the session
expires or the process restarts.

---

## 5. Dependency / supply chain

Production runtime: Node 20+, `@ambosstech/payments`, plus the static bundle
(React compiled in, no CDN).

`npm audit` (production): **0** vulnerabilities.

`npm audit` (dev): one **moderate** esbuild issue (dev-server request
forgery, [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)).
This project uses esbuild as a **build** step, not a hosted dev server. Leave
it until a non-breaking bump. Do not `npm audit fix --force`.

Lockfile is committed. Deploy with `npm ci`. The `cashier` system user owns
`/opt/cashier`. The unit sets `NoNewPrivileges`, `ProtectSystem=strict`,
`PrivateTmp`.

---

## 6. Residual risk

### In place

| Issue | Control |
|---|---|
| Predictable session ids | `crypto.randomBytes` (128 bits) |
| Shared 127.0.0.1 bucket behind the proxy | Forwarded-IP limiter |
| Unauthenticated `/healthz` leaking wallet id, balances, and send errors | Redact unless loopback or `HEALTHZ_TOKEN` |
| Amboss/GraphQL errors on 502 and on session history | Generic client errors; log server-side |
| Node listening on `0.0.0.0` in production | `BIND_HOST=127.0.0.1` when `NODE_ENV=production` |
| `/api/dev/settle` if someone shipped `MOCK_AMBOSS=1` | 404 when `NODE_ENV=production` |
| Weak static-path join / missing security headers | Confined resolve + CSP / frame deny / nosniff |

### Still open

| Issue | Plan |
|---|---|
| Session id still accepted as `?s=` (log / Referer leak) | Header is primary. Drop the query param after clients send `X-Cashier-Session` only. |
| In-memory sessions (restart wipes them; no audit log) | Fine for this demo. Persist and log payouts on your side in production. |
| No webhook signature path (polling only) | Add Amboss webhooks when this outgrows polling. |
| esbuild moderate (dev) | Wait for a minor bump. Not in the runtime image. |
| Booth offline HTML | A full booth bundle for a dead network, with no secrets. Core does not use it as the cashier. |

---

## Before this repository is public

Do these on the Amboss dashboard and the host. Do not commit the new values.
Full scan notes: [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md).

- [ ] Mint a new Amboss API key; revoke the previous one.
- [ ] Confirm `AMBOSS_TEAM_PASSWORD` was never in git, tickets, or screenshots; change it if unsure.
- [ ] `chmod 600 /opt/cashier/.env` and confirm it is not world-readable.
- [ ] Confirm the GitHub deploy key is **read-only** and its private half is only on the server.
- [ ] Confirm `ss -lntp | grep 8080` shows `127.0.0.1` only.
- [ ] Public `/healthz` must not show wallet id or balances. On the box, `curl -s http://127.0.0.1:8080/healthz` still can.
- [ ] Optional: set `HEALTHZ_TOKEN` in `.env` for a private full-health URL. Do not paste it into this repo.
- [ ] Flip the GitHub repo to public only after the checklist above.
- [ ] On the reference kiosk host, leave `CASHIER_PACKAGE` unset (booth). A new integrator host sets `core`.

---

## Booth only: staff Fund

`POST /api/session/fund` is a booth-only staff Fund endpoint. Leave it
disabled and unused for a core cashier.

The booth shell is what shows the button. The route still exists on the
server for both packages. It credits `SESSION_START_USD` only when
`FUND_ENABLED` is on **and** `OPERATOR_PIN` is a non-empty PIN. A blank PIN
leaves it off. An empty PIN does not skip the check. Credits stop at
`DAILY_FLOAT_USD` per UTC day, in process memory. Every tap asks for the PIN
again.

Controls on that route: timing-safe compare, per-IP lockout after 8 failures
/ 15 minutes, a global 40-failure trip, and a 20/minute rate limit. Boot warns
if the PIN is shorter than 6 characters. A 6-digit PIN is still
brute-forceable from the internet. Use 6+ digits on a kiosk, or leave the PIN
blank. Tests use `4242` and `424242`. Those are fixtures.

`.env.example` leaves `OPERATOR_PIN` blank. If a kiosk PIN was short or
shared, rotate it on that box only. Do not commit the new value. Loopback
`/healthz` also shows float remaining; the public body does not.

## Tests

```bash
npm run build
node test-security.mjs
node test-live-csp.mjs
node test-fund-gate.mjs
node test-session.mjs
node test-api.mjs
node test-core-split.mjs
```
