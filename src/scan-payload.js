/* Unwrap what a Lightning wallet puts in a QR: lightning: prefixes,
   bitcoin: URIs with a lightning= query, whitespace in invoices, and
   zero-width characters from copy/paste. Shared by the cashier parser
   and the camera decoder so typed, pasted, and scanned values agree. */

export function normalizeScannedText(raw) {
  let s = String(raw == null ? "" : raw).trim();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
  const lightningQ = /(?:^|[?&])lightning=([^&]+)/i.exec(s);
  if (lightningQ) {
    try {
      s = decodeURIComponent(lightningQ[1].replace(/\+/g, "%20"));
    } catch (e) {
      s = lightningQ[1];
    }
  }
  s = s.replace(/^lightning:/i, "");
  s = s.replace(/\s+/g, "");
  return s;
}
