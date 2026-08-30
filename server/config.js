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

export const config = {
  port: num("PORT", 8080),
  mock: bool("MOCK_AMBOSS", false),

  graphqlUrl: env("AMBOSS_GRAPHQL_URL", "https://app.amboss.tech/graphql"),
  apiKey: env("AMBOSS_API_KEY", ""),
  walletId: env("AMBOSS_WALLET_ID", ""),

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

  /* Free balance handed to a visitor when the operator taps Fund. Guarded by
     the pin and by the daily cap below. */
  sessionStartUsd: num("SESSION_START_USD", 2),
  dailyFloatUsd: num("DAILY_FLOAT_USD", 25),
  operatorPin: env("OPERATOR_PIN", ""),

  invoiceSeconds: num("INVOICE_SECONDS", 180),
  live: true,
};

export function assertReady() {
  if (config.mock) return;
  const missing = [];
  if (!config.apiKey) missing.push("AMBOSS_API_KEY");
  if (!config.walletId) missing.push("AMBOSS_WALLET_ID");
  if (missing.length)
    throw new Error(
      `Missing ${missing.join(" and ")}. Set them in .env, or run with MOCK_AMBOSS=1 to work without the API.`
    );
  if (config.asset === "BTC" && config.rateSource === "static" && config.usdPerBtc === 100000)
    console.warn("[warn] RATE_SOURCE=static with the default USD_PER_BTC. Set a real rate.");
}

/* --------------------------------------------------------------- money --- */

export const money = {
  /* USD to the wallet asset's minor unit. */
  usdToMinor(amountUsd, rate) {
    if (config.asset === "BTC") return Math.round((amountUsd / rate) * 1e8);
    return Math.round(amountUsd * 10 ** config.precision);
  },
  minorToUsd(minor, rate) {
    const n = Number(minor);
    if (config.asset === "BTC") return round2((n / 1e8) * rate);
    return round2(n / 10 ** config.precision);
  },
  /* What the payer's wallet will show. Only knowable for a BTC wallet; for a
     stablecoin wallet Amboss picks the sats amount at settlement. */
  satsForDisplay(amountUsd, rate) {
    return config.asset === "BTC" ? Math.round((amountUsd / rate) * 1e8) : null;
  },
};

export const round2 = (n) => Math.round(n * 100) / 100;
