import React from "react";

/* Official Amboss marks. Source files: src/assets/logo_gradient.svg and
   src/assets/letter_gradient.svg (https://docs.amboss.tech/assets/…).
   Inlined so the offline booth file does not depend on a sibling asset,
   and so two instances on one page do not share a gradient id. */
const WORDMARK_D =
  "M218.2,84.9V0h95.7v33.4l-21.5-0.3l21.5,18.4v33.4L218.2,84.9L218.2,84.9z M273.5,22.5h-15v10.9h15V22.5z M273.5,51.3h-15v10h15V51.3z M326.6,84.9V0h95.6v84.9H326.6z M529.3,33.4H476V22.5h53.4h2L531.2,0h-95.6v50.4H491v0.9v10v0h-55.3 v23.6h95.6l0-23.6h0l0.1-27.9H529.3z M638.4,33.4h-53.3V22.5h53.3h2L640.3,0h-95.6v50.4h55.3v0.9v10v0h-55.3v23.6h95.6l0-23.6h0 l0.1-27.9H638.4z M180,0l-15.6,17.7l-7.5,8.5l-7.5-8.5L133.8,0h-24.7v84.9h40.3V45l7.5,8.5l7.5-8.5v39.9h40.3V0L180,0z M55.3,84.9 V61.3h-15v23.6H0V0h95.7v84.9H55.3z M55.3,28.1h-15v17.1h15V28.1z";

const LETTER_D = "M55.3,84.9V61.3h-15v23.6H0V0h95.7v84.9H55.3z M55.3,28.1h-15v17.1h15V28.1z";

function Mark({ className, gid, viewBox, x2, y, d }) {
  return (
    <svg className={className} viewBox={viewBox} role="img" aria-label="Amboss" focusable="false">
      <title>Amboss</title>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1={y} x2={x2} y2={y}>
          <stop offset="0" stopColor="#FF0080" />
          <stop offset="1" stopColor="#B43AFF" />
        </linearGradient>
      </defs>
      <path fill={"url(#" + gid + ")"} d={d} />
    </svg>
  );
}

export function AmbossLogo({ gid, className }) {
  return <Mark className={className} gid={gid} viewBox="0 0 640.4 84.9" x2="640.39" y="42.469" d={WORDMARK_D} />;
}

export function AmbossLetter({ gid, className }) {
  return <Mark className={className} gid={gid} viewBox="0 0 95.7 84.9" x2="95.7" y="42.45" d={LETTER_D} />;
}
