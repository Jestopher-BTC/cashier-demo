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
};

console.log("\nfooter");
const foot = d.querySelector(".booth-foot");
const footLink = foot && foot.querySelector("a");
const footLogo = foot && foot.querySelector("svg");
const brandLogo = d.querySelector(".brand svg");
check("footer on mock", Boolean(foot));
check("footer copy", Boolean(foot && /Powered by Amboss Payments/.test(foot.textContent) && /amboss\.tech/.test(foot.textContent)), foot && foot.textContent);
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const footBuild = foot && foot.querySelector(".booth-foot-build");
check("footer shows git short SHA", Boolean(footBuild && footBuild.textContent.indexOf(sha) !== -1), footBuild && footBuild.textContent);
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
const css = d.documentElement.innerHTML;
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

console.log("\nbalance + pay status spacing");
checkBalanceGap("mock");
await click(btn("Deposit"));
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
await type(d.querySelector(".phone input"), "$jestopher");
await click(btn("Continue"));
amountPad(d.querySelector(".phone input"), "cash out");
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

console.log("\nlive pin + footer");
await click(btn("Live UI"), 1400);
check("footer stays on live", Boolean(d.querySelector(".booth-foot a")));
check("live footer still shows SHA", Boolean(d.querySelector(".booth-foot-build") && d.querySelector(".booth-foot-build").textContent.indexOf(sha) !== -1));
check("live note is booth copy", /Tap New visitor between demos/.test(txt()) && !/Real invoices, real payouts, real money/.test(txt()));
const livebar = d.querySelector(".livebar");
const liveMeta = livebar && livebar.querySelector(".live-meta");
const liveActions = livebar && livebar.querySelector(".live-actions");
const liveCap = livebar && livebar.querySelector(".live-cap");
check("livebar splits meta and actions", Boolean(liveMeta && liveActions));
check("status stays with the caps copy", Boolean(liveMeta && liveMeta.querySelector(".live-status") && liveMeta.querySelector(".live-caps")));
check("caps keep in/out as wrap units", Boolean(liveCap && /\$5 in/.test(liveCap.textContent)), liveCap && liveCap.textContent);
check("short caps copy is present", Boolean(livebar && livebar.querySelector(".live-caps-short") && /in\/out/.test(livebar.querySelector(".live-caps-short").textContent)));
check("Fund and New visitor sit in the action row", Boolean(liveActions && /Fund/.test(liveActions.textContent) && /New visitor/.test(liveActions.textContent)));
const staffLabel = liveActions && liveActions.querySelector(".live-staff-label");
check("staff label marks Fund and New visitor", Boolean(staffLabel && staffLabel.textContent.trim() === "Staff"));
check("staff controls sit in a soft panel", /\.live-actions\s*\{[^}]*background:\s*var\(--bg\)/.test(css) && /\.live-actions\s*\{[^}]*border-radius:\s*10px/.test(css));
check("LIVE caps stay visitor-facing", Boolean(liveMeta && /LIVE/.test(liveMeta.textContent) && !/Staff/.test(liveMeta.textContent)));
check("livebar wraps instead of crushing", /\.livebar\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
check("short caps is the visible line", /\.live-caps-full\s*\{[^}]*display:\s*none/.test(css) && /\.live-caps-short\s*\{[^}]*display:\s*inline/.test(css));
check("caps line does not wrap mid-unit", /\.live-caps\s*\{[^}]*white-space:\s*nowrap/.test(css));
check("gap between caps and Fund", /\.live-meta\s*\{[^}]*margin:[^}]*16px/.test(css));
check("meta does not shrink into the buttons", /\.live-meta\s*\{[^}]*flex:\s*1 0 auto/.test(css));
check("actions do not shrink into the copy", /\.live-actions\s*\{[^}]*flex:\s*0 0 auto/.test(css));
check("topbar three-slot layout is unchanged", Boolean(d.querySelector(".topbar-start") && d.querySelector(".modes") && d.querySelector(".topbar-end")));
await click(btn("Deposit"));
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

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
w.close();
process.exit(fail ? 1 : 0);
