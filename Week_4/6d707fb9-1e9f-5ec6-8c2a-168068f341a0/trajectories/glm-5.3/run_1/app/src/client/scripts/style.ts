// The style screen: footprint panel with the strata band, score, dossier, passport.

import { announce, api, el, qs, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd, navigate } from "./app.js";
import { MEASURE_NAMES, STATE_NAMES, STAGE_NAMES, UI } from "./copy.js";
import { floatingPanel } from "./overlay.js";

interface MeasureFigure {
  measure: string;
  unit: string;
  total: string;
  totalShown: string;
  hotspot: string;
  stages: { stage: string; value: string; shown: string; share: string }[];
}

interface ResultOut {
  id: string;
  edition: string;
  workedOutAt: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  measures: MeasureFigure[];
  current: boolean;
}

interface StyleOut {
  id: string;
  labelId: string;
  labelName: string;
  name: string;
  styleCode: string | null;
  season: string;
  gtin: string;
  garment: string;
  washes: number;
  repairService: boolean | null;
  rangeSize: number | null;
  notes: string | null;
  state: string;
  version: number;
  changedAt: string;
  changedBy: string | null;
  latestResult: ResultOut | null;
  newerFactors: string | null;
  score: {
    state: string;
    score: number | null;
    per100g: number | null;
    runId: string | null;
    shown: string | null;
    worstCaseFacts: string[];
    busyUntil: string | null;
  };
  passport: { edition: number; state: string } | null;
  dossiers: { id: string; state: string; madeAt: string; signedOffBy: string | null; signedOffAt: string | null; edition: string }[];
}

const MEASURE_ORDER = ["climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres"];
const STAGE_ORDER = ["materials", "making", "transport", "use", "endOfLife"];

