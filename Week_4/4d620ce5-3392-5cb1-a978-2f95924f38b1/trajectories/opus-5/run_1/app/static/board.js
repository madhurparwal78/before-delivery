// The left rail, the fleet counts and the compliance matrix, with the revision splice.

import { announceError, closeKind, element, narrow, openLayer, closeLayer,
  reducedMotion } from "./a11y.js";
import * as api from "./client.js";
import { COUNT_LABELS, filterText, priorViewText, spliceBannerText, SUCCESS, PENDING }
  from "./copy.js";
import { glyph, hatchedStub, rail } from "./glyphs.js";
import { openIngestRevision, openWithdraw } from "./dialogs.js";
import { openDrawer } from "./drawer.js";
import { cellFor, directiveById, directiveLabel, hooks, isClerk, isPlanner, runAction, state }
  from "./store.js";

const ANIMATED_ROWS = 24;
const ROW_STAGGER = 30;
const HEADER_SPLIT = 250;
const COUNT_ROLL = 400;

let grid = null;
let countsNode = null;
let railNode = null;
let bannerNode = null;
let filterNode = null;
let priorNode = null;
let built = "";
let splicing = false;
const cellNodes = new Map();
const headerNodes = new Map();
let activeCell = null;

export function boardRegion() {
  bannerNode = element("div", {
    class: "banner",
    id: "revision-changes",
    role: "status",
    "aria-label": "Revision changes",
  });
  filterNode = element("div", {
    class: "banner",
    id: "board-filter",
    role: "status",
    "aria-label": "Board filter",
  });
  priorNode = element("div", {
    class: "banner",
    id: "prior-view",
    role: "status",
    "aria-label": "Viewing prior revision",
  });
  countsNode = element("div", {
    class: "counts",
    role: "group",
    "aria-label": "Fleet counts",
  });
  grid = element("div", { role: "grid", "aria-label": "Compliance matrix", "aria-busy": "false" });
  grid.addEventListener("keydown", onGridKey);
  const wrap = element("div", { class: "matrixwrap" }, [grid]);
  built = "";
  cellNodes.clear();
  headerNodes.clear();
  return element(
    "div",
    { role: "region", "aria-label": "Fleet board", class: "boardregion" },
    [priorNode, bannerNode, filterNode, countsNode, wrap]
  );
}

export function railElement() {
  railNode = element("nav", { class: "rail", "aria-label": "Directives" });
  return railNode;
}

export function toggleRail() {
  if (railNode) railNode.classList.toggle("open");
}

// ------------------------------------------------------------------ rendering

export function renderBoard() {
  if (!state.board || !grid) return;
  renderRail();
  renderCounts(state.board.totals);
  renderMatrix();
  renderFilter();
  renderPrior();
}

function renderRail() {
  if (!railNode) return;
  const selected = state.pickedDirectiveId;
  railNode.textContent = "";
  const byAuthority = new Map();
  for (const directive of state.board.directives) {
    if (!byAuthority.has(directive.authority)) byAuthority.set(directive.authority, []);
    byAuthority.get(directive.authority).push(directive);
  }
  for (const [authority, group] of byAuthority) {
    railNode.append(element("h2", { text: authority }));
    for (const directive of group) {
      const label = `${directiveLabel(directive)} ${directive.revision}`;
      railNode.append(
        element(
          "a",
          {
            href: `#${directive.id}`,
            class: directive.id === selected ? "selected" : "",
            "aria-label": label,
            onclick: (event) => {
              event.preventDefault();
              state.pickedDirectiveId = directive.id;
              renderBoard();
              hooks.renderFrame();
              focusColumn(directive.id);
            },
          },
          [
            element("span", { text: `${directiveLabel(directive)} ` }),
            element("span", { class: "tag", text: directive.revision }),
            directive.status === "withdrawn"
              ? element("span", { class: "withdrawn", text: " withdrawn" })
              : null,
          ]
        )
      );
    }
  }
}

export function renderCounts(counts, { roll = false } = {}) {
  if (!countsNode) return;
  if (!countsNode.childElementCount) {
    for (const key of Object.keys(COUNT_LABELS)) {
      countsNode.append(
        element("span", { class: `count ${key}`, dataset: { count: key } }, [
          `${COUNT_LABELS[key]} `,
          element("span", { class: "figure", text: "0" }),
        ])
      );
    }
  }
  for (const key of Object.keys(COUNT_LABELS)) {
    const figure = countsNode.querySelector(`[data-count="${key}"] .figure`);
    setFigure(figure, counts[key], roll);
  }
}

