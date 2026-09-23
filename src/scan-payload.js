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

/* A bare Lightning username — no @, not a cashtag, not an invoice, LNURL,
   URL, or on-chain address — is a Wallet of Satoshi address. Anything that
   already has a domain, a $, or another payment form is left unchanged. */
const BARE_USERNAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function defaultWalletOfSatoshi(input) {
  const value = String(input == null ? "" : input);
  if (!value || value.indexOf("@") !== -1) return value;
  if (value.charAt(0) === "$") return value;
  if (/^(?:lnbc|lnurl|bc1|[13])/i.test(value)) return value;
  if (/[:/?#\s]/.test(value)) return value;
  if (!BARE_USERNAME.test(value)) return value;
  return value.toLowerCase() + "@walletofsatoshi.com";
}
