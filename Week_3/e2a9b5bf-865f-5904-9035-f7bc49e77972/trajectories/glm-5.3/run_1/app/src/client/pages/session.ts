// The Session screen: the Field region, optics pickers, the observation form
// and the session's observation list (DP-06, DP-08, DP-11, DP-16, DP-55, DP-71).
import { app, navigate, persist, queueChangeLocal } from "../app.js";
import { el, prefersReducedMotion } from "../dom.js";
import { apiGet } from "../api.js";
import { renderConnection, shell } from "./shell.js";
import { catalogue } from "../../shared/catalogue.js";
import { deriveOptics, formatAperture, formatExitPupil, trains, type OpticsChoice, type TrainId } from "../../shared/optics.js";
import { skyToScreen, screenToSky, type SkyPoint } from "../../shared/projection.js";
import { pairValues, pairSentence } from "../../shared/pair.js";
import { localHHMM, parseHHMMDate, utcOffset } from "../../shared/time.js";
import { fieldSentences, saveSentences, connectionSentences } from "../../shared/sentences.js";
import type { Observation, SessionWithObservations } from "../../shared/api.js";
import { strokesToJson, parseStrokeFileText, type StrokeFile } from "../../shared/strokes.js";
import { journalFor } from "../store.js";
import { canonicalUtc } from "../../shared/time.js";

const SWAP_NUMERAL_MS = 320;
const SWAP_ORIENTATION_MS = 180;

interface FieldMarks {
  strokes: { width: "fine" | "medium" | "broad"; points: SkyPoint[] }[];
  stars: { at: SkyPoint; brightness: number }[];
}

interface PairMark {
  primary: SkyPoint | null;
  secondary: SkyPoint | null;
}

