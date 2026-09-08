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
check("mock mode default", txt().includes("Account balance"));
const mockTagline = d.querySelector("[data-booth-tagline]");
check("mock tagline is under the modes bar", Boolean(mockTagline && mockTagline.previousElementSibling && mockTagline.previousElementSibling.classList.contains("topbar")));
check("mock tagline copy", Boolean(mockTagline && mockTagline.textContent.trim() === "Pay in Bitcoin, deal in dollars."));
check("mock tagline is louder", /\.booth-tagline\s*\{[^}]*font-size:\s*24px/.test(d.documentElement.innerHTML) && /\.booth-tagline\s*\{[^}]*font-weight:\s*800/.test(d.documentElement.innerHTML));
check("mock compact chrome class", Boolean(d.querySelector(".app.app-mock")));
const mockWalletQr = d.querySelector("[data-discovery-qr]");
const mockPhone = d.querySelector(".phone");
check("mock wallet shows discovery QR", Boolean(mockWalletQr && /Scan to book a payments discovery meeting/.test(txt())));
check("mock wallet QR is outside the cashier card", Boolean(mockWalletQr && mockPhone && !mockPhone.contains(mockWalletQr)));
check(
  "mock wallet QR is the Calendly",
  Boolean(mockWalletQr && mockWalletQr.getAttribute("data-discovery-url") === "https://calendly.com/d/cwfn-s48-3b3/payments-discovery")
);
check("mock wallet shows the bold sales CTA", /Bring this payment UX to your platform!/.test(txt()));

console.log("\nmock cash out scan");
await click(btn("Cash out"));
check("destination field", Boolean(d.querySelector("input")));
const scanBtn = d.querySelector('[aria-label="Scan a code"]');
check("scan button present", Boolean(scanBtn));
/* Booth iPad / A2HS: permission blocked often arrives as NotFoundError plus
   an empty device list. That must not become "No camera on this device". */
w.navigator.mediaDevices = w.navigator.mediaDevices || {};
let gumCalls = 0;
w.navigator.mediaDevices.getUserMedia = function () {
  gumCalls++;
  const err = new w.Error("Requested device not found");
  err.name = "NotFoundError";
  return Promise.reject(err);
};
w.navigator.mediaDevices.enumerateDevices = function () {
  return Promise.resolve([]);
};
await click(scanBtn, 2700);
const sheet = d.querySelector(".amb-scan-sheet");
check("scanner overlay stays open", Boolean(d.querySelector('[role="dialog"][aria-label="Scan a code"]')));
check("scanner is an opaque sheet", Boolean(sheet) && sheet.getAttribute("data-scan-sheet") === "1", sheet && sheet.getAttribute("class"));
const sheetStyle = (sheet && sheet.getAttribute("style")) || "";
check(
  "sheet background is opaque",
  /background:\s*(#070C17|rgb\(\s*7,\s*12,\s*23\s*\))/.test(sheetStyle) && !/rgba\s*\(/i.test(sheetStyle),
  sheetStyle
);
check("recent cashtag is not under the sheet", !txt().includes("$jestoph"), txt().slice(0, 280));
check("scanner does not auto-pick a destination", txt().includes("Scan a code") && !txt().includes("How much?"), txt().slice(0, 240));
check(
  "camera state is visible",
  /Allow camera|Starting camera|Point the camera|Settings|HTTPS|Tap Allow camera/i.test(txt()),
  txt().slice(0, 300)
);
check("blocked camera is Settings, not 'no device'", /Allow camera in Settings/.test(txt()) && !/No camera on this device/i.test(txt()), txt().slice(0, 300));
check("scan tap requested the camera", gumCalls >= 1, gumCalls);
const allowBtn = Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim() === "Allow camera");
check("allow camera retry is offered", Boolean(allowBtn));
const gumBeforeRetry = gumCalls;
await click(allowBtn, 600);
check("allow camera re-requests getUserMedia", gumCalls > gumBeforeRetry, gumCalls + " after " + gumBeforeRetry);
const sampleToggle = Array.from(d.querySelectorAll("button")).find((b) => /sample code/i.test(b.textContent));
check("sample fallback present", Boolean(sampleToggle));
check(
  "helper sits below the viewfinder",
  Boolean(d.querySelector("[data-scan-helper]") && d.querySelector("[data-scan-viewfinder]") && d.querySelector("[data-scan-helper]").previousElementSibling === d.querySelector("[data-scan-viewfinder]"))
);
await click(sampleToggle);
const samples = d.querySelector("[data-scan-samples]");
const helper = d.querySelector("[data-scan-helper]");
check("sample codes listed", txt().includes("A cashtag") && txt().includes("$jestoph"));
check("sample cashtag is $jestoph, not $jestopher", txt().includes("$jestoph") && !txt().includes("$jestopher"));
check("samples replace the viewfinder", Boolean(samples) && !d.querySelector("[data-scan-viewfinder]"));
check("helper is not inside the sample list", Boolean(helper && samples && helper.previousElementSibling === samples));
check("back to camera copy", /Back to camera/.test(txt()));
await click(Array.from(d.querySelectorAll("button")).find((b) => /A cashtag/i.test(b.textContent)));
check("sample cashtag accepted", txt().includes("How much?"));
await click(d.querySelector('[aria-label="Go back"]'));
await type(d.querySelector("input"), "$jestoph");
check("typed cashtag still works", /You choose the amount next/.test(txt()), txt().slice(0, 220));
d.querySelector("input").focus();
d.querySelector("input").dispatchEvent(new w.Event("paste", { bubbles: true }));
check("paste field still accepts a cashtag", d.querySelector("input").value === "$jestoph");
await click(d.querySelector('[aria-label="Go back"]'));
check("back at wallet", txt().includes("Account balance"));

