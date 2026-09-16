/* Every knob for the booth lives here. Read once at boot so a bad value fails
   loudly at startup rather than in front of a prospect. */

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}
function num(name, fallback) {
  const v = env(name, null);
  if (v === null) return fallback;
  const n = Number(v);
  if (!isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}
function bool(name, fallback) {
  const v = env(name, null);
  if (v === null) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

const asset = env("AMBOSS_ASSET", "BTC").toUpperCase();
if (!["BTC", "USDT", "USDC"].includes(asset))
  throw new Error(`AMBOSS_ASSET must be BTC, USDT, or USDC, got "${asset}"`);

/* FUND_ENABLED kill switch. Unset or blank defaults to on. false / 0 / no
   (also off) turn Fund off even when a PIN is still set. */
export function parseFundEnabledFlag(raw) {
  if (raw == null) return true;
  const v = String(raw).trim().toLowerCase();
  if (!v) return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/* Fund is on only when FUND_ENABLED is on AND OPERATOR_PIN is non-empty.
   An empty PIN used to skip auth and grant float; treat "no PIN" as disabled. */
export function resolveFundEnabled(operatorPin, fundFlag) {
  if (fundFlag === false) return false;
  return Boolean(String(operatorPin || "").trim());
}

const operatorPin = String(env("OPERATOR_PIN", "")).trim();
const fundEnabled = resolveFundEnabled(operatorPin, parseFundEnabledFlag(process.env.FUND_ENABLED));

/* dual (default) = booth at / and core at /core/ when both builds exist.
   booth / core = single static tree at / (the old CASHIER_PACKAGE flip). */
export function parseCashierPackage(raw) {
  const v = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!v || v === "dual" || v === "both") return "dual";
  if (v === "booth" || v === "core") return v;
  throw new Error(`CASHIER_PACKAGE must be dual, booth, or core, got "${raw}"`);
}

const cashierPackage = parseCashierPackage(env("CASHIER_PACKAGE", ""));

export const config = {
  port: num("PORT", 8080),
  /* Production (NODE_ENV=production, including the systemd unit) binds
     loopback so Caddy is the only public door. Override with BIND_HOST. */
  bindHost: env("BIND_HOST", process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0"),
  mock: bool("MOCK_AMBOSS", false),
  /* dual = booth at / and core at /core/ (default when both builds exist).
     booth / core = single-tree fallback; core is then served at /. */
  cashierPackage,
  /* Optional. When set, GET /healthz?token=... (or X-Healthz-Token) returns
     wallet id, balances, and float remaining. Leave blank: those details are
     only on a direct loopback request, not through Caddy. */
  healthzToken: env("HEALTHZ_TOKEN", ""),

  graphqlUrl: env("AMBOSS_GRAPHQL_URL", "https://app.amboss.tech/graphql"),
  apiKey: env("AMBOSS_API_KEY", ""),
  walletId: env("AMBOSS_WALLET_ID", ""),
  /* Team password for the official Payments SDK send path. Decrypts the node
     macaroon in-process; never sent to the API. Required for live payouts.
     TEAM_PASSWORD is accepted as an alias. */
  teamPassword: env("AMBOSS_TEAM_PASSWORD", "") || env("TEAM_PASSWORD", ""),
  /* Optional Argon2 salt override. The SDK reads team_id from the wallet. */
  teamId: env("AMBOSS_TEAM_ID", ""),

  asset,
  /* BTC counts in sats (precision 8). Stablecoins count in micro-units (6). */
  precision: asset === "BTC" ? 8 : 6,
  /* The published docs say Lightning address sends do not work from Taproot
     Asset wallets. The Amboss team says that note is stale. We default to
     trusting the team, verify it with probe-address-payout.mjs before the
     event, and fall back automatically at runtime if a send comes back
     unsupported. Set ADDRESS_PAYOUTS=false to force invoice-only. */
  addressPayouts: bool("ADDRESS_PAYOUTS", true),

  rateSource: env("RATE_SOURCE", "live"),
  usdPerBtc: num("USD_PER_BTC", 100000),

  minDepositUsd: num("MIN_DEPOSIT_USD", 1),
  maxDepositUsd: num("MAX_DEPOSIT_USD", 5),
  minWithdrawUsd: num("MIN_WITHDRAW_USD", 1),
  maxWithdrawUsd: num("MAX_WITHDRAW_USD", 5),

  /* Free balance handed to a visitor when the operator taps Fund. On only when
     FUND_ENABLED is on (default) AND OPERATOR_PIN is set. Either kill switch
     grays the button out and makes /session/fund refuse. */
  sessionStartUsd: num("SESSION_START_USD", 2),
  dailyFloatUsd: num("DAILY_FLOAT_USD", 25),
  operatorPin,
  fundEnabled,

  invoiceSeconds: num("INVOICE_SECONDS", 180),
  live: true,
};

export function isSandboxApiKey(key = config.apiKey) {
  return String(key || "").startsWith("amb_test_");
}

export function isLiveApiKey(key = config.apiKey) {
  return String(key || "").startsWith("amb_live_");
}

export function assertReady() {
  if (config.mock) return;
  const missing = [];
  if (!config.apiKey) missing.push("AMBOSS_API_KEY");
  if (!config.walletId) missing.push("AMBOSS_WALLET_ID");
  if (missing.length)
    throw new Error(
      `Missing ${missing.join(" and ")}. Set them in .env, or run with MOCK_AMBOSS=1 to work without the API.`
    );
  /* Live payouts go through payments.transactions.send, which decrypts the
     node macaroon with the team password. Sandbox keys (amb_test_) settle
     server-side and do not need it. */
  if (!config.teamPassword && !isSandboxApiKey())
    throw new Error(
      "Missing AMBOSS_TEAM_PASSWORD. Live payouts use the Amboss Payments SDK send path, which needs the team password to decrypt wallet credentials. Set it in .env. The API key must also have WALLET_CREDENTIALS: READ (and WALLETS: READ, PAYMENTS: WRITE), scoped to AMBOSS_WALLET_ID."
    );
  if (config.asset === "BTC" && config.rateSource === "static" && config.usdPerBtc === 100000)
    console.warn("[warn] RATE_SOURCE=static with the default USD_PER_BTC. Set a real rate.");
  if (config.mock && process.env.NODE_ENV === "production")
    console.warn("[warn] MOCK_AMBOSS=1 with NODE_ENV=production. /api/dev/settle is disabled. Do not demo this as live.");
  if (config.fundEnabled && config.operatorPin.length < 6)
    console.warn("[warn] OPERATOR_PIN is shorter than 6 characters. A public Fund endpoint will not survive a brute-force. Use 6+ digits.");
}

/* --------------------------------------------------------------- money --- */

export const money = {
  /* USD to the wallet asset's minor unit. USDT/USDC ignore the BTC rate:
     $1 → 1_000_000 (precision 6). Never multiply a stablecoin cash-out by
     usdPerBtc — that is how $1 became ~btcPrice/100 on the live wallet. */
  usdToMinor(amountUsd, rate) {
    if (config.asset === "BTC") return Math.round((amountUsd / rate) * 1e8);
    return Math.round(amountUsd * 10 ** config.precision);
  },
  minorToUsd(minor, rate) {
    const n = Number(minor);
    if (config.asset === "BTC") return round2((n / 1e8) * rate);
    return round2(n / 10 ** config.precision);
  },
  /* Satoshis for a dollar amount. Lightning addresses resolve over LNURL,
     which is sat-denominated even when the wallet settles in USDT. The SDK
     field is amountSats; passing USDT micro-units (1_000_000 for $1) is
     read as 1e6 sats = 0.01 BTC ≈ $800. Requires a real BTC/USD rate. */
  usdToSats(amountUsd, usdPerBtc) {
    if (!isFinite(usdPerBtc) || usdPerBtc <= 1000)
      throw new Error("usdToSats requires a real BTC/USD rate");
    return Math.round((amountUsd / usdPerBtc) * 1e8);
  },
  /* What the payer's wallet will show. Only knowable for a BTC wallet; for a
     stablecoin wallet Amboss picks the sats amount at settlement. */
  satsForDisplay(amountUsd, rate) {
    return config.asset === "BTC" ? Math.round((amountUsd / rate) * 1e8) : null;
  },
};

/* Wallet minor units plus the sats figure the Live SDK send path needs.
   amountMinor is what create_receive and session math use ($1 USDT → 1e6).
   amountSats is what transactions.send puts on address.amount (LNURL sats). */
export function addressSendAmounts(amountUsd, walletRate, btcUsdRate) {
  return {
    amountMinor: money.usdToMinor(amountUsd, walletRate),
    amountSats: money.usdToSats(amountUsd, btcUsdRate),
  };
}

export const round2 = (n) => Math.round(n * 100) / 100;