export async function renderSession(root: HTMLElement, sessionId: string, observationId: string | null): Promise<void> {
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null)!;
  const store = app.state.stores[accountId];
  let session: SessionWithObservations | null = store?.sessions[sessionId] ?? null;

  if ((!session || navigator.onLine) && navigator.onLine) {
    try {
      const fetched = await apiGet.session(sessionId);
      session = fetched;
      const sessionStore = app.state.stores[accountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      sessionStore.sessions[sessionId] = fetched;
      persist();
    } catch {
      session = session ?? null;
    }
  }
  if (!session && !store?.sessions[sessionId]) {
    // Offline and not on this device (DP-88).
    const parts = shell(`Session`, []);
    parts.column.append(el("div", { class: "status", role: "status", "aria-label": "Connection", text: connectionSentences.notOnDevice }));
    root.append(parts.column);
    return;
  }
  session = session ?? store!.sessions[sessionId]!;
  const kit = store!.kit ?? { telescopes: [], eyepieces: [], barlows: [], trains: [...trains] };

  const heading = `Session ${session.evening_date} · ${session.site.name}`;
  const parts = shell(heading, []);
  const column = parts.column;

  // ---- Field region ---------------------------------------------------------
  const fieldRegion = el("section", { class: "field-region", role: "region", "aria-label": "Field" });
  const fieldWrap = el("div", { class: "field-wrap" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-110 -110 220 220");
  svg.classList.add("field-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const marksGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const cursorGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const fieldCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fieldCircle.setAttribute("cx", "0");
  fieldCircle.setAttribute("cy", "0");
  fieldCircle.setAttribute("r", "100");
  fieldCircle.classList.add("field-circle");
  svg.append(fieldCircle, marksGroup, cursorGroup);

  const eyepiece = el("div", {
    class: "eyepiece-field",
    role: "application",
    "aria-label": "Eyepiece field",
    tabindex: "0",
  }, svg);
  fieldWrap.append(eyepiece);
  const compass = el("div", { class: "compass", role: "img", "aria-label": "Compass: North down, east right." });

  // Readouts
  const opticsReadout = el("div", { class: "status readout", role: "status", "aria-label": "Optics readout" });
  const pairReadout = el("div", { class: "status readout", role: "status", "aria-label": "Pair readout" });
  const fieldAnnouncements = el("div", { class: "status", role: "status", "aria-label": "Field announcements" });
  const localTimeLine = el("div", { class: "status local-time", role: "status", "aria-label": "Local time" });

  // Counting figures during a swap (DP-07), one element each, aria-hidden.
  const countingMag = el("span", { class: "counting", "aria-hidden": "true" });
  const countingField = el("span", { class: "counting", "aria-hidden": "true" });
  const countingExit = el("span", { class: "counting", "aria-hidden": "true" });
  const countingWrap = el("span", { class: "counting-wrap", hidden: "hidden" }, countingMag, countingField, countingExit);

  // ---- State ------------------------------------------------------------
  interface FieldState {
    optics: OpticsChoice;
    marks: FieldMarks;
    pair: PairMark;
    cursorSky: SkyPoint;
    mode: "pencil" | "star" | "measure";
    brightness: number;
    width: "fine" | "medium" | "broad";
    undoStack: string[];
    version: number;
    strokesText: string | null;
  }

  const sessionOptics: OpticsChoice = {
    telescope_id: session.optics.telescope_id,
    eyepiece_id: session.optics.eyepiece_id,
    barlow_id: session.optics.barlow_id,
    train: session.optics.train,
  };
  const observation = observationId ? (session.observations.find((o) => o.id === observationId) ?? null) : null;
  let active: FieldState = {
    optics: observation ? { telescope_id: observation.optics.telescope_id, eyepiece_id: observation.optics.eyepiece_id, barlow_id: observation.optics.barlow_id, train: observation.optics.train } : sessionOptics,
    marks: { strokes: [], stars: [] },
    pair: { primary: null, secondary: null },
    cursorSky: [0, 0],
    mode: "pencil",
    brightness: 3,
    width: "medium",
    undoStack: [],
    version: observation?.version ?? 0,
    strokesText: null,
  };

  let sketchUnavailable = false;

  const derivedOf = (optics: OpticsChoice) => {
    const telescope = kit.telescopes.find((t) => t.id === optics.telescope_id) ?? kit.telescopes[0];
    const eyepieceRow = kit.eyepieces.find((e) => e.id === optics.eyepiece_id) ?? kit.eyepieces[0];
    const barlow = optics.barlow_id ? kit.barlows.find((b) => b.id === optics.barlow_id) : null;
    if (!telescope || !eyepieceRow) return null;
    return deriveOptics(telescope, eyepieceRow, barlow?.factor ?? 1, optics.train);
  };

  const loadMarks = (text: string | null): void => {
    active.marks = { strokes: [], stars: [] };
    active.pair = { primary: null, secondary: null };
    if (!text) return;
    const file = parseStrokeFileText(text);
    if (file) {
      active.marks = { strokes: file.strokes.map((s) => ({ width: s.width, points: [...s.points] })), stars: file.stars.map((s) => ({ at: s.at, brightness: s.brightness })) };
    }
  };

  // Load the observation's sketch: device copy first, then network.
  if (observation) {
    const deviceCopy = store!.strokes[observation.id] ?? null;
    if (deviceCopy) {
      active.strokesText = deviceCopy;
      loadMarks(deviceCopy);
      if (observation.pair) {
        active.pair = { primary: observation.pair.primary, secondary: observation.pair.secondary };
      }
    } else if (observation.sketch && navigator.onLine) {
      const read = await apiGet.strokes(observation.id);
      if (read.ok) {
        active.strokesText = read.text;
        store!.strokes[observation.id] = read.text;
        persist();
        loadMarks(read.text);
      } else {
        fieldAnnouncements.textContent = fieldSentences.sketchUnreadable;
        sketchUnavailable = true;
      }
    } else if (observation.sketch) {
      fieldAnnouncements.textContent = fieldSentences.sketchUnreadable;
      sketchUnavailable = true;
    }
  }

  // ---- Drawing -----------------------------------------------------------
  const renderMarks = (scaleFactor = 1): void => {
    marksGroup.textContent = "";
    const derived = derivedOf(active.optics);
    const trueField = (derived?.true_field_arcmin ?? 60) * scaleFactor;
    const train = active.optics.train;
    const drawStroke = (stroke: { width: string; points: SkyPoint[] }): void => {
      if (stroke.points.length === 0) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", stroke.points.map((point, index) => {
        const { x, y } = skyToScreen(point, train, trueField);
        return `${index === 0 ? "M" : "L"}${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`;
      }).join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "white");
      path.setAttribute("stroke-width", stroke.width === "broad" ? "3.4" : stroke.width === "medium" ? "2" : "1");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.classList.add("mark");
      marksGroup.append(path);
    };
    for (const stroke of active.marks.strokes) drawStroke(stroke);
    for (const star of active.marks.stars) {
      const { x, y } = skyToScreen(star.at, train, trueField);
      const node = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      node.setAttribute("cx", String(x * 100));
      node.setAttribute("cy", String(y * 100));
      node.setAttribute("r", String([1.4, 2.1, 2.9, 3.8, 4.8][star.brightness - 1] ?? 2));
      node.setAttribute("fill", "white");
      node.classList.add("mark");
      marksGroup.append(node);
    }
    if (active.pair.primary && active.pair.secondary) {
      const p1 = skyToScreen(active.pair.primary, train, trueField);
      const p2 = skyToScreen(active.pair.secondary, train, trueField);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(p1.x * 100));
      line.setAttribute("y1", String(p1.y * 100));
      line.setAttribute("x2", String(p2.x * 100));
      line.setAttribute("y2", String(p2.y * 100));
      line.setAttribute("stroke", "white");
      line.setAttribute("stroke-width", "0.9");
      marksGroup.append(line);
      for (const point of [p1, p2]) {
        const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ring.setAttribute("cx", String(point.x * 100));
        ring.setAttribute("cy", String(point.y * 100));
        ring.setAttribute("r", "3");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", "white");
        ring.setAttribute("stroke-width", "0.9");
        marksGroup.append(ring);
      }
    }
    renderCursor();
  };

  const renderCursor = (): void => {
    cursorGroup.textContent = "";
    const derived = derivedOf(active.optics);
    const trueField = derived?.true_field_arcmin ?? 60;
    const radius = Math.hypot(active.cursorSky[0], active.cursorSky[1]) / (trueField / 2);
    const clamped = Math.min(radius, 1);
    const direction: SkyPoint = active.cursorSky[0] === 0 && active.cursorSky[1] === 0 ? [0, 0] : [active.cursorSky[0], active.cursorSky[1]];
    const point = skyToScreen(direction, active.optics.train, trueField);
    const x = point.x * clamped * 100;
    const y = point.y * clamped * 100;
    const h = document.createElementNS("http://www.w3.org/2000/svg", "line");
    h.setAttribute("x1", String(x - 5));
    h.setAttribute("y1", String(y));
    h.setAttribute("x2", String(x + 5));
    h.setAttribute("y2", String(y));
    h.setAttribute("stroke", "rgba(255,255,255,0.85)");
    h.setAttribute("stroke-width", "1");
    const v = document.createElementNS("http://www.w3.org/2000/svg", "line");
    v.setAttribute("x1", String(x));
    v.setAttribute("y1", String(y - 5));
    v.setAttribute("x2", String(x));
    v.setAttribute("y2", String(y + 5));
    v.setAttribute("stroke", "rgba(255,255,255,0.85)");
    v.setAttribute("stroke-width", "1");
    cursorGroup.append(h, v);
  };

  const updateReadout = (): void => {
    const derived = derivedOf(active.optics);
    if (!derived) {
      opticsReadout.textContent = "Choose a telescope and an eyepiece from your kit.";
      return;
    }
    opticsReadout.textContent = `${derived.magnification}× · ${derived.true_field_arcmin}′ field · ${formatExitPupil(derived.exit_pupil_mm)} mm exit pupil · ${derived.orientation.sentence}`;
    compass.setAttribute("aria-label", `Compass: ${derived.orientation.sentence}`);
    renderCompassMarks(derived.orientation.rotation_deg, derived.orientation.mirrored);
  };

  const renderCompassMarks = (rotationDeg: number, mirrored: boolean): void => {
    compass.textContent = "";
    const rad = (rotationDeg * Math.PI) / 180;
    const project = (east: number, north: number): { x: number; y: number } => {
      let x = -east;
      let y = -north;
      const rx = x * Math.cos(rad) - y * Math.sin(rad);
      const ry = x * Math.sin(rad) + y * Math.cos(rad);
      x = mirrored ? -rx : rx;
      y = ry;
      return { x, y };
    };
    const n = project(0, 1);
    const e = project(1, 0);
    const labels = el("div", { class: "compass-marks" });
    if (n.y < 0) labels.append(el("span", { class: "compass-north", text: "N ↑" }));
    else labels.append(el("span", { class: "compass-north", text: "N ↓" }));
    if (e.x > 0) labels.append(el("span", { class: "compass-east", text: "E →" }));
    else labels.append(el("span", { class: "compass-east", text: "E ←" }));
    compass.append(labels);
  };

  const updatePairReadout = (): void => {
    const marked = (active.pair.primary ? 1 : 0) + (active.pair.secondary ? 1 : 0);
    if (marked === 2) {
      const values = pairValues(active.pair.primary!, active.pair.secondary!);
      pairReadout.textContent = pairSentence({ primary: active.pair.primary!, secondary: active.pair.secondary!, ...values }, 2);
    } else {
      pairReadout.textContent = pairSentence(null, marked);
    }
  };

  // Field swap (DP-07, DP-08, DP-09): numerals count, marks scale, then orient.
  let swapGeneration = 0;
  const runSwap = (previous: { magnification: number; trueField: number; exitPupil: number; rotation: number; mirrored: boolean }): void => {
    const derived = derivedOf(active.optics);
    if (!derived) return;
    const generation = ++swapGeneration;
    if (prefersReducedMotion()) {
      renderMarks(1);
      updateReadout();
      fieldAnnouncements.textContent = `Field now ${derived.true_field_arcmin}′ at ${derived.magnification}×. ${derived.orientation.sentence}`;
      return;
    }
    opticsReadout.classList.add("visually-hidden");
    countingWrap.removeAttribute("hidden");
    const scaleRatio = Math.min(5, Math.max(0.2, previous.trueField / derived.true_field_arcmin));
    const start = performance.now();
    const animateNumerals = (): void => {
      if (generation !== swapGeneration) return;
      const t = Math.min(1, (performance.now() - start) / SWAP_NUMERAL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      countingMag.textContent = `${Math.round(previous.magnification + (derived.magnification - previous.magnification) * eased)}×`;
      countingField.textContent = `${Math.round(previous.trueField + (derived.true_field_arcmin - previous.trueField) * eased)}′`;
      countingExit.textContent = `${(previous.exitPupil + (derived.exit_pupil_mm - previous.exitPupil) * eased).toFixed(1)} mm`;
      const scale = previous.trueField + (derived.true_field_arcmin - previous.trueField) * eased;
      renderMarks(scale / derived.true_field_arcmin);
      if (t < 1) {
        requestAnimationFrame(animateNumerals);
      } else {
        const orientStart = performance.now();
        const animateOrientation = (): void => {
          if (generation !== swapGeneration) return;
          const ot = Math.min(1, (performance.now() - orientStart) / SWAP_ORIENTATION_MS);
          const eased = 1 - Math.pow(1 - ot, 3);
          renderMarks(scaleRatio ** eased);
          renderCompassInterpolated(previous.rotation, derived.orientation.rotation_deg, previous.mirrored, derived.orientation.mirrored, eased);
          if (ot < 1) {
            requestAnimationFrame(animateOrientation);
          } else {
            finishSwap(generation, derived);
          }
        };
        requestAnimationFrame(animateOrientation);
      }
    };
    requestAnimationFrame(animateNumerals);
  };

  const renderCompassInterpolated = (fromRotation: number, toRotation: number, fromMirrored: boolean, toMirrored: boolean, t: number): void => {
    const rotation = fromRotation + (toRotation - fromRotation) * t;
    const mirrorT = fromMirrored === toMirrored ? 1 : Math.abs(1 - 2 * t);
    const mirrored = fromMirrored !== toMirrored ? (t > 0.5 ? toMirrored : fromMirrored) : toMirrored;
    void mirrorT;
    const effectiveMirrored = fromMirrored === toMirrored ? toMirrored : (t > 0.5 ? toMirrored : fromMirrored);
    renderCompassMarks(rotation, effectiveMirrored);
  };

  const finishSwap = (generation: number, derived: NonNullable<ReturnType<typeof derivedOf>>): void => {
    if (generation !== swapGeneration) return;
    countingWrap.setAttribute("hidden", "hidden");
    opticsReadout.classList.remove("visually-hidden");
    renderMarks(1);
    updateReadout();
    fieldAnnouncements.textContent = `Field now ${derived.true_field_arcmin}′ at ${derived.magnification}×. ${derived.orientation.sentence}`;
  };

  const endSwapAtOnce = (): void => {
    if (swapGeneration === 0) return;
    swapGeneration++;
    countingWrap.setAttribute("hidden", "hidden");
    opticsReadout.classList.remove("visually-hidden");
    renderMarks(1);
    updateReadout();
  };

  updateReadout();
  renderMarks(1);
  updatePairReadout();

  // ---- Sketch tools --------------------------------------------------------
  const toolPencil = el("button", { class: "tool", text: "Pencil", "aria-pressed": "true" });
  const toolStar = el("button", { class: "tool", text: "Star", "aria-pressed": "false" });
  const toolMeasure = el("button", { class: "tool", text: "Measure", "aria-pressed": "false" });
  const toolFine = el("button", { class: "tool", text: "Fine", "aria-pressed": "false" });
  const toolMedium = el("button", { class: "tool", text: "Medium", "aria-pressed": "true" });
  const toolBroad = el("button", { class: "tool", text: "Broad", "aria-pressed": "false" });
  const toolUndo = el("button", { class: "tool", text: "Undo" });
  const toolClear = el("button", { class: "tool", text: "Clear sketch" });
  const chosenObject = () => catalogue.find((o) => o.id === objectPicker.value) ?? catalogue.find((o) => o.id === "m13")!;
  const refreshToolAvailability = (): void => {
    const kind = chosenObject().kind;
    toolMeasure.setAttribute("aria-hidden", kind === "double_star" ? "false" : "true");
    toolMeasure.toggleAttribute("hidden", kind !== "double_star");
    if (kind !== "double_star" && active.mode === "measure") {
      active.mode = "pencil";
      toolPencil.setAttribute("aria-pressed", "true");
      toolMeasure.setAttribute("aria-pressed", "false");
    }
  };
  const setMode = (mode: "pencil" | "star" | "measure"): void => {
    active.mode = mode;
    toolPencil.setAttribute("aria-pressed", String(mode === "pencil"));
    toolStar.setAttribute("aria-pressed", String(mode === "star"));
    toolMeasure.setAttribute("aria-pressed", String(mode === "measure"));
  };
  toolPencil.addEventListener("click", () => setMode("pencil"));
  toolStar.addEventListener("click", () => setMode("star"));
  toolMeasure.addEventListener("click", () => setMode("measure"));
  toolFine.addEventListener("click", () => {
    active.width = "fine";
    toolFine.setAttribute("aria-pressed", "true");
    toolMedium.setAttribute("aria-pressed", "false");
    toolBroad.setAttribute("aria-pressed", "false");
  });
  toolMedium.addEventListener("click", () => {
    active.width = "medium";
    toolFine.setAttribute("aria-pressed", "false");
    toolMedium.setAttribute("aria-pressed", "true");
    toolBroad.setAttribute("aria-pressed", "false");
  });
  toolBroad.addEventListener("click", () => {
    active.width = "broad";
    toolFine.setAttribute("aria-pressed", "false");
    toolMedium.setAttribute("aria-pressed", "false");
    toolBroad.setAttribute("aria-pressed", "true");
  });
  const tools = el("div", { class: "tools", role: "toolbar", "aria-label": "Sketch tools" },
    toolPencil, toolStar, toolMeasure, toolFine, toolMedium, toolBroad, toolUndo, toolClear);

  const snapshotMarks = (): string => strokesToJson({ format: "lowlamp-strokes/1", strokes: active.marks.strokes, stars: active.marks.stars });

  const undo = (): void => {
    const last = active.undoStack.pop();
    if (!last) return;
    const state = JSON.parse(last) as { marks: FieldMarks; pair: PairMark };
    active.marks = state.marks;
    active.pair = state.pair;
    renderMarks(1);
    updatePairReadout();
    fieldAnnouncements.textContent = fieldSentences.lastMarkRemoved;
  };
  toolUndo.addEventListener("click", undo);

  toolClear.addEventListener("click", () => {
    openDialog("Clear sketch?", "Clear", "Keep sketch", async () => {
      active.undoStack.push(JSON.stringify({ marks: active.marks, pair: active.pair }));
      active.marks = { strokes: [], stars: [] };
      renderMarks(1);
    }, () => toolClear.focus());
  });

  // ---- Pointer, finger and stylus -------------------------------------------
  interface PointerSession {
    pointerId: number;
    pointerType: string;
    stroke: { width: "fine" | "medium" | "broad"; points: SkyPoint[] } | null;
  }
  let pointerSessions = new Map<number, PointerSession>();
  let penDown = false;
  let cancelled = false;

  const markFromEvent = (event: PointerEvent): SkyPoint => {
    const rect = eyepiece.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const derived = derivedOf(active.optics)!;
    return screenToSky(x, y, active.optics.train, derived.true_field_arcmin);
  };

  eyepiece.addEventListener("pointerdown", (event) => {
    if (sketchUnavailable) return;
    if ((event as PointerEvent).pointerType === "touch" && penDown) return; // palm rest
    if (active.mode === "pencil") {
      // A second finger landing during a finger stroke discards that stroke.
      const fingerSessions = [...pointerSessions.values()].filter((s) => s.pointerType === "touch" && s.stroke);
      if ((event as PointerEvent).pointerType === "touch" && fingerSessions.length > 0) {
        for (const session of fingerSessions) {
          const index = active.marks.strokes.indexOf(session.stroke!);
          if (index >= 0) active.marks.strokes.splice(index, 1);
          pointerSessions.delete(session.pointerId);
        }
        cancelled = true;
        renderMarks(1);
        return;
      }
      const snapshot = JSON.stringify({ marks: active.marks, pair: active.pair });
      const stroke = { width: active.width, points: [markFromEvent(event as PointerEvent)] };
      active.marks.strokes.push(stroke);
      active.undoStack.push(snapshot);
      pointerSessions.set((event as PointerEvent).pointerId, { pointerId: (event as PointerEvent).pointerId, pointerType: (event as PointerEvent).pointerType, stroke });
      if ((event as PointerEvent).pointerType === "pen") penDown = true;
      eyepiece.setPointerCapture((event as PointerEvent).pointerId);
      renderMarks(1);
    } else if (active.mode === "star") {
      // A pinch in Star mode places no star: only a single contact places one.
      if (pointerSessions.size === 0) {
        const snapshot = JSON.stringify({ marks: active.marks, pair: active.pair });
        active.marks.stars.push({ at: markFromEvent(event as PointerEvent), brightness: active.brightness });
        active.undoStack.push(snapshot);
        fieldAnnouncements.textContent = fieldSentences.starPlaced(active.brightness);
        renderMarks(1);
      }
      pointerSessions.set((event as PointerEvent).pointerId, { pointerId: (event as PointerEvent).pointerId, pointerType: (event as PointerEvent).pointerType, stroke: null });
    } else if (active.mode === "measure") {
      markPairPoint(markFromEvent(event as PointerEvent));
      pointerSessions.set((event as PointerEvent).pointerId, { pointerId: (event as PointerEvent).pointerId, pointerType: (event as PointerEvent).pointerType, stroke: null });
    }
  });

  eyepiece.addEventListener("pointermove", (event) => {
    const session = pointerSessions.get((event as PointerEvent).pointerId);
    if (!session?.stroke || active.mode !== "pencil") return;
    session.stroke.points.push(markFromEvent(event as PointerEvent));
    renderMarks(1);
  });

  const endPointer = (event: PointerEvent, discard: boolean): void => {
    const session = pointerSessions.get(event.pointerId);
    pointerSessions.delete(event.pointerId);
    if (event.pointerType === "pen") penDown = false;
    if (discard && session?.stroke) {
      const index = active.marks.strokes.indexOf(session.stroke);
      if (index >= 0) {
        active.marks.strokes.splice(index, 1);
        active.undoStack.pop();
        renderMarks(1);
      }
    }
    if (event.pointerType === "touch" && pointerSessions.size === 0) cancelled = false;
  };
  eyepiece.addEventListener("pointerup", (event) => endPointer(event as PointerEvent, false));
  eyepiece.addEventListener("pointercancel", (event) => endPointer(event as PointerEvent, true));

  const markPairPoint = (point: SkyPoint): void => {
    if (!active.pair.primary || (active.pair.primary && active.pair.secondary)) {
      active.pair = { primary: point, secondary: null };
    } else {
      if (active.pair.primary[0] === point[0] && active.pair.primary[1] === point[1]) return;
      active.pair.secondary = point;
    }
    renderMarks(1);
    updatePairReadout();
  };

  // A pinch on the circle zooms neither the page nor the field.
  eyepiece.addEventListener("touchstart", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  eyepiece.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  // The page doesn't scroll while a stroke is being drawn on the circle.
  eyepiece.addEventListener("pointerdown", () => eyepiece.classList.add("drawing"));
  eyepiece.addEventListener("pointerup", () => eyepiece.classList.remove("drawing"));
  eyepiece.addEventListener("pointercancel", () => eyepiece.classList.remove("drawing"));


  // ---- Keyboard in the Field region (DP-12) --------------------------------
  const moveCursor = (eastDelta: number, northDelta: number): void => {
    const derived = derivedOf(active.optics)!;
    const half = derived.true_field_arcmin / 2;
    const next: SkyPoint = [active.cursorSky[0] + eastDelta, active.cursorSky[1] + northDelta];
    const radius = Math.hypot(next[0], next[1]);
    if (radius <= half) {
      active.cursorSky = [Math.round(next[0] * 100) / 100, Math.round(next[1] * 100) / 100];
    } else {
      const scale = half / radius;
      active.cursorSky = [Math.round(next[0] * scale * 100) / 100, Math.round(next[1] * scale * 100) / 100];
    }
    renderCursor();
  };

  // One step of screen movement expressed on the sky (Business rules table).
  const screenStep = (train: TrainId, key: string, step: number): SkyPoint => {
    const screenX = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
    const screenY = key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0;
    return screenToSky(screenX, screenY, train, 2);
  };

  const swapEyepiece = (shorter: boolean): void => {
    const ordered = [...kit.eyepieces].sort((a, b) => b.focal_length_mm - a.focal_length_mm);
    const currentIndex = ordered.findIndex((e) => e.id === active.optics.eyepiece_id);
    const nextIndex = shorter ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0) {
      fieldAnnouncements.textContent = fieldSentences.noShorterEyepiece;
      return;
    }
    if (nextIndex >= ordered.length) {
      fieldAnnouncements.textContent = fieldSentences.noLongerEyepiece;
      return;
    }
    swapOptics({ ...active.optics, eyepiece_id: ordered[nextIndex]!.id });
  };

  // Every optics change: readout, swap, queued changes (Interactions).
  const swapOptics = (next: OpticsChoice): void => {
    const previousDerived = derivedOf(active.optics);
    active.optics = next;
    const derived = derivedOf(next);
    if (!derived) return;
    updateReadout();
    runSwap({
      magnification: previousDerived?.magnification ?? derived.magnification,
      trueField: previousDerived?.true_field_arcmin ?? derived.true_field_arcmin,
      exitPupil: previousDerived?.exit_pupil_mm ?? derived.exit_pupil_mm,
      rotation: previousDerived?.orientation.rotation_deg ?? derived.orientation.rotation_deg,
      mirrored: previousDerived?.orientation.mirrored ?? derived.orientation.mirrored,
    });
    const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null)!;
    queueChangeLocal(accountId, {
      client_op_id: crypto.randomUUID(),
      kind: "session.optics",
      session_id: sessionId,
      optics: next,
    }, "session.optics");
    if (observation && observation.version > 0) {
      queueChangeLocal(accountId, {
        client_op_id: crypto.randomUUID(),
        kind: "observation.update",
        observation_id: observation.id,
        base_version: observation.version,
        edited_at: canonicalUtc(Date.now()),
        fields: { optics: next },
      }, "observation.update");
    }
    syncPickers(next);
  };

  const fieldKeydown = (event: KeyboardEvent): void => {
    if (dialogOpen) return;
    if (!fieldRegion.contains(document.activeElement)) return;
    const key = event.key;
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      const sky = screenStep(active.optics.train, key, step);
      moveCursor(sky[0], sky[1]);
      return;
    }
    if (key >= "1" && key <= "5") {
      active.brightness = Number(key);
      fieldAnnouncements.textContent = fieldSentences.brightnessChosen(active.brightness);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      if (sketchUnavailable) return;
      if (active.mode === "measure") {
        markPairPoint(active.cursorSky);
        return;
      }
      const snapshot = JSON.stringify({ marks: active.marks, pair: active.pair });
      active.marks.stars.push({ at: active.cursorSky, brightness: active.brightness });
      active.undoStack.push(snapshot);
      renderMarks(1);
      fieldAnnouncements.textContent = fieldSentences.starPlaced(active.brightness);
      return;
    }
    if (key === " ") {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== eyepiece && focused.classList.contains("tool")) {
        event.preventDefault();
        focused.click();
      }
      return;
    }
    if (key === "]" || key === "[") {
      event.preventDefault();
      swapEyepiece(key === "]");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
  };
  fieldRegion.addEventListener("keydown", fieldKeydown);

  // ---- Optics pickers (DP-05, DP-62) ---------------------------------------
  const telescopePicker = el("select", { class: "input", "aria-label": "Telescope" }) as HTMLSelectElement;
  const eyepiecePicker = el("select", { class: "input", "aria-label": "Eyepiece" }) as HTMLSelectElement;
  const barlowPicker = el("select", { class: "input", "aria-label": "Barlow" }) as HTMLSelectElement;
  const trainPicker = el("select", { class: "input", "aria-label": "Train" }) as HTMLSelectElement;

  const fillPickers = (): void => {
    telescopePicker.textContent = "";
    for (const telescope of kit.telescopes) {
      telescopePicker.append(el("option", { value: telescope.id, text: telescope.name }));
    }
    eyepiecePicker.textContent = "";
    const ordered = [...kit.eyepieces].sort((a, b) => b.focal_length_mm - a.focal_length_mm);
    for (const eyepiece of ordered) {
      eyepiecePicker.append(el("option", { value: eyepiece.id, text: eyepiece.name }));
    }
    barlowPicker.textContent = "";
    barlowPicker.append(el("option", { value: "", text: "No Barlow" }));
    for (const barlow of kit.barlows) {
      barlowPicker.append(el("option", { value: barlow.id, text: barlow.name }));
    }
    trainPicker.textContent = "";
    for (const train of trains) {
      trainPicker.append(el("option", { value: train.id, text: train.name }));
    }
  };
  fillPickers();

  const syncPickers = (optics: OpticsChoice): void => {
    telescopePicker.value = optics.telescope_id;
    eyepiecePicker.value = optics.eyepiece_id;
    barlowPicker.value = optics.barlow_id ?? "";
    trainPicker.value = optics.train;
  };
  syncPickers(active.optics);

  const opticsChange = (): void => {
    swapOptics({
      telescope_id: telescopePicker.value,
      eyepiece_id: eyepiecePicker.value,
      barlow_id: barlowPicker.value || null,
      train: trainPicker.value as TrainId,
    });
  };
  telescopePicker.addEventListener("change", opticsChange);
  eyepiecePicker.addEventListener("change", opticsChange);
  barlowPicker.addEventListener("change", opticsChange);
  trainPicker.addEventListener("change", opticsChange);

  const pickers = el("div", { class: "pickers" },
    el("div", { class: "picker-field" }, el("label", { class: "field-label", text: "Telescope" }), telescopePicker),
    el("div", { class: "picker-field" }, el("label", { class: "field-label", text: "Eyepiece" }), eyepiecePicker),
    el("div", { class: "picker-field" }, el("label", { class: "field-label", text: "Barlow" }), barlowPicker),
    el("div", { class: "picker-field" }, el("label", { class: "field-label", text: "Train" }), trainPicker),
  );

  // ---- Observation form (DP-16, DP-25, DP-63) ------------------------------
  const objectPicker = el("select", { class: "input", "aria-label": "Object" }) as HTMLSelectElement;
  for (const object of catalogue) {
    objectPicker.append(el("option", { value: object.id, text: object.designation }));
  }
  if (observation) objectPicker.value = observation.object_id;

  const utField = el("input", { class: "input", type: "text", placeholder: "YYYY-MM-DD HH:MM", "aria-label": "UT date and time" }) as HTMLInputElement;
  const seeingField = el("input", { class: "input", type: "number", min: "1", max: "10", step: "1", "aria-label": "Seeing (1–10)" }) as HTMLInputElement;
  const transparencyField = el("input", { class: "input", type: "text", placeholder: "e.g. 6.2", "aria-label": "Transparency (limiting magnitude)" }) as HTMLInputElement;
  const descriptionField = el("textarea", { class: "input", rows: "4", "aria-label": "Description" }) as HTMLTextAreaElement;
  const concentrationPicker = el("select", { class: "input", "aria-label": "Concentration class" }) as HTMLSelectElement;
  for (const value of ["Not recorded", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]) {
    concentrationPicker.append(el("option", { value: value === "Not recorded" ? "" : value, text: value }));
  }

  const updateLocalTimeLine = (): void => {
    const parsed = parseHHMMDate(utField.value);
    if (!parsed) {
      localTimeLine.textContent = "";
      return;
    }
    localTimeLine.textContent = `${localHHMM(parsed.epochMs, session!.site.time_zone)} local, UTC${utcOffset(parsed.epochMs, session!.site.time_zone)}`;
  };
  utField.addEventListener("input", updateLocalTimeLine);

  const saveStatus = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const fixThese = el("div", { class: "alert", role: "alert", "aria-label": "Fix these first", hidden: "hidden" });

  const concentrationRow = el("div", { class: "picker-field concentration" }, el("label", { class: "field-label", text: "Concentration class" }), concentrationPicker);
  const refreshConcentration = (): void => {
    const kind = chosenObject().kind;
    concentrationRow.toggleAttribute("hidden", kind !== "globular");
    refreshToolAvailability();
  };
  objectPicker.addEventListener("change", refreshConcentration);
  refreshConcentration();

  if (observation) {
    utField.value = observation.observed_at ? `${observation.observed_at.slice(0, 10)} ${observation.observed_at.slice(11, 16)}` : "";
    updateLocalTimeLine();
    seeingField.value = observation.seeing !== null ? String(observation.seeing) : "";
    transparencyField.value = observation.transparency_nelm !== null ? String(observation.transparency_nelm) : "";
    descriptionField.value = observation.description;
    concentrationPicker.value = observation.concentration_class ?? "";
  }

  const saveButton = el("button", { class: "button primary", text: "Save observation" });
  const newButton = el("button", { class: "button", text: "New observation" });

  saveButton.addEventListener("click", async () => {
    // Validate in the browser first (DP-16).
    const errors: { field: string; message: string; focus: () => void }[] = [];
    const parsedUt = parseHHMMDate(utField.value);
    if (utField.value !== "" && !parsedUt) errors.push({ field: "UT time", message: "Use a UT time during this session.", focus: () => utField.focus() });
    if (seeingField.value !== "" && (!Number.isInteger(Number(seeingField.value)) || Number(seeingField.value) < 1 || Number(seeingField.value) > 10)) {
      errors.push({ field: "seeing", message: "Seeing is a whole number from 1 to 10.", focus: () => seeingField.focus() });
    }
    const nelm = Number(transparencyField.value);
    if (transparencyField.value !== "" && (!Number.isFinite(nelm) || nelm < 1.0 || nelm > 8.0)) {
      errors.push({ field: "transparency", message: "Transparency is a limiting magnitude from 1.0 to 8.0.", focus: () => transparencyField.focus() });
    }
    if (descriptionField.value.trim().length > 4000) {
      errors.push({ field: "description", message: "Keep the description to 4,000 characters or fewer.", focus: () => descriptionField.focus() });
    }
    if (errors.length > 0) {
      fixThese.textContent = "";
      for (const error of errors) {
        fixThese.append(el("a", { class: "fix-link", href: "#", text: error.message, onclick: (event: MouseEvent) => {
          event.preventDefault();
          error.focus();
        } }));
      }
      fixThese.removeAttribute("hidden");
      fixThese.focus();
      return;
    }
    fixThese.setAttribute("hidden", "hidden");
    const designation = chosenObject().designation;
    saveStatus.textContent = saveSentences.pending(designation);

    const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null)!;
    const fields: Record<string, unknown> = {};
    const editedAt = canonicalUtc(Date.now());
    if (utField.value !== "") fields["observed_at"] = parsedUt!.text;
    if (seeingField.value !== "") fields["seeing"] = Number(seeingField.value);
    if (transparencyField.value !== "") fields["transparency_nelm"] = Number(transparencyField.value);
    if (chosenObject().kind === "globular") fields["concentration_class"] = concentrationPicker.value || null;
    fields["description"] = descriptionField.value;
    if (chosenObject().kind === "double_star" && active.pair.primary && active.pair.secondary) {
      fields["pair"] = { primary: active.pair.primary, secondary: active.pair.secondary };
    }

    const marksChanged = active.strokesText !== snapshotMarks();
    const hasMarks = active.marks.strokes.length > 0 || active.marks.stars.length > 0;

    if (observation) {
      queueChangeLocal(accountId, {
        client_op_id: crypto.randomUUID(),
        kind: "observation.update",
        observation_id: observation.id,
        base_version: observation.version,
        edited_at: editedAt,
        fields,
      }, "observation.update");
      if (marksChanged && hasMarks) {
        queueChangeLocal(accountId, {
          client_op_id: crypto.randomUUID(),
          kind: "sketch.put",
          observation_id: observation.id,
          base_version: observation.version,
          edited_at: editedAt,
          strokes: snapshotMarks(),
          raster_png_base64: null,
        }, "sketch.put");
      }
    } else {
      const observationId = crypto.randomUUID();
      fields["optics"] = active.optics;
      queueChangeLocal(accountId, {
        client_op_id: crypto.randomUUID(),
        kind: "observation.create",
        observation_id: observationId,
        session_id: sessionId,
        object_id: objectPicker.value,
        edited_at: editedAt,
        fields,
      }, "observation.create");
      if (hasMarks) {
        queueChangeLocal(accountId, {
          client_op_id: crypto.randomUUID(),
          kind: "sketch.put",
          observation_id: observationId,
          base_version: 1,
          edited_at: editedAt,
          strokes: snapshotMarks(),
          raster_png_base64: null,
        }, "sketch.put");
      }
    }
    saveStatus.textContent = navigator.onLine ? saveSentences.saved(designation) : saveSentences.savedOffline(designation);
  });

  newButton.addEventListener("click", () => {
    navigate(`/sessions/${sessionId}`, true);
  });

  const form = el("div", { class: "observation-form" },
    el("div", { class: "picker-field" }, el("label", { class: "field-label", text: "Object" }), objectPicker),
    el("div", { class: "field ut-field" },
      el("label", { class: "field-label", text: "UT date and time" }), utField, localTimeLine),
    el("div", { class: "field-row" },
      el("div", { class: "field" }, el("label", { class: "field-label", text: "Seeing (1–10)" }), seeingField),
      el("div", { class: "field" }, el("label", { class: "field-label", text: "Transparency (limiting magnitude)" }), transparencyField),
    ),
    concentrationRow,
    el("div", { class: "field" }, el("label", { class: "field-label", text: "Description" }), descriptionField),
    fixThese,
    saveStatus,
    el("div", { class: "field-row" }, saveButton, newButton),
  );

  // ---- Session observation list --------------------------------------------
  const list = el("ul", { class: "rows", role: "list" });
  let listObservations: Observation[] = [...session!.observations];
  const renderList = (): void => {
    list.textContent = "";
    const observations = listObservations;
    for (const row of observations) {
      const open = el("button", { class: "button", text: `Open ${row.designation}`, onclick: () => navigate(`/sessions/${sessionId}?observation=${row.id}`) });
      const remove = el("button", { class: "button ghost", text: `Delete ${row.designation}` });
      remove.addEventListener("click", () => {
        openDialog("Delete observation?", "Delete", "Keep observation", async () => {
          queueChangeLocal(app.state.signedInAccountId!, {
            client_op_id: crypto.randomUUID(),
            kind: "observation.delete",
            observation_id: row.id,
            base_version: row.version,
          }, "observation.delete");
          // The row leaves at once, and focus moves to the next Open.
          listObservations = listObservations.filter((o) => o.id !== row.id);
          renderList();
          const nextRow = listObservations[listObservations.indexOf(row)];
          const next = nextRow;
          if (next) {
            (list.children[listObservations.indexOf(next)]?.querySelector("button") as HTMLElement | null)?.focus();
          } else {
            newButton.focus();
          }
        }, () => remove.focus(), `Delete ${row.designation} from ${session!.evening_date}?`);
      });
      list.append(el("li", { class: "row" },
        el("div", { class: "row-main" },
          el("span", { class: "row-ink", text: row.designation }),
          el("span", { class: "row-muted", text: row.observed_at ? `${row.local_time} local, UTC${row.local_offset}` : "no time yet" }),
        ),
        el("div", { class: "row-actions" }, open, remove),
      ));
    }
  };
  renderList();

  // ---- Assemble the screen ---------------------------------------------------
  fieldWrap.append(compass);
  fieldRegion.append(fieldWrap, tools, opticsReadout, pairReadout, fieldAnnouncements, countingWrap, localTimeLine);
  if (chosenObject().kind !== "double_star") pairReadout.setAttribute("hidden", "hidden");
  column.append(fieldRegion, pickers, form, el("h2", { class: "subheading", text: "Observations" }), list);
  root.append(column);
  renderConnection(parts.connection);
  void cancelled;
}

