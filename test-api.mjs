/* Exercises the booth flow over HTTP with the mock Amboss adapter:
   session, fund, deposit, settle, withdraw to a cashtag, caps, and refunds. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = process.env.PORT || "8181";
process.env.OPERATOR_PIN = "4242";
process.env.SESSION_START_USD = "2";
process.env.MAX_DEPOSIT_USD = "5";
process.env.MAX_WITHDRAW_USD = "5";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";

const { server, parseDestination, addressSendLooksUnsupported } = await import("./server/server.js");
const { mockAmboss } = await import("./server/mock-amboss.js");

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

console.log("\nconfig and session");
const cfg = await call("/api/config");
check("config exposes caps", cfg.json.maxDepositUsd === 5 && cfg.json.asset === "BTC", cfg.json);
check("address payouts on for BTC", cfg.json.addressPayouts === true);

const s1 = await call("/api/session", { method: "POST", body: {} });
const sid = s1.json.sessionId;
check("session starts empty", s1.json.balanceUsd === 0, s1.json);

console.log("\nfunding");
const badPin = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "0000" } });
check("wrong pin refused", badPin.status === 403, badPin.json);
const funded = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "4242" } });
check("pin funds the session", funded.json.balanceUsd === 2, funded.json);

console.log("\ndeposit");
const tooBig = await call("/api/deposit", { method: "POST", body: { sessionId: sid, amountUsd: 500 } });
check("cap rejects $500", tooBig.status === 400, tooBig.json);

const dep = await call("/api/deposit", { method: "POST", body: { sessionId: sid, amountUsd: 3 } });
check("invoice minted", /^lnbc\d+n1p/.test(dep.json.invoice || ""), dep.json);
check("sats quoted for BTC wallet", dep.json.satAmount === 3000, dep.json);

const before = await call(`/api/deposit/${dep.json.id}?s=${sid}`);
check("unpaid reads pending", before.json.status === "pending", before.json);

mockAmboss.settle(dep.json.id);
const after = await call(`/api/deposit/${dep.json.id}?s=${sid}`);
check("payment credits the balance", after.json.balanceUsd === 5, after.json);

console.log("\nwithdraw to a cashtag");
const overBalance = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "$jestopher", amountUsd: 20 },
});
check("cap rejects $20", overBalance.status === 400, overBalance.json);

const wd = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "$jestopher", amountUsd: 4 },
});
check("send accepted", wd.status === 200, wd.json);
let status = wd.json.status;
for (let i = 0; i < 12 && status === "pending"; i++) {
  await sleep(400);
  const poll = await call(`/api/withdraw/${wd.json.id}?s=${sid}`);
  status = poll.json.status;
}
check("send completes", status === "complete", status);

const state = await call(`/api/state?s=${sid}`);
check("balance debited", state.json.balanceUsd === 1, state.json);
check("history shows the cashtag", state.json.transactions[0].destination === "$jestopher", state.json.transactions[0]);

console.log("\nfailure path");
const wd2 = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "$jestopher", amountUsd: 1 },
});
mockAmboss.settle(wd2.json.id, { fail: true });
let status2 = wd2.json.status;
for (let i = 0; i < 12 && status2 === "pending"; i++) {
  await sleep(400);
  const poll = await call(`/api/withdraw/${wd2.json.id}?s=${sid}`);
  status2 = poll.json.status;
}
check("failed send reported", status2 === "failed", status2);
const refunded = await call(`/api/state?s=${sid}`);
check("failed send refunds", refunded.json.balanceUsd === 1, refunded.json);

console.log("\nvalidation");
const amountless = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "lnbc1p" + "q".repeat(80) },
});
check("amountless invoice refused", amountless.status === 400 && /Amountless/.test(amountless.json.error), amountless.json);
const onchain = await call("/api/withdraw", {
  method: "POST",
  body: { sessionId: sid, destination: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", amountUsd: 1 },
});
check("on-chain address refused", onchain.status === 400, onchain.json);
const noSession = await call("/api/state?s=s_nope");
check("dead session refused", noSession.status === 409, noSession.json);

console.log("\ndestinations");
const tag = parseDestination("$Jestopher");
check("cashtag becomes cash.app address", tag.kind === "address" && tag.address === "jestopher@cash.app", tag);
check("cashtag display keeps the dollar sign", tag.display.toLowerCase() === "$jestopher", tag);
const cashUrl = parseDestination("https://cash.app/$jestopher");
check("cash.app URL is a cashtag", cashUrl.address === "jestopher@cash.app" && cashUrl.display === "$jestopher", cashUrl);
const lnurlp = parseDestination("https://walletofsatoshi.com/.well-known/lnurlp/player");
check("lnurlp URL is a Lightning address", lnurlp.address === "player@walletofsatoshi.com", lnurlp);
const wide = parseDestination("\uFF04jestopher");
check("fullwidth dollar sign is a cashtag", wide.address === "jestopher@cash.app", wide);
check(
  "liquidity errors do not disable address payouts",
  addressSendLooksUnsupported("Liquidity not available") === false
);
check(
  "documented taproot message does disable address payouts",
  addressSendLooksUnsupported("Lightning Address sends from Taproot Asset wallets are not yet supported") === true
);

console.log("\nhealth");
const health = await fetch(BASE + "/healthz");
const hj = await health.json();
check("healthz ok in mock", health.status === 200 && hj.ok === true, hj);
check("healthz send path is ready in mock", hj.checks.send && hj.checks.send.ok === true, hj.checks.send);
check(
  "healthz rate is a real BTC/USD figure, not the $1/n/a shortcut",
  hj.checks.rate.ok === true && hj.checks.rate.usdPerBtc === 100000 && hj.checks.rate.source === "static",
  hj.checks.rate
);
const cfgRate = await call("/api/config");
check("config exposes the same rate to Live UI", cfgRate.json.usdPerBtc === 100000, cfgRate.json);

console.log("\nstatic");
const index = await fetch(BASE + "/");
check("index served", index.status === 200 && (await index.text()).includes("__CASHIER__"));
const appjs = await fetch(BASE + "/app.js");
check("bundle served", appjs.status === 200);

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
process.exit(fail ? 1 : 0);