function setFigure(node, value, roll) {
  const from = Number(node.textContent) || 0;
  if (!roll || reducedMotion() || from === value) {
    node.textContent = String(value);
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const share = Math.min(1, (now - started) / COUNT_ROLL);
    node.textContent = String(Math.round(from + (value - from) * share));
    if (share < 1) requestAnimationFrame(step);
    else node.textContent = String(value);
  };
  requestAnimationFrame(step);
}

function shownDirectives() {
  const all = state.board.directives;
  if (narrow()) {
    const picked = all.find((directive) => directive.id === state.pickedDirectiveId) || all[0];
    return picked ? [picked] : [];
  }
  return all;
}

function renderMatrix() {
  const columns = shownDirectives();
  const tails = state.board.tails;
  const signature = `${columns.map((d) => d.id).join(",")}|${tails.length}`;
  if (signature !== built) {
    buildSkeleton(columns, tails);
    built = signature;
  }
  for (const directive of columns) updateHeader(directive);
  for (const tail of tails) {
    for (const directive of columns) updateCell(tail, directive);
  }
  applyFilter();
}

function buildSkeleton(columns, tails) {
  const scrollLeft = grid.parentNode ? grid.parentNode.scrollLeft : 0;
  const scrollTop = grid.parentNode ? grid.parentNode.scrollTop : 0;
  const focused = grid.contains(document.activeElement)
    ? {
        registration: document.activeElement.dataset.registration,
        directive: document.activeElement.dataset.directive,
      }
    : null;
  grid.textContent = "";
  cellNodes.clear();
  headerNodes.clear();
  grid.style.setProperty("--columns", String(columns.length));
  const head = element("div", { role: "row", class: "headrow" }, [
    element("div", { role: "columnheader", class: "corner", "aria-label": "Tail" }, [
      element("span", { class: "colhead-title", text: "Tail" }),
    ]),
  ]);
  for (const directive of columns) {
    const header = element("div", { role: "columnheader", dataset: { directive: directive.id } });
    headerNodes.set(directive.id, header);
    head.append(header);
  }
  grid.append(head);
  for (const tail of tails) {
    const row = element("div", { role: "row", dataset: { registration: tail.registration } }, [
      element("div", {
        role: "rowheader",
        tabindex: "-1",
        "aria-label": tail.registration,
        text: tail.registration,
        dataset: { registration: tail.registration },
        onclick: () => hooks.openTail(tail.registration),
      }),
    ]);
    for (const directive of columns) {
      const cell = element("div", {
        role: "gridcell",
        tabindex: "-1",
        dataset: { registration: tail.registration, directive: directive.id },
      });
      cellNodes.set(`${tail.registration}|${directive.id}`, cell);
      row.append(cell);
    }
    grid.append(row);
  }
  if (grid.parentNode) {
    grid.parentNode.scrollLeft = scrollLeft;
    grid.parentNode.scrollTop = scrollTop;
  }
  const first = grid.querySelector('[role="rowheader"]');
  if (first) first.setAttribute("tabindex", "0");
  if (focused) {
    const again = focused.directive
      ? cellNodes.get(`${focused.registration}|${focused.directive}`)
      : grid.querySelector(`[role="row"][data-registration="${focused.registration}"]`
          + ' [role="rowheader"]');
    if (again) {
      again.setAttribute("tabindex", "0");
      again.focus();
    }
  }
}

