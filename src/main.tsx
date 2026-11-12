import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { migrateStorageNamespace } from "./lib/settings";
import "./styles/styles.css";

migrateStorageNamespace();

const disableBrowserBehaviors = () => {
  window.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === "F5" || (modifier && (key === "r" || key === "p" || key === "u"))) {
      event.preventDefault();
    }
    const editable = event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']");
    if (!editable && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
    }
  });

  window.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest("[draggable='true']")) return;
    event.preventDefault();
  });
};

disableBrowserBehaviors();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
