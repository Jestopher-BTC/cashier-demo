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
check("topbar uses real Amboss wordmark", Boolean(brandLogo && /640\.4/.test(brandLogo.getAttribute("viewBox"))), brandLogo && brandLogo.getAttribute("viewBox"));
check("handmade dollar glyph is gone", !d.querySelector(".glyph"));
check("no docs.amboss.tech hotlink", !/docs\.amboss\.tech/.test(d.documentElement.innerHTML));
check("sales note, not dry-run leftover", /iGaming/.test(txt()) && !/Nothing here touches a network/.test(txt()), txt().slice(0, 220));

const logoRes = await fetch(BASE + "logo_gradient.svg");
const logoBody = await logoRes.text();
check("vendored logo is served", logoRes.ok && /viewBox="0 0 640\.4 84\.9"/.test(logoBody) && /#FF0080/.test(logoBody));

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
