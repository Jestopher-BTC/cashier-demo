/* Session persistence: a reload must not cost a visitor their balance. */
process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8184";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.OPERATOR_PIN = "";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

async function open(dom0) {
  const dom = await JSDOM.fromURL("http://127.0.0.1:8184/", {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    storageQuota: 1e6,
    cookieJar: dom0 ? dom0.cookieJar : undefined,
  });
  dom.window.prompt = () => "";
  await sleep(1400);
  return dom;
}

await sleep(150);

/* jsdom gives each document its own localStorage, so drive the api module the
   way the page does and assert the server side of the contract instead. */
const call = async (path, opts = {}) => {
  const res = await fetch("http://127.0.0.1:8184" + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

console.log("\nserver keeps the balance");
const s = await call("/api/session", { method: "POST", body: {} });
const sid = s.json.sessionId;
const cfg = await call("/api/config");
check("empty OPERATOR_PIN disables fund in config", cfg.json.fundEnabled === false && cfg.json.pinRequired === false, cfg.json);
const unfunded = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "" } });
check("fund refused when pin is unset", unfunded.status === 403 && /off/i.test(unfunded.json.error || ""), unfunded.json);
const stillEmpty = await call(`/api/state?s=${sid}`);
check("refused fund does not credit", stillEmpty.json.balanceUsd === 0, stillEmpty.json);
const dep = await call("/api/deposit", { method: "POST", body: { sessionId: sid, amountUsd: 4 } });
await call("/api/dev/settle/all", { method: "POST", body: {} });
await call(`/api/deposit/${dep.json.id}?s=${sid}`);
const before = await call(`/api/state?s=${sid}`);
check("deposit credited", before.json.balanceUsd === 4, before.json);

const again = await call(`/api/state?s=${sid}`);
check("same id still returns the balance", again.json.balanceUsd === 4, again.json);
check("history survives", again.json.transactions.length === 1);

const dead = await call("/api/state?s=s_madeup");
check("unknown id is refused, not silently emptied", dead.status === 409, dead.json);

console.log("\nbrowser resumes it");
const dom = await open();
const w = dom.window;
/* The page opens on Mock UI; a session only exists once Live mounts. */
const liveBtn = Array.from(w.document.querySelectorAll("button")).find((b) => b.textContent.indexOf("Live UI") === 0);
liveBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await sleep(1600);
check("session id written to localStorage", Boolean(w.localStorage.getItem("cashier.session")));
const storedId = w.localStorage.getItem("cashier.session");

const state = await call(`/api/state?s=${storedId}`);
check("stored id is a real server session", state.status === 200, state.json);

/* Simulate the reload: same storage, fresh document. */
const stored = w.localStorage.getItem("cashier.session");
dom.window.close();
const dom2 = await JSDOM.fromURL("http://127.0.0.1:8184/", {
  runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
});
dom2.window.localStorage.setItem("cashier.session", stored);
dom2.window.prompt = () => "";
await sleep(200);
const btn = Array.from(dom2.window.document.querySelectorAll("button")).find((b) => b.textContent.indexOf("Live UI") === 0);
btn.dispatchEvent(new dom2.window.MouseEvent("click", { bubbles: true }));
await sleep(1600);
check("resumed rather than replaced", dom2.window.localStorage.getItem("cashier.session") === stored,
  dom2.window.localStorage.getItem("cashier.session"));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close(); dom2.window.close();
process.exit(fail ? 1 : 0);