export function registerStyleScreen(ctx: RouteCtx): () => void {
  const styleId = location.pathname.split("/")[2];
  const main = ctx.main;
  const chosenResult = ctx.params.get("result");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  let currentMeasure = "climate";
  let band: HTMLElement | null = null;
  let tabstop: HTMLElement | null = null;

  const timer = window.setInterval(() => void load(false), 5000);

  async function load(first: boolean): Promise<void> {
    try {
      const style = await api<StyleOut>(`/api/styles/${styleId}`);
      refreshLine.hidden = true;
      if (first) {
        build(style);
      } else {
        refresh(style);
      }
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  function build(style: StyleOut): void {
    const h1 = el("h1", {}, style.name);
    const header = el("p", { class: "hint" },
      `${style.labelName} \u00B7 ${style.gtin} \u00B7 ${garmentName(style.garment)} \u00B7 ${STATE_NAMES[style.state] ?? style.state}`);
    const links = el("nav", { class: "row-controls", "aria-label": "Style screens" });
    links.append(
      linkTo(`Materials`, `/styles/${styleId}/materials`),
      linkTo(`Scenarios`, `/styles/${styleId}/scenarios`),
    );
    main.append(h1, refreshLine, header, links);

    const panel = el("section", { class: "panel", "aria-label": "Footprint" });
    band = el("div", { class: "strata-band", "data-part": "strata" });
    tabstop = buildMeasures();
    const figures = el("div", { class: "figures" });
    const total = el("p", { class: "figure" });
    total.setAttribute("data-part", "total-figure");
    const editionLine = el("p", { class: "hint" });
    const workBtn = el("button", { class: "btn btn-primary" }, "Work out footprint");
    const newerBtn = el("button", { class: "btn" }, "Check for newer factors");
    workBtn.addEventListener("click", () => void workOut(workBtn));
    newerBtn.addEventListener("click", () => void checkNewer(newerBtn));
    panel.append(tabstop, band, figures, total, editionLine, el("div", { class: "row-controls" }, workBtn, newerBtn));
    if (!style.latestResult) {
      const empty = el("div", { class: "empty-state" });
      empty.append(el("div", { class: "frag", "data-ui": "true", "aria-hidden": "true" }));
      const emptyBtn = el("button", { class: "btn btn-primary" }, "Work out footprint");
      emptyBtn.addEventListener("click", () => void workOut(emptyBtn));
      empty.append(emptyBtn);
      panel.textContent = "";
      panel.append(empty);
      band = null;
      tabstop = null;
    }
    main.append(panel);

    const scorePanel = el("section", { class: "panel", "aria-label": "Score" });
    const askBtn = el("button", { class: "btn" }, "Ask for score");
    askBtn.addEventListener("click", () => void askScore(askBtn));
    scorePanel.append(askBtn);
    main.append(scorePanel);

    const dossierPanel = el("section", { class: "panel", "aria-label": "Dossier" });
    const makeBtn = el("button", { class: "btn" }, "Make dossier");
    const dlBtn = el("button", { class: "btn" }, "Download dossier");
    const sendBtn = el("button", { class: "btn" }, "Send sign-off page");
    const resultsBtn = el("button", { class: "btn" }, "Download results file");
    dlBtn.addEventListener("click", () => {
      const latest = style.dossiers[0];
      if (latest) window.location.href = `/api/dossiers/${latest.id}/file`;
      announce(UI.downloaded);
    });
    resultsBtn.addEventListener("click", () => {
      window.location.href = `/api/styles/${styleId}/results-file`;
      announce(UI.resultsDownloaded);
    });
    sendBtn.addEventListener("click", () => void sendSignOff(sendBtn, style));
    makeBtn.addEventListener("click", () => void makeDossier(makeBtn));
    dossierPanel.append(makeBtn, el("div", { class: "row-controls" }, dlBtn, resultsBtn, sendBtn));
    main.append(dossierPanel);

    const passportPanel = el("section", { class: "panel", "aria-label": "Passport" });
    const pubBtn = el("button", { class: "btn" }, style.passport ? "Publish correction" : "Publish passport");
    pubBtn.addEventListener("click", () => void publish(pubBtn));
    passportPanel.append(pubBtn);
    main.append(passportPanel);

    const earlier = el("section", { class: "panel", "aria-label": "Earlier results" });
    earlier.append(el("h2", {}, "Earlier results"));
    main.append(earlier);

    const bar = el("div", { class: "bottom-bar" });
    const barBtn = el("button", { class: "btn btn-primary" }, "Work out footprint");
    barBtn.addEventListener("click", () => void workOut(barBtn));
    bar.append(barBtn);
    main.append(bar);

    renderAll(style);
  }

  function refresh(style: StyleOut): void {
    renderAll(style);
  }

  function renderAll(style: StyleOut): void {
    const result = style.latestResult;
    const measure = result?.measures.find((m) => m.measure === currentMeasure) ?? null;
    if (band && measure) renderStrata(measure, false);
    if (tabstop) {
      // Keep the composite in step with the chosen measure.
      for (const input of tabstop.querySelectorAll<HTMLInputElement>("input")) {
        input.checked = input.value === currentMeasure;
      }
    }
    const totalNode = main.querySelector<HTMLElement>("[data-part='total-figure']");
    if (totalNode && measure) {
      totalNode.textContent = `${MEASURE_NAMES[measure.measure]}: ${measure.totalShown}`;
    }
    const editionLine = main.querySelectorAll<HTMLElement>(".hint")[0];
    if (editionLine && result) {
      editionLine.textContent = `Factor edition ${result.edition} \u00B7 Data quality ${result.dataQualityGrade} (${result.dataQualityPercent}%)`;
    }
    const scorePanel = main.querySelector<HTMLElement>("[aria-label='Score']");
    if (scorePanel) {
      scorePanel.textContent = "";
      const askBtn = el("button", { class: "btn" }, "Ask for score");
      askBtn.addEventListener("click", () => void askScore(askBtn));
      scorePanel.append(askBtn);
      const score = style.score;
      if (score.state === "current" && score.shown) {
        scorePanel.append(el("p", { class: "figure" }, score.shown));
        for (const fact of score.worstCaseFacts) {
          const copy = fact === "repairService" ? `Worst-case value used for repair service.` : `Worst-case value used for range size.`;
          scorePanel.append(el("p", { class: "hint" }, copy));
        }
      } else if (score.state === "outdated") {
        scorePanel.append(el("p", { class: "hint" }, `Outdated`));
      } else if (score.state === "busy") {
        scorePanel.append(el("p", { class: "hint" }, `The score service is busy.`));
      }
    }
    const dossierPanel = main.querySelector<HTMLElement>("[aria-label='Dossier']");
    if (dossierPanel) {
      dossierPanel.textContent = "";
      const makeBtn = el("button", { class: "btn" }, "Make dossier");
      makeBtn.addEventListener("click", () => void makeDossier(makeBtn));
      const dlBtn = el("button", { class: "btn" }, "Download dossier");
      const sendBtn = el("button", { class: "btn" }, "Send sign-off page");
      const resultsBtn = el("button", { class: "btn" }, "Download results file");
      const latest = style.dossiers[0];
      dlBtn.addEventListener("click", () => {
        if (latest) window.location.href = `/api/dossiers/${latest.id}/file`;
        announce(UI.downloaded);
      });
      resultsBtn.addEventListener("click", () => {
        window.location.href = `/api/styles/${styleId}/results-file`;
        announce(UI.resultsDownloaded);
      });
      sendBtn.addEventListener("click", () => void sendSignOff(sendBtn, style));
      dossierPanel.append(makeBtn);
      if (latest) {
        const state = latest.state === "signedOff" && latest.signedOffBy
          ? `Signed off by ${latest.signedOffBy}`
          : latest.state;
        dossierPanel.append(el("p", {}, state));
      }
      dossierPanel.append(el("div", { class: "row-controls" }, dlBtn, resultsBtn, sendBtn));
    }
    const passportPanel = main.querySelector<HTMLElement>("[aria-label='Passport']");
    if (passportPanel) {
      passportPanel.textContent = "";
      const pubBtn = el("button", { class: "btn" }, style.passport ? "Publish correction" : "Publish passport");
      pubBtn.addEventListener("click", () => void publish(pubBtn));
      passportPanel.append(pubBtn);
      if (style.passport) {
        passportPanel.append(el("p", {}, `Edition ${style.passport.edition} \u00B7 ${STATE_NAMES[style.passport.state] ?? style.passport.state}`));
        const view = el("a", { href: `/p/${style.gtin}` }, `Read the passport`);
        passportPanel.append(view);
      }
    }
    const earlier = main.querySelector<HTMLElement>("[aria-label='Earlier results']");
    if (earlier) {
      earlier.textContent = "";
      earlier.append(el("h2", {}, "Earlier results"));
      void api<{ results: ResultOut[] }>(`/api/styles/${styleId}/results`).then((out) => {
        for (const result of out.results) {
          if (!result.current) {
            const a = el("a", { href: `/styles/${styleId}?result=${result.id}` }, `${result.edition} \u00B7 ${result.workedOutAt}`);
            earlier.append(el("p", {}, a));
          }
        }
      });
    }
    const newerNode = main.querySelector<HTMLElement>("[data-part='newer-factors']");
    if (newerNode) newerNode.textContent = style.newerFactors ? `Newer factors available (${style.newerFactors}).` : "";
  }

  function buildMeasures(): HTMLElement {
    const fieldset = el("fieldset");
    fieldset.className = "measure-tabs";
    fieldset.setAttribute("role", "radiogroup");
    fieldset.setAttribute("aria-label", "Measure");
    for (const id of MEASURE_ORDER) {
      const label = el("label", { class: "radio" });
      const input = el("input", { type: "radio", name: "measure", value: id });
      input.checked = id === currentMeasure;
      input.addEventListener("change", () => chooseMeasure(id, true));
      label.append(input, MEASURE_NAMES[id]);
      fieldset.append(label);
    }
    fieldset.addEventListener("keydown", (e) => {
      const idx = MEASURE_ORDER.indexOf(currentMeasure);
      const go = (next: number): void => {
        e.preventDefault();
        const id = MEASURE_ORDER[(next + MEASURE_ORDER.length) % MEASURE_ORDER.length];
        const input = fieldset.querySelector<HTMLInputElement>(`input[value='${id}']`);
        input!.checked = true;
        chooseMeasure(id, true);
      };
      if (e.key === "ArrowRight" || (e.key === "ArrowDown" && window.innerWidth < 421)) go(idx + 1);
      if (e.key === "ArrowLeft" || (e.key === "ArrowUp" && window.innerWidth < 421)) go(idx - 1);
      if (e.key === "Home") go(0);
      if (e.key === "End") go(MEASURE_ORDER.length - 1);
      if (e.key === "Enter") openFactors(currentMeasure);
    });
    return fieldset;
  }

  async function chooseMeasure(id: string, announceIt: boolean): Promise<void> {
    currentMeasure = id;
    try {
      const style = await api<StyleOut>(`/api/styles/${styleId}`);
      const measure = style.latestResult?.measures.find((m) => m.measure === id) ?? null;
      if (measure && band) renderStrata(measure, true);
      const totalNode = main.querySelector<HTMLElement>("[data-part='total-figure']");
      if (totalNode && measure) totalNode.textContent = `${MEASURE_NAMES[id]}: ${measure.totalShown}`;
      if (announceIt && measure) {
        announce(`${MEASURE_NAMES[id]}: ${measure.totalShown}, hotspot ${STAGE_NAMES[measure.hotspot]}.`);
      }
    } catch (err) {
      if ((err as { status?: number }).status === 401) handleSessionEnd();
    }
  }

  function renderStrata(measure: MeasureFigure, animate: boolean): void {
    if (!band) return;
    const existing = [...band.querySelectorAll<HTMLElement>("[data-part='stratum']")];
    if (existing.length === 0) {
      for (const stage of STAGE_ORDER) {
        const data = measure.stages.find((s) => s.stage === stage);
        const stratum = el("button", {
          class: `stratum weave-${stage}`,
          "data-part": "stratum",
          "data-stage": stage,
          "data-share": data?.share ?? "0.0",
          type: "button",
        });
        stratum.style.flexBasis = `${data?.share ?? 0}%`;
        const fill = el("span", { class: "stratum-fill" });
        fill.append(el("span", { class: "stratum-name num" }, `${STAGE_NAMES[stage]} ${data?.shown ?? "0"}`));
        fill.append(el("span", { class: "num stratum-figure", "data-part": "stratum-figure", "data-stage": stage }, data?.shown ?? "0"));
        stratum.append(fill);
        stratum.addEventListener("click", () => openFactors(currentMeasure, stage));
        band!.append(stratum);
      }
      const marker = el("span", { class: "hotspot-marker", "data-part": "hotspot-marker", "data-stage": measure.hotspot });
      band.append(marker);
    } else {
      for (const stage of STAGE_ORDER) {
        const data = measure.stages.find((s) => s.stage === stage);
        const stratum = existing.find((n) => n.dataset.stage === stage);
        if (!stratum) continue;
        if (animate) stratum.style.flexBasis = `${data?.share ?? 0}%`;
        else stratum.style.flexBasis = `${data?.share ?? 0}%`;
        stratum.dataset.share = data?.share ?? "0.0";
        const figure = stratum.querySelector<HTMLElement>("[data-part='stratum-figure']");
        if (figure) figure.textContent = data?.shown ?? "0";
        const nameSpan = stratum.querySelector<HTMLElement>(".stratum-name");
        if (nameSpan) nameSpan.textContent = `${STAGE_NAMES[stage]} ${data?.shown ?? "0"}`;
      }
      const marker = band.querySelector<HTMLElement>("[data-part='hotspot-marker']");
      if (marker) marker.dataset.stage = measure.hotspot;
    }
    void animate;
  }

  async function openFactors(measureId: string, stageHint?: string): Promise<void> {
    const style = await api<StyleOut>(`/api/styles/${styleId}`);
    const result = style.latestResult;
    if (!result) return;
    const measure = result.measures.find((m) => m.measure === measureId);
    if (!measure) return;
    const stage = stageHint ?? measure.hotspot;
    const opener = main.querySelector<HTMLElement>(".measure-tabs");
    const panel = floatingPanel(opener ?? main, (root) => {
      root.className = "popover";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", `Factors for ${STAGE_NAMES[stage]}`);
      root.append(el("h2", {}, `Factors for ${STAGE_NAMES[stage]}`));
      root.append(el("p", { class: "hint" }, `Factor edition ${result.edition}`));
      void api<{ rows: { id: string; kind: string; value: string; unit: string }[] }>(
        `/api/results/${result.id}/factors?measure=${measureId}&stage=${stage}`,
      ).then((out) => {
        for (const row of out.rows) {
          root.append(el("p", { class: "num" }, `${rowName(row.id, row.kind)}: ${row.value} ${row.unit}`));
        }
      });
      const next = el("button", { class: "btn" }, "Next stage");
      next.addEventListener("click", () => {
        const idx = STAGE_ORDER.indexOf(stage);
        const nextStage = STAGE_ORDER[(idx + 1) % STAGE_ORDER.length];
        panel.remove();
        void openFactors(measureId, nextStage);
      });
      const close = el("button", { class: "btn" }, "Close");
      close.addEventListener("click", () => {
        panel.remove();
        opener?.focus();
      });
      root.append(el("div", { class: "dialog-foot" }, next, close));
    });
  }

  async function workOut(button: HTMLElement): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        const out = await api<ResultOut>(`/api/styles/${styleId}/results`, { method: "POST" });
        announce(UI.footprintWorked(out.edition));
        await load(false);
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function checkNewer(button: HTMLElement): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        const out = await api<{ editions: { edition: string; validFrom: string }[]; newestInEffect: string; checkedAt: string }>("/api/factors/check", { method: "POST" });
        const style = await api<StyleOut>(`/api/styles/${styleId}`);
        const message = style.newerFactors
          ? `Newer factors available (${style.newerFactors}).`
          : `No newer factors.`;
        announce(message);
        void out;
      } catch (err) {
        announce((err as { message?: string }).message ?? `Something went wrong.`);
      }
    });
  }

  async function askScore(button: HTMLElement): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        const out = await api<{ shown: string }>(`/api/styles/${styleId}/score`, { method: "POST" });
        announce(out.shown);
        await load(false);
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function makeDossier(button: HTMLElement): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        await api(`/api/styles/${styleId}/dossiers`, { method: "POST" });
        announce(UI.dossierReady);
        await load(false);
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function sendSignOff(button: HTMLElement, style: StyleOut): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        const latest = style.dossiers[0];
        if (!latest) {
          announce(`Work out the footprint first.`);
          return;
        }
        await api(`/api/dossiers/${latest.id}/sign-off-page`, { method: "POST" });
        announce(UI.signOffSent(style.labelName));
      } catch (err) {
        announce((err as { message?: string }).message ?? `Something went wrong.`);
      }
    });
  }

  async function publish(button: HTMLElement): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        const out = await api<{ edition: number }>(`/api/styles/${styleId}/passport`, { method: "POST" });
        announce(UI.published(out.edition));
        await load(false);
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  void load(true);

  return () => window.clearInterval(timer);
}

