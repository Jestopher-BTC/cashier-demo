# Public MIT release

Checklist and secret-scan notes before this repository is flipped from
private to public. **Do not change GitHub visibility from this file.** Jesse
does that in the GitHub UI after the rotate items below.

This is not a product claim, a license addendum, or a compliance statement.
The license is [MIT](../LICENSE).

---

## 1. Secret scan (2026-09-14)

Second pass, after [PR #20](https://github.com/Jestopher-BTC/cashier-demo/pull/20)
and [PR #21](https://github.com/Jestopher-BTC/cashier-demo/pull/21). Scope:
`origin/main` at `a17d40d`, all **73** commits, **308** git blobs, the working
tree, `.env.example` through history, deleted paths, and PR bodies #1–#21.
GitHub Issues were not readable from the scanner token.

### Working tree

| Check | Result |
|---|---|
| `.env` / `.env.local` on disk | Absent. `.gitignore` ignores `.env`, `.env.local`, `.env.*` (keeps `.env.example`). |
| Private keys / macaroons / deploy keys | None. No `BEGIN * PRIVATE KEY`, no `ssh-ed25519` material, no `*.pem` / `*.key` blobs. |
| Amboss API keys | Only fixtures: `amb_live_fake`, `amb_test_fake`. `.env.example` leaves `AMBOSS_API_KEY=` blank. |
| Team password | Only fixture `booth-team-password` in `test-send-config.mjs`. Example file is blank. |
| `OPERATOR_PIN` | Blank in `.env.example`. Tests use `4242` / `424242` (documented fixtures, not a booth PIN). |
| `HEALTHZ_TOKEN` | Blank in `.env.example`. Tests use `test-healthz-token`. |
| Wallet id | Example is blank. Tests use `wallet-1`. |
| AWS / Stripe / GitHub / Slack / Google tokens | None. |
| JWTs / Bearer tokens | None. |
| Calendly | Public booking page only: `https://calendly.com/d/cwfn-s48-3b3/payments-discovery`. Not an admin or private-event URL. Booth chrome; core never ships it. |
| Personal email in files | None. Tree emails are examples (`player@walletofsatoshi.com`, `you@wallet.com`), the demo cashtag `jestopher@cash.app`, and deploy comments (`root@boltda.sh`, `cashier-demo@boltda.sh`). |
| Git author emails | Early commits: `j@amboss.tech`. Later: GitHub noreply / Cursor agent. These are already in history and will be public. No personal ProtonMail in the tree. |

### Git history

- The only env file ever added is `.env.example` (commit `932a643` and later
  edits). Secret fields have always been blank.
- Deleted paths: `src/booth-sales.js` and `src/generated-sections.js` (moved
  under `src/booth/` in PR #20). No secrets in the old copies.
- No live `amb_live_` / `amb_test_` key, no team password, no operator PIN
  other than test fixtures, no SSH private key, in any blob.

**That does not prove a key was never pasted into Slack, a screenshot, or
an old droplet image.** Rotate production secrets anyway.

### Not secrets, but public with the repo

These are intentional or already on the public internet. Know they ship:

- Demo cashtag `$jestopher` → `jestopher@cash.app` (product copy; HANDOFF
  treats this as the example destination).
- Worked-example host `boltda.sh` / path `/cashier` in `DEPLOY.md`.
- Booth Calendly URL above.
- **GitHub PR #2 body** (becomes public with the repo) quotes a *truncated*
  booth wallet id `1a7cf21d-…e74a` and a historical `/healthz` balance
  (~29.2 USDTL). Not a full id and not a key. Still rotate the Amboss key
  and treat that wallet as named.

### Removed from the current tree in this pass

`HANDOFF.md` had the droplet IPv4 `157.230.85.239` and a laptop-specific SSH
note. Those are gone from HEAD. They remain in git history (see
[History rewrite](#3-history-rewrite-only-if-jesse-asks)). No rewrite unless
you want that IP out of clones; DNS for `boltda.sh` already publishes the
address.

`.gitignore` now also ignores `*.pem`, `*.key`, `*.macaroon`, `id_rsa*`,
`id_ed25519*`, `deploy_key*`, and `.ssh/`.

---

## 2. Jesse checklist (do these, then flip visibility)

Do this on the Amboss dashboard and the droplet. **Do not commit the new
values.** Full threat-model notes: [SECURITY.md](../SECURITY.md).

- [ ] Mint a new Amboss API key; revoke the previous one.
- [ ] Change `AMBOSS_TEAM_PASSWORD` if it was ever written down outside `.env`.
- [ ] Set a new 6+ digit `OPERATOR_PIN`, or leave it blank to disable Fund.
- [ ] `chmod 600 /opt/cashier/.env` and confirm it is not world-readable.
- [ ] Confirm the GitHub deploy key is **read-only** and its private half is
      only on the droplet.
- [ ] Confirm `ss -lntp | grep 8080` shows `127.0.0.1` only.
- [ ] `curl -s https://boltda.sh/cashier/healthz` must **not** show wallet id
      or balances. On the box, `curl -s http://127.0.0.1:8080/healthz` still can.
- [ ] Optional: `HEALTHZ_TOKEN` in `.env` for a private full-health URL.
- [ ] Keep `CASHIER_PACKAGE` unset (booth) on boltda.sh until you want core.
- [ ] Skim merged PR bodies (especially #1 and #2) knowing they go public.
- [ ] Flip the GitHub repo to **public**. Settings → General → Danger zone
      → Change repository visibility. This agent will not do that.

After it is public: add a description, topics (`lightning`, `amboss`,
`igaming` if you want them), and confirm Issues / Discussions are what you
intend (they default to whatever the private repo had).

---

## 3. History rewrite (only if Jesse asks)

**Not required for this scan.** Prefer rotate-in-place. Rewrite only if a
*live* secret is later found in git.

1. **Rotate first.** A rewritten clone does not save a key that already left
   the laptop. Revoke the Amboss key, change the team password and PIN, and
   replace the deploy key if its private half was committed.
2. Install [git-filter-repo](https://github.com/newren/git-filter-repo)
   (preferred) or [BFG](https://rtyley.github.io/bfg-repo-cleaner/).
3. Mirror, scrub, force-push every ref:

```bash
git clone --mirror git@github.com:Jestopher-BTC/cashier-demo.git cashier-demo.git
cd cashier-demo.git

# filter-repo: drop a path that should never have been committed
git filter-repo --invert-paths --path .env --path deploy_key

# or replace a leaked string everywhere (put the real secret in a file,
# never on the command line)
printf 'LEAKED_SECRET==>REDACTED\n' > /tmp/replacements.txt
git filter-repo --replace-text /tmp/replacements.txt
shred -u /tmp/replacements.txt

# BFG alternative for blobs, from a sibling checkout:
# java -jar bfg.jar --delete-files .env cashier-demo.git
# java -jar bfg.jar --replace-text /tmp/replacements.txt cashier-demo.git
# git reflog expire --expire=now --all && git gc --prune=now --aggressive

git push --force --mirror origin
```

4. Tell anyone with a clone to re-clone. Force-push rewrites SHAs; open PRs
   against old SHAs will need a rebase.
5. GitHub support can purge cached objects if a secret hit a gist or release
   asset. Also revoke the credential in every third-party dashboard.

Do **not** run the commands above “just in case.” They rewrite every commit
and break existing deploy pins.

---

## 4. What integrators should run

Production path is **core** (`CASHIER_PACKAGE=core`): Live-only, no booth
sales chrome. See the [README](../README.md).

```bash
npm ci
cp .env.example .env   # chmod 600; fill keys or leave blank and use mock
npm run build
npm run start:core     # or: npm run dev:core for MOCK_AMBOSS=1
```

Booth (default) is conference chrome for `boltda.sh/cashier`. Strip sales
without switching packages by setting `SHOW_DISCOVERY_CTA` to `false` in
[`src/booth/booth-sales.js`](../src/booth/booth-sales.js).
