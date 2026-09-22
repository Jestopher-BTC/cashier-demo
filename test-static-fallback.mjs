/* Static diagnostics must not be replaced by the cashier SPA index.
   Live boltda.sh runs CASHIER_PACKAGE=core, which serves public-core/. */

import { spawn } from "node:child_process";
import { allowsSpaFallback } from "./server/security.js";

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

console.log("\nSPA fallback predicate");
const blocked = [
  "/check.html",
  "/check.js",
  "/cashier-config.js",
  "/app.js",
  "/logo_gradient.svg",
  "/letter_gradient.svg",
  "/missing-asset.js",
  "/missing-page.html",
  "/favicon.ico",
];
for (const p of blocked) check("no SPA fallback for " + p, allowsSpaFallback(p) === false);
check("extensionless /core/ still falls back", allowsSpaFallback("/core/") === true);
check("extensionless /core still falls back", allowsSpaFallback("/core") === true);
check("unknown client route still falls back", allowsSpaFallback("/some/client/route") === true);
check("index itself is not a fallback target", allowsSpaFallback("/") === false && allowsSpaFallback("/index.html") === false);
check("query string does not re-enable fallback", allowsSpaFallback("/check.js?x=1") === false);

const PROBE = `
process.env.MOCK_AMBOSS = "1";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.OPERATOR_PIN = "";
const { server } = await import("./server/server.js");
await new Promise((r) => setTimeout(r, 200));
const base = "http://127.0.0.1:" + process.env.PORT;
async function grab(pathname) {
  const res = await fetch(base + pathname);
  const text = await res.text();
  return {
    status: res.status,
    type: res.headers.get("content-type") || "",
    text,
  };
}
const names = ["/", "/core/", "/check.html", "/check.js", "/cashier-config.js", "/app.js", "/missing-asset.js"];
const out = {};
for (const name of names) out[name] = await grab(name);
const health = await (await fetch(base + "/healthz")).json();
console.log("RESULT " + JSON.stringify({ package: health.package, out }));
server.close();
`;

function probe(port, pkg) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", PROBE], {
      cwd: new URL(".", import.meta.url).pathname,
      env: {
        ...process.env,
        PORT: String(port),
        CASHIER_PACKAGE: pkg,
        MOCK_AMBOSS: "1",
        RATE_SOURCE: "static",
        USD_PER_BTC: "100000",
        OPERATOR_PIN: "",
      },
    });
    let buf = "";
    child.stdout.on("data", (c) => (buf += c));
    child.stderr.on("data", (c) => (buf += c));
    child.on("close", (code) => {
      const line = buf
        .split("\n")
        .map((s) => s.trim())
        .find((s) => s.startsWith("RESULT "));
      if (!line) return reject(new Error(pkg + " probe produced no RESULT (exit " + code + ")\n" + buf.slice(-800)));
      try {
        resolve(JSON.parse(line.slice("RESULT ".length)));
      } catch (e) {
        reject(new Error(pkg + " probe JSON failed: " + e.message + "\n" + buf.slice(-800)));
      }
    });
  });
}

function assertServed(label, body) {
  const html = body.out["/"];
  const core = body.out["/core/"];
  const checkHtml = body.out["/check.html"];
  const checkJs = body.out["/check.js"];
  const config = body.out["/cashier-config.js"];
  const app = body.out["/app.js"];
  const missing = body.out["/missing-asset.js"];

  check(label + " healthz package", body.package === label, body.package);
  check(
    label + " / is the cashier shell",
    html.status === 200 &&
      html.type.startsWith("text/html") &&
      html.text.includes(".topbar") &&
      html.text.includes('src="cashier-config.js"') &&
      !html.text.includes("<title>Cashier device check</title>"),
    html.type
  );
  check(
    label + " /core/ still serves the app",
    core.status === 200 &&
      core.type.startsWith("text/html") &&
      core.text.includes('src="cashier-config.js"') &&
      core.text.includes(".topbar"),
    core.status + " " + core.type
  );
  check(
    label + " check.html is the diagnostics page",
    checkHtml.status === 200 &&
      checkHtml.type.startsWith("text/html") &&
      checkHtml.text.includes("<title>Cashier device check</title>") &&
      checkHtml.text.includes('id="static-help"') &&
      /Safari/.test(checkHtml.text) &&
      /<noscript>/.test(checkHtml.text) &&
      checkHtml.text.includes('src="check.js"') &&
      !checkHtml.text.includes(".topbar") &&
      !/<script(?![^>]*\bsrc=)/i.test(checkHtml.text),
    checkHtml.type + " " + checkHtml.text.slice(0, 180)
  );
  check(
    label + " check.js is javascript, not the SPA index",
    checkJs.status === 200 &&
      checkJs.type.startsWith("application/javascript") &&
      checkJs.text.startsWith("function row") &&
      !checkJs.text.includes("<!DOCTYPE") &&
      !checkJs.text.includes(".topbar"),
    checkJs.type + " " + checkJs.text.slice(0, 80)
  );
  check(
    label + " cashier-config.js Live flag unchanged",
    config.status === 200 &&
      config.type.startsWith("application/javascript") &&
      config.text === 'window.__CASHIER__ = {"live":true};\n',
    config.text
  );
  check(
    label + " app.js is javascript",
    app.status === 200 && app.type.startsWith("application/javascript") && !app.text.includes("<!DOCTYPE"),
    app.type
  );
  check(
    label + " missing .js is not the SPA index",
    missing.status === 404 &&
      missing.type.startsWith("application/json") &&
      !missing.text.includes("<!DOCTYPE") &&
      !missing.text.includes(".topbar"),
    missing.status + " " + missing.type + " " + missing.text.slice(0, 120)
  );
}

console.log("\nHTTP core package (live kiosk)");
const coreBody = await probe(8204, "core");
assertServed("core", coreBody);

console.log("\nHTTP booth package");
const boothBody = await probe(8205, "booth");
assertServed("booth", boothBody);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
