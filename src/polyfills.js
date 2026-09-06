/* Generators and async functions, once Babel has lowered them for old WebKit.
   Modern browsers never touch this code path. */
import "regenerator-runtime/runtime.js";

/* Just the gaps that matter on old WebKit. Every patch is guarded, so a modern
   browser keeps its native implementation. No core-js: there is nothing here
   we do not use, plus a few APIs that throw "undefined is not an object" on
   iOS 12 Chrome when Live UI starts. */

if (!Object.assign) {
  Object.defineProperty(Object, "assign", {
    writable: true,
    configurable: true,
    value: function assign(target) {
      if (target == null) throw new TypeError("Cannot convert undefined or null to object");
      var to = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var next = arguments[i];
        if (next == null) continue;
        for (var key in next) if (Object.prototype.hasOwnProperty.call(next, key)) to[key] = next[key];
      }
      return to;
    },
  });
}

if (!Object.entries)
  Object.entries = function (obj) {
    return Object.keys(obj).map(function (k) {
      return [k, obj[k]];
    });
  };

if (!Object.values)
  Object.values = function (obj) {
    return Object.keys(obj).map(function (k) {
      return obj[k];
    });
  };

if (typeof Object.hasOwn !== "function")
  Object.hasOwn = function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };

if (!Array.from)
  Array.from = function (arrayLike, mapFn) {
    var out = [];
    var len = arrayLike.length >>> 0;
    for (var i = 0; i < len; i++) out.push(mapFn ? mapFn(arrayLike[i], i) : arrayLike[i]);
    return out;
  };

if (!Array.prototype.find)
  Object.defineProperty(Array.prototype, "find", {
    writable: true,
    configurable: true,
    value: function (predicate, thisArg) {
      for (var i = 0; i < this.length; i++)
        if (predicate.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    },
  });

if (!Array.prototype.includes)
  Object.defineProperty(Array.prototype, "includes", {
    writable: true,
    configurable: true,
    value: function (item) {
      return this.indexOf(item) !== -1;
    },
  });

if (!Array.prototype.fill)
  Object.defineProperty(Array.prototype, "fill", {
    writable: true,
    configurable: true,
    value: function (value, start, end) {
      var len = this.length >>> 0;
      var relStart = start == null ? 0 : start >> 0;
      var relEnd = end == null ? len : end >> 0;
      var k = relStart < 0 ? Math.max(len + relStart, 0) : Math.min(relStart, len);
      var final = relEnd < 0 ? Math.max(len + relEnd, 0) : Math.min(relEnd, len);
      while (k < final) {
        this[k] = value;
        k++;
      }
      return this;
    },
  });

if (!String.prototype.includes)
  Object.defineProperty(String.prototype, "includes", {
    writable: true,
    configurable: true,
    value: function (search, start) {
      return this.indexOf(search, start || 0) !== -1;
    },
  });

if (!String.prototype.startsWith)
  Object.defineProperty(String.prototype, "startsWith", {
    writable: true,
    configurable: true,
    value: function (search, pos) {
      return this.substr(pos || 0, search.length) === search;
    },
  });

if (!String.prototype.endsWith)
  Object.defineProperty(String.prototype, "endsWith", {
    writable: true,
    configurable: true,
    value: function (search, length) {
      var s = String(this);
      var cap = length === undefined || length > s.length ? s.length : length | 0;
      return s.substring(cap - search.length, cap) === String(search);
    },
  });

if (!String.prototype.padStart)
  Object.defineProperty(String.prototype, "padStart", {
    writable: true,
    configurable: true,
    value: function (length, pad) {
      var out = String(this);
      pad = pad === undefined ? " " : String(pad);
      while (out.length < length && pad.length) out = pad.slice(0, length - out.length) + out;
      return out;
    },
  });

if (!String.prototype.replaceAll)
  Object.defineProperty(String.prototype, "replaceAll", {
    writable: true,
    configurable: true,
    value: function (search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError("replaceAll with a RegExp requires the g flag");
        return String(this).replace(search, replacement);
      }
      return String(this).split(search).join(replacement);
    },
  });

if (!Number.isFinite)
  Number.isFinite = function (n) {
    return typeof n === "number" && isFinite(n);
  };

if (!Math.clz32)
  Math.clz32 = function (x) {
    var n = x >>> 0;
    if (n === 0) return 32;
    return 31 - ((Math.log(n) / Math.LN2) | 0);
  };

