import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config, assertReady, money, addressSendAmounts, round2 } from "./config.js";
import { normalizeScannedText } from "../src/scan-payload.js";
import { amboss as liveAmboss } from "./amboss.js";
import { mockAmboss } from "./mock-amboss.js";
import {
  getRate,
  getInvoiceUsdRate,
  isUsableBtcRate,
  newSession,
  getSession,
  fundSession,
  publicState,
  recordPayout,
  floatState,
  reference,
} from "./store.js";
import {
  clientIp,
  createPinGuard,
  createRateLimiter,
  healthzTokenOk,
  htmlSecurityHeaders,
  isDirectLoopback,
  newSecretId,
  publicErrorMessage,
  redactHealth,
  resolvePublicFile,
  SECURITY_HEADERS,
} from "./security.js";
import {
  coreSlashRedirectLocation,
  dirHasIndex,
  isApiPath,
  isHealthzPath,
  publicDirFor,
  resolveHostLayout,
  splitMount,
} from "./hosts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const BOOTH_DIR = path.join(here, "..", "public");
const CORE_DIR = path.join(here, "..", "public-core");
const hostLayout = resolveHostLayout({
  requested: config.cashierPackage,
  boothExists: dirHasIndex(BOOTH_DIR),
  coreExists: dirHasIndex(CORE_DIR),
});
const api = config.mock ? mockAmboss : liveAmboss;
const rateLimited = createRateLimiter();
const pinGuard = createPinGuard();
const mockSettleAllowed = config.mock && process.env.NODE_ENV !== "production";

assertReady();
if (hostLayout.warning) console.warn(`[warn] ${hostLayout.warning}`);

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
    ...SECURITY_HEADERS,
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

function requestHeader(req, name) {
  const raw = req.headers && req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw || "";
}

function sessionIdFrom(req, url, body) {
  return (
    (body && body.sessionId) ||
    requestHeader(req, "x-cashier-session") ||
    url.searchParams.get("s") ||
    ""
  );
}

/* ------------------------------------------------------- destinations --- */

export function parseDestination(raw) {
  const input = normalizeScannedText(raw).replace(/^[\uFF04\uFE69]/, "$");
  if (!input) return { kind: "invalid", reason: "Enter a destination." };

  const cashApp = /^(?:https?:\/\/)?(?:www\.)?cash\.app\/\$?([a-z0-9_]{1,20})\/?$/i.exec(input);
  if (cashApp) {
    const tag = cashApp[1].toLowerCase();
    return { kind: "address", display: `$${tag}`, address: `${tag}@cash.app` };
  }

  const lnurlp = /^(?:https?:\/\/)?(?:www\.)?([^/\s]+)\/\.well-known\/lnurlp\/([a-z0-9._-]+)/i.exec(input);
  if (lnurlp) {
    const address = `${lnurlp[2]}@${lnurlp[1]}`.toLowerCase();
    const tag = address.endsWith("@cash.app") ? address.slice(0, -"@cash.app".length) : null;
    return { kind: "address", display: tag ? `$${tag}` : address, address };
  }

  if (/^\$[a-z0-9_]{1,20}$/i.test(input))
    return {
      kind: "address",
      display: `$${input.slice(1)}`,
      address: `${input.slice(1).toLowerCase()}@cash.app`,
    };

  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(input)) {
    const address = input.toLowerCase();
    const tag = address.endsWith("@cash.app") ? address.slice(0, -"@cash.app".length) : null;
    return { kind: "address", display: tag ? `$${tag}` : address, address };
  }

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

/* Only treat a send as "this wallet cannot pay Lightning addresses" when the
   API says that. A generic "not available" (routing, liquidity) used to match
   and flip the booth to invoice-only for the rest of the day. */
export function addressSendLooksUnsupported(message) {
  return /lightning address.{0,80}not (yet )?supported|address sends?.{0,80}not (yet )?supported|not (yet )?supported.{0,80}(lightning address|taproot)/i.test(
    String(message || "")
  );
}

export function addressPayoutState() {
  return { ...addressPayouts };
}

