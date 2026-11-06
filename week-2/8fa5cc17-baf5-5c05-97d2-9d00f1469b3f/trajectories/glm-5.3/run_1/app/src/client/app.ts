// The workspace frame: layouts, routing, sign-in, the library rail, the
// drawer and bottom sheet, and the shared app state.

import { api, setCsrfToken, setUnauthenticatedHandler, apiFail, type ObjectJson, type TypeJson, type CollectionJson } from "./api.js";
import { h, clearChildren, announce, reducedMotion, dateHeading, dateTimeShort, openDialog, clearAlert } from "./dom.js";
import { runSpring, type SpringHandle } from "./motion.js";
import { LiveSyncClient } from "./sync.js";
import { MOTION, QUIRE_CURVE } from "./constants.js";
import { openObjectScreen } from "./object.js";
import { openPalette } from "./palette.js";
import { openToday } from "./daily.js";
import { openTypeScreen } from "./types-page.js";
import { openCollectionScreen, openBoard } from "./collection.js";
import { openTimeline } from "./timeline.js";
import { openQueriesScreen, openQueryScreen } from "./queries.js";
import { openGraphScreen } from "./graph.js";
import { openSettingsScreen, applyTheme } from "./settings.js";

export interface AppState {
  sessionId: string;
  homeTimeZone: string;
  theme: "paper" | "lamplight";
  types: TypeJson[];
  collections: CollectionJson[];
  todayDate: string;
  recentNotes: Array<{ date: string; object_id: string }>;
}

export const state: { app: AppState | null } = { app: null };

export const screens = {
  current: null as null | { dispose: () => void },
};

export function mainEl(): HTMLElement {
  return document.querySelector("main") as HTMLElement;
}

export function frameEl(): HTMLElement {
  return document.getElementById("frame") as HTMLElement;
}

// ---------------------------------------------------------------------------
// Routing

const routes: Array<{ re: RegExp; open: (m: RegExpMatchArray, path: string, query: URLSearchParams) => void }> = [
  { re: /^\/today$/, open: () => openToday(revealDaily()) },
  { re: /^\/o\/([^/]+)$/, open: (m) => openObjectScreen(m[1], false) },
  { re: /^\/types\/([^/]+)$/, open: (m) => openTypeScreen(m[1]) },
  { re: /^\/collections\/([^/]+)\/board$/, open: (m) => openBoard(m[1]) },
  { re: /^\/collections\/([^/]+)$/, open: (m) => openCollectionScreen(m[1]) },
  { re: /^\/timeline$/, open: () => openTimeline() },
  { re: /^\/queries$/, open: () => openQueriesScreen() },
  { re: /^\/queries\/([^/]+)$/, open: (m) => openQueryScreen(m[1]) },
  { re: /^\/graph$/, open: (_m, _p, query) => openGraphScreen(query) },
  { re: /^\/settings$/, open: () => openSettingsScreen() },
];

/** Whether a move to a daily note should reveal. Set by the router. */
export function revealDaily(): boolean {
  return window.__quireDailyReveal === true;
}

async function navigate(path: string, push = true): Promise<void> {
  if (push) history.pushState(null, "", path);
  await render(path);
}

export async function render(path: string): Promise<void> {
  const main = mainEl();
  if (screens.current !== null) {
    screens.current.dispose();
    screens.current = null;
  }
  clearChildren(main);
  clearAlert();
  for (const route of routes) {
    const m = path.match(route.re);
    if (m !== null) {
      route.open(m, path, new URLSearchParams(new URL(path, location.origin).search));
      return;
    }
  }
  notFound();
}

export function notFound(): void {
  const main = mainEl();
  main.append(h("h1", { text: "We can't find that note." }));
}

// ---------------------------------------------------------------------------
// Boot

export async function boot(): Promise<void> {
  const path = location.pathname + location.search;
  try {
    const session = await api<{ session_id: string; home_time_zone: string; theme: string; user: { email: string } }>("GET", "/api/session");
    setCsrfToken((session as unknown as { csrf_token: string }).csrf_token);
    await startWorkspace(session.session_id, session.home_time_zone, session.theme === "lamplight" ? "lamplight" : "paper");
  } catch {
    // signed out: go to sign-in with the return address
    const encoded = encodeURIComponent(path);
    location.replace(`/sign-in?return=${encoded}`);
  }
}

