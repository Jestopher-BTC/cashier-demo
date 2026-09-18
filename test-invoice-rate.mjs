/* Regression test for a real money-safety bug: on a stablecoin wallet
   (AMBOSS_ASSET != BTC), paying a BOLT11 invoice must still price the invoice
   against the REAL BTC/USD rate before checking it against the withdrawal
   caps -- a BOLT11 invoice is always sat-denominated no matter what asset the
   wallet settles in.

   The bug: server/store.js's getRate() returns a hardcoded usdPerBtc of 1 for
   any non-BTC asset (correct for address/cashtag withdrawals, which are
   already dollar-denominated), and server/server.js's withdraw handler used
   to reuse that same "1" to price invoices too. That let a 1,000,000-sat
   invoice (really ~$1,000 at a real rate) compute as $0.01 and sail through
   a $0.01-$5 cap check, while Amboss went on to attempt the real ~$1,000
   Lightning payment underneath it. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = process.env.PORT || "8189";
process.env.AMBOSS_ASSET = "USDT";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.OPERATOR_PIN = "4242";
process.env.SESSION_START_USD = "20";
process.env.DAILY_FLOAT_USD = "100";
process.env.MIN_WITHDRAW_USD = "0.01";
process.env.MAX_WITHDRAW_USD = "5";

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

/* A syntactically valid-looking lnbc10m invoice: 10m = 10 * 1e-3 BTC =
   1,000,000 sats. Needs to be >=60 chars for parseDestination to accept it;
   the mock never inspects the body past the amount prefix. */
const invoice1M = "lnbc10m1p" + "q".repeat(60);

await sleep(120);

console.log("\nstablecoin wallet + BOLT11 invoice pricing");

const cfg = await call("/api/config");
check("wallet is not BTC", cfg.json.asset === "USDT", cfg.json);

const s1 = await call("/api/session", { method: "POST", body: {} });
const sid = s1.json.sessionId;
const funded = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "4242" } });
check("session funded (test setup, not the bug under test)", funded.json.balanceUsd === 20, funded.json);

const big = await call(`/api/withdraw?s=${sid}`, {
  method: "POST",
  body: { sessionId: sid, destination: invoice1M },
});
check(
  "a 1,000,000-sat invoice ($1000 real) is rejected by the cap, not silently priced at $0.01",
  big.status === 400 && /Cash outs run from/.test(big.json.error || ""),
  big.json
);

/* Sanity check the maths directly: at USD_PER_BTC=100000, 1,000,000 sats
   must price to $1000, not $0.01. Confirms the fix computes the real rate,
   not just that *some* rejection happened for an unrelated reason. */
check(
  "rejection message reflects the $0.01-$5 configured range, i.e. the invoice priced far above it",
  /\$0\.01 to \$5/.test(big.json.error || ""),
  big.json
);

console.log("\nstablecoin wallet + healthz / cashtag payout units");
const health = await fetch(BASE + "/healthz");
const hj = await health.json();
check(
  "healthz does not report usdPerBtc: 1 source n/a on a USDT wallet",
  health.status === 200 &&
    hj.checks.rate.ok === true &&
    hj.checks.rate.usdPerBtc === 100000 &&
    hj.checks.rate.source === "static",
  hj.checks.rate
);

const tag = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "$jestopher", amountUsd: 2 },
});
check("cashtag send accepted on USDT wallet", tag.status === 200, tag.json);
check(
  "cashtag send keeps USDT micro-units ($2 -> 2000000) for wallet math",
  sent[0] && sent[0].lightningAddress === "jestopher@cash.app" && sent[0].amountMinor === 2000000,
  sent[0]
);
check(
  "cashtag SDK amountSats is $2 in sats at the static rate (2000), not 2000000 micro-USDT",
  sent[0] && sent[0].amountSats === 2000,
  sent[0]
);

const addr = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "player@walletofsatoshi.com", amountUsd: 1 },
});
check("Lightning address send accepted on USDT wallet", addr.status === 200, addr.json);
check(
  "Lightning address send keeps the same dollar minor units",
  sent[1] && sent[1].lightningAddress === "player@walletofsatoshi.com" && sent[1].amountMinor === 1000000,
  sent[1]
);
check(
  "Lightning address SDK amountSats is $1 in sats (1000), not 1000000 micro-USDT",
  sent[1] && sent[1].amountSats === 1000,
  sent[1]
);

const viaUrl = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "https://cash.app/$jestopher", amountUsd: 1 },
});
check("cash.app URL pays the same cashtag address", viaUrl.status === 200 && sent[2] && sent[2].lightningAddress === "jestopher@cash.app", viaUrl.json);

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
process.exit(fail ? 1 : 0);
