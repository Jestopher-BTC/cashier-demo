/* Generators and async functions, once Babel has lowered them for old WebKit.
   Modern browsers never touch this code path. */
import "regenerator-runtime/runtime.js";

/* Just the gaps that matter on old WebKit. Every patch is guarded, so a modern
   browser keeps its native implementation. No core-js: the whole file is under
   3 KB and there is nothing here we do not use. */

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

if (!Number.isFinite)
  Number.isFinite = function (n) {
    return typeof n === "number" && isFinite(n);
  };

/* Minimal fetch over XHR. Covers the verbs, headers, and response readers the
   live api uses, and nothing else. */
if (typeof window !== "undefined" && !window.fetch) {
  window.fetch = function (url, options) {
    var opts = options || {};
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(opts.method || "GET", url, true);
      if (opts.headers)
        for (var name in opts.headers)
          if (Object.prototype.hasOwnProperty.call(opts.headers, name))
            xhr.setRequestHeader(name, opts.headers[name]);
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
      xhr.send(opts.body || null);
    });
  };
}
