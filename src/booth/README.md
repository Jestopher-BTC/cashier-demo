# Booth (optional)

Conference demo chrome around the core cashier. Integrators use **core**
(`CASHIER_PACKAGE=core`). This package is what you get when
`CASHIER_PACKAGE` is unset, so an existing kiosk keeps its current UI.

Only this package adds:

- Mock / Code / Live tabs
- Calendly discovery CTA (`SHOW_DISCOVERY_CTA` in `booth-sales.js`)
- Staff **Fund** and **New visitor**
- Cha-ching on a successful payment
- Offline HTML

```bash
npm run dev         # MOCK_AMBOSS=1
npm start           # live Amboss; load .env first, or use systemd
```

Set `SHOW_DISCOVERY_CTA` to `false` to hide the Calendly QR and sales line
without switching packages. Kiosk steps:
[docs/booth/RUNBOOK.md](../../docs/booth/RUNBOOK.md).

## Staff Fund

Optional booth staff chrome. The core package does not show it. Leave it
unused on a core cashier.

`/api/session/fund` credits `SESSION_START_USD` (default $2) only when
**both** are true: `FUND_ENABLED` is on, and `OPERATOR_PIN` is a non-empty
PIN. A blank PIN leaves Fund off. It does not skip the prompt. `false` / `0`
/ `no` / `off` kills Fund even when a PIN is set. Every tap asks for the PIN
again. `DAILY_FLOAT_USD` (default $25) is the UTC-day ceiling, kept in
process memory. Use 6+ digits on a public kiosk. Restart after changing
either value.
