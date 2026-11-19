// Tailboard in the browser: sign-in, the workspace, routing, search, the live feed and every action's copy.

import { ApiError, get, keyed, Offline, request, whenSessionEnds } from "./api.js";
import { createBoard, openMenu, renderRail } from "./board.js";
import { openDirectiveDialog, openImportDialog, openWithdrawDialog } from "./dialogs.js";
import { createDrawer, openTail } from "./drawer.js";
import { icon } from "./glyphs.js";
import { renderAudit, renderPacks, renderPeople, sendPack } from "./screens.js";
import { capture, rethread, rollCounts, splitHeader } from "./splice.js";
import {
  announce, busy, clearError, dname, fail, fieldError, h, liveFeed, MODEL_LABELS, narrow, pending, popLayer,
  pushLayer, reducedMotion, ROLE_LABELS,
} from "./ui.js";

const BRAND_MARK = '<svg viewBox="0 0 18 14" fill="none" stroke-width="1.5"><path d="M1 4h13" stroke="#e4e9f0"/><path d="M1 10h9" stroke="#9aa4b4"/><path d="M15.5 1.5v5" stroke="#b7aaf7" stroke-width="2.5"/></svg>';
const OFFLINE = "Still offline. Nothing was confirmed. Press again to retry with the same request.";
const COMMON = { forbidden: () => "Your role cannot do this." };
const SCREENS = ["board", "packs", "people", "audit"];

const state = {
  user: null, screen: "board", board: null, banner: null, filter: null, prior: null, selected: null, phoneDid: null,
  highlight: null, auditDirective: "", packDirective: null,
};
const root = document.getElementById("app");
const app = { state };
let feed = null;
let refreshTimer = null;
let splicing = Promise.resolve();
let spliceActive = false;
let refreshWanted = false;
const seenSplices = new Set();

// Running an action: pending → success, or the published error / outage copy, with field messages under fields.
app.retrying = () => announce("Connection lost. Retrying with the same request.");

