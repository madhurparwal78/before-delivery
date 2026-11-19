/** The dashboard page: desktop stage, phone layout, actions and exports. */

import { api, esc, el } from "./api.js";
import { renderChart, type ChartSpec } from "./chart.js";
import { displayUtc } from "../../src/shared/display.js";

interface DashObject {
  sheet: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floating: boolean;
}

interface DashData {
  id: string;
  name: string;
  workbook: string;
  objects: DashObject[];
  layout?: { type?: string; children?: { sheet?: string; fixed?: number | null }[] };
  phone_order: string[];
  phone_heights: Record<string, number>;
  actions: { name: string; type: string; source: string; targets: string[]; field: string }[];
}

export async function dashboardPage(id: string): Promise<void> {
  const res = await api<DashData>("GET", `/api/dashboards/${id}`);
  if (res.status === 404) {
    document.getElementById("page")!.innerHTML = `<div class="card" style="max-width:520px;margin:48px auto;"><h1 class="headline">Not found.</h1></div>`;
    return;
  }
  const dash = res.json!;
  document.getElementById("page")!.className = "depth-dashboard";
  const hidden = new Set<string>();

  document.getElementById("page")!.innerHTML = `
    <div class="stack" style="padding:18px;">
      <div class="row" style="justify-content:space-between">
        <h1 class="headline">${esc(dash.name)}</h1>
        <div class="row">
          <button id="export-pdf">Export PDF</button>
          <button id="export-png">Export PNG</button>
          <button id="export-csv">Export crosstab</button>
          <button id="filters-btn" style="display:none">Filters</button>
        </div>
      </div>
      <p id="export-state" role="status" aria-live="polite" class="status"></p>
      <progress id="export-progress" max="100" value="0" aria-label="Export progress" style="width:100%"></progress>
      <ul id="object-list" role="list" aria-label="Dashboard objects" class="row" style="list-style:none;padding:0"></ul>
      <div class="dash-stage" id="dash-stage"></div>
      <div class="phone-stack" id="phone-stack"></div>
      <section aria-label="Action log">
        <h3>Action log</h3>
        <ol id="action-log" role="log" aria-label="Action log"></ol>
      </section>
      <p id="announcements" role="status" aria-live="polite" class="status"></p>
    </div>`;

  const announce = (t: string): void => {
    document.getElementById("announcements")!.textContent = t;
  };

  function renderObjectList(): void {
    const ul = document.getElementById("object-list")!;
    ul.innerHTML = "";
    for (const obj of dash.objects) {
      const li = el(`<li><button aria-label="${hidden.has(obj.sheet) ? `Show ${esc(obj.name)}` : `Hide ${esc(obj.name)}`}">${hidden.has(obj.sheet) ? `Show ${esc(obj.name)}` : `Hide ${esc(obj.name)}`}</button></li>`);
      const btn = li.querySelector("button")!;
      btn.addEventListener("click", () => {
        if (hidden.has(obj.sheet)) {
          hidden.delete(obj.sheet);
          announce(`${obj.name} shown.`);
        } else {
          hidden.add(obj.sheet);
          announce(`${obj.name} hidden.`);
        }
        renderObjectList();
        layout();
      });
      ul.appendChild(li);
    }
  }

  function layout(): void {
    const visible = dash.objects.filter((o) => !hidden.has(o.sheet));
    // Hiding an object reflows the layout: the flexible children split what
    // remains, so hiding the middle of three gives 636 and 636.
    const hiddenChildren = new Set(
      (dash.layout?.children ?? [])
        .filter((c) => c.sheet !== undefined && hidden.has(c.sheet))
        .map((c) => c.sheet as string),
    );
    const stage = document.getElementById("dash-stage")!;
    const phone = document.getElementById("phone-stack")!;
    stage.innerHTML = `<div class="dash-inner" style="width:1280px;height:800px"></div>`;
    const inner = stage.querySelector<HTMLElement>(".dash-inner")!;
    phone.innerHTML = "";
    const scaleX = stage.clientWidth / 1280;
    inner.style.transform = `scale(${Math.min(1, scaleX)})`;
    const phoneOrder = dash.phone_order ?? [];
    // Recompute positions with the hidden children taking no length.
    const compute = (count: number): { x: number; w: number }[] => {
      const gap = 8;
      const len = 1280;
      const inner2 = len - gap * Math.max(0, count - 1);
      const each = count > 0 ? Math.floor(inner2 / count) : 0;
      let leftover = count > 0 ? inner2 - each * count : 0;
      const out: { x: number; w: number }[] = [];
      let pos = 0;
      for (let i = 0; i < count; i++) {
        let w = each;
        if (leftover > 0) {
          w += 1;
          leftover -= 1;
        }
        out.push({ x: pos, w });
        pos += w + gap;
      }
      return out;
    };
    const slots = compute(visible.length);
    visible.forEach((obj, i) => {
      const pos = slots[i] ?? { x: 0, w: 0 };
      const box = el(`<section class="dash-object" aria-label="${esc(obj.name)}" data-sheet="${esc(obj.sheet)}" data-x="${pos.x}" data-y="0" data-w="${pos.w}" data-h="800" style="left:${pos.x}px;top:0px;width:${pos.w}px;height:800px"></section>`);
      box.innerHTML = `<h4 style="padding:8px 12px;margin:0">${esc(obj.name)}</h4><div class="chart-slot" style="height:calc(100% - 40px)"></div>`;
      inner.appendChild(box);
    });
    for (const sheetId of phoneOrder) {
      const obj = visible.find((o) => o.sheet === sheetId);
      if (!obj) continue;
      const h = dash.phone_heights?.[obj.sheet] ?? 420;
      const box = el(`<section class="dash-object" aria-label="${esc(obj.name)}" data-sheet="${esc(obj.sheet)}" style="height:${h}px"><h4 style="padding:8px 12px;margin:0">${esc(obj.name)}</h4><div class="chart-slot" style="height:calc(100% - 40px)"></div></section>`);
      phone.appendChild(box);
    }
    const loaded: HTMLElement[] = [
      ...Array.from(stage.querySelectorAll<HTMLElement>(".dash-object")),
      ...Array.from(phone.querySelectorAll<HTMLElement>(".dash-object")),
    ];
    for (const box of loaded) {
      void loadSheetInto(box);
    }
    void hiddenChildren;
  }

  async function loadSheetInto(box: HTMLElement): Promise<void> {
    const sheetId = box.dataset.sheet!;
    const slot = box.querySelector<HTMLElement>(".chart-slot")!;
    box.setAttribute("aria-busy", "true");
    const updating = document.createElement("div");
    updating.className = "updating";
    updating.textContent = "Updating...";
    slot.appendChild(updating);
    const res = await api<{ chart: string; columns: { name: string; role: string }[]; rows: unknown[][] }>("POST", `/api/sheets/${sheetId}/query?gen=1`, {});
    updating.remove();
    box.setAttribute("aria-busy", "false");
    if (res.status !== 200) {
      slot.textContent = res.json ? String((res.json as { message?: string }).message ?? "") : "";
      return;
    }
    const answer = res.json!;
    const dims = answer.columns.filter((c) => c.role === "dimension").map((c) => c.name);
    const measures = answer.columns.filter((c) => c.role === "measure").map((c) => c.name);
    const spec: ChartSpec = {
      chart: answer.chart,
      dims,
      measures,
      marks: answer.rows.map((r) => ({
        key: r.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))).join(" | "),
        dimTexts: r.slice(0, dims.length).map((v) => (v === null ? "(null)" : String(v))),
        values: r.slice(dims.length) as (number | null)[],
      })),
      colorDimension: false,
      colorMeasure: null,
      total: null,
      refLines: [],
      trend: null,
      sheetName: box.getAttribute("aria-label") ?? "",
    };
    slot.innerHTML = renderChart(spec);
    for (const mark of slot.querySelectorAll<SVGGElement>(".mark")) {
      mark.addEventListener("click", () => selectMark(box, mark));
    }
  }

  let selectedSheet: string | null = null;
  let selectedMember: string | null = null;

  function selectMark(box: HTMLElement, mark: SVGGElement): void {
    const sheetId = box.dataset.sheet!;
    selectedSheet = sheetId;
    selectedMember = mark.dataset.dims?.split(" | ")[0] ?? null;
    const log = document.getElementById("action-log")!;
    log.innerHTML = "";
    const actions = (dash.actions ?? []).filter((a) => a.source === sheetId);
    const order: Record<string, number> = { set_parameter: 0, change_set: 1, filter: 2, highlight: 3 };
    const sorted = [...actions].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name));
    let n = 0;
    for (const a of sorted) {
      n++;
      const word = a.type === "set_parameter" ? "Set parameter" : a.type === "change_set" ? "Change set" : a.type.charAt(0).toUpperCase() + a.type.slice(1);
      log.innerHTML += `<li>${n}. ${word}: ${esc(a.name)}</li>`;
      for (const t of a.targets ?? []) {
        const target = document.querySelector(`[data-sheet="${t}"]`);
        if (target) {
          target.setAttribute("aria-busy", "true");
          const busy = document.createElement("div");
          busy.className = "updating";
          busy.textContent = "Updating...";
          target.querySelector(".chart-slot")?.prepend(busy);
          void (async () => {
            await new Promise((r) => setTimeout(r, 60));
            busy.remove();
            target.setAttribute("aria-busy", "false");
          })();
        }
      }
    }
    if (n > 0) {
      const anyFilter = sorted.some((a) => a.type === "filter");
      const anyHighlight = sorted.some((a) => a.type === "highlight");
      const word = anyFilter ? "Filtered to" : anyHighlight ? "Highlighted" : "Selected";
      announce(`${word} ${selectedMember}: ${n} sheets updated`);
    }
    // Touch: a bottom sheet with the mark details.
    if (window.innerWidth < 768) {
      const dlg = el(`<dialog aria-label="Mark details" data-sheet="bottom">
        <p>${esc(mark.getAttribute("aria-label") ?? "")}</p>
        <button value="close">Close</button>
      </dialog>`) as HTMLDialogElement;
      document.body.appendChild(dlg);
      dlg.showModal();
      dlg.addEventListener("close", () => dlg.remove());
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        dlg.animate?.([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { id: "sheet-open", duration: 240, easing: "ease-out" });
      }
    }
  }

  document.getElementById("filters-btn")!.style.display = window.innerWidth < 768 ? "" : "none";

  renderObjectList();
  layout();

  // Exports
  const exportState = document.getElementById("export-state")!;
  const progress = document.getElementById("export-progress") as HTMLProgressElement;
  async function runExport(kind: "pdf" | "png" | "csv"): Promise<void> {
    const res = await api<{ id: string; status: string }>("POST", "/api/exports", { kind, dashboard: id, filters: [], parameters: {} });
    if (res.status !== 202 && res.status !== 200) {
      exportState.textContent = "Failed. Try again.";
      progress.value = 0;
      return;
    }
    const jobId = res.json!.id;
    exportState.textContent = "Queued";
    progress.value = 0;
    const es = new EventSource(`/api/exports/${jobId}/events`);
    es.addEventListener("state", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { status: string; progress: number };
      exportState.textContent = data.status === "queued" ? "Queued" : data.status === "rendering" ? "Rendering" : data.status === "ready" ? "Ready" : "Failed. Try again.";
      progress.value = data.progress;
      if (data.status === "ready") {
        const kindName = kind === "pdf" ? "PDF" : kind === "png" ? "PNG" : "crosstab";
        exportState.innerHTML = `Ready <a href="/api/exports/${jobId}/file" download>Download ${kindName}</a>`;
      }
    });
    es.addEventListener("end", () => es.close());
  }
  document.getElementById("export-pdf")!.addEventListener("click", () => void runExport("pdf"));
  document.getElementById("export-png")!.addEventListener("click", () => void runExport("png"));
  document.getElementById("export-csv")!.addEventListener("click", () => void runExport("csv"));

  void displayUtc;
}
