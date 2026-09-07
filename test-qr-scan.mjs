import { writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import * as esbuild from "esbuild";
import {
  CAMERA_COPY,
  classifyCameraError,
  decodeQrImage,
  imageDataFromMatrix,
  normalizeScannedText,
  resolveCameraError,
} from "./src/qr-scan.js";

let pass = 0;
let fail = 0;
const check = (n, ok, d) => {
  ok ? (pass++, console.log("  ok  ", n)) : (fail++, console.log("  FAIL", n, d ?? ""));
};

const invoice = "lnbc4250u1p" + "q".repeat(80);

console.log("\nunwrap scanned payloads");
check("plain cashtag", normalizeScannedText("$jestopher") === "$jestopher");
check("lightning: invoice", normalizeScannedText("lightning:" + invoice) === invoice);
check("LIGHTNING: uppercase", normalizeScannedText("LIGHTNING:" + invoice.toUpperCase()) === invoice.toUpperCase());
check(
  "bitcoin URI lightning query",
  normalizeScannedText("bitcoin:?lightning=" + invoice) === invoice
);
check(
  "whitespace inside invoice",
  normalizeScannedText("lnbc 4250u1p\n" + "q".repeat(80)) === invoice
);
check("zero-width chars stripped", normalizeScannedText("$je\u200Bstopher") === "$jestopher");
check("empty stays empty", normalizeScannedText("   ") === "");

console.log("\ncamera errors");
check("permission denied", classifyCameraError({ name: "NotAllowedError" }) === "denied");
check("legacy permission name", classifyCameraError({ name: "PermissionDeniedError" }) === "denied");
check("notfound name is a candidate only", classifyCameraError({ name: "NotFoundError" }) === "missing");
check("overconstrained is not missing", classifyCameraError({ name: "OverconstrainedError" }) === "failed");
check("insecure context", classifyCameraError({ name: "SecurityError", message: "insecure context" }) === "insecure");
check("generic fail", classifyCameraError({ name: "NotReadableError" }) === "failed");
check("needs user gesture", classifyCameraError({ name: "NotAllowedError", message: "The request requires a user gesture" }) === "gesture");
check("api unavailable is failed", classifyCameraError({ name: "NotSupportedError", message: "camera api unavailable" }) === "failed");
check("denied copy is actionable", /Settings/.test(CAMERA_COPY.denied) && /Allow camera/.test(CAMERA_COPY.denied));
check("gesture copy asks for a tap", /Allow camera/.test(CAMERA_COPY.gesture));

const emptyDenied = await resolveCameraError(
  { name: "NotFoundError" },
  { listVideoInputs: async () => [], listAllMediaDevices: async () => [], cameraPermissionState: async () => null }
);
check("empty device list without permission is denied", emptyDenied === "denied", emptyDenied);

const emptyGranted = await resolveCameraError(
  { name: "NotFoundError" },
  { listVideoInputs: async () => [], listAllMediaDevices: async () => [], cameraPermissionState: async () => "granted" }
);
check("empty devices after grant is missing", emptyGranted === "missing", emptyGranted);

const hasCamera = await resolveCameraError(
  { name: "NotFoundError" },
  { listVideoInputs: async () => [{ kind: "videoinput" }], listAllMediaDevices: async () => [{ kind: "videoinput" }], cameraPermissionState: async () => null }
);
check("notfound with a camera is denied", hasCamera === "denied", hasCamera);

const audioOnly = await resolveCameraError(
  { name: "NotFoundError" },
  { listVideoInputs: async () => [], listAllMediaDevices: async () => [{ kind: "audioinput" }], cameraPermissionState: async () => null }
);
check("audio-only device list is missing", audioOnly === "missing", audioOnly);

const noEnumerate = await resolveCameraError({ name: "NotFoundError" }, {});
check("notfound without enumerate is not missing", noEnumerate === "failed", noEnumerate);

console.log("\nencoder round-trip");
const built = await esbuild.build({
  stdin: {
    contents: 'export { qrMatrix, parseDestination } from "./src/AmbossCashierMock.jsx";\n',
    resolveDir: process.cwd(),
    loader: "js",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  jsx: "transform",
  external: ["react"],
});
const tmp = join(process.cwd(), ".qr-enc-test.mjs");
writeFileSync(tmp, built.outputFiles[0].text);
const { qrMatrix, parseDestination } = await import(pathToFileURL(tmp).href + "?t=" + Date.now());
try {
  unlinkSync(tmp);
} catch (e) {
  /* leave it if the process cannot unlink */
}

const payloads = ["$jestopher", "player@walletofsatoshi.com", invoice];
for (const value of payloads) {
  const matrix = qrMatrix(value);
  check("matrix for " + value.slice(0, 16), Boolean(matrix && matrix.length > 20));
  const decoded = decodeQrImage(imageDataFromMatrix(matrix, 4, 4));
  check("jsQR reads " + value.slice(0, 16), decoded === value, decoded);
}

const parsedUri = parseDestination("bitcoin:?lightning=" + invoice, 100000);
check("parseDestination accepts bitcoin URI", parsedUri.kind === "request", parsedUri);
const parsedLn = parseDestination("lightning:" + invoice, 100000);
check("parseDestination accepts lightning: prefix", parsedLn.kind === "request", parsedLn);
const parsedPaste = parseDestination(invoice, 100000);
check("parseDestination still accepts a raw invoice", parsedPaste.kind === "request", parsedPaste);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
