/* Booth at / and core at /core/ from one Node process. Caddy can keep
   proxying /cashier/* as today: handle_path strips that prefix, and this
   module owns the second mount. */

import fs from "node:fs";
import path from "node:path";

export const CORE_MOUNT = "/core";

export function dirHasIndex(dir) {
  try {
    return fs.existsSync(path.join(dir, "index.html"));
  } catch {
    return false;
  }
}

/* dual = booth at / and core at /core/ when both build outputs exist.
   booth / core remain the single-tree fallback (core is then at /). */
export function resolveHostLayout({ requested, boothExists, coreExists }) {
  const want = requested === "both" ? "dual" : requested;

  if (want === "core") {
    return {
      mode: "core",
      booth: { available: false, path: null },
      core: { available: Boolean(coreExists), path: "/" },
      warning: coreExists
        ? null
        : "public-core/ is missing. Run npm run build before serving core.",
    };
  }

  if (want === "booth") {
    return {
      mode: "booth",
      booth: { available: Boolean(boothExists), path: "/" },
      core: { available: false, path: null },
      warning: boothExists
        ? null
        : "public/ is missing. Run npm run build before serving booth.",
    };
  }

  if (boothExists && coreExists) {
    return {
      mode: "dual",
      booth: { available: true, path: "/" },
      core: { available: true, path: CORE_MOUNT + "/" },
      warning: null,
    };
  }
  if (boothExists) {
    return {
      mode: "booth",
      booth: { available: true, path: "/" },
      core: { available: false, path: null },
      warning: "public-core/ is missing; serving booth only. Run npm run build for dual URLs.",
    };
  }
  if (coreExists) {
    return {
      mode: "core",
      booth: { available: false, path: null },
      core: { available: true, path: "/" },
      warning: "public/ is missing; serving core at /.",
    };
  }
  return {
    mode: "dual",
    booth: { available: false, path: "/" },
    core: { available: false, path: CORE_MOUNT + "/" },
    warning: "public/ and public-core/ are missing. Run npm run build before serving.",
  };
}

export function splitMount(pathname) {
  const raw = String(pathname || "/");
  if (raw === CORE_MOUNT) {
    return { mount: "core", rest: "/", trailingSlashRedirect: true };
  }
  if (raw === CORE_MOUNT + "/" || raw.startsWith(CORE_MOUNT + "/")) {
    return { mount: "core", rest: raw.slice(CORE_MOUNT.length) || "/", trailingSlashRedirect: false };
  }
  return { mount: "root", rest: raw, trailingSlashRedirect: false };
}

export function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isHealthzPath(pathname) {
  return pathname === "/healthz";
}

/* Relative Location so a reverse-proxy prefix (/cashier) is preserved.
   Location: /core/ would send the browser to boltda.sh/core/, off the mount. */
export function coreSlashRedirectLocation() {
  return "core/";
}

export function publicDirFor(layout, mount, boothDir, coreDir) {
  if (layout.mode === "core") return coreDir;
  if (layout.mode === "dual" && mount === "core") return coreDir;
  return boothDir;
}
