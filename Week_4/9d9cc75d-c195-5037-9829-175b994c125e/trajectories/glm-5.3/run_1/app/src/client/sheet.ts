/** The sheet editor: shelves, keyboard flow, chart and its data table twin. */

import { api, esc, el } from "./api.js";
import { renderChart, type ChartSpec } from "./chart.js";
import { displayNumber, displayShare, dataValue } from "../../src/shared/display.js";

interface FieldDef {
  id: string;
  name: string;
  type: string;
  kind: "dimension" | "measure";
}

interface Pill {
  field: string;
  agg?: string;
  level?: string;
  table_calc?: { kind: string; using: string; fields: string[] } | null;
}

interface SheetData {
  id: string;
  name: string;
  version: number;
  rows: (string | Pill)[];
  columns: (string | Pill)[];
  color: string | Pill | null;
  size: string | Pill | null;
  label: Pill[];
  detail: string[];
  filters: { field: string; step: string; values?: (string | null)[]; min?: number | null; max?: number | null; n?: number | string; by?: { field: string; agg: string } | null }[];
  chart: string;
  totals: boolean;
  reference_lines: { type: string; value: number | null; parameter: string | null }[];
  trend: boolean;
  sort: Record<string, string>;
  calculations: { id: string; name: string; formula: string }[];
}

interface Answer {
  gen: number;
  chart: string;
  columns: { name: string; role: string }[];
  rows: (string | number | boolean | null)[][];
  total: (number | null)[] | null;
  reference_lines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
}

let gen = 0;
let lastMarkPositions = new Map<string, { x: number; y: number; w: number; h: number }>();

function pillField(p: string | Pill): string {
  return typeof p === "string" ? p : p.field;
}

function pillCaption(p: string | Pill, fields: FieldDef[]): string {
  const name = pillField(p);
  if (typeof p !== "string") {
    if (p.table_calc) {
      const base = p.agg === "SUM" || !p.agg ? name : `${p.agg} ${name}`;
      const kind = p.table_calc.kind;
      const word =
        kind === "run_total" ? "Running total of" : kind === "prev_diff" ? "Difference from previous of" : kind === "share" ? "Percent of total of" : "Rank of";
      return `${word} ${base}`;
    }
    if (p.agg && p.agg !== "SUM") return `${p.agg} ${name}`;
  }
  return name;
}

