/* Official @ambosstech/payments cheat-sheet for Code View.
   Snippets match the current TypeScript SDK docs. Do not present the
   React mock seams (createInvoice, sendPayment) as the real API. */

export const DOCS = {
  gettingStarted: "https://docs.amboss.tech/sdk/getting-started",
  transactions: "https://docs.amboss.tech/sdk/transactions",
  webhooks: "https://docs.amboss.tech/sdk/webhooks",
};

export const MAP_LINE = {
  mock: "mockApi.createInvoice",
  sdk: "payments.transactions.createReceive",
};

export const SANDBOX_META = 'metadata: { amb_sandbox_behavior: "complete" }';

export const SNIPPETS = [
  {
    id: "receive",
    title: "Receive",
    action: "deposit",
    hint: "Highlighted from Deposit",
    docs: [
      { label: "Transactions", href: DOCS.transactions },
      { label: "Getting started", href: DOCS.gettingStarted },
    ],
    note: "Mint a Lightning invoice. amount is base units: sats for BTC, 1e6 for USDT. This is not mockApi.createInvoice.",
    code:
      'import { Payments } from "@ambosstech/payments";\n' +
      "\n" +
      "const payments = new Payments({\n" +
      "  serviceApiKey: process.env.AMBOSS_API_KEY,\n" +
      "});\n" +
      "\n" +
      "const transaction = await payments.transactions.createReceive({\n" +
      "  wallet_id: walletId,\n" +
      '  amount: "1000", // base units, not dollars\n' +
      '  description: "Deposit",\n' +
      "  metadata: { amb_sandbox_behavior: \"complete\" },\n" +
      "});\n" +
      "\n" +
      "transaction.payment_request; // BOLT11 to show as a QR",
  },
  {
    id: "send",
    title: "Send",
    action: "withdraw",
    hint: "Highlighted from Cash out",
    docs: [{ label: "Transactions", href: DOCS.transactions }],
    note: "Live send needs the team password and an API key with WALLETS:READ plus WALLET_CREDENTIALS:READ, scoped to this wallet. Sandbox needs no password.",
    code:
      'import { Payments } from "@ambosstech/payments";\n' +
      "\n" +
      "const payments = new Payments({\n" +
      "  serviceApiKey: process.env.AMBOSS_API_KEY,\n" +
      "});\n" +
      "\n" +
      "const { transaction, payment } = await payments.transactions.send({\n" +
      "  walletId,\n" +
      "  password, // live team password; omit on sandbox\n" +
      "  destination: {\n" +
      '    lightningAddress: "player@cash.app",\n' +
      '    amountSats: "1000",\n' +
      "  },\n" +
      "  // destination: { bolt11: \"lnbc1...\" },\n" +
      "  metadata: { amb_sandbox_behavior: \"complete\" },\n" +
      "});",
  },
  {
    id: "webhook",
    title: "Webhook",
    action: null,
    hint: "",
    docs: [{ label: "Webhooks", href: DOCS.webhooks }],
    note: "Verify the HMAC before you credit a balance. Pass the raw body and the signature headers. The booth polls because it has no inbound URL.",
    code:
      'import { Payments } from "@ambosstech/payments";\n' +
      "\n" +
      "const payments = new Payments({\n" +
      "  serviceApiKey: process.env.AMBOSS_API_KEY,\n" +
      "  webhookSecret: process.env.AMBOSS_WEBHOOK_SECRET,\n" +
      "});\n" +
      "\n" +
      "const event = payments.webhooks.verify({\n" +
      "  payload: rawBody, // RAW request body, not parsed JSON\n" +
      '  signature: headers["x-webhook-signature"],\n' +
      '  timestamp: headers["x-webhook-timestamp"],\n' +
      "});",
  },
];

export function snippetById(id) {
  var i;
  for (i = 0; i < SNIPPETS.length; i++) {
    if (SNIPPETS[i].id === id) return SNIPPETS[i];
  }
  return SNIPPETS[0];
}

export function snippetIdForAction(action) {
  if (action === "deposit") return "receive";
  if (action === "withdraw") return "send";
  return "receive";
}