app.run = async function run({ button, pending: text, call, success, errors = {}, fieldFor }) {
  if (button?.getAttribute("aria-disabled") === "true") return null;
  pending(text);
  try {
    const result = await busy(button, call);
    announce(success(result));
    return result;
  } catch (error) {
    announce("");
    if (error instanceof Offline) fail(OFFLINE);
    else if (!(error instanceof ApiError)) fail("Connection lost. Nothing was confirmed.");
    else if (error.code === "unauthenticated") return null;
    else if (error.code === "validation" && fieldFor) {
      const marked = [];
      for (const [key, message] of Object.entries(error.extra.fields || {})) {
        const input = fieldFor(key);
        if (input) {
          fieldError(input, message);
          marked.push([input, message]);
        }
      }
      marked.sort(([a], [b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      if (marked.length) {
        marked[0][0].focus();
        fail(marked[0][1]);
      } else fail(Object.values(error.extra.fields || {})[0] || error.message);
    } else fail((errors[error.code] || COMMON[error.code] || (() => error.message))(error));
    return null;
  }
};

app.cellOf = (threadId) => state.board?.cells.find((c) => c.thread_id === threadId);

app.threadAction = async function threadAction(kind, t, opts) {
  const card = t.work_card.id;
  const path = `/api/threads/${t.id}`;
  const reasonField = (k) => (k === "reason" ? opts.reason : null);
  // Every answer, a refusal included, refetches the drawer in place (brief: Interactions, DP-61 and DP-62).
  const after = (r) => {
    app.drawer.refresh();
    if (r) app.refresh();
    return r;
  };
  const latest = () => app.drawer.thread || t;
  const revisionMoved = (e) => `This thread moved to ${e.extra.current}. Review the new limits before signing.`;
  const refusals = (own) => ({
    not_holder: () => "You no longer hold this work card.",
    directive_withdrawn: () => `${t.directive} is withdrawn.`,
    effectivity_unconfirmed: () => "Waiting for the planner to confirm effectivity.",
    ...own,
  });
  if (kind === "claim") {
    return after(await app.run({
      button: opts.button, pending: `Claiming ${card}…`, success: () => `Work card ${card} is yours.`,
      call: () => keyed("POST", `${path}/claim`, { json: {} }, { onRetry: app.retrying }),
      errors: refusals({ card_held: (e) => `Already held by ${e.extra.holder.display_name}.` }),
    }));
  }
  if (kind === "release") {
    return after(await app.run({
      button: opts.button, pending: `Releasing ${card}…`, success: () => `Work card ${card} released.`,
      call: () => request("POST", `${path}/release`, { json: {} }),
      errors: refusals({ invalid_transition: () => "This card can no longer be released." }),
    }));
  }
  if (kind === "evidence") {
    const result = await app.run({
      pending: "Uploading evidence…", success: () => "Evidence attached.",
      call: () => request("POST", `${path}/evidence`, { raw: opts.file, contentType: opts.file.type || "application/octet-stream" }),
      errors: refusals({
        storage_unavailable: () => "Evidence storage is unavailable. Nothing was attached.",
        payload_too_large: () => "That file is larger than 5,000,000 bytes.",
        unsupported_media_type: () => "Attach a JPEG, PNG or PDF file.",
      }),
    });
    opts.input.value = "";
    return after(result);
  }
  if (kind === "inspection") {
    const current = latest();
    return after(await app.run({
      button: opts.button, pending: "Signing inspection…",
      fieldFor: (k) => ({ method_ref: opts.methodRef, findings: opts.findings, evidence_ids: opts.file })[k],
      call: () => keyed("POST", `${path}/inspection`, { json: { revision: current.revision, method_ref: opts.methodRef.value,
        findings: opts.findings.value, evidence_ids: current.evidence.map((e) => e.id) } }, { onRetry: app.retrying }),
      success: (r) => `Inspection signed under ${r.body.signature.revision}, ${r.body.signature.timeliness === "overdue" ? "overdue" : "on time"}.`,
      errors: refusals({ revision_changed: revisionMoved }),
    }));
  }
  if (kind === "countersign") {
    return after(await app.run({
      button: opts.button, pending: "Countersigning…",
      call: () => keyed("POST", `${path}/countersign`, { json: { revision: latest().revision } }, { onRetry: app.retrying }),
      success: (r) => `Countersigned under ${r.body.signature.revision}. Thread closed.`,
      errors: refusals({ out_of_scope: (e) => `Your certification scope does not cover ${MODEL_LABELS[e.extra.model]}.`,
        revision_changed: revisionMoved }),
    }));
  }
  if (kind === "deferral") {
    return after(await app.run({
      button: opts.button, pending: "Deferring…", fieldFor: reasonField,
      call: () => keyed("POST", `${path}/deferral`, { json: { reason: opts.reason.value } }, { onRetry: app.retrying }),
      success: (r) => `Deferred. New due ${r.body.thread.limits.deadline_date}.`,
      errors: refusals({ past_due: () => "Too late to defer: the due instant has passed.",
        already_deferred: (e) => `Already deferred under ${e.extra.current}.` }),
    }));
  }
  if (kind === "confirmed" || kind === "not_applicable") {
    return after(await app.run({
      button: opts.button, pending: "Saving…", fieldFor: reasonField,
      call: () => request("POST", `${path}/effectivity`, { json: { decision: kind, reason: opts.reason.value } }),
      success: () => (kind === "confirmed" ? "Effectivity confirmed." : "Marked not applicable."),
      errors: refusals({ invalid_transition: () => "This thread no longer needs confirmation." }),
    }));
  }
  return after(await app.run({
    button: opts.button, pending: "Reopening…", fieldFor: reasonField,
    call: () => request("POST", `${path}/reopen`, { json: { reason: opts.reason.value } }),
    success: () => "Thread reopened. Prior signatures kept as void.",
    errors: refusals({ invalid_transition: () => "Only a closed thread can be reopened." }),
  }));
};

// Board data -------------------------------------------------------------------------------------------------------

app.repaint = () => {
  if (app.board) app.board.render();
};

async function loadBoard() {
  state.board = await get("/api/board");
  if (state.prior && !state.board.directives.some((d) => d.id === state.prior.did)) state.prior = null;
  renderRail(app.rail, state.board.directives, pickDirective);
  app.repaint();
}

app.refresh = function refresh(threadIds) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (spliceActive) {
      refreshWanted = true;
      return;
    }
    try {
      await loadBoard();
      if (state.screen !== "board") await renderScreen();
      if (threadIds) app.drawer.refresh(threadIds);
    } catch (error) {
      if (!(error instanceof ApiError)) liveFeed("Live updates paused. Reconnecting…");
    }
  }, 120);
};

