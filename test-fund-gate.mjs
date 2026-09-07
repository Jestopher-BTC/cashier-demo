/* FUND_ENABLED=0 with a PIN still set must disable Fund. Blank PIN is covered
   by test-session / test-browser. This file is the explicit kill-switch. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8194";
process.env.OPERATOR_PIN = "4242";
process.env.FUND_ENABLED = "0";
process.env.SESSION_START_USD = "2";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const { parseFundEnabledFlag, resolveFundEnabled } = await import("./server/config.js");

const BASE = "http://127.0.0.1:8194";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

await sleep(150);

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

console.log("\nkill switch with PIN still set");
check("0 parses as off", parseFundEnabledFlag("0") === false);
check("false parses as off", parseFundEnabledFlag("false") === false);
check("no parses as off", parseFundEnabledFlag("NO") === false);
check("unset parses as on", parseFundEnabledFlag(undefined) === true);
check("flag off beats a set pin", resolveFundEnabled("4242", false) === false);

const cfg = await call("/api/config");
check("config reports fund disabled", cfg.json.fundEnabled === false && cfg.json.pinRequired === false, cfg.json);

const s = await call("/api/session", { method: "POST", body: {} });
const sid = s.json.sessionId;
const withPin = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "4242" } });
check("correct pin still refused", withPin.status === 403 && /off/i.test(withPin.json.error || ""), withPin.json);
const empty = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "" } });
check("empty pin refused", empty.status === 403, empty.json);
const state = await call(`/api/state?s=${sid}`);
check("no float credited", state.json.balanceUsd === 0, state.json);

console.log("\nlive Fund button is grayed out");
const dom = await JSDOM.fromURL(BASE + "/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
const click = async (el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(ms); };
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
await sleep(1400);
await click(btn("Live UI"), 1400);
const fundBtn = d.querySelector("[data-fund]") || btn("Fund");
check("Fund is disabled", Boolean(fundBtn && fundBtn.disabled), fundBtn && fundBtn.disabled);
check("Fund is aria-disabled", Boolean(fundBtn && fundBtn.getAttribute("aria-disabled") === "true"));
await click(fundBtn, 400);
check("no pin dialog", !d.querySelector(".pin-overlay"));
check("balance stays zero", /\$0\.00/.test(d.body.textContent) && !/\$2\.00/.test(d.body.textContent));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
