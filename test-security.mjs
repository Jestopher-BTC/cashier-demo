/* Security helpers + HTTP attack surface. Does not mint real invoices. */

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8196";
process.env.OPERATOR_PIN = "424242";
process.env.FUND_ENABLED = "true";
process.env.SESSION_START_USD = "2";
process.env.DAILY_FLOAT_USD = "25";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.HEALTHZ_TOKEN = "test-healthz-token";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  clientIp,
  createPinGuard,
  healthzTokenOk,
  isDirectLoopback,
  newSecretId,
  pinMatches,
  publicErrorMessage,
  redactHealth,
  resolvePublicFile,
} from "./server/security.js";

const { server } = await import("./server/server.js");

const BASE = "http://127.0.0.1:8196";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

await sleep(150);

async function call(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
}

console.log("\nsession ids and PIN compare");
const id = newSecretId("s");
check("session id is 32 hex chars", /^s_[a-f0-9]{32}$/.test(id), id);
check("two ids differ", newSecretId("s") !== id);
check("correct PIN matches", pinMatches("424242", "424242"));
check("wrong PIN rejected", pinMatches("000000", "424242") === false);
check("short PIN rejected", pinMatches("42", "424242") === false);
check("empty expected never matches", pinMatches("424242", "") === false);

console.log("\nPIN lockout");
const guard = createPinGuard({ maxAttempts: 3, windowMs: 60_000, lockMs: 60_000, globalMax: 20 });
check("first attempt allowed", guard.allowed("ip").ok);
guard.fail("ip");
guard.fail("ip");
check("two fails still allowed", guard.allowed("ip").ok);
guard.fail("ip");
check("third fail locks", guard.allowed("ip").ok === false);
guard.ok("ip");
check("success clears lock", guard.allowed("ip").ok);

console.log("\npublic errors");
check(
  "keeps cashier copy",
  publicErrorMessage(new Error("Wrong pin."), "nope") === "Wrong pin."
);
check(
  "strips GraphQL",
  publicErrorMessage(new Error("wallet.find_one [FORBIDDEN]: bad key"), "safe") === "safe"
);
check(
  "strips team password hint",
  publicErrorMessage(new Error("Team password could not decrypt the wallet. Check AMBOSS_TEAM_PASSWORD."), "safe") ===
    "safe"
);

console.log("\nclient IP behind Caddy");
const loopReq = {
  socket: { remoteAddress: "127.0.0.1" },
  headers: { "x-forwarded-for": "8.8.8.8, 10.0.0.1" },
};
check("uses rightmost XFF from loopback", clientIp(loopReq) === "10.0.0.1");
check("direct loopback has no XFF", isDirectLoopback({ socket: { remoteAddress: "127.0.0.1" }, headers: {} }));
check(
  "proxied loopback is not direct",
  isDirectLoopback(loopReq) === false
);
check(
  "ignores XFF from a public peer",
  clientIp({ socket: { remoteAddress: "9.9.9.9" }, headers: { "x-forwarded-for": "1.1.1.1" } }) === "9.9.9.9"
);

console.log("\nhealthz redaction");
const full = {
  ok: true,
  asset: "BTC",
  mock: true,
  package: "booth",
  fundEnabled: true,
  addressPayouts: { supported: true, verified: false, lastError: "secret" },
  float: { day: "2026-09-11", grantedUsd: 8, paidOutUsd: 4, capUsd: 25, remainingUsd: 17 },
  checks: {
    rate: { ok: true, usdPerBtc: 100000, source: "static" },
    wallet: { ok: true, id: "wallet-secret", is_ready: true, balance: "999" },
    send: { ok: true, prepared: true, error: "nope" },
  },
};
const red = redactHealth(full);
check("redacted health drops wallet id", red.checks.wallet.id === undefined);
check("redacted health drops balance", red.checks.wallet.balance === undefined);
check("redacted health drops float remaining", red.float.remainingUsd === undefined && red.float.grantedUsd === undefined);
check("redacted health drops lastError", red.addressPayouts.lastError === undefined);
check("redacted health keeps rate", red.checks.rate.usdPerBtc === 100000);

