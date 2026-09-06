/* Regression: a $1 USDT live/cash-out must stay 1 USDT in wallet minor units
   (1_000_000), never a BTC-priced figure like usdPerBtc/100 (~799).

   The booth failure on USDT-cashier-demo: deposit $1 landed as 1 USDTL, then
   cashtag sends showed ~799.37 USDTL. 1_000_000 (correct USDT micros) was
   passed through the SDK field amountSats, which LNURL reads as satoshis —
   0.01 BTC ≈ $800 at the Coinbase spot. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = process.env.PORT || "8190";
process.env.AMBOSS_ASSET = "USDT";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "79855.155";
process.env.OPERATOR_PIN = "4242";
process.env.SESSION_START_USD = "5";
process.env.DAILY_FLOAT_USD = "100";
process.env.MIN_WITHDRAW_USD = "1";
process.env.MAX_WITHDRAW_USD = "5";

const BTC_USD = 79855.155;
const { money, addressSendAmounts } = await import("./server/config.js");
const { server } = await import("./server/server.js");
const { mockAmboss } = await import("./server/mock-amboss.js");

const sent = [];
const origSendAddress = mockAmboss.sendAddress.bind(mockAmboss);
mockAmboss.sendAddress = async (args) => {
  sent.push(args);
  return origSendAddress(args);
};

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  ok  ", name);
  } else {
    fail++;
    console.log("  FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

await sleep(120);

console.log("\n$1 USDT units (Coinbase-shaped rate " + BTC_USD + ")");

const minor = money.usdToMinor(1, BTC_USD);
const minorFrom1_00 = money.usdToMinor(1.0, BTC_USD);
const sats = money.usdToSats(1, BTC_USD);
const wrongBtcScaled = Math.round(BTC_USD / 100);

check("$1 USDT is 1_000_000 micro-units", minor === 1_000_000, minor);
check("$1.00 uses the same wallet minor units", minorFrom1_00 === 1_000_000, minorFrom1_00);
check(
  "wallet minor units are not usdPerBtc/100 (the ~799 booth figure)",
  minor !== wrongBtcScaled && minor !== Math.round(BTC_USD / 100),
  { minor, wrongBtcScaled }
);
check(
  "rate is ignored for USDT minor units even if someone passes a spot price",
  money.usdToMinor(1, 1) === 1_000_000 && money.usdToMinor(1, 100000) === 1_000_000,
  { at1: money.usdToMinor(1, 1), at100k: money.usdToMinor(1, 100000) }
);

const live = addressSendAmounts(1, 1, BTC_USD);
check(
  "address send keeps 1 USDT in wallet minor units",
  live.amountMinor === 1_000_000,
  live
);
check(
  "address send amountSats is $1 in sats (~1252), not 1_000_000 micro-USDT",
  live.amountSats === 1252 && live.amountSats !== 1_000_000,
  live
);
check(
  "address send amountSats is not usdPerBtc/100",
  live.amountSats !== wrongBtcScaled,
  { amountSats: live.amountSats, wrongBtcScaled }
);

let threw = false;
try {
  money.usdToSats(1, 1);
} catch (e) {
  threw = /real BTC\/USD rate/.test(e.message);
}
check("usdToSats refuses the stablecoin getRate() shortcut of 1", threw);

console.log("\n$1 USDT cashtag withdraw over /api/withdraw");

const s1 = await call("/api/session", { method: "POST", body: {} });
const sid = s1.json.sessionId;
const funded = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "4242" } });
check("session funded", funded.json.balanceUsd === 5, funded.json);

const wd = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "$jestopher", amountUsd: 1 },
});
check("$1 cashtag send accepted", wd.status === 200, wd.json);
check(
  "live/cash-out path produces 1 USDT in minor units, not ~btcPrice/100",
  sent[0] && sent[0].amountMinor === 1_000_000 && sent[0].amountMinor !== wrongBtcScaled,
  sent[0]
);
check(
  "SDK amountSats is LNURL sats for $1, not the USDT micro-unit collision",
  sent[0] && sent[0].amountSats === 1252 && sent[0].lightningAddress === "jestopher@cash.app",
  sent[0]
);

const wdCents = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "player@walletofsatoshi.com", amountUsd: 1.0 },
});
check("$1.00 Lightning address send accepted", wdCents.status === 200, wdCents.json);
check(
  "$1.00 takes the same 1_000_000 / 1252 split",
  sent[1] && sent[1].amountMinor === 1_000_000 && sent[1].amountSats === 1252,
  sent[1]
);

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
process.exit(fail ? 1 : 0);
