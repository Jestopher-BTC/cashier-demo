# HANDOFF

Everything a fresh session needs to keep working on this without re-deriving it.
Read this first, then `DEPLOY.md` for operations.

**Owner:** Jestopher (Jesse Shrader), Amboss.
**Purpose:** an iGaming cashier demo for a conference booth, built on the Amboss
Payments SDK. Ships as a working prototype, an integrator reference, and a live
booth app.

---

## 1. Current state

Everything below is built, tested, and packaged. Nothing is half-finished.

| Piece | Where | State |
|---|---|---|
| Cashier components | `src/AmbossCashierMock.jsx` (single file) | done |
| Booth sales / discovery | `src/booth-sales.js` (`SHOW_DISCOVERY_CTA`) | done |
| Three-mode booth app | `src/shell.jsx` → `public/` | done |
| Offline single file | `offline/cashier-offline.html` | done |
| Demo server | `server/` | done; live payouts use `@ambosstech/payments` |
| Deploy kit | `deploy/`, `DEPLOY.md` | done |
| Address-payout probe | `probe-address-payout.mjs` | written, **never run against the real API** |

Tests, all green: `test-api` 36, `test-browser` 33, `test-session` 7,
`test-theme` 7, `test-usdt-send-amount` (USDT $1 cash-out units),
`test-sdk-guide` (official snippet accuracy), `test-code-view` (cheat-sheet UX),
`test-qr-scan` (camera unwrap, error classes, jsQR round-trip).

---

## 2. Product decisions. Do not quietly revert these.

The work went through three UI iterations. Each of these was chosen on purpose,
and re-adding what was removed would undo the point of the demo.

1. **The player never sees an exchange rate, a sat balance, or the word
   Bitcoin.** `usdPerBtc` is a provider prop with no UI surface. The guiding line
   is "the best part is no part": if an element needs explaining, delete it.
2. **One deliberate exception.** A muted line under the deposit QR reads "Your
   app may show this as N sats." It exists because a Lightning wallet displays
   sats and an unexplained mismatch with the dollar figure is a support ticket.
   It is hidden when the sats amount is unknowable (stablecoin wallets).
3. **A cashtag is a Lightning address wearing a costume.** `$jestopher` →
   `jestopher@cash.app`, resolved inside `parseDestination`, never shown to the
   player. The UI says `$jestopher` everywhere: pill, review, send button,
   confirmation, history.
4. **Withdrawal accepts three things**: a cashtag, a Lightning address, or a
   BOLT11 invoice. An invoice carrying an amount skips amount entry and goes
   straight to review with the balance check. Everything else routes through
   amount entry with an "All" button.
5. **Dollars everywhere else.** History, review, confirmations, and the send
   button are all in USD. No fee lines beyond "None": the spread is in the rate.

Voice for any copy you write: plain sentences, no em dashes, no exclamation
marks, active voice in error states, never apologise. Say "Nothing was charged"
rather than "Sorry, something went wrong."

---

## 3. Repo map

```
src/
  AmbossCashierMock.jsx   the deliverable. Provider + 3 flows + QR encoder.
  booth-sales.js          SHOW_DISCOVERY_CTA: Calendly QR + sales CTA. Flip off to strip.
  shell.jsx               booth chrome: Mock UI / Code View / Live UI
  sdk-guide.js            official SDK snippets shown by default in Code View
  live-api.js             browser client implementing the seams against /api
  polyfills.js            hand-rolled ES5 gaps + XHR fetch, no core-js
  highlight.js            tokeniser for Code View
  page.html               chrome CSS, both themes
  generated-sections.js   BUILD ARTEFACT. Never edit; build.mjs rewrites it.
                          Full mock source lives behind "Show full mock source".
server/
  server.js               routes, caps, session gate, capability detection
  amboss.js               GraphQL receive/poll + official SDK send path
  config.js               every env knob, plus minor-unit maths
  store.js                rate cache, sessions, daily float
  mock-amboss.js          fake API for dry runs (MOCK_AMBOSS=1)
deploy/                   Caddyfile, systemd unit, push.sh
build.mjs                 sections → esbuild → Babel ES5 → two HTML outputs
```

