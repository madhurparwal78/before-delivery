/* Tailboard board application. */
"use strict";

/* ---------------- state ---------------- */
const api = new Api();
const app = {
  user: null,
  view: "board",          // board | packs | people | audit
  board: null,            // GET /api/board payload
  tails: [],
  directives: [],
  people: [],
  selectedThreadId: null,
  thread: null,
  asOf: null,             // prior tag when viewing one
  asOfDirective: null,
  filter: null,           // {category, tag} splice summary filter
  railOpen: false,
  dialogs: [],            // stack of {element, restoreFocus}
  screenTimer: null,
  packsTimer: null,
  feed: null,
  lastSpliceKey: null,
  pendingBanner: null,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

/* ---------------- tiny dom helpers ---------------- */
function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svgNode(markup) {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  return holder.firstElementChild;
}

function focusable(node) {
  return node.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
}

/* ---------------- live regions ---------------- */
let actionStatus = null;
let actionError = null;
let liveUpdates = null;
let revisionChanges = null;

function announceStatus(message) {
  if (!actionStatus) return;
  actionStatus.textContent = message;
  window.clearTimeout(actionStatus._timer);
  actionStatus._timer = window.setTimeout(() => { actionStatus.textContent = ""; }, 6000);
}

function announceError(message) {
  if (!actionError) return;
  actionError.textContent = message;
  window.clearTimeout(actionError._timer);
  actionError._timer = window.setTimeout(() => { actionError.textContent = ""; }, 8000);
}

function announceFeed(state) {
  if (!liveUpdates) return;
  liveUpdates.textContent = state === "paused" ? COPY.livePaused : COPY.liveResumed;
}

function showRevisionBanner(text, links) {
  if (!revisionChanges) return;
  revisionChanges.textContent = "";
  revisionChanges.append(text + " ");
  if (links) {
    for (const [category, count] of Object.entries(links)) {
      const link = h("a", { href: "#", text: `${count} ${category}` });
      link.addEventListener("click", event => {
        event.preventDefault();
        app.filter = { category, tag: links.tag };
        renderBoard();
      });
      revisionChanges.append(link, " ");
    }
  }
  const dismiss = h("button", { text: "Dismiss", onclick: () => { revisionChanges.textContent = ""; } });
  revisionChanges.append(dismiss);
  window.clearTimeout(revisionChanges._timer);
  revisionChanges._timer = window.setTimeout(() => { revisionChanges.textContent = ""; }, 15000);
}

/* ---------------- dialogs (modal, focus trap) ---------------- */
function openDialog(dialog, { modal = true } = {}) {
  const restore = document.activeElement;
  dialog._modal = modal;
  app.dialogs.push({ element: dialog, restore });
  document.getElementById("overlay-root").append(dialog);
  const first = dialog.querySelector("h2");
  if (first) first.setAttribute("tabindex", "-1");
  (first || dialog).focus();
  return dialog;
}

function closeTopDialog() {
  const entry = app.dialogs.pop();
  if (!entry) return false;
  entry.element.remove();
  if (entry.restore && entry.restore.isConnected) entry.restore.focus();
  return true;
}

function trapFocus(event) {
  const top = app.dialogs[app.dialogs.length - 1];
  const modal = top && top._modal ? top.element : (drawerIsModal() ? document.getElementById("drawer") : null);
  if (!modal) return;
  if (!modal.contains(document.activeElement)) return;
  const focusables = Array.from(modal.querySelectorAll(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter(node => !node.disabled && node.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function drawerIsModal() {
  return window.innerWidth < 768 && drawerOpen();
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    if (closeMenu()) return;
    if (app.dialogs.length) { closeTopDialog(); return; }
    if (drawerOpen()) closeDrawer();
  } else if (event.key === "Tab") {
    trapFocus(event);
  }
});

/* ---------------- menus ---------------- */
let openMenu = null;

function closeMenu() {
  if (!openMenu) return false;
  openMenu.element.remove();
  const button = openMenu.button;
  openMenu = null;
  if (button && button.isConnected) button.focus();
  return true;
}

function showMenu(button, items) {
  if (openMenu) { closeMenu(); return; }
  const element = h("div", { class: "menu", role: "menu" });
  const buttons = items.map(item => h("button", {
    role: "menuitem", text: item.label,
    onclick: () => { closeMenu(); item.action(); },
  }));
  element.append(...buttons);
  const rect = button.getBoundingClientRect();
  element.style.top = `${rect.bottom + 2}px`;
  element.style.left = `${rect.left}px`;
  document.body.append(element);
  openMenu = { element, button, buttons };
  buttons[0].focus();
}

document.addEventListener("keydown", event => {
  if (!openMenu) return;
  const index = openMenu.buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    openMenu.buttons[Math.min(index + 1, openMenu.buttons.length - 1)].focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    openMenu.buttons[Math.max(index - 1, 0)].focus();
  } else if (event.key === "Enter" && index >= 0) {
    event.preventDefault();
    openMenu.buttons[index].click();
  }
});

/* ---------------- toasts ---------------- */
function toast(message, isError) {
  const root = document.getElementById("toast-root");
  const node = h("div", { class: `toast ${isError ? "error" : ""}`, text: message });
  root.append(node);
  window.setTimeout(() => node.remove(), isError ? 8000 : 6000);
}

/* ---------------- board fetch and live feed ---------------- */
async function loadBoard() {
  const query = app.asOf && app.asOfDirective
    ? `/api/board?directive_id=${encodeURIComponent(app.asOfDirective)}&as_of=${encodeURIComponent(app.asOf)}`
    : "/api/board";
  const result = await api.get(query);
  if (result.status === 401) return showSignIn(COPY.sessionEnded);
  if (result.status !== 200) { announceError(errorCopy(result.body.error.code, result.body.error)); return; }
  const previous = app.board;
  app.board = result.body;
  renderBoard({ refetch: true });
  if (app.selectedThreadId) loadThread(app.selectedThreadId);
}

async function loadThread(threadId) {
  const result = await api.get(`/api/threads/${encodeURIComponent(threadId)}`);
  if (result.status !== 200) return;
  app.thread = result.body.thread;
  renderDrawer();
}

function startFeed() {
  stopFeed();
  const source = new EventSource("/api/events");
  let paused = false;
  source.addEventListener("open", () => {
    if (paused) { announceFeed("resumed"); paused = false; }
  });
  source.addEventListener("error", () => {
    if (!paused) { announceFeed("paused"); paused = true; }
  });
  source.addEventListener("revision", event => {
    const payload = JSON.parse(event.data);
    playRevisionSplice(payload.directive_id, payload.splice);
    loadBoard();
  });
  source.addEventListener("threads", event => {
    const payload = JSON.parse(event.data);
    if (app.selectedThreadId && payload.thread_ids.includes(app.selectedThreadId)) {
      loadThread(app.selectedThreadId);
    }
    loadBoard();
  });
  app.feed = source;
  app.screenTimer = window.setInterval(loadBoard, 60000);
}

function stopFeed() {
  if (app.feed) { app.feed.close(); app.feed = null; }
  if (app.screenTimer) { window.clearInterval(app.screenTimer); app.screenTimer = null; }
}

/* ---------------- revision splice ---------------- */
function playRevisionSplice(directiveId, splice) {
  const board = app.board;
  if (!board) return;
  const directive = board.directives.find(d => d.id === directiveId);
  if (!directive) return;
  const spliceKey = `${directiveId}:${splice.to}`;
  if (app.lastSpliceKey === spliceKey) return;
  app.lastSpliceKey = spliceKey;
  const counts = {
    retargeted: splice.retargeted.length,
    added: splice.added.length,
    removed: splice.removed.length,
    kept: splice.kept.length,
  };
  if (splice.from === null) {
    showRevisionBanner(COPY.addedBanner(directiveLabel(directive), splice.to, counts.added),
      { added: counts.added, tag: splice.to });
  } else {
    showRevisionBanner(COPY.revisionBanner(splice.to, splice.from, counts),
      { retargeted: counts.retargeted, added: counts.added,
        removed: counts.removed, kept: counts.kept, tag: splice.to });
  }
  if (app.reducedMotion) return;
  const grid = document.querySelector('[role="grid"]');
  if (grid) {
    grid.setAttribute("aria-busy", "true");
    const cells = grid.querySelectorAll(`[data-directive="${directiveId}"]`);
    cells.forEach((cell, index) => {
      if (index < 24) {
        cell.style.animationDelay = `${index * 0.03}s`;
        cell.classList.add("splice-col");
      }
    });
    window.setTimeout(() => {
      grid.setAttribute("aria-busy", "false");
      cells.forEach(cell => { cell.classList.remove("splice-col"); cell.style.animationDelay = ""; });
    }, 1400);
  }
}

/* ---------------- rendering: board ---------------- */
function renderBoard(options = {}) {
  const root = document.getElementById("root");
  if (app.view !== "board") { renderScreen(); return; }
  const shell = root.querySelector(".shell") || buildShell();
  const matrixWrap = shell.querySelector(".matrix-wrap");
  if (!app.board) return;

  // Counts
  const counts = shell.querySelector('[aria-label="Fleet counts"]');
  if (counts) {
    counts.textContent = "";
    counts.append(...countNodes(app.board.totals));
    counts.classList.remove("counts-roll");
    void counts.offsetWidth;
    counts.classList.add("counts-roll");
  }

  // Rail
  const rail = shell.querySelector('[aria-label="Directives"]');
  renderRail(rail);

  // Matrix
  const scrollLeft = matrixWrap ? matrixWrap.scrollLeft : 0;
  const scrollTop = matrixWrap ? matrixWrap.scrollTop : 0;
  renderMatrix(matrixWrap);
  if (matrixWrap) { matrixWrap.scrollLeft = scrollLeft; matrixWrap.scrollTop = scrollTop; }
}

function buildShell() {
  const root = document.getElementById("root");
  root.textContent = "";
  root.append(
    buildTopbar(),
    h("div", { class: `shell ${app.selectedThreadId ? "with-drawer" : ""}` },
      h("nav", { class: "rail", "aria-label": "Directives", id: "rail" }),
      h("main", { class: "main" },
        h("div", { class: "live-regions",
          html: `<div id="revision-changes" role="status" aria-live="polite" aria-label="Revision changes" class="banner-slot"></div>` }),
        h("div", { role: "group", "aria-label": "Fleet counts", id: "fleet-counts" }),
        h("div", { role: "region", "aria-label": "Fleet board", class: "board-region" },
          h("div", { class: "matrix-wrap", id: "matrix-wrap" })),
      ),
      h("div", { class: "drawer", id: "drawer", style: "display:none" }),
    ),
    h("div", { id: "overlay-root" }),
    h("div", { id: "toast-root" }),
    h("div", { class: "live-regions",
      html: `
        <div id="action-status" role="status" aria-live="polite" aria-label="Action status"></div>
        <div id="action-error" role="alert" aria-live="assertive" aria-label="Action error"></div>
        <div id="live-updates" role="status" aria-live="polite" aria-label="Live updates"></div>` }),
  );
  actionStatus = document.getElementById("action-status");
  actionError = document.getElementById("action-error");
  liveUpdates = document.getElementById("live-updates");
  revisionChanges = document.getElementById("revision-changes");
  bindBoardKeyboard();
  return root.querySelector(".shell");
}

function countNodes(counts) {
  const order = [["open", "Open"], ["due_soon", "Due soon"], ["overdue", "Overdue"],
    ["deferred", "Deferred"], ["complied", "Complied"]];
  return order.map(([key, label]) =>
    h("span", { class: `c-${key}` },
      h("span", { class: "label", text: label }),
      h("span", { class: "count num", text: String(counts[key]) })));
}

function buildTopbar() {
  const bar = h("header", { class: "topbar", role: "banner" });
  bar.append(h("span", { class: "brand", text: "Tailboard" }));

  const search = h("input", { type: "search", role: "searchbox", "aria-label": "Search fleet",
    placeholder: "Tail, directive, person or licence", id: "fleet-search" });
  let searchTimer = null;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    const value = search.value.trim();
    if (value.length < 2) { hideSearchResults(); return; }
    searchTimer = window.setTimeout(() => runSearch(value), 250);
  });
  bar.append(search);

  const nav = h("nav", { "aria-label": "Sections", class: "menu-links" });
  for (const [name, view] of [["Board", "board"], ["Packs", "packs"], ["People", "people"], ["Audit", "audit"]]) {
    nav.append(h("a", { href: "#", text: name, onclick: event => { event.preventDefault(); switchView(view); } }));
  }
  bar.append(nav);

  const menuButton = h("button", { class: "menu-btn", text: "Menu", "aria-haspopup": "true" });
  menuButton.addEventListener("click", () => showMenu(menuButton, [
    { label: "Board", action: () => switchView("board") },
    { label: "Packs", action: () => switchView("packs") },
    { label: "People", action: () => switchView("people") },
    { label: "Audit", action: () => switchView("audit") },
  ]));
  bar.append(menuButton);

  const railButton = h("button", { class: "role-btn", text: "Directives", "aria-haspopup": "true" });
  railButton.addEventListener("click", () => {
    app.railOpen = !app.railOpen;
    document.getElementById("rail").classList.toggle("open", app.railOpen);
  });
  bar.append(railButton);

  if (app.user.role === "compliance_planner") {
    bar.append(h("button", { text: "New directive", onclick: openNewDirectiveDialog }));
  }
  if (app.user.role === "records_clerk") {
    bar.append(h("button", { text: "Import history", onclick: openImportDialog }));
  }

  bar.append(h("span", { class: "who" },
    h("strong", { text: app.user.display_name }),
    h("span", { class: "role-label", text: ` · ${ROLE_LABELS[app.user.role]}` })));
  bar.append(h("button", { text: "Sign out", onclick: signOut }));
  return bar;
}