async function startWorkspace(sessionId: string, zone: string, theme: "paper" | "lamplight"): Promise<void> {
  state.app = {
    sessionId,
    homeTimeZone: zone,
    theme,
    types: [],
    collections: [],
    todayDate: "",
    recentNotes: [],
  };
  buildFrame();
  applyTheme(theme);
  const refresh = async (): Promise<void> => {
    if (state.app === null) return;
    const types = await api<{ types: TypeJson[] }>("GET", "/api/types");
    state.app.types = types.types;
    const collections = await api<{ collections: CollectionJson[] }>("GET", "/api/collections");
    state.app.collections = collections.collections;
    const recent = await api<{ notes: Array<{ date: string; object_id: string }> }>("GET", "/api/daily/recent");
    state.app.recentNotes = recent.notes;
    buildRail();
  };
  await refresh();

  const statusEl = document.getElementById("sync-status");
  const sync = new LiveSyncClient(
    (ev) => {
      void handleEvent(ev);
    },
    () => {
      // reset: refetch the open screen, keeping dialogs, focus and the caret
      render(location.pathname + location.search).catch(() => undefined);
    },
    statusEl
  );
  sync.start();
  setUnauthenticatedHandler(() => {
    const p = location.pathname + location.search;
    location.replace(`/sign-in?return=${encodeURIComponent(p)}&signedout=1`);
  });

  // the router
  const initialPath = location.pathname === "/" ? "/today" : location.pathname === "/sign-in" ? "/today" : location.pathname + location.search;
  if (location.pathname === "/") history.replaceState(null, "", "/today");
  await render(initialPath);
  window.addEventListener("popstate", () => {
    render(location.pathname + location.search).catch(() => undefined);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    }
  });
  window.__quireSync = sync;
  window.__quireRefresh = refresh;
}

export async function handleEvent(ev: { event: string; data: Record<string, unknown> }): Promise<void> {
  if (ev.event === "settings.saved") {
    const zone = String(ev.data.home_time_zone ?? "");
    const theme = ev.data.theme === "lamplight" ? "lamplight" : "paper";
    if (state.app !== null) {
      state.app.homeTimeZone = zone;
      if (state.app.theme !== theme) {
        state.app.theme = theme;
        applyTheme(theme);
      }
    }
    return;
  }
  if (ev.event === "session.ended") {
    const p = location.pathname + location.search;
    location.replace(`/sign-in?return=${encodeURIComponent(p)}&signedout=1`);
    return;
  }
  if (ev.event === "types.changed" || ev.event === "object.saved" || ev.event === "object.removed") {
    if (window.__quireRefresh !== undefined) await window.__quireRefresh();
    document.dispatchEvent(new CustomEvent("quire-event", { detail: ev }));
    return;
  }
  document.dispatchEvent(new CustomEvent("quire-event", { detail: ev }));
}

// ---------------------------------------------------------------------------
// The frame and the layouts

function buildFrame(): void {
  const existing = document.getElementById("frame");
  if (existing !== null) return;
  const progress = h("div", { class: "reading-progress", "data-reading-progress": "", "aria-hidden": "true" });
  const library = h(
    "nav",
    { id: "rail", "aria-label": "Library" },
    h("button", { class: "rail-today", onclick: () => navigate("/today") }, "Today"),
    h("div", { class: "rail-section", id: "rail-types" }),
    h("div", { class: "rail-section", id: "rail-collections" }),
    h("div", { class: "rail-section", id: "rail-daily" }),
    h("div", { class: "rail-section", id: "rail-links" })
  );
  const main = h("main", { id: "main", tabindex: "-1" }, progress);
  const margin = h("aside", { id: "margin", role: "complementary", "aria-label": "Margin" });
  const openLibraryBtn = h("button", { class: "icon-btn open-library", "aria-label": "Open library", onclick: () => openDrawer() }, "☰");
  const openMarginBtn = h("button", { class: "icon-btn open-margin", "aria-label": "Open margin", onclick: () => openSheet() }, "≡");
  const topbar = h("div", { class: "topbar" }, openLibraryBtn, h("span", { class: "topbar-title", id: "topbar-title" }), openMarginBtn);
  const frame = h(
    "div",
    { id: "frame" },
    topbar,
    library,
    main,
    margin,
    h("div", { id: "save-status", role: "status", "aria-label": "Save status" }),
    h("div", { id: "sync-status", role: "status", "aria-label": "Sync status" }, "Live"),
    h("div", { id: "announcements", role: "status", "aria-live": "polite", class: "sr-only" }),
    h("div", { id: "app-alert", role: "alert", class: "sr-only" }),
    h("div", { id: "storage-status", role: "alert", "aria-label": "Storage status" })
  );
  document.body.append(frame);
  document.documentElement.dataset.theme = state.app?.theme ?? "paper";
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  checkStorage();
  setInterval(checkStorage, 10000);
}

