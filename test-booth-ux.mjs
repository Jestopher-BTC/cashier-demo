/* Booth polish: iOS keyboards, Amboss footer, and copy that belongs on the
   iPad kiosk. Does not re-test Fund PIN-every-click or the Live send path. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8191";
process.env.OPERATOR_PIN = "4242";
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
w.prompt = () => "";
await sleep(1400);

const txt = () => d.body.textContent;
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
const click = async (el, ms = 350) => { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(ms); };
const type = async (el, v) => {
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  set.call(el, v); el.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(80);
};
const minH = (el) => {
  if (!el) return 0;
  const style = el.getAttribute("style") || "";
  const m = /min-height:\s*(\d+)px/.exec(style);
  if (m) return Number(m[1]);
  const cs = w.getComputedStyle(el);
  return parseFloat(cs.minHeight) || parseFloat(cs.height) || 0;
};
const stylePx = (el, prop) => {
  if (!el) return 0;
  const style = el.getAttribute("style") || "";
  const kebab = prop.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const m = new RegExp(kebab + ":\\s*(\\d+)px").exec(style);
  if (m) return Number(m[1]);
  const cs = w.getComputedStyle(el);
  return parseFloat(cs[prop]) || 0;
};
const checkBalanceGap = (label) => {
  const actions = d.querySelector("[data-balance-actions]");
  const gap = stylePx(actions, "marginTop") + stylePx(actions, "paddingTop");
  check(label + " caption has room above Deposit / Cash out", gap >= 16, gap);
};
const checkPayStatus = (label) => {
  const row = d.querySelector("[data-pay-status]");
  const dot = d.querySelector("[data-pay-status-dot]");
  check(label + " status row present", Boolean(row && dot && /Waiting for payment/.test(row.textContent)));
  check(label + " status dot uses margin, not flex gap", stylePx(dot, "marginRight") >= 8, stylePx(dot, "marginRight"));
  check(label + " status row sits below Open in wallet", stylePx(row, "marginTop") >= 18, stylePx(row, "marginTop"));
  const payBack = d.querySelector('[aria-label="Go back"]');
  check(label + " pay-step back button keeps a horizontal gutter", stylePx(payBack, "marginRight") >= 12, stylePx(payBack, "marginRight"));
};

console.log("\nfooter");
const foot = d.querySelector(".booth-foot");
const footLink = foot && foot.querySelector("a");
const footLogo = foot && foot.querySelector("svg");
const brandLogo = d.querySelector(".brand svg");
check("footer on mock", Boolean(foot));
check("footer copy", Boolean(foot && /Powered by Amboss Payments/.test(foot.textContent) && /amboss\.tech/.test(foot.textContent)), foot && foot.textContent);
check("footer does not carry the tagline", Boolean(foot && !/Pay in Bitcoin, deal in dollars/.test(foot.textContent)), foot && foot.textContent);
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const footBuild = foot && foot.querySelector(".booth-foot-build");
check("footer shows git short SHA", Boolean(footBuild && footBuild.textContent.indexOf(sha) !== -1), footBuild && footBuild.textContent);
const css = d.documentElement.innerHTML;
const tagline = d.querySelector("[data-booth-tagline]");
check("tagline is under the modes bar", Boolean(tagline && tagline.previousElementSibling && tagline.previousElementSibling.classList.contains("topbar") && tagline.nextElementSibling && tagline.nextElementSibling.classList.contains("content")));
check("tagline copy", Boolean(tagline && tagline.textContent.trim() === "Pay in Bitcoin, deal in dollars."), tagline && tagline.textContent);
check("tagline is not inside the phone", Boolean(tagline && d.querySelector(".phone") && !d.querySelector(".phone").contains(tagline)));
check("mock app uses compact chrome class", Boolean(d.querySelector(".app.app-mock")));
check("mock tagline is prominent", /\.booth-tagline\s*\{[^}]*font-size:\s*24px/.test(css) && /\.booth-tagline\s*\{[^}]*font-weight:\s*800/.test(css) && /\.booth-tagline\s*\{[^}]*var\(--muted\)/.test(css) && !/\.booth-tagline\s*\{[^}]*border:/.test(css));
check("mock tagline is one line of copy", Boolean(tagline && tagline.childElementCount === 0 && !d.querySelector(".booth-tagline-sub")));
check("mock trims stage and phone gutters", /\.app-mock \.stage\s*\{[^}]*padding:\s*10px/.test(css) && /\.app-mock \.phone\s*\{[^}]*padding:\s*12px/.test(css));
check("landscape mock keeps QR above the fold", /max-height:\s*900px/.test(css) && /data-tx-list/.test(css) && /max-height:\s*156px/.test(css));
const buildRule = (css.match(/\.booth-foot p\.booth-foot-build\s*\{[^}]+\}/) || [])[0] || "";
check("footer build sits bottom right", /position:\s*absolute/.test(buildRule) && /right:/.test(buildRule) && /bottom:/.test(buildRule), buildRule);
check("footer build is faint", /font-size:\s*10px/.test(buildRule) && /var\(--faint\)/.test(buildRule) && /opacity:\s*0\.7/.test(buildRule), buildRule);
check("footer credit stays centered", /\.booth-foot\s*\{[^}]*text-align:\s*center/.test(css));
const offlineHtml = fs.readFileSync(new URL("./offline/cashier-offline.html", import.meta.url), "utf8");
check("offline bundle includes SHA", offlineHtml.indexOf(sha) !== -1);
check("footer link", Boolean(footLink && footLink.getAttribute("href") === "https://amboss.tech"), footLink && footLink.getAttribute("href"));
check("footer uses real Amboss wordmark", Boolean(footLogo && /640\.4/.test(footLogo.getAttribute("viewBox"))), footLogo && footLogo.getAttribute("viewBox"));
check("topbar uses Amboss letter mark", Boolean(brandLogo && /95\.7/.test(brandLogo.getAttribute("viewBox"))), brandLogo && brandLogo.getAttribute("viewBox"));
check("topbar label is short Cashier", Boolean(d.querySelector(".brand-text strong") && d.querySelector(".brand-text strong").textContent === "Cashier") && !d.querySelector(".brand-text em"));
check("handmade dollar glyph is gone", !d.querySelector(".glyph"));
check("viewport-fit cover", /viewport-fit=cover/.test(d.documentElement.innerHTML));
check("translucent status bar meta", /apple-mobile-web-app-status-bar-style/.test(d.documentElement.innerHTML));
check("theme-color meta", Boolean(d.querySelector('meta[name="theme-color"]')));
check("topbar clears status bar", /safe-area-inset-top/.test(d.documentElement.innerHTML));
check("footer clears home indicator", /safe-area-inset-bottom/.test(d.documentElement.innerHTML));
const topbarRule = (css.match(/\.topbar\s*\{[^}]+\}/) || [])[0] || "";
const modesRule = (css.match(/\.modes\s*\{[^}]+\}/) || [])[0] || "";
check("topbar is three flex slots", Boolean(d.querySelector(".topbar-start") && d.querySelector(".modes") && d.querySelector(".topbar-end")));
check("theme toggle sits in the end slot", Boolean(d.querySelector(".topbar-end .btn.icon")));
check("topbar uses flex not grid", /display:\s*flex/.test(topbarRule) && !/display:\s*grid|grid-template/.test(topbarRule), topbarRule);
check("modes stay on the row", /flex-shrink:\s*0/.test(modesRule) && /white-space:\s*nowrap/.test(modesRule), modesRule);
check("modes are not absolutely centered", !/position:\s*absolute/.test(modesRule), modesRule);
check("all three mode labels present", ["Mock UI", "Code View", "Live UI"].every((l) => Array.from(d.querySelectorAll(".mode")).some((b) => b.textContent.indexOf(l) === 0)));
check("side slots take leftover width", /\.topbar-start,\s*\.topbar-end\s*\{[^}]*flex:\s*1 1 0%/.test(css));
check("horizontal safe-area is on the side slots", /\.topbar-start\s*\{[^}]*safe-area-inset-left/.test(css) && /\.topbar-end\s*\{[^}]*safe-area-inset-right/.test(css));
check("no docs.amboss.tech hotlink", !/docs\.amboss\.tech/.test(d.documentElement.innerHTML));
check("sales note, not dry-run leftover", /iGaming/.test(txt()) && !/Nothing here touches a network/.test(txt()), txt().slice(0, 220));

console.log("\ntransaction row spacing + sample cashtag");
const txIcon = d.querySelector("[data-tx-icon]");
const txRow = d.querySelector("[data-tx-row]");
check("mock transaction rows present", Boolean(txIcon && txRow));
check("icon keeps 28px before the text", stylePx(txIcon, "marginRight") >= 28, stylePx(txIcon, "marginRight"));
check("row does not rely on flex gap for that space", Boolean(txRow && !/gap:\s*\d/.test(txRow.getAttribute("style") || "")), txRow && txRow.getAttribute("style"));
check("sample cashtag is $jestoph", txt().includes("$jestoph") && !txt().includes("$jestopher"), txt().match(/\$jestoph\w*/g));
check("mock has no staff section", !d.querySelector("[data-staff-section]"));
check("mock wallet is compact", d.querySelector("[data-wallet-compact='true']"));
const mockTxHeading = d.querySelector("[data-tx-heading]");
check("mock tightens tagline-to-balance and section gaps", stylePx(d.querySelector("[data-balance-caption]"), "marginTop") <= 6 && stylePx(mockTxHeading, "marginTop") <= 12 && stylePx(mockTxHeading, "marginBottom") <= 6, stylePx(mockTxHeading, "marginTop"));
check("mock txn rows keep the 28px arrow gutter", stylePx(txIcon, "marginRight") >= 28, stylePx(txIcon, "marginRight"));
const mockPhone = d.querySelector(".phone");
const mockWalletQr = d.querySelector("[data-discovery-qr]");
const mockCta = d.querySelector("[data-discovery-cta]");
check("mock wallet QR is outside the cashier card", Boolean(mockWalletQr && mockPhone && !mockPhone.contains(mockWalletQr)));
check(
  "mock wallet QR is a sibling below the card",
  Boolean(mockPhone && mockWalletQr && mockPhone.nextElementSibling === mockWalletQr),
  mockPhone && mockPhone.nextElementSibling && mockPhone.nextElementSibling.getAttribute("data-discovery-qr")
);
check(
  "mock wallet QR is the Calendly",
  Boolean(mockWalletQr && mockWalletQr.getAttribute("data-discovery-url") === "https://calendly.com/d/cwfn-s48-3b3/payments-discovery"),
  mockWalletQr && mockWalletQr.getAttribute("data-discovery-url")
);
check("mock wallet shows the bold sales CTA", Boolean(mockCta && mockCta.textContent.trim() === "Bring this payment UX to your platform!"), mockCta && mockCta.textContent);
check("mock wallet invite copy", /Scan to book a payments discovery meeting/.test(txt()));
check("mock discovery sits in its own box", Boolean(mockWalletQr && mockWalletQr.classList.contains("discovery-box")));
check("mock tightens card-to-QR gap", /\.app-mock \.discovery-box\s*\{[^}]*margin-top:\s*10px/.test(css));
check("mock transaction list is the compact target", Boolean(d.querySelector("[data-tx-list='mock']")));
const salesSrc = fs.readFileSync(new URL("./src/booth/booth-sales.js", import.meta.url), "utf8");
check("sales chrome is gated in booth-sales.js", /export const SHOW_DISCOVERY_CTA = true/.test(salesSrc) && /Bring this payment UX to your platform!/.test(salesSrc));

