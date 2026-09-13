/* Live boot must not depend on an inline <script>. CSP on HTML is
   script-src 'self' — browsers refuse the old window.__CASHIER__ tag and
   the app falls back to { live: false }. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { htmlSecurityHeaders } from "./server/security.js";

const root = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi;
const SCRIPT_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

function inlineScripts(html) {
  return [...html.matchAll(INLINE_SCRIPT)].map((m) => m[0]);
}

function scriptSrcs(html) {
  return [...html.matchAll(SCRIPT_SRC)].map((m) => m[1]);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function evalConfig(source) {
  const win = {};
  new Function("window", source)(win);
  return win.__CASHIER__ || { live: false };
}

function assertHostedLive(label, dir) {
  const html = read(path.join(dir, "index.html"));
  const inline = inlineScripts(html);
  check(label + " index has no inline script", inline.length === 0, inline[0]);
  const srcs = scriptSrcs(html);
  check(
    label + " loads cashier-config.js before app.js",
    srcs[0] === "cashier-config.js" && srcs.includes("app.js"),
    srcs.join(", ")
  );
  const host = evalConfig(read(path.join(dir, "cashier-config.js")));
  check(label + " Live boot is live:true from external JS", host.live === true, host);
}

console.log("\nCSP policy");
const csp = htmlSecurityHeaders()["content-security-policy"] || "";
const scriptSrc = ((csp.match(/script-src\s+([^;]+)/) || [])[1] || "").trim();
check("script-src is 'self'", scriptSrc === "'self'", scriptSrc);
check("script-src has no unsafe-inline", !/unsafe-inline/.test(scriptSrc), scriptSrc);
check("style-src still allows the booth CSS", /style-src[^;]*'unsafe-inline'/.test(csp), csp);

console.log("\nhosted Live boot (booth + core)");
assertHostedLive("booth", "public");
assertHostedLive("core", "public-core");

console.log("\noffline file (no CSP; single HTML)");
const offline = read("offline/cashier-offline.html");
const offlineAssign = offline.match(/window\.__CASHIER__\s*=\s*(\{[^;]+\});/);
const offlineHost = offlineAssign ? JSON.parse(offlineAssign[1]) : { live: true };
check("offline HTML still sets live false", offlineHost.live === false, offlineAssign && offlineAssign[1]);

console.log("\ndevice check page");
const checkHtml = read("public/check.html");
check("check.html has no inline script", inlineScripts(checkHtml).length === 0, inlineScripts(checkHtml)[0]);
check("check.html loads check.js", scriptSrcs(checkHtml).includes("check.js"));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
