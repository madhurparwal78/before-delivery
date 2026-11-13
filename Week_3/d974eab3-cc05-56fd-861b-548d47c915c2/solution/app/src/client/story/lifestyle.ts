import type { Content, Scenario } from "../../shared/content.js";
import { isScenarioId, modeOf, scenariosOfMode, type Mode, type ScenarioId } from "../../shared/scenarios.js";
import { announce } from "../announce.js";
import { loadScenario } from "../api.js";
import { scene } from "../art/scenes.js";
import { LIFESTYLE_LEAD, LIFESTYLE_TITLE, SCENARIO_ALERT } from "../copy.js";
import { h } from "../dom.js";
import { icon } from "../icons.js";
import { play } from "../motion.js";
import { createRadioGroup } from "../radios.js";
import { Meridian, type ScenarioRequest } from "./meridian.js";

const SWIPE_MIN_PX = 50;
const CROSSFADE_MS = 350;
const SLIDE_MS = 350;
const SLIDE_PX = 20;

function isMode(value: string): value is Mode {
  return value === "on" || value === "off";
}

/** The scenario named in the address, if it is one of the eight; otherwise the first ON scenario. */
function startScenario(): ScenarioId {
  const named = new URLSearchParams(location.search).get("scenario");
  return named !== null && isScenarioId(named) ? named : scenariosOfMode("on")[0];
}

function writeAddress(id: ScenarioId): void {
  const url = new URL(location.href);
  if (url.searchParams.get("scenario") === id) return;
  url.searchParams.set("scenario", id);
  history.replaceState(null, "", url);
}

const MODE_LABEL: Record<Mode, string> = { on: "ON", off: "OFF" };

