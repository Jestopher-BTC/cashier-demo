process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8182";
process.env.OPERATOR_PIN = "";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const BASE = "http://127.0.0.1:8182/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

await sleep(150);
const dom = await JSDOM.fromURL(BASE, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
w.prompt = () => "";
const errs = [];
w.addEventListener("error", (e) => errs.push(e.message));
await sleep(1500);

const txt = () => d.body.textContent;
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
const click = async (el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(ms); };
const type = async (el, v) => {
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(120);
};

console.log("\nchrome");
check("three modes", d.querySelectorAll(".mode").length === 3, d.querySelectorAll(".mode").length);
check("mock mode default", txt().includes("Withdrawable balance"));

console.log("\ncode view");
await click(btn("Code View"));
check("chips render", d.querySelectorAll(".chip").length >= 12, d.querySelectorAll(".chip").length);
const seam = Array.from(d.querySelectorAll(".chip")).find((c) => c.textContent === "SDK seams");
await click(seam);
check("seam section opens", d.querySelector(".note h2").textContent === "SDK seams");
check("seam code shown", d.querySelector(".codewrap").textContent.includes("createInvoice"));
check("line numbers", d.querySelector("td.ln").textContent.trim().length > 0);

console.log("\nlive mode");
await click(btn("Live UI"), 1200);
check("connected", txt().includes("LIVE"), txt().slice(0, 120));
check("balance starts at zero", txt().includes("$0.00"));
check("caps shown", /up to \$5 in/.test(txt()));

await click(btn("Deposit"));
check("deposit screen", txt().includes("How much do you want to add"));
await type(d.querySelector("input"), "3");
await click(btn("Continue"), 900);
check("real invoice returned", /lnbc\d+n1p/i.test(d.querySelector(".codewrap, .phone").textContent) || d.querySelectorAll("svg[role='img']").length > 0);
check(
  "QR rendered",
  d.querySelectorAll('svg[aria-label="Lightning invoice QR code"]').length === 1,
  "qr=" + d.querySelectorAll('svg[aria-label="Lightning invoice QR code"]').length + " img=" + d.querySelectorAll("svg[role='img']").length
);
check("amount in dollars", txt().includes("$3.00"));
check("sats hint present", /may show this as 3,000 sats/.test(txt()), txt().match(/may show[^.]*/));

await fetch("http://127.0.0.1:8182/api/dev/settle/all", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
await sleep(7000);
check("deposit credited in UI", txt().includes("$3.00 added"), txt().slice(0, 200));
await click(btn("Back to wallet"), 600);
check("balance updated from server", txt().includes("$3.00"), txt().slice(0, 160));

console.log("\nlive withdraw");
await click(btn("Cash out"));
await type(d.querySelector("input"), "$jestopher");
await click(btn("Continue"));
check("amount step", txt().includes("How much?"));
await type(d.querySelector("input"), "2");
await click(btn("Review"));
check("review shows destination", txt().includes("$jestopher"));
await click(btn("Send"), 3500);
check("sent", txt().includes("sent"), txt().slice(0, 200));

console.log("\nerrors:", errs.length ? errs : "none");
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close(); dom.window.close();
process.exit(fail ? 1 : 0);