console.log("\ncode view");
await click(btn("Code View"));
check("sdk cheat sheet", txt().includes("createReceive") && txt().includes("Official SDK"));
check("sandbox callout", txt().includes("amb_sandbox_behavior"));
check("walkthrough CTA", Boolean(d.querySelector("a.sdk-cta")));
check("mock source collapsed", !d.querySelector("[data-mock-source]"));
await click(btn("Show full mock source"));
check("chips render", d.querySelectorAll(".chip").length >= 12, d.querySelectorAll(".chip").length);
const seam = Array.from(d.querySelectorAll(".chip")).find((c) => c.textContent === "SDK seams");
await click(seam);
check("seam section opens", d.querySelector(".note h2").textContent === "SDK seams");
check("seam code shown", d.querySelector(".mock-source .codewrap").textContent.includes("createInvoice"));
check("line numbers", d.querySelector("td.ln").textContent.trim().length > 0);

console.log("\nlive mode");
await click(btn("Live UI"), 1200);
check("connected", txt().includes("LIVE"), txt().slice(0, 120));
check("balance starts at zero", txt().includes("$0.00"));
check("caps shown", /up to \$5 in/.test(txt()));
check("live omits the tagline", !d.querySelector("[data-booth-tagline]"));
check("live does not use mock compact chrome", !d.querySelector(".app-mock"));
check("live wallet has no discovery QR", !d.querySelector("[data-discovery-qr]"));
const fundBtn = d.querySelector("[data-fund]") || btn("Fund");
const newVisitorBtn = btn("New visitor");
const fundStyle = (fundBtn && fundBtn.getAttribute("style")) || "";
check("empty pin grays out Fund", Boolean(fundBtn && fundBtn.disabled), fundBtn && fundBtn.disabled);
check("empty pin Fund is not clickable", Boolean(fundBtn && fundBtn.getAttribute("aria-disabled") === "true"));
check("empty pin Fund uses muted disabled paint", /not-allowed/.test(fundStyle) && /pointer-events:\s*none/.test(fundStyle), fundStyle);
check("New visitor stays enabled", Boolean(newVisitorBtn && !newVisitorBtn.disabled));
await click(fundBtn, 400);
check("empty pin does not open pin dialog", !d.querySelector(".pin-overlay"));
check("empty pin does not grant float", txt().includes("$0.00") && !txt().includes("$2.00"), txt().slice(0, 220));