Also in the delivery, outside this repo: `amboss-cashier-integrator.html`, a
standalone side-by-side code/UI page from an earlier step. It compiles the JSX in
the browser with Babel from cdnjs. The booth app superseded it.

---

## 4. Architecture in one page

**Four seams.** The entire network surface. `mockApi` in
`AmbossCashierMock.jsx` implements them locally; `createLiveApi` in
`live-api.js` implements them against the server. The component tree is
identical in both modes; only the object passed to `<PaymentsProvider api={} />`
changes. This is the demo's punchline. Protect it.

1. `createInvoice({ amountUsd, usdPerBtc })` → `{ id, invoice, satAmount, amountUsd, expiresAt }`
2. `watchInvoice(request, onPaid)` → returns an unsubscribe function
3. `sendPayment({ amountUsd, destination })` → `{ status: complete | pending | failed }`
   Live implementation calls `@ambosstech/payments` `transactions.send` with
   `AMBOSS_TEAM_PASSWORD`. GraphQL `create_send` alone does not pay a live wallet.
4. `loadState()` optional → `{ balanceUsd, transactions }`. When present the
   provider treats the server as authoritative and stops doing its own
   arithmetic. `resetSession()` pairs with it.

**Session model.** A session is a server-side balance with an id. The id lives in
the iPad's `localStorage` under `cashier.session`; the money, caps, and history
live on the droplet. Sessions start at $0, so a visitor can only cash out what
they just deposited. Free money comes only from the pin-gated `Fund` button,
bounded by `SESSION_START_USD` per grant and `DAILY_FLOAT_USD` per day. Sessions
are in memory: 6-hour idle expiry, and a service restart clears them all.

**Polling, not webhooks.** A booth has no inbound URL. Deposits poll
`/api/deposit/:id` every 1.5s; sends poll `/api/withdraw/:id`. Webhooks are the
production path and are worth mentioning to prospects, but do not add them here.

---

## 5. Amboss API facts established from the docs

- Endpoint `https://app.amboss.tech/graphql`. Header `x-api-key`, **not** Bearer.
  (The send-payments page shows `rails.amboss.tech` in one curl sample; the
  integrate and wallets pages say `app.amboss.tech`. We use `app`, overridable
  via `AMBOSS_GRAPHQL_URL`.)
- **Key permissions: `PAYMENTS: WRITE`, `WALLETS: READ`, and
  `WALLET_CREDENTIALS: READ`, scoped to the wallet id.** Receive invoices only
  need `PAYMENTS`. Live *sends* use `@ambosstech/payments` `transactions.send`,
  which decrypts `wallet.node_permissions` with the team password and pays the
  node. That is the same path as the Amboss Payments UI. `AMBOSS_TEAM_PASSWORD`
  is required for `amb_live_` keys. Do not skip `WALLET_CREDENTIALS` — a
  previous writeup claimed it would break the key; the opposite is true, and
  omitting it is why cashier-demo payouts failed while the Amboss UI succeeded.
- Amounts are **decimal strings in minor units**. BTC precision 8 (sats), USDT
  and USDC precision 6. The validator regex is `/^[1-9]\d*$/`, so `"0"` and
  leading zeros are rejected. Never send JS numbers.
- Live wallets take about **30 minutes** for `is_ready` to flip after creation.
- **Amountless invoices cannot be paid.** The server rejects them up front with
  a message telling the visitor to ask for an invoice with an amount.
- Live wallets reject non-mainnet invoices; sandbox accepts any network.
- Sandbox: invoices auto-settle, and `metadata.amb_sandbox_behavior` of
  `complete` or `fail` drives the terminal state of a send.
- **Open question.** The docs say "Lightning Address sends from Taproot Asset
  wallets are not yet supported." The Amboss team says that note is stale. The
  code trusts the team: `ADDRESS_PAYOUTS` defaults to true for every asset. The
  server detects a real rejection at runtime (`/not (yet )?supported|unsupported|not available/i`),
  flips itself to invoice-only for the rest of the day, refunds, and logs.
  `probe-address-payout.mjs` settles it with one small real send and prints a
  report to paste back to the team. **Not yet run.**