const pendingDeposits = new Map(); // txId -> { sessionId, amountUsd, rate }
const pendingWithdrawals = new Map(); // txId -> { sessionId, amountUsd, localId }

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  const method = req.method;
  const route = url.pathname.replace(/^\/api/, "") || "/";

  if (route === "/config" && method === "GET") {
    let usdPerBtc = null;
    let rateSource = null;
    try {
      const rate = await getInvoiceUsdRate();
      if (isUsableBtcRate(rate)) {
        usdPerBtc = rate.usdPerBtc;
        rateSource = rate.source;
      }
    } catch (e) {
      /* Deposits and dollar cashtag/address payouts do not need this. Invoice
         cash-outs will fail loudly rather than price against $1/BTC. */
    }
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
      fundEnabled: Boolean(config.fundEnabled),
      pinRequired: Boolean(config.fundEnabled),
      mock: config.mock,
      usdPerBtc,
      rateSource,
    });
  }

  if (route === "/session" && method === "POST") {
    if (rateLimited(ip, 1, 40)) return fail(res, 429, "Slow down.");
    return send(res, 200, publicState(newSession()));
  }

  const body = method === "POST" ? await readBody(req).catch(() => null) : {};
  if (body === null) return fail(res, 400, "Body is not JSON.");
  /* Mock-only test hook, deliberately ahead of the session gate.
     Disabled when NODE_ENV=production even if MOCK_AMBOSS=1. */
  if (route.startsWith("/dev/settle/") && method === "POST") {
    if (!mockSettleAllowed) return fail(res, 404, "No such endpoint.");
    const target = decodeURIComponent(route.slice("/dev/settle/".length));
    const settled = target === "all" ? mockAmboss.settleAll(body) : mockAmboss.settle(target, body);
    return send(res, 200, { ok: true, settled });
  }

  const sessionId = sessionIdFrom(req, url, body);
  const session = sessionId ? getSession(sessionId) : null;

  if (route !== "/health" && !session) return fail(res, 409, "Session expired. Start a new one.");

  if (route === "/state" && method === "GET") return send(res, 200, publicState(session));

  if (route === "/session/fund" && method === "POST") {
    if (rateLimited(ip, 1, 20)) return fail(res, 429, "Slow down.");
    const gate = pinGuard.allowed(ip);
    if (!gate.ok) return fail(res, 429, "Too many PIN attempts. Try later.");
    const result = fundSession(session, String(body.pin || ""));
    if (result.error) {
      if (result.error === "Wrong pin.") pinGuard.fail(ip);
      return fail(res, 403, result.error);
    }
    pinGuard.ok(ip);
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
      return fail(res, 502, publicErrorMessage(e, "Could not create a deposit invoice. Try again."));
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
      return send(res, 200, { status: "pending" });
    }
  }

  /* --------------------------------------------------------- withdraw --- */
  if (route === "/withdraw" && method === "POST") {
    if (rateLimited(ip, 1, 30)) return fail(res, 429, "Slow down.");
    const dest = parseDestination(body.destination);
    if (dest.kind === "invalid") return fail(res, 400, dest.reason);
    if (dest.kind === "address" && !addressPayouts.supported)
      return fail(res, 400, "This wallet pays invoices only. Ask for an invoice with an amount on it.");

    let amountUsd;
    let walletRate;
    let btcUsdRate = null;
    if (dest.kind === "invoice") {
      /* A BOLT11 invoice is sat-denominated no matter what the wallet
         settles in -- always price it against the real BTC/USD rate, never
         the stablecoin "1" shortcut. Getting this wrong previously let an
         invoice worth hundreds of real dollars pass the cap check thinking
         it cost a fraction of a cent. */
      try {
        ({ usdPerBtc: btcUsdRate } = await getInvoiceUsdRate());
      } catch (e) {
        return fail(
          res,
          503,
          "No usable exchange rate right now. Invoice cash-outs are blocked so we do not send the wrong amount."
        );
      }
      amountUsd = round2((dest.satAmount / 1e8) * btcUsdRate);
      ({ usdPerBtc: walletRate } = await getRate());
    } else {
      amountUsd = round2(Number(body.amountUsd));
      if (!isFinite(amountUsd) || amountUsd <= 0) return fail(res, 400, "Enter an amount.");
      ({ usdPerBtc: walletRate } = await getRate());
      /* Cashtag / Lightning address sends go through LNURL. The SDK field
         is amountSats, so we need a real BTC/USD rate even on USDT — not
         to price the player's dollars, but to express those dollars in sats.
         Wallet minor units stay separate ($1 USDT → 1_000_000). */
      if (dest.kind === "address") {
        try {
          ({ usdPerBtc: btcUsdRate } = await getInvoiceUsdRate());
        } catch (e) {
          return fail(
            res,
            503,
            "No usable exchange rate right now. Cash-outs are blocked so we do not send the wrong amount."
          );
        }
      }
    }

    if (amountUsd < config.minWithdrawUsd || amountUsd > config.maxWithdrawUsd)
      return fail(res, 400, `Cash outs run from $${config.minWithdrawUsd} to $${config.maxWithdrawUsd} here.`);
    if (amountUsd > session.balanceUsd)
      return fail(res, 400, `Balance is $${round2(session.balanceUsd).toFixed(2)}.`);

    /* Debit first, refund on failure. */
    session.balanceUsd = round2(session.balanceUsd - amountUsd);
    const localId = newSecretId("w");
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
              ...addressSendAmounts(amountUsd, walletRate, btcUsdRate ?? walletRate),
              idempotencyKey,
              metadata: { demo: "cashier" },
            });
      if (dest.kind === "address" && String(tx.status || "").toLowerCase() === "completed") {
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
      if (dest.kind === "address" && addressSendLooksUnsupported(e.message)) {
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
      return fail(res, 502, publicErrorMessage(e, "Cash out did not go through. Nothing left this account."));
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
        balanceUsd: round2(session.balanceUsd),
      });
    } catch (e) {
      console.error("[withdraw poll]", e.message);
      return send(res, 200, { status: "pending" });
    }
  }

  return fail(res, 404, "No such endpoint.");
}

