# Public MIT release

Checklist before this repository goes from private to public. Visibility is
changed in the GitHub UI, by Jesse, after the rotate items below. Do not
commit the new secret values.

The license is [MIT](../LICENSE). Integrators run **core**
(`CASHIER_PACKAGE=core`). See the [README](../README.md). Threat model:
[SECURITY.md](../SECURITY.md).

## Done when

- Production Amboss key, team password, and operator PIN are rotated or confirmed unused outside `.env`.
- `.env` on the host is mode `600`, and public `/healthz` is redacted.
- The GitHub deploy key is read-only, and its private half is only on the server.
- The repo can be flipped to public from the GitHub UI.

---

## 1. Secret scan (current tree)

No live secrets in the working tree:

| Check | Result |
|---|---|
| `.env` / `.env.local` on disk | Absent from git. `.gitignore` ignores `.env`, `.env.local`, `.env.*` (keeps `.env.example`) plus `*.pem` / `*.key` / `*.macaroon` / `deploy_key*` / `.ssh/`. |
| Private keys / macaroons / deploy keys | None. No `BEGIN * PRIVATE KEY`, no `ssh-ed25519` material in tracked files. |
| Amboss API keys | Fixtures only: `amb_live_fake`, `amb_test_fake`. `.env.example` leaves `AMBOSS_API_KEY=` blank. |
| Team password | Fixture `booth-team-password` in `test-send-config.mjs`. Example file is blank. |
| `OPERATOR_PIN` | Blank in `.env.example`. Tests use `4242` / `424242`. |
| `HEALTHZ_TOKEN` | Blank in `.env.example`. Tests use `test-healthz-token`. |
| AWS / Stripe / GitHub / Slack tokens | None. |
| Calendly | Public booking page only: `https://calendly.com/d/cwfn-s48-3b3/payments-discovery`. Booth chrome. Core never ships it. |
| Personal email in files | None. Examples only (`player@walletofsatoshi.com`, `you@wallet.com`, `jestopher@cash.app`, `root@boltda.sh`). |

The only env file in git is `.env.example`. Secret fields in it are blank.

**History rewrite is not required.** Rotate in place.

A clean tree does not prove a key was never pasted into chat, a screenshot, or
an old disk image. Rotate production secrets anyway.

### Public along with the repo

- Demo cashtag `$jestopher` → `jestopher@cash.app`, and the widget sample `$jestoph`.
- Worked-example host `boltda.sh` and path `/cashier` in [docs/booth/RUNBOOK.md](booth/RUNBOOK.md).
- Booth Calendly URL above.
- Merged pull request bodies. PR #2 quotes a truncated wallet id (`1a7cf21d-…e74a`) and a historical `/healthz` balance. That is not a full id and not a key. Still rotate the Amboss key.
- Git author emails on old commits.

---

## 2. Checklist (then flip visibility)

Do this on the Amboss dashboard and the box. Do not commit the new values.

- [ ] Mint a new Amboss API key; revoke the previous one.
- [ ] Change `AMBOSS_TEAM_PASSWORD` if it was ever written down outside `.env`.
- [ ] Set a new 6+ digit `OPERATOR_PIN`, or leave it blank to disable Fund.
- [ ] `chmod 600 /opt/cashier/.env` and confirm it is not world-readable.
- [ ] Confirm the GitHub deploy key is **read-only** and its private half is only on the server.
- [ ] Confirm `ss -lntp | grep 8080` shows `127.0.0.1` only.
- [ ] Public `/healthz` must not show wallet id or balances. Loopback still can.
- [ ] Optional: `HEALTHZ_TOKEN` in `.env` for a private full-health URL.
- [ ] On the reference kiosk host, leave `CASHIER_PACKAGE` unset (booth). A new integrator host sets `core`.
- [ ] Skim merged pull request bodies (especially #1 and #2). They become public with the repo.
- [ ] Flip the GitHub repo to **public**. Settings → General → Danger zone → Change repository visibility.

After it is public: add a description and topics, and confirm Issues and
Discussions are what you intend.

---

## 3. History rewrite

**Not required.** Prefer rotate-in-place. Rewrite only if a live secret is
later found in git.

1. **Rotate first.** A rewritten clone does not save a key that already left the laptop. Revoke the Amboss key, change the team password and PIN, and replace the deploy key if its private half was committed.
2. Install [git-filter-repo](https://github.com/newren/git-filter-repo) (preferred) or [BFG](https://rtyley.github.io/bfg-repo-cleaner/).
3. Mirror, scrub, force-push every ref. Do not put the leaked secret on the command line. Use `--replace-text` from a file you then shred.
4. Tell anyone with a clone to re-clone. Force-push rewrites SHAs.
5. GitHub support can purge cached objects if a secret hit a gist or a release asset. Also revoke the credential in every third-party dashboard.

Do not rewrite history “just in case.” It breaks existing deploy pins.

---

## 4. What integrators run

```bash
npm ci
npm run build
npm run dev:core       # MOCK_AMBOSS=1, no .env required
```

Live: put secrets in `.env`, set `CASHIER_PACKAGE=core`, and load that file
the way the host does (systemd `EnvironmentFile`). Locally:

```bash
set -a && . ./.env && set +a
npm run start:core
```

Booth is optional demo chrome. One process serves one package.
