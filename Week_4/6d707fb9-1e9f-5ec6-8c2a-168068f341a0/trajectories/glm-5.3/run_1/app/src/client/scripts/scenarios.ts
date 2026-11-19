// Scenarios: live totals from the server after a 300 ms pause, the address holds the changes.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { MEASURE_NAMES, MODE_NAMES, STAGE_NAMES, UI } from "./copy.js";
import { overlayClose, overlayOpen } from "./overlay.js";

interface MeasureFigure {
  measure: string;
  unit: string;
  total: string;
  totalShown: string;
  hotspot: string;
  stages: { stage: string; value: string; shown: string; share: string }[];
}

interface StyleOut {
  id: string;
  name: string;
  latestResult: { id: string; measures: MeasureFigure[] } | null;
  legs: { id: string; mode: string; km: string }[];
  lines: { id: string; position: number; materialId: string; materialName: string; massGrams: string }[];
}

const MEASURE_ORDER = ["climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres"];
const STAGE_ORDER = ["materials", "making", "transport", "use", "endOfLife"];

export function registerScenariosScreen(ctx: RouteCtx): () => void {
  const styleId = location.pathname.split("/")[2];
  const main = ctx.main;
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);

  const change = {
    recycled: new Map<string, number>(),
    material: new Map<string, string>(),
    factory: new Map<string, string>(),
    mode: new Map<number, string>(),
  };

  const timer = window.setInterval(() => void load(false), 5000);

  async function load(first: boolean): Promise<StyleOut | null> {
    try {
      const style = await api<StyleOut>(`/api/styles/${styleId}`);
      refreshLine.hidden = true;
      if (first) {
        const h1 = el("h1", {}, `Scenarios for ${style.name}`);
        main.append(h1, refreshLine);
        build(style);
      } else {
        refresh(style);
      }
      return style;
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
      return null;
    }
  }

  function build(style: StyleOut): void {
    const controls = el("section", { class: "panel", "aria-label": "Changes" });
    for (const line of style.lines) {
      const wrap = el("div", { class: "field" });
      wrap.append(el("span", {}, line.materialName));
      const slider = el("input", { type: "range", min: "0", max: "100", step: "5", "aria-label": `Recycled share for ${line.materialName}` });
      slider.addEventListener("input", () => {
        change.recycled.set(line.id, Number.parseInt(slider.value, 10));
        schedule();
      });
      const matSel = el("select", { "aria-label": `Material for ${line.materialName}` });
      for (const m of MATERIAL_LIST) matSel.append(el("option", { value: m.id }, m.name));
      matSel.value = line.materialId;
      matSel.addEventListener("change", () => {
        change.material.set(line.id, matSel.value);
        commit();
        schedule();
      });
      const facSel = el("select", { "aria-label": `Factory country for ${line.materialName}` });
      for (const [code, name] of COUNTRY_LIST) facSel.append(el("option", { value: code }, name));
      facSel.addEventListener("change", () => {
        change.factory.set(line.id, facSel.value);
        commit();
        schedule();
      });
      wrap.append(slider, matSel, facSel);
      controls.append(wrap);
    }
    for (const [i, leg] of style.legs.entries()) {
      const wrap = el("div", { class: "field" });
      wrap.append(el("span", {}, `${MODE_NAMES[leg.mode] ?? leg.mode} ${leg.km} km`));
      const modeSel = el("select", { "aria-label": `Mode for leg ${i}` });
      for (const [id, name] of [["sea", "Sea"], ["road", "Road"], ["rail", "Rail"], ["air", "Air"]] as [string, string][]) {
        modeSel.append(el("option", { value: id }, name));
      }
      modeSel.value = leg.mode;
      modeSel.addEventListener("change", () => {
        change.mode.set(i, modeSel.value);
        commit();
        schedule();
      });
      wrap.append(modeSel);
      controls.append(wrap);
    }

    const bandWrap = el("div", { class: "panel", "aria-label": "Scenario band" });
    const ghost = el("div", { class: "strata-band ghost-strata", "data-part": "ghost-strata" });
    const live = el("div", { class: "strata-band", "data-part": "strata" });
    bandWrap.append(ghost, live);

    const comparison = el("div", { class: "table-frame", role: "region", "aria-label": "Comparison", tabindex: "0" });
    const table = el("table");
    const thead = el("thead");
    const trh = el("tr");
    for (const h of ["Measure", "Scenario total", "Difference"]) trh.append(el("th", {}, h));
    thead.append(trh);
    const tbody = el("tbody");
    table.append(thead, tbody);
    comparison.append(table);

    const saveBtn = el("button", { class: "btn btn-primary" }, "Save scenario");
    saveBtn.addEventListener("click", () => void openSave(saveBtn));

    const savedList = el("section", { class: "panel", "aria-label": "Saved scenarios" });
    savedList.append(el("h2", {}, "Saved scenarios"));

    const bar = el("div", { class: "bottom-bar" });
    bar.append(saveBtn.cloneNode(true));

    main.append(controls, bandWrap, comparison, saveBtn, savedList, bar);
    void readAddress();
    void refreshSaved();
  }

  function refresh(style: StyleOut): void {
    void style;
  }

  async function refreshSaved(): Promise<void> {
    const list = main.querySelector<HTMLElement>("[aria-label='Saved scenarios']");
    if (!list) return;
    list.textContent = "";
    list.append(el("h2", {}, "Saved scenarios"));
    try {
      const out = await api<{ scenarios: { id: string; name: string; savedAt: string }[] }>(`/api/styles/${styleId}/scenarios`);
      for (const s of out.scenarios) {
        list.append(el("p", {}, el("strong", {}, s.name), ` \u00B7 ${s.savedAt}`));
      }
    } catch {
      /* the last list stays */
    }
  }

  function readAddress(): void {
    const params = new URLSearchParams(location.search);
    change.recycled.clear();
    change.material.clear();
    change.factory.clear();
    change.mode.clear();
    for (const value of params.getAll("recycled")) {
      const [lineId, percent] = value.split(":");
      change.recycled.set(lineId, Number.parseInt(percent, 10));
    }
    for (const value of params.getAll("material")) {
      const [lineId, materialId] = value.split(":");
      change.material.set(lineId, materialId);
    }
    for (const value of params.getAll("factory")) {
      const [lineId, country] = value.split(":");
      change.factory.set(lineId, country);
    }
    for (const value of params.getAll("mode")) {
      const [index, mode] = value.split(":");
      change.mode.set(Number.parseInt(index, 10), mode);
    }
  }

  function addressOf(): string {
    const params = new URLSearchParams();
    for (const [lineId, percent] of change.recycled) params.append("recycled", `${lineId}:${percent}`);
    for (const [lineId, materialId] of change.material) params.append("material", `${lineId}:${materialId}`);
    for (const [lineId, country] of change.factory) params.append("factory", `${lineId}:${country}`);
    for (const [index, mode] of change.mode) params.append("mode", `${index}:${mode}`);
    const q = params.toString();
    return `/styles/${styleId}/scenarios${q.length > 0 ? `?${q}` : ""}`;
  }

  function commit(): void {
    history.pushState(null, "", addressOf());
  }

  let requestToken = 0;
  let pauseTimer: number | null = null;
  function schedule(): void {
    if (pauseTimer !== null) clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(() => {
      const token = ++requestToken;
      void run(token);
    }, 300);
  }

  async function run(token: number): Promise<void> {
    try {
      const style = await api<StyleOut>(`/api/styles/${styleId}`);
      const resultId = style.latestResult?.id;
      if (!resultId) return;
      const body = {
        resultId,
        recycled: [...change.recycled].map(([lineId, percent]) => ({ lineId, percent })),
        materialSwaps: [...change.material].map(([lineId, materialId]) => ({ lineId, materialId })),
        factorySwaps: [...change.factory].map(([lineId, country]) => ({ lineId, country })),
        legModes: [...change.mode].map(([legIndex, mode]) => ({ legIndex, mode })),
      };
      const out = await api<{ measures: MeasureFigure[]; differences: { measure: string; shown: string }[] }>(
        `/api/styles/${styleId}/scenarios/preview`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (token !== requestToken) return;
      renderBands(style, out.measures);
      renderComparison(out.measures, out.differences, style);
      const climate = out.measures.find((m) => m.measure === "climate");
      if (climate) announce(UI.scenarioTotal(climate.totalShown));
    } catch (err) {
      const failure = err as { status?: number; message?: string };
      if (failure.status === 401) handleSessionEnd();
      else announce(failure.message ?? `Something went wrong.`);
    }
  }

  function renderBands(style: StyleOut, measures: MeasureFigure[]): void {
    const live = main.querySelector<HTMLElement>("[data-part='strata']");
    const ghost = main.querySelector<HTMLElement>(".ghost-strata");
    const climate = measures.find((m) => m.measure === "climate");
    const baseline = style.latestResult?.measures.find((m) => m.measure === "climate");
    if (live && climate) {
      live.textContent = "";
      for (const stage of STAGE_ORDER) {
        const data = climate.stages.find((s) => s.stage === stage);
        const stratum = el("div", {
          class: `stratum weave-${stage}`,
          "data-part": "stratum",
          "data-stage": stage,
          "data-share": data?.share ?? "0.0",
        });
        stratum.style.flexBasis = `${data?.share ?? 0}%`;
        stratum.append(el("span", { class: "num" }, `${STAGE_NAMES[stage]} ${data?.shown ?? "0"}`));
        live.append(stratum);
      }
    }
    if (ghost && baseline) {
      ghost.textContent = "";
      for (const stage of STAGE_ORDER) {
        const data = baseline.stages.find((s) => s.stage === stage);
        const stratum = el("div", {
          class: `stratum weave-${stage}`,
          "data-part": "ghost-stratum",
          "data-stage": stage,
          "data-share": data?.share ?? "0.0",
        });
        stratum.style.flexBasis = `${data?.share ?? 0}%`;
        stratum.append(el("span", { class: "num" }, `${STAGE_NAMES[stage]} ${data?.shown ?? "0"}`));
        ghost.append(stratum);
      }
    }
  }

  function renderComparison(measures: MeasureFigure[], differences: { measure: string; shown: string }[], style: StyleOut): void {
    const tbody = main.querySelector("tbody");
    if (!tbody) return;
    tbody.textContent = "";
    for (const id of MEASURE_ORDER) {
      const m = measures.find((x) => x.measure === id);
      const d = differences.find((x) => x.measure === id);
      const base = style.latestResult?.measures.find((x) => x.measure === id);
      const tr = el("tr");
      tr.append(
        el("td", {}, MEASURE_NAMES[id]),
        el("td", { class: "num" }, m?.totalShown ?? "\u2014"),
        el("td", { class: "num" }, `${d?.shown ?? "no change"} (baseline ${base?.totalShown ?? "\u2014"})`),
      );
      tbody.append(tr);
    }
  }

  async function openSave(opener: HTMLElement): Promise<void> {
    const style = await api<StyleOut>(`/api/styles/${styleId}`);
    const resultId = style.latestResult?.id;
    if (!resultId) return;
    const body = overlayOpen({ label: "Save scenario", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const name = el("input", { type: "text", "aria-label": "Name" });
    const save = el("button", { class: "btn btn-primary" }, "Save");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(el("label", { class: "field" }, el("span", {}, "Name"), name), el("div", { class: "dialog-foot" }, save, close));
    save.addEventListener("click", async () => {
      await withWorking(save, UI.working, async () => {
        try {
          await api(`/api/styles/${styleId}/scenarios`, {
            method: "POST",
            body: JSON.stringify({
              name: name.value,
              resultId,
              recycled: [...change.recycled].map(([lineId, percent]) => ({ lineId, percent })),
              materialSwaps: [...change.material].map(([lineId, materialId]) => ({ lineId, materialId })),
              factorySwaps: [...change.factory].map(([lineId, country]) => ({ lineId, country })),
              legModes: [...change.mode].map(([legIndex, mode]) => ({ legIndex, mode })),
            }),
          });
          announce(UI.scenarioSaved(name.value));
          overlayClose(dialog, opener);
          await refreshSaved();
        } catch (err) {
          const failure = err as { message?: string; status?: number };
          if (failure.status === 401) handleSessionEnd();
          else announce(failure.message ?? `Something went wrong.`);
        }
      });
    });
  }

  void load(true);
  void run(++requestToken);

  return () => {
    window.clearInterval(timer);
    if (pauseTimer !== null) clearTimeout(pauseTimer);
  };
}

const MATERIAL_LIST: { id: string; name: string }[] = [
  { id: "organic-cotton", name: "Organic cotton" },
  { id: "cotton", name: "Cotton" },
  { id: "recycled-cotton", name: "Recycled cotton" },
  { id: "linen", name: "Linen" },
  { id: "wool", name: "Wool" },
  { id: "recycled-wool", name: "Recycled wool" },
  { id: "polyester", name: "Polyester" },
  { id: "recycled-polyester", name: "Recycled polyester" },
  { id: "viscose", name: "Viscose" },
  { id: "lyocell", name: "Lyocell" },
  { id: "nylon", name: "Nylon" },
  { id: "elastane", name: "Elastane" },
];

const COUNTRY_LIST: [string, string][] = [
  ["PT", "Portugal"],
  ["TR", "Turkey"],
  ["VN", "Vietnam"],
  ["EG", "Egypt"],
  ["IN", "India"],
  ["BD", "Bangladesh"],
];