async function signOut() {
  await api.signOut();
  stopFeed();
  app.user = null;
  showSignIn();
}

async function runSearch(query) {
  const result = await api.get(`/api/search?q=${encodeURIComponent(query)}`);
  if (result.status !== 200) return;
  const existing = document.getElementById("search-results");
  if (existing) existing.remove();
  if (!result.body.results.length) return;
  const list = h("ul", { role: "list", "aria-label": "Search results", id: "search-results" });
  for (const item of result.body.results) {
    const link = h("a", { href: "#", text: item.label });
    link.addEventListener("click", event => {
      event.preventDefault();
      hideSearchResults();
      if (item.type === "directive") {
        const directive = app.board.directives.find(d => d.id === item.id);
        if (directive) focusDirectiveColumn(directive.id);
      } else if (item.type === "thread") {
        openThread(item.id);
      } else {
        switchView("people");
      }
    });
    list.append(h("li", {}, link));
  }
  const search = document.getElementById("fleet-search");
  search.after(list);
}

function hideSearchResults() {
  const existing = document.getElementById("search-results");
  if (existing) existing.remove();
}

function focusDirectiveColumn(directiveId) {
  const cell = document.querySelector(`[data-directive="${directiveId}"]`);
  if (cell) cell.scrollIntoView({ block: "center", inline: "center" });
}

