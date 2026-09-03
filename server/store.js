import { config, round2 } from "./config.js";

/* ---------------------------------------------------------------- rate --- */
/* A stablecoin wallet needs no rate at all. A BTC wallet needs one to price a
   dollar amount, and the booth needs it to keep working when the venue network
   eats the request, so a cached value and a configured floor sit behind it. */

let cached = { usdPerBtc: config.usdPerBtc, at: 0, source: "config" };

async function fetchBtcUsdRate() {
  if (config.rateSource === "static") return { usdPerBtc: config.usdPerBtc, source: "static" };
  if (Date.now() - cached.at < 60000 && cached.source !== "config") return cached;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { signal: ctrl.signal });
    clearTimeout(timer);
    const body = await res.json();
    const price = Number(body && body.data && body.data.amount);
    if (isFinite(price) && price > 1000) {
      cached = { usdPerBtc: price, at: Date.now(), source: "coinbase" };
      return cached;
    }
    throw new Error("unusable price payload");
  } catch (e) {
    /* Keep the last good rate. If there never was one, fall back to config. */
    return { usdPerBtc: cached.usdPerBtc || config.usdPerBtc, at: cached.at, source: "stale" };
  }
}

/* For a stablecoin wallet, a dollar amount IS the settlement amount -- no BTC
   rate needed, so this returns the "1" shortcut. Used for deposit/withdraw
   amounts that are already denominated in dollars. */
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
  return fetchBtcUsdRate();
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
  const id = "s_" + Math.random().toString(36).slice(2, 12);
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
  if (config.operatorPin && pin !== config.operatorPin) return { error: "Wrong pin." };
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
    transactions: session.transactions.slice(0, 25),
  };
}
