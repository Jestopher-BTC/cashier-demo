/* ============================================================================
   BOOTH SALES / DISCOVERY CTA

   Conference conversion chrome. Not part of the core Live cashier.
   Flip SHOW_DISCOVERY_CTA to false to hide:
     - the Calendly payments-discovery QR
     - the "Bring this payment UX to your platform!" line

   Product tagline ("Pay in Bitcoin, deal in dollars.") is Mock-only in the
   booth shell. Core builds never import this file.
   ============================================================================ */

import React, { useEffect, useState } from "react";
import { QrCode } from "../AmbossCashierMock.jsx";

/* Integrators: set this to false to ship the booth app without sales chrome. */
export const SHOW_DISCOVERY_CTA = true;

export const BOOTH_SALES = {
  SHOW_DISCOVERY_CTA,
  url: "https://calendly.com/d/cwfn-s48-3b3/payments-discovery",
  cta: "Bring this payment UX to your platform!",
  hint: "Scan to book a payments discovery meeting.",
};

/* iPad landscape (~1024×768) and other short wide screens. Portrait and
   narrow landscape stay a single column. Match this in the booth shell;
   do not also mount a second Calendly QR on the page. */
export const MEET_RAIL_QUERY =
  "(orientation: landscape) and (min-width: 1000px), (min-width: 1000px) and (max-height: 900px)";

function meetRailMatches() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia(MEET_RAIL_QUERY).matches;
  } catch (e) {
    return false;
  }
}

/* Safari 10: MediaQueryList.addListener, plus resize / orientationchange.
   matchMedia is missing in some embedded webviews; those keep portrait. */
export function useLandscapeMeetRail() {
  const [on, setOn] = useState(meetRailMatches);
  useEffect(function () {
    function sync() {
      setOn(meetRailMatches());
    }
    sync();
    var mql = null;
    try {
      mql = window.matchMedia ? window.matchMedia(MEET_RAIL_QUERY) : null;
    } catch (e) {
      mql = null;
    }
    if (mql && mql.addListener) mql.addListener(sync);
    else if (mql && mql.addEventListener) mql.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return function () {
      if (mql && mql.removeListener) mql.removeListener(sync);
      else if (mql && mql.removeEventListener) mql.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
  return SHOW_DISCOVERY_CTA && on;
}

export function DiscoveryInvite({ theme, size = 168, showCta, placement }) {
  if (!SHOW_DISCOVERY_CTA) return null;
  const rail = placement === "rail";
  const stage = placement === "stage" || rail;
  const qrSize = size || (stage ? 152 : 168);
  return (
    <div
      className={rail ? "discovery-box discovery-rail-card" : stage ? "discovery-box" : "discovery-flow"}
      data-discovery-qr
      data-discovery-placement={rail ? "rail" : stage ? "stage" : "flow"}
      data-discovery-url={BOOTH_SALES.url}
      style={
        stage
          ? undefined
          : {
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