---

## 6. Compatibility constraints

Target is an old iPad of unknown vintage. Practical floor is iOS 12; iOS 15+
looks right in every detail. `public/check.html` reports what a given device
supports.

- The bundle is transpiled to **ES5** (Babel `targets: { ie: "11" }`) and
  includes `regenerator-runtime` for lowered async functions.
- **No CDN at runtime.** React and everything else are bundled. Do not reintroduce
  a script tag pointing at cdnjs; the booth may have no network.
- **Do not use flex `gap`** in new chrome CSS. Safari added it in 14.1. Existing
  uses inside the components degrade to touching elements, which is acceptable;
  new ones should use margins.
- **Do not use CSS `aspect-ratio`.** The scanner viewport uses a `padding-top:
  100%` square for this reason.
- **Cash-out QR scan is a real camera.** `getUserMedia` plus `BarcodeDetector`
  when present, `jsQR` otherwise. Video must stay `playsInline` and muted.
  Grant Camera to the **home-screen app** (Settings → Cashier → Camera →
  Allow) **before** Guided Access. Safari's Camera switch is a different
  permission; iOS will not prompt once Guided Access is locked. Do not treat
  `NotFoundError` or an empty `enumerateDevices` list as "no camera" on iPad —
  that is usually permission denied in standalone. The scanner sheet must stay
  opaque with no opacity/transform/filter compositing (iPad WebKit double-paints
  those, same class of bug as the muddy Mock UI).
- `toLocaleString` is wrapped in try/catch with a manual grouping fallback,
  because old WebKit ships a partial Intl.
- Artifact rule that also applies here: no `localStorage` inside Claude
  artifacts. The booth app is a real web app and does use it for the session id.

---

## 7. Commands

```bash
npm install
npm run build          # rewrites generated-sections.js, public/, offline/
npm run dev            # MOCK_AMBOSS=1, no key, no money, port 8080
npm start              # real API, needs .env

node test-api.mjs              # server flow: caps, credits, refunds, validation
node test-browser.mjs          # three modes in jsdom against a live server
node test-session.mjs          # a reload resumes the balance
node test-theme.mjs            # chrome and card switch theme together
node test-usdt-send-amount.mjs # $1 USDT cash-out is 1e6 minor units, not btc/100
node test-sdk-guide.mjs        # official SDK snippets, not the React mock API
node test-code-view.mjs        # Code View cheat-sheet, highlight, collapsed source
node test-qr-scan.mjs          # unwrap lightning QRs, jsQR round-trip, no auto-detect
node test-fund-gate.mjs        # FUND_ENABLED=0 disables Fund even with a PIN

# settle a mock deposit by hand while in dev
curl -X POST localhost:8080/api/dev/settle/all -H 'content-type: application/json' -d '{}'

# does this wallet pay a Lightning address? dry run, then armed
node probe-address-payout.mjs --to you@wallet.com --usd 0.50
node probe-address-payout.mjs --to you@wallet.com --usd 0.50 --yes

./deploy/push.sh       # from the project directory only; it checks
```

Always run `npm run build` after touching anything in `src/`, then re-run the
browser tests. The build regenerates the collapsed mock-source sections, and a
build failure there means the section banners stopped reassembling into the
source. Default Code View is the official SDK cheat-sheet in `sdk-guide.js`.

---

## 8. Traps. Each of these was a real bug.

- **`defaultTheme` is only an initial value.** `useState(defaultTheme)` reads its
  argument once, which left the page chrome in one palette and the card inside in
  the other. The provider now has an effect tracking the prop. If you add another
  host-owned prop that maps to internal state, do the same.
- **The session id must persist.** Before it did, a refresh silently created a new
  session and stranded the visitor's deposit. It lives in `localStorage` and
  resumes on load; `newSession()` is the only thing that clears it.
