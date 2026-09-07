/* Booth polish: iOS keyboards, Amboss footer, and copy that belongs on the
   iPad kiosk. Does not re-test Fund PIN-every-click or the Live send path. */

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

console.log("\nfooter");
const foot = d.querySelector(".booth-foot");
const footLink = foot && foot.querySelector("a");
const footLogo = foot && foot.querySelector("svg");
const brandLogo = d.querySelector(".brand svg");
check("footer on mock", Boolean(foot));
check("footer copy", Boolean(foot && /Powered by Amboss Payments/.test(foot.textContent) && /amboss\.tech/.test(foot.textContent)), foot && foot.textContent);
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
check("amount inputmode decimal", amount && amount.inputMode === "decimal", amount && amount.inputMode);
check("deposit continue is 44px", minH(btn("Continue")) >= 44, minH(btn("Continue")));
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

console.log("\ndestination keyboard");
await click(btn("Cash out"));
const dest = d.querySelector(".phone input");
check("dest inputmode email", dest && dest.inputMode === "email", dest && dest.inputMode);
check("dest helper is short", txt().includes("Start a cashtag with $.") && !/Cash App is one of many/.test(txt()));
await type(dest, "lnbc1pw");
check("bolt11 inputmode text", dest.inputMode === "text", dest.inputMode);
await click(Array.from(d.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "Go back"));

console.log("\nlive pin + footer");
await click(btn("Live UI"), 1400);
check("footer stays on live", Boolean(d.querySelector(".booth-foot a")));
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
check("livebar wraps instead of crushing", /\.livebar\s*\{[^}]*flex-wrap:\s*wrap/.test(css));
check("meta takes its own row", /\.live-meta\s*\{[^}]*flex:\s*1 0 100%/.test(css));
check("actions take the next row", /\.live-actions\s*\{[^}]*flex:\s*1 0 100%/.test(css));
check("topbar three-slot layout is unchanged", Boolean(d.querySelector(".topbar-start") && d.querySelector(".modes") && d.querySelector(".topbar-end")));
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
