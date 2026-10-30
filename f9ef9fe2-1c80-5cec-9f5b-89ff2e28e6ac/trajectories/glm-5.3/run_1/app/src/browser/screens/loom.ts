import { api, ApiError } from "../api";
import { el, icon, countTo, fmtHours, fmtMoney, prefersReducedMotion, wallTime } from "../ui";
import { state, actionPaused } from "../main";
import { openDialog } from "../ui";
import type { Booking, Invoice } from "./bookings";

interface LoomCell {
  station_id: string;
  start: string;
  state: "held" | "booked" | "taken";
  business?: string;
  hold_id?: string;
  booking_id?: string;
  expires_at?: string;
}

interface QuoteLine {
  station_id: string;
  station: string;
  tier: number;
  paid_by: "cash" | "pack";
  quarters: number;
  hours: string;
  hourly_rate_cents: number;
  amount_cents: number;
}

interface Quote {
  month: string;
  month_hours_before: string;
  rate_card_id: string;
  lines: QuoteLine[];
  tier_steps_crossed: number[];
  pack_quarters: number;
  quarters: number;
  hours: string;
  total_cents: number;
  total: string;
}

interface Hold {
  id: string;
  member_id: string;
  date: string;
  state: string;
  cells: Array<{ station_id: string; start: string }>;
  expires_at: string;
  expires_local: string;
  server_now: string;
  quote?: Quote;
}

const QUARTERS = 80;
const FIRST_MINUTE = 4 * 60;

