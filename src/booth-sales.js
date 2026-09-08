/* ============================================================================
   BOOTH SALES / DISCOVERY CTA

   One place to strip conference conversion chrome for a real company handoff.
   Flip SHOW_DISCOVERY_CTA to false to hide:
     - the Calendly payments-discovery QR
     - the "Bring this payment UX to your platform!" line

   Product tagline ("Pay in Bitcoin, deal in dollars.") lives on BOOTH in
   AmbossCashierMock.jsx and is not gated here.

   Mock shows the sales CTA on the wallet, in its own box outside the cashier
   card. Live stays cleaner: no wallet QR. Cash-out success shows the same
   CTA + discovery QR outside the success card when this flag is on.
   ============================================================================ */

/* Integrators: set this to false to ship the cashier without sales chrome. */
export const SHOW_DISCOVERY_CTA = true;

export const BOOTH_SALES = {
  SHOW_DISCOVERY_CTA,
  /* Stacy's confirmed Calendly. */
  url: "https://calendly.com/d/cwfn-s48-3b3/payments-discovery",
  cta: "Bring this payment UX to your platform!",
  hint: "Scan to book a payments discovery meeting.",
};
