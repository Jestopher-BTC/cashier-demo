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
        Nothing here touches a network. Demo controls under each screen drive the states you would
        otherwise have to wait for.
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

function LiveMode({ theme }) {
  const [phase, setPhase] = useState("connecting"); // connecting | ready | error
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const apiRef = useRef(null);
  const pinRef = useRef("");

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
        setConfig(r.config);
        setPhase("ready");
      })
      .catch(function (e) {
        if (cancelled) return;
        setError(e.message || "Could not reach the server");
        setPhase("error");
      });
    return function () {
      cancelled = true;
    };
  }, []);

  const newVisitor = useCallback(function () {
    if (!apiRef.current) return;
    apiRef.current.newSession().then(function () {
      setNotice("");
      setGeneration(function (g) {
        return g + 1;
      });
    });
  }, []);

  const fund = useCallback(
    function () {
      if (!apiRef.current) return;
      if (config && config.pinRequired && !pinRef.current) {
        const entered = window.prompt("Operator pin");
        if (!entered) return;
        pinRef.current = entered;
      }
      apiRef.current
        .fund(pinRef.current)
        .then(function () {
          setNotice("");
          setGeneration(function (g) {
            return g + 1;
          });
        })
        .catch(function (e) {
          pinRef.current = "";
          setNotice(e.message);
        });
    },
    [config]
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
          <p className="dim">Opening a session against the Payments API.</p>
        </div>
      </div>
    );

  if (phase === "error")
    return (
      <div className="stage">
        <div className="offline-card">
          <h2>No connection to the server</h2>
          <p className="dim">{error}</p>
          <button
            className="btn primary big"
            onClick={function () {
              window.location.reload();
            }}
          >
            Try again
          </button>
          <p className="dim">
            If the venue network is gone, switch to Mock UI. It behaves the same and needs nothing.
          </p>
        </div>
      </div>
    );

  return (
    <div className="stage">
      <div className="livebar">
        <span className="live-dot" />
        <span className="live-label">
          LIVE · {config.asset}
          {config.mock ? " · mock api" : ""}
        </span>
        <span className="live-caps">
          up to ${config.maxDepositUsd} in, ${config.maxWithdrawUsd} out
          {config.addressPayouts ? "" : " · invoices only"}
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
        capabilities={{ addressPayouts: config.addressPayouts }}
        limits={{
          depositMin: config.minDepositUsd,
          depositMax: config.maxDepositUsd,
          withdrawMin: config.minWithdrawUsd,
          invoiceSeconds: config.invoiceSeconds,
        }}
      >
        <Screens />
      </PaymentsProvider>

      <p className="stage-note">
        Real invoices, real payouts, real money. Tap New visitor between demos to clear the balance.
      </p>
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
    </div>
  );
}