function renderRail(rail) {
  rail.textContent = "";
  const byAuthority = new Map();
  for (const directive of app.board.directives) {
    if (!byAuthority.has(directive.authority)) byAuthority.set(directive.authority, []);
    byAuthority.get(directive.authority).push(directive);
  }
  for (const [authority, directives] of byAuthority) {
    rail.append(h("h2", { text: authority }));
    for (const directive of directives) {
      const label = directiveLabel(directive);
      const tag = tagOf(directive.revision);
      const link = h("a", { href: "#", class: directive.status === "withdrawn" ? "withdrawn" : "" },
        h("span", { text: label }),
        h("span", { class: "tag", text: tag }),
        directive.status === "withdrawn" ? h("span", { class: "withdrawn-note", text: " withdrawn" }) : null);
      link.addEventListener("click", event => {
        event.preventDefault();
        focusDirectiveColumn(directive.id);
        if (window.innerWidth < 1024) {
          app.railOpen = false;
          rail.classList.remove("open");
        }
      });
      rail.append(link);
    }
  }
}

/* ---------------- rendering: matrix ---------------- */
function renderMatrix(wrap) {
  const board = app.board;
  wrap.textContent = "";
  const narrow = window.innerWidth < 768;
  const currentDirective = app.directivePicker || (board.directives[0] && board.directives[0].id);

  const table = h("table", { class: "matrix", role: "grid", "aria-label": "Compliance matrix",
    "aria-rowcount": String(board.tails.length) });

  // header row
  const thead = h("thead");
  const headRow = h("tr", { role: "row" });
  headRow.append(h("th", { class: "rowhead", role: "columnheader", scope: "col", text: "Tail" }));
  for (const directive of board.directives) {
    if (narrow && directive.id !== currentDirective) continue;
    headRow.append(directiveHeader(directive));
  }
  thead.append(headRow);
  table.append(thead);

  // body rows
  const tbody = h("tbody");
  const cellsByTail = new Map();
  for (const cell of board.cells) {
    if (!cellsByTail.has(cell.registration)) cellsByTail.set(cell.registration, new Map());
    cellsByTail.get(cell.registration).set(cell.directive_id, cell);
  }
  let rowIndex = 0;
  for (const tail of board.tails) {
    if (app.filter) {
      const cell = (cellsByTail.get(tail.registration) || new Map()).get(app.filter.directiveId);
      if (!cell || spliceCategory(cell) !== app.filter.category) continue;
    }
    rowIndex += 1;
    const row = h("tr", { role: "row" });
    row.append(h("th", {
      class: "rowhead", role: "rowheader", scope: "row", text: tail.registration,
      tabindex: "-1", dataset: { registration: tail.registration },
      onclick: () => openTailDialog(tail.registration),
    }));
    for (const directive of board.directives) {
      if (narrow && directive.id !== currentDirective) continue;
      const cell = (cellsByTail.get(tail.registration) || new Map()).get(directive.id);
      row.append(renderCell(cell, directive, tail));
    }
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);

  // Directive picker for 375 wide
  const previousPicker = document.querySelector(".directive-picker");
  if (previousPicker) previousPicker.remove();
  if (narrow) {
    const picker = h("select", { "aria-label": "Directive", class: "directive-picker" });
    for (const directive of board.directives) {
      picker.append(h("option", {
        value: directive.id, text: `${directiveLabel(directive)} ${tagOf(directive.revision)}`,
        selected: directive.id === currentDirective ? true : undefined,
      }));
    }
    picker.addEventListener("change", () => {
      app.directivePicker = picker.value;
      renderBoard();
    });
    wrap.before(picker);
  } else {
    const existing = document.querySelector(".directive-picker");
    if (existing) existing.remove();
  }

  // board filter banner
  const banner = document.getElementById("board-filter");
  if (banner) banner.remove();
  if (app.filter) {
    const node = h("div", { id: "board-filter", role: "status", "aria-label": "Board filter",
      class: "toast" });
    node.append(`Showing ${app.filter.count} ${app.filter.category} cells from ${app.filter.tag} `);
    node.append(h("button", { text: "Clear filter", onclick: () => { app.filter = null; renderBoard(); } }));
    document.getElementById("toast-root").before(node);
  }
}

function directiveHeader(directive) {
  const label = directiveLabel(directive);
  const tag = tagOf(directive.revision);
  const cell = h("th", { role: "columnheader", scope: "col", class: "col-header",
    dataset: { directive: directive.id } });
  const head = h("div", { class: "head-main" },
    h("span", { class: "dirnum", text: `${label} ${tag}` }),
    h("span", { class: "title", text: directive.title }));
  cell.append(head);
  cell.append(h("div", { class: "col-counts num",
    text: `O${directive.counts.open} D${directive.counts.due_soon} V${directive.counts.overdue} F${directive.counts.deferred} C${directive.counts.complied}` }));
  if (directive.prior_revisions && directive.prior_revisions.length && !app.asOf) {
    const ribbon = h("div", { class: "ribbon" });
    for (const prior of directive.prior_revisions) {
      ribbon.append(h("button", { text: `View under ${prior}`,
        onclick: event => { event.stopPropagation(); viewUnderRevision(directive.id, prior); } }));
    }
    cell.append(ribbon);
  }
  const actions = h("button", { class: "col-actions", text: `Directive actions ${label}`,
    "aria-haspopup": "true" });
  actions.addEventListener("click", event => {
    event.stopPropagation();
    const items = [];
    if (app.user.role === "compliance_planner") {
      items.push({ label: "Ingest revision", action: () => openRevisionDialog(directive) });
    }
    if (app.user.role === "records_clerk") {
      items.push({ label: "Send compliance pack", action: () => sendPack(directive.id) });
    }
    items.push({ label: "Export CSV", action: () => { window.location.href = `/api/directives/${directive.id}/export.csv`; } });
    if (app.user.role === "compliance_planner") {
      items.push({ label: "Withdraw directive", action: () => openWithdrawDialog(directive) });
    }
    showMenu(actions, items);
  });
  cell.append(actions);
  return cell;
}

function spliceCategory(cell) {
  const stage = cell.stage;
  if (stage === "not_applicable") return "removed";
  if (stage === "certified") return "kept";
  if (stage === "superseded_retargeted") return "retargeted";
  return "retargeted";
}

function renderCell(cell, directive, tail) {
  if (!cell) {
    return h("td", { role: "gridcell", class: "cell empty", "aria-hidden": "true" });
  }
  const label = cell.label;
  const name = `${tail.registration} ${directiveLabel(directive)} ${cell.revision}: ${label}` +
    (cell.governing ? `, ${cell.governing === "CAL" ? "CAL governs" : "FH governs"}` : "") +
    (cell.pinned_revision ? `, signed under ${cell.pinned_revision}` : "");
  const td = h("td", {
    role: "gridcell", class: `cell ${statusClass(cell.state, cell.stage)}`,
    tabindex: "-1", "aria-label": name, dataset: {
      directive: directive.id, thread: cell.thread_id,
      registration: tail.registration,
    },
    onclick: () => openThread(cell.thread_id),
  });
  td.append(svgNode(glyphSvg(label)));
  td.append(h("span", { class: "status-label", text: label }));
  td.append(h("span", { class: "tag", text: cell.revision }));
  if (cell.governing) {
    td.append(h("span", { class: "governing-text",
      text: cell.governing === "CAL" ? "CAL governs" : "FH governs" }));
  }
  if (cell.pinned_revision) {
    td.append(h("span", { class: "pinned-tab", text: `signed under ${cell.pinned_revision}` }));
  }
  if (cell.stage === "not_applicable" || cell.stage === "withdrawn" ||
      directive.status === "withdrawn") {
    const link = h("a", { href: "#", text: "Thread history" });
    link.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      openThread(cell.thread_id);
    });
    td.append(h("div", {}, link));
  } else if (cell.stage !== "certified") {
    const calMeter = h("meter", { min: "0", max: "100", value: String(Math.round(cell.calendar_used * 100)),
      "aria-label": "Calendar limit used", class: "rail-meter" });
    const fhMeter = h("meter", { min: "0", max: "100", value: String(Math.round(cell.hours_used * 100)),
      "aria-label": "Flight-hours limit used", class: "rail-meter" });
    const calRow = h("div", { class: "rail-row" }, calMeter);
    const fhRow = h("div", { class: "rail-row" }, fhMeter);
    if (cell.governing === "CAL") calRow.classList.add("governing");
    if (cell.governing === "FH") fhRow.classList.add("governing");
    td.append(calRow, fhRow);
  }
  if (app.selectedThreadId === cell.thread_id) td.classList.add("selected");
  return td;
}

