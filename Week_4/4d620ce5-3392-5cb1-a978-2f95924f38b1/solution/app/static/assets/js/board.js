// The board screen: directive rail, fleet counts, the tail-by-directive matrix and its banners.
// Every value shown comes from the server's Board; the browser only lays it out.

import { DEFS, glyph, HATCH, icon, mark } from "./glyphs.js";
import { AUTHORITIES, dname, esc, h, MODEL_LABELS, phone, popLayer, pushLayer, reducedMotion } from "./ui.js";

export const COUNT_WORDS = [["open", "Open"], ["due_soon", "Due soon"], ["overdue", "Overdue"], ["deferred", "Deferred"],
  ["complied", "Complied"]];
const COUNT_GLYPH = { open: "Open", due_soon: "Due soon", overdue: "Overdue", deferred: "Deferred", complied: "Complied" };
const STUBS = new Set(["Not applicable", "Withdrawn"]);
const pct = (f) => Math.round(f * 100);

function gauge(c, frozen) {
  const rail = (name, cls, used, governs) => `
    <div class="lim ${cls}${governs ? " lim--gov" : ""}" role="meter" aria-label="${name}" aria-valuemin="0"
      aria-valuemax="100" aria-valuenow="${pct(used)}">
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="lim__track" width="100" height="4"/>
      <rect class="lim__fill" width="100" height="4" style="transform:scaleX(${used})"/></svg></div>`;
  return `<div class="gauge${frozen ? " gauge--frozen" : ""}" data-gov="${c.governing || ""}">
    <div class="gauge__rails">${rail("Calendar limit used", "lim--cal", c.calendar_used, c.governing === "CAL")}
    ${rail("Flight-hours limit used", "lim--fh", c.hours_used, c.governing === "FH")}<span class="notch" aria-hidden="true"></span></div>
    <span class="gauge__gov">${c.governing ? `${c.governing} governs` : ""}</span></div>`;
}

function cellName(c, d) {
  let name = `${c.registration} ${dname(d)} ${c.revision}: ${c.label}`;
  if (c.governing) name += `, ${c.governing} governs`;
  if (c.pinned_revision) name += `, signed under ${c.pinned_revision}`;
  return name;
}

export function cellInner(c) {
  // The visible text runs in the order of the cell's name ("<tag>: <label>, <governs>, signed under <tag>"), so the
  // name contains it: CSS order puts the tag back at the right, and the pinned tab comes last in the markup, drawn on
  // the top row by an overlay whose hidden copy of the tag holds its place.
  const pin = c.pinned_revision ? ` <span class="c-pinrow"><span class="c-pin">signed under ${c.pinned_revision}</span>`
    + `<span class="c-tag c-tag--spacer" aria-hidden="true">${c.revision}</span></span>` : "";
  const top = `<div class="c-top"><span class="c-tag">${c.revision}</span> <span class="c-status">${glyph(c.label)}<span class="c-label">${c.label}</span></span></div>`;
  if (STUBS.has(c.label)) {
    return `${HATCH}${top}${pin} <a class="c-hist" href="#thread-${c.thread_id}" tabindex="-1"><span>Thread history</span></a>`;
  }
  return `${top} ${gauge(c, c.stage === "certified")}${pin}`;
}

function slug(label) {
  return label.toLowerCase().replace(/ /g, "-");
}

function countFigures(counts, held) {
  return COUNT_WORDS.map(([k, word]) => `<span class="cc cc--${k}" title="${word}"${(held || counts)[k] ? "" : " data-zero"}>${mark(COUNT_GLYPH[k])}
    <span class="sr">${word}</span><span class="num" data-count="${k}">${(held || counts)[k]}</span></span>`).join("");
}

