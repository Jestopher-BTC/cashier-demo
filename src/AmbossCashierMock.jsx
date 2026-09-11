import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CAMERA_COPY,
  attachStream,
  decodeVideoFrame,
  normalizeScannedText,
  openCameraStream,
  resolveCameraError,
  startCamera,
  stopStream,
} from "./qr-scan.js";

/* ============================================================================
   Amboss Payments SDK - iGaming cashier, v2

   The player sees dollars and nothing else. They deposit dollars, hold
   dollars, and cash out to a Cash App cashtag. Bitcoin is the rail underneath
   and the exchange rate is a parameter of the mock, not something the player
   is ever shown. Operator-controlled receive credits the house ledger;
   Amboss is rails/API.

   The one place sats surface is the deposit invoice, because a Lightning
   wallet will display sats and the two numbers have to reconcile. Cash App is
   one Lightning wallet among many; cashtags are Lightning addresses.

   Conference sales chrome (Calendly QR, Mock/Code View, Fund giveaway) lives
   in src/booth/. This file is the core cashier an integrator copies.

   Exports
     PaymentsProvider   shared state; takes usdPerBtc as a prop
     usePayments        context hook
     WalletView         balance + history
     DepositFlow        amount -> payment request -> credited
     WithdrawFlow       destination -> amount -> review -> sent
     ThemeToggle        dark / light switch
     AmbossPaymentsMock default export, demo harness
   ========================================================================== */

/* ---------------------------------------------------------------- theme --- */

const THEMES = {
  dark: {
    name: "dark",
    bg: "#0A1020",
    surface: "#121B2E",
    surfaceAlt: "#18233A",
    inset: "#0D1526",
    border: "#24314D",
    borderStrong: "#33456B",
    text: "#EAF0FA",
    muted: "#8494B0",
    faint: "#5D6E8C",
    accent: "#14C58F",
    accentSoft: "rgba(20,197,143,0.14)",
    accentText: "#04231A",
    btc: "#F7931A",
    btcSoft: "rgba(247,147,26,0.14)",
    warn: "#FFB020",
    warnSoft: "rgba(255,176,32,0.14)",
    danger: "#FF6A5E",
    dangerSoft: "rgba(255,106,94,0.14)",
    shadow: "0 8px 20px rgba(0,0,0,0.35)",
  },
  light: {
    name: "light",
    bg: "#EEF2F8",
    surface: "#FFFFFF",
    surfaceAlt: "#F6F8FC",
    inset: "#F1F4FA",
    border: "#DCE3EF",
    borderStrong: "#C3CEE1",
    text: "#0C1626",
    muted: "#5C6D8A",
    faint: "#8493AB",
    accent: "#0C9F73",
    accentSoft: "rgba(12,159,115,0.12)",
    accentText: "#FFFFFF",
    btc: "#D97A06",
    btcSoft: "rgba(217,122,6,0.12)",
    warn: "#B5730A",
    warnSoft: "rgba(181,115,10,0.12)",
    danger: "#D92D20",
    dangerSoft: "rgba(217,45,32,0.10)",
    shadow: "0 6px 16px rgba(15,32,63,0.08)",
  },
};

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Courier New", monospace';
const NUM = { fontVariantNumeric: "tabular-nums" };

/* Demo copy used by the mock wallet. Conference tagline and Calendly live in
   src/booth/booth-sales.js, not here. */
export const BOOTH = {
  sampleCashtag: "$jestoph",
  tagline: "Pay in Bitcoin, deal in dollars.",
};


/* ------------------------------------------------------------ qr encoder --- */
/* Alphanumeric + byte mode, EC level M/L, versions 1-20. Verified against a
   reference encoder and round-trip decoded. BOLT11 invoices are uppercased by
   the caller so they encode in alphanumeric mode, as wallets expect. */

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const QR_BLOCKS = {
  L: [[7,1,19,0,20],[10,1,34,0,35],[15,1,55,0,56],[20,1,80,0,81],[26,1,108,0,109],[18,2,68,0,69],[20,2,78,0,79],[24,2,97,0,98],[30,2,116,0,117],[18,2,68,2,69],[20,4,81,0,82],[24,2,92,2,93],[26,4,107,0,108],[30,3,115,1,116],[22,5,87,1,88],[24,5,98,1,99],[28,1,107,5,108],[30,5,120,1,121],[28,3,113,4,114],[28,3,107,5,108]],
  M: [[10,1,16,0,17],[16,1,28,0,29],[26,1,44,0,45],[18,2,32,0,33],[24,2,43,0,44],[16,4,27,0,28],[18,4,31,0,32],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44],[30,1,50,4,51],[22,6,36,2,37],[22,8,37,1,38],[24,4,40,5,41],[24,5,41,5,42],[28,7,45,3,46],[28,10,46,1,47],[26,9,43,4,44],[26,3,44,11,45],[26,3,41,13,42]],
};

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gmul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

function genPoly(deg) {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], 1);
      next[j + 1] ^= gmul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = genPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
  }
  return res;
}

function alignPositions(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const size = 17 + 4 * v;
  const last = size - 7;
  if (n === 2) return [6, last];
  const step = Math.ceil((last - 6) / (n - 1) / 2) * 2;
  const pos = [6];
  for (let i = n - 1; i >= 1; i--) pos.push(last - (n - 1 - i) * step);
  return [pos[0]].concat(pos.slice(1).sort((a, b) => a - b));
}

const isAlnum = (s) => {
  for (const c of s) if (ALNUM.indexOf(c) === -1) return false;
  return true;
};

const ccBits = (mode, v) =>
  mode === "alnum" ? (v <= 9 ? 9 : v <= 26 ? 11 : 13) : v <= 9 ? 8 : 16;

const dataCapacity = (v, level) => {
  const b = QR_BLOCKS[level][v - 1];
  return b[1] * b[2] + b[3] * b[4];
};

function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) out.push(c);
    else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
    else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  return out;
}

function encodeSegment(str, mode, v) {
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(mode === "alnum" ? 0b0010 : 0b0100, 4);
  const bytes = mode === "byte" ? utf8Bytes(str) : null;
  push(mode === "alnum" ? str.length : bytes.length, ccBits(mode, v));
  if (mode === "alnum") {
    for (let i = 0; i < str.length; i += 2) {
      if (i + 1 < str.length)
        push(ALNUM.indexOf(str[i]) * 45 + ALNUM.indexOf(str[i + 1]), 11);
      else push(ALNUM.indexOf(str[i]), 6);
    }
  } else {
    for (const b of bytes) push(b, 8);
  }
  return bits;
}

function buildCodewords(str, mode, v, level) {
  const capacity = dataCapacity(v, level) * 8;
  const bits = encodeSegment(str, mode, v);
  if (bits.length > capacity) return null;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  const pads = [0xec, 0x11];
  let k = 0;
  while (cw.length < dataCapacity(v, level)) cw.push(pads[k++ % 2]);
  return cw;
}

function interleave(cw, v, level) {
  const [ecLen, g1, d1, g2, d2] = QR_BLOCKS[level][v - 1];
  const blocks = [];
  let off = 0;
  for (let i = 0; i < g1; i++) {
    blocks.push(cw.slice(off, off + d1));
    off += d1;
  }
  for (let i = 0; i < g2; i++) {
    blocks.push(cw.slice(off, off + d2));
    off += d2;
  }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));
  const out = [];
  const maxData = Math.max(d1, d2 || 0);
  for (let i = 0; i < maxData; i++)
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
  return out;
}

function bch(data, poly, bitLen) {
  let d = data << (bitLen - 1);
  const polyLen = 32 - Math.clz32(poly);
  while (32 - Math.clz32(d) >= polyLen)
    d ^= poly << (32 - Math.clz32(d) - polyLen);
  return (data << (bitLen - 1)) | d;
}

const EC_BITS = { L: 0b01, M: 0b00 };

