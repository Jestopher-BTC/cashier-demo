# Booth (optional)

Kiosk demo chrome. Not the integrator path.

| Piece | Where |
|---|---|
| Package source | [`src/booth/`](../../src/booth/README.md) |
| Kiosk steps | [RUNBOOK.md](RUNBOOK.md) |
| Core cashier | [`src/core/`](../../src/core/README.md) |

`CASHIER_PACKAGE` defaults to `booth` when unset, so an existing kiosk deploy
keeps Mock / Code / Live. A new cashier uses `npm run start:core`.