async function checkStorage(): Promise<void> {
  try {
    const res = await api<{ storage: string }>("GET", "/api/storage");
    const banner = document.getElementById("storage-status");
    if (banner === null) return;
    if (res.storage === "unavailable") {
      banner.textContent = "Attachments are unavailable right now. Your writing is still saved.";
      document.dispatchEvent(new CustomEvent("quire-storage", { detail: { available: false } }));
    } else {
      banner.textContent = "";
      document.dispatchEvent(new CustomEvent("quire-storage", { detail: { available: true } }));
    }
  } catch {
    // keep the last state
  }
}

export function updateProgress(): void {
  const bar = document.querySelector("[data-reading-progress]") as HTMLElement | null;
  if (bar === null) return;
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  const p = scrollable <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / scrollable));
  bar.style.transform = `scaleX(${p})`;
}

function buildRail(): void {
  if (state.app === null) return;
  const typesHost = document.getElementById("rail-types");
  const collHost = document.getElementById("rail-collections");
  const dailyHost = document.getElementById("rail-daily");
  const linksHost = document.getElementById("rail-links");
  if (typesHost === null || collHost === null || dailyHost === null || linksHost === null) return;
  clearChildren(typesHost);
  typesHost.append(h("h3", { text: "Types" }));
  for (const t of state.app.types) {
    typesHost.append(
      h("a", { href: `/types/${t.id}`, class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/types/${t.id}`); } }, t.name)
    );
  }
  const newType = h("button", { class: "rail-new-type", onclick: () => openNewTypeDialog() }, "New type");
  typesHost.append(newType);
  clearChildren(collHost);
  collHost.append(h("h3", { text: "Collections" }));
  for (const c of state.app.collections) {
    collHost.append(
      h("a", { href: `/collections/${c.id}`, class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/collections/${c.id}`); } }, c.name)
    );
  }
  clearChildren(dailyHost);
  dailyHost.append(h("h3", { text: "Daily notes" }));
  for (const n of state.app.recentNotes.slice(0, 7)) {
    dailyHost.append(
      h("a", {
        href: `/o/${n.object_id}`,
        class: "rail-link",
        onclick: (e: MouseEvent) => {
          e.preventDefault();
          window.__quireDailyReveal = true;
          void navigate(`/o/${n.object_id}`);
        },
      }, dateHeading(n.date))
    );
  }
  clearChildren(linksHost);
  linksHost.append(
    h("a", { href: "/timeline", class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate("/timeline"); } }, "Timeline"),
    h("a", { href: "/queries", class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate("/queries"); } }, "Queries"),
    h("a", { href: "/graph", class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate("/graph"); } }, "Graph"),
    h("a", { href: "/settings", class: "rail-link", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate("/settings"); } }, "Settings")
  );
}

// ---------------------------------------------------------------------------
// The drawer and the bottom sheet

interface Panel {
  dialog: HTMLElement;
  backdrop: HTMLElement;
  spring: SpringHandle | null;
  open: boolean;
  closing: boolean;
}

let drawerPanel: Panel | null = null;
let sheetPanel: Panel | null = null;

function layoutWidth(): "wide" | "tablet" | "phone" {
  const w = window.innerWidth;
  if (w >= 1200) return "wide";
  if (w >= 768) return "tablet";
  return "phone";
}

function isDrawerLayout(): boolean {
  return layoutWidth() !== "wide";
}

