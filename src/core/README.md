# Core Live cashier

This folder is the **production** package: Live-only Amboss Payments cashier
for an iGaming / house-ledger style balance. No Mock UI, Code View, Calendly
QR, sales CTA, or Fund giveaway chrome.

```bash
npm run build
npm run dev:core       # MOCK_AMBOSS=1, http://localhost:8080
npm run start:core     # real Amboss, needs .env (CASHIER_PACKAGE=core)
```

Copy `src/AmbossCashierMock.jsx` plus `src/live-api.js` / `server/` if you are
embedding the widget in another host. You should not need anything under
`src/booth/`.
