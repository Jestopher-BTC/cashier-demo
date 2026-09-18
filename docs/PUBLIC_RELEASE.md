# Public MIT release

Checklist and secret-scan notes before this repository is flipped from
private to public. **Do not change GitHub visibility from this file.** Jesse
does that in the GitHub UI after the rotate items below.

This is not a product claim, a license addendum, or a compliance statement.
The license is [MIT](../LICENSE). Integrators should run **core**
(`CASHIER_PACKAGE=core`). See the [README](../README.md).

---

## 1. Secret scan

### This cleanup (tree at HEAD)

No live secrets in the working tree:

| Check | Result |
|---|---|
| `.env` / `.env.local` on disk | Absent. `.gitignore` ignores `.env`, `.env.local`, `.env.*` (keeps `.env.example`) plus `*.pem` / `*.key` / `*.macaroon` / `deploy_key*` / `.ssh/`. |
| Private keys / macaroons / deploy keys | None. No `BEGIN * PRIVATE KEY`, no `ssh-ed25519` material in tracked files. |
| Amboss API keys | Fixtures only: `amb_live_fake`, `amb_test_fake`. `.env.example` leaves `AMBOSS_API_KEY=` blank. |
| Team password | Fixture `booth-team-password` in `test-send-config.mjs`. Example file is blank. |
| `OPERATOR_PIN` | Blank in `.env.example`. Tests use `4242` / `424242`. |
| `HEALTHZ_TOKEN` | Blank in `.env.example`. Tests use `test-healthz-token`. |
| AWS / Stripe / GitHub / Slack tokens | None. |
| Calendly | Public booking page only: `https://calendly.com/d/cwfn-s48-3b3/payments-discovery`. Booth chrome; core never ships it. |
| Personal email in files | None. Examples only (`player@walletofsatoshi.com`, `you@wallet.com`, `jestopher@cash.app`, `root@boltda.sh`). |

**History rewrite is not required.** Prefer rotate-in-place.

### Earlier pass (2026-09-14, unmerged PR #22)

Scanned `origin/main` at `a17d40d`, 73 commits, 308 blobs, working tree, and
PR bodies #1–#21. Same conclusion: no live Amboss key, team password, operator
PIN, or SSH private key in git. GitHub Issues were not readable from that
scanner token.

The only env file ever added is `.env.example` (commit `932a643` and later
edits). Secret fields have always been blank.

**That does not prove a key was never pasted into Slack, a screenshot, or an
old disk image.** Rotate production secrets anyway.

### Not secrets, but public with the repo

- Demo cashtag `$jestopher` → `jestopher@cash.app` (and booth sample `$jestoph`).
- Worked-example host `boltda.sh` / path `/cashier` in [docs/booth/RUNBOOK.md](booth/RUNBOOK.md).
- Booth Calendly URL above.
- **GitHub PR #2 body** (becomes public with the repo) quotes a *truncated*
  wallet id `1a7cf21d-…e74a` and a historical `/healthz` balance. Not a full
  id and not a key. Still rotate the Amboss key.
- Git author emails: early commits `j@amboss.tech`; later GitHub noreply /
  Cursor agent.

### Removed from the tree in this cleanup

`HANDOFF.md` (agent context, including a historical droplet IPv4
`157.230.85.239` and laptop SSH notes) is deleted from HEAD. That IP remains
in git history. DNS for `boltda.sh` already publishes the address. No rewrite
unless Jesse asks.

`amboss-cashier-integrator.html` (superseded Babel-in-browser artifact) is
deleted from HEAD.

---

## 2. Jesse checklist (do these, then flip visibility)

Do this on the Amboss dashboard and the box. **Do not commit the new values.**
Threat model: [SECURITY.md](../SECURITY.md).

- [ ] Mint a new Amboss API key; revoke the previous one.
- [ ] Change `AMBOSS_TEAM_PASSWORD` if it was ever written down outside `.env`.
- [ ] Set a new 6+ digit `OPERATOR_PIN`, or leave it blank to disable Fund.
- [ ] `chmod 600 /opt/cashier/.env` and confirm it is not world-readable.
- [ ] Confirm the GitHub deploy key is **read-only** and its private half is
      only on the server.
- [ ] Confirm `ss -lntp | grep 8080` shows `127.0.0.1` only.
- [ ] Public `/healthz` must **not** show wallet id or balances. Loopback still can.
- [ ] Optional: `HEALTHZ_TOKEN` in `.env` for a private full-health URL.
- [ ] Keep `CASHIER_PACKAGE` unset (booth) on the kiosk box.
- [ ] Skim merged PR bodies (especially #1 and #2) knowing they go public.
- [ ] Flip the GitHub repo to **public**. Settings → General → Danger zone
      → Change repository visibility. This agent will not do that.

After it is public: add a description, topics, and confirm Issues / Discussions
are what you intend.

---

## 3. History rewrite (only if Jesse asks)

**Not required.** Prefer rotate-in-place. Rewrite only if a *live* secret is
later found in git.

1. **Rotate first.** A rewritten clone does not save a key that already left
   the laptop. Revoke the Amboss key, change the team password and PIN, and
   replace the deploy key if its private half was committed.
2. Install [git-filter-repo](https://github.com/newren/git-filter-repo)
   (preferred) or [BFG](https://rtyley.github.io/bfg-repo-cleaner/).
3. Mirror, scrub, force-push every ref. Do not put the leaked secret on the
   command line; use `--replace-text` from a shredded file.
4. Tell anyone with a clone to re-clone. Force-push rewrites SHAs.
5. GitHub support can purge cached objects if a secret hit a gist or release
   asset. Also revoke the credential in every third-party dashboard.

Do **not** run a history rewrite “just in case.” It breaks existing deploy pins.

---

## 4. What integrators should run

```bash
npm ci
cp .env.example .env && chmod 600 .env
npm run build
npm run start:core     # or: npm run dev:core for MOCK_AMBOSS=1
```

Booth is optional demo chrome. Dual-URL serving (booth at `/` and core at
`/core/` from one process) is **not** on `main`; that is unmerged PR #23.
Today one process serves one package.

---

## 5. Sibling PRs (not merged into this cleanup)

| PR | Status | Conflict with this cleanup |
|---|---|---|
| [#22](https://github.com/Jestopher-BTC/cashier-demo/pull/22) Public MIT scan + README | Open | README / SECURITY / DEPLOY / `.gitignore` overlap. `HANDOFF.md` edits are obsolete (file deleted). `docs/PUBLIC_RELEASE.md` is included here and updated. |
| [#23](https://github.com/Jestopher-BTC/cashier-demo/pull/23) Dual-URL hosting | Draft | Docs there assume booth at `/` and core at `/core/`. This tree still documents `CASHIER_PACKAGE` as a single-tree switch. Rebase #23 after this lands. |
