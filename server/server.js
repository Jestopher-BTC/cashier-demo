import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, assertReady, money, round2 } from "./config.js";
import { amboss as liveAmboss } from "./amboss.js";
import { mockAmboss } from "./mock-amboss.js";
import {
  getRate,
  newSession,
  getSession,
  fundSession,
  publicState,
  recordPayout,
  floatState,
  reference,
} from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "..", "public");
const api = config.mock ? mockAmboss : liveAmboss;

assertReady();

/* ------------------------------------------------------------ plumbing --- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, message) => send(res, status, { error: message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("body is not JSON"));
      }
    });
    req.on("error", reject);
  });
}

/* Crude per-IP limiter. Enough to keep a bored attendee from hammering it. */
const buckets = new Map();
function rateLimited(ip, cost = 1, perMinute = 60) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: perMinute, at: now };
  const refill = ((now - b.at) / 60000) * perMinute;
  b.tokens = Math.min(perMinute, b.tokens + refill);
  b.at = now;
  if (b.tokens < cost) {
    buckets.set(ip, b);
    return true;
  }
  b.tokens -= cost;
  buckets.set(ip, b);
  return false;
}

/* ------------------------------------------------------- destinations --- */

export function parseDestination(raw) {
  const input = String(raw || "").trim().replace(/^lightning:/i, "");
  if (!input) return { kind: "invalid", reason: "Enter a destination." };

  if (/^\$[a-z0-9_]{1,20}$/i.test(input))
    return {
      kind: "address",
      display: input,
      address: `${input.slice(1).toLowerCase()}@cash.app`,
    };

  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(input))
    return { kind: "address", display: input.toLowerCase(), address: input.toLowerCase() };

  if (/^lnbc/i.test(input)) {
    const m = /^lnbc(\d+)?([munp])?1/i.exec(input);
    if (!m || input.length < 60) return { kind: "invalid", reason: "That invoice is not readable." };
    const mult = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12 }[(m[2] || "").toLowerCase()] ?? 1;
    const satAmount = m[1] ? Math.round(Number(m[1]) * mult * 1e8) : 0;
    if (!satAmount)
      return {
        kind: "invalid",
        reason: "Amountless invoices cannot be paid. Ask for one with an amount on it.",
      };
    return { kind: "invoice", display: `${input.slice(0, 12)}…${input.slice(-8)}`, bolt11: input, satAmount };
  }

  return { kind: "invalid", reason: "Enter a cashtag, a Lightning address, or an invoice." };
}

/* ----------------------------------------------------------- handlers --- */

/* What we currently believe about Lightning address sends from this wallet.
   Starts as configured, becomes fact the first time we actually try one. */
const addressPayouts = {
  supported: config.addressPayouts,
  verified: false,
  lastError: null,
  lastCheckedAt: null,
};

const UNSUPPORTED = /not (yet )?supported|unsupported|not available/i;

export function addressPayoutState() {
  return { ...addressPayouts };
}