function viewUnderRevision(directiveId, tag) {
  app.asOfDirective = directiveId;
  app.asOf = tag;
  loadAsOfBoard();
}

async function loadAsOfBoard() {
  const query = `/api/board?directive_id=${encodeURIComponent(app.asOfDirective)}&as_of=${encodeURIComponent(app.asOf)}`;
  const result = await api.get(query);
  if (result.status !== 200) return;
  app.board = mergeAsOfBoard(result.body);
  renderBoard();
  showAsOfBanner();
}

function mergeAsOfBoard(asOfBoard) {
  const board = Object.assign({}, app.board);
  board.directives = app.board.directives.map(directive =>
    directive.id === app.asOfDirective
      ? Object.assign({}, directive, { revision: asOfBoard.directives[0].revision,
          counts: asOfBoard.directives[0].counts })
      : directive);
  board.cells = app.board.cells.filter(cell => cell.directive_id !== app.asOfDirective)
    .concat(asOfBoard.cells);
  board.totals = recountTotals(board.cells);
  return board;
}

function recountTotals(cells) {
  const totals = { open: 0, due_soon: 0, overdue: 0, deferred: 0, complied: 0 };
  for (const cell of cells) {
    if (cell.stage === "not_applicable" || cell.stage === "withdrawn") continue;
    if (cell.state === "overdue") totals.overdue += 1;
    else if (cell.stage === "certified") totals.complied += 1;
    else if (cell.stage === "deferred") totals.deferred += 1;
    else if (cell.state === "due_soon") totals.due_soon += 1;
    else totals.open += 1;
  }
  return totals;
}

function showAsOfBanner() {
  const existing = document.getElementById("as-of-banner");
  if (existing) existing.remove();
  const directive = app.board.directives.find(d => d.id === app.asOfDirective);
  const node = h("div", { id: "as-of-banner", role: "status", "aria-label": "Viewing prior revision",
    class: "toast" });
  node.append(`Viewing ${directiveLabel(directive)} as it stood under ${app.asOf}. Read-only. `);
  node.append(h("button", { text: "Back to current", onclick: backToCurrent }));
  document.getElementById("toast-root").before(node);
}

function backToCurrent() {
  app.asOf = null;
  app.asOfDirective = null;
  const banner = document.getElementById("as-of-banner");
  if (banner) banner.remove();
  loadBoard();
}

/* ---------------- grid keyboard ---------------- */
function bindBoardKeyboard() {
  const wrap = document.getElementById("matrix-wrap");
  if (!wrap || wrap._bound) return;
  wrap._bound = true;
  wrap.addEventListener("keydown", event => {
    const focusables = Array.from(wrap.querySelectorAll("[tabindex='-1']"));
    const index = focusables.indexOf(document.activeElement);
    if (index < 0) return;
    const stride = app.board ? app.board.directives.length + 1 : 1;
    let next = -1;
    if (event.key === "ArrowDown") next = index + stride;
    else if (event.key === "ArrowUp") next = index - stride;
    else if (event.key === "ArrowRight") next = index + 1;
    else if (event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "Home") next = Math.floor(index / stride) * stride;
    else if (event.key === "End") next = Math.floor(index / stride) * stride + stride - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = focusables[index];
      if (target.dataset.thread) openThread(target.dataset.thread);
      else if (target.dataset.registration) openTailDialog(target.dataset.registration);
      return;
    }
    if (next >= 0 && next < focusables.length) {
      event.preventDefault();
      focusables[next].focus();
    }
  });
}

/* ---------------- thread drawer ---------------- */
function drawerOpen() {
  return app.selectedThreadId !== null;
}

async function openThread(threadId) {
  app.selectedThreadId = threadId;
  document.querySelector(".shell")?.classList.add("with-drawer");
  const drawer = document.getElementById("drawer");
  drawer.style.display = "";
  drawer.classList.add("open");
  await loadThread(threadId);
  const heading = drawer.querySelector("h2");
  if (heading) heading.focus();
}

function closeDrawer() {
  const drawer = document.getElementById("drawer");
  const cell = document.querySelector(`[data-thread="${app.selectedThreadId}"]`);
  app.selectedThreadId = null;
  app.thread = null;
  drawer.style.display = "none";
  drawer.classList.remove("open");
  document.querySelector(".shell")?.classList.remove("with-drawer");
  if (cell) cell.focus();
}

function renderDrawer() {
  const drawer = document.getElementById("drawer");
  drawer.textContent = "";
  const thread = app.thread;
  if (!thread) return;
  const label = thread.directive;
  const heading = h("h2", { tabindex: "-1", text: `Thread ${thread.registration} ${label}` });

  const body = [];
  body.push(section("State and governing limit",
    dl([
      ["State", thread.label],
      ["Governing limit", thread.governing === "CAL" ? "CAL governs" :
        thread.governing === "FH" ? "FH governs" : "—"],
      ["Revision", thread.revision],
      ["Governing revision", thread.governing_revision],
      ...(thread.pinned_revision ? [["Pinned to", thread.pinned_revision]] : []),
    ])));

  body.push(section("Limits in force", dl([
    ["Effective date", thread.limits.effective_date],
    ["Deadline date", thread.limits.deadline_date],
    ["Hours threshold", `${formatHours(thread.limits.fh_threshold)} FH`],
    ["Deferral applies", thread.limits.deferred ? "Yes" : "No"],
    ["Due at", thread.limits.due_at],
  ])));

  body.push(section("Method of compliance", h("p", { text: thread.wording.method }),
    h("p", { class: "dim", text: thread.wording.title })));

  // work card
  const cardRegion = h("section", {}, h("h3", { text: "Work card" }));
  cardRegion.append(dl([
    ["Card", thread.work_card.id],
    ["Holder", thread.work_card.holder ? personName(thread.work_card.holder) : "Unassigned"],
    ["Claimed at", thread.work_card.claimed_at || "—"],
  ]));
  const evidenceList = h("ul", { "aria-label": "Evidence" });
  for (const item of thread.evidence) {
    evidenceList.append(h("li", {},
      `${item.content_type} · ${item.bytes} bytes · ${item.sha256}`));
  }
  if (!thread.evidence.length) evidenceList.append(h("li", { class: "dim", text: "No evidence attached." }));
  cardRegion.append(h("h3", { text: "Evidence" }), evidenceList);
  body.push(cardRegion);

  // sign-off chain
  const chain = h("ol", { "aria-label": "Sign-off chain" });
  for (const signature of thread.signatures) {
    const row = h("li", { class: `sig-row sig-${signature.status}` });
    row.append(h("span", { text: `${signature.kind === "countersignature" ? "Countersignature" :
      signature.kind === "inspection" ? "Inspection" : "Legacy"} · ` }));
    row.append(h("span", { text:
      `${signature.signer ? personName(signature.signer) : (signature.signer_text || "Unknown")}` +
      (signature.signer && signature.signer.licence ? ` (${signature.signer.licence})` : "") +
      ` · ${signature.revision} · ${signature.committed_at}` +
      (signature.timeliness ? ` · ${signature.timeliness === "on_time" ? "on time" : "overdue"}` : "") }));
    row.append(h("span", { class: `sig-status ${signature.status}`,
      text: signature.status === "valid" ? "valid" :
        `${signature.status}${signature.void_reason ? ` · ${signature.void_reason}` : ""}` }));
    chain.append(row);
  }
  if (thread.certifier.assigned) {
    chain.append(h("li", { class: "sig-row" },
      h("span", { text: "Assigned certifier" }),
      h("span", { text: personName(thread.certifier.assigned) }),
      h("span", { class: "sig-status", text: thread.certifier.status === "awaiting_countersignature"
        ? "awaiting countersignature" : "awaiting certifier" })));
  } else if (thread.stage === "inspected") {
    chain.append(h("li", { class: "sig-row" },
      h("span", { text: "Assigned certifier" }), h("span", { text: "—" }),
      h("span", { class: "sig-status", text: "awaiting certifier" })));
  }
  body.push(section("Sign-off chain", chain));

  // revision history ribbon
  const history = h("ol", { "aria-label": "Revision history" });
  for (const entry of thread.history) {
    history.append(h("li", {},
      h("span", { text: `${entry.revision} · ${entry.outcome}` }),
      h("div", { class: "dim",
        text: `${entry.limits.effective_date} → ${entry.limits.deadline_date}, threshold ${formatHours(entry.limits.fh_threshold)} FH` }),
      entry.legacy_records.length
        ? h("div", { class: "dim", text: `legacy: ${entry.legacy_records.length} record(s)` })
        : null));
  }
  body.push(section("Revision history", history));

  // actions
  body.push(h("div", { class: "actions" }, ...drawerControls(thread)));

  drawer.append(heading, ...body);
  drawer.append(h("button", { text: "Close thread panel", onclick: closeDrawer }));
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", `Thread ${thread.registration} ${label}`);
}

