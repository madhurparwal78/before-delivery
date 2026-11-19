// The Hour Wall: one keyboard-walkable grid with exactly one cell per window hour, one column per local day,
// one row per local clock hour (an extra "again" row where the clocks go back).
import { h, share } from "./dom.js";
import { announce } from "./announce.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const two = (n) => String(n).padStart(2, "0");

function localParts(formatter, hourKey) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(hourKey)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export function createWall({ timeZone, onOpen, onSelection, onMessage }) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  const toggle = h("button", { type: "button", "aria-pressed": "false", text: "Select hours" });
  const status = h("div", { role: "status", "aria-label": "Wall selection", "aria-live": "polite", class: "sr-only" });
  const grid = h("div", { role: "grid", "aria-label": "Hour Wall", "aria-multiselectable": "true", class: "wall-grid" });
  const scroller = h("div", { class: "wall-scroll" }, grid);
  const el = h("section", { role: "region", "aria-label": "Hour Wall", class: "wall" },
    h("div", { class: "wall-tools" }, toggle, h("p", { class: "muted", text: "Scroll sideways for more days." })), status, scroller);

  let cells = [];
  let built = false;
  let touchMode = false;
  let anchor = null;
  let focusIdx = 0;
  let selected = new Set();
  let before = 0;
  const colCells = new Map();
  const rowCells = new Map();
  let rowOrder = [];

  const label = (cell, bucket) => {
    const consumed = bucket.quality === "Missing" ? "consumed none" : `consumed ${bucket.consumed_wh} Wh`;
    const again = cell.again ? " again" : "";
    return `${cell.date} ${two(cell.hour)}:00${again} local, ${bucket.key.slice(11, 13)}:00 UTC, ${consumed}, matched ${bucket.matched_wh} Wh, ${bucket.quality}`;
  };

  function build(buckets) {
    const seen = new Set();
    cells = buckets.map((bucket, index) => {
      const { date, hour } = localParts(formatter, bucket.key);
      const slot = `${date}|${hour}`;
      const again = seen.has(slot);
      seen.add(slot);
      return { index, key: bucket.key, date, hour, again, row: again ? `${hour}-again` : String(hour) };
    });
    const dates = [...new Set(cells.map((c) => c.date))];
    const rows = new Set(cells.map((c) => c.row));
    rowOrder = [];
    for (let hour = 0; hour < 24; hour++) {
      if (rows.has(String(hour))) rowOrder.push(String(hour));
      if (rows.has(`${hour}-again`)) rowOrder.push(`${hour}-again`);
    }
    for (const cell of cells) {
      cell.col = dates.indexOf(cell.date);
      cell.rowIndex = rowOrder.indexOf(cell.row);
      if (!colCells.has(cell.col)) colCells.set(cell.col, []);
      colCells.get(cell.col).push(cell.index);
      if (!rowCells.has(cell.row)) rowCells.set(cell.row, []);
      rowCells.get(cell.row).push(cell.index);
    }
    for (const list of colCells.values()) list.sort((a, b) => cells[a].rowIndex - cells[b].rowIndex);
    const byPosition = new Map(cells.map((c) => [`${c.col}|${c.row}`, c]));
    const header = h("div", { role: "row", class: "wall-row wall-head" }, h("div", { role: "columnheader", class: "wall-corner", text: "Hour" }),
      dates.map((date) => {
        const day = new Date(`${date}T12:00:00Z`);
        return h("div", { role: "columnheader", class: "wall-colhead", "aria-label": date, text: `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}` });
      }));
    const body = rowOrder.map((row) => h("div", { role: "row", class: "wall-row" },
      h("div", { role: "rowheader", class: "wall-rowhead", text: row.endsWith("-again") ? `${two(parseInt(row, 10))}:00 again` : `${two(parseInt(row, 10))}:00` }),
      dates.map((_, col) => {
        const cell = byPosition.get(`${col}|${row}`);
        if (!cell) return h("div", { class: "wall-empty", "aria-hidden": "true" });
        cell.el = h("div", { role: "gridcell", tabindex: "-1", class: "wall-cell", "aria-selected": "false",
          "data-bucket-key": cell.key }, h("div", { class: "wall-fill", "data-block-part": "matched" }));
        return cell.el;
      })));
    grid.replaceChildren(header, ...body);
    cells[0].el.tabIndex = 0;
    built = true;
  }

  function update(buckets) {
    if (!built) build(buckets);
    const tallest = Math.max(1, ...buckets.map((b) => b.consumed_wh + b.surplus_wh));
    buckets.forEach((bucket, i) => {
      const cell = cells[i];
      const node = cell.el;
      cell.quality = bucket.quality;
      node.setAttribute("aria-label", label(cell, bucket));
      node.dataset.matchedWh = bucket.matched_wh;
      node.dataset.consumedWh = bucket.consumed_wh;
      node.dataset.surplusWh = bucket.surplus_wh;
      node.dataset.quality = bucket.quality;
      node.firstChild.style.height = `${share(bucket.matched_wh, tallest, 100)}%`;
    });
  }

  function ensureVisible(node) {
    const s = scroller.getBoundingClientRect();
    const c = node.getBoundingClientRect();
    const rowHead = grid.querySelector(".wall-rowhead")?.getBoundingClientRect().width || 0;
    const colHead = grid.querySelector(".wall-head")?.getBoundingClientRect().height || 0;
    if (c.left < s.left + rowHead) scroller.scrollLeft -= s.left + rowHead - c.left;
    else if (c.right > s.right) scroller.scrollLeft += c.right - s.right;
    if (c.top < s.top + colHead) scroller.scrollTop -= s.top + colHead - c.top;
    else if (c.bottom > s.bottom) scroller.scrollTop += c.bottom - s.bottom;
    node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }

  function setRoving(index) {
    cells[focusIdx].el.tabIndex = -1;
    focusIdx = index;
    cells[index].el.tabIndex = 0;
  }

  function focusCell(index) {
    setRoving(index);
    cells[index].el.focus({ preventScroll: true });
    ensureVisible(cells[index].el);
  }

  function setSelection(next) {
    const changed = next.size !== selected.size || [...next].some((i) => !selected.has(i));
    for (const i of selected) if (!next.has(i)) { cells[i].el.setAttribute("aria-selected", "false"); cells[i].el.classList.remove("is-selected"); }
    for (const i of next) { cells[i].el.setAttribute("aria-selected", "true"); cells[i].el.classList.add("is-selected"); }
    selected = next;
    if (changed) {
      announce(status, next.size ? `${next.size} hours selected.` : "Selection cleared.");
      onSelection(next.size);
    }
  }

  function clearSelection() {
    anchor = null;
    if (selected.size) setSelection(new Set());
  }

  const range = (a, b) => new Set(Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i));

  function neighbour(index, key) {
    const cell = cells[index];
    const column = colCells.get(cell.col);
    const row = rowCells.get(cell.row);
    switch (key) {
      case "ArrowUp": return column[Math.max(0, column.indexOf(index) - 1)];
      case "ArrowDown": return column[Math.min(column.length - 1, column.indexOf(index) + 1)];
      case "ArrowLeft": case "PageUp": return row[Math.max(0, row.indexOf(index) - 1)];
      case "ArrowRight": case "PageDown": return row[Math.min(row.length - 1, row.indexOf(index) + 1)];
      case "Home": return row[0];
      case "End": return row[row.length - 1];
      default: return null;
    }
  }

  function moveToMissing(index, direction) {
    for (let step = 1; step <= cells.length; step++) {
      const next = (index + direction * step + cells.length * 2) % cells.length;
      if (cells[next].quality === "Missing") { focusCell(next); return; }
    }
    onMessage("No Missing hours.");
  }

  grid.addEventListener("keydown", (event) => {
    const node = event.target.closest('[role="gridcell"]');
    if (!node) return;
    const index = cells.findIndex((c) => c.el === node);
    const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
    if (key === "Enter" || key === " ") { event.preventDefault(); onOpen(cells[index].key, node); return; }
    if (key === "Escape") { clearSelection(); return; }
    if ((key === "m" || key === "M") && !ctrlKey && !altKey && !metaKey) {
      event.preventDefault();
      clearSelection();
      moveToMissing(index, key === "M" ? -1 : 1);
      return;
    }
    let target = null;
    if (ctrlKey && key === "Home") target = 0;
    else if (ctrlKey && key === "End") target = cells.length - 1;
    else if (!ctrlKey && !altKey && !metaKey) target = neighbour(index, key);
    if (target === null || target === undefined) return;
    event.preventDefault();
    if (shiftKey && key.startsWith("Arrow")) {
      if (anchor === null) anchor = index;
      focusCell(target);
      setSelection(range(anchor, target));
    } else {
      clearSelection();
      focusCell(target);
    }
  });

  grid.addEventListener("mousedown", () => { before = focusIdx; }, true);
  grid.addEventListener("focusin", (event) => {
    const node = event.target.closest('[role="gridcell"]');
    if (!node) return;
    const index = cells.findIndex((c) => c.el === node);
    if (index !== focusIdx) setRoving(index);
  });
  grid.addEventListener("click", (event) => {
    const node = event.target.closest('[role="gridcell"]');
    if (!node) return;
    const index = cells.findIndex((c) => c.el === node);
    if (touchMode || event.shiftKey) {
      if (anchor === null) anchor = touchMode ? index : before;
      setRoving(index);
      node.focus({ preventScroll: true });
      setSelection(range(anchor, index));
      return;
    }
    setRoving(index);
    onOpen(cells[index].key, node);
  });
  toggle.addEventListener("click", () => {
    touchMode = !touchMode;
    toggle.setAttribute("aria-pressed", String(touchMode));
    if (touchMode) anchor = null;
  });

  return {
    el,
    update,
    clearSelection,
    selectionKeys: () => [...selected].sort((a, b) => a - b).map((i) => cells[i].key),
    focusKey(key) { const cell = cells.find((c) => c.key === key); if (cell) focusCell(cell.index); },
    rovingCell: () => cells[focusIdx]?.el,
    cellFor: (key) => cells.find((c) => c.key === key)?.el || null,
  };
}
