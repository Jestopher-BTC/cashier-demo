# Booth kiosk (optional)

Demo chrome for a live kiosk: Mock / Code / Live, a discovery CTA, and staff
Fund. Integrators use core. See the [README](../../README.md).

This file is the reference host. Swap domain, path, app dir, and system user
if you run the same chrome elsewhere.

```
https://boltda.sh/cashier
https://boltda.sh/cashier/check.html
https://boltda.sh/cashier/healthz
```

Leave `CASHIER_PACKAGE` unset or `booth` on that box so Mock / Code / Fund
stay on. `deploy/pull-deploy.sh` is the update path. It never touches `.env`.

Host, systemd, and Amboss key setup: [DEPLOY.md](../../DEPLOY.md).

## Before doors open

- `/healthz` is up. On the box, the unredacted loopback view shows wallet balance above the day’s float.
- A phone wallet is installed, funded, and already on the venue network.
- One full Live loop: deposit $1, cash out $1, then **New visitor**.
- Note `DAILY_FLOAT_USD`. After it is used, Live is still deposit-then-cash-out of the player’s own money.

## Demo order

1. **Mock.** Walk deposit and cash out. The player sees dollars. A BTC deposit QR may add a muted sats hint.
2. **Code.** Three SDK calls: receive, send, webhook. Full mock source is behind **Show full mock source**.
3. **Live.** Deposit a dollar, pay the QR, cash out to a cashtag.
4. **New visitor** before the next person.

If the venue network dies, stay on Mock. If the device itself is offline, use
`offline/cashier-offline.html` (built next to `public/`). It is mock and code
only, and it contains no secrets.

## On the device

1. Open `/cashier/check.html`.
   - **Good to go** — the page floor is met and the camera API is present.
   - **App can run. Camera cannot.** — the deposit QR works, and cash-out is typed. Scan a code does not.
   - **Below the floor** — the cashier will not boot. Use another device.
2. If the camera API is present, allow Camera before Guided Access (Cash out → Scan a code, or **Test camera** on the check page). The OS will not prompt once Guided Access is on.
3. Open `/cashier`, then Share → **Add to Home Screen**. If you use the camera, allow Camera for the home-screen app as well (Settings → Cashier → Camera). The browser and the home-screen icon are separate switches.
4. Auto-Lock: Never. Guided Access on. Brightness high.

Typed cash-out (cashtag, Lightning address, or invoice) works when the camera
is unavailable.

## Reference host

`boltda.sh` already runs another app on Caddy. Add only the `/cashier` lines
inside the existing site block ([`deploy/Caddyfile`](../../deploy/Caddyfile)).

```bash
ssh boltdash
sudo /opt/cashier/deploy/pull-deploy.sh
sudo grep -n CASHIER_PACKAGE /opt/cashier/.env || true
curl -s https://boltda.sh/cashier/healthz | jq
```

After deploy, the Mock/Live footer shows the build id.

From a laptop: `HOST=root@boltda.sh ./deploy/push.sh` (or set `HOST`).

## Hide the sales line

Set `SHOW_DISCOVERY_CTA` to `false` in
[`src/booth/booth-sales.js`](../../src/booth/booth-sales.js), rebuild, and
redeploy. Fund is separate: blank `OPERATOR_PIN` or `FUND_ENABLED=false`.