function openDrawer(): void {
  if (drawerPanel !== null) {
    // retarget while closing: reopen from where it is
    const panel = drawerPanel;
    const st = panel.spring !== null ? panel.spring.cancel() : { offset: 0, velocity: 0 };
    const target = panel.dialog.offsetWidth;
    panel.open = true;
    panel.closing = false;
    panel.dialog.style.visibility = "visible";
    panel.backdrop.style.visibility = "visible";
    if (reducedMotion()) {
      panel.dialog.style.transform = "translateX(0)";
      panel.backdrop.style.opacity = "1";
      st.velocity = 0;
      void st;
    } else {
      panel.spring = runSpring(st, target, (offset) => {
        panel.dialog.style.transform = `translateX(${offset - target}px)`;
        panel.backdrop.style.opacity = String(Math.max(0, Math.min(1, offset / target)));
      }, () => undefined);
    }
    return;
  }
  const dialog = h("nav", {
    id: "library-drawer",
    "aria-label": "Library",
    role: "dialog",
    class: "drawer",
  });
  const rail = document.getElementById("rail");
  if (rail !== null) dialog.append(...Array.from(rail.children).map((c) => c.cloneNode(true)));
  wireRailLinks(dialog);
  const backdrop = h("div", { class: "drawer-backdrop", "aria-hidden": "true" });
  backdrop.addEventListener("pointerdown", () => closeDrawer());
  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDrawer();
    }
  });
  const first = dialog.querySelector("button, a") as HTMLElement | null;
  document.body.append(backdrop, dialog);
  document.body.classList.add("has-open-drawer");
  document.getElementById("frame")?.classList.add("inactive");
  const width = dialog.offsetWidth;
  const startOffset = reducedMotion() ? width : 0;
  if (reducedMotion()) {
    dialog.style.transform = "translateX(0)";
    backdrop.style.opacity = "1";
  } else {
    dialog.style.transform = `translateX(${-width}px)`;
    backdrop.style.opacity = "0";
    const panel: Panel = { dialog, backdrop, spring: null, open: true, closing: false };
    drawerPanel = panel;
    panel.spring = runSpring({ offset: 0, velocity: 0 }, width, (offset) => {
      dialog.style.transform = `translateX(${offset - width}px)`;
      backdrop.style.opacity = String(Math.max(0, Math.min(1, offset / width)));
    }, () => undefined);
  }
  if (first !== null) first.focus();
  if (drawerPanel === null) drawerPanel = { dialog, backdrop, spring: null, open: true, closing: false };
}

function closeDrawer(): void {
  const panel = drawerPanel;
  if (panel === null) return;
  panel.closing = true;
  panel.open = false;
  const width = panel.dialog.offsetWidth;
  const st = panel.spring !== null ? panel.spring.cancel() : { offset: width, velocity: 0 };
  // unavailable from the moment of the press
  panel.dialog.inert = true;
  panel.dialog.setAttribute("aria-hidden", "true");
  if (reducedMotion()) {
    finishDrawerClose(panel, true);
    return;
  }
  panel.spring = runSpring(st, 0, (offset) => {
    panel.dialog.style.transform = `translateX(${offset - width}px)`;
    panel.backdrop.style.opacity = String(Math.max(0, Math.min(1, offset / width)));
  }, () => finishDrawerClose(panel, false));
}

function finishDrawerClose(panel: Panel, instant: boolean): void {
  void instant;
  panel.dialog.style.visibility = "hidden";
  panel.backdrop.style.visibility = "hidden";
  panel.dialog.remove();
  panel.backdrop.remove();
  document.body.classList.remove("has-open-drawer");
  document.getElementById("frame")?.classList.remove("inactive");
  drawerPanel = null;
  const opener = document.querySelector(".open-library") as HTMLElement | null;
  if (opener !== null) opener.focus();
}

function wireRailLinks(root: HTMLElement): void {
  root.querySelectorAll("a.rail-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const href = (a as HTMLAnchorElement).getAttribute("href") ?? "/today";
      if (/\/o\//.test(href) && root.closest("#library-drawer") !== null) window.__quireDailyReveal = isDailyRailLink(a);
      closeDrawer();
      void navigate(href);
    });
  });
  root.querySelectorAll("button.rail-new-type").forEach((b) => {
    b.addEventListener("click", () => {
      closeDrawer();
      setTimeout(() => openNewTypeDialog(), 200);
    });
  });
  const today = root.querySelector("button.rail-today");
  if (today !== null) {
    today.addEventListener("click", () => {
      window.__quireDailyReveal = true;
      closeDrawer();
      void navigate("/today");
    });
  }
}