function updateHeader(directive) {
  const header = headerNodes.get(directive.id);
  if (!header) return;
  const prior = state.prior && state.prior.directiveId === directive.id ? state.prior : null;
  const tag = prior ? prior.tag : directive.revision;
  header.setAttribute("aria-label", `${directiveLabel(directive)} ${tag}`);
  header.textContent = "";
  header.append(
    element("div", { class: "colhead-top" }, [
      element("span", { text: directiveLabel(directive) }),
      element("span", { class: "tag", text: tag }),
      directive.status === "withdrawn"
        ? element("span", { class: "withdrawn", text: "withdrawn" })
        : null,
      element("span", { class: "spacer", style: "flex:1" }),
      prior
        ? null
        : element("button", {
            class: "quiet",
            "aria-label": `Directive actions ${directiveLabel(directive)}`,
            text: "⋯",
            onclick: (event) => openDirectiveMenu(event.currentTarget, directive),
          }),
    ])
  );
  header.append(element("div", { class: "colhead-title", text: directive.title }));
  const counts = prior ? prior.directive.counts : directive.counts;
  header.append(
    element(
      "div",
      { class: "colhead-counts" },
      Object.keys(COUNT_LABELS).map((key) =>
        element("span", {
          class: key,
          dataset: { headcount: `${directive.id}|${key}` },
          text: `${COUNT_LABELS[key]} ${counts[key]}`,
        })
      )
    )
  );
  const priorTags = directive.prior_revisions || [];
  if (priorTags.length) {
    header.append(
      element(
        "div",
        { class: "ribbon" },
        priorTags.map((priorTag) =>
          element("button", {
            text: `View under ${priorTag}`,
            "aria-label": `View under ${priorTag}`,
            onclick: () => viewPrior(directive, priorTag),
          })
        )
      )
    );
  }
}

function cellName(cell, directive) {
  const label = `${cell.registration} ${directiveLabel(directive)} ${cell.revision}: ${cell.label}`;
  const governing = cell.governing ? `, ${cell.governing} governs` : "";
  const pinned = cell.pinned_revision ? `, signed under ${cell.pinned_revision}` : "";
  return `${label}${governing}${pinned}`;
}

function updateCell(tail, directive) {
  const node = cellNodes.get(`${tail.registration}|${directive.id}`);
  if (!node) return;
  const prior = state.prior && state.prior.directiveId === directive.id ? state.prior : null;
  const cell = prior
    ? prior.cells.find((entry) => entry.registration === tail.registration) || null
    : cellFor(tail.registration, directive.id);
  const was = node.getAttribute("aria-label");
  node.textContent = "";
  node.className = "";
  node.classList.add(cell && cell.stage === "superseded_retargeted" ? "superseded" : "plain");
  if (!cell) {
    node.classList.add("empty");
    node.removeAttribute("aria-label");
    node.dataset.threadId = "";
    node.onclick = null;
    return;
  }
  node.dataset.threadId = cell.thread_id;
  node.setAttribute("aria-label", cellName(cell, directive));
  if (state.openThreadId === cell.thread_id) node.classList.add("selected");
  const stub = cell.stage === "not_applicable" || cell.stage === "withdrawn";
  node.append(
    element("div", { class: "cell-line" }, [
      glyph(cell.label),
      element("span", { class: "cell-label", text: cell.label }),
      element("span", {
        class: "cell-governs",
        text: cell.governing ? `${cell.governing} governs` : "",
      }),
      element("span", { class: "cell-tag", text: cell.revision }),
    ])
  );
  if (stub) {
    node.append(hatchedStub(cell.label));
    node.append(
      element("a", {
        href: `#thread-${cell.thread_id}`,
        text: "Thread history",
        "aria-label": "Thread history",
        onclick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          openDrawer(cell.thread_id, node);
        },
      })
    );
  } else {
    node.append(
      element("div", { class: "rails" }, [
        rail("Calendar limit used", cell.calendar_used, cell.governing === "CAL"),
        rail("Flight-hours limit used", cell.hours_used, cell.governing === "FH"),
      ])
    );
  }
  if (cell.pinned_revision) {
    node.append(
      element("span", { class: "pinned-tab", text: `signed under ${cell.pinned_revision}` })
    );
  }
  node.onclick = prior ? null : () => openDrawer(cell.thread_id, node);
  node.style.cursor = prior ? "default" : "";
  if (was && was !== node.getAttribute("aria-label") && !splicing && !reducedMotion()) {
    node.classList.add("changed");
    setTimeout(() => node.classList.remove("changed"), 120);
  }
}

export function markSelected(threadId) {
  for (const node of cellNodes.values()) {
    node.classList.toggle("selected", node.dataset.threadId === threadId);
  }
}

// ------------------------------------------------------------------ keyboard

