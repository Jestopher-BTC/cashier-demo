/* Live payouts must refuse to boot without a team password. Sandbox keys and
   MOCK_AMBOSS=1 stay usable without one. */

import { spawn } from "node:child_process";

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  ok  ", name);
  } else {
    fail++;
    console.log("  FAIL", name, detail === undefined ? "" : String(detail));
  }
}

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `import { assertReady } from "./server/config.js";
         try { assertReady(); console.log("READY"); }
         catch (e) { console.error(e.message); process.exit(2); }`,
      ],
      { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, ...env } }
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (code) => resolve({ code, out }));
  });
}

console.log("\nlive send credentials");

const liveMissing = await run({
  MOCK_AMBOSS: "0",
  AMBOSS_API_KEY: "amb_live_fake",
  AMBOSS_WALLET_ID: "wallet-1",
  AMBOSS_TEAM_PASSWORD: "",
  TEAM_PASSWORD: "",
});
check(
  "live key without team password fails ready",
  liveMissing.code === 2 && /AMBOSS_TEAM_PASSWORD/.test(liveMissing.out),
  liveMissing.out
);

const liveOk = await run({
  MOCK_AMBOSS: "0",
  AMBOSS_API_KEY: "amb_live_fake",
  AMBOSS_WALLET_ID: "wallet-1",
  AMBOSS_TEAM_PASSWORD: "booth-team-password",
});
check("live key with team password is ready", liveOk.code === 0 && /READY/.test(liveOk.out), liveOk.out);

const sandbox = await run({
  MOCK_AMBOSS: "0",
  AMBOSS_API_KEY: "amb_test_fake",
  AMBOSS_WALLET_ID: "wallet-1",
  AMBOSS_TEAM_PASSWORD: "",
});
check("sandbox key does not require a team password", sandbox.code === 0 && /READY/.test(sandbox.out), sandbox.out);

const mock = await run({ MOCK_AMBOSS: "1" });
check("mock mode does not require Amboss credentials", mock.code === 0 && /READY/.test(mock.out), mock.out);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