app.spliceArrived = function spliceArrived(did, splice, own = false) {
  const key = `${did}:${splice.to}`;
  const entry = state.board?.directives.find((d) => d.id === did);
  state.banner = { did, splice, name: entry ? dname(entry) : "" };
  if (seenSplices.has(key)) return;
  seenSplices.add(key);
  if (!entry || splice.from === null || reducedMotion() || state.screen !== "board" || !app.board.header(did)) {
    if (state.prior?.did === did) state.prior = null;
    app.refresh();
    if (!entry) setTimeout(() => {
      const fresh = state.board?.directives.find((d) => d.id === did);
      if (fresh) state.banner.name = dname(fresh);
      app.repaint();
      if (own) app.board.scrollToColumn(did);
    }, 400);
    return;
  }
  splicing = splicing.then(() => playSplice(did, splice)).catch(() => null);
};

async function playSplice(did, splice) {
  const grid = app.board.grid;
  spliceActive = true;
  try {
    const all = await get("/api/board");
    if (state.prior?.did === did) {
      state.prior = null;
      app.repaint();
    }
    const old = state.board;
    const oldEntry = old.directives.find((d) => d.id === did);
    const fresh = all.directives.find((d) => d.id === did);
    const before = capture(app.board, old.cells.filter((c) => c.directive_id === did), did);
    grid.setAttribute("aria-busy", "true");
    try {
      await splitHeader(app.board.header(did), splice.to);
      grid.querySelectorAll(".tag-ghost, .split-line").forEach((n) => n.remove());
      const held = { fleet: old.totals, columns: { [did]: oldEntry.counts } };
      state.board = all;
      renderRail(app.rail, all.directives, pickDirective);
      app.board.render({ held });
      await rethread(app.board, did, before, splice);
      await rollCounts(app.board, did, oldEntry.counts, old.totals, fresh.counts, all.totals);
    } finally {
      grid.setAttribute("aria-busy", "false");
    }
    app.board.render();
  } finally {
    spliceActive = false;
    if (refreshWanted) {
      refreshWanted = false;
      app.refresh();
    }
  }
}

