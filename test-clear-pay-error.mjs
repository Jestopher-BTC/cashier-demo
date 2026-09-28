/* A failed cash out shows a top-of-stage error banner: the live "warning"
   event fired when the server rejects /withdraw. That banner must disappear
   once the visitor navigates to another screen, not survive the page change.
   Runs the booth shell (Live UI tab) and the core package as two child
   processes, since each needs its own server.js module instance. */

import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scenario = process.argv[2];
const HERE = fileURLToPath(new URL(".", import.meta.url));

if (!scenario) {
  const run = (pkg) =>
    spawnSync(process.execPath, [new URL(import.meta.url).pathname, pkg], { cwd: HERE, stdio: "inherit" });
  const booth = run("booth");
  const core = run("core");
  process.exit(booth.status || core.status ? 1 : 0);
}

process.env.MOCK_AMBOSS = "1";
process.env.OPERATOR_PIN = "";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.MAX_WITHDRAW_USD = "5";
process.env.PORT = scenario === "core" ? "8221" : "8220";
if (scenario === "core") process.env.CASHIER_PACKAGE = "core";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const BASE = `http://127.0.0.1:${process.env.PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

const click = (w, el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return sleep(ms); };
const type = (w, el, v) => {
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  set.call(el, v);
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  return sleep(80);
};
const btn = (d, label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);

/* Fund a session's balance straight through the server API so the test does
   not depend on the operator PIN / Fund flow. */
async function fundedSession(amountUsd) {
  const call = async (path, opts = {}) => {
    const res = await fetch(BASE + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const s = await call("/api/session", { method: "POST", body: {} });
  const sid = s.json.sessionId;
  /* Deposits are capped at $5 by default, so split a larger balance into
     several deposits under that cap. */
  let remaining = amountUsd;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 5);
    const dep = await call("/api/deposit", { method: "POST", body: { sessionId: sid, amountUsd: chunk } });
    await call("/api/dev/settle/all", { method: "POST", body: {} });
    await call(`/api/deposit/${dep.json.id}?s=${sid}`);
    remaining -= chunk;
  }
  const state = await call(`/api/state?s=${sid}`);
  if (state.json.balanceUsd !== amountUsd) throw new Error("setup: session was not funded: " + JSON.stringify(state.json));
  return sid;
}

await sleep(150);
const sid = await fundedSession(10);

const dom = await JSDOM.fromURL(BASE + "/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.localStorage.setItem("cashier.session", sid);
await sleep(scenario === "core" ? 1500 : 400);
if (scenario !== "core") await click(w, btn(d, "Live UI"), 1500);

console.log(`\n${scenario === "core" ? "core package" : "booth shell: Live UI tab"}`);

/* Cash out over the withdraw cap: the server rejects it, the live api fires
   a "warning" event, and the top banner appears. */
await click(w, btn(d, "Cash out"));
await type(w, d.querySelector(".phone input"), "$jestoph");
await click(w, btn(d, "Continue"));
await type(w, d.querySelector(".phone input"), "10");
await click(w, btn(d, "Review"));
await click(w, btn(d, "Send"), 700);

const noticeAfterFailure = d.querySelector(".livenotice");
check("failed cash out shows the live error banner", Boolean(noticeAfterFailure && /Cash outs run from/.test(noticeAfterFailure.textContent)), noticeAfterFailure && noticeAfterFailure.textContent);

const backToWallet = Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back");
await click(w, backToWallet, 300);

check("error banner is gone after returning to the wallet", !d.querySelector(".livenotice"), d.querySelector(".livenotice") && d.querySelector(".livenotice").textContent);

console.log(`\n${pass} passed, ${fail} failed\n`);
w.close();
server.close();
process.exit(fail ? 1 : 0);
