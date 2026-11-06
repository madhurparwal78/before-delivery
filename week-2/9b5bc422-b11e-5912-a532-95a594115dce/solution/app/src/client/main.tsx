import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadWorkspace } from "./store/workspace.ts";
import { startSync } from "./store/sync.ts";
import { App } from "./ui/App.tsx";
import { startColourScheme } from "./ui/colourScheme.ts";
import { SharedPage } from "./ui/SharedPage.tsx";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/documents.css";
import "./styles/records.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

async function prepareOffline(): Promise<void> {
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  document.documentElement.dataset["offlineReady"] = "true";
}

async function start(): Promise<void> {
  startColourScheme();
  const shared = /^\/s\/([^/]+)$/.exec(window.location.pathname);
  if (shared?.[1]) {
    root.render(<StrictMode><SharedPage token={decodeURIComponent(shared[1])} /></StrictMode>);
    return;
  }
  await loadWorkspace();
  root.render(<StrictMode><App /></StrictMode>);
  startSync();
  await prepareOffline();
}

void start();
