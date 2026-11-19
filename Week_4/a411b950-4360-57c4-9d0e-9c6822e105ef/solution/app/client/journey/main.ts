import "../styles/fonts.css";
import "../styles/base.css";
import "../styles/journey.css";

import { byId, operatorZone, request } from "../lib/api.js";
import { openDialog, reducedMotion } from "../lib/dialog.js";
import { hydrateIcons, icon } from "../lib/icons.js";
import { formatBusinessDate } from "../../shared/dates.js";
import { LAYERS, type Layer } from "../../shared/credits.js";
import { ScoreEngine } from "./audio.js";
import { setupBriefForm } from "./brief.js";
import { createCorridor } from "./corridor.js";

interface StationData {
  slug: string;
  title: string;
  credit_label: string;
  credit_line: string;
  role: string;
  blurb: string;
  thresholds: Record<Layer, number>;
  playable: boolean;
  stems: { id: string; layer: Layer; url: string }[];
}

interface Station {
  data: StationData;
  chapter: HTMLElement;
  stage: HTMLElement;
  ladder: HTMLElement;
  heading: HTMLElement;
  rungs: Map<Layer, HTMLButtonElement>;
  slider: HTMLInputElement | null;
}

const RANGE_PX = 1600;
const PX_PER_POINT = 16;
const DOLLY_MS = 900;
/** setTimeout cannot wait longer; links expiring later are caught by the 5-second re-check. */
const MAX_TIMEOUT_MS = 2_000_000_000;
const LAYER_NAMES: Record<Layer, string> = { bed: "Bed", pulse: "Pulse", lead: "Lead", stinger: "Stinger" };

const privateToken = /^\/listen\/([^/]+)$/.exec(location.pathname)?.[1] ?? null;
const engine = new ScoreEngine();
const corridor = createCorridor(byId<HTMLCanvasElement>("corridor"));
const meter = byId("meter");
const meterValue = byId("meter-value");
const needle = byId("meter-needle");
const layerChanges = byId("layer-changes");
const glowLayer = byId("corridor-glow");
const readoutPanel = byId("readout-panel");
const soundToggle = byId<HTMLButtonElement>("sound-toggle");
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");

let stations: Station[] = [];
let current: Station | null = null;
let intensity = 0;
let active = new Set<Layer>();
let lastHeard: string | null = null;
const cameraTimers = new Map<Station, number>();

hydrateIcons();

// ---- Sound gate ----

const gate = byId("gate");
const intro = byId("intro-heading");
const background = [byId("topbar"), byId("readout-panel"), byId("journey")];
const gateDialog = openDialog(gate, {
  initial: byId("enter-sound"),
  returnTo: intro,
  background,
  fadeMs: 320,
  onEscape: () => enter(false),
  onClose: () => document.documentElement.classList.remove("gate-open"),
});

function setAudible(audible: boolean): void {
  soundToggle.setAttribute("aria-pressed", String(audible));
  if (audible && !engine.started) engine.start();
  engine.setAudible(audible);
}

function enter(withSound: boolean): void {
  if (withSound) setAudible(true);
  gateDialog.close();
}

byId("enter-sound").addEventListener("click", () => enter(true));
byId("enter-muted").addEventListener("click", () => enter(false));
soundToggle.addEventListener("click", () => setAudible(soundToggle.getAttribute("aria-pressed") !== "true"));

// ---- Stations ----

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildStation(data: StationData): Station {
  const chapter = element("div", "chapter");
  const stage = element("section", "stage");
  const headingId = `station-${data.slug}`;
  stage.setAttribute("aria-labelledby", headingId);
  stage.dataset.station = data.slug;
  stage.dataset.intensity = "0";
  stage.dataset.camera = "wide";

  const text = element("div", "station-text");
  const heading = element("h2", "", data.title);
  heading.id = headingId;
  heading.tabIndex = -1;
  text.append(
    element("p", "label credit-label", data.credit_label),
    heading,
    element("p", "role", data.role),
    element("p", "credit-line", data.credit_line),
    element("p", "blurb", data.blurb),
  );
  const resting = element("p", "resting", "Audio is resting. Credits and notes are still here.");
  resting.hidden = data.playable;
  text.append(resting);

  const ladder = element("div", "ladder");
  ladder.setAttribute("role", "group");
  ladder.setAttribute("aria-label", "Intensity ladder");
  ladder.dataset.activeLayers = "";
  const rungs = new Map<Layer, HTMLButtonElement>();
  for (const layer of LAYERS) {
    const rung = element("button", "rung");
    rung.type = "button";
    rung.setAttribute("aria-label", `${LAYER_NAMES[layer]} layer`);
    rung.setAttribute("aria-pressed", "false");
    rung.append(element("span", "rung-fill"), element("span", "rung-name", LAYER_NAMES[layer]),
      element("span", "rung-threshold", String(data.thresholds[layer])));
    ladder.append(rung);
    rungs.set(layer, rung);
  }
  stage.append(text, ladder);
  chapter.append(stage);
  const station: Station = { data, chapter, stage, ladder, heading, rungs, slider: null };
  for (const [layer, rung] of rungs) rung.addEventListener("click", () => jumpTo(station, data.thresholds[layer]));
  return station;
}