app.filterBy = (did, category, ids, tag) => {
  state.filter = { did, category, ids, tag };
  app.repaint();
};
app.clearFilter = () => {
  state.filter = null;
  app.repaint();
};
app.dismissBanner = () => {
  state.banner = null;
  state.filter = null;
  app.repaint();
};
app.viewPrior = async (did, tag) => {
  const snapshot = await get(`/api/board?directive_id=${encodeURIComponent(did)}&as_of=${encodeURIComponent(tag)}`)
    .catch(() => null);
  if (!snapshot) return;
  state.prior = { did, tag, entry: snapshot.directives[0], cells: snapshot.cells };
  app.repaint();
  app.board.header(did)?.querySelector(`[data-view="${tag}"]`)?.focus({ preventScroll: true });
};
app.backToCurrent = () => {
  const did = state.prior?.did;
  state.prior = null;
  app.repaint();
  app.board.header(did)?.querySelector(".colhead__act")?.focus({ preventScroll: true });
};
app.openThread = (threadId, opener) => app.drawer.open(threadId, opener).catch(() => null);
app.openTail = (registration) => openTail(app, registration);
app.openDirectiveMenu = (did, button) => {
  const d = state.board.directives.find((x) => x.id === did);
  const role = state.user.role;
  const items = [];
  if (role === "compliance_planner" && d.status === "active") {
    items.push({ label: "Ingest revision", run: () => openDirectiveDialog(app, d) });
  }
  if (role === "records_clerk") items.push({ label: "Send compliance pack", run: () => sendPack(app, did, null) });
  items.push({ label: "Export CSV", run: () => {
    const a = h("a", { href: `/api/directives/${did}/export.csv`, download: "" });
    document.body.append(a);
    a.click();
    a.remove();
  } });
  if (role === "compliance_planner" && d.status === "active") {
    items.push({ label: "Withdraw directive", run: () => openWithdrawDialog(app, d) });
  }
  openMenu(button, items);
};

let railLayer = null;
app.toggleRail = () => {
  if (railLayer) return closeRail();
  app.rail.classList.add("is-open");
  app.board.railToggle.setAttribute("aria-expanded", "true");
  railLayer = pushLayer({ el: app.rail, opener: app.board.railToggle, trap: true, close: closeRail });
  app.rail.querySelector("a")?.focus();
};
function closeRail() {
  if (!railLayer) return;
  app.rail.classList.remove("is-open");
  app.board.railToggle.setAttribute("aria-expanded", "false");
  popLayer(railLayer);
  railLayer = null;
}

function pickDirective(did) {
  if (railLayer) closeRail();
  if (state.screen !== "board") navigate("board");
  app.board.scrollToColumn(did);
}

// Screens ----------------------------------------------------------------------------------------------------------

async function renderScreen() {
  const host = app.screenHost;
  if (state.screen === "packs") await renderPacks(app, host);
  else if (state.screen === "people") await renderPeople(app, host);
  else if (state.screen === "audit") await renderAudit(app, host);
}

