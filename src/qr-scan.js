/* Camera + QR decode for the cash-out scanner. iPad Safari / A2HS path:
   getUserMedia with playsInline, environment camera when it exists, then
   BarcodeDetector if the browser has it and jsQR otherwise. */

import jsQR from "jsqr";
import { normalizeScannedText } from "./scan-payload.js";

export { normalizeScannedText };

export const CAMERA_COPY = {
  starting: "Starting camera",
  live: "Point the camera at the code",
  denied: "Camera is blocked. Allow it in iPad Settings, then tap Allow camera.",
  missing: "No camera on this device.",
  insecure: "Camera needs HTTPS. Open the cashier from the booth URL.",
  failed: "Could not start the camera.",
  unreadable: "Could not read that code. Try again, or paste it.",
};

export function getUserMediaFn() {
  if (typeof navigator === "undefined") return null;
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === "function") {
    return function (constraints) {
      return md.getUserMedia(constraints);
    };
  }
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) return null;
  return function (constraints) {
    return new Promise(function (resolve, reject) {
      legacy.call(navigator, constraints, resolve, reject);
    });
  };
}

export function cameraSupport() {
  const secure = typeof window === "undefined" ? true : window.isSecureContext !== false;
  const gum = getUserMediaFn();
  if (!secure) return { ok: false, reason: "insecure" };
  if (!gum) return { ok: false, reason: "missing" };
  return { ok: true, getUserMedia: gum };
}

export function classifyCameraError(err) {
  const name = err && err.name ? String(err.name) : "";
  const msg = err && err.message ? String(err.message) : "";
  const text = (name + " " + msg).toLowerCase();
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || /permission|not allowed|denied/.test(text))
    return "denied";
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError" ||
    /requested device not found|no camera|no video/.test(text)
  )
    return "missing";
  if (name === "SecurityError" || /insecure|https required/.test(text)) return "insecure";
  return "failed";
}

export function stopStream(stream) {
  if (!stream) return;
  const tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
  for (let i = 0; i < tracks.length; i++) {
    try {
      tracks[i].stop();
    } catch (e) {
      /* already ended */
    }
  }
}

export function prepareVideo(video) {
  if (!video) return;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("muted", "");
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
}

const CONSTRAINTS = [
  {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  },
  { audio: false, video: { facingMode: "environment" } },
  { audio: false, video: true },
];

function waitForVideo(video) {
  return new Promise(function (resolve) {
    if (video.readyState >= 2 && video.videoWidth) return resolve();
    let settled = false;
    const done = function () {
      if (settled) return;
      settled = true;
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("canplay", done);
      resolve();
    };
    video.addEventListener("loadedmetadata", done);
    video.addEventListener("canplay", done);
    setTimeout(done, 1400);
  });
}

export async function openCameraStream() {
  const support = cameraSupport();
  if (!support.ok) {
    const err = new Error(support.reason === "insecure" ? "insecure context" : "no camera");
    err.name = support.reason === "insecure" ? "SecurityError" : "NotFoundError";
    throw err;
  }
  let lastErr = null;
  for (let i = 0; i < CONSTRAINTS.length; i++) {
    try {
      return await support.getUserMedia(CONSTRAINTS[i]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not start the camera");
}

export async function attachStream(video, stream) {
  prepareVideo(video);
  video.srcObject = stream;
  await waitForVideo(video);
  try {
    const play = video.play();
    if (play && typeof play.then === "function") await play;
  } catch (e) {
    stopStream(stream);
    video.srcObject = null;
    throw e;
  }
  return stream;
}

export async function startCamera(video) {
  const stream = await openCameraStream();
  return attachStream(video, stream);
}

function canvasContext(canvas) {
  try {
    return canvas.getContext("2d", { willReadFrequently: true });
  } catch (e) {
    return canvas.getContext("2d");
  }
}

export function grabFrame(video, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const max = 720;
  const scale = Math.min(1, max / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvasContext(canvas);
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch (e) {
    return null;
  }
}

export function imageDataFromMatrix(matrix, scale, quiet) {
  const s = scale == null ? 4 : scale;
  const q = quiet == null ? 4 : quiet;
  const n = matrix.length;
  const dim = (n + q * 2) * s;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mr = Math.floor(y / s) - q;
      const mc = Math.floor(x / s) - q;
      const dark = mr >= 0 && mc >= 0 && mr < n && mc < n && matrix[mr][mc];
      const i = (y * dim + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data: data, width: dim, height: dim };
}

export function decodeQrImage(imageData) {
  if (!imageData || !imageData.data) return null;
  try {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
    return code && code.data ? code.data : null;
  } catch (e) {
    return null;
  }
}

let detector = null;
let detectorFailed = false;

export async function decodeVideoFrame(video, canvas) {
  if (typeof window !== "undefined" && typeof window.BarcodeDetector === "function" && !detectorFailed) {
    try {
      if (!detector) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const codes = await detector.detect(video);
      if (codes && codes.length && codes[0].rawValue) return String(codes[0].rawValue);
    } catch (e) {
      detectorFailed = true;
      detector = null;
    }
  }
  const frame = grabFrame(video, canvas);
  if (!frame) return null;
  return decodeQrImage(frame);
}
