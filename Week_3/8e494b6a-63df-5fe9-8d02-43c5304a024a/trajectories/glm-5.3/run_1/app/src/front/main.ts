/**
 * The app entry: boots the shell, loads the session and routes the view.
 */
import { effect, h } from "./core";
import {
  addLiveHandler,
  api,
  liveSeq,
  announcement,
  ingestLine,
  loadMe,
  me,
  notice,
  refreshTime,
  serverNow,
  startLive,
} from "./api";
import { buildShell, currentRoute, loadFailedAlert, main, navigate } from "./shell";
import { buildAuth } from "./auth";
import { openAccountDialog, openSpaceMenu } from "./modals";
import { buildExplore } from "./explore";
import { buildPipes } from "./pipes";
import { buildStreams, buildStreamPage } from "./streams";
import { buildPipelines, buildPipelineEditor, buildSimulate } from "./pipelines";
import { buildAlerts, buildNewRule, buildRulePage, buildMaintenance } from "./alerts";
import { buildInbox } from "./inbox";
import { buildCases, buildCasePage } from "./cases";
import { buildTraces, buildTracePage } from "./traces";
import { buildObjectives } from "./objectives";
import { buildSpaces } from "./spaces";
import { buildKeys } from "./keys";
import { buildRules } from "./inbox";
import { buildAnalyzePage } from "./streams";
import { buildLifecycle } from "./lifecycle-page";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing root");
const root: HTMLElement = rootEl;

let view = h("div", {});
let routeStop: (() => void) | null = null;
let ingestLoaded = false;

/** The ingest status line for the current space. */
async function refreshIngest(): Promise<void> {
  try {
    const streams = await api<{ streams: { events: number; failures: number }[] }>("/api/streams");
    const stored = streams.streams.reduce((a, s) => a + s.events, 0);
    const failed = streams.streams.reduce((a, s) => a + s.failures, 0);
    ingestLine.set({ stored, failed });
  } catch {
    // the line keeps its last value
  }
}

addLiveHandler("upload", (data) => {
  if (data.stored_total !== undefined) {
    ingestLine.set({ stored: Number(data.stored_total), failed: Number(data.failure_total ?? 0) });
  } else {
    void refreshIngest();
  }
});

addLiveHandler("lifecycle", (data) => {
  if (data.stored_total !== undefined) {
    ingestLine.set({ stored: Number(data.stored_total), failed: Number(data.failure_total ?? 0) });
  } else {
    void refreshIngest();
  }
});

function render(): void {
  const path = currentRoute();
  const user = me();
  if (!user) {
    location.href = "/signin";
    return;
  }
  if (routeStop) routeStop();
  view = h("div", {});
  view.setAttribute("data-seq", String(latestSeq));
  view.setAttribute("data-pending", "0");
  main.replaceChildren(view);
  const [pathname] = path.split("?");
  if (pathname === "/" || pathname === "/explore") buildExplore(view);
  else if (pathname === "/pipes") buildPipes(view);
  else if (pathname === "/streams") buildStreams(view);
  else if (pathname.startsWith("/streams/")) {
    const parts = pathname.split("/");
    const stream = decodeURIComponent(parts[2] ?? "");
    if (parts[3] === "analyze") buildAnalyzePage(view, stream);
    else if (parts[3] === "lifecycle") buildLifecycle(view, stream);
    else buildStreamPage(view, stream);
  } else if (pathname === "/pipelines") buildPipelines(view);
  else if (pathname.startsWith("/pipelines/")) {
    const parts = pathname.split("/");
    const name = decodeURIComponent(parts[2] ?? "");
    if (parts[3] === "simulate") buildSimulate(view, name);
    else buildPipelineEditor(view, name);
  } else if (pathname === "/alerts") buildAlerts(view);
  else if (pathname === "/alerts/new") buildNewRule(view);
  else if (pathname === "/alerts/maintenance") buildMaintenance(view);
  else if (pathname.startsWith("/alerts/")) buildRulePage(view, pathname.slice("/alerts/".length));
  else if (pathname === "/inbox") buildInbox(view);
  else if (pathname === "/cases") buildCases(view);
  else if (pathname.startsWith("/cases/")) buildCasePage(view, Number(pathname.slice("/cases/".length)));
  else if (pathname === "/traces") buildTraces(view);
  else if (pathname.startsWith("/traces/")) buildTracePage(view, pathname.slice("/traces/".length));
  else if (pathname === "/objectives") buildObjectives(view);
  else if (pathname === "/spaces") buildSpaces(view);
  else if (pathname === "/keys") buildKeys(view);
  else if (pathname === "/rules") buildRules(view);
  else buildNotFound(view);
  main.setAttribute("data-seq", String(latestSeq));
}

let latestSeq = 0;

function buildNotFound(view: HTMLElement): void {
  const box = h("div", { class: "empty-band" });
  box.style.marginTop = "40px";
  const heading = h("h1", {}, "Page not found.");
  const link = document.createElement("a");
  link.href = "/explore";
  link.textContent = "Go to Explore";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigate("/explore");
  });
  box.append(heading, link);
  view.append(box);
}

async function boot(): Promise<void> {
  await refreshTime();
  await loadMe();
  const shellUser = me();
  buildShell(root, view, shellUser !== null && location.pathname !== "/signin" && location.pathname !== "/signup");
  await loadMe();
  await loadMe();
  const user = me();
  const pathname = location.pathname;
  if (!user) {
    if (pathname === "/signin" || pathname === "/signup") {
      buildAuth(view, pathname === "/signin" ? "signin" : "signup");
    } else {
      location.href = "/signin";
    }
    return;
  }
  if (pathname === "/signin" || pathname === "/signup") {
    location.href = "/explore";
    return;
  }
  startLive(user.space.slug);
  void refreshIngest();
  render();

  // Wire header buttons.
  const spaceBtn = document.querySelector<HTMLButtonElement>(".workspace-header button");
  if (spaceBtn) {
    spaceBtn.addEventListener("click", () => openSpaceMenu(spaceBtn));
  }
  const accountBtn = document.querySelectorAll<HTMLButtonElement>(".workspace-header button")[1];
  if (accountBtn) accountBtn.addEventListener("click", () => openAccountDialog(accountBtn));

  effect(() => {
    const m = me();
    const btns = document.querySelectorAll<HTMLButtonElement>(".workspace-header button");
    if (btns[0]) btns[0].textContent = m?.space.name ?? "";
  });
  effect(() => {
    const line = ingestLine();
    const el = document.querySelector<HTMLElement>('[role="region"][aria-label="Ingest status"]');
    if (el && line) el.textContent = `${line.stored} events stored, ${line.failed} in failure store`;
  });
  effect(() => {
    const el = document.querySelector<HTMLElement>('[role="status"][aria-label="Announcements"]');
    if (el) el.textContent = announcement();
  });
  effect(() => {
    const el = document.querySelector<HTMLElement>(".notice");
    if (!el) return;
    const n = notice();
    if (n) {
      el.style.display = "block";
      (el.firstElementChild as HTMLElement).textContent = n;
    } else {
      el.style.display = "none";
    }
  });

  window.addEventListener("popstate", () => {
    currentRoute.set(location.pathname + location.search);
  });
  effect(() => {
    currentRoute();
    render();
    void refreshIngest();
  });

  // Track the live seq for the page's data-seq.
  effect(() => {
    latestSeq = liveSeq();
    main.setAttribute("data-seq", String(latestSeq));
    view.setAttribute("data-seq", String(latestSeq));
  });
}

void boot();
