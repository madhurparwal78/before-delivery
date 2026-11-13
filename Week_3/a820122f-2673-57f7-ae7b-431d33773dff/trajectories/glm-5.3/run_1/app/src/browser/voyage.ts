import { apiJson, el, restText, ApiError } from "./api.js";
import { openDialog, firstFieldError } from "./dialogs.js";

interface StripCell { start_utc: string; ship_date: string; ship_time: string; state: "not_logged" | "rest" | "work" | "short_break" | "late"; late: boolean }
interface StripWindow { step: number; start_utc: string; end_utc: string; rest_hours: number; verdict: "pass" | "breach" | "incomplete"; rules_failed: string[]; rule_set: "standard" | "flag_exception" }
interface StripResponse {
  start_utc: string;
  end_utc: string;
  cells: StripCell[];
  clock_changes: { changes_at_utc: string; label: string }[];
  fixes: { at_utc: string; latitude: number; longitude: number }[];
  windows: { "24": StripWindow[]; "168": StripWindow[] };
}
interface WindowInfo {
  start_utc: string;
  end_utc: string;
  hours: 24 | 168;
  start_ship_time: string;
  end_ship_time: string;
  rest_hours: number;
  verdict: "pass" | "breach" | "incomplete";
  rules_failed: string[];
  rule_set: "standard" | "flag_exception";
  longitude: number | null;
  latitude: number | null;
  fold_state: "flat" | "gap" | "crease" | "gap_and_crease";
  clock_face_hours: number;
  clock_change_labels: string[];
}
interface DayView {
  ship_date: string;
  state: "open" | "closed" | "signed" | "countersigned";
  closes_at_utc: string;
  can_edit: boolean;
  cells: StripCell[];
  rest_hours: number;
  entries: { entry_key: string; late: boolean }[];
  notes: { id: string; text: string; author_role: string; created_at_utc: string }[];
  events: { id: string; kind: string; start_utc: string; end_utc: string; description: string; mismatch: boolean }[];
  signed_at_utc: string | null;
  countersigned_at_utc: string | null;
}
interface Breach { id: string; rule: string; window_hours: number; window_start_utc: string; window_end_utc: string; rule_set: string; rest_hours: number; still_breaching: boolean }

const RULE_SENTENCES_24: Record<string, (ruleSet: string) => string> = {
  rest_24h: () => "Less than 10 hours of rest in this 24-hour window.",
  rest_periods: (rs) => `Rest was split into more than ${rs === "standard" ? 2 : 3} periods in this 24-hour window.`,
  six_hour_block: () => "No rest period of at least 6 hours touches this 24-hour window.",
  fourteen_hour_gap: () => "More than 14 hours passed between rest periods in this 24-hour window.",
  three_period_days: () => "Three rest periods were used on more than two 24-hour periods in these 7 days.",
};
const RULE_SENTENCE_168 = (rs: string) => `Less than ${rs === "standard" ? 77 : 70} hours of rest in this 168-hour window.`;