function isDailyRailLink(a: Element): boolean {
  const text = a.textContent ?? "";
  return /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(text);
}

function openSheet(): void {
  if (sheetPanel !== null) return;
  const margin = document.getElementById("margin");
  if (margin === null) return;
  const dialog = h("div", { id: "margin-sheet", role: "dialog", "aria-label": "Margin", class: "sheet" });
  dialog.append(...Array.from(margin.children).map((c) => c.cloneNode(true)));
  const backdrop = h("div", { class: "sheet-backdrop", "aria-hidden": "true" });
  backdrop.addEventListener("pointerdown", () => closeSheet());
  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSheet();
    }
  });
  document.body.append(backdrop, dialog);
  document.getElementById("frame")?.classList.add("inactive");
  const height = dialog.offsetHeight;
  if (reducedMotion()) {
    dialog.style.transform = "translateY(0)";
    backdrop.style.opacity = "1";
    sheetPanel = { dialog, backdrop, spring: null, open: true, closing: false };
  } else {
    dialog.style.transform = `translateY(${height}px)`;
    backdrop.style.opacity = "0";
    const panel: Panel = { dialog, backdrop, spring: null, open: true, closing: false };
    sheetPanel = panel;
    panel.spring = runSpring({ offset: 0, velocity: 0 }, height, (offset) => {
      dialog.style.transform = `translateY(${height - offset}px)`;
      backdrop.style.opacity = String(Math.max(0, Math.min(1, offset / height)));
    }, () => undefined);
  }
  const first = dialog.querySelector("button, a, input, select") as HTMLElement | null;
  if (first !== null) first.focus();
  // the sheet can be dragged down to close
  let dragging = false;
  let startPointer = 0;
  let startOffset = 0;
  let lastPointer = 0;
  let lastTime = 0;
  let velocity = 0;
  dialog.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea") !== null) return;
    dragging = true;
    startPointer = e.clientY;
    lastPointer = e.clientY;
    lastTime = performance.now();
    startOffset = sheetPanel !== null && sheetPanel.spring !== null ? sheetPanel.spring.cancel().offset : height;
    velocity = 0;
  });
  dialog.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now();
    velocity = (e.clientY - lastPointer) / Math.max(1, now - lastTime) * 1000;
    lastPointer = e.clientY;
    lastTime = now;
    const offset = Math.max(0, startOffset - (e.clientY - startPointer));
    dialog.style.transform = `translateY(${height - offset}px)`;
  });
  const release = (): void => {
    if (!dragging) return;
    dragging = false;
    const dragged = startOffset - (height - (height - (lastPointer - startPointer)) * 0 - 0);
    void dragged;
    const current = sheetPanel !== null && sheetPanel.spring !== null ? sheetPanel.spring.cancel().offset : startOffset;
    const draggedDown = current < height / 3 || velocity > 300;
    if (draggedDown) {
      closeSheet();
    } else {
      const panel = sheetPanel;
      if (panel !== null) {
        panel.spring = runSpring({ offset: current, velocity: -velocity }, height, (offset) => {
          dialog.style.transform = `translateY(${height - offset}px)`;
        }, () => undefined);
      }
    }
  };
  dialog.addEventListener("pointerup", release);
  dialog.addEventListener("pointercancel", release);
}

function closeSheet(): void {
  const panel = sheetPanel;
  if (panel === null) return;
  panel.closing = true;
  panel.open = false;
  const height = panel.dialog.offsetHeight;
  const st = panel.spring !== null ? panel.spring.cancel() : { offset: height, velocity: 0 };
  panel.dialog.inert = true;
  panel.dialog.setAttribute("aria-hidden", "true");
  if (reducedMotion()) {
    finishSheetClose(panel);
    return;
  }
  panel.spring = runSpring(st, 0, (offset) => {
    panel.dialog.style.transform = `translateY(${height - offset}px)`;
    panel.backdrop.style.opacity = String(Math.max(0, Math.min(1, offset / height)));
  }, () => finishSheetClose(panel));
}