function navigate(screen, push = true) {
  state.screen = screen;
  if (push) history.pushState({ screen }, "", `/${screen}`);
  app.workspace.dataset.screen = screen;
  for (const a of app.sections.querySelectorAll("a")) {
    if (a.dataset.screen === screen) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  app.closeMenu?.();
  announce("");
  clearError();
  if (screen === "board") {
    app.board.el.hidden = false;
    app.screenHost.hidden = true;
    app.repaint();
  } else {
    app.board.el.hidden = true;
    app.screenHost.hidden = false;
    app.screenHost.replaceChildren(h("p", { class: "muted screen__loading" }, "Loading…"));
    renderScreen().catch(() => null);
  }
}

window.addEventListener("popstate", () => {
  if (state.user) navigate(screenFromPath(), false);
});

function screenFromPath() {
  const name = location.pathname.replace(/^\//, "").split("/")[0];
  return SCREENS.includes(name) ? name : "board";
}

// Search -----------------------------------------------------------------------------------------------------------

function createSearch() {
  const input = h("input", { type: "search", class: "input search__input", "aria-label": "Search fleet",
    placeholder: "Tail, directive, person or licence", autocomplete: "off" });
  const list = h("ul", { class: "search__results", "aria-label": "Search results", hidden: true });
  const wrap = h("div", { class: "search", role: "search" }, h("span", { class: "search__icon", html: icon("search") }), input, list);
  let timer = null;
  let layer = null;
  const hide = () => {
    list.hidden = true;
    if (layer) {
      popLayer(layer, { restore: false });
      layer = null;
    }
  };
  async function run() {
    const q = input.value.trim();
    if (q.length < 2) return hide();
    try {
      const { results } = await get(`/api/search?q=${encodeURIComponent(q.slice(0, 100))}`);
      list.replaceChildren(...(results.length ? results.map((r) => h("li", {}, h("a", { href: "#", class: `result result--${r.type}`,
        onclick: (e) => { e.preventDefault(); choose(r); } }, r.label))) : [h("li", { class: "muted result--none" }, "No matches")]));
      list.hidden = false;
      if (!layer) layer = pushLayer({ el: list, opener: input, close: () => { hide(); input.focus(); } });
    } catch {
      hide();
    }
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !list.hidden) {
      e.preventDefault();
      list.querySelector("a")?.focus();
    }
  });
  list.addEventListener("keydown", (e) => {
    const links = [...list.querySelectorAll("a")];
    const i = links.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      links[Math.max(0, Math.min(links.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => { if (!wrap.contains(e.target)) hide(); });
  function choose(result) {
    hide();
    if (result.type === "directive") {
      if (state.screen !== "board") navigate("board");
      app.board.scrollToColumn(result.id);
    } else if (result.type === "thread") {
      if (state.screen !== "board") navigate("board");
      const cell = state.board?.cells.find((c) => c.thread_id === result.id);
      if (cell) app.board.scrollToColumn(cell.directive_id);
      app.drawer.open(result.id, cell ? app.board.cell(`${cell.registration}|${cell.directive_id}`) : input).catch(() => null);
    } else {
      state.highlight = result.id;
      navigate("people");
    }
  }
  return wrap;
}

// Live feed --------------------------------------------------------------------------------------------------------

function connectFeed() {
  feed?.close();
  let dropped = false;
  feed = new EventSource("/api/events");
  feed.addEventListener("open", () => {
    if (dropped) {
      liveFeed("Live updates resumed.");
      app.refresh();
    }
    dropped = false;
  });
  feed.addEventListener("error", () => {
    if (!dropped) liveFeed("Live updates paused. Reconnecting…");
    dropped = true;
  });
  feed.addEventListener("threads", (e) => app.refresh(JSON.parse(e.data).thread_ids));
  feed.addEventListener("revision", (e) => {
    const data = JSON.parse(e.data);
    app.spliceArrived(data.directive_id, data.splice);
    app.drawer.refresh();
  });
}

// Sign-in and the workspace ------------------------------------------------------------------------------------------

function showSignIn(message) {
  feed?.close();
  feed = null;
  state.user = null;
  state.board = null;
  document.getElementById("overlays").replaceChildren();
  document.body.classList.remove("has-drawer");
  root.dataset.screen = "sign-in";
  const username = h("input", { type: "text", class: "input", id: "username", autocomplete: "username", required: true });
  const passcode = h("input", { type: "password", class: "input", id: "passcode", autocomplete: "current-password",
    required: true });
  const submit = h("button", { type: "submit", class: "btn btn--primary btn--wide" }, "Sign in");
  const form = h("form", { class: "signin__form", "aria-label": "Sign in", novalidate: true },
    message ? h("p", { class: "signin__notice" }, message) : null,
    h("div", { class: "field" }, h("label", { for: "username", class: "field__label" }, "Username"), username),
    h("div", { class: "field" }, h("label", { for: "passcode", class: "field__label" }, "Passcode"), passcode), submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await app.run({
      button: submit, pending: "Signing in…", success: () => "",
      call: () => request("POST", "/api/session", { json: { username: username.value.trim(), passcode: passcode.value },
        quietAuth: true }),
      errors: { bad_credentials: () => "Username or passcode is wrong." },
    });
    if (result) {
      state.user = result.body.user;
      clearError();
      showWorkspace();
    } else passcode.select();
  });
  root.replaceChildren(h("main", { class: "signin" },
    h("div", { class: "signin__panel" },
      h("p", { class: "signin__maker" }, "Saltmarsh Aero Software"),
      h("h1", { class: "signin__title" }, "Tailboard"),
      h("p", { class: "signin__lede" }, "Continuing-airworthiness compliance board · Fenwick Regional Airways"), form)));
  username.focus();
}

function showWorkspace() {
  const user = state.user;
  root.dataset.screen = "workspace";
  const sectionsList = h("ul", { class: "sections__list" }, SCREENS.map((s) => h("li", {},
    h("a", { href: `/${s}`, "data-screen": s, onclick: (e) => { e.preventDefault(); navigate(s); } }, s[0].toUpperCase() + s.slice(1)))));
  const menuButton = h("button", { type: "button", class: "btn btn--quiet menu-toggle", "aria-expanded": "false" });
  menuButton.innerHTML = `${icon("menu")}<span>Menu</span>`;
  const sections = h("nav", { class: "sections", "aria-label": "Sections" }, menuButton, sectionsList);
  let menuLayer = null;
  app.closeMenu = () => {
    if (!menuLayer) return;
    sections.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    popLayer(menuLayer, { restore: false });
    menuLayer = null;
  };
  menuButton.addEventListener("click", () => {
    if (menuLayer) return app.closeMenu();
    sections.classList.add("is-open");
    menuButton.setAttribute("aria-expanded", "true");
    menuLayer = pushLayer({ el: sectionsList, opener: menuButton, close: () => { app.closeMenu(); menuButton.focus(); } });
  });
  const roleButtons = [];
  if (user.role === "compliance_planner") {
    roleButtons.push(h("button", { type: "button", class: "btn btn--primary", onclick: () => openDirectiveDialog(app) }, "New directive"));
  }
  if (user.role === "records_clerk") {
    roleButtons.push(h("button", { type: "button", class: "btn btn--primary", onclick: () => openImportDialog(app) }, "Import history"));
  }
  const signOut = h("button", { type: "button", class: "btn btn--quiet", onclick: async () => {
    try {
      await request("DELETE", "/api/session", { quietAuth: true });
    } finally {
      announce("");
      showSignIn();
    }
  } }, "Sign out");
  const header = h("header", { class: "topbar", role: "banner" },
    h("span", { class: "brand" }, h("span", { class: "brand__mark", "aria-hidden": "true", html: BRAND_MARK }), "Tailboard"),
    createSearch(), sections, h("div", { class: "topbar__acts" }, roleButtons),
    h("div", { class: "who" }, h("span", { class: "who__name" }, user.display_name), h("span", { class: "who__role" }, ROLE_LABELS[user.role])),
    signOut);
  app.rail = h("nav", { class: "rail", id: "rail", "aria-label": "Directives" });
  app.board = createBoard(app);
  app.drawer = createDrawer(app);
  app.screenHost = h("div", { class: "screen", tabindex: "0", hidden: true });
  app.sections = sections;
  app.workspace = h("div", { class: "workspace", dataset: { screen: "board" } }, app.rail,
    h("main", { class: "main", id: "main" }, app.board.el, app.screenHost), app.drawer.el);
  root.replaceChildren(h("div", { class: "shell" }, header, app.workspace));
  app.repaint();
  navigate(screenFromPath(), false);
  history.replaceState({ screen: state.screen }, "", `/${state.screen}`);
  loadBoard().then(() => (state.screen !== "board" ? renderScreen() : null)).catch(() => null);
  connectFeed();
}

whenSessionEnds(() => showSignIn("Your session has ended. Sign in again."));
setInterval(() => { if (state.user) app.refresh(); }, 60_000);
window.addEventListener("resize", () => {
  if (!narrow() && railLayer) closeRail();
  if (state.user) app.repaint();
});

request("GET", "/api/session", { quietAuth: true })
  .then((r) => {
    state.user = r.body.user;
    showWorkspace();
  })
  .catch(() => showSignIn());