function onGridKey(event) {
  const target = event.target;
  const role = target.getAttribute && target.getAttribute("role");
  if (role !== "gridcell" && role !== "rowheader") return;
  const row = target.parentNode;
  const cellsInRow = [...row.children];
  const rows = [...grid.children];
  const rowIndex = rows.indexOf(row);
  const columnIndex = cellsInRow.indexOf(target);
  let next = null;
  if (event.key === "ArrowRight") next = cellsInRow[columnIndex + 1];
  else if (event.key === "ArrowLeft") next = cellsInRow[columnIndex - 1];
  else if (event.key === "ArrowDown") next = (rows[rowIndex + 1] || row).children[columnIndex];
  else if (event.key === "ArrowUp") next = (rows[rowIndex - 1] || row).children[columnIndex];
  else if (event.key === "Home") next = cellsInRow[0];
  else if (event.key === "End") next = cellsInRow[cellsInRow.length - 1];
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    target.click();
    return;
  }
  if (!next) return;
  event.preventDefault();
  for (const node of grid.querySelectorAll('[role="gridcell"],[role="rowheader"]')) {
    node.setAttribute("tabindex", "-1");
  }
  next.setAttribute("tabindex", "0");
  next.focus();
  activeCell = next;
}

function focusColumn(directiveId) {
  const header = headerNodes.get(directiveId);
  if (header && header.scrollIntoView) header.scrollIntoView({ block: "nearest", inline: "start" });
}

// ------------------------------------------------------------------ directive menu

function openDirectiveMenu(button, directive) {
  closeKind("menu");
  const items = [];
  if (isPlanner()) {
    items.push(["Ingest revision", () => openIngestRevision(directive)]);
  }
  if (isClerk()) {
    items.push(["Send compliance pack", () => sendPack(directive)]);
  }
  items.push(["Export CSV", () => exportCsv(directive)]);
  if (isPlanner()) {
    items.push(["Withdraw directive", () => openWithdraw(directive)]);
  }
  const menu = element(
    "div",
    { role: "menu", "aria-label": `Directive actions ${directiveLabel(directive)}` },
    items.map(([label, run]) =>
      element("button", {
        role: "menuitem",
        tabindex: "-1",
        text: label,
        onclick: () => {
          closeLayer(layer);
          run();
        },
      })
    )
  );
  const box = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, box.left - 150)}px`;
  menu.style.top = `${box.bottom + 2}px`;
  document.getElementById("layers").append(menu);
  const layer = openLayer({ node: menu, modal: false, opener: button, kind: "menu" });
  const options = [...menu.querySelectorAll('[role="menuitem"]')];
  options[0].focus();
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      options[(index + 1) % options.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length].focus();
    }
  });
}

async function exportCsv(directive) {
  window.location.href = `/api/directives/${directive.id}/export.csv`;
}

export async function sendPack(directive) {
  const key = api.newKey();
  const response = await runAction({
    pending: PENDING.pack,
    run: () => api.post("/api/packs", { directive_id: directive.id }, { key }),
    success: (result) =>
      result.body.pack.status === "transmitted"
        ? SUCCESS.packTransmitted
        : SUCCESS.packQueued(
            result.body.pack.waiting_for === "object_storage" ? "object storage" : "mail"
          ),
    context: { directive: directiveLabel(directive) },
  });
  if (response.ok && hooks.refreshPacks) hooks.refreshPacks();
  return response;
}

// ------------------------------------------------------------------ prior revisions

async function viewPrior(directive, tag) {
  const response = await api.get(
    `/api/board?directive_id=${encodeURIComponent(directive.id)}&as_of=${encodeURIComponent(tag)}`
  );
  if (!response.ok) {
    announceError("That prior revision is not available.");
    return;
  }
  state.prior = {
    directiveId: directive.id,
    tag,
    cells: response.body.cells,
    directive: response.body.directives[0],
  };
  renderBoard();
}

function renderPrior() {
  priorNode.textContent = "";
  if (!state.prior) return;
  const directive = directiveById(state.prior.directiveId);
  priorNode.append(
    element("span", {
      text: priorViewText(directiveLabel(directive), state.prior.tag),
    }),
    element("button", {
      text: "Back to current",
      onclick: () => {
        state.prior = null;
        renderBoard();
      },
    })
  );
}

// ------------------------------------------------------------------ splice

export function showBanner(directiveId, splice) {
  state.banner = { directiveId, splice };
  renderBanner();
}

function renderBanner() {
  bannerNode.textContent = "";
  if (!state.banner) return;
  const directive = directiveById(state.banner.directiveId);
  if (!directive) return;
  const { splice } = state.banner;
  const text = spliceBannerText(splice, directiveLabel(directive));
  bannerNode.append(element("span", { class: "ribbonmark", text: text.prefix }));
  text.links.forEach(([category, count], index) => {
    bannerNode.append(
      element("a", {
        href: `#${category}`,
        text: `${count} ${category}`,
        onclick: (event) => {
          event.preventDefault();
          setFilter(category, splice, directive);
        },
      })
    );
    if (index < text.links.length - 1) bannerNode.append(document.createTextNode(", "));
  });
  if (text.suffix) bannerNode.append(document.createTextNode(text.suffix));
  bannerNode.append(
    element("button", {
      text: "Dismiss",
      onclick: () => {
        state.banner = null;
        renderBanner();
      },
    })
  );
}