function section(title, ...children) {
  const node = h("section", {}, h("h3", { text: title }));
  node.append(...children.flat());
  return node;
}

function dl(pairs) {
  const list = h("dl");
  for (const [term, value] of pairs) {
    list.append(h("dt", { text: term }), h("dd", { text: String(value) }));
  }
  return list;
}

function drawerControls(thread) {
  const controls = [];
  const role = app.user.role;
  const stage = thread.stage;
  const isHolder = thread.work_card.holder && thread.work_card.holder.id === app.user.id;
  const directiveWithdrawn = app.board && app.board.directives
    .find(d => d.id === thread.directive_id)?.status === "withdrawn";

  if (app.asOf || app.asOfDirective === thread.directive_id) return controls;
  if (directiveWithdrawn) return controls;

  if (role === "licensed_inspector") {
    if ((stage === "open" || stage === "deferred" || stage === "reopened") && !thread.work_card.holder) {
      controls.push(h("button", { text: "Claim work card",
        onclick: () => claimCard(thread) }));
    }
    if (isHolder) {
      controls.push(h("button", { text: "Release work card",
        onclick: () => releaseCard(thread) }));
      controls.push(fileInput("Attach evidence", async file => {
        announceStatus(COPY.uploading);
        const result = await api.request("POST",
          `/api/threads/${thread.id}/evidence`, file, { headers: { "Content-Type": file.type } });
        handleAction(result, () => COPY.evidenceAttached);
      }));
      const methodRef = h("input", { type: "text", "aria-label": "Method reference",
        placeholder: "Method reference" });
      const findings = h("textarea", { "aria-label": "Findings", placeholder: "Findings" });
      controls.push(methodRef, findings);
      if (stage === "claimed" || stage === "reopened") {
        controls.push(h("button", { text: "Sign inspection", onclick: async () => {
          announceStatus(COPY.signing);
          const result = await api.json("POST", `/api/threads/${thread.id}/inspection`, {
            revision: thread.revision, method_ref: methodRef.value, findings: findings.value,
            evidence_ids: thread.evidence.map(item => item.id).slice(0, 1),
          }, { idempotency: "keyed" });
          handleAction(result, body => {
            const onTime = body.signature && body.signature.timeliness === "on_time";
            return COPY.signed(thread.revision, onTime);
          });
        } }));
      }
    }
  }

  if (role === "certifying_engineer" && stage === "inspected") {
    controls.push(h("button", { text: "Countersign", onclick: async () => {
      announceStatus(COPY.countersigning);
      const result = await api.json("POST", `/api/threads/${thread.id}/countersign`,
        { revision: thread.revision }, { idempotency: "keyed" });
      handleAction(result, () => COPY.countersigned(thread.revision));
    } }));
  }

  if (role === "compliance_planner" && stage === "open") {
    const reason = h("input", { type: "text", "aria-label": "Deferral reason",
      placeholder: "Deferral reason" });
    controls.push(reason, h("button", { text: "Defer", onclick: async () => {
      announceStatus(COPY.deferring);
      const result = await api.json("POST", `/api/threads/${thread.id}/deferral`,
        { reason: reason.value }, { idempotency: "keyed" });
      handleAction(result, body => COPY.deferred(body.thread.limits.deadline_date));
    } }));
  }

  if (role === "compliance_planner" && stage === "superseded_retargeted") {
    const reason = h("input", { type: "text", "aria-label": "Effectivity reason",
      placeholder: "Effectivity reason" });
    controls.push(reason,
      h("button", { text: "Confirm effectivity", onclick: () => confirmEffectivity(thread, "confirmed", reason.value) }),
      h("button", { text: "Mark not applicable", onclick: () => confirmEffectivity(thread, "not_applicable", reason.value) }));
  }

  if (role === "records_clerk" && stage === "certified") {
    const reason = h("input", { type: "text", "aria-label": "Reopen reason",
      placeholder: "Reopen reason" });
    controls.push(reason, h("button", { text: "Reopen thread", onclick: async () => {
      announceStatus(COPY.reopening);
      const result = await api.json("POST", `/api/threads/${thread.id}/reopen`,
        { reason: reason.value });
      handleAction(result, () => COPY.reopened);
    } }));
  }
  return controls;
}

function fileInput(label, handler) {
  const input = h("input", { type: "file", "aria-label": label });
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) handler(file);
  });
  return input;
}

async function confirmEffectivity(thread, decision, reason) {
  announceStatus(COPY.confirming);
  const result = await api.json("POST", `/api/threads/${thread.id}/effectivity`,
    { decision, reason });
  handleAction(result, () => decision === "confirmed" ? COPY.effectivityConfirmed : COPY.markedNotApplicable);
}

function handleAction(result, successCopy) {
  if (result.status >= 200 && result.status < 300) {
    const text = typeof successCopy === "function" ? successCopy(result.body) : successCopy;
    announceStatus(text);
    loadThread(app.selectedThreadId || result.body.thread?.id);
    loadBoard();
  } else if (result.status === 401) {
    showSignIn(COPY.sessionEnded);
  } else {
    const error = result.body.error || {};
    announceError(errorCopy(error.code, error));
    if (app.selectedThreadId) loadThread(app.selectedThreadId);
  }
}

async function claimCard(thread) {
  announceStatus(COPY.claiming(thread.work_card.id));
  const result = await api.json("POST", `/api/threads/${thread.id}/claim`, {},
    { idempotency: "keyed" });
  handleAction(result, () => COPY.cardYours(thread.work_card.id));
}

async function releaseCard(thread) {
  announceStatus(COPY.releasing(thread.work_card.id));
  const result = await api.json("POST", `/api/threads/${thread.id}/release`, {});
  handleAction(result, () => COPY.released(thread.work_card.id));
}

