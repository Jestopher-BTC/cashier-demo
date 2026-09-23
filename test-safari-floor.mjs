/* Safari 10 / WebKit 603 floor.
   The hosted cashier used to stay a dark empty page: the bundle parsed, then
   regenerator-runtime's strict-mode assignment fell through to Function(),
   which CSP script-src 'self' blocks. getUserMedia is not part of the floor. */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import parser from "@babel/parser";
import traverse from "@babel/traverse";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

const NON_ES5 = new Set([
  "ArrowFunctionExpression",
  "ClassDeclaration",
  "ClassExpression",
  "ClassBody",
  "ClassMethod",
  "ClassProperty",
  "ClassPrivateProperty",
  "ForOfStatement",
  "TemplateLiteral",
  "TaggedTemplateExpression",
  "AwaitExpression",
  "YieldExpression",
  "OptionalMemberExpression",
  "OptionalCallExpression",
  "ObjectMethod",
  "ObjectPattern",
  "ArrayPattern",
  "SpreadElement",
  "RestElement",
  "AssignmentPattern",
  "ChainExpression",
  "PrivateName",
  "MetaProperty",
  "ImportExpression",
  "StaticBlock",
]);

function syntaxFloor(label, rel) {
  const code = read(rel);
  const ast = parser.parse(code, { sourceType: "script", tokens: true });
  const bad = [];
  traverse.default(ast, {
    enter(p) {
      if (NON_ES5.has(p.node.type) && bad.length < 5) bad.push(p.node.type);
    },
  });
  const opt = (ast.tokens || []).filter((t) => t.value === "?." || t.value === "??");
  check(label + " bundle is ES5 (no ?. / ?? / classes / arrows)", bad.length === 0 && opt.length === 0, bad.concat(opt.map((t) => t.value)).join(","));
  check(
    label + " declares regeneratorRuntime in the strict prelude",
    code.startsWith('"use strict";var regeneratorRuntime;'),
    code.slice(0, 80)
  );
  check(label + " installs an empty-root boot error", code.includes('getElementById("boot-error")'));
  const epi = code.match(
    /try\{regeneratorRuntime=([A-Za-z0-9_$]+)\}catch\(([A-Za-z0-9_$]+)\)\{typeof globalThis=="object"\?globalThis\.regeneratorRuntime=\1:Function\("r","regeneratorRuntime = r"\)\(\1\)\}/
  );
  check(label + " still has the regenerator epilogue", Boolean(epi));
  if (!epi) return;
  const stmt = epi[0].replace(new RegExp("\\b" + epi[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), "runtimeValue");
  const probe = `"use strict";var regeneratorRuntime;var globalThis=void 0;var Function=function(){throw new Error("CSP blocked Function");};var runtimeValue={ok:1};${stmt};if(!regeneratorRuntime||!regeneratorRuntime.ok)throw new Error("unset");"set";`;
  let result = "";
  try {
    result = vm.runInNewContext(probe, {});
  } catch (e) {
    result = "THREW " + e.message;
  }
  check(label + " boots without globalThis and without Function()", result === "set", result);
}

function verdictOf(htmlRel, jsRel, opts) {
  return import("jsdom").then(({ JSDOM }) => {
    const dom = new JSDOM(read(htmlRel), {
      url: "https://cashier.example/check.html",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    });
    const w = dom.window;
    if (opts.promise === false) w.Promise = undefined;
    w.CSS = {
      supports: function (prop, value) {
        if (prop === "display" && value === "grid") return opts.grid !== false;
        if (prop === "display" && value === "flex") return opts.flex !== false;
        if (prop === "gap") return false;
        if (prop === "inset") return false;
        if (prop === "position") return false;
        return false;
      },
    };
    if (opts.gum === false) {
      try {
        Object.defineProperty(w.navigator, "mediaDevices", { configurable: true, value: undefined });
      } catch (e) {
        w.navigator.mediaDevices = undefined;
      }
      w.navigator.getUserMedia = undefined;
      w.navigator.webkitGetUserMedia = undefined;
    } else {
      w.navigator.mediaDevices = {
        getUserMedia: function () {
          return w.Promise.resolve({});
        },
      };
    }
    w.eval(read(jsRel));
    const text = w.document.getElementById("verdict").textContent.replace(/\s+/g, " ").trim();
    const helpHidden = w.document.getElementById("static-help").style.display === "none";
    w.close();
    return { text, helpHidden };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripCamera(w) {
  try {
    Object.defineProperty(w.navigator, "mediaDevices", { configurable: true, value: undefined });
  } catch (e) {
    w.navigator.mediaDevices = undefined;
  }
  w.navigator.getUserMedia = undefined;
  w.navigator.webkitGetUserMedia = undefined;
}

async function bootBundle(label, dir) {
  const { JSDOM } = await import("jsdom");
  const html = read(path.join(dir, "index.html"));
  const dom = new JSDOM(html, {
    url: "https://cashier.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", (e) => errors.push(String(e.message || e.error)));
  stripCamera(w);
  w.eval(read(path.join(dir, "cashier-config.js")));
  try {
    w.eval(read(path.join(dir, "app.js")));
  } catch (e) {
    errors.push(e.message);
  }
  await sleep(400);
  const root = w.document.getElementById("root");
  const boot = w.document.getElementById("boot-error");
  const text = (root ? root.textContent : "").replace(/\s+/g, " ").trim();
  const bootShown = boot && boot.style.display === "block";
  const painted = root && root.childNodes.length > 0 && !bootShown && !/did not start/.test(text);
  check(label + " paints a screen without getUserMedia", painted, errors.join(" | ") + " :: " + text.slice(0, 180));
  check(label + " keeps the Cashier title", /Cashier/.test(text), text.slice(0, 120));
  w.close();
}

async function driveLive(label, base, { core }) {
  const { JSDOM } = await import("jsdom");
  const dom = await JSDOM.fromURL(base, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const d = w.document;
  stripCamera(w);
  await sleep(core ? 1600 : 1200);
  const txt = () => d.body.textContent.replace(/\s+/g, " ");
  const btn = (labelText) =>
    Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(labelText) === 0);
  const click = async (el, ms = 400) => {
    el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(ms);
  };
  const type = async (el, v) => {
    const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
    set.call(el, v);
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    await sleep(80);
  };

  if (!core) {
    check(label + " mock wallet is house ledger", txt().includes("Account balance"));
    await click(btn("Live UI"), 1400);
  }
  check(label + " live shell painted", /Account balance|Connecting|LIVE/.test(txt()), txt().slice(0, 180));
  const fund = d.querySelector("[data-fund]");
  if (!core) {
    check(label + " Fund stays gated with an empty PIN", Boolean(fund && fund.disabled));
  }
  await click(btn("Deposit"), 500);
  check(label + " deposit copy is house ledger", txt().includes("credited to your account"), txt().slice(0, 240));
  await type(d.querySelector("input"), "1");
  await click(btn("Continue"), 900);
  check(
    label + " deposit QR is on screen",
    d.querySelectorAll('svg[aria-label="Lightning invoice QR code"]').length === 1,
    "qr=" + d.querySelectorAll("svg").length + " " + txt().slice(0, 160)
  );
  await fetch(base + "api/dev/settle/all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await sleep(4000);
  check(label + " deposit credited", /credited to your account/i.test(txt()) && txt().includes("$1.00"), txt().slice(0, 220));
  await click(btn("Back to wallet"), 500);
  await click(btn("Cash out"), 400);
  const scan = d.querySelector('[aria-label="Scan a code"]');
  check(label + " scan control is still there", Boolean(scan));
  await click(scan, 300);
  check(label + " missing camera does not open the scanner", !d.querySelector(".amb-scan-sheet"), txt().slice(0, 200));
  check(label + " tells you to type a cashtag", /No camera in this browser/.test(txt()) && /cashtag/.test(txt()), txt().slice(0, 240));
  await type(d.querySelector("input"), "$jestoph");
  check(label + " typed cashtag is accepted", /You choose the amount next/.test(txt()), txt().slice(0, 220));
  await click(btn("Continue"), 300);
  await type(d.querySelector("input"), "1");
  await click(btn("Review"), 300);
  check(label + " review shows the typed cashtag", txt().includes("$jestoph"), txt().slice(0, 200));
  await click(btn("Send"), 2500);
  check(label + " typed cash-out completes", txt().includes("paid out from your account"), txt().slice(0, 220));
  w.close();
}

async function withServer(port, pkg, fn) {
  process.env.MOCK_AMBOSS = "1";
  process.env.PORT = String(port);
  process.env.CASHIER_PACKAGE = pkg;
  process.env.OPERATOR_PIN = "";
  process.env.RATE_SOURCE = "static";
  process.env.USD_PER_BTC = "100000";
  process.env.NODE_ENV = "test";
  const { server } = await import("./server/server.js?pkg=" + pkg);
  await sleep(200);
  try {
    await fn("http://127.0.0.1:" + port + "/");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.env.SAFARI_FLOOR_CORE === "1") {
  console.log("\ncore live, no camera");
  await withServer(8194, "core", (base) => driveLive("core", base, { core: true }));
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

console.log("\nbundle syntax");
syntaxFloor("booth", "public/app.js");
syntaxFloor("core", "public-core/app.js");

console.log("\ncheck.html verdict");
for (const dir of ["public", "public-core"]) {
  const html = dir + "/check.html";
  const js = dir + "/check.js";
  const full = await verdictOf(html, js, { gum: true });
  check(dir + " camera present can say Good to go", full.text.includes("Good to go") && full.helpHidden, full.text);
  const noCam = await verdictOf(html, js, { gum: false });
  check(dir + " missing camera is not Good to go", !noCam.text.includes("Good to go"), noCam.text);
  check(dir + " missing camera still says the app can run", /App can run/.test(noCam.text) && /cashtag/.test(noCam.text), noCam.text);
  const below = await verdictOf(html, js, { gum: true, promise: false });
  check(dir + " missing Promise is below the floor", /Below the floor/.test(below.text) && !below.text.includes("Good to go"), below.text);
  const noGrid = await verdictOf(html, js, { gum: false, grid: false });
  check(dir + " missing grid is below the floor, not Good to go", /Below the floor/.test(noGrid.text) && !noGrid.text.includes("Good to go"), noGrid.text);
}

console.log("\nbundle boot without getUserMedia");
await bootBundle("booth", "public");
await bootBundle("core", "public-core");

console.log("\nbooth live, no camera");
await withServer(8193, "booth", (base) => driveLive("booth", base, { core: false }));

console.log("\ncore live child");
const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
  env: { ...process.env, SAFARI_FLOOR_CORE: "1" },
  stdio: "inherit",
});
const childCode = await new Promise((resolve) => child.on("exit", resolve));
check("core live child passed", childCode === 0, "exit " + childCode);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail || childCode ? 1 : 0);