function finalizeWithdrawal(session, entry, status, amountUsd, error) {
  entry.status = status;
  if (status === "failed") {
    entry.note = "Returned to your balance";
    if (error) console.error("[withdraw fail]", error);
    session.balanceUsd = round2(session.balanceUsd + amountUsd);
  } else {
    recordPayout(amountUsd);
  }
}

/* ------------------------------------------------------------- health --- */

async function health(req, res, url) {
  const out = {
    ok: false,
    asset: config.asset,
    mock: config.mock,
    package: hostLayout.mode,
    packages: {
      booth: { available: Boolean(hostLayout.booth.available), path: hostLayout.booth.path },
      core: { available: Boolean(hostLayout.core.available), path: hostLayout.core.path },
    },
    addressPayouts: addressPayoutState(),
    float: floatState(),
    fundEnabled: Boolean(config.fundEnabled),
    checks: {},
  };
  try {
    const rate = await getInvoiceUsdRate();
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
  try {
    const send = await api.sendReady();
    out.checks.send = send;
  } catch (e) {
    out.checks.send = { ok: false, error: e.message };
  }
  out.ok = Object.values(out.checks).every((c) => c.ok);
  const detailed = isDirectLoopback(req) || healthzTokenOk(req, config.healthzToken, url);
  return send(res, out.ok ? 200 : 503, detailed ? out : redactHealth(out));
}

/* ------------------------------------------------------------- static --- */

function serveStatic(req, res, url, publicDir) {
  const file = resolvePublicFile(publicDir, url.pathname);
  if (!file) return fail(res, 403, "No.");
  const headersFor = (target) => {
    const type = MIME[path.extname(target)] || "application/octet-stream";
    const html = target.endsWith(".html");
    return {
      "content-type": type,
      "cache-control": html ? "no-store" : "public, max-age=300",
      ...(html ? htmlSecurityHeaders() : SECURITY_HEADERS),
    };
  };

  fs.readFile(file, (err, data) => {
    if (err) {
      if (url.pathname === "/" || url.pathname === "/index.html") return fail(res, 404, "Not found.");
      const index = resolvePublicFile(publicDir, "/index.html");
      if (!index) return fail(res, 404, "Not found.");
      return fs.readFile(index, (e2, html) => {
        if (e2) return fail(res, 404, "Not found.");
        res.writeHead(200, headersFor(index));
        res.end(html);
      });
    }
    res.writeHead(200, headersFor(file));
    res.end(data);
  });
}

/* --------------------------------------------------------------- boot --- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    const dual = hostLayout.mode === "dual";
    const split = dual
      ? splitMount(url.pathname)
      : { mount: "root", rest: url.pathname, trailingSlashRedirect: false };

    if (dual && split.trailingSlashRedirect && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(308, {
        location: coreSlashRedirectLocation(),
        ...SECURITY_HEADERS,
      });
      return res.end();
    }

    const routed = new URL(url);
    routed.pathname = split.rest;
    const publicDir = publicDirFor(hostLayout, split.mount, BOOTH_DIR, CORE_DIR);

    if (isHealthzPath(routed.pathname)) return await health(req, res, routed);
    if (isApiPath(routed.pathname)) return await handleApi(req, res, routed);
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed.");
    return serveStatic(req, res, routed, publicDir);
  } catch (e) {
    console.error("[unhandled]", e);
    return fail(res, 500, "Something broke on the server.");
  }
});

server.listen(config.port, config.bindHost, () => {
  console.log(`cashier demo on ${config.bindHost}:${config.port}`);
  console.log(`  package          ${hostLayout.mode}`);
  if (hostLayout.booth.available)
    console.log(`  booth            ${hostLayout.booth.path} (${BOOTH_DIR})`);
  if (hostLayout.core.available)
    console.log(`  core             ${hostLayout.core.path} (${CORE_DIR})`);
  console.log(`  asset            ${config.asset}${config.mock ? " (mock Amboss)" : ""}`);
  console.log(`  address payouts  ${config.addressPayouts ? "on" : "off, invoices only"}`);
  console.log(
    `  send path        ${
      config.mock
        ? "mock"
        : config.teamPassword
          ? "SDK + team password"
          : "SDK (sandbox, no password)"
    }`
  );
  console.log(`  caps             deposit $${config.maxDepositUsd}, cash out $${config.maxWithdrawUsd}`);
  console.log(`  daily float      $${config.dailyFloatUsd}`);
});

export { server, hostLayout };
