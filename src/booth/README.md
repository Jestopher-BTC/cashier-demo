# Booth demo package (optional)

Conference / sales wrapper around the core cashier. **Not the integrator
path.** Production is `CASHIER_PACKAGE=core`.

- Mock UI, Code View, Live UI
- Calendly discovery CTA (`SHOW_DISCOVERY_CTA` in `booth-sales.js`)
- Staff **Fund** / **New visitor** on Live (PIN + `FUND_ENABLED` gates)
- Device check page, offline HTML

This is the **default** `npm run build` output in `public/`, so a kiosk that
already deploys this repo keeps Mock / Code / Fund. Do not set
`CASHIER_PACKAGE=core` on that box.

```bash
npm run build
npm run dev         # MOCK_AMBOSS=1
npm start           # live Amboss, needs .env
```

Set `SHOW_DISCOVERY_CTA` to `false` to hide the Calendly QR and sales line
without switching packages. Kiosk runbook: [docs/booth/RUNBOOK.md](../../docs/booth/RUNBOOK.md).
