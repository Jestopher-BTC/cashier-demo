# Optional booth kiosk

Conference demo chrome around the core cashier: Mock / Code / Live, discovery
CTA, staff Fund. Integrators do not need this. Production path is
`CASHIER_PACKAGE=core` (see the [README](../../README.md)).

This file is the worked kiosk runbook for the reference host. Swap domain,
path, app dir, and system user if you run the same chrome elsewhere.

```
https://boltda.sh/cashier              booth UI (keep this)
https://boltda.sh/cashier/check.html   device check, run first on the iPad
https://boltda.sh/cashier/healthz      redacted; is the process up
```

**Do not set `CASHIER_PACKAGE=core` on that box.** Leave it unset or `booth`
so Mock / Code / Fund stay on the kiosk. `deploy/pull-deploy.sh` is the update
path; it never touches `.env`.

Generic host, systemd, and Amboss key setup: [DEPLOY.md](../../DEPLOY.md).

---

## Before doors open

- `healthz` green; unredacted loopback view shows wallet balance above the
  day’s float.
- Phone wallet installed, funded, and already on venue wifi.
- One full Live loop: deposit $1, cash out $1. Then **New visitor**.
- Note `DAILY_FLOAT_USD`. When it is gone, Live is still deposit-then-withdraw
  your own money.

## The 90 second demo

1. **Mock UI.** Walk deposit and cash out. The player never sees a rate, a sat,
   or the word Bitcoin (except the muted sats hint under a BTC deposit QR).
2. **Code View.** Three official SDK calls: receive, send, webhook. Full mock
   source is behind **Show full mock source**.
3. **Live UI.** Deposit a dollar, scan the QR, cash out to a cashtag.
4. **New visitor** before the next person.

If the venue network dies, stay on Mock. If the iPad itself is offline, use
`offline/cashier-offline.html` (built next to `public/`; AirDrop or a laptop
hotspot). It is mock + code only, no secrets.

## iPad

1. Open `/cashier/check.html`. Green means go. Amber is cosmetic. Floor is
   roughly iOS 12; iOS 15+ looks right.
2. Tap **Test camera** (or Cash out → Scan a code) and allow Camera **before**
   Guided Access. iOS will not prompt once it is locked.
3. Open `/cashier`, Share → **Add to Home Screen**. Grant Camera again to the
   home-screen app (Settings → Cashier → Camera → Allow). Safari and the
   home-screen icon are different switches.
4. Auto-Lock: Never. Guided Access on. Brightness high.

`NotFoundError` / empty `enumerateDevices` on iPad is usually permission
denied in standalone, not “no camera.”

## Reference host overlay

`boltda.sh` already runs another app on Caddy. Add only the two `/cashier`
lines inside the existing site block ([`deploy/Caddyfile`](../../deploy/Caddyfile)).
Do not add a second `boltda.sh { }` block.

```bash
ssh boltdash
sudo /opt/cashier/deploy/pull-deploy.sh
sudo grep -n CASHIER_PACKAGE /opt/cashier/.env || true
# leave unset or booth
curl -s https://boltda.sh/cashier/healthz | jq
```

After deploy, the Mock/Live footer shows `build` plus `git rev-parse --short HEAD`
from `/opt/cashier`.

Laptop fallback: `HOST=root@boltda.sh ./deploy/push.sh` (or override `HOST`).
If SSH says `Permission denied (publickey)`, that is an operator-laptop key
problem, not an app bug; use the cloud console to install `authorized_keys`.

## Strip sales chrome, keep the kiosk

Set `SHOW_DISCOVERY_CTA` to `false` in
[`src/booth/booth-sales.js`](../../src/booth/booth-sales.js), rebuild, redeploy.
Fund is independent: blank `OPERATOR_PIN` and/or `FUND_ENABLED=false`.
