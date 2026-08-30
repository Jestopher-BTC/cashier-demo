/* Amboss Payments API client.
   One GraphQL endpoint, x-api-key auth, amounts as decimal strings in the
   asset's minor units. Docs: https://docs.amboss.tech/payments/integrate */

import { config } from "./config.js";

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

  /* Seam 1. Mint an invoice for the player to pay. */
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

  /* Seam 3a. Pay a BOLT11 invoice. Amount comes from the invoice. */
  async sendBolt11({ bolt11, idempotencyKey, metadata }) {
    const data = await gql(
      `mutation CreateSend($input: CreateSendTransactionInput!) {
         payment { transaction { create_send(input: $input) { ${TX_FIELDS} } } }
       }`,
      {
        input: {
          wallet_id: config.walletId,
          request: { bolt11 },
          idempotency_key: idempotencyKey,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
        },
      },
      "transaction.create_send"
    );
    return data.payment.transaction.create_send;
  },

  /* Seam 3b. Pay a Lightning address. Not available on Taproot Asset wallets,
     which is why config.addressPayouts gates this path. */
  async sendAddress({ lightningAddress, amountMinor, idempotencyKey, metadata }) {
    const data = await gql(
      `mutation CreateSend($input: CreateSendTransactionInput!) {
         payment { transaction { create_send(input: $input) { ${TX_FIELDS} } } }
       }`,
      {
        input: {
          wallet_id: config.walletId,
          address: { lightning_address: lightningAddress, amount: String(amountMinor) },
          idempotency_key: idempotencyKey,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
        },
      },
      "transaction.create_send"
    );
    return data.payment.transaction.create_send;
  },
};
