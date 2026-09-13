/* Live implementation of the four seams the components expect. Same shape as
   mockApi in AmbossCashierMock.jsx, so the component tree does not change: only
   the object passed to <PaymentsProvider api={...} /> does. */

import { xhrFetch } from "./polyfills.js";

function joinUrl(base, path) {
  return String(base || "").replace(/\/$/, "") + path;
}

var STORAGE_KEY = "cashier.session";

function loadStoredSession() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch (e) {
    return null; /* private browsing */
  }
}

function storeSession(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* nothing to do; the session simply will not survive a reload */
  }
}

/* Never pass headers/body as undefined. Old iOS fetch throws
   "undefined is not an object (evaluating 'headers.forEach')" on that.
   Live traffic goes through XHR so a broken native fetch cannot take
   the booth down. */
function http(url, init) {
  var opts = init || {};
  var fetchOpts = { method: opts.method || "GET" };
  if (opts.headers) fetchOpts.headers = opts.headers;
  if (opts.body != null) fetchOpts.body = opts.body;
  return xhrFetch(url, fetchOpts);
}

function readPayload(res) {
  if (!res) throw new Error("Empty response from the server");
  var reader = res.text;
  if (typeof reader !== "function") throw new Error("This browser cannot read the server response");
  return reader.call(res).then(function (text) {
    var payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error("Server returned " + (res.status || "an unreadable body"));
    }
    if (!res.ok) {
      var err = new Error((payload && payload.error) || "Request failed");
      err.status = res.status;
      throw err;
    }
    return payload || {};
  });
}

export function createLiveApi(options) {
  var base = (options && options.base) || "api";
  var onEvent = (options && options.onEvent) || function () {};
  var sessionId = null;

  function request(path, init) {
    var opts = init || {};
    var url = joinUrl(base, path);
    if (opts.method !== "POST" && sessionId)
      url += (url.indexOf("?") === -1 ? "?" : "&") + "s=" + encodeURIComponent(sessionId);

    var body = opts.body;
    if (body && sessionId) body = Object.assign({ sessionId: sessionId }, body);

    var fetchOpts = { method: opts.method || "GET", headers: {} };
    if (sessionId) fetchOpts.headers["X-Cashier-Session"] = sessionId;
    if (body) {
      fetchOpts.headers["content-type"] = "application/json";
      fetchOpts.body = JSON.stringify(body);
    }
    return http(url, fetchOpts).then(readPayload);
  }

  var api = {
    /* Called once before the live screens mount. A reload, a crash, or the
       iPad going to sleep should not cost a visitor the money they just
       deposited, so the session id survives in localStorage and gets resumed
       if the server still has it. */
    start: function () {
      return request("/config").then(function (config) {
        var stored = loadStoredSession();
        if (!stored) return api.newSession().then(wrap(config));

        sessionId = stored;
        return request("/state")
          .then(function (state) {
            onEvent({ type: "session", state: state, config: config, resumed: true });
            return { config: config, state: state, resumed: true };
          })
          .catch(function () {
            /* Expired or unknown to the server. Start clean. */
            sessionId = null;
            storeSession(null);
            return api.newSession().then(wrap(config));
          });

        function wrap(cfg) {
          return function (state) {
            return { config: cfg || {}, state: state || {}, resumed: false };
          };
        }
      });
    },

    newSession: function () {
      sessionId = null;
      storeSession(null);
      return request("/session", { method: "POST", body: {} }).then(function (state) {
        if (!state || !state.sessionId) throw new Error("Server returned an empty session");
        sessionId = state.sessionId;
        storeSession(sessionId);
        onEvent({ type: "session", state: state });
        return state;
      });
    },

    fund: function (pin) {
      return request("/session/fund", { method: "POST", body: { pin: pin || "" } });
    },

    /* Seam 4. The server owns the balance and the history. */
    loadState: function () {
      if (!sessionId) return Promise.resolve({ balanceUsd: 0, transactions: [] });
      return request("/state").then(function (state) {
        return {
          balanceUsd: state && typeof state.balanceUsd === "number" ? state.balanceUsd : 0,
          transactions: state && state.transactions ? state.transactions : [],
          sessionId: state && state.sessionId,
        };
      });
    },

    resetSession: function () {
      return api.newSession();
    },

    /* Seam 1. */
    createInvoice: function (input) {
      input = input || {};
      return request("/deposit", { method: "POST", body: { amountUsd: input.amountUsd } }).then(
        function (r) {
          r = r || {};
          return {
            id: r.id,
            amountUsd: r.amountUsd,
            satAmount: r.satAmount,
            invoice: r.invoice,
            expiresAt: r.expiresAt,
          };
        }
      );
    },

    /* Seam 2. Poll rather than webhook: a booth has no inbound URL. */
    watchInvoice: function (request_, onPaid) {
      var stopped = false;
      var timer = null;
      var id = request_ && request_.id;

      function tick() {
        if (stopped || !id) return;
        request("/deposit/" + encodeURIComponent(id))
          .then(function (r) {
            if (stopped) return;
            r = r || {};
            if (r.status === "completed" || r.status === "complete") {
              stopped = true;
              onEvent({ type: "deposit", status: "complete" });
              if (typeof onPaid === "function") onPaid();
              return;
            }
            timer = setTimeout(tick, 1500);
          })
          .catch(function (e) {
            if (stopped) return;
            onEvent({ type: "warning", message: e && e.message ? e.message : "Deposit check failed" });
            timer = setTimeout(tick, 3000);
          });
      }

      timer = setTimeout(tick, 1200);
      return function stop() {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },

    /* Seam 3. Resolves once the send reaches a terminal state. */
    sendPayment: function (input) {
      input = input || {};
      return request("/withdraw", {
        method: "POST",
        body: { destination: input.destination, amountUsd: input.amountUsd },
      })
        .then(function (r) {
          r = r || {};
          if (r.status === "complete" || r.status === "failed") return { status: r.status };
          if (!r.id) return { status: "failed", error: "Send returned no id" };
          return poll(r.id, 0);
        })
        .catch(function (e) {
          onEvent({ type: "warning", message: e && e.message ? e.message : "Send failed" });
          return { status: "failed", error: e && e.message ? e.message : "Send failed" };
        });
    },
  };

  function poll(txId, attempt) {
    if (attempt > 40) return Promise.resolve({ status: "pending" });
    return new Promise(function (resolve) {
      setTimeout(function () {
        request("/withdraw/" + encodeURIComponent(txId))
          .then(function (r) {
            r = r || {};
            if (r.status === "complete" || r.status === "failed") return resolve({ status: r.status });
            resolve(poll(txId, attempt + 1));
          })
          .catch(function () {
            resolve(poll(txId, attempt + 1));
          });
      }, 1200);
    });
  }

  return api;
}