export function createBoard(app) {
  const state = app.state;
  const railToggle = h("button", { type: "button", class: "btn btn--quiet rail-toggle", "aria-expanded": "false",
    "aria-controls": "rail", onclick: () => app.toggleRail() });
  railToggle.innerHTML = `${icon("rail")}<span>Directives</span>`;
  const picker = h("select", { class: "select phone-picker", "aria-label": "Directive",
    onchange: (e) => { state.phoneDid = e.target.value; render(); } });
  const counts = h("div", { role: "group", "aria-label": "Fleet counts", class: "fleet-counts" });
  const changes = h("div", { role: "status", "aria-label": "Revision changes", class: "banner banner--changes" });
  const filter = h("div", { role: "status", "aria-label": "Board filter", class: "banner banner--filter" });
  const prior = h("div", { role: "status", "aria-label": "Viewing prior revision", class: "banner banner--prior" });
  const grid = h("div", { role: "grid", "aria-label": "Compliance matrix", "aria-busy": "false", class: "matrix",
    tabindex: "-1" });
  const loading = h("p", { class: "matrix__loading" }, "Loading board…");
  const el = h("section", { role: "region", "aria-label": "Fleet board", class: "board" },
    h("div", { class: "board__bar" }, railToggle, picker, counts),
    h("div", { class: "strip" }, changes, filter, prior), loading, grid);
  el.insertAdjacentHTML("afterbegin", DEFS);

  let structure = "";
  let roving = null;
  const signatures = new Map();
  // The grid's headers by directive id and cells by "<registration>|<directive id>", rebuilt with the structure.
  const headers = new Map();
  const cells = new Map();

  function columns() {
    const b = state.board;
    if (!b) return [];
    let list = b.directives;
    if (state.filter) list = list.filter((d) => d.id === state.filter.did);
    else if (phone()) {
      if (!list.some((d) => d.id === state.phoneDid)) state.phoneDid = list[0]?.id;
      list = list.filter((d) => d.id === state.phoneDid);
    }
    return list.map((d) => {
      if (state.prior && state.prior.did === d.id) {
        return { d: { ...state.prior.entry, prior_revisions: d.prior_revisions },
          cells: new Map(state.prior.cells.map((c) => [c.registration, c])), prior: true };
      }
      return { d, cells: new Map(b.cells.filter((c) => c.directive_id === d.id).map((c) => [c.registration, c])), prior: false };
    });
  }

  function rows(cols) {
    const tails = state.board?.tails || [];
    if (!state.filter) return tails;
    const ids = new Set(state.filter.ids);
    const col = cols[0];
    return tails.filter((t) => col && ids.has(col.cells.get(t.registration)?.thread_id));
  }

  function headerHTML(col, held) {
    const d = col.d;
    const ribbon = (d.prior_revisions || []).map((t) =>
      `<button type="button" class="ribbon__tag${col.prior && state.prior.tag === t ? " is-current" : ""}" tabindex="-1"
        aria-label="View under ${t}" data-view="${t}">${t}</button>`).join("");
    const canAct = !col.prior;
    return `<div class="colhead__line"><span class="colhead__num">${esc(d.number)}</span>
      <span class="colhead__tag">${d.revision}</span>${d.status === "withdrawn" ? '<span class="colhead__wd">withdrawn</span>' : ""}
      ${canAct ? `<button type="button" class="icon-btn colhead__act" tabindex="-1" aria-haspopup="menu" aria-expanded="false"
        aria-label="Directive actions ${esc(dname(d))}">${icon("more")}</button>` : '<span class="icon-btn colhead__act colhead__act--placeholder" aria-hidden="true"></span>'}</div>
      <div class="colhead__title" title="${esc(d.title)}"><span class="colhead__auth">${esc(d.authority)}</span> ${esc(d.title)}</div>
      <div class="colhead__counts">${countFigures(d.counts, held)}</div>
      <div class="ribbon${ribbon ? "" : " ribbon--empty"}">${ribbon}</div>`;
  }

  function headerSignature(col, held) {
    return JSON.stringify([col.d, col.prior, state.prior?.tag, held?.[col.d.id]]);
  }

  function cellSignature(c, col) {
    return c ? JSON.stringify([c, col.prior, state.selected === c.thread_id]) : "empty";
  }

  function paintCell(cellEl, c, col, fade) {
    const sig = cellSignature(c, col);
    if (signatures.get(cellEl) === sig) return false;
    signatures.set(cellEl, sig);
    cellEl.className = "cell" + (c ? ` cell--${slug(c.label)}` : " cell--empty")
      + (c && state.selected === c.thread_id ? " is-selected" : "") + (col.prior ? " cell--prior" : "");
    if (c) {
      cellEl.setAttribute("aria-label", cellName(c, col.d));
      cellEl.dataset.tid = c.thread_id;
      cellEl.innerHTML = cellInner(c);
      if (fade && !reducedMotion()) {
        for (const part of cellEl.querySelectorAll(".glyph, .gauge__rails")) {
          part.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 100, easing: "ease-out" });
        }
      }
    } else {
      cellEl.removeAttribute("aria-label");
      delete cellEl.dataset.tid;
      cellEl.innerHTML = "";
    }
    return true;
  }

  function build(cols, tailRows, held) {
    signatures.clear();
    headers.clear();
    cells.clear();
    grid.innerHTML = "";
    const head = h("div", { role: "row", class: "mrow mrow--head" },
      h("div", { role: "columnheader", class: "corner" }, h("span", {}, "Tail")));
    for (const col of cols) {
      const hd = h("div", { role: "columnheader", class: "colhead" + (col.d.status === "withdrawn" ? " colhead--withdrawn" : "")
        + (col.prior ? " colhead--prior" : ""), "aria-label": `${dname(col.d)} ${col.d.revision}`, id: `col-${col.d.id}`,
        dataset: { did: col.d.id } });
      hd.innerHTML = headerHTML(col, held?.[col.d.id]);
      signatures.set(hd, headerSignature(col, held));
      headers.set(col.d.id, hd);
      head.append(hd);
    }
    const body = h("div", { role: "rowgroup", class: "mbody" });
    for (const t of tailRows) {
      const row = h("div", { role: "row", class: "mrow", dataset: { reg: t.registration } },
        h("div", { role: "rowheader", class: "rowhead", tabindex: "-1", "aria-label": t.registration,
          dataset: { reg: t.registration } },
          h("span", { class: "rowhead__reg" }, t.registration), h("span", { class: "rowhead__model" }, MODEL_LABELS[t.model])));
      for (const col of cols) {
        const cellEl = h("div", { role: "gridcell", tabindex: "-1", dataset: { key: `${t.registration}|${col.d.id}`,
          did: col.d.id, reg: t.registration } });
        cells.set(cellEl.dataset.key, cellEl);
        paintCell(cellEl, col.cells.get(t.registration), col, false);
        row.append(cellEl);
      }
      body.append(row);
    }
    grid.append(h("div", { role: "rowgroup", class: "mhead" }, head), body);
    grid.style.setProperty("--cols", cols.length);
  }

  function patch(cols, tailRows, held) {
    for (const col of cols) {
      const hd = headers.get(col.d.id);
      const sig = headerSignature(col, held);
      if (signatures.get(hd) !== sig) {
        signatures.set(hd, sig);
        hd.setAttribute("aria-label", `${dname(col.d)} ${col.d.revision}`);
        hd.classList.toggle("colhead--withdrawn", col.d.status === "withdrawn");
        hd.innerHTML = headerHTML(col, held?.[col.d.id]);
      }
      for (const t of tailRows) {
        const cellEl = cells.get(`${t.registration}|${col.d.id}`);
        paintCell(cellEl, col.cells.get(t.registration), col, true);
      }
    }
  }

  function renderGrid({ held } = {}) {
    const cols = columns();
    const tailRows = rows(cols);
    const key = [cols.map((c) => c.d.id + (c.prior ? `@${c.d.revision}` : "")).join(","),
      tailRows.map((t) => t.registration).join(","), state.filter ? state.filter.category : ""].join("|");
    grid.hidden = !state.board;
    loading.hidden = Boolean(state.board);
    if (!state.board) {
      structure = "";
      return;
    }
    if (key !== structure) {
      build(cols, tailRows, held);
      structure = key;
    } else {
      patch(cols, tailRows, held);
    }
    settleRoving();
  }

  function renderCounts(held) {
    const totals = held || state.board?.totals;
    if (!totals) return;
    if (!counts.childElementCount) {
      counts.innerHTML = COUNT_WORDS.map(([k, word]) => `<span class="fc fc--${k}">${mark(COUNT_GLYPH[k])}
        <span class="fc__word">${word}</span> <span class="fc__num num" data-count="${k}">${totals[k]}</span></span>`).join("");
    }
    for (const [k] of COUNT_WORDS) {
      const num = counts.querySelector(`[data-count="${k}"]`);
      num.textContent = totals[k];
      num.parentElement.toggleAttribute("data-zero", !totals[k]);
    }
  }

  function renderPicker() {
    const list = state.board?.directives || [];
    const sig = list.map((d) => `${d.id}${d.revision}${d.status}`).join();
    if (picker.dataset.sig !== sig) {
      picker.dataset.sig = sig;
      picker.innerHTML = list.map((d) => `<option value="${d.id}">${esc(dname(d))} ${d.revision}</option>`).join("");
    }
    if (state.phoneDid) picker.value = state.phoneDid;
  }

  function renderStrip() {
    const b = state.banner;
    changes.replaceChildren();
    if (b) {
      const link = (cat) => h("a", { href: `#show-${cat}`, class: "banner__link", onclick: (e) => {
        e.preventDefault();
        app.filterBy(b.did, cat, b.splice[cat], b.splice.to);
      } }, `${b.splice[cat].length} ${cat}`);
      const parts = b.splice.from
        ? [`${b.splice.to} supersedes ${b.splice.from}: `, link("retargeted"), ", ", link("added"), ", ", link("removed"), ", ",
          link("kept"), ` under ${b.splice.from}`]
        : [`${b.name} ${b.splice.to} added: `, link("added")];
      changes.append(h("span", { class: "banner__text" }, ...parts),
        h("button", { type: "button", class: "btn btn--quiet btn--small", onclick: () => app.dismissBanner() }, "Dismiss"));
    }
    filter.replaceChildren();
    if (state.filter) {
      const f = state.filter;
      filter.append(h("span", { class: "banner__text" }, `Showing ${f.ids.length} ${f.category} cells from ${f.tag}`),
        h("button", { type: "button", class: "btn btn--quiet btn--small", onclick: () => app.clearFilter() }, "Clear filter"));
    }
    prior.replaceChildren();
    if (state.prior) {
      prior.append(h("span", { class: "banner__text" },
        `Viewing ${dname(state.prior.entry)} as it stood under ${state.prior.tag}. Read-only.`),
      h("button", { type: "button", class: "btn btn--quiet btn--small", onclick: () => app.backToCurrent() }, "Back to current"));
    }
  }

  function render(options = {}) {
    renderPicker();
    renderCounts(options.held?.fleet);
    renderStrip();
    renderGrid({ held: options.held?.columns });
  }

  // Keyboard: the grid is one Tab stop with a roving focus over header controls, row headers and cells.
  function items() {
    const headerRow = [...grid.querySelectorAll(".mrow--head .colhead")].map((hd) =>
      hd.querySelector(".colhead__act") || hd.querySelector(".ribbon__tag")).filter(Boolean);
    const bodyRows = [...grid.querySelectorAll(".mbody .mrow")].map((r) => [...r.children]);
    return [headerRow.length ? [null, ...headerRow] : [], ...bodyRows];
  }

  function settleRoving() {
    let target = roving && grid.contains(roving) ? roving : null;
    if (!target && roving?.dataset?.key) target = cells.get(roving.dataset.key);
    if (!target) target = grid.querySelector(".mbody [role=gridcell][data-tid]") || grid.querySelector(".mbody [role=gridcell]");
    for (const el of grid.querySelectorAll('[tabindex="0"]')) if (el !== target) el.setAttribute("tabindex", "-1");
    if (target) {
      target.setAttribute("tabindex", "0");
      roving = target;
    }
  }

  function moveTo(target) {
    if (!target) return;
    if (roving && roving !== target) roving.setAttribute("tabindex", "-1");
    target.setAttribute("tabindex", "0");
    roving = target;
    target.focus();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  grid.addEventListener("keydown", (e) => {
    const matrix = items();
    let r = -1;
    let c = -1;
    matrix.forEach((row, ri) => row.forEach((item, ci) => { if (item === document.activeElement) { r = ri; c = ci; } }));
    if (r === -1) return;
    const at = (ri, ci) => matrix[ri]?.[Math.max(0, Math.min(ci, matrix[ri].length - 1))];
    const keys = {
      ArrowRight: () => at(r, c + 1), ArrowLeft: () => (r === 0 && c <= 1 ? null : at(r, c - 1)),
      ArrowDown: () => (r + 1 < matrix.length ? at(r + 1, c) : null),
      ArrowUp: () => (r - 1 >= 0 && (r - 1 > 0 || c > 0) ? at(r - 1, c) : null),
      Home: () => at(r, r === 0 ? 1 : 0), End: () => at(r, matrix[r].length - 1),
    };
    if (keys[e.key]) {
      e.preventDefault();
      moveTo(keys[e.key]());
    } else if ((e.key === "Enter" || e.key === " ") && r > 0) {
      e.preventDefault();
      activate(document.activeElement);
    }
  });

  function activate(target) {
    if (target.matches("[role=rowheader]")) app.openTail(target.dataset.reg, target);
    else if (target.dataset.tid) app.openThread(target.dataset.tid, target);
  }

  grid.addEventListener("click", (e) => {
    const view = e.target.closest("[data-view]");
    if (view) {
      roving = view;
      return app.viewPrior(view.closest(".colhead").dataset.did, view.dataset.view);
    }
    const act = e.target.closest(".colhead__act");
    if (act) return app.openDirectiveMenu(act.closest(".colhead").dataset.did, act);
    const hist = e.target.closest(".c-hist");
    if (hist) e.preventDefault();
    const target = e.target.closest("[role=gridcell], [role=rowheader]");
    if (target && (target.dataset.tid || target.matches("[role=rowheader]"))) {
      if (roving && roving !== target) roving.setAttribute("tabindex", "-1");
      target.setAttribute("tabindex", "0");
      roving = target;
      activate(target);
    }
  });

  return {
    el, grid, render, railToggle,
    header: (did) => headers.get(did),
    cell: (key) => cells.get(key),
    countEl: (k) => counts.querySelector(`[data-count="${k}"]`),
    scrollToColumn(did) {
      if (phone()) {
        state.phoneDid = did;
        render();
      }
      headers.get(did)?.scrollIntoView({ block: "nearest", inline: "center" });
    },
  };
}

