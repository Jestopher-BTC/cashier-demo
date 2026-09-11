/* Core package must not ship booth sales chrome. Booth remains the default
   public/ build used by boltda.sh. */

import fs from "node:fs";
import { JSDOM } from "jsdom";

process.env.MOCK_AMBOSS = "1";
process.env.PORT = "8198";
process.env.OPERATOR_PIN = "";
process.env.RATE_SOURCE = "static";
process.env.USD_PER_BTC = "100000";
process.env.CASHIER_PACKAGE = "core";

const { server } = await import("./server/server.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

await sleep(200);

const boothJs = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const coreJs = fs.readFileSync(new URL("./public-core/app.js", import.meta.url), "utf8");

console.log("\nbundles");
check("booth bundle includes Mock UI", /Mock UI/.test(boothJs));
check("booth bundle includes Code View", /Code View/.test(boothJs));
check("booth bundle includes Calendly", /calendly\.com\/d\/cwfn-s48-3b3/.test(boothJs));
check("core bundle has no Mock UI tab", !/"Mock UI"/.test(coreJs) && !/label:"Mock UI"/.test(coreJs));
check("core bundle has no Code View tab", !/Code View/.test(coreJs));
check("core bundle has no Calendly", !/calendly\.com/.test(coreJs));
check("core bundle has no sales CTA", !/Bring this payment UX to your platform/.test(coreJs));
check("core bundle still has the cashier", /Account balance/.test(coreJs));
check("cashier widget does not import booth-sales", !/from "\.\/booth-sales\.js"/.test(fs.readFileSync(new URL("./src/AmbossCashierMock.jsx", import.meta.url), "utf8")));

console.log("\ncore server serves Live-only UI");
const dom = await JSDOM.fromURL("http://127.0.0.1:8198/", {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
});
await sleep(1600);
const txt = dom.window.document.body.textContent;
check("core has no mode tabs", dom.window.document.querySelectorAll(".mode").length === 0);
check("core has no booth tagline", !dom.window.document.querySelector("[data-booth-tagline]"));
check("core has no discovery QR", !dom.window.document.querySelector("[data-discovery-qr]"));
check("core has no Fund button", !/^\s*Fund\s*$/m.test(txt) && !dom.window.document.querySelector("[data-fund]"));
check("core shows the cashier", /Account balance/.test(txt));
check("core live status present", /LIVE/.test(txt));

console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
dom.window.close();
process.exit(fail ? 1 : 0);
