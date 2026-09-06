/* Stand-in for the Amboss Payments API. Same shapes, no network, no money.
   Run the server with MOCK_AMBOSS=1 to rehearse the booth flow at your desk:
   deposits stay PENDING until you POST /api/dev/settle/:id, sends complete
   after a beat. */

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const txs = new Map();

const rand = (n) => Math.floor(Math.random() * n);
const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 12).toUpperCase()}`;

function fakeInvoice(satAmount) {
  let body = "1p";
  for (let i = 0; i < 244; i++) body += BECH32[rand(BECH32.length)];
  return (satAmount > 0 ? `lnbc${satAmount * 10}n` : "lnbc") + body;
}

function hash() {
  let s = "";
  for (let i = 0; i < 64; i++) s += "0123456789abcdef"[rand(16)];
  return s;
}

export const mockAmboss = {
  async wallet() {
    return { id: "mock-wallet", is_ready: true, balance: { balance: "500000", received: "0", sent: "0" } };
  },

  async createReceive({ amountMinor, expiresInSeconds }) {
    const txId = id("tx");
    const tx = {
      id: txId,
      status: "PENDING",
      payment_request: fakeInvoice(Number(amountMinor)),
      payment_hash: hash(),
      expires_at: new Date(Date.now() + (expiresInSeconds || 180) * 1000).toISOString(),
      amount: { full_amount: String(amountMinor) },
      settle_amount: null,
      error: null,
    };
    txs.set(txId, tx);
    return tx;
  },

  async transaction(txId) {
    const tx = txs.get(txId);
    if (!tx) throw new Error(`transaction.find_one: no transaction ${txId}`);
    if (tx.settleAt && Date.now() >= tx.settleAt && tx.status === "PENDING") {
      tx.status = tx.willFail ? "FAILED" : "COMPLETED";
      tx.settled_at = new Date().toISOString();
      tx.settle_amount = { full_amount: tx.amount.full_amount };
      tx.error = tx.willFail ? "mock routing failure" : null;
    }
    return tx;
  },

  async sendBolt11({ bolt11, idempotencyKey }) {
    return send(String(bolt11).length, idempotencyKey);
  },

  async sendAddress({ amountMinor, amountSats, idempotencyKey }) {
    return send(Number(amountMinor), idempotencyKey, amountSats);
  },

  async sendReady() {
    return { ok: true, prepared: true, mock: true };
  },

  /* Test hooks. */
  settle(txId, opts = {}) {
    const tx = txs.get(txId);
    if (!tx) return false;
    tx.settleAt = Date.now();
    tx.willFail = Boolean(opts.fail);
    return true;
  },
  settleAll(opts = {}) {
    let n = 0;
    for (const tx of txs.values())
      if (tx.status === "PENDING") {
        tx.settleAt = Date.now();
        tx.willFail = Boolean(opts.fail);
        n++;
      }
    return n;
  },
  reset() {
    txs.clear();
  },
};

function send(amountMinor, idempotencyKey, amountSats) {
  const txId = id("tx");
  const tx = {
    id: txId,
    status: "PENDING",
    payment_hash: hash(),
    amount: { full_amount: String(amountMinor) },
    settle_amount: null,
    exchange_rate: null,
    error: null,
    idempotencyKey,
    amountSats: amountSats != null ? String(amountSats) : undefined,
    settleAt: Date.now() + 1200,
  };
  txs.set(txId, tx);
  return tx;
}