function garmentName(id: string): string {
  const names: Record<string, string> = { tshirt: "T-shirt", shirt: "Shirt", jeans: "Jeans", coat: "Coat" };
  return names[id] ?? id;
}

function rowName(id: string, kind: string): string {
  if (kind === "material") {
    const names: Record<string, string> = {
      "organic-cotton": "Organic cotton",
      cotton: "Cotton",
      "recycled-cotton": "Recycled cotton",
      linen: "Linen",
      wool: "Wool",
      "recycled-wool": "Recycled wool",
      polyester: "Polyester",
      "recycled-polyester": "Recycled polyester",
      viscose: "Viscose",
      lyocell: "Lyocell",
      nylon: "Nylon",
      elastane: "Elastane",
    };
    return names[id] ?? id;
  }
  if (kind === "grid") {
    const names: Record<string, string> = {
      PT: "Portugal",
      TR: "Turkey",
      VN: "Vietnam",
      EG: "Egypt",
      IN: "India",
      BD: "Bangladesh",
    };
    return names[id] ?? id;
  }
  if (kind === "mode") {
    const names: Record<string, string> = { sea: "Sea", road: "Road", rail: "Rail", air: "Air" };
    return names[id] ?? id;
  }
  if (kind === "use") return "Wash";
  return "Disposal";
}

function linkTo(label: string, href: string): HTMLElement {
  const a = el("a", { href, class: "nav-link" }, label);
  return a;
}
