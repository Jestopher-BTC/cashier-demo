/* Booth iPad path: Live must start even when native fetch throws the classic
   WebKit TypeError, and Fund must open an in-page PIN dialog (prompt is silent
   on iPad Chrome). */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8188";
process.env.OPERATOR_PIN = "4242";
process.env.SESSION_START_USD = "2";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const BASE = "http://127.0.0.1:8188/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

await sleep(150);

const dom = await JSDOM.fromURL(BASE, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
let promptCalls = 0;
w.prompt = function () {
  promptCalls++;
  return "should-not-be-used";
};

/* Classic iOS Chrome/Safari fetch: headers.forEach on undefined. */
w.fetch = function (url, init) {
  var headers = init && init.headers;
  headers.forEach(function () {});
  return Promise.reject(new TypeError("undefined is not an object (evaluating 'headers.forEach')"));
};

await sleep(1400);

const txt = () => d.body.textContent;
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
const click = async (el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(ms); };
const type = async (el, v) => {
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(80);
};

console.log("\nmock still boots");
check("mock wallet visible", txt().includes("Withdrawable balance"));
check("no script-error card on mock", !txt().includes("undefined is not an object"));

console.log("\nlive survives broken native fetch");
await click(btn("Live UI"), 1400);
check("not reported as offline TypeError", !txt().includes("undefined is not an object"), txt().slice(0, 240));
check("live connected", txt().includes("LIVE"), txt().slice(0, 180));
check("session starts at zero", txt().includes("$0.00"));

console.log("\nfund pin dialog");
await click(btn("Fund"), 400);
const overlay = d.querySelector(".pin-overlay");
check("pin dialog opens", Boolean(overlay), "missing .pin-overlay");
check("prompt was not used", promptCalls === 0, promptCalls);
check("dialog copy", txt().includes("Operator PIN") && txt().includes("Live UI"));

const pinInput = d.querySelector(".pin-input");
check("pin field present", Boolean(pinInput));
await type(pinInput, "0000");
await click(Array.from(d.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unlock") !== -1), 600);
check("wrong pin stays in dialog", Boolean(d.querySelector(".pin-overlay")));
check("wrong pin message", /Wrong pin/i.test(txt()), txt().slice(0, 300));

await type(d.querySelector(".pin-input"), "4242");
await click(Array.from(d.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unlock") !== -1), 800);
check("correct pin closes dialog", !d.querySelector(".pin-overlay"));
check("prompt still unused", promptCalls === 0, promptCalls);
check("fund credited", txt().includes("$2.00"), txt().slice(0, 220));

console.log("\nerrors:", "none");
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