function setFilter(category, splice, directive) {
  state.filter = {
    category,
    tag: category === "kept" ? splice.from : splice.to,
    ids: splice[category] || [],
  };
  renderFilter();
  applyFilter();
}

function renderFilter() {
  if (!filterNode) return;
  filterNode.textContent = "";
  if (!state.filter) return;
  filterNode.append(
    element("span", {
      text: filterText(state.filter.ids.length, state.filter.category, state.filter.tag),
    }),
    element("button", {
      text: "Clear filter",
      onclick: () => {
        state.filter = null;
        renderFilter();
        applyFilter();
      },
    })
  );
}

function applyFilter() {
  const ids = state.filter ? new Set(state.filter.ids) : null;
  for (const row of grid.querySelectorAll('[role="row"]:not(.headrow)')) {
    if (!ids) {
      row.removeAttribute("hidden");
      continue;
    }
    const match = [...row.querySelectorAll('[role="gridcell"]')].some((cell) =>
      ids.has(cell.dataset.threadId)
    );
    if (match) row.removeAttribute("hidden");
    else row.setAttribute("hidden", "");
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The revision splice: one connected change to a single column. */
export async function playSplice(directiveId, splice) {
  const token = `${directiveId}|${splice.to}`;
  if (state.playedSplices.has(token)) return;
  state.playedSplices.add(token);
  showBanner(directiveId, splice);
  if (reducedMotion()) {
    renderBoard();
    return;
  }
  const header = headerNodes.get(directiveId);
  splicing = true;
  grid.setAttribute("aria-busy", "true");
  if (header) header.classList.add("splitting");
  renderBoard();
  await wait(HEADER_SPLIT);
  if (header) header.classList.remove("splitting");
  const rows = [...grid.querySelectorAll('[role="row"]:not(.headrow)')];
  const kinds = new Map();
  for (const [category, className] of [
    ["retargeted", "rethread"],
    ["added", "drop-in"],
    ["removed", "collapse"],
    ["kept", "pin-in"],
  ]) {
    for (const id of splice[category] || []) kinds.set(id, className);
  }
  rows.forEach((row, index) => {
    const cell = row.querySelector(`[data-directive="${directiveId}"]`);
    if (!cell) return;
    const className = kinds.get(cell.dataset.threadId) || "rethread";
    const delay = Math.min(index, ANIMATED_ROWS) * ROW_STAGGER;
    setTimeout(() => {
      cell.classList.add(className);
      setTimeout(() => cell.classList.remove(className), 180);
    }, delay);
  });
  await wait(ANIMATED_ROWS * ROW_STAGGER);
  renderCounts(state.board.totals, { roll: true });
  rollHeaderCounts(directiveId);
  await wait(COUNT_ROLL);
  grid.setAttribute("aria-busy", "false");
  splicing = false;
}

function rollHeaderCounts(directiveId) {
  const directive = directiveById(directiveId);
  if (!directive) return;
  for (const key of Object.keys(COUNT_LABELS)) {
    const node = grid.querySelector(`[data-headcount="${directiveId}|${key}"]`);
    if (node) node.textContent = `${COUNT_LABELS[key]} ${directive.counts[key]}`;
  }
}