function maskFn(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function buildMatrix(v, level, stream, mask) {
  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c, val) => {
    m[r][c] = val;
    reserved[r][c] = true;
  };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const ring =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, ring || core ? 1 : 0);
      }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }

  for (const r of alignPositions(v))
    for (const c of alignPositions(v)) {
      if (
        (r <= 8 && c <= 8) ||
        (r <= 8 && c >= size - 9) ||
        (r >= size - 9 && c <= 8)
      )
        continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++)
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1);
    }

  set(size - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) set(8, i, 0);
    if (m[i][8] === null) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) set(8, size - 1 - i, 0);
    if (m[size - 1 - i][8] === null) set(size - 1 - i, 8, 0);
  }

  if (v >= 7) {
    const vi = bch(v, 0x1f25, 13);
    for (let i = 0; i < 18; i++) {
      const bit = (vi >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  let idx = 0;
  let bitIdx = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        let bit = 0;
        if (idx < stream.length) bit = (stream[idx] >> (7 - bitIdx)) & 1;
        bitIdx++;
        if (bitIdx === 8) {
          bitIdx = 0;
          idx++;
        }
        m[row][c] = bit ^ (maskFn(mask, row, c) ? 1 : 0);
      }
    }
    up = !up;
  }

  const fmt = bch((EC_BITS[level] << 3) | mask, 0x537, 11) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> (14 - i)) & 1;
    if (i < 6) m[8][i] = bit;
    else if (i < 8) m[8][i + 1] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;

    if (i < 7) m[size - 1 - i][8] = bit;
    else m[8][size - 15 + i] = bit;
  }
  m[size - 8][8] = 1;
  return m;
}

function penalty(m) {
  const n = m.length;
  let score = 0;
  for (let i = 0; i < n; i++)
    for (const dir of [0, 1]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = dir ? m[j][i] : m[i][j];
        const b = dir ? m[j - 1][i] : m[i][j - 1];
        if (a === b) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  for (let r = 0; r < n - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1])
        score += 3;
    }
  const pats = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= n - 11; j++)
      for (const p of pats) {
        let okRow = true;
        let okCol = true;
        for (let k = 0; k < 11; k++) {
          if (m[i][j + k] !== p[k]) okRow = false;
          if (m[j + k][i] !== p[k]) okCol = false;
        }
        if (okRow) score += 40;
        if (okCol) score += 40;
      }
  let dark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

function qrMatrix(text) {
  const mode = isAlnum(text) ? "alnum" : "byte";
  for (const level of ["M", "L"])
    for (let v = 1; v <= 20; v++) {
      const cw = buildCodewords(text, mode, v, level);
      if (!cw) continue;
      const stream = interleave(cw, v, level);
      let best = null;
      let bestScore = Infinity;
      for (let mask = 0; mask < 8; mask++) {
        const cand = buildMatrix(v, level, stream, mask);
        const s = penalty(cand);
        if (s < bestScore) {
          bestScore = s;
          best = cand;
        }
      }
      return best;
    }
  return null;
}

export { qrMatrix };

export function QrCode({ value, size = 224, quiet = 3, label = "Lightning invoice QR code" }) {
  const path = useMemo(() => {
    const m = qrMatrix(value);
    if (!m) return null;
    const n = m.length;
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!m[r][c]) {
          c++;
          continue;
        }
        let run = 1;
        while (c + run < n && m[r][c + run]) run++;
        d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
        c += run;
      }
    }
    return { d, dim: n + quiet * 2 };
  }, [value, quiet]);

  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${path.dim} ${path.dim}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      style={{ display: "block" }}
    >
      <rect width={path.dim} height={path.dim} fill="#FFFFFF" />
      <path d={path.d} fill="#000000" />
    </svg>
  );
}


/* ---------------------------------------------------------------- money --- */

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const rand = (n) => Math.floor(Math.random() * n);
const id = () => Math.random().toString(36).slice(2, 10);

/* Old WebKit builds ship a partial Intl, so every formatted number falls back
   to a hand-rolled grouping rather than throwing. */
function group(value, decimals) {
  try {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch (e) {
    var fixed = value.toFixed(decimals);
    var parts = fixed.split(".");
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (parts[1] ? "." + parts[1] : "");
  }
}

const usd = (n, opts = {}) => (n < 0 ? "-" : "") + "$" + group(Math.abs(n), opts.whole ? 0 : 2);

const sats = (n) => group(Math.round(n), 0);
const usdToSats = (amount, rate) => Math.round((amount / rate) * 1e8);
const satsToUsd = (s, rate) => Math.round((s / 1e8) * rate * 100) / 100;

function relTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function makeInvoice(satAmount) {
  const hrp = satAmount > 0 ? `lnbc${satAmount * 10}n` : "lnbc";
  let body = "1p";
  for (let i = 0; i < 244; i++) body += BECH32[rand(BECH32.length)];
  return hrp + body;
}

const reference = () => {
  let s = "";
  for (let i = 0; i < 12; i++) s += "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[rand(31)];
  return s;
};

/* Destinations. A cashtag is a Lightning address wearing a costume: strip the
   dollar sign, append the Cash App domain. The player never sees that. */
export function parseDestination(raw, rate) {
  const input = normalizeScannedText(raw).replace(/^[\uFF04\uFE69]/, "$");
  if (!input) return { kind: "empty" };

  const cashApp = /^(?:https?:\/\/)?(?:www\.)?cash\.app\/\$?([a-z0-9_]{1,20})\/?$/i.exec(input);
  if (cashApp) {
    const tag = cashApp[1];
    return {
      kind: "cashtag",
      display: `$${tag}`,
      label: "Cash App",
      address: `${tag.toLowerCase()}@cash.app`,
      amountKnown: false,
    };
  }

  const lnurlp = /^(?:https?:\/\/)?(?:www\.)?([^/\s]+)\/\.well-known\/lnurlp\/([a-z0-9._-]+)/i.exec(input);
  if (lnurlp) {
    const host = lnurlp[1].toLowerCase();
    const user = lnurlp[2].toLowerCase();
    if (host === "cash.app") {
      return {
        kind: "cashtag",
        display: `$${user}`,
        label: "Cash App",
        address: `${user}@cash.app`,
        amountKnown: false,
      };
    }
    return {
      kind: "address",
      display: `${user}@${host}`,
      label: "Lightning address",
      address: `${user}@${host}`,
      amountKnown: false,
    };
  }

  if (/^\$[a-z0-9_]{1,20}$/i.test(input)) {
    const tag = input.slice(1);
    return {
      kind: "cashtag",
      display: `$${tag}`,
      label: "Cash App",
      address: `${tag.toLowerCase()}@cash.app`,
      amountKnown: false,
    };
  }

  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(input)) {
    const address = input.toLowerCase();
    if (address.endsWith("@cash.app")) {
      const tag = address.slice(0, -"@cash.app".length);
      return {
        kind: "cashtag",
        display: `$${tag}`,
        label: "Cash App",
        address,
        amountKnown: false,
      };
    }
    return {
      kind: "address",
      display: address,
      label: "Lightning address",
      address,
      amountKnown: false,
    };
  }

  if (/^lnbc/i.test(input)) {
    if (input.length < 60)
      return { kind: "invalid", reason: "That invoice looks incomplete. Paste the whole thing." };
    const m = /^lnbc(\d+)?([munp])?1/i.exec(input);
    if (!m) return { kind: "invalid", reason: "That is not a Lightning invoice we can read." };
    const mult = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[(m[2] || "").toLowerCase()] ?? 1;
    const satAmount = m[1] ? Math.round(Number(m[1]) * mult * 1e8) : 0;
    return {
      kind: "request",
      display: `${input.slice(0, 12).toLowerCase()}…${input.slice(-8).toLowerCase()}`,
      label: satAmount ? "Lightning invoice" : "Lightning invoice, no amount",
      address: input.toLowerCase(),
      amountKnown: satAmount > 0,
      amountUsd: satAmount > 0 ? satsToUsd(satAmount, rate) : 0,
      satAmount,
    };
  }

  if (/^(bc1|[13])/.test(input))
    return { kind: "invalid", reason: "That address only works for slower on-chain transfers." };

  return { kind: "invalid", reason: "Enter a cashtag, a Lightning address, or a Lightning invoice." };
}

/* ------------------------------------------------------------ sdk seams --- */
/* Three calls stand between this mock and a live integration. Replace the
   bodies with your Amboss Payments SDK calls and leave the components alone.
   Pass your own object as <PaymentsProvider api={yourApi}>. */

