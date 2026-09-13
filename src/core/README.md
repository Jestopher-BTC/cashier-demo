# Core Live cashier

This folder is the **production** package: Live-only Amboss Payments cashier.
No Mock UI, Code View, Calendly QR, sales CTA, or Fund giveaway chrome.

```bash
npm run build
npm run dev:core    # mock API, http://localhost:8080
# or, with a real .env:
CASHIER_PACKAGE=core npm start
```

Copy `src/AmbossCashierMock.jsx` plus `src/live-api.js` / `server/` if you are
embedding the widget in another host. You should not need anything under
`src/booth/`.