export async function sheetPage(workbookId: string, sheetId: string): Promise<void> {
  const sheetRes = await api<SheetData>("GET", `/api/sheets/${sheetId}`);
  if (sheetRes.status === 404) {
    const nf = document.getElementById("page");
    if (nf) nf.innerHTML = `<div class="card" style="max-width:520px;margin:48px auto;"><h1 class="headline">Not found.</h1></div>`;
    return;
  }
  const sheet = sheetRes.json!;
  const wbRes = await api<{ source: string; name: string }>("GET", `/api/workbooks/${workbookId}`);
  const sourceId = wbRes.json?.source ?? "";
  const srcRes = await api<{ fields: FieldDef[] }>("GET", `/api/sources/${sourceId}`);
  const fields = srcRes.json?.fields ?? [];

  document.getElementById("page")!.className = "depth-sheet";
  document.getElementById("page")!.innerHTML = `
    <div class="sheet-layout">
      <div class="stack" data-region="Fields">
        <section aria-label="Fields" class="panel">
          <h3>Fields</h3>
          <ul id="field-list" role="listbox" aria-label="Fields" tabindex="0" style="list-style:none;padding:0;"></ul>
        </section>
        <section aria-label="Calculations" class="panel">
          <h3>Calculations</h3>
          <ul id="calc-list" aria-label="Calculations" style="list-style:none;padding:0;"></ul>
          <button id="new-calculation">New calculation</button>
        </section>
      </div>
      <div class="stack stage">
        <section aria-label="View" class="view-card" data-region="View">
          <div class="row" style="justify-content:space-between">
            <h2 class="headline">${esc(sheet.name)}</h2>
            <div class="row">
              <select id="chart-type" aria-label="Chart type">
                <option>Automatic</option><option>Bar</option><option>Line</option><option>Scatter</option><option>Text table</option><option>Heat map</option>
              </select>
              <label class="row" style="min-height:0"><input type="checkbox" id="show-totals" aria-label="Show totals"> Totals</label>
              <button id="add-ref-line">Add reference line</button>
              <label class="row" style="min-height:0"><input type="checkbox" id="trend-line" aria-label="Trend line"> Trend</label>
              <button id="new-set">New set</button>
              <button id="new-alert">New alert</button>
            </div>
          </div>
          <div id="chart-holder"></div>
          <ul id="legend" class="legend" role="list" aria-label="Legend"></ul>
          <p id="view-notice" class="status" role="status" aria-live="polite"></p>
          <p id="view-announcements" class="status" role="status" aria-live="polite"></p>
        </section>
        <section aria-label="Data table" class="view-card" data-region="Data table">
          <h3>Data table</h3>
          <div id="twin-holder" style="overflow:auto"></div>
        </section>
      </div>
      <div class="stack" data-region="Shelves" aria-label="Shelves">
        <section aria-label="Shelves" class="panel">
          <h3>Shelves</h3>
          ${["Rows", "Columns", "Color", "Size", "Label", "Detail", "Filters"]
            .map(
              (shelf) => `
            <div>
              <h4>${shelf}</h4>
              <ul class="shelf-list" data-shelf="${shelf.toLowerCase()}" role="list" aria-label="${shelf}"></ul>
            </div>`,
            )
            .join("")}
          <label class="row"><input type="checkbox" id="totals-check" aria-label="Show totals"> Show totals</label>
        </section>
      </div>
    </div>
    <p id="announcements" class="status" role="status" aria-live="polite"></p>`;

  const announce = (text: string): void => {
    document.getElementById("view-announcements")!.textContent = text;
  };
  const announcePage = (text: string): void => {
    document.getElementById("announcements")!.textContent = text;
  };

  const shelfList = (shelf: string): HTMLUListElement => document.querySelector(`.shelf-list[data-shelf="${shelf}"]`)!;

  function pillsOf(shelf: string): (string | Pill)[] {
    switch (shelf) {
      case "rows": return sheet.rows;
      case "columns": return sheet.columns;
      case "color": return sheet.color ? [sheet.color] : [];
      case "size": return sheet.size ? [sheet.size] : [];
      case "label": return sheet.label;
      case "detail": return sheet.detail;
      case "filters": return sheet.filters.map((f) => ({ field: f.field, step: f.step }) as Pill);
      default: return [];
    }
  }

  function setShelf(shelf: string, pills: (string | Pill)[]): void {
    switch (shelf) {
      case "rows": sheet.rows = pills as never; break;
      case "columns": sheet.columns = pills as never; break;
      case "color": sheet.color = (pills[0] as Pill) ?? null; break;
      case "size": sheet.size = (pills[0] as Pill) ?? null; break;
      case "label": sheet.label = pills as Pill[]; break;
      case "detail": sheet.detail = pills.map((p) => pillField(p)); break;
      default: break;
    }
  }

  function renderShelves(): void {
    for (const shelf of ["rows", "columns", "color", "size", "label", "detail", "filters"]) {
      const ul = shelfList(shelf);
      const pills = pillsOf(shelf);
      ul.innerHTML = "";
      pills.forEach((p, i) => {
        const caption = shelf === "filters" ? `${pillField(p)} is any` : pillCaption(p, fields);
        const kind = fields.find((f) => f.name === pillField(p))?.kind ?? "dimension";
        const li = el(`<li><button class="shelf-pill" data-kind="${kind}" data-index="${i}" aria-label="${esc(caption)} on ${shelf}">${esc(caption)}</button></li>`);
        li.querySelector("button")!.addEventListener("keydown", (e) => {
          if (e.key === "Delete") {
            e.preventDefault();
            removePill(shelf, i);
          } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
            e.preventDefault();
            movePill(shelf, i, i + 1);
          } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowUp")) {
            e.preventDefault();
            movePill(shelf, i, i - 1);
          } else if (e.key === "Enter" && shelf === "filters") {
            e.preventDefault();
            openFilterDialog(pillField(p));
          }
        });
        ul.appendChild(li);
      });
    }
  }

  async function saveSheet(): Promise<void> {
    const body: Record<string, unknown> = { ...sheet };
    await api("PUT", `/api/sheets/${sheetId}`, body);
    await runQuery();
  }

  async function removePill(shelf: string, index: number): Promise<void> {
    const pills = pillsOf(shelf);
    const caption = pillCaption(pills[index], fields);
    pills.splice(index, 1);
    setShelf(shelf, pills);
    renderShelves();
    announce(`Removed ${pillField(pills[index] ?? { field: caption })} from ${shelf}.`);
    await saveSheet();
  }

  async function movePill(shelf: string, from: number, to: number): Promise<void> {
    const pills = pillsOf(shelf);
    if (to < 0 || to >= pills.length) return;
    const [p] = pills.splice(from, 1);
    pills.splice(to, 0, p);
    setShelf(shelf, pills);
    renderShelves();
    announce(`Moved ${pillField(p)} to position ${to + 1} on ${shelf}.`);
    await saveSheet();
  }

  async function addPill(shelf: string, field: string, kind: string): Promise<void> {
    if (shelf === "filters") {
      openFilterDialog(field);
      return;
    }
    if (shelf === "color" || shelf === "size") {
      setShelf(shelf, [{ field }]);
    } else {
      const pills = pillsOf(shelf);
      pills.push(kind === "measure" ? { field, agg: "SUM" } : field);
      setShelf(shelf, pills);
    }
    renderShelves();
    announce(`Added ${field} to ${shelf}.`);
    await saveSheet();
  }

  function renderFieldList(): void {
    const ul = document.getElementById("field-list")!;
    ul.innerHTML = "";
    fields.forEach((f) => {
      const li = el(`<li role="option" aria-selected="false" tabindex="-1" data-field="${esc(f.name)}" data-kind="${f.kind}" style="padding:6px 10px;border-radius:12px;cursor:pointer;display:flex;justify-content:space-between">
        <span>${esc(f.name)}</span><span class="muted">${f.kind === "measure" ? "measure" : "dimension"}</span></li>`);
      li.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        startDrag(e as PointerEvent, f.name, f.kind, li);
      });
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          openAddMenu(li, f.name, f.kind);
        }
      });
      ul.appendChild(li);
    });
    const first = ul.querySelector("li");
    if (first) first.tabIndex = 0;
    ul.addEventListener("keydown", (e) => {
      const items = [...ul.querySelectorAll("li")];
      const current = items.findIndex((i) => i.getAttribute("tabindex") === "0");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
        items.forEach((it, idx) => it.setAttribute("tabindex", String(idx === next ? "0" : "-1")));
        (items[next] as HTMLElement).focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[current >= 0 ? current : 0] as HTMLElement;
        const fieldName = item?.dataset.field ?? "";
        const fieldKind = item?.dataset.kind ?? "dimension";
        if (fieldName) openAddMenu(item, fieldName, fieldKind);
      }
    });
  }

  function openAddMenu(option: HTMLElement, field: string, kind: string): void {
    const menu = el(`<div role="menu" aria-label="Add to shelf" style="position:fixed;background:#fff;border:2px solid #1a0a14;border-radius:18px;padding:8px;z-index:50;box-shadow:0 6px 0 rgba(26,10,20,0.9)">
      ${["Rows", "Columns", "Color", "Size", "Label", "Detail", "Filters"].map((s) => `<div role="menuitem" tabindex="0" data-shelf="${s.toLowerCase()}" style="padding:8px 14px;border-radius:12px;cursor:pointer">${s}</div>`).join("")}
    </div>`);
    document.body.appendChild(menu);
    const rect = option.getBoundingClientRect();
    menu.style.left = `${rect.right + 8}px`;
    menu.style.top = `${rect.top}px`;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    items[0].focus();
    const close = (focusBack: boolean): void => {
      menu.remove();
      if (focusBack) option.focus();
    };
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = items.findIndex((i) => i === document.activeElement);
        const next = e.key === "ArrowDown" ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next].focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = document.activeElement as HTMLElement;
        const shelf = target.dataset.shelf!;
        close(true);
        void addPill(shelf, field, kind);
      }
    });
    items.forEach((it) => {
      it.addEventListener("click", () => {
        const shelf = it.dataset.shelf!;
        close(true);
        void addPill(shelf, field, kind);
      });
    });
  }

  function openFilterDialog(field: string): void {
    void (async () => {
      const membersRes = await api<{ members: (string | number | boolean | null)[] }>("POST", `/api/sheets/${sheetId}/members`, {
        field,
        step: "dimension",
        filters: sheet.filters,
      });
      const members = membersRes.json?.members ?? [];
      const dlg = el(`<dialog aria-label="Filter ${esc(field)}">
        <form method="dialog" class="stack">
          <h3>Filter ${esc(field)}</h3>
          <div role="radiogroup">
            <label><input type="radio" name="mode" value="members" checked> Members</label>
            <label><input type="radio" name="mode" value="top"> Top N</label>
          </div>
          <div id="member-list" style="max-height:220px;overflow:auto">${members.map((m) => `<label><input type="checkbox" name="member" value="${esc(String(m))}"> ${esc(String(m))}</label>`).join("")}</div>
          <label>Top N <input type="number" name="n" min="1" aria-label="Top N"></label>
          <button class="primary" value="apply">Apply</button>
          <button value="cancel">Cancel</button>
        </form>
      </dialog>`) as HTMLDialogElement;
      document.body.appendChild(dlg);
      const opener = document.activeElement as HTMLElement;
      dlg.showModal();
      dlg.addEventListener("close", () => {
        const value = (dlg.querySelector("form") as HTMLFormElement).value;
        if (value !== "apply") {
          dlg.remove();
          opener.focus();
          return;
        }
        const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
        const mode = String(data.get("mode"));
        const chosen = [...data.getAll("member")].map(String);
        const filters = sheet.filters.filter((f) => f.field !== field);
        if (mode === "top") {
          filters.push({ field, step: "top", n: Number(data.get("n") ?? 1), by: { field: "Sales", agg: "SUM" } });
        } else {
          filters.push({ field, step: "dimension", values: chosen });
        }
        sheet.filters = filters;
        dlg.remove();
        renderShelves();
        void (async () => {
          await saveSheet();
          announce(`Filtered: ${document.querySelectorAll(".mark").length} marks.`);
          const pillBtn = document.querySelector(`.shelf-list[data-shelf="filters"] .shelf-pill`) as HTMLElement | null;
          pillBtn?.focus();
        })();
      });
    })();
  }

  // Pointer drag: pointer events only, 4px threshold.
  function startDrag(e: PointerEvent, field: string, kind: string, source: HTMLElement): void {
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent): void => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 4) {
        dragging = true;
      }
      if (!dragging) return;
      for (const ul of document.querySelectorAll<HTMLUListElement>(".shelf-list")) {
        const r = ul.getBoundingClientRect();
        ul.dataset.drop = String(ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
      }
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      for (const ul of document.querySelectorAll<HTMLUListElement>(".shelf-list")) ul.dataset.drop = "false";
      if (!dragging) return;
      for (const ul of document.querySelectorAll<HTMLUListElement>(".shelf-list")) {
        const r = ul.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          void addPill(ul.dataset.shelf!, field, kind);
          break;
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    void source;
  }

  // The chart and twin.
  async function runQuery(): Promise<void> {
    gen += 1;
    const myGen = gen;
    const view = document.querySelector('[aria-label="View"]')!;
    view.setAttribute("aria-busy", "true");
    const busy = document.createElement("div");
    busy.className = "updating";
    busy.textContent = "Updating...";
    view.appendChild(busy);
    const res = await api<Answer>("POST", `/api/sheets/${sheetId}/query?gen=${myGen}`, {
      filters: [],
      parameters: {},
      sets: {},
    });
    busy.remove();
    view.setAttribute("aria-busy", "false");
    if (res.status === 422) {
      const message = (res.json as { message?: string } | null)?.message ?? "";
      viewNotice(message);
      return;
    }
    if (myGen < gen) return;
    const answer = res.json!;
    if (answer.chart === "none" || (answer.rows.length === 0 && sheet.rows.length === 0 && sheet.columns.length === 0)) {
      document.getElementById("chart-holder")!.innerHTML = `<div style="padding:60px 0;text-align:center"><h2 class="headline">Place a field on Rows or Columns.</h2></div>`;
      document.getElementById("twin-holder")!.innerHTML = "";
      viewNotice("");
      return;
    }
    const dims = answer.columns.filter((c) => c.role === "dimension").map((c) => c.name);
    const measures = answer.columns.filter((c) => c.role === "measure").map((c) => c.name);
    const marks = answer.rows.map((row) => ({
      key: row.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))).join(" | "),
      dimTexts: row.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))),
      values: (row.slice(dims.length) as (number | null)[]).map((v, i) => (measures[i]?.includes("Percent of total") ? v : v)),
    }));
    const spec: ChartSpec = {
      chart: answer.chart,
      dims,
      measures,
      marks,
      colorDimension: false,
      colorMeasure: sheet.color && fields.find((f) => f.name === pillField(sheet.color as Pill))?.kind === "measure" ? String(pillField(sheet.color as Pill)) : null,
      total: answer.total,
      refLines: answer.reference_lines,
      trend: answer.trend,
      sheetName: sheet.name,
    };
    document.getElementById("chart-holder")!.innerHTML = renderChart(spec);
    markGlide();
    attachMarkHandlers();
    renderTwin(answer, dims, measures);
    renderLegend(marks);
    viewNotice("");
  }

  function renderTwin(answer: Answer, dims: string[], measures: string[]): void {
    const holder = document.getElementById("twin-holder")!;
    const header = [...dims, ...measures];
    const rows = answer.rows.map((r, idx) => {
      const cells = r.map((v, i) =>
        i < dims.length
          ? `<td role="rowheader">${esc(v === null ? "(null)" : String(v))}</td>`
          : `<td role="gridcell" data-value="${v === null || v === undefined ? "" : dataValue(v as number)}">${esc(
              measures[i - dims.length]?.includes("Percent of total") && typeof v === "number" ? displayShare(v) : v === null ? "(null)" : displayNumber(v as number),
            )}</td>`,
      );
      return `<tr data-mark="${esc(answer.rows[idx].slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))).join(" | "))}">${cells.join("")}</tr>`;
    });
    const totalRow = sheet.totals
      ? `<tr><td role="rowheader">Grand total</td>${dims.slice(1).map(() => "<td></td>").join("")}${measures
          .map((m, i) => {
            const t = answer.total?.[i] ?? null;
            const na = m.includes("Running total of") || m.includes("Difference from previous of") || m.includes("Percent of total of") || m.includes("Rank of");
            return `<td role="gridcell" data-value="${t === null ? "" : dataValue(t)}">${na ? "n/a" : t === null ? "(null)" : displayNumber(t)}</td>`;
          })
          .join("")}</tr>`
      : "";
    const refRows = answer.reference_lines
      .map((r) => `<tr><td role="rowheader">${esc(r.type)}</td>${dims.map(() => "<td></td>").join("")}${measures
        .map(() => `<td role="gridcell">${r.value === null ? "(null)" : displayNumber(r.value)}</td>`)
        .join("")}</tr>`)
      .join("");
    const trendRow = answer.trend
      ? `<tr><td role="rowheader">Trend</td><td role="gridcell" colspan="${Math.max(1, header.length - 1)}">y = ${answer.trend.slope}x ${
          answer.trend.intercept < 0 ? "-" : "+"
        } ${Math.abs(answer.trend.intercept)}</td></tr>`
      : "";
    holder.innerHTML = `<table class="twin-table" role="grid" aria-label="${esc(sheet.name)} table">
      <thead><tr>${header.map((h) => `<th scope="col" class="columnheader">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}${totalRow}${refRows}${trendRow}</tbody>
    </table>`;
  }

  function renderLegend(marks: { key: string; dimTexts: string[] }[]): void {
    const ul = document.getElementById("legend")!;
    const colorDim = sheet.color && fields.find((f) => f.name === pillField(sheet.color as Pill))?.kind === "dimension";
    if (colorDim) {
      const members = [...new Set(marks.map((m) => m.key))];
      ul.innerHTML = members.map((m, i) => {
        const colors = ["233, 71, 159", "26, 10, 20", "217, 225, 63", "110, 74, 94", "234, 160, 205"];
        const c = colors[i % colors.length];
        return `<li><span class="swatch" style="background:rgb(${c})"></span>${esc(m)}</li>`;
      }).join("");
    } else if (specSequential()) {
      ul.innerHTML = `<li><span class="swatch" style="background:linear-gradient(90deg,rgb(253,241,247),rgb(233,71,159))"></span>min to max</li>`;
    } else {
      ul.innerHTML = "";
    }
  }

  function specSequential(): boolean {
    return false;
  }

  function viewNotice(text: string): void {
    document.getElementById("view-notice")!.textContent = text;
  }

  // Mark Glide: exactly one 240ms animation per surviving mark.
  function markGlide(): void {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const svg = document.querySelector("svg.chart");
    if (!svg) return;
    const marks = [...svg.querySelectorAll<SVGGElement>(".mark")];
    for (const m of marks) {
      const key = m.dataset.mark ?? "";
      const rect = m.querySelector("rect, circle");
      if (!rect) continue;
      let x = 0;
      let y = 0;
      let w = 0;
      let h = 0;
      if (rect instanceof SVGCircleElement) {
        x = Number(rect.getAttribute("cx")) - Number(rect.getAttribute("r"));
        y = Number(rect.getAttribute("cy")) - Number(rect.getAttribute("r"));
        w = Number(rect.getAttribute("r")) * 2;
        h = w;
      } else {
        x = Number(rect.getAttribute("x"));
        y = Number(rect.getAttribute("y"));
        w = Number(rect.getAttribute("width"));
        h = Number(rect.getAttribute("height"));
      }
      const prev = lastMarkPositions.get(key);
      lastMarkPositions.set(key, { x, y, w, h });
      if (reduced || !prev) continue;
      if (prev.x === x && prev.y === y && prev.w === w && prev.h === h) continue;
      m.animate(
        [
          { transform: `translate(${prev.x - x}px, ${prev.y - y}px) scale(${prev.w / (w || 1)}, ${prev.h / (h || 1)})` },
          { transform: "translate(0, 0) scale(1, 1)" },
        ],
        { id: "mark-glide", duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "none" },
      );
    }
    const keys = new Set(marks.map((m) => m.dataset.mark ?? ""));
    for (const k of lastMarkPositions.keys()) {
      if (!keys.has(k)) lastMarkPositions.delete(k);
    }
  }

  function attachMarkHandlers(): void {
    const svg = document.querySelector("svg.chart");
    if (!svg) return;
    const marks = [...svg.querySelectorAll<SVGGElement>(".mark")];
    if (marks.length === 0) return;
    let focusedIdx = 0;
    marks.forEach((m, i) => {
      m.setAttribute("tabindex", i === 0 ? "0" : "-1");
      m.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(marks.length - 1, focusedIdx + 1) : Math.max(0, focusedIdx - 1);
          focusedIdx = next;
          marks.forEach((mm, idx) => mm.setAttribute("tabindex", String(idx === next ? "0" : "-1")));
          (marks[next] as unknown as HTMLElement).focus();
          showTooltip(marks[next]);
        } else if (e.key === "Enter") {
          e.preventDefault();
          selectMark(m);
        } else if (e.key === "Escape") {
          e.preventDefault();
          clearSelection();
        }
      });
      m.addEventListener("focus", () => {
        focusedIdx = marks.indexOf(m);
        showTooltip(m);
      });
      m.addEventListener("mouseenter", () => showTooltip(m));
      m.addEventListener("mouseleave", hideTooltip);
      m.addEventListener("click", () => selectMark(m));
    });
    (marks[0] as unknown as HTMLElement).focus?.();
    svg.querySelector("[data-plot]")?.addEventListener("click", () => clearSelection());
  }

  function showTooltip(mark: SVGGElement): void {
    hideTooltip();
    const svg = mark.closest("svg");
    if (!svg) return;
    const holder = svg.parentElement!;
    const rect = svg.getBoundingClientRect();
    const bbox = mark.getBBox();
    const point = svg.createSVGPoint();
    point.x = bbox.x;
    point.y = bbox.y;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const screen = point.matrixTransform(ctm);
    const holderRect = holder.getBoundingClientRect();
    const tip = el(`<div role="tooltip" style="position:absolute;background:#1a0a14;color:#fdf1f7;padding:8px 14px;border-radius:14px;font-size:14px;pointer-events:none;z-index:10">${tooltipText(mark)}</div>`);
    holder.style.position = "relative";
    holder.appendChild(tip);
    tip.style.left = `${screen.x - holderRect.left + (bbox.width * (rect.width / (svg.viewBox.baseVal.width || 1))) / 2}px`;
    tip.style.top = `${screen.y - holderRect.top - 8}px`;
    tip.style.transform = "translate(-50%, -100%)";
  }

  function tooltipText(mark: SVGGElement): string {
    const dims = (mark.dataset.dims ?? "").split(" | ");
    const measure = mark.dataset.measure ?? "";
    const value = mark.dataset.value === "" ? "(null)" : displayNumber(Number(mark.dataset.value));
    const parts = [...dims.map((d, i) => `${labelFor(i)}: ${d}`), `${measure}: ${value}`];
    return esc(parts.join("; "));
  }

  function labelFor(_i: number): string {
    return "Dimension";
  }

  function hideTooltip(): void {
    document.querySelectorAll('[role="tooltip"]').forEach((t) => t.remove());
  }

  function selectMark(mark: SVGGElement): void {
    document.querySelectorAll<SVGGElement>(".mark").forEach((m) => m.setAttribute("aria-pressed", "false"));
    mark.setAttribute("aria-pressed", "true");
    showTooltip(mark);
  }

  function clearSelection(): void {
    document.querySelectorAll<SVGGElement>(".mark").forEach((m) => m.setAttribute("aria-pressed", "false"));
    hideTooltip();
  }

  // Controls
  const chartSel = document.getElementById("chart-type") as HTMLSelectElement;
  chartSel.value = sheet.chart === "automatic" ? "Automatic" : sheet.chart.charAt(0).toUpperCase() + sheet.chart.slice(1).replace("_", " ");
  chartSel.addEventListener("change", async () => {
    const val = chartSel.value.toLowerCase().replace(" ", "_");
    sheet.chart = val === "automatic" ? "automatic" : val;
    await saveSheet();
  });
  const totalsCheck = document.getElementById("show-totals") as HTMLInputElement;
  totalsCheck.checked = sheet.totals;
  totalsCheck.addEventListener("change", async () => {
    sheet.totals = totalsCheck.checked;
    await saveSheet();
  });
  const trendCheck = document.getElementById("trend-line") as HTMLInputElement;
  trendCheck.checked = sheet.trend;
  trendCheck.addEventListener("change", async () => {
    sheet.trend = trendCheck.checked;
    await saveSheet();
  });

  document.getElementById("add-ref-line")!.addEventListener("click", () => {
    const dlg = el(`<dialog aria-label="Reference line">
      <form method="dialog" class="stack">
        <h3>Reference line</h3>
        <label>Line type <select name="type" aria-label="Line type"><option>Average</option><option>Median</option><option>Constant</option></select></label>
        <label>Value <input type="number" name="value" aria-label="Value"></label>
        <button class="primary" value="ok">Save line</button>
        <button value="cancel">Cancel</button>
      </form>
    </dialog>`) as HTMLDialogElement;
    document.body.appendChild(dlg);
    const opener = document.activeElement as HTMLElement;
    dlg.showModal();
    dlg.addEventListener("close", async () => {
      const value = (dlg.querySelector("form") as HTMLFormElement).value;
      if (value !== "ok") {
        dlg.remove();
        opener.focus();
        return;
      }
      const data = new FormData(dlg.querySelector("form") as HTMLFormElement);
      const type = String(data.get("type")).toLowerCase();
      sheet.reference_lines = sheet.reference_lines ?? [];
      sheet.reference_lines.push({ type, value: Number(data.get("value") ?? 0), parameter: null });
      dlg.remove();
      await saveSheet();
      announce(`Saved ${type}.`);
      opener.focus();
    });
  });

  renderFieldList();
  renderShelves();
  await runQuery();
}