// ---- Dialog helper ---------------------------------------------------------

let dialogOpen = false;

function openDialog(label: string, confirmText: string, cancelText: string, onConfirm: () => Promise<void> | void, onCancelFocus: () => void, text?: string): void {
  dialogOpen = true;
  const confirmButton = el("button", { class: "button primary", text: confirmText });
  const cancelButton = el("button", { class: "button", text: cancelText });
  const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": label },
    el("p", { class: "dialog-text", text: text ?? label }),
    el("div", { class: "dialog-actions" }, cancelButton, confirmButton),
  );
  const close = (focusTarget: () => void): void => {
    dialogOpen = false;
    dialog.remove();
    focusTarget();
  };
  confirmButton.addEventListener("click", async () => {
    close(() => confirmButton.blur());
    await onConfirm();
  });
  cancelButton.addEventListener("click", () => close(onCancelFocus));
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(onCancelFocus);
      return;
    }
    if (event.key === "Tab") {
      // Tab and Shift+Tab wrap inside the dialog.
      event.preventDefault();
      const buttons = [cancelButton, confirmButton];
      const index = buttons.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index === buttons.length - 1 ? 0 : index + 1);
      buttons[next]!.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      (document.activeElement as HTMLElement).click();
    }
  });
  document.body.append(dialog);
  cancelButton.focus();
}
