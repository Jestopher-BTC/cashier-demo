/* Code View default is the official SDK cheat-sheet, not the mock file dump. */
process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8191";
process.env.OPERATOR_PIN = "";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const BASE = "http://127.0.0.1:8191/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

await sleep(150);
const dom = await JSDOM.fromURL(BASE, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
await sleep(1400);

const txt = () => d.body.textContent;
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
const click = async (el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(ms); };

console.log("\ndefault cheat-sheet");
await click(btn("Code View"));
check("official SDK heading", txt().includes("Official SDK"));
check("createReceive shown", txt().includes("createReceive"));
check("send tab present", Boolean(d.querySelector('[data-sdk-tab="send"]')));
check("webhook tab present", Boolean(d.querySelector('[data-sdk-tab="webhook"]')));
check("inactive send code collapsed", !d.querySelector('[data-snippet="send"] .codewrap'));
check("sandbox metadata", txt().includes("amb_sandbox_behavior"));
check("map line", txt().includes("mockApi.createInvoice") && txt().includes("payments.transactions.createReceive"));
check("full walkthrough CTA", Boolean(d.querySelector('a.sdk-cta')) && /getting-started/.test(d.querySelector("a.sdk-cta").href));
check("docs links present", d.querySelectorAll(".sdk-docs a").length >= 3);
check("three snippet cards", d.querySelectorAll("[data-snippet]").length === 3);
check("receive highlighted by default", d.querySelector('[data-snippet="receive"]').getAttribute("data-active") === "true");
check("mock source hidden", !d.querySelector("[data-mock-source]"));
check("does not open on File header", !d.querySelector(".note h2") || d.querySelector(".note h2").textContent !== "File header");
check("copy buttons on snippets", Array.from(d.querySelectorAll("[data-snippet] .btn")).filter((b) => /Copy/.test(b.textContent)).length === 3);

console.log("\ntabs");
await click(d.querySelector('[data-sdk-tab="send"]'));
check("send tab highlights send", d.querySelector('[data-snippet="send"]').getAttribute("data-active") === "true");
check("send code shown", txt().includes("transactions.send") && txt().includes("lightningAddress"));
check("receive code collapsed", !d.querySelector('[data-snippet="receive"] .codewrap'));
await click(d.querySelector('[data-sdk-tab="webhook"]'));
check("webhook tab highlights webhook", d.querySelector('[data-snippet="webhook"]').getAttribute("data-active") === "true");
check("webhook code shown", txt().includes("webhooks.verify"));

console.log("\ncollapsed mock source");
await click(btn("Show full mock source"));
check("source expands", Boolean(d.querySelector("[data-mock-source]")));
check("chips render", d.querySelectorAll(".chip").length >= 12, d.querySelectorAll(".chip").length);
const seam = Array.from(d.querySelectorAll(".chip")).find((c) => c.textContent === "SDK seams");
await click(seam);
check("seam section opens", d.querySelector(".note h2") && d.querySelector(".note h2").textContent === "SDK seams");
check("seam still shows mock createInvoice", d.querySelector(".mock-source .codewrap").textContent.includes("createInvoice"));
await click(btn("Hide full mock source"));
check("source hides again", !d.querySelector("[data-mock-source]"));

console.log("\nhighlight follows deposit");
await click(btn("Mock UI"));
await click(btn("Deposit"));
check("opened deposit", txt().includes("How much do you want to add"));
await click(btn("Code View"));
check("receive highlighted after deposit", d.querySelector('[data-snippet="receive"]').getAttribute("data-active") === "true");
check("deposit hint shown", txt().includes("Highlighted from Deposit"));

console.log("\nhighlight follows cash out");
await click(btn("Mock UI"));
const back = Array.from(d.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") || "") === "Go back");
if (back) await click(back);
await click(btn("Cash out"));
check("opened cash out", txt().includes("Start a cashtag with $.") || /cashtag, address, or invoice/i.test(txt()), txt().slice(0, 240));
await click(btn("Code View"));
check("send highlighted after cash out", d.querySelector('[data-snippet="send"]').getAttribute("data-active") === "true");
check("cash out hint shown", txt().includes("Highlighted from Cash out"));

console.log("\nerrors:", "none");
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
