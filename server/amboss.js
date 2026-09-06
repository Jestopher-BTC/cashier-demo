/* Amboss Payments client.
   Receives and polls stay on the GraphQL API. Live payouts use the official
   TypeScript SDK send path — the same one the Amboss Payments UI uses.

   payments.transactions.send:
     1. create_send (gets a payment_request)
     2. derive Argon2id master key from the team password (stays in-process)
     3. read node_permissions with the password_hash (needs WALLET_CREDENTIALS)
     4. decrypt the admin macaroon, pay the node REST endpoint

   Calling create_send alone is what the demo used to do. That is why payouts
   worked in the Amboss UI and failed here. */

import { Payments, DecryptionError, PaymentSendError } from "@ambosstech/payments";
import { config, isSandboxApiKey } from "./config.js";

async function gql(query, variables, label) {
  const res = await fetch(config.graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new Error(`${label}: ${res.status} returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (body.errors && body.errors.length) {
    const first = body.errors[0];
    const code = first.extensions && first.extensions.code ? ` [${first.extensions.code}]` : "";
    throw new Error(`${label}${code}: ${first.message}`);
  }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return body.data;
}

const TX_FIELDS = `
  id
  status
  payment_hash
  amount { full_amount }
  settle_amount { full_amount }
  exchange_rate
  settled_at
  error
`;

const sdk =
  !config.mock && config.apiKey
    ? new Payments({
        serviceApiKey: config.apiKey,
        baseUrl: config.graphqlUrl,
        send:
          config.teamPassword && config.walletId
            ? [
                {
                  walletId: config.walletId,
                  password: config.teamPassword,
                  ...(config.teamId ? { teamId: config.teamId } : {}),
                },
              ]
            : undefined,
      })
    : null;

function sendCredentials() {
  return {
    walletId: config.walletId,
    ...(config.teamPassword ? { password: config.teamPassword } : {}),
    ...(config.teamId ? { teamId: config.teamId } : {}),
  };
}

async function ensureSendReady() {
  if (!sdk) throw new Error("Amboss Payments SDK is not configured.");
  if (sdk.transactions.isSendReady(config.walletId)) return { ok: true, prepared: true };
  if (!config.teamPassword && !isSandboxApiKey()) {
    throw new Error(
      "AMBOSS_TEAM_PASSWORD is not set. Live payouts cannot run without the team password."
    );
  }
  await sdk.transactions.prepareSend(sendCredentials());
  return { ok: true, prepared: sdk.transactions.isSendReady(config.walletId) };
}

function wrapSendError(e) {
  if (e instanceof DecryptionError)
    throw new Error("Team password could not decrypt the wallet. Check AMBOSS_TEAM_PASSWORD.");
  if (e instanceof PaymentSendError) throw new Error(e.message);
  throw e;
}

function toTx(transaction, payment) {
  let status = transaction.status;
  if (payment && payment.status === "SUCCEEDED") status = "COMPLETED";
  if (payment && payment.status === "FAILED") status = "FAILED";
  return {
    id: transaction.id,
    status,
    payment_hash: transaction.payment_hash,
    amount: transaction.amount,
    settle_amount: transaction.settle_amount || null,
    exchange_rate: transaction.exchange_rate || null,
    settled_at: transaction.settled_at,
    error:
      transaction.error ||
      (payment && payment.status === "FAILED" ? payment.failureReason || "Payment failed" : null),
  };
}

async function sdkSend(destination, idempotencyKey, metadata) {
  try {
    await ensureSendReady();
    /* After prepareSend, omit password so the SDK uses the cached macaroon
       instead of spending another Argon2id pass on every booth payout. */
    const meta = { ...(metadata || {}) };
    if (isSandboxApiKey() && !meta.amb_sandbox_behavior) meta.amb_sandbox_behavior = "complete";
    const { transaction, payment } = await sdk.transactions.send({
      walletId: config.walletId,
      destination,
      idempotencyKey,
      metadata: Object.keys(meta).length ? meta : undefined,
    });
    return toTx(transaction, payment);
  } catch (e) {
    wrapSendError(e);
  }
}

export const amboss = {
  /* Wallet readiness and balance. Used by /healthz at setup time. */
  async wallet() {
    const data = await gql(
      `query GetWallet($id: String!) {
         payment { wallet { find_one(id: $id) {
           id
           is_ready
           balance { balance received sent }
         } } }
       }`,
      { id: config.walletId },
      "wallet.find_one"
    );
    return data.payment.wallet.find_one;
  },

  /* Decrypts the node macaroon (live) or confirms sandbox. Safe to call often. */
  async sendReady() {
    try {
      return await ensureSendReady();
    } catch (e) {
      return { ok: false, prepared: false, error: e.message };
    }
  },

  /* Seam 1. Mint an invoice for the player to pay. No team password. */
  async createReceive({ amountMinor, description, expiresInSeconds, idempotencyKey, metadata }) {
    const data = await gql(
      `mutation CreateReceive($input: CreateReceiveTransactionInput!) {
         payment { transaction { create_receive(input: $input) {
           id
           status
           payment_request
           payment_hash
           expires_at
           amount { display_amount full_amount }
         } } }
       }`,
      {
        input: {
          wallet_id: config.walletId,
          amount: String(amountMinor),
          description,
          expires_in_seconds: expiresInSeconds,
          idempotency_key: idempotencyKey,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
        },
      },
      "transaction.create_receive"
    );
    return data.payment.transaction.create_receive;
  },

  /* Seam 2, polled. Webhooks are the production path; a booth laptop behind
     conference wifi has no inbound URL, so this demo polls instead. */
  async transaction(id) {
    const data = await gql(
      `query GetTransaction($id: String!) {
         payment { transaction { find_one(id: $id) { ${TX_FIELDS} } } }
       }`,
      { id },
      "transaction.find_one"
    );
    return data.payment.transaction.find_one;
  },

  /* Seam 3a. Pay a BOLT11 invoice via the credentialed SDK send path. */
  async sendBolt11({ bolt11, idempotencyKey, metadata }) {
    return sdkSend({ bolt11 }, idempotencyKey, metadata);
  },

  /* Seam 3b. Pay a Lightning address / cashtag via the same SDK send path.
     The SDK field is amountSats and LNURL is sat-denominated. Pass sats
     here, never USDT/USDC micro-units — $1 as 1_000_000 is 0.01 BTC. */
  async sendAddress({ lightningAddress, amountSats, amountMinor, idempotencyKey, metadata }) {
    const sats = amountSats != null ? amountSats : amountMinor;
    if (sats == null) throw new Error("sendAddress requires amountSats");
    return sdkSend({ lightningAddress, amountSats: String(sats) }, idempotencyKey, metadata);
  },
};
