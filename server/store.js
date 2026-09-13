import { config, round2 } from "./config.js";
import { newSecretId, pinMatches } from "./security.js";

/* ---------------------------------------------------------------- rate --- */
/* A stablecoin wallet needs no rate to price a dollar amount (that IS the
   settlement amount). A BTC wallet does, and BOLT11 invoices always do,
   because they are sat-denominated. The booth also needs a real rate on
   /healthz so operators can see the feed is alive -- reporting usdPerBtc: 1
   / source "n/a" for a USDT wallet made a working Coinbase feed look broken
   and hid a missing feed when one was required. */

let cached = { usdPerBtc: config.usdPerBtc, at: 0, source: "config" };

export function isUsableBtcRate(rate) {
  return Boolean(rate && isFinite(rate.usdPerBtc) && rate.usdPerBtc > 1000 && rate.source !== "n/a");
}

async function fetchSpot(url, parse) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parse(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

const SPOT_SOURCES = [
  {
    name: "coinbase",
    url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
    parse: (body) => Number(body && body.data && body.data.amount),
  },
  {
    name: "coingecko",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    parse: (body) => Number(body && body.bitcoin && body.bitcoin.usd),
  },
];

async function fetchBtcUsdRate() {
  if (config.rateSource === "static") return { usdPerBtc: config.usdPerBtc, source: "static" };
  if (Date.now() - cached.at < 60000 && cached.source !== "config" && isUsableBtcRate(cached)) return cached;

  for (const src of SPOT_SOURCES) {
    try {
      const price = await fetchSpot(src.url, src.parse);
      if (isFinite(price) && price > 1000) {
        cached = { usdPerBtc: price, at: Date.now(), source: src.name };
        return cached;
      }
    } catch (e) {
      /* try the next source */
    }
  }

  /* Keep the last GOOD rate. Do not invent $1 or the $100000 default -- that
     is how invoice caps were silently bypassed and how healthz lied. */
  if (cached.at && cached.source !== "config" && isUsableBtcRate(cached)) {
    return { usdPerBtc: cached.usdPerBtc, at: cached.at, source: "stale" };
  }
  throw new Error("No usable BTC/USD rate. Invoice cash-outs are blocked until a live rate is available.");
}

/* For a stablecoin wallet, a dollar amount IS the settlement amount -- no BTC
   rate needed, so this returns the "1" shortcut. Used for deposit amounts and
   wallet-minor-unit math. Never use this to price a BOLT11 invoice, to
   populate /healthz, or as SDK amountSats on a Lightning address send. */
export async function getRate() {
  if (config.asset !== "BTC") return { usdPerBtc: 1, source: "n/a" };
  return fetchBtcUsdRate();
}

/* Always a REAL BTC/USD market rate, regardless of the wallet's settlement
   asset. A BOLT11 invoice is sat-denominated no matter what the wallet
   settles in, so pricing one in dollars needs the real rate even on a
   stablecoin wallet. Using the getRate() "1" shortcut here was a real bug: it
   let an invoice worth hundreds of real dollars pass a $1-$100 cap check that
   thought it cost a fraction of a cent, because 1,000,000 sats / 1e8 * 1 came
   out to $0.01 instead of ~$811 at the real rate. See HANDOFF.md if this file
   moves. */
export async function getInvoiceUsdRate() {
  const rate = await fetchBtcUsdRate();
  if (!isUsableBtcRate(rate)) throw new Error("No usable BTC/USD rate.");
  return rate;
}

/* ------------------------------------------------------------ sessions --- */
/* One session per visitor. A session starts empty, so the only money a visitor
   can withdraw is money they just deposited. The operator can hand out a small
   starting balance with the pin, and that is the only drainable surface. */

const sessions = new Map();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

let float = { day: today(), grantedUsd: 0, paidOutUsd: 0 };

function today() {
  return new Date().toISOString().slice(0, 10);
}
function rollFloat() {
  if (float.day !== today()) float = { day: today(), grantedUsd: 0, paidOutUsd: 0 };
}
export function floatState() {
  rollFloat();
  return { ...float, capUsd: config.dailyFloatUsd, remainingUsd: round2(config.dailyFloatUsd - float.grantedUsd) };
}

export function newSession() {
  sweep();
  const id = newSecretId("s");
  const session = { id, balanceUsd: 0, transactions: [], createdAt: Date.now(), pending: new Map() };
  sessions.set(id, session);
  return session;
}

export function getSession(id) {
  const s = sessions.get(id);
  if (!s) return null;
  s.seenAt = Date.now();
  return s;
}

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if ((s.seenAt || s.createdAt) < cutoff) sessions.delete(id);
}

export function fundSession(session, pin) {
  rollFloat();
  if (!config.fundEnabled) return { error: "Funding is off." };
  if (!pinMatches(pin, config.operatorPin)) return { error: "Wrong pin." };
  const amount = config.sessionStartUsd;
  if (float.grantedUsd + amount > config.dailyFloatUsd)
    return { error: `Daily demo float of $${config.dailyFloatUsd} is used up.` };
  float.grantedUsd = round2(float.grantedUsd + amount);
  session.balanceUsd = round2(session.balanceUsd + amount);
  session.transactions.unshift({
    id: "t_" + Math.random().toString(36).slice(2, 10),
    ref: reference(),
    type: "deposit",
    amountUsd: amount,
    status: "complete",
    ts: Date.now(),
    demoFloat: true,
  });
  return { ok: true, balanceUsd: session.balanceUsd };
}

export function recordPayout(amountUsd) {
  rollFloat();
  float.paidOutUsd = round2(float.paidOutUsd + amountUsd);
}

export function reference() {
  let s = "";
  for (let i = 0; i < 12; i++) s += "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)];
  return s;
}

export function publicState(session) {
  return {
    sessionId: session.id,
    balanceUsd: round2(session.balanceUsd),
    transactions: session.transactions.slice(0, 25).map((tx) => {
      const out = { ...tx };
      delete out.error;
      return out;
    }),
  };
}
