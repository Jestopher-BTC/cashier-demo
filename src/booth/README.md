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
