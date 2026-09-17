# Core Live cashier

This folder is the **production** package: Live-only Amboss Payments cashier.
No Mock UI, Code View, Calendly QR, sales CTA, or Fund giveaway chrome.

```bash
npm run build
npm run dev         # mock API: booth at /, core at http://localhost:8080/core/
npm run dev:core    # mock API, core only at http://localhost:8080/
# or, with a real .env:
npm start           # dual URLs
CASHIER_PACKAGE=core npm start   # core only at /
```

Copy `src/AmbossCashierMock.jsx` plus `src/live-api.js` / `server/` if you are
embedding the widget in another host. You should not need anything under
`src/booth/`.