const mockApi = {
  /* 1. Ask for an invoice for a dollar amount. The player pays it; you decide
        the amount of sats and how long the invoice stays valid. */
  async createInvoice({ amountUsd, usdPerBtc }) {
    const satAmount = usdToSats(amountUsd, usdPerBtc);
    return {
      amountUsd,
      satAmount,
      invoice: makeInvoice(satAmount),
      expiresAt: Date.now() + LIMITS.invoiceSeconds * 1000,
    };
  },

  /* 2. Tell the UI when that invoice is paid. Poll, subscribe, or forward a
        webhook through your own transport. Return a function that stops
        listening; the deposit screen calls it on unmount. */
  watchInvoice(request, onPaid) {
    return () => {};
  },

  /* 3. Send a withdrawal. Resolve to complete, pending, or failed. The
        destination is already normalized: a cashtag arrives here as a
        Lightning address, an invoice arrives as the raw bolt11 string. */
  async sendPayment({ amountUsd, destination }) {
    await new Promise((resolve) => setTimeout(resolve, 1700));
    return { status: "complete" };
  },
};

/* Some wallets can pay an invoice but cannot resolve a Lightning address.
   Amboss Taproot Asset wallets are in that category today, so the cashtag and
   address paths turn off rather than failing at send time. */
function payoutCheck(parsed, capabilities) {
  if (!capabilities || capabilities.addressPayouts !== false) return parsed;
  if (parsed.kind === "cashtag" || parsed.kind === "address")
    return {
      kind: "invalid",
      reason: "This wallet pays invoices only. Ask for an invoice with an amount on it.",
    };
  return parsed;
}

/* --------------------------------------------------------------- state --- */

const PaymentsContext = createContext(null);

export function usePayments() {
  const ctx = useContext(PaymentsContext);
  if (!ctx) throw new Error("usePayments must be used inside <PaymentsProvider>");
  return ctx;
}

const LIMITS = { depositMin: 1, depositMax: 2500, withdrawMin: 5, invoiceSeconds: 90 };

function seedTransactions() {
  const now = Date.now();
  return [
    { id: id(), ref: reference(), type: "withdrawal", amountUsd: 200, destination: BOOTH.sampleCashtag, status: "complete", ts: now - 1000 * 60 * 52 },
    { id: id(), ref: reference(), type: "deposit", amountUsd: 250, status: "complete", ts: now - 1000 * 60 * 60 * 7 },
    { id: id(), ref: reference(), type: "withdrawal", amountUsd: 75, destination: BOOTH.sampleCashtag, status: "failed", note: "Returned to your balance", ts: now - 1000 * 60 * 60 * 26 },
    { id: id(), ref: reference(), type: "deposit", amountUsd: 100, status: "complete", ts: now - 1000 * 60 * 60 * 30 },
    { id: id(), ref: reference(), type: "deposit", amountUsd: 500, status: "complete", ts: now - 1000 * 60 * 60 * 74 },
  ];
}

