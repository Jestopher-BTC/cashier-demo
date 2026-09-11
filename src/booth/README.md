# Booth demo package

Conference / sales wrapper around the core cashier.

- Mock UI, Code View, Live UI
- Calendly discovery CTA (`SHOW_DISCOVERY_CTA` in `booth-sales.js`)
- Staff **Fund** / **New visitor** on Live (PIN + `FUND_ENABLED` gates)
- Device check page, offline HTML, booth copy

This is the **default** `npm run build` output in `public/`, and the
`boltda.sh/cashier` deploy path. Do not change that until you set
`CASHIER_PACKAGE=core` on purpose.

```bash
npm run build
npm run dev         # MOCK_AMBOSS=1
npm start           # live Amboss, needs .env
```

Set `SHOW_DISCOVERY_CTA` to `false` to hide the Calendly QR and sales line
without switching packages.