/* ---------------- dialogs ---------------- */
function applicabilityControls(initial) {
  const group = h("div", { role: "group", "aria-label": "Applicability" });
  const ranges = initial ? initial.slice() : [{ model: "ATR72-212A", msn_from: "", msn_to: "" }];

  function renderRanges() {
    group.textContent = "";
    ranges.forEach((range, index) => {
      const model = h("select", { "aria-label": "Model" });
      for (const code of ["ATR72-212A", "DHC-8-402", "ERJ-170-200"]) {
        model.append(h("option", { value: code, text: modelLabel(code), selected: range.model === code ? true : undefined }));
      }
      model.addEventListener("change", () => { ranges[index].model = model.value; });
      const from = h("input", { type: "number", "aria-label": "First serial", value: range.msn_from });
      from.addEventListener("input", () => { ranges[index].msn_from = from.value; });
      const to = h("input", { type: "number", "aria-label": "Last serial", value: range.msn_to });
      to.addEventListener("input", () => { ranges[index].msn_to = to.value; });
      const remove = h("button", { text: "Remove range", onclick: () => {
        if (ranges.length > 1) { ranges.splice(index, 1); renderRanges(); }
      } });
      group.append(h("div", { class: "app-range" }, model, from, to, remove));
    });
    group.append(h("button", { text: "Add range", onclick: () => {
      ranges.push({ model: "ATR72-212A", msn_from: "", msn_to: "" });
      renderRanges();
    } }));
  }
  renderRanges();
  return { group, ranges };
}

async function uploadDocument(file) {
  const bytes = await file.arrayBuffer();
  const result = await api.request("POST", "/api/documents", bytes,
    { headers: { "Content-Type": "application/pdf" } });
  if (result.status !== 200 && result.status !== 201) {
    throw { code: (result.body.error || {}).code, body: result.body.error || {} };
  }
  return result.body.document_id;
}

function openNewDirectiveDialog() {
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: "New directive" }));
  const authority = h("select", { "aria-label": "Authority" });
  for (const name of ["EASA", "UK CAA", "ATR", "De Havilland", "Embraer"]) {
    authority.append(h("option", { value: name, text: name }));
  }
  const number = h("input", { type: "text", "aria-label": "Directive number" });
  const title = h("input", { type: "text", "aria-label": "Title" });
  const effective = h("input", { type: "date", "aria-label": "Effective date" });
  const calDays = h("input", { type: "number", "aria-label": "Calendar limit in days" });
  const fhLimit = h("input", { type: "number", "aria-label": "Flight-hours limit", step: "0.1" });
  const method = h("textarea", { "aria-label": "Method of compliance" });
  const applicability = applicabilityControls(null);
  const file = fileInput("Directive document", () => {});
  file.addEventListener("change", () => { file._chosen = file.files[0]; });
  const errorSlot = h("div", { class: "err", role: "alert" });
  const fields = [
    [authority, "authority"], [number, "number"], [title, "title"],
    [effective, "effective_date"], [calDays, "calendar_days"], [fhLimit, "fh_interval"],
    [method, "method"],
  ];
  for (const [node, name] of fields) {
    dialog.append(h("div", { class: "row" }, node));
  }
  dialog.append(h("div", { class: "row" }, applicability.group));
  dialog.append(h("div", { class: "row" }, file));
  dialog.append(errorSlot);
  const cancelButton = h("button", { text: "Cancel", onclick: () => closeTopDialog() });
  const ingest = h("button", { text: "Ingest" });
  ingest.addEventListener("click", async () => {
    errorSlot.textContent = "";
    announceStatus(COPY.ingesting("R1"));
    try {
      if (!file._chosen) {
        errorSlot.textContent = "Choose the directive document.";
        return;
      }
      const documentId = await uploadDocument(file._chosen);
      const payload = {
        authority: authority.value, number: number.value, title: title.value,
        document_id: documentId, effective_date: effective.value,
        calendar_days: Number(calDays.value), fh_interval: Number(fhLimit.value),
        applicability: applicability.ranges.map(range => ({
          model: range.model, msn_from: Number(range.msn_from), msn_to: Number(range.msn_to),
        })),
        method: method.value,
      };
      const result = await api.json("POST", "/api/directives", payload);
      if (result.status === 201) {
        closeTopDialog();
        announceStatus(COPY.ingested(`${authority.value} ${number.value}`, "R1"));
        const splice = result.body.splice;
        playRevisionSplice(result.body.directive.id, splice);
        loadBoard();
      } else {
        showFieldErrors(errorSlot, dialog, result.body);
      }
    } catch (err) {
      if (err && err.code) {
        announceError(errorCopy(err.code, err.body));
        errorSlot.textContent = errorCopy(err.code, err.body);
      }
    }
  });
  dialog.append(h("div", { class: "btnrow" }, cancelButton, ingest));
  openDialog(dialog);
}

function showFieldErrors(errorSlot, dialog, body) {
  const error = (body && body.error) || {};
  announceError(errorCopy(error.code, error));
  if (error.code === "validation" && error.fields) {
    const messages = Object.values(error.fields);
    errorSlot.textContent = messages.join(" ");
    const labels = Object.keys(error.fields);
    for (const label of labels) {
      const field = dialog.querySelector(`[aria-label="${label}"]`);
      if (field) { field.focus(); break; }
    }
  } else {
    errorSlot.textContent = errorCopy(error.code, error);
  }
}

function openRevisionDialog(directive) {
  const label = directiveLabel(directive);
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: `Ingest revision ${label}` }));
  const revisionNumber = directive.revision + 1;
  const title = h("input", { type: "text", "aria-label": "Title", value: directive.title });
  const effective = h("input", { type: "date", "aria-label": "Effective date" });
  const calDays = h("input", { type: "number", "aria-label": "Calendar limit in days" });
  const fhLimit = h("input", { type: "number", "aria-label": "Flight-hours limit", step: "0.1" });
  const method = h("textarea", { "aria-label": "Method of compliance" });
  const applicability = applicabilityControls(null);
  const priorCredit = h("input", { type: "checkbox", "aria-label": "Credit work done under the prior revision" });
  const file = fileInput("Directive document", () => {});
  file.addEventListener("change", () => { file._chosen = file.files[0]; });
  const errorSlot = h("div", { class: "err", role: "alert" });
  dialog.append(
    h("div", { class: "row" }, title),
    h("div", { class: "row" }, effective),
    h("div", { class: "row" }, calDays),
    h("div", { class: "row" }, fhLimit),
    h("div", { class: "row" }, method),
    h("div", { class: "row" }, applicability.group),
    h("div", { class: "row" }, priorCredit),
    h("div", { class: "row" }, file),
    errorSlot);
  const ingest = h("button", { text: "Ingest" });
  ingest.addEventListener("click", async () => {
    errorSlot.textContent = "";
    announceStatus(COPY.ingesting(tagOf(revisionNumber)));
    if (!file._chosen) { errorSlot.textContent = "Choose the directive document."; return; }
    try {
      const documentId = await uploadDocument(file._chosen);
      const payload = {
        revision: revisionNumber, prior_credit: priorCredit.checked,
        title: title.value, document_id: documentId, effective_date: effective.value,
        calendar_days: Number(calDays.value), fh_interval: Number(fhLimit.value),
        applicability: applicability.ranges.map(range => ({
          model: range.model, msn_from: Number(range.msn_from), msn_to: Number(range.msn_to),
        })),
        method: method.value,
      };
      const result = await api.json("POST", `/api/directives/${directive.id}/revisions`, payload);
      if (result.status === 201) {
        closeTopDialog();
        announceStatus(COPY.ingested(label, tagOf(revisionNumber)));
        playRevisionSplice(directive.id, result.body.splice);
        loadBoard();
      } else {
        showFieldErrors(errorSlot, dialog, result.body);
      }
    } catch (err) {
      if (err && err.code) errorSlot.textContent = errorCopy(err.code, err.body);
    }
  });
  dialog.append(h("div", { class: "btnrow" },
    h("button", { text: "Cancel", onclick: () => closeTopDialog() }), ingest));
  openDialog(dialog);
}