/** The reduced-motion slider sits before the rungs and sets intensity directly. */
function syncSliders(): void {
  for (const station of stations) {
    if (motionQuery.matches && !station.slider) {
      const slider = element("input", "");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.step = "1";
      slider.value = "0";
      slider.setAttribute("aria-label", `Intensity for ${station.data.title}`);
      slider.addEventListener("input", () => setDirect(station, Number.parseInt(slider.value, 10)));
      station.ladder.prepend(slider);
      station.slider = slider;
    } else if (!motionQuery.matches && station.slider) {
      station.slider.remove();
      station.slider = null;
    }
  }
}

// ---- The ladder ----

const clamp = (value: number): number => Math.min(100, Math.max(0, value));
/** offset / 16 rounded to the nearest whole number, exact halves up. */
const intensityAt = (offset: number): number => Math.floor(offset / PX_PER_POINT + 0.5);
const pad = (value: number): string => String(value).padStart(3, "0");

function activeFor(station: Station | null, stationIntensity: number): Set<Layer> {
  if (!station) return new Set();
  return new Set(LAYERS.filter((layer) => stationIntensity >= station.data.thresholds[layer]));
}

function setCamera(station: Station, close: boolean): void {
  window.clearTimeout(cameraTimers.get(station));
  const target = close ? "close" : "wide";
  if (reducedMotion()) {
    station.stage.dataset.camera = target;
    return;
  }
  station.stage.dataset.camera = "moving";
  cameraTimers.set(station, window.setTimeout(() => {
    station.stage.dataset.camera = target;
  }, DOLLY_MS - 20));
}

