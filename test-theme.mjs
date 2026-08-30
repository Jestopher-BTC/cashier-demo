/* The reported bug: page chrome flipped theme, the card inside did not. */
process.env.MOCK_AMBOSS = "1"; process.env.PORT = "8185";
const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* jsdom reports colours as rgb(), not the hex the components set. */
const DARK = "rgb(234, 240, 250)";
const LIGHT = "rgb(12, 22, 38)";
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };
await sleep(150);

const dom = await JSDOM.fromURL("http://127.0.0.1:8185/", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true });
const w = dom.window, d = w.document;
await sleep(1400);

const cardBg = () => {
  const el = d.querySelector(".phone > div > div");
  return el ? el.getAttribute("style") : "";
};
const balanceColor = () => {
  const el = Array.from(d.querySelectorAll("div")).find((x) => /^\$1,247\.85$/.test(x.textContent.trim()));
  return el ? (el.getAttribute("style") || "").match(/color:\s*([^;]+)/)?.[1] : null;
};

const darkText = balanceColor();
check("dark theme text colour", darkText === DARK, darkText);
check("page attribute is dark", d.documentElement.getAttribute("data-theme") === "dark");

const toggle = Array.from(d.querySelectorAll("button")).find((b) => b.className.includes("icon"));
toggle.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await sleep(400);

const lightText = balanceColor();
check("page attribute flipped", d.documentElement.getAttribute("data-theme") === "light");
check("card followed the page", lightText === LIGHT, lightText);
check("colours actually differ", darkText !== lightText, { darkText, lightText });

toggle.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await sleep(400);
check("and back again", balanceColor() === DARK, balanceColor());

/* Same check inside a flow, not just the wallet screen. */
const dep = Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim() === "Deposit");
dep.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await sleep(300);
toggle.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await sleep(300);
const heading = Array.from(d.querySelectorAll("div")).find((x) => x.textContent.trim() === "Deposit" && (x.getAttribute("style") || "").includes("color"));
check("mid-flow screens follow too", (heading.getAttribute("style") || "").includes(LIGHT), heading.getAttribute("style"));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close(); w.close();
process.exit(fail ? 1 : 0);