const proxied = await fetch(BASE + "/healthz", { headers: { "X-Forwarded-For": "203.0.113.9" } });
const proxiedJson = await proxied.json();
check("proxied healthz hides wallet id", proxiedJson.checks.wallet.id === undefined, proxiedJson.checks.wallet);
check("proxied healthz hides float remaining", proxiedJson.float.remainingUsd === undefined, proxiedJson.float);
const local = await call("/healthz");
check("loopback healthz still shows wallet id", Boolean(local.json.checks.wallet && local.json.checks.wallet.id), local.json.checks.wallet);
const tok = await fetch(BASE + "/healthz?token=test-healthz-token", { headers: { "X-Forwarded-For": "203.0.113.9" } });
const tokJson = await tok.json();
check("token restores detail through proxy", Boolean(tokJson.checks.wallet && tokJson.checks.wallet.id), tokJson.checks.wallet);
check(
  "token helper matches",
  healthzTokenOk(
    { headers: { "x-healthz-token": "test-healthz-token" } },
    "test-healthz-token",
    new URL("http://x/healthz")
  )
);

console.log("\nsession entropy + fund lockout over HTTP");
const s = await call("/api/session", { method: "POST", body: {} });
check("HTTP session id is hex", /^s_[a-f0-9]{32}$/.test(s.json.sessionId || ""), s.json.sessionId);
const sid = s.json.sessionId;
for (let i = 0; i < 8; i++) {
  await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "000000" } });
}
const locked = await call("/api/session/fund", { method: "POST", body: { sessionId: sid, pin: "000000" } });
check("ninth wrong PIN is 429", locked.status === 429, locked);
const other = await call("/api/session", { method: "POST", body: {} });
const otherFund = await call("/api/session/fund", {
  method: "POST",
  headers: { "X-Forwarded-For": "198.51.100.20" },
  body: { sessionId: other.json.sessionId, pin: "424242" },
});
check("other IP can still fund with the real PIN", otherFund.status === 200 && otherFund.json.balanceUsd === 2, otherFund);

console.log("\nstatic path + headers");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cashier-pub-"));
fs.writeFileSync(path.join(tmp, "index.html"), "<html>ok</html>");
check("index resolves", resolvePublicFile(tmp, "/index.html").startsWith(path.resolve(tmp)));
const escaped = resolvePublicFile(tmp, "/../../etc/passwd");
check("root escape stays inside the public dir", escaped === null || escaped.startsWith(path.resolve(tmp) + path.sep) || escaped === path.resolve(tmp, "etc/passwd"));
const idx = await fetch(BASE + "/");
check("HTML sends CSP", /default-src 'self'/.test(idx.headers.get("content-security-policy") || ""), idx.headers.get("content-security-policy"));
check("HTML denies framing", idx.headers.get("x-frame-options") === "DENY");
check("nosniff", idx.headers.get("x-content-type-options") === "nosniff");
check("camera policy", /camera=\(self\)/.test(idx.headers.get("permissions-policy") || ""));

console.log("\nmock settle in production");
const child = spawn(
  process.execPath,
  [
    "-e",
    `process.env.MOCK_AMBOSS="1";
     process.env.NODE_ENV="production";
     process.env.PORT="8197";
     process.env.RATE_SOURCE="static";
     process.env.USD_PER_BTC="100000";
     process.env.OPERATOR_PIN="";
     const { server } = await import("./server/server.js");
     const res = await fetch("http://127.0.0.1:8197/api/dev/settle/all", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
     const json = await res.json();
     console.log(JSON.stringify({ status: res.status, json }));
     server.close();
     process.exit(res.status === 404 ? 0 : 1);`,
  ],
  { cwd: new URL(".", import.meta.url).pathname }
);
let childOut = "";
child.stdout.on("data", (c) => (childOut += c));
child.stderr.on("data", (c) => (childOut += c));
const childCode = await new Promise((resolve) => child.on("close", resolve));
check("production mock hides /api/dev/settle", childCode === 0, childOut);

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
process.exit(fail ? 1 : 0);
