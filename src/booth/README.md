# Booth demo package

Conference / sales wrapper around the core cashier.

- Mock UI, Code View, Live UI
- Calendly discovery CTA (`SHOW_DISCOVERY_CTA` in `booth-sales.js`)
- Staff **Fund** / **New visitor** on Live (PIN + `FUND_ENABLED` gates)
- Device check page, offline HTML, booth copy

This is the **default** `npm run build` output in `public/`, served at `/`
(and `boltda.sh/cashier`). Core is served from the same process at `/core/`
when `public-core/` exists. Do not set `CASHIER_PACKAGE=core` on boltda.sh.

```bash
npm run build
npm run dev         # MOCK_AMBOSS=1, booth at /, core at /core/
npm start           # live Amboss, needs .env
npm run start:booth # booth only (CASHIER_PACKAGE=booth)
```

Set `SHOW_DISCOVERY_CTA` to `false` to hide the Calendly QR and sales line
without switching packages.