// The directive rail ------------------------------------------------------------------------------------------------

export function renderRail(nav, directives, onPick) {
  nav.replaceChildren(h("h2", { class: "rail__title" }, "Directives"));
  for (const authority of AUTHORITIES) {
    const list = directives.filter((d) => d.authority === authority);
    const ul = h("ul", { class: "rail__list" });
    for (const d of list) {
      const a = h("a", { href: `#col-${d.id}`, class: "rail__link" + (d.status === "withdrawn" ? " rail__link--withdrawn" : ""),
        "aria-label": `${dname(d)} ${d.revision}${d.status === "withdrawn" ? " withdrawn" : ""}`,
        onclick: (e) => { e.preventDefault(); onPick(d.id); } },
      h("span", { class: "rail__num" }, d.number), " ", h("span", { class: "rail__tag" }, d.revision),
      d.status === "withdrawn" ? [" ", h("span", { class: "rail__wd" }, "withdrawn")] : null);
      a.prepend(h("span", { class: "sr" }, `${authority} `));
      ul.append(h("li", {}, a));
    }
    if (!list.length) ul.append(h("li", { class: "rail__empty" }, "No directives"));
    nav.append(h("section", { class: "rail__group" }, h("h2", { class: "rail__authority" }, authority), ul));
  }
}