/** `/voyage/<vessel id>/<crew id>` — globe, 14-day strip with the Hour Fold, Record pane. */
export async function renderVoyage(vesselId: string, crewId: string, startParam: string | null, dateParam: string | null): Promise<void> {
  document.title = "Voyage review — Sixbell Rest Log";
  const app = document.getElementById("app")!;
  app.textContent = "";

  const me = await apiJson<{ role: "owner_master" | "crew"; id: string }>("/api/me");
  const isOwner = me.role === "owner_master";

  const crew = await apiJson<{ crew: { id: string; name: string; rank: string }[] }>(`/api/vessels/${vesselId}/crew`);
  const crewMember = crew.crew.find((c) => c.id === crewId);
  const headingText = crewMember ? `Voyage review — ${crewMember.name}` : "Voyage review";
  const heading = el("h1", {}, headingText);
  const signOut = el("button", { type: "button" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await fetch("/api/session", { method: "DELETE" });
    window.location.assign("/");
  });

  // --- Voyage region: globe, current position, list of fixes.
  const voyageRegion = el("section", { class: "pane", role: "region", "aria-label": "Voyage" },
    el("span", { class: "pane-label" }, "Voyage"));
  const canvas = el("canvas", { class: "globe-canvas", width: "260", height: "170", role: "img", "aria-label": "Voyage globe" });
  canvas.setAttribute("data-globe-longitude", "");
  const positionText = el("p", { class: "globe-position" }, "No position logged yet.");
  const fixesList = el("ul", { class: "fixes-list" });
  voyageRegion.append(el("div", { class: "globe-wrap" }, canvas, positionText), fixesList);

  // --- Watch strip region.
  const stripRegion = el("section", { class: "pane", role: "region", "aria-label": "Watch strip" },
    el("span", { class: "pane-label" }, "Watch strip"));
  const stripWrap = el("div", { class: "strip-wrap" });
  const strip = el("div", { class: "strip" });
  stripWrap.append(strip);
  const widthGroup = el("div", { class: "radios", role: "radiogroup", "aria-label": "Window width" });
  const width24 = el("input", { type: "radio", id: "w24", name: "window-width", value: "24" });
  width24.checked = true;
  const width168 = el("input", { type: "radio", id: "w168", name: "window-width", value: "168" });
  widthGroup.append(
    el("label", { for: "w24" }, width24, "24 hours"),
    el("label", { for: "w168" }, width168, "168 hours"));
  const sliderLabel = el("label", { for: "window-start" }, "Window start");
  const slider = el("input", {
    type: "range", min: "0", max: "624", step: "1", value: "0",
    role: "slider", id: "window-start", "aria-label": "Window start", "aria-valuetext": "",
  });
  const earlier = el("button", { type: "button" }, "Show earlier 14 days");
  const later = el("button", { type: "button" }, "Show later 14 days");
  const hourFold = el("div", { class: "fold-values", role: "group", "aria-label": "Hour Fold",
    "data-step": "0", "data-window-start-utc": "", "data-window-end-utc": "",
    "data-rest-hours": "", "data-verdict": "", "data-longitude": "", "data-fold-state": "", "data-clock-face-hours": "" });
  const foldTime = el("p", {}, "");
  const foldRest = el("p", {}, "");
  hourFold.append(foldTime, foldRest);
  const verdict = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Window verdict" }, "");
  stripRegion.append(stripWrap, widthGroup, sliderLabel, slider, el("div", {}, earlier, later), hourFold, verdict);

  // --- Record region.
  const recordRegion = el("section", { class: "pane voyage-record", role: "region", "aria-label": "Record" },
    el("span", { class: "pane-label" }, "Record"));
  const shownLine = el("p", {}, "");
  const dayStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Day status" }, "");
  const monthStatus = el("p", { class: "status", role: "status", "aria-live": "polite", "aria-label": "Month status" }, "");
  const ruleSetLine = el("p", { class: "small muted" }, "");
  const failedRules = el("div");
  const breachList = el("div");
  const signButton = el("button", { type: "button" }, "Sign this day");
  const countersignButton = el("button", { type: "button" }, "Countersign this day");
  const noteButton = el("button", { type: "button" }, "Add a note");
  const sealButton = el("button", { type: "button" }, "Seal this month");
  const downloadCopy = el("a", { class: "button" }, "Download my copy");
  downloadCopy.style.display = "none";
  countersignButton.style.display = isOwner ? "inline-block" : "none";
  signButton.style.display = isOwner ? "none" : "inline-block";
  sealButton.style.display = isOwner ? "inline-block" : "none";
  const notesList = el("ul", { class: "small" });
  const notices = el("div");
  recordRegion.append(shownLine, dayStatus, monthStatus, ruleSetLine, failedRules, breachList,
    el("div", {}, signButton, countersignButton, noteButton, sealButton, downloadCopy),
    notesList, notices);

  app.append(el("header", {}, heading, signOut),
    el("div", { class: "voyage-grid" },
      el("div", { class: "voyage-upper" }, voyageRegion, stripRegion),
      recordRegion));

  let stripData: StripResponse | null = null;
  let width: 24 | 168 = 24;
  let step = 0;
  let windowInfo: WindowInfo | null = null;
  let stripStart = startParam ?? null;
  let shownShipDate: string | null = dateParam ?? null;
  let dateFollowsWindow = shownShipDate === null;
  let announceTimer: number | undefined;
  let globeLongitude = 0;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const frame = el("div", { class: "fold-frame" });
  const frameStart = el("span", { class: "fold-label" }, "");
  const frameEnd = el("span", { class: "fold-label" }, "");
  const breachWord = el("span", { class: "fold-breach-word" }, "");
  const foldLabels = el("div", {}, "");
  strip.append(frame, frameStart, frameEnd, breachWord, foldLabels);

  await loadStrip();
  await selectWindow();
  await renderRecord();

  async function loadStrip(): Promise<void> {
    const query = stripStart ? `?start=${encodeURIComponent(stripStart)}` : "";
    stripData = await apiJson<StripResponse>(`/api/crew/${crewId}/strip${query}`);
    renderStrip();
    fixesList.textContent = "";
    for (const fix of stripData.fixes) {
      fixesList.append(el("li", {}, `${fix.at_utc} ${fix.latitude.toFixed(2)} ${fix.longitude.toFixed(2)}`));
    }
    const max = width === 24 ? 624 : 336;
    slider.setAttribute("max", String(max));
    if (step > max) {
      step = max;
      slider.value = String(max);
    }
  }

  function renderStrip(): void {
    if (!stripData) return;
    strip.textContent = "";
    // The fold frame and its labels live above the cells; re-adding them keeps
    // the strip's layering after every reload of the cells.
    strip.append(frame, frameStart, frameEnd, breachWord, foldLabels);
    const cells = stripData.cells;
    if (cells.length === 0) return;
    const first = Date.parse(cells[0]!.start_utc);
    const last = Date.parse(cells[cells.length - 1]!.start_utc) + 30 * 60_000;
    const spanMs = last - first;
    const widthPx = strip.clientWidth || 640;
    for (const cell of cells) {
      const share = (Date.parse(cell.start_utc) - first) / spanMs;
      const cellEl = el("div", { class: "strip-cell", "data-state": cell.state });
      cellEl.style.left = `${share * widthPx}px`;
      strip.append(cellEl);
    }
    for (const change of stripData.clock_changes) {
      const share = (Date.parse(change.changes_at_utc) - first) / spanMs;
      const tick = el("div", { class: "clock-tick" });
      tick.style.left = `${share * widthPx}px`;
      strip.append(tick);
    }
    positionFrame();
  }

  function positionFrame(): void {
    if (!stripData || !windowInfo) return;
    const cells = stripData.cells;
    const first = Date.parse(cells[0]!.start_utc);
    const last = Date.parse(cells[cells.length - 1]!.start_utc) + 30 * 60_000;
    const spanMs = last - first;
    const widthPx = strip.clientWidth || 640;
    const startShare = (Date.parse(windowInfo.start_utc) - first) / spanMs;
    const endShare = (Date.parse(windowInfo.end_utc) - first) / spanMs;
    frame.style.left = `${startShare * widthPx}px`;
    frame.style.width = `${(endShare - startShare) * widthPx}px`;
    frame.classList.toggle("breach", windowInfo.verdict === "breach");
    breachWord.textContent = windowInfo.verdict === "breach" ? "Breach" : "";
    frameStart.textContent = windowInfo.start_ship_time;
    frameEnd.textContent = windowInfo.end_ship_time;
    frameStart.style.left = `${startShare * widthPx}px`;
    frameEnd.style.left = "auto";
    frameEnd.style.right = `${(1 - endShare) * widthPx}px`;
    // Fold labels for covered clock changes.
    foldLabels.textContent = "";
    for (const change of stripData.clock_changes) {
      const changeMs = Date.parse(change.changes_at_utc);
      if (changeMs > Date.parse(windowInfo.start_utc) && changeMs < Date.parse(windowInfo.end_utc)) {
        const share = (changeMs - first) / spanMs;
        const label = el("span", { class: "fold-gap-label" }, change.label);
        label.style.left = `${share * widthPx}px`;
        foldLabels.append(label);
      }
    }
  }

  async function selectWindow(): Promise<void> {
    if (!stripData) return;
    const windows = width === 24 ? stripData.windows["24"] : stripData.windows["168"];
    const info = windows[step]!;
    const query = `start=${encodeURIComponent(info.start_utc)}&hours=${width}`;
    windowInfo = await apiJson<WindowInfo>(`/api/crew/${crewId}/window?${query}`);
    slider.value = String(step);
    slider.setAttribute("aria-valuetext", `${windowInfo.start_ship_time} to ${windowInfo.end_ship_time}`);
    hourFold.setAttribute("data-step", String(step));
    hourFold.setAttribute("data-window-start-utc", windowInfo.start_utc);
    hourFold.setAttribute("data-window-end-utc", windowInfo.end_utc);
    hourFold.setAttribute("data-rest-hours", windowInfo.rest_hours.toFixed(1));
    hourFold.setAttribute("data-verdict", windowInfo.verdict);
    hourFold.setAttribute("data-longitude", windowInfo.longitude === null ? "" : windowInfo.longitude.toFixed(2));
    hourFold.setAttribute("data-fold-state", windowInfo.fold_state);
    hourFold.setAttribute("data-clock-face-hours", String(windowInfo.clock_face_hours));
    foldTime.textContent = `${windowInfo.start_ship_time} to ${windowInfo.end_ship_time}`;
    foldRest.textContent = `${restText(windowInfo.rest_hours)} hours of rest`;
    positionFrame();
    drawGlobe();
    scheduleVerdictAnnounce();
    if (dateFollowsWindow) {
      shownShipDate = shipDateOfLastCell();
      await renderRecord();
    }
  }

  /** The ship's date holding the last half-hour cell inside the window: the
   *  latest cell whose start lies strictly before the window's end. */
  function shipDateOfLastCell(): string | null {
    if (!stripData || !windowInfo) return null;
    const endMs = Date.parse(windowInfo.end_utc);
    let shipDate: string | null = null;
    for (const cell of stripData.cells) {
      const startMs = Date.parse(cell.start_utc);
      if (startMs < endMs) {
        shipDate = cell.ship_date;
      }
    }
    return shipDate ?? stripData.cells[0]?.ship_date ?? null;
  }

  function scheduleVerdictAnnounce(): void {
    if (announceTimer !== undefined) window.clearTimeout(announceTimer);
    const info = windowInfo!;
    const apply = (): void => {
      if (info.verdict === "pass") {
        verdict.textContent = `${info.start_ship_time} to ${info.end_ship_time}: ${restText(info.rest_hours)} hours of rest. This window passes the rules.`;
      } else if (info.verdict === "breach") {
        verdict.textContent = `${info.start_ship_time} to ${info.end_ship_time}: ${restText(info.rest_hours)} hours of rest. Breach recorded. It stays on this record.`;
      } else {
        verdict.textContent = `${info.start_ship_time} to ${info.end_ship_time}: ${restText(info.rest_hours)} hours of rest. This window is not fully logged yet.`;
      }
    };
    if (reducedMotion.matches) {
      apply();
      return;
    }
    announceTimer = window.setTimeout(apply, 500);
  }

  // --- The globe: procedural canvas, turned only by window movement.

  function drawGlobe(): void {
    if (!windowInfo) return;
    const target = windowInfo.longitude ?? 0;
    globeLongitude = target;
    canvas.setAttribute("data-globe-longitude", target.toFixed(2));
    const context = canvas.getContext("2d");
    if (!context) return;
    const w = canvas.width;
    const h = canvas.height;
    context.clearRect(0, 0, w, h);
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, w, h);
    // Graticule.
    context.strokeStyle = "rgba(27,42,68,0.2)";
    context.lineWidth = 0.5;
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon - globeLongitude + 540) % 360 - 180) / 360 * w + w / 2;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, h);
      context.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = h / 2 - (lat / 90) * (h / 2 - 10);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(w, y);
      context.stroke();
    }
    // Buff land shapes: coarse rectangles at fixed positions.
    context.fillStyle = "#e4d7b8";
    const land = [{ lat: 48, lon: -5, w: 10, h: 8 }, { lat: 50, lon: -12, w: 14, h: 10 }, { lat: 47, lon: -16, w: 8, h: 6 }, { lat: 48, lon: -8, w: 10, h: 8 }];
    for (const shape of land) {
      const x = ((shape.lon - globeLongitude + 540) % 360 - 180) / 360 * w + w / 2;
      const y = h / 2 - (shape.lat / 90) * (h / 2 - 10);
      context.fillRect(x, y, shape.w, shape.h);
    }
    // Track through the fixes and a mark at the current position.
    if (windowInfo.latitude !== null && windowInfo.longitude !== null) {
      const x = ((windowInfo.longitude - globeLongitude + 540) % 360 - 180) / 360 * w + w / 2;
      const y = h / 2 - (windowInfo.latitude / 90) * (h / 2 - 10);
      context.fillStyle = "#1b2a44";
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
      positionText.textContent = `${windowInfo.latitude.toFixed(2)} ${windowInfo.longitude.toFixed(2)}`;
    } else {
      positionText.textContent = "No position logged yet.";
    }
  }

  // --- Window controls.
  slider.addEventListener("input", () => {
    step = Number(slider.value);
    void selectWindow();
  });
  width24.addEventListener("change", () => {
    if (width === 24) return;
    width = 24;
    const max = 624;
    slider.setAttribute("max", String(max));
    if (step > max) step = max;
    void selectWindow();
  });
  width168.addEventListener("change", () => {
    if (width === 168) return;
    width = 168;
    const max = 336;
    slider.setAttribute("max", String(max));
    if (step > max) step = max;
    void selectWindow();
  });
  stripRegion.addEventListener("keydown", (event) => {
    if (event.key === "[" || event.key === "]") {
      const max = width === 24 ? 624 : 336;
      const next = event.key === "[" ? step - 1 : step + 1;
      if (next >= 0 && next <= max) {
        step = next;
        void selectWindow();
      }
      event.preventDefault();
    }
  });
  stripWrap.addEventListener("pointerdown", (event) => {
    const rect = strip.getBoundingClientRect();
    const share = (event.clientX - rect.left) / rect.width;
    const max = width === 24 ? 624 : 336;
    const next = Math.round(share * max);
    step = Math.max(0, Math.min(max, next));
    void selectWindow();
  });
  stripWrap.addEventListener("pointermove", (event) => {
    if (event.buttons === 0) return;
    const rect = strip.getBoundingClientRect();
    const share = (event.clientX - rect.left) / rect.width;
    const max = width === 24 ? 624 : 336;
    const next = Math.round(share * max);
    step = Math.max(0, Math.min(max, next));
    void selectWindow();
  });
  earlier.addEventListener("click", () => {
    stripStart = addHalfHours(stripData!.start_utc, -336);
    void loadStrip().then(() => void selectWindow());
  });
  later.addEventListener("click", () => {
    stripStart = addHalfHours(stripData!.start_utc, 336);
    void loadStrip().then(() => void selectWindow());
  });

  // --- Record pane.
  async function renderRecord(): Promise<void> {
    const shipDate = shownShipDate;
    if (!shipDate) {
      shownLine.textContent = "";
      return;
    }
    shownLine.textContent = `Ship's day ${shipDate}, in month ${shipDate.slice(0, 7)}.`;
    const day = await apiJson<DayView>(`/api/crew/${crewId}/days/${shipDate}`);
    dayStatus.textContent = day.state === "open"
      ? `Open — you can edit this ship's day until ${day.closes_at_utc}.`
      : day.state === "closed"
        ? "This ship's day has closed."
        : day.state === "signed" ? "Signed" : "Countersigned";
    const month = await apiJson<{ month: string; state: "open" | "awaiting_archive" | "sealed" }>(`/api/crew/${crewId}/months/${shipDate.slice(0, 7)}`);
    monthStatus.textContent = `Month ${month.month}: ${{ open: "Open", awaiting_archive: "Awaiting archive", sealed: "Sealed" }[month.state]}.`;
    if (month.state === "sealed") {
      downloadCopy.style.display = "inline-block";
      downloadCopy.setAttribute("href", `/api/crew/${crewId}/months/${month.month}/copy.pdf`);
    } else {
      downloadCopy.style.display = "none";
    }
    ruleSetLine.textContent = windowInfo?.rule_set === "flag_exception"
      ? "Judged under the flag exception rules."
      : "Judged under the standard rules.";

    failedRules.textContent = "";
    if (windowInfo && windowInfo.verdict !== "incomplete") {
      for (const rule of windowInfo.rules_failed) {
        const sentence = windowInfo.hours === 24
          ? RULE_SENTENCES_24[rule]?.(windowInfo.rule_set) ?? ""
          : RULE_SENTENCE_168(windowInfo.rule_set);
        failedRules.append(el("p", { class: "breach-line" }, sentence));
      }
    }

    const breaches = await apiJson<{ breaches: Breach[] }>(`/api/crew/${crewId}/breaches`);
    breachList.textContent = "";
    const runs = groupBreaches(breaches.breaches);
    if (runs.length === 0) {
      breachList.append(el("p", { class: "small" }, "No breaches recorded."));
    } else {
      for (const run of runs) {
        const still = run.every((b) => b.still_breaching);
        const first = run[0]!;
        const line = el("p", { class: `breach-line${still ? "" : " resolved"}` },
          `${first.rule} ${first.window_start_utc} to ${first.window_end_utc}${still ? "" : " Recorded breach. The hours were later changed."}`);
        breachList.append(line);
      }
    }

    notesList.textContent = "";
    for (const note of day.notes) {
      notesList.append(el("li", {}, `${note.created_at_utc} — ${note.text}`));
    }
    notices.textContent = "";
    for (const event of day.events) {
      if (!event.mismatch) continue;
      const notice = el("p", { class: "mismatch" },
        "Record mismatch: a drill or call-out overlaps hours logged as rest. Add a note to explain it.");
      const mismatchNote = el("button", { type: "button" }, "Add a note to this mismatch");
      mismatchNote.addEventListener("click", () => openNoteDialog(mismatchNote, shipDate, event.id));
      notice.append(el("br"), mismatchNote);
      notices.append(notice);
    }
  }

  function groupBreaches(breaches: Breach[]): Breach[][] {
    const runs: Breach[][] = [];
    const byRule = new Map<string, Breach[]>();
    for (const breach of breaches) {
      const key = `${breach.rule}-${breach.window_hours}`;
      const list = byRule.get(key) ?? [];
      list.push(breach);
      byRule.set(key, list);
    }
    for (const list of byRule.values()) {
      list.sort((a, b) => a.window_start_utc.localeCompare(b.window_start_utc));
      let run: Breach[] = [];
      let cursor: number | null = null;
      for (const breach of list) {
        const startMs = Date.parse(breach.window_start_utc);
        if (cursor !== null && startMs === cursor + 30 * 60_000 && run[run.length - 1]!.rule === breach.rule) {
          run.push(breach);
        } else {
          if (run.length > 0) runs.push(run);
          run = [breach];
        }
        cursor = startMs;
      }
      if (run.length > 0) runs.push(run);
    }
    return runs.sort((a, b) => a[0]!.window_start_utc.localeCompare(b[0]!.window_start_utc));
  }

  function openNoteDialog(opener: HTMLElement, shipDate: string, eventId?: string): void {
    openDialog({
      label: "Add a note",
      fields: [{ name: "note", type: "textarea" }],
      submitLabel: "Save note",
    }, opener, async (values) => {
      if (!values.note || values.note.trim().length === 0) return "Write a note first.";
      try {
        await apiJson(`/api/crew/${crewId}/days/${shipDate}/notes`, {
          method: "POST",
          body: JSON.stringify({ text: values.note, ...(eventId ? { event_id: eventId } : {}) }),
        });
        await renderRecord();
        return;
      } catch (error) {
        return firstFieldError(error);
      }
    });
  }

  noteButton.addEventListener("click", () => {
    if (shownShipDate) openNoteDialog(noteButton, shownShipDate);
  });

  signButton.addEventListener("click", () => {
    if (!shownShipDate) return;
    const shipDate = shownShipDate;
    openDialog({
      label: "Sign this day",
      fields: [],
      submitLabel: "Confirm signature",
      text: `By signing you confirm these are your hours for ${shipDate}.`,
      confirmOnly: true,
    }, signButton, async () => {
      dayStatus.textContent = "Signing.";
      try {
        await apiJson(`/api/crew/${crewId}/days/sign`, {
          method: "POST",
          body: JSON.stringify({ ship_dates: [shipDate] }),
        });
        dayStatus.textContent = "Signed.";
        await renderRecord();
        return;
      } catch (error) {
        if (error instanceof ApiError) {
          dayStatus.textContent = error.code === "day_not_closed"
            ? "This ship's day is still open, so it cannot be signed yet."
            : firstFieldError(error);
        }
        return firstFieldError(error);
      }
    });
  });

  countersignButton.addEventListener("click", async () => {
    if (!shownShipDate) return;
    if (!navigator.onLine) {
      dayStatus.textContent = "Countersigning needs a connection.";
      return;
    }
    const shipDate = shownShipDate;
    dayStatus.textContent = "Countersigning.";
    try {
      await apiJson(`/api/crew/${crewId}/days/countersign`, {
        method: "POST",
        body: JSON.stringify({ ship_dates: [shipDate] }),
      });
      dayStatus.textContent = "Countersigned.";
      await renderRecord();
    } catch (error) {
      if (error instanceof ApiError) {
        dayStatus.textContent = error.code === "day_not_signed"
          ? "The crew member has not signed this day yet."
          : firstFieldError(error);
      }
    }
  });

  sealButton.addEventListener("click", async () => {
    if (!shownShipDate) return;
    const month = shownShipDate.slice(0, 7);
    monthStatus.textContent = "Awaiting archive";
    try {
      const result = await apiJson<{ state: string }>(`/api/crew/${crewId}/months/${month}/seal`, { method: "POST" });
      monthStatus.textContent = `Month ${month}: ${{ open: "Open", awaiting_archive: "Awaiting archive", sealed: "Sealed" }[result.state as "open" | "awaiting_archive" | "sealed"]}.`;
    } catch (error) {
      if (error instanceof ApiError && error.code === "month_not_ready") {
        monthStatus.textContent = "Every logged day must be signed and countersigned first.";
      }
    }
  });

  window.setInterval(async () => {
    await loadStrip();
    await selectWindow();
    await renderRecord();
  }, 60_000);
}

function addHalfHours(startUtc: string, hours: number): string {
  const ms = Date.parse(startUtc) + hours * 30 * 60_000 * 2;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
