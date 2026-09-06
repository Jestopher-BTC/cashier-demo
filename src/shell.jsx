import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PaymentsProvider,
  Styles,
  WalletView,
  DepositFlow,
  WithdrawFlow,
} from "./AmbossCashierMock.jsx";
import { SECTIONS, SOURCE } from "./generated-sections.js";
import { highlight } from "./highlight.js";
import { createLiveApi } from "./live-api.js";

const HOST = (typeof window !== "undefined" && window.__CASHIER__) || { live: false };

/* --------------------------------------------------------------- shared --- */

function useTheme() {
  const [theme, setTheme] = useState(function () {
    const saved = typeof localStorage !== "undefined" && localStorage.getItem("cashier.theme");
    return saved === "light" || saved === "dark" ? saved : "dark";
  });
  useEffect(
    function () {
      document.documentElement.setAttribute("data-theme", theme);
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

/* The three flows behind one router. Identical in Mock and Live: only the api
   object handed to the provider differs. */
function Screens() {
  const [screen, setScreen] = useState("wallet");
  const toWallet = useCallback(function () {
    setScreen("wallet");
  }, []);

  return (
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
  );
}

/* ------------------------------------------------------------- mock mode --- */

function MockMode({ theme }) {
  return (
    <div className="stage">
      <PaymentsProvider defaultTheme={theme} demo={true} initialBalanceUsd={1247.85}>
        <Screens />
      </PaymentsProvider>
      <p className="stage-note">
        Amboss Payments cashier for iGaming. Deposit and cash out in dollars. Demo controls skip the
        wait.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- code mode --- */

function CodeMode() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState("");
  const section = SECTIONS[active];
  const scroller = useRef(null);

  useEffect(
    function () {
      if (scroller.current) scroller.current.scrollTop = 0;
    },
    [active]
  );

  const rows = useMemo(
    function () {
      const lines = highlight(section.code.replace(/\s+$/, "")).split("\n");
      return lines.map(function (line, i) {
        return (
          <tr key={i}>
            <td className="ln">{section.start + i}</td>
            <td className="src" dangerouslySetInnerHTML={{ __html: line || " " }} />
          </tr>
        );
      });
    },
    [section]
  );

  function copy(text, label) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(label);
      setTimeout(function () {
        setCopied("");
      }, 1500);
    } catch (e) {
      setCopied("copy blocked");
    }
  }

  const KIND_LABEL = {
    replace: "Replace",
    seam: "Integration seam",
    vendor: "Vendor",
    keep: "Copy as is",
  };

  return (
    <div className="code-mode">
      <div className="chips">
        {SECTIONS.map(function (s, i) {
          return (
            <button
              key={s.id}
              className={"chip" + (i === active ? " on" : "")}
              onClick={function () {
                setActive(i);
              }}
            >
              {s.title}
            </button>
          );
        })}
      </div>

      <div className="note">
        <div className="note-head">
          <h2>{section.title}</h2>
          <span className={"tag " + section.kind}>{KIND_LABEL[section.kind]}</span>
          <span className="grow" />
          <button
            className="btn"
            onClick={function () {
              copy(section.code, "section");
            }}
          >
            {copied === "section" ? "Copied" : "Copy section"}
          </button>
          <button
            className="btn"
            onClick={function () {
              copy(SOURCE, "file");
            }}
          >
            {copied === "file" ? "Copied" : "Copy file"}
          </button>
        </div>
        {section.note ? <p>{section.note}</p> : null}
      </div>

      <div className="codewrap" ref={scroller}>
        <pre className="code">
          <table>
            <tbody>{rows}</tbody>
          </table>
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- live mode --- */

function describeLiveError(e) {
  var msg = (e && e.message) || String(e) || "Could not start Live UI";
  var js = /is not an object|is not a function|Cannot read|undefined|null is not/i.test(msg);
  return {
    title: js ? "This browser hit a script error" : "No connection to the server",
    message: msg,
    hint: js
      ? "That is a browser bug, not a missing network. Try again. If it repeats, switch to Mock UI."
      : "If the venue network is gone, switch to Mock UI. It behaves the same and needs nothing.",
  };
}

function PinDialog({ value, error, busy, onChange, onCancel, onSubmit }) {
  return (
    <div
      className="pin-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-title"
      onClick={function (e) {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <form
        className="pin-card"
        onSubmit={function (e) {
          e.preventDefault();
          if (busy || !value) return;
          onSubmit(value);
        }}
      >
        <h2 id="pin-title">Operator PIN</h2>
        <p>Needed to fund this visitor. Live UI stays open without it.</p>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          value={value}
          disabled={busy}
          aria-label="Operator PIN"
          onChange={function (e) {
            onChange(e.target.value);
          }}
        />
        {error ? <p className="pin-error">{error}</p> : null}
        <button type="submit" className="btn primary big" disabled={busy || !String(value).replace(/\s/g, "")}>
          {busy ? "Funding" : "Unlock and fund"}
        </button>
        <button type="button" className="btn big" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </form>
    </div>
  );
}

function LiveMode({ theme }) {
  const [phase, setPhase] = useState("connecting"); // connecting | ready | error
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
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

  const forgetPin = useCallback(function () {
    setPinOpen(false);
    setPinDraft("");
    setPinError("");
  }, []);

  const newVisitor = useCallback(function () {
    if (!apiRef.current) return;
    forgetPin();
    apiRef.current.newSession().then(function () {
      setNotice("");
      setGeneration(function (g) {
        return g + 1;
      });
    });
  }, [forgetPin]);

  const submitFund = useCallback(function (pin) {
    if (!apiRef.current) return;
    setPinBusy(true);
    apiRef.current
      .fund(pin || "")
      .then(function () {
        /* One Fund event only. Forget the PIN so the next click asks again. */
        forgetPin();
        setNotice("");
        setGeneration(function (g) {
          return g + 1;
        });
      })
      .catch(function (e) {
        var msg = (e && e.message) || "Wrong pin.";
        setPinDraft("");
        setPinError(msg);
        setNotice(msg);
      })
      .then(function () {
        setPinBusy(false);
      });
  }, [forgetPin]);

  const fund = useCallback(
    function () {
      if (!apiRef.current) return;
      /* Live UI is public. The PIN is only for this Fund click. window.prompt
         is a no-op on many iPad Chrome/Safari builds, so the unlock UI is
         in-page. Never cache the PIN across Fund events. */
      if (config && config.pinRequired) {
        setPinDraft("");
        setPinError("");
        setPinOpen(true);
        return;
      }
      submitFund("");
    },
    [config, submitFund]
  );

  if (!HOST.live)
    return (
      <div className="stage">
        <div className="offline-card">
          <h2>Live mode needs the hosted build</h2>
          <p>
            This is the offline file. It carries the mock and the code so a dead venue network
            cannot take the demo down, but real invoices need the server.
          </p>
          <p className="dim">Hosted at the URL on your booth card. Same three tabs, live tab on.</p>
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
          <p className="dim">
            {error && error.hint
              ? error.hint
              : "If the venue network is gone, switch to Mock UI. It behaves the same and needs nothing."}
          </p>
        </div>
      </div>
    );

  var cfg = config || {};

  return (
    <div className="stage">
      <div className="livebar">
        <span className="live-dot" />
        <span className="live-label">
          LIVE · {cfg.asset || "wallet"}
          {cfg.mock ? " · mock api" : ""}
        </span>
        <span className="live-caps">
          up to ${cfg.maxDepositUsd} in, ${cfg.maxWithdrawUsd} out
          {cfg.addressPayouts ? "" : " · invoices only"}
        </span>
        <span className="grow" />
        <button className="btn" onClick={fund}>
          Fund
        </button>
        <button className="btn" onClick={newVisitor}>
          New visitor
        </button>
      </div>

      {notice ? <div className="livenotice">{notice}</div> : null}

      <PaymentsProvider
        key={generation}
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

      <p className="stage-note">
        Live deposit and cash out through Amboss Payments. Tap New visitor between demos.
      </p>

      {pinOpen ? (
        <PinDialog
          value={pinDraft}
          error={pinError}
          busy={pinBusy}
          onChange={setPinDraft}
          onCancel={function () {
            if (pinBusy) return;
            forgetPin();
          }}
          onSubmit={submitFund}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ app --- */

const MODES = [
  { id: "mock", label: "Mock UI" },
  { id: "code", label: "Code View" },
  { id: "live", label: "Live UI" },
];

export default function App() {
  const [mode, setMode] = useState("mock");
  const [theme, setTheme] = useTheme();

  return (
    <div className="app">
      <Styles />
      <header className="topbar">
        <div className="brand">
          <span className="glyph">$</span>
          <span className="brand-text">
            <strong>Cashier</strong>
            <em>Amboss Payments</em>
          </span>
        </div>

        <div className="modes" role="tablist">
          {MODES.map(function (m) {
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={"mode" + (mode === m.id ? " on" : "")}
                onClick={function () {
                  setMode(m.id);
                }}
              >
                {m.label}
                {m.id === "live" && HOST.live ? <span className="mode-dot" /> : null}
              </button>
            );
          })}
        </div>

        <button
          className="btn icon"
          aria-label="Switch theme"
          onClick={function () {
            setTheme(theme === "dark" ? "light" : "dark");
          }}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </header>

      <main className="content">
        {mode === "mock" ? (
          <MockMode theme={theme} />
        ) : mode === "code" ? (
          <CodeMode />
        ) : (
          <LiveMode theme={theme} />
        )}
      </main>

      {mode !== "code" ? (
        <footer className="booth-foot">
          Powered by Amboss Payments · Get started at{" "}
          <a href="https://amboss.tech" target="_blank" rel="noopener noreferrer">
            amboss.tech
          </a>
        </footer>
      ) : null}
    </div>
  );
}