function dolly(close: boolean): void {
  if (reducedMotion()) return;
  const canvas = byId("corridor");
  const [from, to] = close ? ["scale(1)", "scale(1.035)"] : ["scale(1.035)", "scale(1)"];
  for (const running of canvas.getAnimations()) running.cancel();
  canvas.style.transform = to;
  canvas.animate([{ transform: from }, { transform: to }], { duration: DOLLY_MS - 20, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
}

function stemsOf(station: Station) {
  return station.data.stems.map((stem) => ({ layer: stem.layer, url: stem.url }));
}

/**
 * Moves the ladder to `next` at intensity `requested`. Every rung change updates data-active-layers, the URL query and
 * "Layer changes", and crosses the changed layers over; layers come in lowest first and go out highest first.
 */
function apply(next: Station | null, requested: number, outgoingIntensity = requested): void {
  const previous = current;
  const nextIntensity = next ? clamp(requested) : 0;
  const nextActive = activeFor(next, nextIntensity);
  const sentences: string[] = [];
  if (previous && previous !== next) {
    const outgoing = clamp(outgoingIntensity);
    for (const layer of [...LAYERS].reverse()) {
      if (active.has(layer)) sentences.push(`${LAYER_NAMES[layer]} out at intensity ${outgoing}.`);
    }
    previous.stage.dataset.intensity = "0";
    previous.ladder.dataset.activeLayers = "";
    for (const rung of previous.rungs.values()) rung.setAttribute("aria-pressed", "false");
    if (previous.slider) previous.slider.value = "0";
    setCamera(previous, false);
    active = new Set();
  }
  if (next && previous !== next) {
    setCamera(next, true);
    corridor.show(next.data.slug, true, reducedMotion());
    dolly(true);
    lastHeard = next.data.slug;
  } else if (!next && previous) {
    corridor.show(previous.data.slug, false, reducedMotion());
    dolly(false);
  }
  if (next) {
    const reversed = [...LAYERS].reverse();
    for (const layer of reversed) {
      if (active.has(layer) && !nextActive.has(layer)) sentences.push(`${LAYER_NAMES[layer]} out at intensity ${nextIntensity}.`);
    }
    for (const layer of LAYERS) {
      if (!active.has(layer) && nextActive.has(layer)) sentences.push(`${LAYER_NAMES[layer]} in at intensity ${nextIntensity}.`);
    }
    next.stage.dataset.intensity = String(nextIntensity);
    if (next.slider && next.slider.value !== String(nextIntensity)) next.slider.value = String(nextIntensity);
  }
  current = next;
  intensity = nextIntensity;
  meter.setAttribute("aria-valuenow", String(nextIntensity));
  meterValue.textContent = pad(nextIntensity);
  needle.style.setProperty("--needle", String(nextIntensity));
  readoutPanel.classList.toggle("idle", !next);
  if (sentences.length === 0) return;
  active = nextActive;
  if (next) {
    next.ladder.dataset.activeLayers = LAYERS.filter((layer) => active.has(layer)).join(",");
    for (const [layer, rung] of next.rungs) rung.setAttribute("aria-pressed", String(active.has(layer)));
  }
  const url = new URL(location.href);
  if (next) {
    url.searchParams.set("station", next.data.slug);
    url.searchParams.set("i", String(nextIntensity));
  } else {
    url.searchParams.delete("station");
    url.searchParams.delete("i");
  }
  history.replaceState(history.state, "", url);
  announce(sentences);
  corridor.glow(active.size / LAYERS.length, reducedMotion());
  glowLayer.style.opacity = String(active.size * 0.22);
  if (next) engine.play(next.data.slug, stemsOf(next), active);
  else engine.idle();
}

/** One line per sentence, separated by spaces so the status text reads as one announcement. */
function announce(sentences: string[]): void {
  layerChanges.replaceChildren(...sentences.flatMap((sentence, i) => {
    const line = element("span", "sentence", sentence);
    return i === 0 ? [line] : [document.createTextNode(" "), line];
  }));
}

/** The scroll position last applied; each frame catches a position no scroll event has reported yet. */
let seenY = -1;

/** Scroll drives intensity: a station is current while its offset is 0 to 1600 inclusive. */
function fromScroll(): void {
  seenY = window.scrollY;
  if (motionQuery.matches) {
    fromView();
    return;
  }
  const y = window.scrollY;
  for (const station of stations) {
    const offset = y - station.chapter.offsetTop;
    if (offset >= 0 && offset <= RANGE_PX) {
      apply(station, intensityAt(offset));
      return;
    }
  }
  const previous = current;
  const raw = previous ? intensityAt(y - previous.chapter.offsetTop) : 0;
  apply(null, 0, raw);
}

/** Reduced motion: the station holding focus, else the one whose stage fills most of the view, is current. */
function fromView(): void {
  const focused = stations.find((station) => station.stage.contains(document.activeElement));
  let best: Station | null = focused ?? null;
  if (!best) {
    let most = 0;
    for (const station of stations) {
      const rect = station.stage.getBoundingClientRect();
      const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
      if (visible > most + 0.5) {
        most = visible;
        best = station;
      }
    }
  }
  if (best !== current) apply(best, 0, intensity);
}

function setDirect(station: Station, stationIntensity: number): void {
  apply(station, stationIntensity, current === station ? stationIntensity : intensity);
}

/** Rung buttons set intensity to the layer's threshold: by jumping to the offset, or directly with reduced motion. */
function jumpTo(station: Station, threshold: number): void {
  if (motionQuery.matches) {
    setDirect(station, threshold);
    return;
  }
  window.scrollTo({ top: station.chapter.offsetTop + threshold * PX_PER_POINT, behavior: "instant" });
  fromScroll();
}

window.addEventListener("scroll", fromScroll, { passive: true });
function everyFrame(): void {
  if (window.scrollY !== seenY) fromScroll();
  requestAnimationFrame(everyFrame);
}
requestAnimationFrame(everyFrame);
document.addEventListener("focusin", () => {
  if (motionQuery.matches) fromView();
});
motionQuery.addEventListener("change", () => {
  syncSliders();
  fromScroll();
});

function mountStations(list: StationData[]): void {
  const host = byId("stations");
  stations = list.map(buildStation);
  host.replaceChildren(...stations.map((station) => station.chapter));
  syncSliders();
  const first = stations[0];
  if (first) corridor.show(first.data.slug, false, true);
  fromScroll();
}

// ---- Search (public journey) ----

function setupSearch(): void {
  const box = byId<HTMLInputElement>("search-box");
  const status = byId("search-status");
  const results = byId("search-results");
  const popover = byId("search-popover");
  const wrapper = byId("search");
  const toggle = byId<HTMLButtonElement>("search-toggle");
  let timer = 0;
  let sequence = 0;
  toggle.addEventListener("click", () => {
    wrapper.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
    box.focus();
  });
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && wrapper.classList.contains("open")) {
      wrapper.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
  box.addEventListener("input", () => {
    window.clearTimeout(timer);
    const q = box.value.trim();
    if (!q) {
      popover.hidden = true;
      status.textContent = "";
      results.replaceChildren();
      return;
    }
    timer = window.setTimeout(async () => {
      const mine = ++sequence;
      popover.hidden = false;
      status.textContent = "Searching…";
      results.replaceChildren();
      const answer = await request<{ results: { slug: string; title: string; credit_label: string }[] }>(
        `/api/search?q=${encodeURIComponent(q)}`,
      );
      if (mine !== sequence) return;
      const hits = answer.status === 200 ? answer.body.results : [];
      status.textContent = hits.length > 0 ? `${hits.length} projects found.` : `No projects match “${q}”.`;
      results.replaceChildren(...hits.map((hit) => {
        const item = element("li", "");
        const link = element("a", "");
        link.href = `#station-${hit.slug}`;
        link.append(element("span", "", hit.title), element("span", "label", hit.credit_label));
        link.setAttribute("aria-label", hit.title);
        link.addEventListener("click", (event) => {
          event.preventDefault();
          const station = stations.find((s) => s.data.slug === hit.slug);
          if (!station) return;
          popover.hidden = true;
          box.value = "";
          wrapper.classList.remove("open");
          toggle.setAttribute("aria-expanded", "false");
          if (motionQuery.matches) {
            station.stage.scrollIntoView({ behavior: "instant", block: "start" });
            station.heading.focus({ preventScroll: true });
            setDirect(station, 0);
          } else {
            window.scrollTo({ top: station.chapter.offsetTop, behavior: "instant" });
            fromScroll();
            station.heading.focus({ preventScroll: true });
          }
        });
        item.append(link);
        return item;
      }));
    }, 250);
  });
}

// ---- Private listening ----

function setupPrivate(token: string): void {
  byId("search").remove();
  const notice = element("section", "nda-notice");
  notice.setAttribute("aria-label", "NDA notice");
  const noticeText = element("span", "", "Private listening under NDA.");
  notice.append(icon("lock"), noticeText);
  byId("topbar-middle").append(notice);
  const linkStatus = element("p", "link-status");
  linkStatus.setAttribute("role", "status");
  linkStatus.setAttribute("aria-label", "Link status");
  byId("stations").before(linkStatus);

  let ended = false;
  let poll = 0;
  let expiryTimer = 0;
  const end = (status: number): void => {
    if (ended) return;
    ended = true;
    window.clearInterval(poll);
    window.clearTimeout(expiryTimer);
    engine.silence();
    glowLayer.style.opacity = "0";
    for (const station of stations) station.chapter.remove();
    stations = [];
    current = null;
    const url = new URL(location.href);
    url.searchParams.delete("station");
    url.searchParams.delete("i");
    history.replaceState(history.state, "", url);
    meter.setAttribute("aria-valuenow", "0");
    meterValue.textContent = "000";
    readoutPanel.classList.add("idle");
    linkStatus.textContent = status === 410
      ? "This listening link has expired. Ask Kettlehole Audio for a new one."
      : "This listening link is not available.";
  };
  const check = async (): Promise<number> => {
    const answer = await request<{ station: StationData; expires_at: string }>(`/api/listen/${token}`);
    if (answer.status === 404 || answer.status === 410) end(answer.status);
    return answer.status;
  };
  engine.watchStems(() => void check());

  void request<{ station: StationData; expires_at: string }>(`/api/listen/${token}`).then((answer) => {
    if (answer.status !== 200) {
      end(answer.status === 410 ? 410 : 404);
      return;
    }
    const expires = new Date(answer.body.expires_at);
    noticeText.textContent =
      `Private listening under NDA. This link stops working on ${formatBusinessDate(expires, operatorZone())}.`;
    mountStations([answer.body.station]);
    poll = window.setInterval(() => void check(), 5000);
    const atExpiry = (): void => {
      void check().then((status) => {
        if (!ended && status === 200) expiryTimer = window.setTimeout(atExpiry, 1000);
      });
    };
    const untilExpiry = Math.max(0, expires.getTime() - Date.now());
    if (untilExpiry < MAX_TIMEOUT_MS) expiryTimer = window.setTimeout(atExpiry, untilExpiry);
  });
}

// ---- Start ----

if (privateToken) {
  setupPrivate(privateToken);
} else {
  setupSearch();
  void request<{ stations: StationData[] }>("/api/journey").then((answer) => {
    if (answer.status !== 200) {
      layerChanges.textContent = "The corridor could not load. Refresh to try again.";
      return;
    }
    mountStations(answer.body.stations);
  });
}

setupBriefForm({ listenToken: privateToken, heardProject: () => lastHeard });
