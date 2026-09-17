/* Request-facing security helpers. Kept out of server.js so tests can cover
   PIN lockout, client IP, public errors, and static-path rules without booting
   the whole cashier. */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

export const SESSION_ID_BYTES = 16;

export function newSecretId(prefix = "s") {
  return prefix + "_" + crypto.randomBytes(SESSION_ID_BYTES).toString("hex");
}

export function looksLikeSessionId(id) {
  return typeof id === "string" && /^s_[a-f0-9]{32}$/.test(id);
}

/* Constant-time PIN compare. Length mismatch still runs a dummy compare so
   a 3-digit guess is not a cheap reject next to a 6-digit PIN. */
export function pinMatches(input, expected) {
  const a = Buffer.from(String(input || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (!b.length) return false;
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function createPinGuard({
  maxAttempts = 8,
  windowMs = 15 * 60 * 1000,
  lockMs = 15 * 60 * 1000,
  globalMax = 40,
} = {}) {
  const byKey = new Map();
  const globalFails = [];

  function bucket(key) {
    const now = Date.now();
    let b = byKey.get(key);
    if (!b) {
      b = { fails: [], lockedUntil: 0 };
      byKey.set(key, b);
    }
    b.fails = b.fails.filter((t) => now - t < windowMs);
    if (b.lockedUntil && b.lockedUntil <= now) b.lockedUntil = 0;
    return b;
  }

  function globalLocked(now = Date.now()) {
    while (globalFails.length && now - globalFails[0] >= windowMs) globalFails.shift();
    return globalFails.length >= globalMax;
  }

  return {
    allowed(key) {
      const now = Date.now();
      if (globalLocked(now)) return { ok: false, reason: "locked" };
      const b = bucket(key);
      if (b.lockedUntil > now) return { ok: false, reason: "locked" };
      return { ok: true };
    },
    fail(key) {
      const now = Date.now();
      const b = bucket(key);
      b.fails.push(now);
      globalFails.push(now);
      if (b.fails.length >= maxAttempts) b.lockedUntil = now + lockMs;
      return { locked: b.lockedUntil > now || globalLocked(now), remaining: Math.max(0, maxAttempts - b.fails.length) };
    },
    ok(key) {
      const b = byKey.get(key);
      if (b) {
        b.fails = [];
        b.lockedUntil = 0;
      }
    },
    reset() {
      byKey.clear();
      globalFails.length = 0;
    },
  };
}

/* Token bucket. perMinute is the refill rate and the burst cap. */
export function createRateLimiter() {
  const buckets = new Map();
  return function rateLimited(key, cost = 1, perMinute = 60) {
    const now = Date.now();
    const id = String(key || "unknown");
    const b = buckets.get(id) || { tokens: perMinute, at: now };
    const refill = ((now - b.at) / 60000) * perMinute;
    b.tokens = Math.min(perMinute, b.tokens + refill);
    b.at = now;
    if (b.tokens < cost) {
      buckets.set(id, b);
      return true;
    }
    b.tokens -= cost;
    buckets.set(id, b);
    return false;
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function isLoopbackAddress(addr) {
  if (!addr) return false;
  const host = String(addr).replace(/^\[|\]$/g, "");
  return LOOPBACK.has(host);
}

/* Caddy (and most reverse proxies) append the TCP peer they saw. Trust
   X-Forwarded-For / X-Real-IP only when the socket peer is loopback. */
export function clientIp(req) {
  const peer = req.socket && req.socket.remoteAddress;
  if (!isLoopbackAddress(peer)) return peer || "unknown";
  const real = headerValue(req, "x-real-ip");
  if (real && !/,/.test(real)) return real.trim() || peer;
  const xff = headerValue(req, "x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return peer || "unknown";
}

function headerValue(req, name) {
  const raw = req.headers && req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw || "";
}

export function isDirectLoopback(req) {
  const peer = req.socket && req.socket.remoteAddress;
  if (!isLoopbackAddress(peer)) return false;
  return !headerValue(req, "x-forwarded-for") && !headerValue(req, "x-real-ip");
}

export function healthzTokenOk(req, token, url) {
  const expected = String(token || "").trim();
  if (!expected) return false;
  const given =
    headerValue(req, "x-healthz-token") ||
    (url && url.searchParams && url.searchParams.get("token")) ||
    "";
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function redactHealth(full) {
  const checks = full.checks || {};
  const rate = checks.rate || {};
  const wallet = checks.wallet || {};
  const send = checks.send || {};
  return {
    ok: Boolean(full.ok),
    asset: full.asset,
    mock: Boolean(full.mock),
    package: full.package,
    ...(full.packages
      ? {
          packages: {
            booth: {
              available: Boolean(full.packages.booth && full.packages.booth.available),
              path: full.packages.booth ? full.packages.booth.path : null,
            },
            core: {
              available: Boolean(full.packages.core && full.packages.core.available),
              path: full.packages.core ? full.packages.core.path : null,
            },
          },
        }
      : {}),
    addressPayouts: {
      supported: Boolean(full.addressPayouts && full.addressPayouts.supported),
      verified: Boolean(full.addressPayouts && full.addressPayouts.verified),
    },
    float: { enabled: Boolean(full.fundEnabled) },
    checks: {
      rate: {
        ok: Boolean(rate.ok),
        usdPerBtc: rate.ok ? rate.usdPerBtc : undefined,
        source: rate.ok ? rate.source : undefined,
      },
      wallet: { ok: Boolean(wallet.ok), is_ready: Boolean(wallet.is_ready) },
      send: { ok: Boolean(send.ok), prepared: Boolean(send.prepared) },
    },
  };
}

const USER_FACING =
  /^(Deposits run from|Cash outs run from|Balance is \$|Enter a |Enter an amount|That invoice|That rounds|Amountless|This wallet pays|Session expired|Funding is off|Wrong pin|Slow down|Daily demo float|Unknown deposit|Unknown cash out|Body is not JSON|No such endpoint|Method not allowed|No usable exchange rate|Invoice cash-outs|Cash-outs are blocked|Too many PIN)/;

/* Amboss / Node errors must not reach the browser. 4xx copy we wrote ourselves
   can. */
export function publicErrorMessage(err, fallback) {
  const msg = err && typeof err === "object" && err.message ? String(err.message) : String(err || "");
  if (USER_FACING.test(msg) && msg.length < 180) return msg;
  return fallback || "Something broke on the server.";
}

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
  "x-dns-prefetch-control": "off",
};

/* script-src is 'self' only. Live boot is cashier-config.js on the same
   origin (public/ and public-core/). Do not add 'unsafe-inline' to paper
   over an inline window.__CASHIER__ tag. style-src keeps 'unsafe-inline'
   because the booth chrome CSS is in a <style> block. */
export function htmlSecurityHeaders() {
  return {
    ...SECURITY_HEADERS,
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

export function resolvePublicFile(publicDir, urlPath) {
  let rel = String(urlPath || "/");
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  if (rel.endsWith("/")) rel += "index.html";
  const root = path.resolve(publicDir);
  const relative = path.normalize(rel).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = path.resolve(root, relative);
  const extra = path.relative(root, file);
  if (!extra || extra.startsWith("..") || path.isAbsolute(extra)) return null;
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      const index = path.resolve(file, "index.html");
      const extraIndex = path.relative(root, index);
      if (extraIndex.startsWith("..") || path.isAbsolute(extraIndex)) return null;
      return index;
    }
  } catch {
    return file;
  }
  return file;
}