function openWithdrawDialog(directive) {
  const label = directiveLabel(directive);
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: `Withdraw ${label}` }));
  const reason = h("textarea", { "aria-label": "Withdrawal reason" });
  const errorSlot = h("div", { class: "err", role: "alert" });
  dialog.append(h("div", { class: "row" }, reason), errorSlot);
  const withdraw = h("button", { text: "Withdraw" });
  withdraw.addEventListener("click", async () => {
    announceStatus(COPY.withdrawing);
    const result = await api.json("POST", `/api/directives/${directive.id}/withdrawal`,
      { reason: reason.value });
    if (result.status === 200) {
      closeTopDialog();
      announceStatus(COPY.withdrawnOk(label));
      loadBoard();
    } else {
      showFieldErrors(errorSlot, dialog, result.body);
    }
  });
  dialog.append(h("div", { class: "btnrow" },
    h("button", { text: "Cancel", onclick: () => closeTopDialog() }), withdraw));
  openDialog(dialog);
}

function openTailDialog(registration) {
  const tail = app.board.tails.find(t => t.registration === registration);
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: `Tail ${registration}` }));
  dialog.append(h("div", {}, `Total hours: ${formatHours(tail.total_hours)} FH`));
  if (app.user.role === "compliance_planner") {
    const hours = h("input", { type: "number", "aria-label": "Sector hours", step: "0.1", min: "0.1", max: "24" });
    dialog.append(h("div", { class: "row" }, hours));
    dialog.append(h("div", { class: "btnrow" },
      h("button", { text: "Log hours", onclick: async () => {
        announceStatus(COPY.loggingHours);
        const result = await api.json("POST",
          `/api/tails/${encodeURIComponent(registration)}/flight-hours`,
          { hours: Number(hours.value) });
        if (result.status === 201) {
          announceStatus(COPY.loggedHours(registration, result.body.total_hours));
          closeTopDialog();
          loadBoard();
        } else if (result.status === 422) {
          announceError(errorCopy("validation", result.body.error));
        } else {
          announceError(errorCopy(result.body.error.code, result.body.error));
        }
      } }),
      h("button", { text: "Close", onclick: () => closeTopDialog() })));
  } else {
    dialog.append(h("div", { class: "btnrow" },
      h("button", { text: "Close", onclick: () => closeTopDialog() })));
  }
  openDialog(dialog);
}

function openImportDialog() {
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", style: "max-width:680px" });
  dialog.append(h("h2", { text: "Import history" }));
  const file = fileInput("History file", () => {});
  file.addEventListener("change", () => { file._chosen = file.files[0]; });
  dialog.append(h("div", { class: "row" }, file));
  const resultRegion = h("div", { role: "region", "aria-label": "Import result" });
  dialog.append(resultRegion);
  dialog.append(h("div", { class: "btnrow" },
    h("button", { text: "Cancel", onclick: () => closeTopDialog() }),
    h("button", { text: "Import", onclick: async () => {
      if (!file._chosen) return;
      announceStatus(COPY.importing);
      const bytes = await file._chosen.arrayBuffer();
      const result = await api.request("POST", "/api/imports", bytes,
        { headers: { "Content-Type": "text/csv" }, idempotency: "keyed" });
      if (result.status === 201 || result.status === 200) {
        const body = result.body;
        if (body.replayed_file) {
          announceStatus(COPY.importNoChange);
        } else {
          announceStatus(COPY.importDone(body));
        }
        renderImportResult(resultRegion, body);
        loadBoard();
      } else {
        announceError(errorCopy(result.body.error.code, result.body.error));
      }
    } })));
  openDialog(dialog);
}

function renderImportResult(region, body) {
  region.textContent = "";
  region.append(h("p", { text: COPY.importDone(body) }));
  const orphanTable = h("table", { "aria-label": "Orphan rows", class: "list" });
  orphanTable.append(h("thead", {}, h("tr", {},
    h("th", { text: "Row" }), h("th", { text: "Tail" }), h("th", { text: "Directive" }),
    h("th", { text: "Revision" }), h("th", { text: "Reason" }))));
  const orphanBody = h("tbody");
  for (const row of body.orphans) {
    orphanBody.append(h("tr", {},
      h("td", { class: "num", text: String(row.row) }), h("td", { text: row.tail }),
      h("td", { text: row.directive }), h("td", { text: row.revision }),
      h("td", { text: row.reason })));
  }
  orphanTable.append(orphanBody);
  const rejectedTable = h("table", { "aria-label": "Rejected rows", class: "list" });
  rejectedTable.append(h("thead", {}, h("tr", {},
    h("th", { text: "Row" }), h("th", { text: "Field" }), h("th", { text: "Message" }))));
  const rejectedBody = h("tbody");
  for (const row of body.rejected) {
    rejectedBody.append(h("tr", {},
      h("td", { class: "num", text: String(row.row) }), h("td", { text: row.field }),
      h("td", { text: row.message })));
  }
  rejectedTable.append(rejectedBody);
  region.append(orphanTable, rejectedTable);
}

/* ---------------- screens: packs, people, audit ---------------- */
function switchView(view) {
  app.view = view;
  stopPacksTimer();
  if (view === "board") {
    document.getElementById("root").textContent = "";
    app.board = null;
    loadBoard();
  } else {
    renderScreen();
  }
}

function stopPacksTimer() {
  if (app.packsTimer) { window.clearInterval(app.packsTimer); app.packsTimer = null; }
}

function renderScreen() {
  const root = document.getElementById("root");
  if (!root.querySelector(".topbar")) root.textContent = "";
  if (!root.querySelector(".topbar")) root.append(buildTopbar());
  let container = root.querySelector(".screen");
  if (!container) {
    container = h("div", { class: "screen" });
    root.append(container);
    root.append(h("div", { id: "overlay-root" }));
    root.append(h("div", { id: "toast-root" }));
    if (!document.getElementById("action-status")) {
      root.append(h("div", { class: "live-regions",
        html: `<div id="action-status" role="status" aria-live="polite" aria-label="Action status"></div>
               <div id="action-error" role="alert" aria-live="assertive" aria-label="Action error"></div>
               <div id="live-updates" role="status" aria-live="polite" aria-label="Live updates"></div>` }));
      actionStatus = document.getElementById("action-status");
      actionError = document.getElementById("action-error");
      liveUpdates = document.getElementById("live-updates");
    }
  }
  container.textContent = "";
  if (app.view === "packs") renderPacks(container);
  if (app.view === "people") renderPeople(container);
  if (app.view === "audit") renderAudit(container);
}

async function renderPacks(container) {
  container.append(h("h2", { text: "Packs" }));
  if (app.user.role === "records_clerk") {
    const picker = h("select", { "aria-label": "Pack directive" });
    for (const directive of app.board ? app.board.directives : []) {
      picker.append(h("option", { value: directive.id,
        text: `${directiveLabel(directive)} ${tagOf(directive.revision)}` }));
    }
    container.append(picker, " ");
    container.append(h("button", { text: "Send compliance pack", onclick: async () => {
      announceStatus(COPY.preparingPack);
      const result = await api.json("POST", "/api/packs", { directive_id: picker.value },
        { idempotency: "keyed" });
      if (result.status === 201 || result.status === 202) {
        const pack = result.body.pack;
        if (pack.status === "transmitted") announceStatus(COPY.packTransmitted);
        else announceStatus(COPY.packQueued(pack.waiting_for || "object storage"));
        renderPacks(container);
      } else {
        announceError(errorCopy(result.body.error.code, result.body.error));
      }
    } }));
  }
  const table = h("table", { class: "list", "aria-label": "Compliance packs" });
  table.append(h("thead", {}, h("tr", {},
    h("th", { text: "Directive" }), h("th", { text: "Revision" }), h("th", { text: "Status" }),
    h("th", { text: "Requested" }), h("th", { text: "Transmitted" }),
    h("th", { text: "PDF checksum", class: "num" }))));
  const body = h("tbody");
  table.append(body);
  container.append(table);
  const refresh = async () => {
    const result = await api.get("/api/packs");
    if (result.status !== 200) return;
    body.textContent = "";
    for (const pack of result.body.packs) {
      body.append(h("tr", {},
        h("td", { text: pack.directive_id }),
        h("td", { text: pack.revision }),
        h("td", { text: pack.status === "queued" ? "Queued" : "Transmitted" }),
        h("td", { class: "num", text: pack.requested_at }),
        h("td", { class: "num", text: pack.transmitted_at || "" }),
        h("td", { class: "num", text: pack.pdf_sha256 || "" })));
    }
  };
  await refresh();
  stopPacksTimer();
  app.packsTimer = window.setInterval(refresh, 5000);
}

