/* Camera + QR decode for the cash-out scanner. iPad Safari / A2HS path:
   getUserMedia with playsInline, environment camera when it exists, then
   BarcodeDetector if the browser has it and jsQR otherwise.

   iOS standalone often rejects with NotFoundError (or an empty
   enumerateDevices list) when Camera is blocked for the home-screen app.
   That is permission, not missing hardware. */

import jsQR from "jsqr";
import { normalizeScannedText } from "./scan-payload.js";

export { normalizeScannedText };

export const CAMERA_COPY = {
  starting: "Starting camera",
  live: "Point the camera at the code",
  denied: "Allow camera in Settings, then tap Allow camera.",
  missing: "No camera on this device.",
  insecure: "Camera needs HTTPS. Open the cashier from the booth URL.",
  gesture: "Tap Allow camera to start the camera.",
  failed: "Could not start the camera. Tap Allow camera to try again.",
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
  if (/gesture|user activation|transient activation|not been activated/.test(text)) return "gesture";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || /permission|not allowed|denied|blocked/.test(text))
    return "denied";
  if (name === "SecurityError" || /insecure|https required/.test(text)) return "insecure";
  if (name === "NotSupportedError" || /camera api unavailable/.test(text)) return "failed";
  /* OverconstrainedError means the constraint failed, not that the iPad has
     no camera. NotFoundError is also what iOS throws when Settings blocked
     the home-screen app — do not treat the name alone as "no device". */
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    /requested device not found|no camera|no video/.test(text)
  )
    return "missing";
  return "failed";
}

export async function listVideoInputs() {
  try {
    if (typeof navigator === "undefined") return null;
    const md = navigator.mediaDevices;
    if (!md || typeof md.enumerateDevices !== "function") return null;
    const all = await md.enumerateDevices();
    if (!all) return null;
    const videos = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i] && all[i].kind === "videoinput") videos.push(all[i]);
    }
    return videos;
  } catch (e) {
    return null;
  }
}

export async function listAllMediaDevices() {
  try {
    if (typeof navigator === "undefined") return null;
    const md = navigator.mediaDevices;
    if (!md || typeof md.enumerateDevices !== "function") return null;
    const all = await md.enumerateDevices();
    return all ? Array.prototype.slice.call(all) : null;
  } catch (e) {
    return null;
  }
}

export async function cameraPermissionState() {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function")
      return null;
    const status = await navigator.permissions.query({ name: "camera" });
    return status && status.state ? String(status.state) : null;
  } catch (e) {
    return null;
  }
}

/* NotFoundError / empty enumerateDevices is the iOS A2HS permission wall more
   often than a tablet with no camera. "missing" only after devices are
   actually empty in a trustworthy way. */
export async function resolveCameraError(err, probe) {
  const named = classifyCameraError(err);
  if (named === "denied" || named === "insecure" || named === "gesture") return named;

  const listVideos = probe && probe.listVideoInputs ? probe.listVideoInputs : listVideoInputs;
  const listAll = probe && probe.listAllMediaDevices ? probe.listAllMediaDevices : listAllMediaDevices;
  const permOf = probe && probe.cameraPermissionState ? probe.cameraPermissionState : cameraPermissionState;

  if (named === "missing") {
    const devices = await listVideos();
    const all = await listAll();
    const perm = await permOf();
    if (perm === "denied") return "denied";
    if (devices && devices.length > 0) return "denied";
    if (devices && devices.length === 0) {
      if (perm === "granted") return "missing";
      if (perm === "prompt") return "denied";
      /* iOS hides every device until Camera is allowed. A list that also
         includes audio/other inputs is a real "no video device". A totally
         empty list is permission, not hardware. */
      if (all && all.length > 0) return "missing";
      return "denied";
    }
    return "failed";
  }

  return named;
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
  { audio: false, video: { facingMode: { ideal: "environment" } } },
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
    const insecure = support.reason === "insecure";
    const err = new Error(insecure ? "insecure context" : "camera api unavailable");
    err.name = insecure ? "SecurityError" : "NotSupportedError";
    throw err;
  }
  let lastErr = null;
  let denied = null;
  for (let i = 0; i < CONSTRAINTS.length; i++) {
    try {
      return await support.getUserMedia(CONSTRAINTS[i]);
    } catch (e) {
      lastErr = e;
      const kind = classifyCameraError(e);
      if (kind === "denied") denied = e;
      if (kind === "denied" || kind === "insecure") break;
    }
  }
  throw denied || lastErr || new Error("Could not start the camera");
}

export async function attachStream(video, stream) {
  prepareVideo(video);
  video.srcObject = stream;
  /* Call play() in the same turn as srcObject so an iOS user-gesture from
     Allow camera still counts. Waiting for metadata first drops the gesture. */
  let playErr = null;
  try {
    const play = video.play();
    if (play && typeof play.then === "function") await play;
  } catch (e) {
    playErr = e;
  }
  await waitForVideo(video);
  if (video.paused || playErr) {
    try {
      const play = video.play();
      if (play && typeof play.then === "function") await play;
    } catch (e) {
      stopStream(stream);
      video.srcObject = null;
      throw e;
    }
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
