/* Does this wallet pay a Lightning address?
 *
 * The published docs say Taproot Asset wallets cannot. The Amboss team says
 * that note is stale. This script settles it with one small real payment and
 * prints a report you can paste straight back to them.
 *
 *   node probe-address-payout.mjs --to you@getalby.com --usd 0.50
 *
 * It refuses to spend anything until you add --yes. Run it against a SANDBOX
 * environment first: sandbox settles without touching a node, which tells you
 * whether the API accepts the shape of the request, and a LIVE run then tells
 * you whether it actually routes.
 */

import { config, assertReady, money } from "./server/config.js";
import { amboss as liveAmboss } from "./server/amboss.js";
import { mockAmboss } from "./server/mock-amboss.js";
import { getRate } from "./server/store.js";

/* MOCK_AMBOSS=1 exercises the script itself without spending anything. */
const amboss = config.mock ? mockAmboss : liveAmboss;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes("--" + name);

const to = flag("to");
const usd = Number(flag("usd", "0.50"));
const armed = has("yes");

if (!to) {
  console.log("Usage: node probe-address-payout.mjs --to name@wallet.com [--usd 0.50] [--yes]");
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
  console.log(`"${to}" is not a Lightning address.`);
  process.exit(1);
}

assertReady();

const line = (k, v) => console.log("  " + k.padEnd(20) + v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\nAddress payout probe");
line("endpoint", config.graphqlUrl);
line("asset", config.asset + (config.asset === "BTC" ? " (base asset)" : " (Taproot Asset)"));
line("wallet", config.walletId || "(mock)");
line("destination", to);
line("amount", "$" + usd.toFixed(2));

const wallet = await amboss.wallet().catch((e) => ({ error: e.message }));
if (wallet.error) {
  console.log("\nCannot read the wallet: " + wallet.error);
  process.exit(1);
}
line("wallet ready", String(wallet.is_ready));
line("wallet balance", wallet.balance ? wallet.balance.balance + " minor units" : "unknown");

if (!armed) {
  console.log("\nDry run. Nothing was sent. Add --yes to spend real money.\n");
  process.exit(0);
}

const { usdPerBtc } = await getRate();
const amountMinor = money.usdToMinor(usd, usdPerBtc);
line("sending", amountMinor + " minor units");

const started = Date.now();
let tx;
let thrown = null;

try {
  tx = await amboss.sendAddress({
    lightningAddress: to,
    amountMinor,
    idempotencyKey: `probe-${Date.now()}`,
    metadata: { probe: "address-payout" },
  });
} catch (e) {
  thrown = e;
}

let final = tx;
if (tx && String(tx.status).toUpperCase() === "PENDING") {
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    final = await amboss.transaction(tx.id).catch((e) => ({ status: "UNKNOWN", error: e.message }));
    if (["COMPLETED", "FAILED"].includes(String(final.status).toUpperCase())) break;
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const status = thrown ? "REJECTED" : String(final.status || "UNKNOWN").toUpperCase();

console.log("\n" + "-".repeat(64));
console.log("Result: " + status + " after " + elapsed + "s");
if (thrown) console.log("Error:  " + thrown.message);
else {
  line("transaction", final.id);
  if (final.settle_amount) line("settled", final.settle_amount.full_amount + " minor units");
  if (final.exchange_rate) line("exchange rate", String(final.exchange_rate));
  if (final.error) line("failure reason", final.error);
}

console.log("\nPaste this to the Amboss team:\n");
console.log("```");
console.log("Lightning address send from a " + config.asset + " wallet");
console.log("  endpoint      " + config.graphqlUrl);
console.log("  wallet        " + config.walletId);
console.log("  destination   " + to);
console.log("  amount        " + amountMinor + " minor units ($" + usd.toFixed(2) + ")");
console.log("  result        " + status + " in " + elapsed + "s");
if (thrown) console.log("  message       " + thrown.message);
else if (final.error) console.log("  message       " + final.error);
console.log("");
console.log("docs.amboss.tech/payments/send-payments currently says:");
console.log('  "Lightning Address sends from Taproot Asset wallets are not yet supported."');
console.log(
  status === "COMPLETED"
    ? "That note looks stale for this wallet: the send completed."
    : status === "REJECTED"
      ? "The API rejected the request up front. See the message above."
      : "The send did not complete. See the message above."
);
console.log("```\n");

process.exit(status === "COMPLETED" ? 0 : 2);
