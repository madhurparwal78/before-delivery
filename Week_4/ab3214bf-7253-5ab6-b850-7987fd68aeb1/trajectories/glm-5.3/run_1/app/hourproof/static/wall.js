/* The Hour Wall: one keyboard-walkable grid, one cell per window hour. */
"use strict";

async function loadGrain(state, scorePanel, grainStatus, grain) {
  highestRevisionSeen = Math.max(highestRevisionSeen, state.window.revision);
  window.__monthScore = state.window.scores.month_bp;
  try {
    const reply = await api("GET", `/api/windows/${state.window.id}/grains/${grain}`);
    if (reply.revision < highestRevisionSeen) {
      const again = await api("GET", `/api/windows/${state.window.id}/grains/${grain}`);
      applyGrainReply(again, grain, scorePanel, grainStatus, document.querySelector('[role="slider"]'));
    } else {
      applyGrainReply(reply, grain, scorePanel, grainStatus, document.querySelector('[role="slider"]'));
    }
  } catch (err) {
    if (err.status >= 500) {
      const panel = document.querySelector('[aria-label="Score panel"]');
      if (panel) panel.append(el("div", { class: "grain-failure", text: "THAT GRAIN DID NOT LOAD. MOVE AGAIN." }));
    }
  }
}

async function drawBuckets(state, listEl) {
  const reply = await api("GET", `/api/windows/${state.window.id}/grains/${state.grain}`);
  listEl.replaceChildren();
  if (state.grain === "hour") return;
  for (const bucket of reply.buckets) {
    const item = el("li", { class: "bucket" });
    const label = el("div", {
      class: "bucket-label",
      text: `${bucket.key} ${bpPct(bucket.matched_wh && bucket.consumed_wh ? Math.round(bucket.matched_wh * 10000 / bucket.consumed_wh) : 0)}%`,
    });
    const where = el("button", { text: "Where it went" });
    const worstList = el("ul", { "aria-label": `Worst of ${bucket.key}`, hidden: true });
    where.addEventListener("click", () => {
      worstList.hidden = !worstList.hidden;
    });
    for (const worst of bucket.worst || []) {
      worstList.append(el("li", { text: `${worst.key} ${fmtThousands(worst.unmatched_wh)} Wh unmatched` }));
    }
    item.append(label, where, worstList);
    listEl.append(item);
  }
}

/* --- Wall ------------------------------------------------------------------ */
let wallData = null;

async function drawWall(state) {
  const reply = await api("GET", `/api/windows/${state.window.id}/grains/hour`);
  wallData = reply;
  const region = document.querySelector('[aria-label="Hour Wall"]');
  if (!region) return;
  region.hidden = false;
  region.replaceChildren();
  const selectMode = el("button", { text: "Select hours", "aria-pressed": "false", id: nextId() });
  const selectionStatus = el("div", { role: "status", "aria-label": "Wall selection" });
  const grid = el("div", { role: "grid", "aria-label": "Hour Wall", "aria-multiselectable": "true", class: "wall-grid" });

  // one column per local day, one row per local clock hour
  const days = new Map();
  for (const bucket of reply.buckets) {
    const dayKey = bucket.key.slice(0, 10);
    if (!days.has(dayKey)) days.set(dayKey, []);
    days.get(dayKey).push(bucket);
  }
  const hourCount = new Set();
  for (const bucket of reply.buckets) hourCount.add(Number(bucket.key.slice(11, 13)));

  let touchMode = false;
  selectMode.addEventListener("click", () => {
    touchMode = !touchMode;
    selectMode.setAttribute("aria-pressed", String(touchMode));
  });

  const rows = Array.from(hourCount).sort((a, b) => a - b);
  for (const [dayKey, buckets] of days) {
    const col = el("div", { role: "columnheader", class: "wall-col", text: dayKey });
    for (const row of rows) {
      const bucket = buckets.find((b) => Number(b.key.slice(11, 13)) === row);
      if (!bucket) {
        col.append(el("div", { class: "wall-gap", role: "presentation" }));
        continue;
      }
      const cell = wallCell(state, bucket, reply);
      grid.append(cell);
      col.append(cell);
    }
    grid.append(col);
  }
  region.append(selectMode, grid, selectionStatus);
  bindWallKeys(state, grid, reply, selectionStatus, selectMode);
  restoreWallFocus(state);
  restoreWallSelection(state);
}

