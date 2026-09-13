/* ============================================================================
   BOOTH SALES / DISCOVERY CTA

   Conference conversion chrome. Not part of the core Live cashier.
   Flip SHOW_DISCOVERY_CTA to false to hide:
     - the Calendly payments-discovery QR
     - the "Bring this payment UX to your platform!" line

   Product tagline ("Pay in Bitcoin, deal in dollars.") is Mock-only in the
   booth shell. Core builds never import this file.
   ============================================================================ */

import React from "react";
import { QrCode } from "../AmbossCashierMock.jsx";

/* Integrators: set this to false to ship the booth app without sales chrome. */
export const SHOW_DISCOVERY_CTA = true;

export const BOOTH_SALES = {
  SHOW_DISCOVERY_CTA,
  url: "https://calendly.com/d/cwfn-s48-3b3/payments-discovery",
  cta: "Bring this payment UX to your platform!",
  hint: "Scan to book a payments discovery meeting.",
};

export function DiscoveryInvite({ theme, size = 168, showCta, placement }) {
  if (!SHOW_DISCOVERY_CTA) return null;
  const stage = placement === "stage";
  const qrSize = size || (stage ? 152 : 168);
  return (
    <div
      className={stage ? "discovery-box" : undefined}
      data-discovery-qr
      data-discovery-placement={stage ? "stage" : "flow"}
      data-discovery-url={BOOTH_SALES.url}
      style={
        stage
          ? undefined
          : {
              marginTop: 16,
              padding: "18px 16px 16px",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 16,
              textAlign: "center",
            }
      }
    >
      {showCta ? (
        <p className="discovery-cta" data-discovery-cta>
          {BOOTH_SALES.cta}
        </p>
      ) : null}
      <div
        className="discovery-plate"
        style={{
          background: "#FFFFFF",
          padding: stage ? 8 : 10,
          borderRadius: 14,
          lineHeight: 0,
          display: "inline-block",
        }}
      >
        <QrCode value={BOOTH_SALES.url} size={qrSize} label="Payments discovery booking QR code" />
      </div>
      <p
        className="discovery-hint"
        style={stage ? undefined : { color: theme.muted, fontSize: 13.5, marginTop: 12, lineHeight: 1.45 }}
      >
        {BOOTH_SALES.hint}
      </p>
    </div>
  );
}

export function cashOutDiscovery(theme) {
  return <DiscoveryInvite theme={theme} size={168} placement="flow" showCta />;
}
