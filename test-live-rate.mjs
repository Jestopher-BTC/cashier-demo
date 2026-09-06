/* Hits a public spot API to prove getInvoiceUsdRate() returns a real BTC/USD
   figure on a USDT wallet, while getRate() keeps the dollar-settlement shortcut. */

process.env.MOCK_AMBOSS = "1";
process.env.AMBOSS_ASSET = "USDT";
process.env.RATE_SOURCE = "live";

const { getRate, getInvoiceUsdRate, isUsableBtcRate } = await import("./server/store.js");

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

console.log("\nlive BTC/USD rate on a USDT wallet");

const shortcut = await getRate();
check("getRate still returns the dollar-settlement shortcut", shortcut.usdPerBtc === 1 && shortcut.source === "n/a", shortcut);

const rate = await getInvoiceUsdRate();
check("getInvoiceUsdRate is a usable market rate", isUsableBtcRate(rate), rate);
check("source is a real feed, not n/a", rate.source === "coinbase" || rate.source === "coingecko" || rate.source === "stale", rate);
check("price is in a booth-plausible band", rate.usdPerBtc > 10000 && rate.usdPerBtc < 1000000, rate);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