function wallCell(state, bucket, reply) {
  const name = cellName(state, bucket);
  const cell = el("div", {
    role: "gridcell", tabindex: "-1", "aria-label": name,
    "data-hour": bucket.key, "data-bucket-key": bucket.key,
    "data-matched-wh": bucket.matched_wh, "data-consumed-wh": bucket.consumed_wh,
    "data-surplus-wh": bucket.surplus_wh,
    class: "wall-cell", "aria-selected": "false",
  });
  const maxHour = Math.max(...reply.buckets.map((b) => (b.consumed_wh || 0) + (b.surplus_wh || 0)), 1);
  const fill = el("div", { class: "wall-fill", "data-block-part": "matched",
                           style: `height:${Math.round(bucket.matched_wh * 100 / maxHour)}%` });
  cell.append(fill);
  cell.addEventListener("click", () => {
    if (document.querySelector('[aria-label="Select hours"]')?.getAttribute("aria-pressed") === "true") return;
    focusCell(cell);
    openHourDetail(state, bucket.key, cell);
  });
  return cell;
}

function cellName(state, bucket) {
  const date = bucket.key.slice(0, 10);
  const hour = bucket.key.slice(11, 16);
  const utc = bucket.key.slice(11, 16);
  const consumed = bucket.consumed_wh === null || bucket.consumed_wh === undefined
    ? "none" : `${fmtThousands(bucket.consumed_wh)} Wh`;
  return `${date} ${hour} local, ${utc} UTC, consumed ${consumed}, matched ${fmtThousands(bucket.matched_wh)} Wh, ${bucket.quality}`;
}

function focusCell(cell) {
  const grid = cell.closest('[role="grid"]');
  for (const other of grid.querySelectorAll('[role="gridcell"]')) other.tabIndex = -1;
  cell.tabIndex = 0;
  cell.focus();
  cell.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function bindWallKeys(state, grid, reply, selectionStatus, selectMode) {
  grid.addEventListener("keydown", (event) => {
    const cells = Array.from(grid.querySelectorAll('[role="gridcell"]'));
    const index = cells.indexOf(document.activeElement);
    if (index < 0) return;
    const move = (target) => {
      event.preventDefault();
      if (target) { focusCell(cells[target]); onPlainMove(state, selectionStatus); }
    };
    const hourIndex = (i) => reply.buckets.findIndex((b) => b.key === cells[i].dataset.hour);
    switch (event.key) {
      case "ArrowRight": case "ArrowLeft": {
        const delta = event.key === "ArrowRight" ? 1 : -1;
        if (event.shiftKey) {
          const next = cells[index + delta];
          if (next) { focusCell(next); extendSelection(state, next.dataset.hour, selectionStatus); }
          event.preventDefault();
        } else move(index + delta);
        break;
      }
      case "ArrowUp": case "ArrowDown": {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (event.shiftKey) {
          const next = cells[index + delta];
          if (next) { focusCell(next); extendSelection(state, next.dataset.hour, selectionStatus); }
          event.preventDefault();
        } else move(index + delta);
        break;
      }
      case "Home": move(0); break;
      case "End": move(cells.length - 1); break;
      case "PageUp": move(Math.max(0, hourIndex(index) - 24 >= 0 ? cells.findIndex((c) => c.dataset.hour === reply.buckets[Math.max(0, hourIndex(index) - 24)].key) : 0)); break;
      case "PageDown": {
        const target = Math.min(reply.buckets.length - 1, hourIndex(index) + 24);
        const cell = cells.find((c) => c.dataset.hour === reply.buckets[target].key);
        move(cells.indexOf(cell));
        break;
      }
      case "Enter": case " ": {
        event.preventDefault();
        openHourDetail(state, cells[index].dataset.hour, cells[index]);
        break;
      }
      case "m": {
        event.preventDefault();
        const missing = cells.filter((c) => c.getAttribute("aria-label").endsWith("Missing"));
        if (!missing.length) { announceStatus(`No Missing hours.`); return; }
        const currentPos = missing.indexOf(document.activeElement);
        const nextPos = (currentPos + 1) % missing.length;
        focusCell(missing[nextPos]);
        break;
      }
      case "M": {
        event.preventDefault();
        const missing = cells.filter((c) => c.getAttribute("aria-label").endsWith("Missing"));
        if (!missing.length) { announceStatus(`No Missing hours.`); return; }
        const currentPos = missing.indexOf(document.activeElement);
        const nextPos = (currentPos - 1 + missing.length) % missing.length;
        focusCell(missing[nextPos]);
        break;
      }
      case "Escape": clearSelection(state, selectionStatus); break;
    }
    if (event.shiftKey && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  });
  // Shift+click extends the selection
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest('[role="gridcell"]');
    if (!cell || !event.shiftKey) return;
    if (selectMode.getAttribute("aria-pressed") === "true") return;
    event.preventDefault();
    extendSelection(state, cell.dataset.hour, selectionStatus);
  });
}