/** The ON/OFF Meridian. `mount` places the marker and starts loading the scenario shown at page start. */
export function createLifestyle({ scenarios }: Content, reveal: (heading: HTMLElement) => void, signal: AbortSignal) {
  const start = startScenario();
  const meridian = new Meridian(start);
  const momentOptions = (mode: Mode): { value: string; label: string }[] =>
    scenarios.filter((scenario) => scenario.mode === mode).map(({ id, name }) => ({ value: id, label: name }));

  const modes = createRadioGroup({
    label: "Mode", name: "mode", className: "segmented",
    options: [{ value: "on", label: MODE_LABEL.on }, { value: "off", label: MODE_LABEL.off }],
    checked: modeOf(start),
    onChange: (value) => { if (isMode(value)) begin(meridian.chooseMode(value)); },
  });
  const moments = createRadioGroup({
    label: "Moments", name: "moment", className: "stops",
    options: momentOptions(modeOf(start)), checked: start,
    onChange: (value) => { if (isScenarioId(value)) begin(meridian.chooseScenario(value)); },
  });
  const marker = h("span", { class: "marker", "data-marker": "", "aria-hidden": "true" });
  const stops = h("div", { class: "stops-wrap" }, moments.element, marker);

  const picture = h("div", { class: "scenario-picture", role: "img", "aria-label": "Illustration:" });
  const time = h("p", { class: "scenario-time" });
  const heading = h("h3", {});
  const copy = h("p", { class: "scenario-copy" });
  const moment = h("p", { class: "scenario-moment" });
  const alertSlot = h("div", { class: "alert-slot" });
  const scenarioView = h("div", { class: "scenario-panel", "aria-busy": "true" },
    picture,
    h("div", { class: "scenario-text" }, time, heading, copy,
      h("div", { class: "where-it-fits" }, h("p", { class: "eyebrow" }, "Where it fits"), moment)));

  const title = h("h2", { id: "lifestyle-title", tabindex: "-1" }, LIFESTYLE_TITLE);
  reveal(title);
  const region = h("section", {
    "data-chapter": "lifestyle", class: "chapter chapter-lifestyle", "aria-labelledby": "lifestyle-title",
    "data-mode": modeOf(start), "data-scenario": start,
  }, h("div", { class: "spread" }, title, h("p", { class: "lead" }, LIFESTYLE_LEAD),
    h("div", { class: "meridian-controls" }, modes.element, stops), alertSlot, scenarioView));

  /** The marker sits under the chosen stop; the first placement is not animated. */
  const placeMarker = (animated: boolean): void => {
    const chosen = moments.element.querySelector("input:checked")?.closest("label");
    if (!(chosen instanceof HTMLElement)) return;
    if (!animated) marker.style.transition = "none";
    marker.style.width = `${chosen.offsetWidth}px`;
    marker.style.transform = `translate(${chosen.offsetLeft}px, ${chosen.offsetTop + chosen.offsetHeight - marker.offsetHeight}px)`;
    if (!animated) {
      void marker.offsetWidth;
      marker.style.transition = "";
    }
  };

  let momentsMode = modeOf(start);
  let visited = false;

  /** Radios and panel busy state follow the visitor's choice at once, and so does the address once a choice was made. */
  const syncChoice = (): void => {
    const mode = modeOf(meridian.selected);
    if (modes.checked() !== mode) modes.setChecked(mode);
    if (momentsMode !== mode) {
      momentsMode = mode;
      moments.setOptions(momentOptions(mode), meridian.selected);
    } else {
      moments.setChecked(meridian.selected);
    }
    placeMarker(true);
    scenarioView.setAttribute("aria-busy", String(meridian.loading));
    if (visited) writeAddress(meridian.selected);
  };

  const layers: SVGSVGElement[] = [];
  const settleLayers = (): void => {
    for (const layer of layers.splice(0, layers.length - 1)) layer.remove();
  };

  /** The panel shows a scenario: the region attributes, picture, text and the three motions change together. */
  const show = (record: Scenario, animated: boolean): void => {
    region.setAttribute("data-mode", record.mode);
    region.setAttribute("data-scenario", record.id);
    picture.setAttribute("aria-label", `Illustration: ${record.title}`);
    picture.setAttribute("data-scenario", record.id);
    const layer = scene(record.id);
    layers.push(layer);
    picture.append(layer);
    const fade = animated ? play(layer, [{ opacity: 0 }, { opacity: 1 }], CROSSFADE_MS) : null;
    if (fade) void fade.finished.then(settleLayers, settleLayers);
    else settleLayers();
    time.textContent = record.time;
    heading.textContent = record.title;
    copy.textContent = record.copy;
    moment.textContent = record.moment;
    if (!animated) return;
    for (const part of [heading, copy, moment]) {
      play(part, [{ transform: `translateX(${SLIDE_PX}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], SLIDE_MS);
    }
  };

  /** Loads a scenario; a visitor's choice is announced and animated, the scenario shown at page start is neither. */
  const fetchScenario = (request: ScenarioRequest, chosen: boolean): void => {
    alertSlot.replaceChildren();
    loadScenario(request.id).then((record) => {
      if (!meridian.arrived(request.token)) return;
      show(record, chosen);
      if (chosen) announce(`${MODE_LABEL[record.mode]}: ${record.name}. ${record.title}.`);
      syncChoice();
    }, () => {
      if (!meridian.failed(request.token)) return;
      alertSlot.replaceChildren(h("div", { class: "alert", role: "alert" }, icon("warning"), h("span", {}, SCENARIO_ALERT)));
      syncChoice();
    });
  };

  function begin(request: ScenarioRequest | null): void {
    visited = true;
    syncChoice();
    if (request) fetchScenario(request, true);
  }

  let swipeStart: { x: number; y: number } | null = null;
  picture.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") swipeStart = { x: event.clientX, y: event.clientY };
  }, { signal });
  picture.addEventListener("pointercancel", () => { swipeStart = null; }, { signal });
  picture.addEventListener("pointerup", (event) => {
    if (!swipeStart) return;
    const dx = event.clientX - swipeStart.x;
    const dy = event.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    const next = meridian.neighbour(dx < 0 ? 1 : -1);
    if (next) begin(meridian.chooseScenario(next));
  }, { signal });
  addEventListener("resize", () => placeMarker(false), { signal });

  return {
    element: region,
    mount() {
      placeMarker(false);
      if (new URLSearchParams(location.search).has("scenario")) writeAddress(start);
      fetchScenario(meridian.start(), false);
    },
  };
}
