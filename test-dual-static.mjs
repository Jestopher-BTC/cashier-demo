/* Dual-URL hosting: booth at / and core at /core/, shared API. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8201";
process.env.OPERATOR_PIN = "4242";
process.env.SESSION_START_USD = "2";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
delete process.env.CASHIER_PACKAGE;

import { spawn } from "node:child_process";
import { JSDOM } from "jsdom";

const { parseCashierPackage } = await import("./server/config.js");
const {
  CORE_MOUNT,
  coreSlashRedirectLocation,
  publicDirFor,
  resolveHostLayout,
  splitMount,
  isApiPath,
  isHealthzPath,
} = await import("./server/hosts.js");
const { resolvePublicFile } = await import("./server/security.js");
const { server, hostLayout } = await import("./server/server.js");

const BASE = "http://127.0.0.1:8201";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

await sleep(150);

console.log("\npackage flag");
check("unset CASHIER_PACKAGE is dual", parseCashierPackage("") === "dual");
check("blank is dual", parseCashierPackage("  ") === "dual");
check("both is dual", parseCashierPackage("both") === "dual");
check("dual is dual", parseCashierPackage("dual") === "dual");
check("booth fallback remains", parseCashierPackage("booth") === "booth");
check("core fallback remains", parseCashierPackage("core") === "core");
let threw = false;
try {
  parseCashierPackage("sales");
} catch (e) {
  threw = /dual, booth, or core/.test(e.message);
}
check("unknown package throws", threw);

console.log("\nmount routing");
check("root stays root", splitMount("/").mount === "root" && splitMount("/").rest === "/");
check("/api stays on root mount", splitMount("/api/config").mount === "root" && splitMount("/api/config").rest === "/api/config");
check("/core redirects for slash", splitMount("/core").trailingSlashRedirect === true && splitMount("/core").rest === "/");
check("/core/ is core index", splitMount("/core/").mount === "core" && splitMount("/core/").rest === "/");
check("/core/api/config strips mount", splitMount("/core/api/config").rest === "/api/config");
check("/core/healthz strips mount", splitMount("/core/healthz").rest === "/healthz");
check("/core/app.js strips mount", splitMount("/core/app.js").rest === "/app.js");
check("relative redirect keeps Caddy prefix", coreSlashRedirectLocation() === "core/");
check("api path detector", isApiPath("/api/config") && isApiPath("/api") && !isApiPath("/core/api/config"));
check("healthz detector", isHealthzPath("/healthz") && !isHealthzPath("/core/healthz"));

const dualLayout = resolveHostLayout({ requested: "dual", boothExists: true, coreExists: true });
check("dual layout when both builds exist", dualLayout.mode === "dual");
check("dual booth path is /", dualLayout.booth.available && dualLayout.booth.path === "/");
check("dual core path is /core/", dualLayout.core.available && dualLayout.core.path === CORE_MOUNT + "/");
check(
  "dual core uses public-core",
  publicDirFor(dualLayout, "core", "/booth", "/core-out") === "/core-out"
);
check(
  "dual booth uses public",
  publicDirFor(dualLayout, "root", "/booth", "/core-out") === "/booth"
);

const boothOnly = resolveHostLayout({ requested: "booth", boothExists: true, coreExists: true });
check("booth fallback hides /core even if public-core exists", boothOnly.mode === "booth" && boothOnly.core.available === false);
const coreOnly = resolveHostLayout({ requested: "core", boothExists: true, coreExists: true });
check("core fallback serves core at /", coreOnly.mode === "core" && coreOnly.core.path === "/");
const missingCore = resolveHostLayout({ requested: "dual", boothExists: true, coreExists: false });
check("dual with no public-core falls back to booth", missingCore.mode === "booth" && /public-core/.test(missingCore.warning || ""));

console.log("\nHTTP dual static");
check("server booted dual", hostLayout.mode === "dual", hostLayout);

const boothIndex = await fetch(BASE + "/");
const boothHtml = await boothIndex.text();
check("booth index at /", boothIndex.status === 200 && boothHtml.includes("cashier-config.js"), boothHtml.slice(0, 160));

const boothCfg = await fetch(BASE + "/cashier-config.js");
const boothCfgText = await boothCfg.text();
check("booth Live flag is cashier-config.js", boothCfg.status === 200 && /"live"\s*:\s*true/.test(boothCfgText), boothCfgText);

const boothApp = await fetch(BASE + "/app.js");
const boothJs = await boothApp.text();
check("booth bundle has Mock UI", boothApp.status === 200 && /Mock UI/.test(boothJs));

const redir = await fetch(BASE + "/core", { redirect: "manual" });
check("/core is 308", redir.status === 308, redir.status);
check("/core Location is relative core/", redir.headers.get("location") === "core/", redir.headers.get("location"));

const coreIndex = await fetch(BASE + "/core/");
const coreHtml = await coreIndex.text();
check("core index at /core/", coreIndex.status === 200 && coreHtml.includes("cashier-config.js"), coreHtml.slice(0, 160));
check("core HTML CSP is still script-src self", /script-src 'self'/.test(coreIndex.headers.get("content-security-policy") || ""));

const coreCfg = await fetch(BASE + "/core/cashier-config.js");
const coreCfgText = await coreCfg.text();
check("core Live flag is cashier-config.js", coreCfg.status === 200 && /"live"\s*:\s*true/.test(coreCfgText), coreCfgText);

const coreApp = await fetch(BASE + "/core/app.js");
const coreJs = await coreApp.text();
check("core bundle has no Mock UI tab", coreApp.status === 200 && !/"Mock UI"/.test(coreJs) && !/label:"Mock UI"/.test(coreJs));
check("core bundle has the cashier", /Account balance/.test(coreJs));
check("booth and core bundles differ", boothJs !== coreJs);

console.log("\nshared API from both mounts");
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const rootCfg = await call("/api/config");
const coreApiCfg = await call("/core/api/config");
check("GET /api/config works", rootCfg.status === 200 && rootCfg.json.live === true, rootCfg.json);
check("GET /core/api/config works", coreApiCfg.status === 200 && coreApiCfg.json.asset === rootCfg.json.asset, coreApiCfg.json);
check("Fund gate is on for both UIs", rootCfg.json.fundEnabled === true && coreApiCfg.json.fundEnabled === true);

const s = await call("/core/api/session", { method: "POST", body: {} });
const sid = s.json.sessionId;
check("session from /core/api", s.status === 200 && /^s_[a-f0-9]{32}$/.test(sid || ""), s.json);

const fromRoot = await call(`/api/state?s=${sid}`);
check("same session visible on /api", fromRoot.status === 200 && fromRoot.json.sessionId === sid, fromRoot.json);

const badFund = await call("/core/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "0000" } });
check("Fund PIN still required on /core/api", badFund.status === 403, badFund.json);
const funded = await call("/core/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "4242" } });
check("Fund grant on /core/api credits the shared session", funded.status === 200 && funded.json.balanceUsd === 2, funded.json);
const rootState = await call(`/api/state?s=${sid}`);
check("Funded balance readable from booth /api", rootState.json.balanceUsd === 2, rootState.json);

console.log("\nhealthz packages");
const health = await fetch(BASE + "/healthz");
const hj = await health.json();
check("healthz package is dual", health.status === 200 && hj.package === "dual", hj.package);
check("healthz reports booth at /", hj.packages && hj.packages.booth.available && hj.packages.booth.path === "/", hj.packages);
check("healthz reports core at /core/", hj.packages && hj.packages.core.available && hj.packages.core.path === "/core/", hj.packages);
const coreHealth = await fetch(BASE + "/core/healthz");
const ch = await coreHealth.json();
check("/core/healthz is the same payload", coreHealth.status === 200 && ch.package === "dual" && ch.packages.core.path === "/core/", ch.packages);

console.log("\npath confinement");
const escaped = resolvePublicFile("/tmp/cashier-core", splitMount("/core/%2e%2e/%2e%2e/etc/passwd").rest);
check(
  "core mount cannot escape its public dir",
  escaped === null || String(escaped).startsWith("/tmp/cashier-core"),
  escaped
);

console.log("\njsdom booth vs core");
const boothDom = await JSDOM.fromURL(BASE + "/", {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
});
await sleep(1600);
const boothDoc = boothDom.window.document;
check("booth still has mode tabs", boothDoc.querySelectorAll(".mode").length >= 3);
const liveBtn = Array.from(boothDoc.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf("Live UI") === 0);
if (liveBtn) {
  liveBtn.dispatchEvent(new boothDom.window.MouseEvent("click", { bubbles: true }));
  await sleep(1200);
}
check(
  "booth Live still has Fund chrome",
  Boolean(boothDoc.querySelector("[data-fund]")),
  boothDoc.body.textContent.slice(0, 180)
);

const coreDom = await JSDOM.fromURL(BASE + "/core/", {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
});
await sleep(1600);
const coreTxt = coreDom.window.document.body.textContent;
check("core subpath has no mode tabs", coreDom.window.document.querySelectorAll(".mode").length === 0);
check("core subpath has no Fund button", !coreDom.window.document.querySelector("[data-fund]"));
check("core subpath shows the cashier", /Account balance/.test(coreTxt));

console.log("\nCASHIER_PACKAGE=booth fallback");
const child = spawn(
  process.execPath,
  [
    "-e",
    `process.env.MOCK_AMBOSS="1";
     process.env.PORT="8202";
     process.env.CASHIER_PACKAGE="booth";
     process.env.RATE_SOURCE="static";
     process.env.USD_PER_BTC="100000";
     process.env.OPERATOR_PIN="";
     const { server } = await import("./server/server.js");
     await new Promise((r) => setTimeout(r, 150));
     const health = await (await fetch("http://127.0.0.1:8202/healthz")).json();
     console.log("RESULT " + JSON.stringify({
       package: health.package,
       coreAvailable: !!(health.packages && health.packages.core && health.packages.core.available)
     }));
     server.close();`,
  ],
  { cwd: new URL(".", import.meta.url).pathname }
);
let childOut = "";
child.stdout.on("data", (c) => (childOut += c));
child.stderr.on("data", (c) => (childOut += c));
const childCode = await new Promise((resolve) => child.on("close", resolve));
let boothFallback = {};
try {
  const line = childOut.split("\n").map((s) => s.trim()).find((s) => s.startsWith("RESULT "));
  boothFallback = JSON.parse(line.slice("RESULT ".length));
} catch {
  boothFallback = { raw: childOut };
}
check("booth-only child exited", childCode === 0, childOut.slice(-400));
check("booth-only healthz package is booth", boothFallback.package === "booth", boothFallback);
check("booth-only does not advertise core", boothFallback.coreAvailable === false, boothFallback);

console.log(`\n${pass} passed, ${fail} failed\n`);
boothDom.window.close();
coreDom.window.close();
server.close();
process.exit(fail ? 1 : 0);