- **The mock-only `/api/dev/settle/*` route must sit above the session gate** in
  `server.js`, or it 409s before it can settle anything.
- **Rate limits are per IP and the whole booth is one IP.** They are set
  generously (30 to 40 per minute) on purpose. Tightening them throttles the
  operator, not an attacker; the caps and the session model are the real control.
- **QR format-info bits.** The encoder was verified against a reference
  implementation and round-trip decoded with jsQR. Two bugs lived here: the
  15 format bits are placed MSB first, and copy 2 splits 7 bits down the column
  and 8 bits along the row, not 8 and 7. Do not "clean up" that block without
  re-running a decode test.
- **Sections must reassemble.** `build.mjs` asserts that the Code View sections
  concatenate back into the exact source file. If you add a banner comment in an
  unusual format, that assert fires.
- **rsync from the wrong directory.** The original deploy line used `./`, which
  from a home directory would upload the home directory. `deploy/push.sh` now
  guards this. Keep the guard.
- **iPad `NotFoundError` is not "no camera".** Standalone / A2HS and a
  blocked Camera switch often reject `getUserMedia` as `NotFoundError` and
  return an empty `enumerateDevices` list. Show Settings + Allow camera unless
  devices are actually empty after permission is granted.
- **Translucent scanner overlays double-paint on booth WebKit.** The sheet
  replaces the destination page, stays opaque (`#070C17`), and must not use
  opacity animations, `transform` on corner marks, or `filter` / `box-shadow`.
- **USDT cash-out `amountSats` is sats, not micro-USDT.** `usdToMinor($1)` is
  `1_000_000` on a USDT wallet (correct for `create_receive`). The Live SDK
  field `amountSats` is LNURL satoshis. Passing `1_000_000` there is 0.01 BTC
  and Amboss RFQ-quotes it to ~$800 USDT. Convert dollars to sats with the
  real BTC/USD rate for address sends; never multiply a USDT amount by
  `usdPerBtc`.
- **Empty `OPERATOR_PIN` used to skip Fund auth.** `fundSession` only checked
  the pin when one was set, and Live skipped the dialog when `pinRequired`
  was false, so clearing the pin granted float. Fund is on only when
  `FUND_ENABLED` is on (default; `false` / `0` / `no` to kill) **and**
  `OPERATOR_PIN` is non-empty. Either off-switch grays the button and
  `/session/fund` refuses. A set PIN still prompts on every Fund click.

---

## 9. Open items

1. **Run the address-payout probe** against a sandbox wallet, then a live one.
   Send the printed report to the Amboss team either way: the docs page needs
   correcting if it succeeds. This decides whether the booth can run on USDT,
   which is the better story since the balance is then genuinely dollars.
2. **SSH access to the droplet is unresolved.** `root@boltda.sh` returns
   `Permission denied (publickey)` from Jesse's MacBook Air, though the host key
   is already known under `157.230.85.239`. Next step is `ssh -v` output, or
   adding the key through the DigitalOcean web console. Nothing is deployed yet.
3. **The iPad has not been identified.** Run `check.html` on it before relying on
   it.
4. **Not yet tested against the real API at all.** Everything green so far is
   against `mock-amboss.js`. Rehearse in a SANDBOX environment first; the only
   changes are the key and `AMBOSS_ASSET`.
5. Optional: webhooks instead of polling, if this ever outgrows the booth.

---

## 10. If you are asked to change the UI

The components are deliberately plain: inline styles, no UI dependencies, one
file. Colour comes from a `theme` object with two palettes, so brand changes are
a one-object edit. Before adding an element, check whether removing something
would serve the player better. That instinct is the reason this version is
smaller than the first one and better.

Booth sales chrome (Calendly QR + "Bring this payment UX to your platform!")
is not mixed into the cashier card. It lives in `src/booth-sales.js` behind
`SHOW_DISCOVERY_CTA`. Set that to false to hand the cashier off without hunting
layout. Mock shows the CTA outside the main card. Live stays clean on the
wallet. Cash-out success shows CTA + QR outside the success card.