export function PaymentsProvider({
  children,
  initialBalanceUsd = 1247.85,
  usdPerBtc = 111842.5,
  api = mockApi,
  capabilities = { addressPayouts: true },
  limits: limitOverrides,
  defaultTheme = "dark",
  demo = true,
  cashOutSuccessExtra = null,
}) {
  const limits = useMemo(() => Object.assign({}, LIMITS, limitOverrides || {}), [limitOverrides]);
  const [themeName, setThemeName] = useState(defaultTheme);

  /* defaultTheme is an initial value to useState, so a host that changes it
     later would otherwise be ignored and the app would sit in the old palette
     while the page around it switched. Track the prop when it moves. */
  useEffect(() => {
    setThemeName(defaultTheme);
  }, [defaultTheme]);
  const [balance, setBalance] = useState(initialBalanceUsd);
  const [transactions, setTransactions] = useState(seedTransactions);

  /* Seam 4, optional. When the api can load state, the server owns the balance
     and the history and this component stops doing its own arithmetic. */
  const authoritative = typeof api.loadState === "function";

  const refresh = useCallback(() => {
    if (!authoritative) return undefined;
    return api.loadState().then(function (state) {
      if (!state) return;
      setBalance(typeof state.balanceUsd === "number" ? state.balanceUsd : 0);
      setTransactions(Array.isArray(state.transactions) ? state.transactions : []);
    });
  }, [api, authoritative]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const record = useCallback((tx) => {
    setTransactions((list) => [{ id: id(), ref: reference(), ts: Date.now(), ...tx }, ...list]);
  }, []);

  const creditDeposit = useCallback(
    (amountUsd) => {
      if (authoritative) return refresh();
      setBalance((b) => Math.round((b + amountUsd) * 100) / 100);
      record({ type: "deposit", amountUsd, status: "complete" });
      return undefined;
    },
    [record, authoritative, refresh]
  );

  const debitWithdrawal = useCallback(
    (amountUsd, destination, status) => {
      if (authoritative) return refresh();
      if (status !== "failed") setBalance((b) => Math.round((b - amountUsd) * 100) / 100);
      record({
        type: "withdrawal",
        amountUsd,
        destination,
        status,
        note: status === "failed" ? "Returned to your balance" : undefined,
      });
      return undefined;
    },
    [record, authoritative, refresh]
  );

  const reset = useCallback(() => {
    if (authoritative && api.resetSession) return api.resetSession().then(refresh);
    setBalance(initialBalanceUsd);
    setTransactions(seedTransactions());
    return undefined;
  }, [initialBalanceUsd, authoritative, api, refresh]);

  const value = useMemo(
    () => ({
      theme: THEMES[themeName],
      themeName,
      setTheme: setThemeName,
      toggleTheme: () => setThemeName((t) => (t === "dark" ? "light" : "dark")),
      balance,
      api,
      capabilities,
      rate: usdPerBtc,
      transactions,
      limits: limits,
      demo,
      cashOutSuccessExtra,
      creditDeposit,
      debitWithdrawal,
      reset,
    }),
    [themeName, balance, api, capabilities, limits, usdPerBtc, transactions, demo, cashOutSuccessExtra, creditDeposit, debitWithdrawal, reset]
  );

  return <PaymentsContext.Provider value={value}>{children}</PaymentsContext.Provider>;
}

/* ------------------------------------------------------------ primitives --- */

export function Styles() {
  return (
    <style>{`
      @keyframes amb-spin { to { -webkit-transform: rotate(360deg); transform: rotate(360deg) } }
      @keyframes amb-scan { 0% { top: 6% } 50% { top: 88% } 100% { top: 6% } }
      @keyframes amb-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
      @keyframes amb-flow { to { stroke-dashoffset: -24 } }
      @keyframes amb-rise { from { opacity: 0 } to { opacity: 1 } }
      .amb-rise { animation: amb-rise .22s ease-out }
      .amb-tap { transition: opacity .12s ease, background-color .15s ease }
      html:not(.flat-paint) .amb-tap { transition: transform .12s ease, opacity .12s ease, background-color .15s ease }
      html:not(.flat-paint) .amb-tap:active { -webkit-transform: scale(.985); transform: scale(.985) }
      @media (prefers-reduced-motion: reduce) {
        .amb-rise, .amb-tap { animation: none !important; transition: none !important }
        [data-anim] { animation: none !important }
      }
      html.flat-paint .amb-rise,
      html.flat-paint .amb-tap,
      html.flat-paint [data-anim] {
        animation: none !important;
        transition: none !important;
        -webkit-transform: none !important;
        transform: none !important;
        filter: none !important;
        -webkit-filter: none !important;
        text-shadow: none !important;
        box-shadow: none !important;
      }
      /* Scanner sheet: never composite with opacity/transform/filter. iPad
         WebKit double-paints those and ghosts "Scan a code" over the
         destination page (same class of bug as the muddy Mock UI). */
      .amb-scan-sheet,
      .amb-scan-sheet * {
        animation: none !important;
        transition: none !important;
        -webkit-transform: none !important;
        transform: none !important;
        filter: none !important;
        -webkit-filter: none !important;
        text-shadow: none !important;
        box-shadow: none !important;
        -webkit-text-stroke: 0 !important;
      }
    `}</style>
  );
}

function Button({ theme, variant = "primary", full, disabled, children, style, ...rest }) {
  const base = {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: disabled ? 500 : 600,
    borderRadius: 12,
    padding: "14px 18px",
    cursor: disabled ? "not-allowed" : "pointer",
    width: full ? "100%" : undefined,
    border: "1px solid transparent",
    /* Opacity-only disabled looks like a live button on the dark booth theme.
       Keep Fund readable but clearly muted against New visitor. */
    opacity: disabled && variant === "primary" ? 0.45 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 44,
    overflow: "hidden",
    pointerEvents: disabled ? "none" : undefined,
    WebkitBackgroundClip: "padding-box",
    backgroundClip: "padding-box",
  };
  const skins = {
    primary: { background: theme.accent, color: theme.accentText },
    secondary: {
      background: disabled ? theme.inset : theme.surfaceAlt,
      color: disabled ? theme.faint : theme.text,
      borderColor: disabled ? theme.border : theme.border,
    },
    ghost: { background: "transparent", color: theme.muted, padding: "12px 12px" },
    danger: { background: theme.dangerSoft, color: theme.danger, borderColor: "transparent" },
  };
  return (
    <button className="amb-tap" disabled={disabled} style={{ ...base, ...skins[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}

function Card({ theme, children, style, ...rest }) {
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Row({ theme, label, value, mono, strong, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "9px 0" }}>
      <span style={{ color: theme.muted, fontSize: 13 }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span
          style={{
            color: theme.text,
            fontSize: strong ? 15 : 13.5,
            fontWeight: strong ? 600 : 500,
            fontFamily: mono ? MONO : FONT,
            ...NUM,
          }}
        >
          {value}
        </span>
        {sub ? <div style={{ color: theme.faint, fontSize: 11.5, marginTop: 2, ...NUM }}>{sub}</div> : null}
      </span>
    </div>
  );
}

function Chip({ theme, tone = "muted", children }) {
  const tones = {
    muted: { bg: theme.inset, fg: theme.muted },
    accent: { bg: theme.accentSoft, fg: theme.accent },
    warn: { bg: theme.warnSoft, fg: theme.warn },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
    btc: { bg: theme.btcSoft, fg: theme.btc },
  }[tone];
  return (
    <span
      style={{
        background: tones.bg,
        color: tones.fg,
        borderRadius: "50%",
        padding: "3px 9px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Spinner({ color, size = 16 }) {
  return (
    <span
      data-anim
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "amb-spin .8s linear infinite",
      }}
    />
  );
}

function Notice({ theme, tone = "warn", title, body, action }) {
  const fg = tone === "danger" ? theme.danger : tone === "accent" ? theme.accent : theme.warn;
  const bg = tone === "danger" ? theme.dangerSoft : tone === "accent" ? theme.accentSoft : theme.warnSoft;
  return (
    <div style={{ background: bg, borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ color: fg, fontSize: 13.5, fontWeight: 600 }}>{title}</div>
      {body ? <div style={{ color: theme.muted, fontSize: 12.5, marginTop: 4, lineHeight: 1.45 }}>{body}</div> : null}
      {action}
    </div>
  );
}

function BackBar({ theme, title, onBack, right }) {
  /* Old iPad Safari ignores flex gap (Safari 14.1+). Use margins so the back
     button and heading do not sit flush on ~1024×768 booth devices. */
  return (
    <div data-back-bar style={{ display: "flex", WebkitAlignItems: "center", alignItems: "center", marginBottom: 24 }}>
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Go back"
          className="amb-tap"
          style={{
            background: theme.surfaceAlt,
            border: `1px solid ${theme.border}`,
            color: theme.text,
            width: 44,
            height: 44,
            borderRadius: 10,
            cursor: "pointer",
            display: "flex",
            WebkitAlignItems: "center",
            alignItems: "center",
            WebkitJustifyContent: "center",
            justifyContent: "center",
            marginRight: 16,
            flex: "0 0 auto",
            WebkitFlex: "0 0 auto",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : null}
      <div data-back-title style={{ fontSize: 17, fontWeight: 700, color: theme.text, letterSpacing: "-0.01em", lineHeight: 1.2, paddingLeft: 2 }}>
        {title}
      </div>
      <div style={{ marginLeft: "auto" }}>{right}</div>
    </div>
  );
}


/* --------------------------------------------------------- shared pieces --- */

function Countdown({ theme, expiresAt, seconds, onExpire, label = "Quote holds for" }) {
  const [left, setLeft] = useState(Math.max(0, expiresAt - Date.now()));
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    setLeft(Math.max(0, expiresAt - Date.now()));
    const t = setInterval(() => {
      const ms = Math.max(0, expiresAt - Date.now());
      setLeft(ms);
      if (ms === 0 && !fired.current) {
        fired.current = true;
        onExpire && onExpire();
      }
    }, 250);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);

  const pct = Math.max(0, Math.min(1, left / (seconds * 1000)));
  const s = Math.ceil(left / 1000);
  const tone = pct < 0.25 ? theme.warn : theme.accent;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: theme.muted, marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: tone, fontWeight: 700, ...NUM }}>
          {String(Math.floor(s / 60)).padStart(1, "0")}:{String(s % 60).padStart(2, "0")}
        </span>
      </div>
      <div style={{ height: 3, background: theme.border, borderRadius: "50%", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct * 100}%`, background: tone, transition: "width .25s linear" }} />
      </div>
    </div>
  );
}

function CopyButton({ theme, text, label = "Copy invoice" }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) {
        /* clipboard unavailable in this frame */
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else fallback();
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };
  return (
    <Button theme={theme} variant="secondary" full onClick={copy} aria-live="polite">
      {done ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2.5" />
          <path d="M5 15V5.5A2.5 2.5 0 0 1 7.5 3H15" />
        </svg>
      )}
      {done ? "Copied" : label}
    </Button>
  );
}

/* iPad still opens QWERTY for type=text unless inputmode and the old
   pattern="[0-9]*" hint are real content attributes at focus time. */
function bindDecimalPad(el) {
  if (!el) return;
  el.setAttribute("inputmode", "decimal");
  el.setAttribute("enterkeyhint", "done");
  el.setAttribute("pattern", "[0-9]*");
}

function AmountField({ theme, value, onChange, autoFocus, hint, error, max }) {
  return (
    <div>
      <div
        style={{
          background: theme.inset,
          border: `1px solid ${error ? theme.danger : theme.border}`,
          borderRadius: 14,
          padding: "18px 16px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 30, fontWeight: 700, color: value ? theme.text : theme.faint, ...NUM }}>$</span>
        <input
          ref={bindDecimalPad}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
            const parts = v.split(".");
            onChange(parts[1] !== undefined ? `${parts[0]}.${parts[1].slice(0, 2)}` : v);
          }}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          pattern="[0-9]*"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="0.00"
          aria-label="Amount in US dollars"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: theme.text,
            fontSize: 30,
            fontWeight: 700,
            fontFamily: FONT,
            padding: 0,
            ...NUM,
          }}
        />
        {max ? (
          <button
            onClick={max.onClick}
            className="amb-tap"
            style={{
              background: theme.accentSoft,
              color: theme.accent,
              border: "none",
              borderRadius: 9,
              padding: "10px 12px",
              minHeight: 44,
              fontSize: 12.5,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {max.label}
          </button>
        ) : null}
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: error ? theme.danger : theme.muted, minHeight: 20, lineHeight: 1.45 }}>
        {error || hint}
      </div>
    </div>
  );
}

function DemoBar({ theme, actions }) {
  if (!actions.length) return null;
  return (
    <div
      data-demo-bar
      style={{
        marginTop: 24,
        border: `1px dashed ${theme.borderStrong}`,
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 10.5, color: theme.faint, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
        Demo controls
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="amb-tap"
            style={{
              background: theme.surfaceAlt,
              border: `1px solid ${theme.border}`,
              color: theme.muted,
              borderRadius: 8,
              padding: "10px 12px",
              minHeight: 44,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}


/* ---------------------------------------------------------- theme toggle --- */

export function ThemeToggle() {
  const { theme, themeName, toggleTheme } = usePayments();
  return (
    <button
      onClick={toggleTheme}
      className="amb-tap"
      aria-label={themeName === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      style={{
        background: theme.surfaceAlt,
        border: `1px solid ${theme.border}`,
        color: theme.muted,
        borderRadius: 10,
        width: 34,
        height: 34,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {themeName === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}


/* -------------------------------------------------------------- deposit --- */

export function DepositFlow({ onExit, onDone }) {
  const { theme, rate, limits, demo, api, creditDeposit } = usePayments();
  const [step, setStep] = useState("amount"); // amount | request | confirming | added | expired | failed
  const [amount, setAmount] = useState("");
  const [req, setReq] = useState(null);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const value = Number(amount || 0);
  const error =
    amount !== "" && value < limits.depositMin
      ? `Minimum deposit is ${usd(limits.depositMin, { whole: true })}.`
      : value > limits.depositMax
      ? `Maximum deposit is ${usd(limits.depositMax, { whole: true })} at a time.`
      : "";

  const createRequest = async (amountUsd) => {
    const request = await api.createInvoice({ amountUsd, usdPerBtc: rate });
    setReq(request);
    setStep("request");
  };

  const settle = () => {
    setStep("confirming");
    later(() => {
      creditDeposit(req.amountUsd);
      setStep("added");
    }, 1400);
  };

  // Seam 2: listen while the invoice is on screen, stop on the way out.
  useEffect(() => {
    if (step !== "request" || !req) return undefined;
    return api.watchInvoice(req, settle);
  }, [step, req]); // eslint-disable-line react-hooks/exhaustive-deps

  if (step === "amount")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Deposit" onBack={onExit} />
        <div style={{ color: theme.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 20 }}>
          How much do you want credited to your account?
        </div>

        <AmountField
          theme={theme}
          value={amount}
          onChange={setAmount}
          autoFocus
          error={error}
          hint={`Between ${usd(limits.depositMin, { whole: true })} and ${usd(limits.depositMax, { whole: true })}`}
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gridGap: 8, marginTop: 12 }}>
          {[1, 5, 20, 100].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="amb-tap"
              style={{
                background: Number(amount) === v ? theme.accentSoft : theme.surfaceAlt,
                border: `1px solid ${Number(amount) === v ? theme.accent : theme.border}`,
                color: Number(amount) === v ? theme.accent : theme.text,
                borderRadius: 10,
                padding: "11px 0",
                minHeight: 44,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
                ...NUM,
              }}
            >
              ${v}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 24 }}>
          <Button theme={theme} full disabled={!value || !!error} onClick={() => createRequest(value)}>
            Continue
          </Button>
        </div>
        <div style={{ marginTop: 16, fontSize: 11.5, color: theme.faint, textAlign: "center", lineHeight: 1.45 }}>
          No deposit fee. Funds land in seconds.
        </div>
      </div>
    );

  if (step === "request")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Pay to deposit" onBack={() => setStep("amount")} />

        <Card theme={theme} style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#FFFFFF", padding: 10, borderRadius: 14, lineHeight: 0 }}>
              <QrCode value={req.invoice.toUpperCase()} size={208} />
            </div>
          </div>

          <div style={{ marginTop: 14, textAlign: "center" }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: theme.text, ...NUM }}>{usd(req.amountUsd)}</div>
            <div style={{ fontSize: 12.5, color: theme.muted, marginTop: 4, lineHeight: 1.5 }}>
              Scan with Cash App or any Lightning wallet.
              {req.satAmount ? " Your app may show this as " + sats(req.satAmount) + " sats." : ""}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Countdown
              theme={theme}
              expiresAt={req.expiresAt}
              seconds={limits.invoiceSeconds}
              label="Expires in"
              onExpire={() => setStep("expired")}
            />
          </div>

          <div style={{ display: "grid", gridGap: 10, marginTop: 16 }}>
            <CopyButton theme={theme} text={req.invoice} label="Copy invoice" />
            <Button
              theme={theme}
              variant="ghost"
              full
              onClick={() => {
                window.location.href = `lightning:${req.invoice}`;
              }}
            >
              Open in wallet
            </Button>
          </div>
        </Card>

        <div
          data-pay-status
          style={{
            display: "flex",
            WebkitAlignItems: "center",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 20,
            marginBottom: 8,
            color: theme.muted,
            fontSize: 12.5,
          }}
        >
          <span
            data-anim
            data-pay-status-dot
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: theme.accent,
              marginRight: 8,
              flex: "0 0 auto",
              WebkitFlex: "0 0 auto",
              animation: "amb-pulse 1.4s ease-in-out infinite",
            }}
          />
          <span>Waiting for payment</span>
        </div>

        {demo ? (
          <DemoBar
            theme={theme}
            actions={[
              { label: "Simulate payment", onClick: settle },
              { label: "Let it expire", onClick: () => setStep("expired") },
              { label: "Payment fails", onClick: () => setStep("failed") },
            ]}
          />
        ) : null}
      </div>
    );

  if (step === "confirming")
    return (
      <div className="amb-rise" style={{ paddingTop: 44, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
          <Spinner color={theme.accent} size={30} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>Payment received</div>
        <div style={{ color: theme.muted, fontSize: 13.5, marginTop: 6 }}>Crediting {usd(req.amountUsd)} to your account…</div>
      </div>
    );

  if (step === "added")
    return (
      <div className="amb-rise" style={{ paddingTop: 30 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: theme.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div style={{ fontSize: 25, fontWeight: 700, color: theme.text, ...NUM }}>{usd(req.amountUsd)} added</div>
          <div style={{ color: theme.muted, fontSize: 13.5, marginTop: 5 }}>Credited to your account. Ready to play.</div>
        </div>

        <div style={{ display: "grid", gridGap: 10, marginTop: 28 }}>
          <Button theme={theme} full onClick={onDone}>
            Back to wallet
          </Button>
          <Button theme={theme} variant="ghost" full onClick={() => { setReq(null); setStep("amount"); }}>
            Deposit again
          </Button>
        </div>
      </div>
    );

  if (step === "expired")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Invoice expired" onBack={onExit} />
        <Notice
          theme={theme}
          tone="warn"
          title="This invoice expired"
          body={`Nothing was charged. Start a new ${usd(req.amountUsd)} invoice whenever you are ready.`}
        />
        <div style={{ display: "grid", gridGap: 10, marginTop: 24 }}>
          <Button theme={theme} full onClick={() => createRequest(req.amountUsd)}>
            New invoice for {usd(req.amountUsd)}
          </Button>
          <Button theme={theme} variant="ghost" full onClick={onExit}>
            Cancel
          </Button>
        </div>
      </div>
    );

  return (
    <div className="amb-rise">
      <BackBar theme={theme} title="Payment failed" onBack={onExit} />
      <Notice
        theme={theme}
        tone="danger"
        title="The payment did not go through"
        body="Nothing left your account. Start a new invoice and try again."
      />
      <div style={{ display: "grid", gridGap: 10, marginTop: 24 }}>
        <Button theme={theme} full onClick={() => createRequest(req.amountUsd)}>
          Try again
        </Button>
        <Button theme={theme} variant="ghost" full onClick={onExit}>
          Back to wallet
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- wallet --- */

function TxIcon({ theme, type, status }) {
  const failed = status === "failed";
  const color = failed ? theme.danger : type === "deposit" ? theme.accent : theme.text;
  const bg = failed ? theme.dangerSoft : type === "deposit" ? theme.accentSoft : theme.inset;
  return (
    <div
      data-tx-icon
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        overflow: "hidden",
        /* iPad WebKit ignores flex gap. Margin is the space Jesse keeps asking for. */
        marginRight: 28,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {type === "deposit" ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />}
      </svg>
    </div>
  );
}

function StatusChip({ theme, status }) {
  if (status === "complete") return null;
  if (status === "pending") return <Chip theme={theme} tone="warn">Pending</Chip>;
  return <Chip theme={theme} tone="danger">Failed</Chip>;
}

function TxDetail({ theme, tx, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, background: "rgba(4,8,18,0.55)", display: "flex", alignItems: "flex-end", borderRadius: 20, zIndex: 20 }}
      onClick={onClose}
    >
      <div
        className="amb-rise"
        onClick={(e) => e.stopPropagation()}
        style={{ background: theme.surface, borderTop: `1px solid ${theme.border}`, borderRadius: "18px 18px 20px 20px", padding: "18px 18px 20px", width: "100%" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <TxIcon theme={theme} type={tx.type} status={tx.status} />
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: theme.text }}>
              {tx.type === "deposit" ? "Deposit" : "Cash out"}
            </div>
            <div style={{ fontSize: 12, color: theme.muted }}>
              {new Date(tx.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <StatusChip theme={theme} status={tx.status} />
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 4 }}>
          <Row theme={theme} label="Amount" value={`${tx.type === "deposit" ? "+" : "-"}${usd(tx.amountUsd)}`} strong />
          {tx.destination ? <Row theme={theme} label="Sent to" value={tx.destination} /> : null}
          <Row theme={theme} label="Fee" value="None" />
          <Row theme={theme} label="Reference" value={tx.ref} mono />
        </div>

        {tx.note ? (
          <div style={{ marginTop: 12 }}>
            <Notice theme={theme} tone="danger" title={tx.note} body={`${usd(tx.amountUsd)} is back in your balance. No fee was charged.`} />
          </div>
        ) : null}

        <div style={{ marginTop: 20 }}>
          <Button theme={theme} variant="secondary" full onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WalletView({ onDeposit, onWithdraw, staff, compact }) {
  const { theme, balance, transactions } = usePayments();
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null);
  /* Mock wallet is compact so the sibling discovery box stays on screen.
     Live keeps the roomier card + Staff. */

  const list = transactions.filter((t) =>
    filter === "all" ? true : filter === "in" ? t.type === "deposit" : t.type === "withdrawal"
  );

  return (
    <div className="amb-rise" data-wallet-compact={compact ? "true" : undefined}>
      <Card theme={theme} style={{ padding: compact ? "14px 16px 12px" : "18px 18px 16px", background: theme.surfaceAlt }}>
        <span style={{ fontSize: 11, color: theme.faint, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Account balance
        </span>
        <div style={{ fontSize: 38, fontWeight: 700, color: theme.text, marginTop: compact ? 6 : 10, ...NUM }}>{usd(balance)}</div>
        <div data-balance-caption style={{ fontSize: 12, color: theme.muted, marginTop: compact ? 4 : 8, lineHeight: 1.45 }}>
          Available to play or cash out
        </div>

        <div data-balance-actions style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridGap: 12, marginTop: compact ? 10 : 16, paddingTop: compact ? 8 : 16 }}>
          <Button theme={theme} onClick={onDeposit} full>
            Deposit
          </Button>
          <Button theme={theme} variant="secondary" onClick={onWithdraw} full>
            Cash out
          </Button>
        </div>
      </Card>

      <div data-tx-heading style={{ display: "flex", alignItems: "center", marginTop: compact ? 12 : 22, marginBottom: compact ? 6 : 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: theme.text }}>Transactions</div>
        <div style={{ marginLeft: "auto", display: "flex", background: theme.inset, borderRadius: 9, padding: 3, gap: 2 }}>
          {[["all", "All"], ["in", "In"], ["out", "Out"]].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="amb-tap"
              style={{
                background: filter === k ? theme.surface : "transparent",
                color: filter === k ? theme.text : theme.muted,
                border: filter === k ? `1px solid ${theme.border}` : "1px solid transparent",
                borderRadius: 7,
                padding: "8px 12px",
                minHeight: 44,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card theme={theme} data-tx-list={compact ? "mock" : undefined} style={{ overflow: compact ? "auto" : "hidden" }}>
        {list.length === 0 ? (
          <div style={{ padding: "28px 18px", textAlign: "center", color: theme.muted, fontSize: 13.5 }}>
            Nothing here yet. Your {filter === "in" ? "deposits" : "cash outs"} will show up in this list.
          </div>
        ) : (
          list.map((tx, i) => (
            <button
              key={tx.id}
              data-tx-row
              onClick={() => setOpen(tx)}
              className="amb-tap"
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderTop: i ? `1px solid ${theme.border}` : "none",
                padding: compact ? "10px 15px" : "13px 15px",
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              <TxIcon theme={theme} type={tx.type} status={tx.status} />
              <div style={{ minWidth: 0, flex: 1, paddingLeft: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>
                    {tx.type === "deposit" ? "Deposit" : `To ${tx.destination || "wallet"}`}
                  </span>
                  <StatusChip theme={theme} status={tx.status} />
                </div>
                <div style={{ fontSize: 11.5, color: theme.faint, marginTop: 2 }}>{relTime(tx.ts)}</div>
              </div>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 700,
                  marginLeft: 12,
                  color: tx.status === "failed" ? theme.faint : tx.type === "deposit" ? theme.accent : theme.text,
                  textDecoration: tx.status === "failed" ? "line-through" : "none",
                  ...NUM,
                }}
              >
                {tx.type === "deposit" ? "+" : "-"}
                {usd(tx.amountUsd)}
              </div>
            </button>
          ))
        )}
      </Card>

      {staff ? (
        <div data-staff-section style={{ marginTop: 22 }}>
          <div
            style={{
              fontSize: 11,
              color: theme.faint,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Staff
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridGap: 10 }}>
            <Button
              theme={theme}
              variant="secondary"
              full
              data-fund
              disabled={!staff.fundEnabled}
              aria-disabled={!staff.fundEnabled ? "true" : undefined}
              title={staff.fundEnabled ? undefined : "Funding is off"}
              onClick={staff.fundEnabled ? staff.onFund : undefined}
            >
              Fund
            </Button>
            <Button theme={theme} variant="secondary" full onClick={staff.onNewVisitor}>
              New visitor
            </Button>
          </div>
        </div>
      ) : null}

      {open ? <TxDetail theme={theme} tx={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------- withdraw --- */

const SAMPLE_CODES = [
  { id: "tag", title: "A cashtag", detail: BOOTH.sampleCashtag, value: BOOTH.sampleCashtag },
  { id: "addr", title: "A Lightning address", detail: "player@walletofsatoshi.com", value: "player@walletofsatoshi.com" },
  { id: "fixed", title: "An invoice for a set amount", detail: "Amount already filled in", value: makeInvoice(42500) },
];

function usableDestination(text, rate, capabilities) {
  const d = payoutCheck(parseDestination(text, rate), capabilities);
  return d.kind === "cashtag" || d.kind === "address" || d.kind === "request";
}

function Scanner({ theme, onCancel, onDetect, rate, capabilities, streamPromise }) {
  const [showSamples, setShowSamples] = useState(false);
  const [phase, setPhase] = useState("starting");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(0);
  const cancelledRef = useRef(false);
  const acceptedRef = useRef(false);
  const warmupUsedRef = useRef(false);
  const pendingRef = useRef(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const stopTick = function () {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = 0;
    }
  };

  const release = function () {
    stopTick();
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  };

  const beginTick = function (video) {
    const canvas = document.createElement("canvas");
    const tick = async function () {
      if (cancelledRef.current || acceptedRef.current) return;
      try {
        const raw = await decodeVideoFrame(video, canvas);
        if (raw && !acceptedRef.current && !cancelledRef.current) {
          const text = normalizeScannedText(raw);
          if (usableDestination(text, rate, capabilities)) {
            acceptedRef.current = true;
            onDetectRef.current(text);
            return;
          }
          setPhase("unreadable");
        }
      } catch (e) {
        /* keep scanning */
      }
      if (!cancelledRef.current && !acceptedRef.current) timerRef.current = setTimeout(tick, 110);
    };
    timerRef.current = setTimeout(tick, 80);
  };

  const runCamera = async function (fromWarmup, pending) {
    const video = videoRef.current;
    if (!video) return;
    stopTick();
    setPhase("starting");
    try {
      let stream = null;
      const handed = pending || pendingRef.current;
      pendingRef.current = null;
      if (handed) {
        warmupUsedRef.current = true;
        stream = await handed;
        if (cancelledRef.current) {
          stopStream(stream);
          return;
        }
        await attachStream(video, stream);
      } else if (fromWarmup && streamPromise && !warmupUsedRef.current) {
        warmupUsedRef.current = true;
        stream = await streamPromise;
        if (cancelledRef.current) {
          stopStream(stream);
          return;
        }
        await attachStream(video, stream);
      } else {
        stopStream(streamRef.current);
        streamRef.current = null;
        stream = await startCamera(video);
      }
      if (cancelledRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      setPhase("live");
      beginTick(video);
    } catch (e) {
      if (cancelledRef.current) return;
      const next = await resolveCameraError(e);
      if (!cancelledRef.current) setPhase(next);
    }
  };

  useEffect(() => {
    if (showSamples) {
      release();
      return undefined;
    }
    cancelledRef.current = false;
    acceptedRef.current = false;
    runCamera(true);
    return function () {
      cancelledRef.current = true;
      release();
    };
  }, [showSamples]);

  const status = CAMERA_COPY[phase] || CAMERA_COPY.failed;
  const canRetry = phase === "denied" || phase === "failed" || phase === "missing" || phase === "insecure" || phase === "gesture";

  const retryCamera = function () {
    /* Start getUserMedia in the tap turn so iOS standalone still counts it
       as a user gesture. Do not reuse the failed warmup promise. */
    stopStream(streamRef.current);
    streamRef.current = null;
    const pending = openCameraStream();
    pending.catch(function () {});
    pendingRef.current = pending;
    runCamera(false, pending);
  };

  const corners = [
    { top: 14, left: 14, borderTop: `3px solid ${theme.accent}`, borderLeft: `3px solid ${theme.accent}`, borderRadius: "6px 0 0 0" },
    { top: 14, right: 14, borderTop: `3px solid ${theme.accent}`, borderRight: `3px solid ${theme.accent}`, borderRadius: "0 6px 0 0" },
    { bottom: 14, right: 14, borderBottom: `3px solid ${theme.accent}`, borderRight: `3px solid ${theme.accent}`, borderRadius: "0 0 6px 0" },
    { bottom: 14, left: 14, borderBottom: `3px solid ${theme.accent}`, borderLeft: `3px solid ${theme.accent}`, borderRadius: "0 0 0 6px" },
  ];

  return (
    <div
      className="amb-scan-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Scan a code"
      data-scan-sheet="1"
      style={{
        position: "relative",
        background: "#070C17",
        borderRadius: 20,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        zIndex: 40,
        boxSizing: "border-box",
        minHeight: 420,
        isolation: "isolate",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, flex: "0 0 auto", background: "#070C17" }}>
        <span style={{ color: "#FFFFFF", fontWeight: 700, fontSize: 15 }}>Scan a code</span>
        <button
          onClick={onCancel}
          aria-label="Close scanner"
          className="amb-tap"
          style={{ marginLeft: "auto", background: "#1A2438", border: "none", color: "#FFFFFF", width: 44, height: 44, borderRadius: 8, cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      {showSamples ? (
        <div
          data-scan-samples="1"
          style={{ background: theme.surface, borderRadius: 14, padding: 8, flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}
        >
          {SAMPLE_CODES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onDetect(s.value)}
              className="amb-tap"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: theme.surface,
                border: "none",
                borderTop: i ? `1px solid ${theme.border}` : "none",
                padding: "12px 10px",
                minHeight: 44,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.text }}>{s.title}</div>
              <div style={{ fontSize: 11.5, color: theme.muted, marginTop: 2 }}>{s.detail}</div>
            </button>
          ))}
        </div>
      ) : (
        <div
          data-scan-viewfinder="1"
          style={{
            position: "relative",
            width: "100%",
            flex: "1 1 auto",
            minHeight: 180,
            borderRadius: 16,
            overflow: "hidden",
            background: "#0B1424",
          }}
        >
          <video
            ref={videoRef}
            muted
            autoPlay
            playsInline
            aria-label="Camera preview"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              background: "#000",
              visibility: phase === "live" || phase === "unreadable" ? "visible" : "hidden",
            }}
          />
          {corners.map((c, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: 30,
                height: 30,
                borderTop: c.borderTop,
                borderRight: c.borderRight,
                borderBottom: c.borderBottom,
                borderLeft: c.borderLeft,
                borderRadius: c.borderRadius,
                top: c.top,
                left: c.left,
                right: c.right,
                bottom: c.bottom,
              }}
            />
          ))}
          {(phase === "live" || phase === "unreadable") ? (
            <div style={{ position: "absolute", left: "8%", right: "8%", top: "42%", height: 2, background: theme.accent }} />
          ) : null}
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, textAlign: "center", background: "#0B1424", borderRadius: 12, padding: "10px 8px" }}>
            <div style={{ color: "#E8EEF9", fontSize: 12.5, lineHeight: 1.45 }}>{status}</div>
            {canRetry ? (
              <button
                onClick={retryCamera}
                className="amb-tap"
                style={{
                  marginTop: 10,
                  background: "#1A2438",
                  border: "1px solid #33456B",
                  color: "#FFFFFF",
                  borderRadius: 10,
                  padding: "10px 14px",
                  minHeight: 44,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                Allow camera
              </button>
            ) : null}
          </div>
        </div>
      )}

      <button
        data-scan-helper="1"
        onClick={() => setShowSamples((s) => !s)}
        className="amb-tap"
        style={{ marginTop: 12, flex: "0 0 auto", background: "#070C17", border: "none", color: "#C5D0E4", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT, padding: "10px 8px", minHeight: 44 }}
      >
        {showSamples ? "Back to camera" : "Camera not working? Pick a sample code"}
      </button>
    </div>
  );
}

function DestinationPill({ theme, dest, onChange }) {
  return (
    <div style={{ background: theme.inset, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: theme.accentSoft, color: theme.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "0 0 auto" }}>
        {dest.kind === "cashtag" ? "$" : (dest.display && dest.display[0] ? dest.display[0].toUpperCase() : "?")}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: theme.faint, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{dest.label}</div>
        <div style={{ fontSize: 13.5, color: theme.text, marginTop: 3, fontWeight: 600, wordBreak: "break-all", fontFamily: dest.kind === "request" ? MONO : FONT }}>
          {dest.display}
        </div>
      </div>
      {onChange ? (
        <button
          onClick={onChange}
          className="amb-tap"
          style={{ marginLeft: "auto", background: "transparent", border: "none", color: theme.muted, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT, minHeight: 44, padding: "8px 6px" }}
        >
          Change
        </button>
      ) : null}
    </div>
  );
}

export function WithdrawFlow({ onExit, onDone }) {
  const { theme, balance, rate, limits, demo, api, capabilities, debitWithdrawal, cashOutSuccessExtra } = usePayments();
  const [step, setStep] = useState("destination"); // destination | amount | review | sending | sent | pending | failed
  const [raw, setRaw] = useState("");
  const [dest, setDest] = useState(null);
  const [amount, setAmount] = useState("");
  const [final, setFinal] = useState(null);
  const [scanning, setScanning] = useState(false);
  const scanWarmup = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const typed = payoutCheck(parseDestination(raw, rate), capabilities);
  const typedOk = ["cashtag", "address", "request"].includes(typed.kind);

  const accept = (input) => {
    const d = payoutCheck(parseDestination(input, rate), capabilities);
    if (d.kind === "invalid") {
      setRaw(input);
      setStep("destination");
      return;
    }
    setRaw(input);
    setDest(d);
    if (d.amountKnown) {
      setFinal({ amountUsd: d.amountUsd, dest: d, fixed: true });
      setStep("review");
    } else {
      setStep("amount");
    }
  };

  const value = Number(amount || 0);
  const amountError =
    amount !== "" && value < limits.withdrawMin
      ? `Minimum cash out is ${usd(limits.withdrawMin, { whole: true })}.`
      : value > balance
      ? `Your balance is ${usd(balance)}. Enter ${usd(balance)} or less.`
      : "";

  const insufficient = final && final.amountUsd > balance;

  const send = async () => {
    setStep("sending");
    const result = await api.sendPayment({
      amountUsd: final.amountUsd,
      destination: final.dest.address,
    });
    if (!alive.current) return;
    debitWithdrawal(final.amountUsd, final.dest.display, result.status);
    setStep(result.status === "complete" ? "sent" : result.status);
  };

  if (step === "destination") {
    if (scanning) {
      return (
        <Scanner
          theme={theme}
          rate={rate}
          capabilities={capabilities}
          streamPromise={scanWarmup.current}
          onCancel={() => {
            setScanning(false);
            scanWarmup.current = null;
          }}
          onDetect={(v) => {
            setScanning(false);
            scanWarmup.current = null;
            accept(v);
          }}
        />
      );
    }
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Cash out" onBack={onExit} />

        <div
          style={{
            background: theme.inset,
            border: `1px solid ${raw && !typedOk ? theme.danger : theme.border}`,
            borderRadius: 14,
            padding: "12px 12px 12px 14px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <input
            value={raw}
            autoFocus
            onChange={(e) => setRaw(e.target.value)}
            type="text"
            inputMode={/^ln[a-z0-9]/i.test(String(raw || "").trim()) ? "text" : "email"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="$cashtag, address, or invoice"
            aria-label="Cashtag, Lightning address, or invoice"
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: theme.text,
              fontSize: 15,
              fontFamily: FONT,
              fontWeight: 600,
              padding: "8px 0",
            }}
          />
          <button
            onClick={() => {
              const warmup = openCameraStream();
              warmup.catch(function () {});
              scanWarmup.current = warmup;
              setScanning(true);
            }}
            aria-label="Scan a code"
            className="amb-tap"
            style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, color: theme.text, width: 44, height: 44, borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
              <path d="M3 12h18" />
            </svg>
          </button>
        </div>

        <div style={{ minHeight: 20, marginTop: 12, fontSize: 12.5, lineHeight: 1.45, color: raw && !typedOk ? theme.danger : theme.muted }}>
          {raw
            ? typedOk
              ? typed.amountKnown
                ? `Set amount: ${usd(typed.amountUsd)}`
                : "You choose the amount next"
              : typed.reason
            : "Start a cashtag with $."}
        </div>

        <div style={{ marginTop: 24 }}>
          <Button theme={theme} full disabled={!typedOk} onClick={() => accept(raw)}>
            Continue
          </Button>
        </div>

        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, color: theme.faint, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Recently used
          </div>
          <Card theme={theme}>
            <button
              onClick={() => accept(BOOTH.sampleCashtag)}
              className="amb-tap"
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "12px 14px", minHeight: 44, cursor: "pointer", textAlign: "left", fontFamily: FONT }}
            >
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: theme.accentSoft, color: theme.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>
                $
              </div>
              <div>
                <div style={{ fontSize: 14, color: theme.text, fontWeight: 600 }}>{BOOTH.sampleCashtag}</div>
                <div style={{ fontSize: 11.5, color: theme.faint, marginTop: 2 }}>Cash App · used 52m ago</div>
              </div>
            </button>
          </Card>
        </div>
      </div>
    );
  }

  if (step === "amount")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="How much?" onBack={() => setStep("destination")} />
        <DestinationPill theme={theme} dest={dest} onChange={() => setStep("destination")} />

        <div style={{ marginTop: 20 }}>
          <AmountField
            theme={theme}
            value={amount}
            onChange={setAmount}
            autoFocus
            error={amountError}
            max={{ label: "All", onClick: () => setAmount(balance.toFixed(2)) }}
            hint={`Available ${usd(balance)}`}
          />
        </div>

        <div style={{ marginTop: 24 }}>
          <Button
            theme={theme}
            full
            disabled={!value || !!amountError}
            onClick={() => {
              setFinal({ amountUsd: value, dest, fixed: false });
              setStep("review");
            }}
          >
            Review
          </Button>
        </div>
        <div style={{ marginTop: 16, fontSize: 11.5, color: theme.faint, textAlign: "center", lineHeight: 1.45 }}>No cash out fee.</div>
      </div>
    );

  if (step === "review")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Confirm cash out" onBack={() => setStep(final.fixed ? "destination" : "amount")} />

        <div style={{ textAlign: "center", margin: "6px 0 18px" }}>
          <div style={{ fontSize: 38, fontWeight: 700, color: theme.text, ...NUM }}>{usd(final.amountUsd)}</div>
          <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
            {final.fixed ? "Amount set by the invoice" : "From your balance"}
          </div>
        </div>

        <DestinationPill theme={theme} dest={final.dest} />

        <Card theme={theme} style={{ padding: "6px 16px 12px", marginTop: 12 }}>
          <Row theme={theme} label="Arrives" value="In seconds" />
          <Row theme={theme} label="Fee" value="None" />
          <Row theme={theme} label="Balance after" value={usd(Math.max(0, balance - final.amountUsd))} sub={insufficient ? undefined : `from ${usd(balance)}`} />
        </Card>

        {insufficient ? (
          <div style={{ marginTop: 12 }}>
            <Notice
              theme={theme}
              tone="danger"
              title="Not enough in your balance"
              body={`This invoice asks for ${usd(final.amountUsd)} and your balance is ${usd(balance)}. Deposit more, or use an invoice you can cover.`}
            />
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
          <Button theme={theme} full disabled={insufficient} onClick={send}>
            {insufficient ? "Cannot send" : `Send ${usd(final.amountUsd)}`}
          </Button>
          <Button theme={theme} variant="ghost" full onClick={onExit}>
            Cancel
          </Button>
        </div>

        {demo ? (
          <DemoBar
            theme={theme}
            actions={[
              { label: "Payment fails", onClick: () => { debitWithdrawal(final.amountUsd, final.dest.display, "failed"); setStep("failed"); } },
              { label: "Stays pending", onClick: () => { debitWithdrawal(final.amountUsd, final.dest.display, "pending"); setStep("pending"); } },
              ...(final.fixed ? [] : [{ label: "Force insufficient", onClick: () => setFinal({ ...final, amountUsd: balance + 50 }) }]),
            ]}
          />
        ) : null}
      </div>
    );

  if (step === "sending")
    return (
      <div className="amb-rise" style={{ paddingTop: 44, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
          <Spinner color={theme.accent} size={30} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: theme.text }}>Sending {usd(final.amountUsd)}</div>
        <div style={{ color: theme.muted, fontSize: 13.5, marginTop: 6 }}>To {final.dest.display}</div>
      </div>
    );

  if (step === "sent")
    return (
      <div className="amb-rise" style={{ paddingTop: 8 }}>
        <Card theme={theme} data-success-card style={{ padding: "22px 18px 20px", textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", background: theme.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div style={{ fontSize: 25, fontWeight: 700, color: theme.text, ...NUM }}>{usd(final.amountUsd)} paid out from your account</div>
          <div style={{ color: theme.muted, fontSize: 13.5, marginTop: 5 }}>
            {final.dest.display} has the money. Your balance is {usd(Math.max(0, balance))}.
          </div>
          <div style={{ marginTop: 24 }}>
            <Button theme={theme} full onClick={onDone}>
              Back to wallet
            </Button>
          </div>
        </Card>

        {typeof cashOutSuccessExtra === "function" ? cashOutSuccessExtra(theme) : cashOutSuccessExtra}
      </div>
    );

  if (step === "pending")
    return (
      <div className="amb-rise">
        <BackBar theme={theme} title="Still sending" onBack={onDone} />
        <Notice
          theme={theme}
          tone="warn"
          title="This one is taking longer than usual"
          body={`${usd(final.amountUsd)} is on its way to ${final.dest.display} and is held until it lands. You will see the result in your transaction list.`}
        />
        <div style={{ marginTop: 24 }}>
          <Button theme={theme} full onClick={onDone}>
            Back to wallet
          </Button>
        </div>
      </div>
    );

  return (
    <div className="amb-rise">
      <BackBar theme={theme} title="Cash out failed" onBack={onDone} />
      <Notice
        theme={theme}
        tone="danger"
        title={`${final.dest.display} could not be reached`}
        body={`${usd(final.amountUsd)} is back in your balance and no fee was charged. Try again, or send to somewhere else.`}
      />
      <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
        <Button theme={theme} full onClick={() => setStep("review")}>
          Try again
        </Button>
        <Button theme={theme} variant="ghost" full onClick={() => setStep("destination")}>
          Use a different destination
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shell --- */

function Shell() {
  const { theme, reset } = usePayments();
  const [screen, setScreen] = useState("wallet");

  return (
    <div style={{ minHeight: "100%", background: theme.bg, fontFamily: FONT, padding: "20px 14px 40px", transition: "background-color .2s ease" }}>
      <div style={{ maxWidth: 420, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: theme.accent, display: "flex", alignItems: "center", justifyContent: "center", color: theme.accentText, fontSize: 14, fontWeight: 800 }}>
              $
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: theme.text, lineHeight: 1.1 }}>Cashier</div>
              <div style={{ fontSize: 10.5, color: theme.faint, marginTop: 2 }}>Mock, not live funds</div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={reset}
              className="amb-tap"
              style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, color: theme.muted, borderRadius: 10, padding: "0 12px", height: 34, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
            >
              Reset
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div
          style={{
            position: "relative",
            background: theme.name === "dark" ? "#0D1524" : "#FFFFFF",
            border: `1px solid ${theme.border}`,
            borderRadius: 20,
            padding: 18,
            minHeight: 620,
            boxShadow: theme.shadow,
            overflow: "hidden",
          }}
        >
          {screen === "wallet" ? (
            <WalletView onDeposit={() => setScreen("deposit")} onWithdraw={() => setScreen("withdraw")} />
          ) : screen === "deposit" ? (
            <DepositFlow onExit={() => setScreen("wallet")} onDone={() => setScreen("wallet")} />
          ) : (
            <WithdrawFlow onExit={() => setScreen("wallet")} onDone={() => setScreen("wallet")} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function AmbossPaymentsMock() {
  return (
    <PaymentsProvider usdPerBtc={111842.5}>
      <Styles />
      <Shell />
    </PaymentsProvider>
  );
}