function finishSheetClose(panel: Panel): void {
  panel.dialog.style.visibility = "hidden";
  panel.backdrop.style.visibility = "hidden";
  panel.dialog.remove();
  panel.backdrop.remove();
  document.getElementById("frame")?.classList.remove("inactive");
  sheetPanel = null;
  const opener = document.querySelector(".open-margin") as HTMLElement | null;
  if (opener !== null) opener.focus();
}

// ---------------------------------------------------------------------------
// New type dialog

export function openNewTypeDialog(): void {
  const nameInput = h("input", { type: "text", id: "new-type-name" });
  const nameField = h("label", { for: "new-type-name" }, "Type name");
  const fieldsHost = h("div", { class: "field-rows" });
  const addField = h("button", { type: "button", onclick: () => appendFieldRow(fieldsHost) }, "Add field");
  const create = h("button", { type: "button" }, "Create type");
  const error = h("div", { id: "new-type-error", class: "field-error" });
  const dialog = h(
    "div",
    { role: "dialog", "aria-label": "New type", class: "dialog" },
    h("h2", { text: "New type" }),
    nameField,
    nameInput,
    h("div", { class: "dialog-fields" }, fieldsHost, addField),
    error,
    create
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const opener = document.activeElement as HTMLElement | null;
  const handle = openDialog(overlay, opener);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  appendFieldRow(fieldsHost);
  nameInput.focus();
  create.addEventListener("click", async () => {
    const fields: Array<Record<string, unknown>> = [];
    fieldsHost.querySelectorAll(".field-row").forEach((row) => {
      const name = (row.querySelector(".field-name") as HTMLInputElement).value;
      const kind = (row.querySelector(".field-kind") as HTMLSelectElement).value.toLowerCase();
      const required = (row.querySelector(".field-required") as HTMLInputElement).checked;
      const optionsText = (row.querySelector(".field-options") as HTMLTextAreaElement).value;
      const target = (row.querySelector(".field-target") as HTMLSelectElement).value;
      const entry: Record<string, unknown> = { name, kind, required, options: null, target_type_id: null };
      if (kind === "select") entry.options = optionsText.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
      if (kind === "relation") entry.target_type_id = target || null;
      fields.push(entry);
    });
    try {
      await api("POST", "/api/types", { name: nameInput.value, fields });
      overlay.remove();
      handle.close();
      if (window.__quireRefresh !== undefined) await window.__quireRefresh();
      const opener = document.activeElement as HTMLElement | null;
      void opener;
    } catch (e) {
      error.textContent = apiFail(e, "name");
    }
  });
}

function appendFieldRow(host: HTMLElement): void {
  const kinds = h("select", { class: "field-kind" },
    h("option", { value: "Text" }, "Text"),
    h("option", { value: "Number" }, "Number"),
    h("option", { value: "Date" }, "Date"),
    h("option", { value: "URL" }, "URL"),
    h("option", { value: "Select" }, "Select"),
    h("option", { value: "Relation" }, "Relation")
  );
  const targets = h("select", { class: "field-target" });
  for (const t of state.app?.types ?? []) {
    targets.append(h("option", { value: t.id }, t.name));
  }
  const options = h("textarea", { class: "field-options", rows: 4, placeholder: "one option per line" });
  const targetWrap = h("span", { class: "field-target-wrap" }, targets);
  const optionsWrap = h("span", { class: "field-options-wrap", hidden: true }, options);
  const row = h("div", { class: "field-row" },
    h("input", { type: "text", class: "field-name", placeholder: "Field name" }),
    kinds,
    h("label", {}, h("input", { type: "checkbox", class: "field-required" }), "Required"),
    optionsWrap,
    targetWrap
  );
  kinds.addEventListener("change", () => {
    optionsWrap.hidden = kinds.value !== "Select";
    targetWrap.hidden = kinds.value !== "Relation";
  });
  host.append(row);
}


export function updateTopbarTitle(title: string): void {
  const el = document.getElementById("topbar-title");
  if (el !== null) el.textContent = title;
}

export { api, h, clearChildren, announce, reducedMotion, navigate, MOTION, QUIRE_CURVE, dateTimeShort, isDrawerLayout };

// augment window for cross-module handles
declare global {
  interface Window {
    __quireDailyReveal?: boolean;
    __quireSync?: LiveSyncClient;
    __quireRefresh?: () => Promise<void>;
  }
}
