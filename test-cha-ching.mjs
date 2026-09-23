/* Booth plays one cha-ching when a deposit or cash-out succeeds.
   Core does not ship the file. Failures stay silent. */

import fs from "node:fs";

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8196";
process.env.OPERATOR_PIN = "";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
delete process.env.CASHIER_PACKAGE;

const { server } = await import("./server/server.js");
const { JSDOM } = await import("jsdom");

const BASE = "http://127.0.0.1:8196/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

const plays = [];
await sleep(150);

const sound = await fetch(BASE + "cha-ching.mp3");
const soundType = sound.headers.get("content-type") || "";
const soundBytes = Buffer.from(await sound.arrayBuffer());
check("booth serves cha-ching as audio/mpeg", sound.status === 200 && soundType.includes("audio/mpeg"), sound.status + " " + soundType);
check("cha-ching is a short mp3", soundBytes.length > 1000 && soundBytes.length < 40000 && soundBytes.subarray(0, 3).toString() === "ID3", soundBytes.length);

const dom = await JSDOM.fromURL(BASE, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  beforeParse(window) {
    window.Audio = function Audio(src) {
      this.src = src;
      this.volume = 1;
      this.currentTime = 0;
      this.preload = "";
      this.loop = false;
      this.paused = true;
      this.play = () => {
        plays.push({ src: this.src, volume: this.volume });
        this.paused = false;
        return Promise.resolve();
      };
      this.pause = () => {
        this.paused = true;
      };
    };
  },
});
const w = dom.window;
const d = w.document;
await sleep(1500);

const txt = () => d.body.textContent;
const btn = (label) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim().indexOf(label) === 0);
const click = async (el, ms = 350) => {
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await sleep(ms);
};
const type = async (el, v) => {
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  set.call(el, v);
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
  await sleep(80);
};
const audible = () => plays.filter((p) => p.volume > 0.05);

console.log("\nmock deposit");
await click(btn("Deposit"));
await type(d.querySelector("input"), "1");
await click(btn("Continue"), 500);
check("invoice is up", Boolean(btn("Simulate payment")));
await click(btn("Simulate payment"), 2000);
check("deposit credited", txt().includes("$1.00 added"), txt().slice(0, 180));
check("deposit plays cha-ching once", audible().length === 1 && /cha-ching\.mp3/.test(audible()[0].src), plays);

await click(btn("Back to wallet"));
await click(btn("Deposit"));
await type(d.querySelector("input"), "1");
await click(btn("Continue"), 500);
await click(btn("Payment fails"), 300);
check("failed deposit stays silent", audible().length === 1 && /did not go through/.test(txt()), txt().slice(0, 180));
await click(btn("Back to wallet"));

console.log("\nmock cash out");
await click(btn("Cash out"));
check("helper mentions a bare name", txt().includes("A name goes to Wallet of Satoshi."));
await type(d.querySelector("input"), "foo@bar.com");
check("full address is accepted as typed", /You choose the amount next/.test(txt()));
await click(btn("Continue"));
check("full address is not rewritten", txt().includes("foo@bar.com") && !txt().includes("foo@bar.com@"), txt().slice(0, 240));
await click(d.querySelector('[aria-label="Go back"]'));
await type(d.querySelector("input"), "$jestoph");
await click(btn("Continue"));
check("cashtag stays a cashtag", txt().includes("$jestoph") && !txt().includes("jestoph@walletofsatoshi.com"), txt().slice(0, 240));
await click(d.querySelector('[aria-label="Go back"]'));
await type(d.querySelector("input"), "meatyradish884");
check("bare name is accepted", /You choose the amount next/.test(txt()), txt().slice(0, 200));
await click(btn("Continue"));
check(
  "bare name shows the Wallet of Satoshi address",
  txt().includes("meatyradish884@walletofsatoshi.com"),
  txt().slice(0, 240)
);
await type(d.querySelector("input"), "5");
await click(btn("Review"));
check("review keeps the Wallet of Satoshi address", txt().includes("meatyradish884@walletofsatoshi.com"), txt().slice(0, 240));
await click(btn("Send"), 2500);
check("cash-out completes", txt().includes("paid out from your account"), txt().slice(0, 200));
check("cash-out plays cha-ching once more", audible().length === 2, plays);

await click(btn("Back to wallet"));
await click(btn("Cash out"));
await type(d.querySelector("input"), "$jestoph");
await click(btn("Continue"));
await type(d.querySelector("input"), "5");
await click(btn("Review"));
await click(btn("Payment fails"), 400);
check("failed cash-out stays silent", audible().length === 2 && /could not be reached/.test(txt()), txt().slice(0, 200));

console.log("\ncore package files");
const coreJs = fs.readFileSync(new URL("./public-core/app.js", import.meta.url), "utf8");
const boothJs = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
check("built booth bundle references the mp3", /cha-ching\.mp3/.test(boothJs));
check("built core bundle has no cha-ching", !/cha-ching/.test(coreJs));
check("public-core has no mp3", !fs.existsSync(new URL("./public-core/cha-ching.mp3", import.meta.url)));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
dom.window.close();
process.exit(fail ? 1 : 0);