function announceStatus(text) {
  const region = document.querySelector('[role="status"][aria-label="Desk status"]');
  if (region) region.replaceChildren(document.createTextNode(text));
}

function onPlainMove(state, selectionStatus) {
  if (state.selection.size) clearSelection(state, selectionStatus);
}

function extendSelection(state, hourKey, selectionStatus) {
  if (!state.anchor) state.anchor = hourKey;
  const keys = wallData.buckets.map((b) => b.key);
  const a = keys.indexOf(state.anchor);
  const b = keys.indexOf(hourKey);
  if (a < 0 || b < 0) return;
  const [start, end] = a < b ? [a, b] : [b, a];
  state.selection = new Set(keys.slice(start, end + 1));
  const grid = document.querySelector('[aria-label="Hour Wall"] [role="grid"]');
  for (const cell of grid.querySelectorAll('[role="gridcell"]')) {
    const selected = state.selection.has(cell.dataset.hour);
    cell.setAttribute("aria-selected", String(selected));
    cell.classList.toggle("selected", selected);
  }
  announce(selectionStatus, `${state.selection.size} hours selected.`);
  updateSpreadButton(state);
}

function clearSelection(state, selectionStatus) {
  const had = state.selection.size > 0;
  state.selection = new Set();
  state.anchor = null;
  const grid = document.querySelector('[aria-label="Hour Wall"] [role="grid"]');
  if (grid) for (const cell of grid.querySelectorAll('[role="gridcell"]')) {
    cell.setAttribute("aria-selected", "false");
    cell.classList.remove("selected");
  }
  if (had) announce(selectionStatus, "Selection cleared.");
  updateSpreadButton(state);
}

function updateSpreadButton(state) {
  const btn = document.querySelector('button[data-action="Spread a total"], .window-actions button');
  if (!btn) return;
}

function restoreWallFocus(state) {
  if (state.wallFocus) {
    const cell = document.querySelector(`[data-hour="${state.wallFocus}"]`);
    if (cell) focusCell(cell);
  } else {
    const first = document.querySelector('[role="gridcell"]');
    if (first) { first.tabIndex = 0; }
  }
}

function restoreWallSelection(state) {
  if (!state.selection.size) return;
  const grid = document.querySelector('[aria-label="Hour Wall"] [role="grid"]');
  for (const cell of grid.querySelectorAll('[role="gridcell"]')) {
    const selected = state.selection.has(cell.dataset.hour);
    cell.setAttribute("aria-selected", String(selected));
    cell.classList.toggle("selected", selected);
  }
}
