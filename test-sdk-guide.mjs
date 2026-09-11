/* Snippets in Code View must match @ambosstech/payments, not the React mock. */
import { DOCS, MAP_LINE, SANDBOX_META, SNIPPETS, snippetIdForAction } from "./src/booth/sdk-guide.js";

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? "")); };

const ids = SNIPPETS.map((s) => s.id);
check("three snippets", ids.join(",") === "receive,send,webhook", ids.join(","));

const receive = SNIPPETS[0].code;
const send = SNIPPETS[1].code;
const webhook = SNIPPETS[2].code;
const all = SNIPPETS.map((s) => s.code).join("\n");

check("imports official package", all.includes('from "@ambosstech/payments"'));
check("constructs Payments", all.includes("new Payments({"));
check("uses serviceApiKey", all.includes("serviceApiKey: process.env.AMBOSS_API_KEY"));

check("receive is createReceive", receive.includes("payments.transactions.createReceive"));
check("receive uses wallet_id + amount", receive.includes("wallet_id:") && receive.includes("amount:"));
check("receive is not createInvoice", !receive.includes("createInvoice") && !receive.includes("amountUsd"));

check("send is transactions.send", send.includes("payments.transactions.send"));
check("send has password", send.includes("password"));
check("send has lightningAddress + amountSats", send.includes("lightningAddress") && send.includes("amountSats"));
check("send mentions bolt11", send.includes("bolt11"));
check("send is not sendPayment", !send.includes("sendPayment") && !send.includes("amountUsd"));

check("webhook is webhooks.verify", webhook.includes("payments.webhooks.verify"));
check("webhook uses raw payload + headers", webhook.includes("payload:") && webhook.includes("signature:") && webhook.includes("timestamp:"));

check("sandbox metadata in receive", receive.includes('amb_sandbox_behavior: "complete"'));
check("sandbox metadata in send", send.includes('amb_sandbox_behavior: "complete"'));
check("sandbox callout string", SANDBOX_META.includes('amb_sandbox_behavior: "complete"'));

check("map line names the mock seam", MAP_LINE.mock === "mockApi.createInvoice");
check("map line names the real SDK", MAP_LINE.sdk === "payments.transactions.createReceive");

check("docs links", DOCS.gettingStarted.indexOf("docs.amboss.tech/sdk/getting-started") !== -1);
check("deposit highlights receive", snippetIdForAction("deposit") === "receive");
check("cash out highlights send", snippetIdForAction("withdraw") === "send");
check("default is receive", snippetIdForAction(null) === "receive");

const fakeSdk = /createInvoice\(\{\s*amountUsd|usdPerBtc/;
check("no fake SDK shape in snippets", !fakeSdk.test(all));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
