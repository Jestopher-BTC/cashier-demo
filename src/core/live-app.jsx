/* Live-only Amboss Payments cashier. No Mock UI, Code View, Calendly CTA,
   or booth Fund giveaway. Integrators adopt this package. */

import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  PaymentsProvider,
  Styles,
  WalletView,
  DepositFlow,
  WithdrawFlow,
} from "../AmbossCashierMock.jsx";
import { AmbossLetter, AmbossLogo } from "../AmbossLogo.jsx";
import { createLiveApi } from "../live-api.js";

const HOST = (typeof window !== "undefined" && window.__CASHIER__) || { live: false };
const BUILD_ID = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

function useTheme() {
  const [theme, setTheme] = useState(function () {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem("cashier.theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  useEffect(
    function () {
      document.documentElement.setAttribute("data-theme", theme);
      var color = theme === "light" ? "#FFFFFF" : "#0C1424";
      var themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) themeMeta.setAttribute("content", color);
      var bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (bar) bar.setAttribute("content", theme === "light" ? "default" : "black-translucent");
      try {
        localStorage.setItem("cashier.theme", theme);
      } catch (e) {
        /* private browsing */
      }
    },
    [theme]
  );
  return [theme, setTheme];
}

function Screens() {
  const [screen, setScreen] = useState("wallet");
  const toWallet = useCallback(function () {
    setScreen("wallet");
  }, []);

  return (
    <div className="cashier-column">
      <div className="phone">
        {screen === "wallet" ? (
          <WalletView
            onDeposit={function () {
              setScreen("deposit");
            }}
            onWithdraw={function () {
              setScreen("withdraw");
            }}
          />
        ) : screen === "deposit" ? (
          <DepositFlow onExit={toWallet} onDone={toWallet} />
        ) : (
          <WithdrawFlow onExit={toWallet} onDone={toWallet} />
        )}
      </div>
    </div>
  );
}

function describeLiveError(e) {
  var msg = (e && e.message) || String(e) || "Could not start Live UI";
  var js = /is not an object|is not a function|Cannot read|undefined|null is not/i.test(msg);
  return {
    title: js ? "This browser hit a script error" : "No connection to the server",
    message: msg,
    hint: js
      ? "That is a browser bug, not a missing network. Try again."
      : "The cashier needs the server to mint invoices and send payouts.",
  };
}

function LiveStage({ theme }) {
  const [phase, setPhase] = useState("connecting");
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const apiRef = useRef(null);

  useEffect(function () {
    if (!HOST.live) return undefined;
    let cancelled = false;
    const api = createLiveApi({
      base: "api",
      onEvent: function (e) {
        if (e.type === "warning" && !cancelled) setNotice(e.message);
      },
    });
    apiRef.current = api;
    api
      .start()
      .then(function (r) {
        if (cancelled) return;
        if (!r || !r.config) throw new Error("Server returned an empty config");
        setConfig(r.config);
        setPhase("ready");
      })
      .catch(function (e) {
        if (cancelled) return;
        setError(describeLiveError(e));
        setPhase("error");
      });
    return function () {
      cancelled = true;
    };
  }, []);

  if (!HOST.live)
    return (
      <div className="stage">
        <div className="offline-card">
          <h2>Live cashier needs the hosted build</h2>
          <p>This file is offline. Real invoices need the server.</p>
        </div>
      </div>
    );

  if (phase === "connecting")
    return (
      <div className="stage">
        <div className="offline-card">
          <h2>Connecting</h2>
          <p className="dim">Connecting to Amboss Payments.</p>
        </div>
      </div>
    );

  if (phase === "error")
    return (
      <div className="stage">
        <div className="offline-card">
          <h2>{error && error.title ? error.title : "No connection to the server"}</h2>
          <p className="dim">{error && error.message ? error.message : ""}</p>
          <button
            className="btn primary big"
            onClick={function () {
              window.location.reload();
            }}
          >
            Try again
          </button>
          <p className="dim">{error && error.hint ? error.hint : ""}</p>
        </div>
      </div>
    );

  var cfg = config || {};
  var depositCap = cfg.maxDepositUsd;
  var withdrawCap = cfg.maxWithdrawUsd;
  var invoicesOnly = !cfg.addressPayouts;
  var sameCap = depositCap === withdrawCap;

  return (
    <div className="stage">
      <div className="livebar">
        <div className="live-meta">
          <span className="live-status">
            <span className="live-dot" />
            <span className="live-label">
              LIVE · {cfg.asset || "wallet"}
              {cfg.mock ? " · mock api" : ""}
            </span>
          </span>
          <span className="live-caps">
            <span className="live-caps-full">
              <span className="live-cap">up to ${depositCap} in</span>
              {", "}
              <span className="live-cap">${withdrawCap} out</span>
              {invoicesOnly ? <span className="live-cap"> · invoices only</span> : null}
            </span>
            <span className="live-caps-short">
              {sameCap ? "≤$" + depositCap + " in/out" : "≤$" + depositCap + " in / $" + withdrawCap + " out"}
              {invoicesOnly ? " · invoices" : ""}
            </span>
          </span>
        </div>
      </div>

      {notice ? <div className="livenotice">{notice}</div> : null}

      <PaymentsProvider
        api={apiRef.current}
        defaultTheme={theme}
        demo={false}
        initialBalanceUsd={0}
        usdPerBtc={cfg.usdPerBtc > 1000 ? cfg.usdPerBtc : undefined}
        capabilities={{ addressPayouts: cfg.addressPayouts }}
        limits={{
          depositMin: cfg.minDepositUsd,
          depositMax: cfg.maxDepositUsd,
          withdrawMin: cfg.minWithdrawUsd,
          invoiceSeconds: cfg.invoiceSeconds,
        }}
      >
        <Screens />
      </PaymentsProvider>
    </div>
  );
}

export default function CoreApp() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="app">
      <Styles />
      <header className="topbar">
        <div className="topbar-start">
          <div className="brand">
            <AmbossLetter gid="amboss-grad-brand" className="brand-logo" />
            <span className="brand-text">
              <strong>Cashier</strong>
            </span>
          </div>
        </div>
        <div className="topbar-end">
          <button
            className="btn icon"
            aria-label="Switch theme"
            onClick={function () {
              setTheme(theme === "dark" ? "light" : "dark");
            }}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </header>
      <main className="content">
        <LiveStage theme={theme} />
      </main>
      <footer className="booth-foot">
        <AmbossLogo gid="amboss-grad-foot" className="booth-foot-logo" />
        <p>
          Powered by Amboss Payments ·{" "}
          <a href="https://amboss.tech" target="_blank" rel="noopener noreferrer">
            amboss.tech
          </a>
        </p>
        <p className="booth-foot-build">{BUILD_ID}</p>
      </footer>
    </div>
  );
}