await click(btn("Deposit"));
check("deposit screen", txt().includes("How much do you want credited to your account"));
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
check("deposit credited in UI", txt().includes("$3.00 added") && txt().includes("Credited to your account. Ready to play."), txt().slice(0, 200));
await click(btn("Back to wallet"), 600);
check("balance updated from server", txt().includes("$3.00"), txt().slice(0, 160));
const liveIcon = d.querySelector("[data-tx-icon]");
const liveIconStyle = (liveIcon && liveIcon.getAttribute("style")) || "";
check("live tx icon keeps 28px before the text", /margin-right:\s*28px/.test(liveIconStyle), liveIconStyle);
check("live staff section is on the wallet", Boolean(d.querySelector("[data-staff-section]")));
check("live strip still has no Fund button", Boolean(d.querySelector(".livebar") && !/Fund/.test(d.querySelector(".livebar").textContent)));

console.log("\nlive withdraw");
await click(btn("Cash out"));
const liveScan = d.querySelector('[aria-label="Scan a code"]');
check("live scan button", Boolean(liveScan));
await click(liveScan, 900);
check("live scanner is the same opaque sheet", Boolean(d.querySelector(".amb-scan-sheet")) && !txt().includes("$jestoph"), txt().slice(0, 240));
await click(d.querySelector('[aria-label="Close scanner"]'));
check("live paste field returns", Boolean(d.querySelector("input")));
await type(d.querySelector("input"), "$jestoph");
await click(btn("Continue"));
check("amount step", txt().includes("How much?"));
await type(d.querySelector("input"), "2");
await click(btn("Review"));
check("review shows destination", txt().includes("$jestoph"));
await click(btn("Send"), 3500);
check("paid out", txt().includes("paid out from your account"), txt().slice(0, 200));
const discovery = d.querySelector("[data-discovery-qr]");
const successCard = d.querySelector("[data-success-card]");
check("cash-out success shows discovery QR", Boolean(discovery && d.querySelector('[aria-label="Payments discovery booking QR code"]')));
check(
  "discovery QR is the Amboss Calendly",
  Boolean(discovery && discovery.getAttribute("data-discovery-url") === "https://calendly.com/d/cwfn-s48-3b3/payments-discovery"),
  discovery && discovery.getAttribute("data-discovery-url")
);
check("discovery invite copy", /Scan to book a payments discovery meeting/.test(txt()));
check("success QR sits outside the success card", Boolean(successCard && discovery && !successCard.contains(discovery)));
check("success QR is a sibling below the success card", Boolean(successCard && successCard.nextElementSibling === discovery));
const liveSuccessCta = d.querySelector("[data-discovery-cta]");
check(
  "live success shows the sales CTA",
  Boolean(liveSuccessCta && liveSuccessCta.textContent.trim() === "Bring this payment UX to your platform!"),
  liveSuccessCta && liveSuccessCta.textContent
);
check(
  "live success CTA sits in the discovery box, not the success card",
  Boolean(successCard && discovery && liveSuccessCta && !successCard.contains(liveSuccessCta) && discovery.contains(liveSuccessCta))
);
check("success screen does not own the tagline", Boolean(discovery && !discovery.querySelector("[data-booth-tagline]")));
check("live still omits the tagline on success", !d.querySelector("[data-booth-tagline]"));

console.log("\nerrors:", errs.length ? errs : "none");
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close(); dom.window.close();
process.exit(fail ? 1 : 0);
