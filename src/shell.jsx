import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BOOTH,
  PaymentsProvider,
  Styles,
  WalletView,
  DepositFlow,
  WithdrawFlow,
} from "./AmbossCashierMock.jsx";
import { SECTIONS, SOURCE } from "./generated-sections.js";
import { highlight } from "./highlight.js";
import { AmbossLetter, AmbossLogo } from "./AmbossLogo.jsx";
import { createLiveApi } from "./live-api.js";
import { DOCS, MAP_LINE, SANDBOX_META, SNIPPETS, snippetById, snippetIdForAction } from "./sdk-guide.js";

const HOST = (typeof window !== "undefined" && window.__CASHIER__) || { live: false };
/* Injected by build.mjs. typeof of an undeclared identifier is safe. */
const BUILD_ID = typeof __BUILD__ === "string" ? __BUILD__ : "dev";

/* --------------------------------------------------------------- shared --- */

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

/* The three flows behind one router. Identical in Mock and Live: only the api
   object handed to the provider differs. */
function Screens({ onDemoAction, staff, discovery }) {
  const [screen, setScreen] = useState("wallet");
  const toWallet = useCallback(function () {
    setScreen("wallet");
  }, []);

  return (
    <div className="phone">
      {screen === "wallet" ? (
        <WalletView
          staff={staff}
          discovery={discovery}
          onDeposit={function () {
            if (onDemoAction) onDemoAction("deposit");
            setScreen("deposit");
          }}
          onWithdraw={function () {
            if (onDemoAction) onDemoAction("withdraw");
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

function MockMode({ theme, onDemoAction }) {
  return (
    <div className="stage">
      <PaymentsProvider defaultTheme={theme} demo={true} initialBalanceUsd={1247.85}>
        <Screens onDemoAction={onDemoAction} discovery={true} />
      </PaymentsProvider>
      <p className="stage-note">Amboss Payments cashier for iGaming. Deposit and cash out in dollars.</p>
    </div>
  );
}

/* ------------------------------------------------------------- code mode --- */

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      /* fall through to execCommand */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    /* clipboard blocked */
  }
  document.body.removeChild(ta);
}

function DocLinks({ links }) {
  return (
    <span className="sdk-docs">
      {links.map(function (link, i) {
        return (
          <a key={link.href + i} href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
          </a>
        );
      })}
    </span>
  );
}

function SnippetCard({ snippet, active, copied, onCopy, onSelect }) {
  const html = useMemo(
    function () {
      return highlight(snippet.code.replace(/\s+$/, "")).split("\n");
    },
    [snippet]
  );

  return (
    <article
      className={"sdk-card" + (active ? " on" : "")}
      data-snippet={snippet.id}
      data-active={active ? "true" : "false"}
      onClick={function () {
        if (!active && onSelect) onSelect(snippet.id);
      }}
    >
      <div className="sdk-card-head">
        <h3>{snippet.title}</h3>
        <DocLinks links={snippet.docs} />
        <span className="grow" />
        <button
          className="btn"
          type="button"
          onClick={function () {
            onCopy(snippet.id, snippet.code);
          }}
        >
          {copied === snippet.id ? "Copied" : "Copy"}
        </button>
      </div>
      {snippet.note ? <p className="sdk-card-note">{snippet.note}</p> : null}
      {active ? (
        <div className="codewrap sdk-card-code">
          <pre className="code">
            <table>
              <tbody>
                {html.map(function (line, i) {
                  return (
                    <tr key={i}>
                      <td className="src" dangerouslySetInnerHTML={{ __html: line || " " }} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </pre>
        </div>
      ) : null}
    </article>
  );
}

function MockSource() {
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
      copyText(text);
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
    <div className="mock-source" data-mock-source="true">
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

function CodeMode({ focusAction }) {
  const focusId = snippetIdForAction(focusAction);
  const [active, setActive] = useState(focusId);
  const [copied, setCopied] = useState("");
  const [showSource, setShowSource] = useState(false);
  const listRef = useRef(null);

  useEffect(
    function () {
      setActive(focusId);
    },
    [focusId]
  );

  useEffect(
    function () {
      var root = listRef.current;
      if (!root) return;
      var card = root.querySelector('[data-snippet="' + active + '"]');
      if (card && card.scrollIntoView) {
        try {
          card.scrollIntoView({ block: "start" });
        } catch (e) {
          card.scrollIntoView(true);
        }
      }
    },
    [active]
  );

  function copy(id, text) {
    try {
      copyText(text);
      setCopied(id);
      setTimeout(function () {
        setCopied("");
      }, 1500);
    } catch (e) {
      setCopied("copy blocked");
    }
  }

  const current = snippetById(active);
  const fromDemo = current && current.action && current.action === focusAction;

  return (
    <div className="code-mode sdk-guide">
      <div className="sdk-intro">
        <div className="sdk-intro-head">
          <h2>Official SDK</h2>
          <a className="sdk-cta" href={DOCS.gettingStarted} target="_blank" rel="noopener noreferrer">
            Full walkthrough
          </a>
        </div>
        <p>
          The cashier mock talks dollars through a React seam. Copy these{" "}
          <code>@ambosstech/payments</code> calls into your server. Do not ship{" "}
          <code>createInvoice</code> as the real API.
        </p>
      </div>

      <div className="sdk-callout" data-sandbox-callout="true">
        <strong>Sandbox first.</strong> Add{" "}
        <code>{SANDBOX_META}</code> on receive and send so you can try tonight
        without Lightning. Sandbox send needs no team password.
      </div>

      <p className="sdk-map" data-sdk-map="true">
        <code>{MAP_LINE.mock}</code>
        <span className="sdk-map-arrow"> → </span>
        <code>{MAP_LINE.sdk}</code>
      </p>

      <div className="sdk-tabs" role="tablist" aria-label="SDK snippets">
        {SNIPPETS.map(function (s) {
          return (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={active === s.id}
              className={"sdk-tab" + (active === s.id ? " on" : "")}
              data-sdk-tab={s.id}
              onClick={function () {
                setActive(s.id);
              }}
            >
              {s.title}
            </button>
          );
        })}
      </div>

      {fromDemo ? <p className="sdk-follow">{current.hint}</p> : null}

      <div className="sdk-list" ref={listRef}>
        {SNIPPETS.map(function (s) {
          return (
            <SnippetCard
              key={s.id}
              snippet={s}
              active={active === s.id}
              copied={copied}
              onCopy={copy}
              onSelect={setActive}
            />
          );
        })}
      </div>

      <div className="sdk-source-bar">
        <button
          className="btn"
          type="button"
          data-source-toggle="true"
          onClick={function () {
            setShowSource(function (open) {
              return !open;
            });
          }}
        >
          {showSource ? "Hide full mock source" : "Show full mock source"}
        </button>
      </div>

      {showSource ? <MockSource /> : null}
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

function LiveMode({ theme, onDemoAction }) {
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
      /* Empty / missing OPERATOR_PIN (or FUND_ENABLED=false) means Fund is off.
         Do not treat "no PIN" as unlocked — that used to grant float. */
      if (!config || !config.fundEnabled) return;
      /* Live UI is public. The PIN is only for this Fund click. window.prompt
         is a no-op on many iPad Chrome/Safari builds, so the unlock UI is
         in-page. Never cache the PIN across Fund events. */
      setPinDraft("");
      setPinError("");
      setPinOpen(true);
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
        <Screens
          onDemoAction={onDemoAction}
          staff={{ onFund: fund, onNewVisitor: newVisitor, fundEnabled: Boolean(cfg.fundEnabled) }}
        />
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
  const [focusAction, setFocusAction] = useState(null);

  return (
    <div className={"app" + (mode === "mock" ? " app-mock" : "")}>
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

      {mode === "mock" ? (
        <p className="booth-tagline" data-booth-tagline>
          {BOOTH.tagline}
        </p>
      ) : null}

      <main className="content">
        {mode === "mock" ? (
          <MockMode theme={theme} onDemoAction={setFocusAction} />
        ) : mode === "code" ? (
          <CodeMode focusAction={focusAction} />
        ) : (
          <LiveMode theme={theme} onDemoAction={setFocusAction} />
        )}
      </main>

      {mode !== "code" ? (
        <footer className="booth-foot">
          <AmbossLogo gid="amboss-grad-foot" className="booth-foot-logo" />
          <p>
            Powered by Amboss Payments · Get started at{" "}
            <a href="https://amboss.tech" target="_blank" rel="noopener noreferrer">
              amboss.tech
            </a>
          </p>
          <p className="booth-foot-build">{BUILD_ID}</p>
        </footer>
      ) : null}
    </div>
  );
}