async function sendPack(directiveId) {
  announceStatus(COPY.preparingPack);
  const result = await api.json("POST", "/api/packs", { directive_id: directiveId },
    { idempotency: "keyed" });
  if (result.status === 201 || result.status === 202) {
    const pack = result.body.pack;
    if (pack.status === "transmitted") announceStatus(COPY.packTransmitted);
    else announceStatus(COPY.packQueued(pack.waiting_for || "object storage"));
  } else {
    announceError(errorCopy(result.body.error.code, result.body.error));
  }
}

async function renderPeople(container) {
  container.append(h("h2", { text: "People" }));
  const table = h("table", { class: "list", "aria-label": "People" });
  table.append(h("thead", {}, h("tr", {},
    h("th", { text: "Name" }), h("th", { text: "Role" }), h("th", { text: "Staff or contractor" }),
    h("th", { text: "Licence" }), h("th", { text: "Scope" }))));
  const body = h("tbody");
  table.append(body);
  container.append(table);
  const result = await api.get("/api/people");
  if (result.status !== 200) return;
  for (const person of result.body.people) {
    const row = h("tr", {},
      h("td", { text: person.display_name }),
      h("td", { text: ROLE_LABELS[person.role] || person.role }),
      h("td", { text: person.contractor ? "Contractor" : "Staff" }),
      h("td", { class: "num", text: person.licence || "" }),
      h("td", { text: (person.scope || []).map(modelLabel).join(", ") }));
    if (app.user.role === "records_clerk" && person.contractor) {
      row.append(h("td", {}, h("button", { text: `Erase ${person.display_name}`,
        onclick: () => openEraseDialog(person) })));
    }
    if (app.user.role === "records_clerk" && person.role === "certifying_engineer") {
      row.append(h("td", {}, h("button", { text: `Edit scope ${person.display_name}`,
        onclick: () => openScopeDialog(person) })));
    }
    body.append(row);
  }
}

function openEraseDialog(person) {
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: "Erase contractor" }));
  const reason = h("textarea", { "aria-label": "Erasure reason" });
  dialog.append(h("div", { class: "row" }, reason));
  dialog.append(h("div", { class: "btnrow" },
    h("button", { text: "Cancel", onclick: () => closeTopDialog() }),
    h("button", { text: "Erase", onclick: async () => {
      announceStatus(COPY.erasing);
      const result = await api.json("POST", `/api/people/${person.id}/erasure`,
        { reason: reason.value });
      if (result.status === 200) {
        closeTopDialog();
        announceStatus(COPY.erased(result.body.person.display_name));
        renderScreen();
      } else {
        announceError(errorCopy(result.body.error.code, result.body.error));
      }
    } })));
  openDialog(dialog);
}

function openScopeDialog(person) {
  const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true" });
  dialog.append(h("h2", { text: `Certification scope ${person.display_name}` }));
  const boxes = [];
  for (const [code, label] of [["ATR72-212A", "ATR 72"], ["DHC-8-402", "Dash 8-400"],
    ["ERJ-170-200", "E175"]]) {
    const box = h("input", { type: "checkbox", "aria-label": label,
      checked: (person.scope || []).includes(code) ? true : undefined });
    boxes.push([code, box]);
    dialog.append(h("div", { class: "row" }, box, " ", label));
  }
  dialog.append(h("div", { class: "btnrow" },
    h("button", { text: "Cancel", onclick: () => closeTopDialog() }),
    h("button", { text: "Save scope", onclick: async () => {
      announceStatus(COPY.savingScope);
      const models = boxes.filter(([, box]) => box.checked).map(([code]) => code);
      const result = await api.json("PUT", `/api/engineers/${person.id}/scope`, { models });
      if (result.status === 200) {
        closeTopDialog();
        announceStatus(COPY.scopeSaved(result.body.succession.length));
        renderScreen();
      } else {
        announceError(errorCopy(result.body.error.code, result.body.error));
      }
    } })));
  openDialog(dialog);
}

async function renderAudit(container) {
  container.append(h("h2", { text: "Audit" }));
  const picker = h("select", { "aria-label": "Audit directive" });
  picker.append(h("option", { value: "", text: "All directives" }));
  if (app.board) {
    for (const directive of app.board.directives) {
      picker.append(h("option", { value: directive.id,
        text: `${directiveLabel(directive)} ${tagOf(directive.revision)}` }));
    }
  }
  container.append(picker);
  const table = h("table", { class: "list", "aria-label": "Audit trail" });
  table.append(h("thead", {}, h("tr", {},
    h("th", { text: "Time" }), h("th", { text: "Actor" }), h("th", { text: "Action" }),
    h("th", { text: "Thread" }), h("th", { text: "Detail" }))));
  const body = h("tbody");
  table.append(body);
  container.append(table);
  async function refresh() {
    const query = picker.value ? `?directive_id=${encodeURIComponent(picker.value)}` : "";
    const result = await api.get(`/api/audit${query}`);
    if (result.status !== 200) return;
    body.textContent = "";
    for (const entry of result.body.entries) {
      body.append(h("tr", {},
        h("td", { class: "num", text: entry.at }),
        h("td", { text: entry.actor ? entry.actor.display_name : "" }),
        h("td", { text: entry.action }),
        h("td", { text: entry.thread_id || "" }),
        h("td", { text: JSON.stringify(entry.detail || {}) })));
    }
  }
  picker.addEventListener("change", refresh);
  await refresh();
}

/* ---------------- sign-in ---------------- */
function showSignIn(message) {
  stopFeed();
  const root = document.getElementById("root");
  root.textContent = "";
  if (message) {
    root.append(h("div", { class: "session-note", role: "alert", text: message }));
  }
  const form = h("form", { "aria-label": "Sign in" });
  const title = h("h1", { text: "Tailboard" });
  const username = h("input", { type: "text", "aria-label": "Username", autocomplete: "username" });
  const passcode = h("input", { type: "password", "aria-label": "Passcode", autocomplete: "current-password" });
  const submit = h("button", { type: "submit", text: "Sign in" });
  form.append(title, username, passcode, submit);
  const errorSlot = h("div", { role: "alert", class: "err" });
  form.append(errorSlot);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    announceStatus(COPY.signingIn);
    const result = await api.signIn(username.value, passcode.value);
    if (result.status === 200) {
      app.user = result.body.user;
      app.view = "board";
      await loadBoard();
      startFeed();
    } else {
      errorSlot.textContent = COPY.badCredentials;
      announceError(COPY.badCredentials);
    }
  });
  root.append(h("div", { class: "signin" }, form));
}

async function boot() {
  const result = await api.get("/api/session");
  if (result.status === 200) {
    app.user = result.body.user;
    app.view = "board";
    await loadBoard();
    startFeed();
  } else {
    showSignIn();
  }
}

window.addEventListener("resize", () => {
  if (app.view === "board" && app.board) renderBoard();
});

boot();