const pendingDeposits = new Map(); // txId -> { sessionId, amountUsd, rate }
const pendingWithdrawals = new Map(); // txId -> { sessionId, amountUsd, localId }

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || "unknown";
  const method = req.method;
  const route = url.pathname.replace(/^\/api/, "") || "/";

  if (route === "/config" && method === "GET")
    return send(res, 200, {
      live: true,
      asset: config.asset,
      addressPayouts: addressPayouts.supported,
      addressPayoutsVerified: addressPayouts.verified,
      minDepositUsd: config.minDepositUsd,
      maxDepositUsd: config.maxDepositUsd,
      minWithdrawUsd: config.minWithdrawUsd,
      maxWithdrawUsd: config.maxWithdrawUsd,
      invoiceSeconds: config.invoiceSeconds,
      pinRequired: Boolean(config.operatorPin),
      mock: config.mock,
    });

  if (route === "/session" && method === "POST") {
    if (rateLimited(ip, 1, 40)) return fail(res, 429, "Slow down.");
    return send(res, 200, publicState(newSession()));
  }

  const body = method === "POST" ? await readBody(req).catch(() => null) : {};
  if (body === null) return fail(res, 400, "Body is not JSON.");
  /* Mock-only test hook, deliberately ahead of the session gate. */
  if (route.startsWith("/dev/settle/") && method === "POST" && config.mock) {
    const target = decodeURIComponent(route.slice("/dev/settle/".length));
    const settled = target === "all" ? mockAmboss.settleAll(body) : mockAmboss.settle(target, body);
    return send(res, 200, { ok: true, settled });
  }

  const sessionId = body.sessionId || url.searchParams.get("s");
  const session = sessionId ? getSession(sessionId) : null;

  if (route !== "/health" && !session) return fail(res, 409, "Session expired. Start a new one.");

  if (route === "/state" && method === "GET") return send(res, 200, publicState(session));

  if (route === "/session/fund" && method === "POST") {
    if (rateLimited(ip, 1, 30)) return fail(res, 429, "Slow down.");
    const result = fundSession(session, String(body.pin || ""));
    if (result.error) return fail(res, 403, result.error);
    return send(res, 200, publicState(session));
  }

  /* ---------------------------------------------------------- deposit --- */
  if (route === "/deposit" && method === "POST") {
    if (rateLimited(ip, 1, 40)) return fail(res, 429, "Slow down.");
    const amountUsd = round2(Number(body.amountUsd));
    if (!isFinite(amountUsd) || amountUsd < config.minDepositUsd || amountUsd > config.maxDepositUsd)
      return fail(res, 400, `Deposits run from $${config.minDepositUsd} to $${config.maxDepositUsd} here.`);

    const { usdPerBtc } = await getRate();
    const amountMinor = money.usdToMinor(amountUsd, usdPerBtc);
    if (amountMinor < 1) return fail(res, 400, "That rounds to nothing at the current rate.");

    try {
      const tx = await api.createReceive({
        amountMinor,
        description: `Cashier demo deposit ${money.satsForDisplay(amountUsd, usdPerBtc) ? "" : ""}$${amountUsd}`,
        expiresInSeconds: config.invoiceSeconds,
        idempotencyKey: `dep-${session.id}-${session.transactions.length}-${Date.now()}`,
        metadata: { demo: "cashier", session: session.id },
      });
      pendingDeposits.set(tx.id, { sessionId: session.id, amountUsd, rate: usdPerBtc });
      return send(res, 200, {
        id: tx.id,
        amountUsd,
        satAmount: money.satsForDisplay(amountUsd, usdPerBtc),
        invoice: tx.payment_request,
        expiresAt: tx.expires_at ? Date.parse(tx.expires_at) : Date.now() + config.invoiceSeconds * 1000,
      });
    } catch (e) {
      console.error("[deposit]", e.message);
      return fail(res, 502, e.message);
    }
  }

  if (route.startsWith("/deposit/") && method === "GET") {
    const txId = decodeURIComponent(route.slice("/deposit/".length));
    const record = pendingDeposits.get(txId);
    if (!record || record.sessionId !== session.id) return fail(res, 404, "Unknown deposit.");
    try {
      const tx = await api.transaction(txId);
      const status = String(tx.status || "").toLowerCase();
      if (status === "completed" && !record.credited) {
        record.credited = true;
        const settled = tx.settle_amount && tx.settle_amount.full_amount;
        const credited = settled ? money.minorToUsd(settled, record.rate) : record.amountUsd;
        session.balanceUsd = round2(session.balanceUsd + credited);
        session.transactions.unshift({
          id: txId,
          ref: reference(),
          type: "deposit",
          amountUsd: credited,
          status: "complete",
          ts: Date.now(),
        });
      }
      return send(res, 200, { status, balanceUsd: round2(session.balanceUsd) });
    } catch (e) {
      console.error("[deposit poll]", e.message);
      return send(res, 200, { status: "pending", warning: e.message });
    }
  }

  /* --------------------------------------------------------- withdraw --- */
  if (route === "/withdraw" && method === "POST") {
    if (rateLimited(ip, 1, 30)) return fail(res, 429, "Slow down.");
    const dest = parseDestination(body.destination);
    if (dest.kind === "invalid") return fail(res, 400, dest.reason);
    if (dest.kind === "address" && !addressPayouts.supported)
      return fail(res, 400, "This wallet pays invoices only. Ask for an invoice with an amount on it.");

    const { usdPerBtc } = await getRate();
    let amountUsd;
    if (dest.kind === "invoice") {
      amountUsd = round2((dest.satAmount / 1e8) * usdPerBtc);
    } else {
      amountUsd = round2(Number(body.amountUsd));
      if (!isFinite(amountUsd) || amountUsd <= 0) return fail(res, 400, "Enter an amount.");
    }

    if (amountUsd < config.minWithdrawUsd || amountUsd > config.maxWithdrawUsd)
      return fail(res, 400, `Cash outs run from $${config.minWithdrawUsd} to $${config.maxWithdrawUsd} here.`);
    if (amountUsd > session.balanceUsd)
      return fail(res, 400, `Balance is $${round2(session.balanceUsd).toFixed(2)}.`);

    /* Debit first, refund on failure. */
    session.balanceUsd = round2(session.balanceUsd - amountUsd);
    const localId = "w_" + Math.random().toString(36).slice(2, 10);
    const entry = {
      id: localId,
      ref: reference(),
      type: "withdrawal",
      amountUsd,
      destination: dest.display,
      status: "pending",
      ts: Date.now(),
    };
    session.transactions.unshift(entry);

    try {
      const idempotencyKey = `wd-${session.id}-${localId}`;
      const tx =
        dest.kind === "invoice"
          ? await api.sendBolt11({ bolt11: dest.bolt11, idempotencyKey, metadata: { demo: "cashier" } })
          : await api.sendAddress({
              lightningAddress: dest.address,
              amountMinor: money.usdToMinor(amountUsd, usdPerBtc),
              idempotencyKey,
              metadata: { demo: "cashier" },
            });
      if (dest.kind === "address") {
        addressPayouts.supported = true;
        addressPayouts.verified = true;
        addressPayouts.lastError = null;
        addressPayouts.lastCheckedAt = Date.now();
      }
      pendingWithdrawals.set(tx.id, { sessionId: session.id, amountUsd, localId });
      const status = String(tx.status || "pending").toLowerCase();
      if (status === "completed") finalizeWithdrawal(session, entry, "complete", amountUsd);
      if (status === "failed") finalizeWithdrawal(session, entry, "failed", amountUsd, tx.error);
      return send(res, 200, { id: tx.id, status: status === "completed" ? "complete" : status });
    } catch (e) {
      console.error("[withdraw]", e.message);
      finalizeWithdrawal(session, entry, "failed", amountUsd, e.message);

      /* If the API tells us address sends are not available on this wallet,
         believe it once and stop offering the path for the rest of the day. */
      if (dest.kind === "address" && UNSUPPORTED.test(e.message)) {
        addressPayouts.supported = false;
        addressPayouts.verified = true;
        addressPayouts.lastError = e.message;
        addressPayouts.lastCheckedAt = Date.now();
        console.warn(
          "[capability] address sends rejected by this wallet; switching to invoices only.\n" +
            "            " + e.message
        );
        return fail(
          res,
          400,
          "This wallet pays invoices only. Ask for an invoice with an amount on it."
        );
      }
      return fail(res, 502, e.message);
    }
  }

  if (route.startsWith("/withdraw/") && method === "GET") {
    const txId = decodeURIComponent(route.slice("/withdraw/".length));
    const record = pendingWithdrawals.get(txId);
    if (!record || record.sessionId !== session.id) return fail(res, 404, "Unknown cash out.");
    const entry = session.transactions.find((t) => t.id === record.localId);
    try {
      const tx = await api.transaction(txId);
      const status = String(tx.status || "").toLowerCase();
      if (status === "completed" && entry.status === "pending")
        finalizeWithdrawal(session, entry, "complete", record.amountUsd);
      if (status === "failed" && entry.status === "pending")
        finalizeWithdrawal(session, entry, "failed", record.amountUsd, tx.error);
      return send(res, 200, {
        status: status === "completed" ? "complete" : status === "failed" ? "failed" : "pending",
        error: tx.error || null,
        balanceUsd: round2(session.balanceUsd),
      });
    } catch (e) {
      return send(res, 200, { status: "pending", warning: e.message });
    }
  }

  return fail(res, 404, "No such endpoint.");
}

