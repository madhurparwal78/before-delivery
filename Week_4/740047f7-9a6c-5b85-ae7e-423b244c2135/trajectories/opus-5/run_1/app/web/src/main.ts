import { isTouch } from "./dom";
import { startLive } from "./live";
import { defineRoute, startRouter } from "./router";
import { devicesPage } from "./pages/devices";
import { divesPage } from "./pages/dives";
import { importsPage } from "./pages/imports";
import { pensPage } from "./pages/pens";
import { reportsPage } from "./pages/reports";
import { sharePage } from "./pages/share";
import { workspacePage } from "./pages/workspace";
import {
  announce,
  buildTopBar,
  consoleUpdates,
  markCurrentNav,
  openShortcutsDialog,
} from "./shell";
import { copy } from "./copy";
import { loadState } from "./state";

loadState();
if (isTouch()) document.body.classList.add("touch");

const app = document.getElementById("app");
const reportOnly = window.location.pathname.startsWith("/r/");
if (app) {
  document.body.insertBefore(buildTopBar(reportOnly), app);
  document.body.appendChild(consoleUpdates());

  defineRoute(/^\/$/, () => (container) => pensPage(container));
  defineRoute(/^\/pens\/([^/]+)$/, (params) => (container) =>
    workspacePage(container, params[0]),
  );
  defineRoute(/^\/dives$/, () => (container) => divesPage(container));
  defineRoute(/^\/imports$/, () => (container) => importsPage(container));
  defineRoute(/^\/reports$/, () => (container) => reportsPage(container));
  defineRoute(/^\/devices$/, () => (container) => devicesPage(container));
  defineRoute(/^\/r\/([^/]+)$/, (params) => (container) => sharePage(container, params[0]));

  startRouter(app, (path) => markCurrentNav(path));
  if (!reportOnly) startLive();

  window.addEventListener("pensight:unreachable", () => announce(copy.unreachable));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "?") return;
    const node = event.target as HTMLElement | null;
    const tag = node?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (window.location.pathname.startsWith("/r/")) return;
    openShortcutsDialog();
  });
}
