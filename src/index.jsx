import "./polyfills.js";

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./shell.jsx";

function boot() {
  var host = document.getElementById("root");
  try {
    createRoot(host).render(React.createElement(App));
  } catch (err) {
    if (typeof console !== "undefined") console.error(err);
    host.style.display = "none";
    var fallback = document.getElementById("boot-error");
    if (fallback) fallback.style.display = "block";
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