function timeOfQuarter(q: number): string {
  const minutes = FIRST_MINUTE + q * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function quarterOf(time: string): number {
  const minutes = Number.parseInt(time.slice(0, 2), 10) * 60 + Number.parseInt(time.slice(3, 5), 10);
  return (minutes - FIRST_MINUTE) / 15;
}

function timeOrEnd(value: string): number {
  if (value === "24:00") {
    return QUARTERS;
  }
  return quarterOf(value);
}

function parseSel(sel: string, stations: Array<{ id: string }>): { top: number; bottom: number; start: number; end: number } | null {
  const match = /^(.+?)\.\.(.+?)@([0-2]\d:[0-5]\d|24:00)-([0-2]\d:[0-5]\d|24:00)$/.exec(sel);
  if (!match) {
    return null;
  }
  const topId = match[1]!;
  const bottomId = match[2]!;
  const start = quarterOf(match[3]!);
  const end = timeOrEnd(match[4]!);
  const top = stations.findIndex((station) => station.id === topId);
  const bottom = stations.findIndex((station) => station.id === bottomId);
  if (top < 0 || bottom < 0 || start < 0 || start >= QUARTERS || end <= start || end > QUARTERS) {
    return null;
  }
  return { top: Math.min(top, bottom), bottom: Math.max(top, bottom), start, end };
}

export function renderLoom(container: HTMLElement): void {
  const kitchen = state.kitchen!;
  const isOperator = state.user!.role === "operator";
  const kitchenId = kitchen.id;

  let date = kitchen.today;
  let stationFilter: string[] | null = null;
  let brush: { top: number; bottom: number; start: number; end: number } | null = null;
  let holdId: string | null = null;
  let holdExpiresAt: number | null = null;
  let holdKey = "";
  let usePack = false;
  let packQuarters = 0;
  let members: Array<{ id: string; business: string; contact_email: string }> = [];
  let actorMemberId = state.user!.member_id;
  let actorEmail = state.user!.email;
  let serverOffset = 0;
  let occupied = new Map<string, LoomCell>();
  let covered = true;
  let brushAnchor: { row: number; q: number } | null = null;

  // ---------- restore address ----------

  const params = new URLSearchParams(window.location.search);
  if (params.get("date") && /^\d{4}-\d{2}-\d{2}$/.test(params.get("date")!)) {
    date = params.get("date")!;
  }
  const stationsParam = params.get("stations");
  if (stationsParam) {
    const ids = stationsParam.split(",").filter((id) => kitchen.stations.some((station) => station.id === id));
    if (ids.length > 0 && ids.length < kitchen.stations.length) {
      stationFilter = ids;
    }
  }
  const holdParam = params.get("hold");
  const selParam = params.get("sel");
  if (selParam) {
    const restoredSel = parseSel(selParam, kitchen.stations);
    if (restoredSel) {
      const visibleIds = new Set(visibleStations().map((station) => station.id));
      if (restoredSel.top !== restoredSel.bottom || visibleStations().length === kitchen.stations.length) {
        brush = restoredSel;
        brushAnchor = { row: restoredSel.top, q: restoredSel.start };
      }
      void visibleIds;
    }
  }

  function visibleStations(): typeof kitchen.stations {
    if (!stationFilter) {
      return kitchen.stations;
    }
    return kitchen.stations.filter((station) => stationFilter!.includes(station.id));
  }

  function updateAddress(): void {
    const search = new URLSearchParams();
    search.set("date", date);
    if (stationFilter && stationFilter.length > 0 && stationFilter.length < kitchen.stations.length) {
      search.set("stations", stationFilter.join(","));
    }
    if (holdId) {
      search.set("hold", holdId);
    } else if (brush) {
      const rows = visibleStations();
      const top = rows[brush.top]?.id ?? "";
      const bottom = rows[brush.bottom]?.id ?? "";
      search.set("sel", `${top}..${bottom}@${timeOfQuarter(brush.start)}-${timeOfQuarter(brush.end)}`);
    }
    window.history.replaceState({}, "", `/loom?${search.toString()}`);
  }

  // ---------- header ----------

  const screen = el("div", { class: "loom-screen" });
  const header = el("div", { class: "loom-top" });
  const dateField = el("label", { for: "loom-date" });
  dateField.textContent = "Kitchen date";
  const dateInput = el("input", { id: "loom-date", type: "date", value: date });
  dateInput.setAttribute("aria-label", "Kitchen date");
  dateInput.addEventListener("change", () => {
    if (dateInput.value) {
      date = dateInput.value;
      clearBrush(false);
      void reloadCells();
    }
  });
  const prevDay = el("button", { class: "btn", onclick: () => shiftDate(-1), "aria-label": "Previous day", text: "\u2039" });
  const todayBtn = el("button", { class: "btn", onclick: () => {
    date = kitchen.today;
    dateInput.value = date;
    clearBrush(false);
    void reloadCells();
  } });
  todayBtn.textContent = "Today";
  const nextDay = el("button", { class: "btn", onclick: () => shiftDate(1) });
  nextDay.textContent = "\u203a";
  nextDay.setAttribute("aria-label", "Next day");
  const stationsBtn = el("button", { class: "btn", onclick: () => openStationsDialog() });
  stationsBtn.textContent = "Stations";
  const headerMeta = el("span", { class: "kitchen-name", text: `${date} · Kitchen time · ${kitchen.timezone}` });

  function shiftDate(days: number): void {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    date = d.toISOString().slice(0, 10);
    dateInput.value = date;
    clearBrush(false);
    void reloadCells();
  }

  let memberSelect: HTMLSelectElement | null = null;
  if (isOperator) {
    memberSelect = el("select", { id: "loom-member" });
    memberSelect.setAttribute("aria-label", "Book for member");
    memberSelect.addEventListener("change", () => {
      const member = members.find((entry) => entry.id === memberSelect!.value);
      if (member) {
        actorMemberId = member.id;
        actorEmail = member.contact_email;
      }
      void reloadCells();
      void refreshPack();
    });
  }

  header.append(prevDay, todayBtn, nextDay, dateField, dateInput, stationsBtn);
  if (memberSelect) {
    header.append(memberSelect);
  }
  const spacer = el("span", { class: "spacer" });
  header.append(spacer, headerMeta);

  // ---------- floor plan ----------

  const floorGroup = el("div", { class: "floorband", role: "group", "aria-label": "Kitchen floor plan" });
  const stationImgs = new Map<string, SVGElement>();

  function drawFloorPlan(): void {
    const stations = visibleStations();
    const n = stations.length;
    stationImgs.clear();
    if (n === 0) {
      floorGroup.replaceChildren();
      return;
    }
    const leftCount = Math.ceil(n / 3);
    const rightCount = Math.ceil((n - leftCount) / 2);
    const bottomCount = n - leftCount - rightCount;
    const width = 1000;
    const height = 80 + Math.max(leftCount, rightCount) * 74;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    const place = (station: (typeof stations)[number], x: number, y: number): void => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      g.setAttribute("x", String(x - 70));
      g.setAttribute("y", String(y - 30));
      g.setAttribute("width", "180");
      g.setAttribute("height", "76");
      g.setAttribute("viewBox", "0 0 180 76");
      g.setAttribute("role", "img");
      g.setAttribute("aria-label", station.name);
      g.setAttribute("fill", "none");
      g.setAttribute("stroke-width", "1.5");
      g.classList.add("station-shape");
      drawStationShape(g, station);
      const name = document.createElementNS("http://www.w3.org/2000/svg", "text");
      name.setAttribute("x", "90");
      name.setAttribute("y", "72");
      name.setAttribute("text-anchor", "middle");
      name.setAttribute("font-size", "10");
      name.setAttribute("letter-spacing", "0.12em");
      name.setAttribute("fill", "currentColor");
      name.setAttribute("style", "text-transform:uppercase;font-family:Inter,sans-serif");
      name.textContent = station.name;
      g.append(name);
      svg.append(g);
      stationImgs.set(station.id, g);
    };
    for (let i = 0; i < leftCount; i++) {
      place(stations[i]!, 130, 44 + i * 74);
    }
    for (let i = 0; i < bottomCount; i++) {
      place(stations[leftCount + i]!, 370 + i * 200, height - 44);
    }
    for (let i = 0; i < rightCount; i++) {
      place(stations[leftCount + bottomCount + i]!, width - 130, height - 44 - i * 74);
    }
    floorGroup.replaceChildren(svg);
  }

  function drawStationShape(g: SVGElement, station: { kind: string }): void {
    const stroke = "var(--steel-2)";
    g.setAttribute("stroke", stroke);
    const path = (data: string): SVGPathElement => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", data);
      return p;
    };
    const circle = (cx: number, cy: number, r: number): SVGCircleElement => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", String(r));
      return c;
    };
    const rect = (x: number, y: number, w: number, h: number): SVGRectElement => {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(w));
      r.setAttribute("height", String(h));
      return r;
    };
    switch (station.kind) {
      case "oven":
        g.append(rect(60, 8, 60, 44));
        g.append(path("M 82 52 v 8 M 98 52 v 8"));
        break;
      case "mixer":
      case "kettle":
        g.append(circle(90, 30, 22));
        break;
      case "chiller":
      case "cooler":
        g.append(rect(58, 8, 52, 44));
        g.append(path("M 110 30 a 14 14 0 0 0 -14 -14"));
        break;
      case "range":
        g.append(rect(52, 18, 76, 28));
        g.append(circle(70, 32, 5), circle(88, 32, 5), circle(106, 32, 5), circle(124, 32, 5));
        break;
      case "prep":
      default:
        g.append(rect(40, 26, 100, 12));
        break;
    }
  }

  // ---------- grid ----------

  const loomFrame = el("div", { class: "loom-frame" });
  const loomInner = el("div", { class: "loom-inner" });
  const grid = el("table", { class: "loom", role: "grid", "aria-label": "Station loom", tabindex: "0" });
  loomInner.append(grid);
  loomFrame.append(loomInner);
  const cellEls = new Map<string, HTMLTableCellElement>();
  let focusCell: { row: number; q: number } = { row: 0, q: 0 };

  function buildGrid(): void {
    cellEls.clear();
    grid.replaceChildren();
    const headRow = el("tr");
    const corner = el("th", { class: "corner" });
    headRow.append(corner);
    for (let q = 0; q < QUARTERS; q++) {
      const time = timeOfQuarter(q);
      const th = el("th", { class: "timehead", role: "columnheader", "aria-label": time });
      if (q % 4 === 0) {
        th.textContent = time;
      }
      headRow.append(th);
    }
    const thead = el("thead");
    thead.append(headRow);
    grid.append(thead);
    const tbody = el("tbody");
    for (const station of visibleStations()) {
      const row = el("tr", { role: "row" });
      const rowhead = el("th", { class: "rowhead", role: "rowheader", "aria-label": station.name });
      rowhead.textContent = station.name;
      row.append(rowhead);
      for (let q = 0; q < QUARTERS; q++) {
        const time = timeOfQuarter(q);
        const td = el("td", {
          class: "cell free",
          role: "gridcell",
          "aria-label": `${station.name}, ${time}, free`,
          "data-station": station.id,
          "data-q": String(q),
        });
        cellEls.set(cellKey(station.id, q), td);
        row.append(td);
      }
      tbody.append(row);
    }
    grid.append(tbody);

    // pointer brushing
    let painting = false;
    let anchor: { row: number; q: number } | null = null;
    const cellAt = (target: EventTarget | null): { row: number; q: number } | null => {
      const td = target instanceof Element && target.closest("td.cell") ? (target.closest("td.cell") as HTMLTableCellElement) : null;
      if (!td) {
        return null;
      }
      const stationId = td.getAttribute("data-station")!;
      const q = Number.parseInt(td.getAttribute("data-q")!, 10);
      const row = visibleStations().findIndex((entry) => entry.id === stationId);
      return row >= 0 ? { row, q } : null;
    };
    grid.addEventListener("pointerdown", (event) => {
      const cell = cellAt(event.target);
      if (!cell) {
        return;
      }
      if ((event as PointerEvent).pointerType === "touch") {
        return; // touch uses taps; drags scroll
      }
      event.preventDefault();
      painting = true;
      anchor = cell;
      setBrushFrom(anchor, cell);
      focusCell = cell;
      grid.focus();
    });
    grid.addEventListener("pointermove", (event) => {
      const cell = cellAt(event.target);
      if (cell && (event as PointerEvent).pointerType !== "touch") {
        setHover(cell);
      }
      if (!painting || !anchor || !cell) {
        return;
      }
      setBrushFrom(anchor, cell);
    });
    const endPaint = (): void => {
      if (!painting) {
        return;
      }
      painting = false;
      void placeHold();
      void 0;
    };
    grid.addEventListener("pointerup", endPaint);
    grid.addEventListener("pointercancel", () => {
      painting = false;
    });
    grid.addEventListener("pointerleave", () => {
      setHover(null);
    });
    grid.addEventListener("click", (event) => {
      const cell = cellAt(event.target);
      if (!cell) {
        return;
      }
      if (window.matchMedia("(pointer: coarse)").matches) {
        touchTap(cell);
        return;
      }
    });
    grid.addEventListener("keydown", (event) => {
      onGridKey(event);
    });
  }

  function touchTap(cell: { row: number; q: number }): void {
    if (!brush) {
      brushAnchor = cell;
      setBrushFrom(cell, cell);
      focusCell = cell;
      grid.focus();
      return;
    }
    const anchor = brushAnchor ?? { row: brush.top, q: brush.start };
    setBrushFrom(anchor, cell);
    focusCell = cell;
    grid.focus();
  }

  function cellKey(stationId: string, q: number): string {
    return `${stationId}|${q}`;
  }

  function setBrushFrom(a: { row: number; q: number }, b: { row: number; q: number }): void {
    const top = Math.min(a.row, b.row);
    const bottom = Math.max(a.row, b.row);
    const start = Math.min(a.q, b.q);
    const end = Math.max(a.q, b.q) + 1;
    if (brush && brush.top === top && brush.bottom === bottom && brush.start === start && brush.end === end) {
      return;
    }
    brush = { top, bottom, start, end };
    void refreshCellStates();
    updateAddress();
    scheduleQuote();
  }

  function setHover(cell: { row: number; q: number } | null): void {
    for (const element of grid.querySelectorAll("td.hovered")) {
      element.classList.remove("hovered");
    }
    grid.querySelectorAll("th.timehead.bright, th.rowhead.bright").forEach((element) => element.classList.remove("bright"));
    if (!cell) {
      return;
    }
    const station = visibleStations()[cell.row];
    if (!station) {
      return;
    }
    cellEls.get(cellKey(station.id, cell.q))?.classList.add("hovered");
    const rowhead = grid.querySelectorAll("th.rowhead")[cell.row];
    rowhead?.classList.add("bright");
    const timehead = grid.querySelectorAll("th.timehead")[cell.q];
    timehead?.classList.add("bright");
  }

  function clearBrush(refresh = true): void {
    brush = null;
    brushAnchor = null;
    if (refresh) {
      refreshCellStates();
    }
    updateAddress();
    if (!holdId) {
      resetQuote();
    }
  }

  function onGridKey(event: Event): void {
    const keyboard = event as KeyboardEvent;
    const rows = visibleStations().length;
    if (keyboard.key === "Enter") {
      keyboard.preventDefault();
      void placeHold();
      return;
    }
    if (keyboard.key === "Escape" && brush && !holdId) {
      keyboard.preventDefault();
      clearBrush();
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const move = moves[keyboard.key];
    if (move) {
      keyboard.preventDefault();
      const [dr, dq] = move;
      const prior = { ...focusCell };
      focusCell = {
        row: Math.max(0, Math.min(rows - 1, prior.row + dr)),
        q: Math.max(0, Math.min(QUARTERS - 1, prior.q + dq)),
      };
      if (keyboard.shiftKey && !holdId) {
        const anchor = brushAnchor ?? prior;
        brushAnchor = anchor;
        setBrushFrom(anchor, focusCell);
      } else {
        setHover(focusCell);
        void focusVisibleCell();
      }
      return;
    }
    if (keyboard.key === "Home" || keyboard.key === "End") {
      keyboard.preventDefault();
      focusCell = { row: focusCell.row, q: keyboard.key === "Home" ? 0 : QUARTERS - 1 };
      void focusVisibleCell();
    }
  }

  async function focusVisibleCell(): Promise<void> {
    const station = visibleStations()[focusCell.row];
    if (!station) {
      return;
    }
    cellEls.get(cellKey(station.id, focusCell.q))?.focus();
  }

  // ---------- cell states ----------

  function refreshCellStates(): void {
    const rows = visibleStations();
    const brushCells = new Set<string>();
    if (brush) {
      for (let r = brush.top; r <= brush.bottom; r++) {
        const station = rows[r];
        if (!station) {
          continue;
        }
        for (let q = brush.start; q < brush.end; q++) {
          brushCells.add(cellKey(station.id, q));
        }
      }
    }
    const litRows = new Set<number>();
    for (const [rowIndex, station] of rows.entries()) {
      let run: { startQ: number; label: string } | null = null;
      let prevLabel: string | null = null;
      let runStartQ = -1;
      let rowLit = false;
      for (let q = 0; q < QUARTERS; q++) {
        const key = cellKey(station.id, q);
        const td = cellEls.get(key);
        if (!td) {
          continue;
        }
        const time = timeOfQuarter(q);
        td.querySelectorAll(".runlabel").forEach((child) => child.remove());
        td.querySelectorAll(".countdown").forEach((child) => child.remove());
        td.querySelectorAll(".icon").forEach((child) => child.remove());
        const serverCell = occupied.get(key);
        let cssState = "free";
        let label = "free";
        let iconName: string | null = null;
        if (serverCell) {
          if (serverCell.state === "held") {
            const own = holdId !== null && serverCell.hold_id === holdId;
            if (own || isOperator) {
              cssState = "held";
              label = isOperator ? `held by ${serverCell.business ?? ""}` : "held";
              iconName = "clock";
            } else {
              cssState = "taken";
              label = "taken";
              iconName = "lock";
            }
          } else if (serverCell.state === "booked") {
            const own = serverCell.booking_id !== undefined && ownBookingIds.has(serverCell.booking_id);
            if (own || isOperator) {
              cssState = "booked";
              label = isOperator ? `booked by ${serverCell.business ?? ""}` : "booked";
              iconName = "check";
            } else {
              cssState = "taken";
              label = "taken";
              iconName = "lock";
            }
          } else {
            cssState = "taken";
            label = "taken";
            iconName = "lock";
          }
        }
        if (brushCells.has(key)) {
          if (cssState === "free" && !covered) {
            cssState = "papers";
            label = "papers";
            iconName = "warning-file-real";
          } else if (cssState === "free") {
            cssState = "selected";
            label = "selected";
            iconName = "paintbrush";
          } else if (cssState !== "papers") {
            cssState = "conflict";
            label = "taken conflicts with your brush";
            iconName = "cross";
          }
          rowLit = true;
        } else if (cssState === "free" && !covered) {
          cssState = "papers";
          label = "papers";
          iconName = "warning-file-real";
        }
        td.className = `cell ${cssState}`;
        td.setAttribute("data-label", label);
        td.setAttribute("aria-label", `${station.name}, ${time}, ${label}`);
        if (iconName) {
          const iconEl = el("span", { class: "icon" });
          iconEl.append(icon(iconName));
          td.append(iconEl);
        }
        if (label !== prevLabel) {
          if (run && runStartQ >= 0 && q - 1 - runStartQ >= 1 && prevLabel) {
            const runTd = cellEls.get(cellKey(station.id, runStartQ));
            if (runTd) {
              const runLabel = el("span", { class: "runlabel", "aria-hidden": "true" });
              runLabel.textContent = prevLabel.toUpperCase();
              runTd.append(runLabel);
            }
          }
          run = { startQ: q, label };
          runStartQ = q;
          prevLabel = label;
        }
        void run;
      }
      if (run && runStartQ >= 0 && QUARTERS - 1 - runStartQ >= 1 && prevLabel) {
        const runTd = cellEls.get(cellKey(station.id, runStartQ));
        if (runTd) {
          const runLabel = el("span", { class: "runlabel", "aria-hidden": "true" });
          runLabel.textContent = prevLabel.toUpperCase();
          runTd.append(runLabel);
        }
      }
      if (rowLit) {
        litRows.add(rowIndex);
      }
    }
    applyFloorLighting(litRows);
  }

  const ownBookingIds = new Set<string>();
  let litRowsCurrent: number[] = [];

  function applyFloorLighting(lit: Set<number>): void {
    const next = [...lit];
    const previous = litRowsCurrent;
    const added = next.filter((row) => !previous.includes(row));
    const removed = previous.filter((row) => !next.includes(row));
    litRowsCurrent = next;
    const rows = visibleStations();
    const light = (row: number, on: boolean): void => {
      const station = rows[row];
      if (!station) {
        return;
      }
      const shape = stationImgs.get(station.id);
      if (!shape) {
        return;
      }
      shape.classList.toggle("lit", on);
      shape.setAttribute("aria-label", on ? `${station.name}, lit` : station.name);
    };
    if (prefersReducedMotion()) {
      for (const row of added) {
        light(row, true);
      }
      for (const row of removed) {
        light(row, false);
      }
      return;
    }
    added.forEach((row, index) => {
      setTimeout(() => light(row, true), 40 * index);
    });
    removed
      .slice()
      .reverse()
      .forEach((row, index) => {
        setTimeout(() => {
          if (!litRowsCurrent.includes(row)) {
            light(row, false);
          }
        }, 40 * index);
      });
  }

  // ---------- quote ----------

  const quoteRegion = el("div", { role: "complementary", "aria-label": "Quote", class: "rail" });
  const totalGroup = el("div", { role: "group", "aria-label": "Quote total" });
  const totalEl = el("div", { class: "total", text: "$0.00" });
  const hoursLine = el("div", { class: "hours-line", text: "0.00 hours" });
  const pricingNote = el("div", { class: "pricing-note" });
  totalGroup.append(totalEl, hoursLine, pricingNote);
  const linesList = el("ul", { class: "quote-lines", role: "list", "aria-label": "Quote lines" });
  const announce = el("div", { role: "status", "aria-label": "Quote announcement", class: "status-line" });
  const packCheckLabel = el("label", { class: "packcheck", for: "use-pack" });
  const packCheck = el("input", { id: "use-pack", type: "checkbox" });
  packCheck.addEventListener("change", () => {
    usePack = packCheck.checked;
    scheduleQuote(true);
  });
  packCheckLabel.append(packCheck);
  const packText = el("span");
  packCheckLabel.append(packText);
  const placeHoldBtn = el("button", { class: "btn primary", onclick: () => void placeHold() });
  placeHoldBtn.textContent = "Place hold";
  const clearBrushBtn = el("button", { class: "btn", onclick: () => clearBrush() });
  clearBrushBtn.textContent = "Clear brush";
  const confirmBtn = el("button", { class: "btn primary", onclick: () => openConfirmDialog() });
  confirmBtn.textContent = "Confirm booking";
  const releaseBtn = el("button", { class: "btn", onclick: () => void releaseHold() });
  releaseBtn.textContent = "Release hold";
  const repeatBtn = el("button", { class: "btn", onclick: () => void openRepeatDialog() });
  repeatBtn.textContent = "Repeat weekly";
  repeatBtn.title = "Repeat weekly needs one unbroken block.";
  const holdBar = el("div", { role: "progressbar", "aria-label": "Hold time left", "aria-valuemin": "0", "aria-valuemax": String(kitchen.hold_seconds), "aria-valuenow": "0", class: "bar-track" });
  const holdFill = el("div", { class: "bar-fill", style: "width:100%" });
  holdBar.append(holdFill);
  const heldUntil = el("span", { class: "helduntil" });
  const holdLine = el("div", { class: "hold-line" });
  holdLine.append(holdBar, heldUntil);
  const railControls = el("div", { class: "rail-controls" });
  railControls.append(packCheckLabel);
  const actionButtons = el("div", { class: "row" });
  railControls.append(actionButtons);
  quoteRegion.append(totalGroup, linesList, announce, railControls, holdLine);

  let currentQuote: Quote | null = null;
  let quoteTimer: ReturnType<typeof setTimeout> | null = null;
  let quoteSequence = 0;
  let lastTotal = 0;

  function resetQuote(): void {
    currentQuote = null;
    lastTotal = 0;
    totalEl.textContent = "$0.00";
    hoursLine.textContent = "0.00 hours";
    linesList.replaceChildren();
    pricingNote.replaceChildren();
    announce.replaceChildren();
  }

  function brushCells(): Array<{ station_id: string; start: string }> {
    if (!brush) {
      return [];
    }
    const rows = visibleStations();
    const cells: Array<{ station_id: string; start: string }> = [];
    for (let r = brush.top; r <= brush.bottom; r++) {
      const station = rows[r];
      if (!station) {
        continue;
      }
      for (let q = brush.start; q < brush.end; q++) {
        cells.push({ station_id: station.id, start: timeOfQuarter(q) });
      }
    }
    return cells;
  }

  function scheduleQuote(immediate = false): void {
    if (quoteTimer) {
      clearTimeout(quoteTimer);
    }
    if (!brush) {
      resetQuote();
      return;
    }
    if (immediate) {
      void requestQuote();
      return;
    }
    quoteTimer = setTimeout(() => {
      void requestQuote();
    }, 120);
  }

  async function requestQuote(): Promise<void> {
    if (!brush) {
      return;
    }
    const cells = brushCells();
    if (cells.length === 0) {
      return;
    }
    const seq = ++quoteSequence;
    pricingNote.textContent = "Pricing…";
    try {
      const body = await api<{ quote: Quote; taken: Array<{ station_id: string; start: string }>; papers: Array<{ station_id: string; start: string }> }>("POST", "/quotes", {
        date,
        cells,
        use_pack: usePack,
        ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
      });
      if (seq !== quoteSequence) {
        return;
      }
      const quote = body.quote;
      currentQuote = quote;
      if (body.taken.length > 0 || body.papers.length > 0) {
        refreshCellStates();
      }
      renderQuote(quote);
      if (!covered) {
        setLoomStatus(papersCopy());
      }
    } catch (error) {
      if (seq !== quoteSequence) {
        return;
      }
      pricingNote.textContent = "Pricing unavailable. Try again.";
    }
  }

  function renderQuote(quote: Quote): void {
    const from = lastTotal;
    const stop = countTo(from, quote.total_cents, (cents) => {
      totalEl.textContent = fmtMoney(cents);
    });
    void stop;
    lastTotal = quote.total_cents;
    hoursLine.textContent = `${quote.hours} hours`;
    linesList.replaceChildren();
    for (const line of quote.lines) {
      const item = el("li");
      const labelEl = el("span", { text: `${line.station} · tier ${line.tier} · ${line.hours} h` });
      const amountEl = el("span", { class: "amt", text: line.paid_by === "pack" ? "pack" : fmtMoney(line.amount_cents) });
      item.append(labelEl, amountEl);
      linesList.append(item);
    }
    pricingNote.replaceChildren();
    announce.replaceChildren();
    const parts = [`Total ${quote.total} for ${quote.hours} hours.`];
    for (const tier of quote.tier_steps_crossed) {
      parts.push(` Crosses into tier ${tier}.`);
    }
    announce.textContent = parts.join("");
  }

  // ---------- loom status ----------

  const loomStatus = el("div", { class: "loom-status", role: "status", "aria-label": "Loom status" });

  function setLoomStatus(html: string): void {
    loomStatus.replaceChildren();
    loomStatus.append(html);
  }

  function papersCopy(): string {
    if (isOperator) {
      const business = members.find((member) => member.id === actorMemberId)?.business ?? actorMemberId ?? "";
      return `${business}'s papers do not cover ${date}.`;
    }
    return `Your papers do not cover ${date}. Upload a current insurance certificate and food-handler card to book this day.`;
  }

  // ---------- legend ----------

  const legend = el("div", { class: "legend", role: "list", "aria-label": "Loom legend" });
  const legendEntries: Array<[string, string, string]> = [
    ["selected", "Selected", "paintbrush"],
    ["held", "Held", "clock"],
    ["booked", "Booked", "check"],
    ["taken", "Taken", "lock"],
    ["conflict", "Conflict", "cross"],
    ["papers", "Papers", "warning-file-real"],
  ];
  for (const [kind, label, iconName] of legendEntries) {
    const item = el("div", { class: "item", role: "listitem" });
    item.append(el("span", { class: `swatch ${kind}` }), icon(iconName));
    item.append(label);
    legend.append(item);
  }

  // ---------- data loading ----------

  async function reloadCells(): Promise<void> {
    const memberParam = isOperator && actorMemberId ? `&member_id=${actorMemberId}` : "";
    const body = await api<{
      date: string;
      today: string;
      server_now: string;
      covered_until: string | null;
      papers: boolean;
      cells: LoomCell[];
    }>(`GET`, `/kitchens/${kitchenId}/loom?date=${date}${memberParam}`);
    serverOffset = Date.now() - Date.parse(body.server_now);
    covered = body.covered_until !== null && date <= body.covered_until;
    occupied = new Map();
    ownBookingIds.clear();
    for (const cell of body.cells) {
      const q = quarterOf(cell.start);
      occupied.set(cellKey(cell.station_id, q), cell);
      if (cell.booking_id && !isOperator && cell.state === "booked") {
        ownBookingIds.add(cell.booking_id);
      }
    }
    headerMeta.textContent = `${date} · Kitchen time · ${kitchen.timezone}`;
    refreshCellStates();
    if (brush) {
      scheduleQuote(true);
    }
    if (!covered) {
      setLoomStatus(papersCopy());
    }
  }

  async function refreshPack(): Promise<void> {
    if (!actorMemberId) {
      return;
    }
    try {
      const pack = await api<{ balance_quarters: number; balance_hours: string }>("GET", `/members/${actorMemberId}/pack`);
      packQuarters = pack.balance_quarters;
    } catch {
      packQuarters = 0;
    }
    packText.textContent = `Use pack hours (${fmtHours(packQuarters)} h left)`;
  }

  // ---------- hold ----------

  function freeBrushCells(): Array<{ station_id: string; start: string }> {
    return brushCells().filter((cell) => {
      const key = cellKey(cell.station_id, quarterOf(cell.start));
      return !occupied.has(key);
    });
  }

  async function placeHold(): Promise<void> {
    if (!brush) {
      return;
    }
    const cells = freeBrushCells();
    if (cells.length === 0) {
      setLoomStatus("Nothing free to hold in that brush.");
      return;
    }
    if (!covered) {
      setLoomStatus(papersCopy());
      return;
    }
    if (holdId) {
      await releaseHold(true);
    }
    placeHoldBtn.disabled = true;
    setLoomStatus("Placing hold…");
    try {
      const body = await api<{ hold: Hold; taken: Array<{ station_id: string; start: string }> }>("POST", "/holds", {
        date,
        cells,
        ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
      });
      holdId = body.hold.id;
      holdKey = `confirm-${body.hold.id}`;
      holdExpiresAt = Date.parse(body.hold.expires_at);
      setLoomStatus(holdCopy(body.hold, body.taken.length));
      brush = null;
      brushAnchor = null;
      if (body.hold.quote) {
        currentQuote = body.hold.quote;
        renderQuote(body.hold.quote);
      }
      await reloadCells();
      updateAddress();
      updateRailButtons();
      startCountdown();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "cells_taken") {
          setLoomStatus("Those cells were just taken. Nothing was held.");
        } else if (error.code === "same_day_closed") {
          setLoomStatus(`Same-day booking closed at ${kitchen.same_day_cutoff} kitchen time.`);
        } else if (error.code === "cell_in_past") {
          setLoomStatus("Some of those cells have already started. Brush a later block.");
        } else if (error.code === "compliance_blocked") {
          setLoomStatus(papersCopy());
        } else {
          setLoomStatus(error.message);
        }
        await reloadCells();
      }
    }
    placeHoldBtn.disabled = false;
  }

  function holdCopy(hold: Hold, takenCount: number): string {
    let text = `Held ${hold.cells.length} cells until ${hold.expires_local} kitchen time.`;
    if (takenCount > 0) {
      text += ` ${takenCount} cells were just taken by another booking.`;
    }
    return text;
  }

  async function releaseHold(silent = false): Promise<void> {
    if (!holdId) {
      return;
    }
    const id = holdId;
    if (!silent) {
      releaseBtn.disabled = true;
      setLoomStatus("Releasing…");
    }
    try {
      await api("DELETE", `/holds/${id}`);
      if (!silent) {
        setLoomStatus("Hold released.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "hold_expired") {
        if (!silent) {
          setLoomStatus("This hold is no longer active.");
        }
      } else if (!silent) {
        setLoomStatus(error instanceof ApiError ? error.message : "Something went wrong.");
      }
    }
    if (!silent) {
      releaseBtn.disabled = false;
    }
    stopCountdown();
    holdId = null;
    holdExpiresAt = null;
    if (!silent) {
      await reloadCells();
    }
    updateAddress();
    updateRailButtons();
  }

  // ---------- countdown ----------

  let countdownTimer: ReturnType<typeof setInterval> | null = null;

  function startCountdown(): void {
    stopCountdown();
    if (!holdExpiresAt) {
      return;
    }
    const tick = (): void => {
      const expires = holdExpiresAt;
      if (expires === null) {
        return;
      }
      const remaining = Math.max(0, Math.round((expires - (Date.now() - serverOffset)) / 1000));
      holdBar.setAttribute("aria-valuenow", String(remaining));
      if (prefersReducedMotion()) {
        holdFill.style.width = remaining === 0 ? "0%" : `${Math.round((remaining / kitchen.hold_seconds) * 100)}%`;
      } else {
        holdFill.style.width = `${Math.round((remaining / kitchen.hold_seconds) * 100)}%`;
      }
      if (expires !== null) {
        heldUntil.textContent = `held until ${wallTime(new Date(expires), kitchen.timezone)}`;
      }
      if (remaining <= 0 && holdId) {
        const expiresLocal = wallTime(new Date(expires), kitchen.timezone);
        holdId = null;
        holdExpiresAt = null;
        stopCountdown();
        setLoomStatus(`Your hold expired at ${expiresLocal} kitchen time. Brush the block again.`);
        updateAddress();
        updateRailButtons();
        void reloadCells();
      }
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  function stopCountdown(): void {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    holdBar.setAttribute("aria-valuenow", "0");
    holdFill.style.width = "0%";
    heldUntil.replaceChildren();
  }

  // ---------- rail action state ----------

  function updateRailButtons(): void {
    actionButtons.replaceChildren();
    if (holdId) {
      actionButtons.append(confirmBtn, repeatBtn, releaseBtn);
      confirmBtn.disabled = actionPaused("confirm_booking");
      releaseBtn.disabled = false;
      holdLine.style.display = "flex";
    } else {
      actionButtons.append(placeHoldBtn, clearBrushBtn);
      holdLine.style.display = "none";
    }
    const oneBlock = brush !== null;
    repeatBtn.title = oneBlock ? "" : "Repeat weekly needs one unbroken block.";
  }

  // ---------- dialogs ----------

  function openConfirmDialog(): void {
    if (!holdId) {
      return;
    }
    const body = el("div", { class: "dialog-body" });
    const cells = [...occupied.values()].filter((cell) => cell.hold_id === holdId);
    const rows = visibleStations();
    void cells;
    void rows;
    const summary = el("div", { class: "summary" });
    const stationsListed = new Map<string, [string, string]>();
    for (const cell of occupied.values()) {
      if (cell.hold_id === holdId) {
        const station = kitchen.stations.find((entry) => entry.id === cell.station_id);
        if (station) {
          const existing = stationsListed.get(cell.station_id);
          const start = existing ? (cell.start < existing[0] ? cell.start : existing[0]) : cell.start;
          const end = existing ? (cell.start >= existing[1] ? cell.start : existing[1]) : cell.start;
          stationsListed.set(cell.station_id, [start, end]);
        }
      }
    }
    summary.append(el("div", { class: "line" }, [el("span", { text: "Date" }), el("span", { class: "num", text: date })]));
    for (const [stationId, [start, end]] of stationsListed) {
      const station = kitchen.stations.find((entry) => entry.id === stationId);
      summary.append(
        el("div", { class: "line" }, [
          el("span", { text: station?.name ?? stationId }),
          el("span", { class: "num", text: `${start}\u2013${timeOfQuarter(quarterOf(end) + 1)}` }),
        ])
      );
    }
    const quote = currentQuote;
    if (quote) {
      for (const line of quote.lines) {
        summary.append(
          el("div", { class: "line" }, [
            el("span", { text: `${line.station} · tier ${line.tier} · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.hourly_rate_cents)}/h` }),
            el("span", { class: "num", text: `${line.hours} h · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.amount_cents)}` }),
          ])
        );
      }
    }
    const packLine = el("label", { class: "packcheck" });
    const packInput = el("input", { type: "checkbox", checked: usePack || undefined });
    packInput.setAttribute("aria-label", "Use pack hours");
    packLine.append(packInput);
    packLine.append(`Use pack hours (${fmtHours(packQuarters)} h left)`);
    packInput.addEventListener("change", () => {
      usePack = packInput.checked;
      void quoteForConfirm(summary);
    });
    const windowLine = el("div", { class: "line muted", text: "The cancellation window and rates in force when you confirm apply to this booking." });
    const actions = el("div", { class: "dialog-actions" });
    const confirm = el("button", { class: "btn primary" });
    confirm.textContent = "Confirm";
    const back = el("button", { class: "btn" });
    back.textContent = "Back";
    actions.append(confirm, back);
    body.append(summary, packLine, windowLine, actions);
    const handle = openDialog({ label: "Confirm booking", body, onOpen: () => confirm.focus() }, () => undefined);
    back.addEventListener("click", () => handle.close(null));
    confirm.addEventListener("click", () => void doConfirm());

    async function quoteForConfirm(summaryEl: HTMLElement): Promise<void> {
      const cells = [...occupied.values()].filter((cell) => cell.hold_id === holdId).map((cell) => ({ station_id: cell.station_id, start: cell.start }));
      try {
        const body = await api<{ quote: Quote }>("POST", "/quotes", {
          date,
          cells,
          use_pack: usePack,
          ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
        });
        currentQuote = body.quote;
        renderQuote(body.quote);
        const lineEls = summaryEl.querySelectorAll(".line");
        lineEls.forEach((lineEl) => {
          const label = lineEl.querySelector("span:first-child")?.textContent ?? "";
          if (label.includes("·") && (label.includes("tier") || label.includes("pack"))) {
            lineEl.remove();
          }
        });
        for (const line of body.quote.lines) {
          const lineEl = el("div", { class: "line" }, [
            el("span", { text: `${line.station} · tier ${line.tier} · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.hourly_rate_cents)}/h` }),
            el("span", { class: "num", text: `${line.hours} h · ${line.paid_by === "pack" ? "pack" : fmtMoney(line.amount_cents)}` }),
          ]);
          summaryEl.insertBefore(lineEl, packLine);
        }
      } catch {
        // keep the last quote
      }
    }

    async function doConfirm(): Promise<void> {
      const id = holdId;
      if (!id) {
        return;
      }
      confirm.disabled = true;
      setLoomStatus("Confirming…");
      try {
        const quoteBody = await api<{ quote: Quote }>("POST", "/quotes", {
          date,
          cells: [...occupied.values()].filter((cell) => cell.hold_id === id).map((cell) => ({ station_id: cell.station_id, start: cell.start })),
          use_pack: usePack,
          ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
        });
        const result = await api<{ booking: Booking; invoice: Invoice }>("POST", `/holds/${id}/confirm`, {
          use_pack: usePack,
          quoted_total_cents: quoteBody.quote.total_cents,
        }, { "Idempotency-Key": holdKey || `confirm-${id}` });
        handle.close(true);
        stopCountdown();
        holdId = null;
        holdExpiresAt = null;
        setLoomStatus(`Booking ${result.booking.ref} confirmed. Confirmation sent to ${actorEmail}.`);
        brush = null;
        brushAnchor = null;
        await reloadCells();
        await refreshPack();
        updateAddress();
        updateRailButtons();
        resetQuote();
        grid.focus();
      } catch (error) {
        confirm.disabled = false;
        if (error instanceof ApiError) {
          if (error.code === "quote_changed") {
            const fresh = error.extra.quote as Quote;
            currentQuote = fresh;
            renderQuote(fresh);
            setLoomStatus(`The price is now ${fresh.total} because your month-to-date hours changed. Check the quote and confirm again.`);
          } else if (error.code === "hold_expired") {
            const expiresLocal = holdExpiresAt === null ? "" : wallTime(new Date(holdExpiresAt), kitchen.timezone);
            handle.close(null);
            stopCountdown();
            holdId = null;
            holdExpiresAt = null;
            setLoomStatus(`Your hold expired at ${expiresLocal} kitchen time. Brush the block again.`);
            await reloadCells();
            updateAddress();
          } else if (error.code === "billing_unavailable") {
            handle.close(null);
            stopCountdown();
            holdId = null;
            holdExpiresAt = null;
            setLoomStatus("Billing is unreachable, so nothing was booked and your hold was released. Try again once billing is back.");
            await reloadCells();
            updateAddress();
          } else if (error.code === "mail_unavailable") {
            handle.close(null);
            stopCountdown();
            holdId = null;
            holdExpiresAt = null;
            setLoomStatus("Email is unreachable, so nothing was booked and your hold was released. Try again shortly.");
            await reloadCells();
            updateAddress();
          } else if (error.code === "validation") {
            setLoomStatus("No pack hours left.");
          } else if (error.code === "compliance_blocked") {
            handle.close(null);
            setLoomStatus(papersCopy());
          } else {
            setLoomStatus(error.message);
          }
        } else {
          setLoomStatus("Something went wrong.");
        }
      }
    }
  }

  async function openRepeatDialog(): Promise<void> {
    const cells = holdId
      ? [...occupied.values()].filter((cell) => cell.hold_id === holdId).map((cell) => ({ station_id: cell.station_id, start: cell.start }))
      : brushCells().filter((cell) => !occupied.has(cellKey(cell.station_id, quarterOf(cell.start))));
    if (cells.length === 0) {
      setLoomStatus("Repeat weekly needs one unbroken block.");
      return;
    }
    const stationIds = [...new Set(cells.map((cell) => cell.station_id))];
    const starts = cells.map((cell) => quarterOf(cell.start));
    const start = timeOfQuarter(Math.min(...starts));
    let end = timeOfQuarter(Math.max(...starts) + 1);
    const conflicting = holdId ? false : cells.length !== stationIds.length * (Math.max(...starts) - Math.min(...starts) + 1);
    if (conflicting) {
      setLoomStatus("Repeat weekly needs one unbroken block.");
      return;
    }
    const body = el("div", { class: "dialog-body" });
    const weeksField = el("div", { class: "field" });
    const weeksLabel = el("label", { for: "repeat-weeks" });
    weeksLabel.textContent = "Weeks";
    const weeksInput = el("input", { id: "repeat-weeks", type: "number", min: "2", max: "12", value: "4" });
    weeksInput.setAttribute("aria-label", "Weeks");
    weeksField.append(weeksLabel, weeksInput);
    const occurrenceList = el("div", { class: "summary" });
    const actions = el("div", { class: "dialog-actions" });
    const bookSeries = el("button", { class: "btn primary" });
    bookSeries.textContent = "Book series";
    const back = el("button", { class: "btn" });
    back.textContent = "Back";
    actions.append(bookSeries, back);
    body.append(weeksField, occurrenceList, actions);
    const handle = openDialog({ label: "Repeat weekly", body }, () => undefined);
    back.addEventListener("click", () => handle.close(null));
    let seriesTotal = 0;
    let weeks = 4;

    async function quoteSeries(): Promise<void> {
      const parsed = Number.parseInt(weeksInput.value, 10);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 12) {
        occurrenceList.replaceChildren(el("div", { text: "Choose 2 to 12 weeks." }));
        return;
      }
      weeks = parsed;
      bookSeries.disabled = true;
      occurrenceList.replaceChildren(el("div", { text: "Pricing…" }));
      try {
        const result = await api<{ occurrences: Array<{ date: string; quote: Quote }>; total_cents: number; total: string }>("POST", "/series/quote", {
          station_ids: stationIds,
          start,
          end,
          first_date: date,
          weeks: parsed,
          use_pack: usePack,
          ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
        });
        seriesTotal = result.total_cents;
        occurrenceList.replaceChildren();
        for (const occurrence of result.occurrences) {
          occurrenceList.append(el("div", { class: "line" }, [el("span", { text: occurrence.date }), el("span", { class: "num", text: occurrence.quote.total })]));
        }
        occurrenceList.append(el("div", { class: "line" }, [el("span", { text: "Series total" }), el("span", { class: "num", text: result.total })]));
        bookSeries.disabled = false;
      } catch (error) {
        if (error instanceof ApiError && error.code === "series_conflict") {
          const dates = (error.extra.dates as string[] | undefined) ?? [];
          setLoomStatus(`These weeks are already taken: ${dates.join(", ")}. Nothing was booked.`);
          occurrenceList.replaceChildren(el("div", { text: `These weeks are already taken: ${dates.join(", ")}. Nothing was booked.` }));
        } else if (error instanceof ApiError) {
          occurrenceList.replaceChildren(el("div", { text: error.message }));
        } else {
          occurrenceList.replaceChildren(el("div", { text: "Something went wrong." }));
        }
      }
    }

    weeksInput.addEventListener("change", () => {
      void quoteSeries();
    });
    await quoteSeries();

    bookSeries.addEventListener("click", async () => {
      bookSeries.disabled = true;
      setLoomStatus("Booking series…");
      try {
        const result = await api<{ bookings: Booking[]; invoice: Invoice }>("POST", "/series", {
          station_ids: stationIds,
          start,
          end,
          first_date: date,
          weeks,
          use_pack: usePack,
          quoted_total_cents: seriesTotal,
          ...(isOperator && actorMemberId ? { member_id: actorMemberId } : {}),
        }, { "Idempotency-Key": `series-${Date.now()}` });
        handle.close(true);
        const refs = result.bookings.map((booking) => booking.ref);
        const first = result.bookings[0]?.date ?? date;
        const last = result.bookings[result.bookings.length - 1]?.date ?? date;
        setLoomStatus(`Booked ${refs.length} weekly slots, ${first} to ${last}.`);
        if (holdId) {
          await releaseHold(true);
        }
        clearBrush(false);
        await reloadCells();
        updateAddress();
      } catch (error) {
        bookSeries.disabled = false;
        if (error instanceof ApiError && error.code === "series_conflict") {
          const dates = (error.extra.dates as string[] | undefined) ?? [];
          setLoomStatus(`These weeks are already taken: ${dates.join(", ")}. Nothing was booked.`);
        } else if (error instanceof ApiError) {
          setLoomStatus(error.message);
        } else {
          setLoomStatus("Something went wrong.");
        }
      }
    });
  }

  function openStationsDialog(): void {
    const body = el("div", { class: "dialog-body" });
    const fields = el("div", { class: "form-grid" });
    const checks: Array<{ input: HTMLInputElement; id: string }> = [];
    for (const station of kitchen.stations) {
      const label = el("label", { class: "packcheck", for: `station-${station.id}` });
      const input = el("input", { id: `station-${station.id}`, type: "checkbox" });
      input.setAttribute("aria-label", station.name);
      if (!stationFilter || stationFilter.includes(station.id)) {
        input.checked = true;
      }
      label.append(input, station.name);
      fields.append(label);
      checks.push({ input, id: station.id });
    }
    const actions = el("div", { class: "dialog-actions" });
    const apply = el("button", { class: "btn primary" });
    apply.textContent = "Apply";
    actions.append(apply);
    body.append(fields, actions);
    const handle = openDialog({ label: "Choose stations", body }, () => undefined);
    apply.addEventListener("click", () => {
      const chosen = checks.filter((entry) => entry.input.checked).map((entry) => entry.id);
      stationFilter = chosen.length === kitchen.stations.length ? null : chosen;
      handle.close(true);
      brush = null;
      brushAnchor = null;
      buildGrid();
      drawFloorPlan();
      void reloadCells();
      resetQuote();
      updateAddress();
    });
  }

  // ---------- railbar (375px) ----------

  const railbar = el("div", { class: "railbar" });
  const railbarTotal = el("span", { class: "total", text: "$0.00" });
  const showQuote = el("button", { class: "btn" });
  showQuote.textContent = "Show quote";
  const backdrop = el("div", { class: "overlay-backdrop" });
  const syncBar = (): void => {
    railbarTotal.textContent = totalEl.textContent;
  };
  const totalObserver = new MutationObserver(syncBar);
  totalObserver.observe(totalEl, { childList: true, characterData: true, subtree: true });
  showQuote.addEventListener("click", () => {
    quoteRegion.classList.add("sheet-open");
    backdrop.style.display = "block";
  });
  backdrop.addEventListener("click", () => {
    quoteRegion.classList.remove("sheet-open");
    backdrop.style.display = "none";
  });
  railbar.append(railbarTotal, showQuote);

  // ---------- layout ----------

  const layout = el("div", { class: "loom-layout" });
  layout.append(loomFrame, quoteRegion);
  screen.append(header, floorGroup, legend, layout, loomStatus, railbar, backdrop);
  container.append(screen);

  // ---------- refresh loop ----------

  const cellsRefresh = setInterval(() => {
    void reloadCells();
  }, 15000);
  const statusListener = (): void => {
    updateRailButtons();
  };
  window.addEventListener("pilotlight:status", statusListener);

  const teardown = (): void => {
    clearInterval(cellsRefresh);
    stopCountdown();
    totalObserver.disconnect();
    window.removeEventListener("pilotlight:status", statusListener);
  };
  (screen as unknown as { teardown?: () => void }).teardown = teardown;

  // ---------- boot ----------

  buildGrid();
  drawFloorPlan();
  updateRailButtons();
  if (isOperator) {
    void api<{ members: typeof members }>("GET", `/kitchens/${kitchenId}/members`).then((body) => {
      members = body.members;
      if (memberSelect) {
        memberSelect.replaceChildren();
        for (const member of members) {
          memberSelect.append(new Option(member.business, member.id));
        }
        if (members.length > 0) {
          actorMemberId = members[0]!.id;
          actorEmail = members[0]!.contact_email;
          memberSelect.value = actorMemberId;
          void reloadCells();
        }
      }
    });
  }
  void refreshPack();
  void reloadCells();
  if (holdParam) {
    holdId = holdParam;
    void api<{ hold: Hold }>("GET", `/holds/${holdParam}`).then((body) => {
      if (body.hold.state === "held") {
        holdExpiresAt = Date.parse(body.hold.expires_at);
        serverOffset = Date.now() - Date.parse(body.hold.server_now);
        holdKey = `confirm-${body.hold.id}`;
        if (body.hold.quote) {
          currentQuote = body.hold.quote;
          renderQuote(body.hold.quote);
        }
        startCountdown();
        updateRailButtons();
      } else {
        holdId = null;
      }
    }).catch(() => {
      holdId = null;
    });
  }
  updateAddress();
}