// The directive actions menu ----------------------------------------------------------------------------------------

export function openMenu(button, items) {
  const menu = h("div", { role: "menu", class: "menu", "aria-label": button.getAttribute("aria-label") });
  for (const item of items) {
    const el = h("button", { type: "button", role: "menuitem", class: "menu__item", tabindex: "-1" }, item.label);
    el.addEventListener("click", () => {
      close(true);
      item.run();
    });
    menu.append(el);
  }
  document.getElementById("overlays").append(menu);
  const box = (button.closest(".colhead") || button).getBoundingClientRect();
  const width = Math.max(200, menu.offsetWidth);
  menu.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.min(box.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
  button.setAttribute("aria-expanded", "true");
  const entries = () => [...menu.querySelectorAll("[role=menuitem]")];
  entries()[0]?.focus();
  menu.addEventListener("keydown", (e) => {
    const list = entries();
    const i = list.indexOf(document.activeElement);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (go !== undefined) {
      e.preventDefault();
      list[(go + list.length) % list.length].focus();
    } else if (e.key === "Tab") {
      e.preventDefault();
      close(true);
    }
  });
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== button) close(false); };
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
  let layer;
  function close(restore = true) {
    if (!layer.open) return;
    document.removeEventListener("pointerdown", outside);
    button.setAttribute("aria-expanded", "false");
    menu.remove();
    popLayer(layer, { restore });
  }
  layer = pushLayer({ el: menu, opener: button, close: () => close(true) });
}