console.log("\nbalance + pay status spacing");
checkBalanceGap("mock");
await click(btn("Deposit"));
const backBar = d.querySelector("[data-back-bar]");
const backBtn = d.querySelector('[aria-label="Go back"]');
check("deposit amount has a back bar", Boolean(backBar && backBtn && /Deposit/.test(txt())));
check("deposit back button keeps a horizontal gutter", stylePx(backBtn, "marginRight") >= 12, stylePx(backBtn, "marginRight"));
check("back bar does not rely on flex gap", Boolean(backBar && !/gap:\s*\d/.test(backBar.getAttribute("style") || "")), backBar && backBar.getAttribute("style"));
check("back bar keeps space below the heading", stylePx(backBar, "marginBottom") >= 20, stylePx(backBar, "marginBottom"));
const firstAmount = d.querySelector(".phone input");
await type(firstAmount, "5");
await click(btn("Continue"), 900);
checkPayStatus("mock");
const demoBar = d.querySelector("[data-demo-bar]");
check("mock status has space above demo controls", Boolean(demoBar) && stylePx(demoBar, "marginTop") >= 22, demoBar && stylePx(demoBar, "marginTop"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

const logoRes = await fetch(BASE + "logo_gradient.svg");
const logoBody = await logoRes.text();
check("vendored wordmark is served", logoRes.ok && /viewBox="0 0 640\.4 84\.9"/.test(logoBody) && /#FF0080/.test(logoBody));
const letterRes = await fetch(BASE + "letter_gradient.svg");
const letterBody = await letterRes.text();
check("vendored letter is served", letterRes.ok && /viewBox="0 0 95\.7 84\.9"/.test(letterBody) && /#FF0080/.test(letterBody));
const letterBlack = await fetch(BASE + "letter_black.svg");
check("vendored letter black is served", letterBlack.ok && /viewBox="0 0 95\.7 84\.9"/.test(await letterBlack.text()));

console.log("\namount keyboard");
await click(btn("Deposit"));
const amount = d.querySelector(".phone input");
const amountPad = (el, label) => {
  check(label + " inputmode decimal", el && el.inputMode === "decimal", el && el.inputMode);
  check(label + " inputmode attr", el && el.getAttribute("inputmode") === "decimal", el && el.getAttribute("inputmode"));
  check(label + " pattern digit hint", el && el.getAttribute("pattern") === "[0-9]*", el && el.getAttribute("pattern"));
  check(label + " enterkeyhint done", el && (el.enterKeyHint === "done" || el.getAttribute("enterkeyhint") === "done"), el && (el.enterKeyHint || el.getAttribute("enterkeyhint")));
};
amountPad(amount, "deposit");
check("deposit continue is 44px", minH(btn("Continue")) >= 44, minH(btn("Continue")));
const presetLabels = Array.from(d.querySelectorAll(".phone button"))
  .map((b) => b.textContent.trim())
  .filter((t) => /^\$\d+$/.test(t));
check("deposit presets are $1 $5 $20 $100", presetLabels.join(" ") === "$1 $5 $20 $100", presetLabels.join(" "));
check("deposit presets drop $250", !presetLabels.includes("$250") && !presetLabels.includes("$25"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

console.log("\ndestination keyboard");
await click(btn("Cash out"));
const dest = d.querySelector(".phone input");
check("dest inputmode email", dest && dest.inputMode === "email", dest && dest.inputMode);
check("dest stays type text", dest && dest.type === "text", dest && dest.type);
check("dest helper is short", txt().includes("Start a cashtag with $.") && !/Cash App is one of many/.test(txt()));
await type(dest, "lnbc1pw");
check("bolt11 inputmode text", dest.inputMode === "text", dest.inputMode);
await type(d.querySelector(".phone input"), "$jestoph");
await click(btn("Continue"));
amountPad(d.querySelector(".phone input"), "cash out");
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

console.log("\ncash-out success conversion");
await click(btn("Cash out"));
await type(d.querySelector(".phone input"), "$jestoph");
await click(btn("Continue"));
await type(d.querySelector(".phone input"), "5");
await click(btn("Review"));
await click(btn("Send"), 2500);
const mockDiscovery = d.querySelector("[data-discovery-qr]");
const mockSuccess = d.querySelector("[data-success-card]");
check("mock success shows discovery QR", Boolean(mockDiscovery && d.querySelector('[aria-label="Payments discovery booking QR code"]')));
check(
  "mock discovery QR uses the Calendly constant",
  Boolean(mockDiscovery && mockDiscovery.getAttribute("data-discovery-url") === "https://calendly.com/d/cwfn-s48-3b3/payments-discovery"),
  mockDiscovery && mockDiscovery.getAttribute("data-discovery-url")
);
check("mock success invites a payments discovery meeting", /Scan to book a payments discovery meeting/.test(txt()));
check("mock success QR sits outside the success card", Boolean(mockSuccess && mockDiscovery && !mockSuccess.contains(mockDiscovery)));
check(
  "mock success QR is a sibling below the success card",
  Boolean(mockSuccess && mockSuccess.nextElementSibling === mockDiscovery)
);
const mockSuccessCta = d.querySelector("[data-discovery-cta]");
check(
  "mock success shows the sales CTA",
  Boolean(mockSuccessCta && mockSuccessCta.textContent.trim() === "Bring this payment UX to your platform!"),
  mockSuccessCta && mockSuccessCta.textContent
);
check(
  "mock success CTA sits in the discovery box, not the success card",
  Boolean(mockSuccess && mockDiscovery && mockSuccessCta && !mockSuccess.contains(mockSuccessCta) && mockDiscovery.contains(mockSuccessCta))
);
check("success screen does not own the tagline", Boolean(mockDiscovery && !mockDiscovery.querySelector("[data-booth-tagline]")));
check("tagline stays under the modes bar on success", Boolean(d.querySelector("[data-booth-tagline]") && d.querySelector("[data-booth-tagline]").previousElementSibling && d.querySelector("[data-booth-tagline]").previousElementSibling.classList.contains("topbar")));
await click(btn("Back to wallet"));

console.log("\nlive pin + footer");
await click(btn("Live UI"), 1400);
check("footer stays on live", Boolean(d.querySelector(".booth-foot a")));
check("live footer still shows SHA", Boolean(d.querySelector(".booth-foot-build") && d.querySelector(".booth-foot-build").textContent.indexOf(sha) !== -1));
check("live omits the tagline", !d.querySelector("[data-booth-tagline]"));
check("live does not use mock compact chrome", !d.querySelector(".app-mock"));
check("live wallet is not compact", !d.querySelector("[data-wallet-compact='true']"));
check("live wallet has no discovery QR", !d.querySelector("[data-discovery-qr]"));
check("live wallet has no sales CTA", !d.querySelector("[data-discovery-cta]"));
check("live note is booth copy", /Tap New visitor between demos/.test(txt()) && !/Real invoices, real payouts, real money/.test(txt()));
const livebar = d.querySelector(".livebar");
const liveMeta = livebar && livebar.querySelector(".live-meta");
const liveCap = livebar && livebar.querySelector(".live-cap");
check("livebar is visitor-facing meta only", Boolean(liveMeta) && !livebar.querySelector(".live-actions"));
check("status stays with the caps copy", Boolean(liveMeta && liveMeta.querySelector(".live-status") && liveMeta.querySelector(".live-caps")));
check("caps keep in/out as wrap units", Boolean(liveCap && /\$5 in/.test(liveCap.textContent)), liveCap && liveCap.textContent);
check("short caps copy is present", Boolean(livebar && livebar.querySelector(".live-caps-short") && /in\/out/.test(livebar.querySelector(".live-caps-short").textContent)));
check("Fund and New visitor are not in the live strip", Boolean(livebar && !/Fund/.test(livebar.textContent) && !/New visitor/.test(livebar.textContent) && !/Staff/.test(livebar.textContent)), livebar && livebar.textContent);
const staff = d.querySelector("[data-staff-section]");
check("staff sits below the transactions list", Boolean(staff && staff.previousElementSibling && !staff.previousElementSibling.querySelector("[data-balance-actions]")));
check("staff keeps its section gap", stylePx(staff, "marginTop") >= 22, stylePx(staff, "marginTop"));
const liveTxHeading = d.querySelector("[data-tx-heading]");
check("live keeps roomy section gaps", stylePx(liveTxHeading, "marginTop") >= 22 && stylePx(liveTxHeading, "marginBottom") >= 10, liveTxHeading && stylePx(liveTxHeading, "marginTop"));
check("live transaction list is not height-capped", !d.querySelector("[data-tx-list]"));
check("staff label marks Fund and New visitor", Boolean(staff && /^Staff/.test(staff.textContent.trim()) && /Fund/.test(staff.textContent) && /New visitor/.test(staff.textContent)), staff && staff.textContent);
check("staff is inside the phone, not the strip", Boolean(staff && livebar && !livebar.contains(staff) && d.querySelector(".phone") && d.querySelector(".phone").contains(staff)));
check("LIVE caps stay visitor-facing", Boolean(liveMeta && /LIVE/.test(liveMeta.textContent) && !/Staff/.test(liveMeta.textContent)));
check("livebar wraps instead of crushing", /\.livebar\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
check("short caps is the visible line", /\.live-caps-full\s*\{[^}]*display:\s*none/.test(css) && /\.live-caps-short\s*\{[^}]*display:\s*inline/.test(css));
check("caps line does not wrap mid-unit", /\.live-caps\s*\{[^}]*white-space:\s*nowrap/.test(css));
check("no leftover staff box styles in the strip", !/\.live-actions\s*\{/.test(css) && !/\.live-staff-label\s*\{/.test(css));
check("topbar three-slot layout is unchanged", Boolean(d.querySelector(".topbar-start") && d.querySelector(".modes") && d.querySelector(".topbar-end")));
await click(btn("Deposit"));
const liveBack = d.querySelector('[aria-label="Go back"]');
const liveBackBar = d.querySelector("[data-back-bar]");
check("live deposit back button keeps a horizontal gutter", stylePx(liveBack, "marginRight") >= 12, stylePx(liveBack, "marginRight"));
check("live deposit back bar does not rely on flex gap", Boolean(liveBackBar && !/gap:\s*\d/.test(liveBackBar.getAttribute("style") || "")));
amountPad(d.querySelector(".phone input"), "live deposit");
const livePresets = Array.from(d.querySelectorAll(".phone button"))
  .map((b) => b.textContent.trim())
  .filter((t) => /^\$\d+$/.test(t));
check("live deposit presets are $1 $5 $20 $100", livePresets.join(" ") === "$1 $5 $20 $100", livePresets.join(" "));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
checkBalanceGap("live");
await click(btn("Deposit"));
await type(d.querySelector(".phone input"), "5");
await click(btn("Continue"), 1200);
checkPayStatus("live");
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
await click(btn("Fund"), 400);
const pin = d.querySelector(".pin-input");
check("pin inputmode numeric", pin && pin.inputMode === "numeric", pin && pin.inputMode);
check("pin pattern digit pad", pin && pin.getAttribute("pattern") === "[0-9]*");
check("unlock is 44px", minH(Array.from(d.querySelectorAll("button")).find((b) => b.textContent.indexOf("Unlock") !== -1)) >= 44);

console.log("\ncode view hides footer");
await click(btn("Code View"), 400);
check("no footer on code view", !d.querySelector(".booth-foot"));
check("no tagline on code view", !d.querySelector("[data-booth-tagline]"));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
