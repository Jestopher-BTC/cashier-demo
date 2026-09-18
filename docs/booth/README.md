# Booth (optional)

Demo chrome for a live kiosk. Not the integrator path.

| Piece | Where |
|---|---|
| Package source | [`src/booth/`](../../src/booth/README.md) |
| Kiosk runbook | [RUNBOOK.md](RUNBOOK.md) |
| Core cashier | [`src/core/`](../../src/core/README.md) |

`CASHIER_PACKAGE` default is `booth` so an existing kiosk deploy keeps Mock /
Code / Live. Integrators should run `npm run start:core` instead.