function finalizeWithdrawal(session, entry, status, amountUsd, error) {
  entry.status = status;
  if (status === "failed") {
    entry.note = "Returned to your balance";
    entry.error = error || null;
    session.balanceUsd = round2(session.balanceUsd + amountUsd);
  } else {
    recordPayout(amountUsd);
  }
}

/* ------------------------------------------------------------- health --- */

async function health(res) {
  const out = {
    ok: false,
    asset: config.asset,
    mock: config.mock,
    addressPayouts: addressPayoutState(),
    float: floatState(),
    checks: {},
  };
  try {
    const rate = await getRate();
    out.checks.rate = { ok: true, usdPerBtc: rate.usdPerBtc, source: rate.source };
  } catch (e) {
    out.checks.rate = { ok: false, error: e.message };
  }
  try {
    const wallet = await api.wallet();
    out.checks.wallet = {
      ok: Boolean(wallet && wallet.is_ready),
      id: wallet && wallet.id,
      is_ready: wallet && wallet.is_ready,
      balance: wallet && wallet.balance && wallet.balance.balance,
    };
  } catch (e) {
    out.checks.wallet = { ok: false, error: e.message };
  }
  out.ok = Object.values(out.checks).every((c) => c.ok);
  return send(res, out.ok ? 200 : 503, out);
}

/* ------------------------------------------------------------- static --- */

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, "No.");

  fs.readFile(file, (err, data) => {
    if (err) {
      if (rel !== "/index.html") return serveStatic(req, res, new URL("/", "http://x"));
      return fail(res, 404, "Not found.");
    }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=300",
    });
    res.end(data);
  });
}

/* --------------------------------------------------------------- boot --- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/healthz") return await health(res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed.");
    return serveStatic(req, res, url);
  } catch (e) {
    console.error("[unhandled]", e);
    return fail(res, 500, "Something broke on the server.");
  }
});

server.listen(config.port, () => {
  console.log(`cashier demo on :${config.port}`);
  console.log(`  asset            ${config.asset}${config.mock ? " (mock Amboss)" : ""}`);
  console.log(`  address payouts  ${config.addressPayouts ? "on" : "off, invoices only"}`);
  console.log(`  caps             deposit $${config.maxDepositUsd}, cash out $${config.maxWithdrawUsd}`);
  console.log(`  daily float      $${config.dailyFloatUsd}`);
});

export { server };