if (typeof TextEncoder === "undefined") {
  var TextEncoderPolyfill = function TextEncoder() {};
  TextEncoderPolyfill.prototype.encode = function (input) {
    var str = input == null ? "" : String(input);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var u = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(240 | (u >> 18), 128 | ((u >> 12) & 63), 128 | ((u >> 6) & 63), 128 | (u & 63));
      } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return new Uint8Array(out);
  };
  if (typeof window !== "undefined") window.TextEncoder = TextEncoderPolyfill;
  else if (typeof globalThis !== "undefined") globalThis.TextEncoder = TextEncoderPolyfill;
}

if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = function () {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
}

if (typeof AbortController === "undefined") {
  var AbortControllerPolyfill = function AbortController() {
    this.signal = { aborted: false, onabort: null };
  };
  AbortControllerPolyfill.prototype.abort = function () {
    this.signal.aborted = true;
    if (typeof this.signal.onabort === "function") this.signal.onabort();
  };
  if (typeof window !== "undefined") window.AbortController = AbortControllerPolyfill;
}

/* Minimal fetch over XHR. Covers the verbs, headers, and response readers the
   live api uses, and nothing else. Old iOS Chrome/Safari ship a native fetch
   that throws "undefined is not an object (evaluating 'headers.forEach')" when
   init.headers is undefined, or when headers is a plain object. We replace
   that implementation rather than calling it. */
function xhrFetch(url, options) {
  var opts = options || {};
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open(opts.method || "GET", url, true);
    if (opts.headers) {
      var headers = opts.headers;
      if (typeof headers.forEach === "function") {
        headers.forEach(function (value, name) {
          xhr.setRequestHeader(name, value);
        });
      } else {
        for (var name in headers)
          if (Object.prototype.hasOwnProperty.call(headers, name) && headers[name] != null)
            xhr.setRequestHeader(name, headers[name]);
      }
    }
    xhr.onload = function () {
      var text = xhr.responseText;
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: function () {
          return Promise.resolve(text);
        },
        json: function () {
          return Promise.resolve(JSON.parse(text));
        },
      });
    };
    xhr.onerror = function () {
      reject(new TypeError("Network request failed"));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.send(opts.body != null ? opts.body : null);
  });
}

function nativeFetchLooksBroken() {
  if (typeof fetch !== "function") return true;
  try {
    if (typeof Headers === "function") {
      var h = new Headers();
      if (typeof h.forEach !== "function") return true;
    } else {
      return true;
    }
    if (typeof Response === "undefined" || typeof Response.prototype.text !== "function") return true;
  } catch (e) {
    return true;
  }
  var ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  var ios = /OS (\d+)[._]/.exec(ua);
  if (ios && Number(ios[1]) > 0 && Number(ios[1]) < 14) return true;
  return false;
}

if (typeof window !== "undefined" && nativeFetchLooksBroken()) {
  window.fetch = xhrFetch;
}

/* Old WebKit composites text-shadow, transforms, and synthetic bold as a
   double-paint / muddy glow. Mark the document so CSS can drop those effects
   while iOS 15+ keeps the modern look. */
function cssSupports(prop, value) {
  if (typeof window === "undefined") return false;
  if (window.CSS && CSS.supports) {
    try {
      return CSS.supports(prop, value);
    } catch (e) {
      /* fall through */
    }
  }
  try {
    var el = document.createElement("div");
    el.style[prop] = value;
    return el.style[prop] !== "";
  } catch (e) {
    return false;
  }
}

function needsFlatPaint() {
  if (typeof document === "undefined") return false;
  var ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  var ios = /OS (\d+)[._]/.exec(ua);
  if (ios && Number(ios[1]) > 0 && Number(ios[1]) < 15) return true;
  if (/iP(ad|hone|od)/.test(ua) && !cssSupports("inset", "0px")) return true;
  if (/Macintosh/.test(ua) && "ontouchend" in document && !cssSupports("inset", "0px")) return true;
  if (!cssSupports("display", "flex")) return true;
  return false;
}

if (typeof document !== "undefined" && needsFlatPaint()) {
  var root = document.documentElement;
  if (root.classList) root.classList.add("flat-paint");
  else root.className += (root.className ? " " : "") + "flat-paint";
}

export { xhrFetch, nativeFetchLooksBroken, needsFlatPaint };
