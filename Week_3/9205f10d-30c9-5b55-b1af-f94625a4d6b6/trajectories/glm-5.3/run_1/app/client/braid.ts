import { el, fmtTime, type RequestRec, type Seat } from "./api.js";

/** The rotation braid: one lane per seat, split into rotation segments with crossovers. */

export type Seg = {
  index: number;
  start: number;
  end: number;
  active: "A" | "B";
};

export function segments(lengthMinutes: number, rotationMinutes: number, seats: 1 | 2): Seg[] {
  const count = Math.ceil(lengthMinutes / rotationMinutes);
  const out: Seg[] = [];
  for (let k = 0; k < count; k++) {
    const start = k * rotationMinutes;
    const end = Math.min((k + 1) * rotationMinutes, lengthMinutes);
    const active = seats === 2 ? (k % 2 === 0 ? "A" : "B") : "A";
    out.push({ index: k, start, end, active });
  }
  return out;
}

export function segmentIndexAt(minute: number, lengthMinutes: number, rotationMinutes: number): number {
  const last = Math.max(0, Math.ceil(lengthMinutes / rotationMinutes) - 1);
  return Math.min(Math.floor(minute / rotationMinutes), last);
}

export function seatName(seat: Seat | undefined): string {
  return seat?.interpreter?.display_name ?? "open";
}

export function seatTaken(seat: Seat | undefined): boolean {
  return seat?.status === "confirmed";
}

export type BraidCallbacks = {
  onPlayhead: (minute: number) => void;
};

export type BraidOptions = {
  request: RequestRec;
  minute: number;
  onMinute: (m: number) => void;
  /** segments to animate filling (seat label -> fill), empty for none */
  filling: Set<string>;
  reducedMotion: boolean;
};

export function braidName(seg: Seg, seat: Seat | undefined, other: Seat | undefined, request: RequestRec): string {
  const start = seg.start;
  const end = seg.end;
  const activeSeat = seg.active === "A" ? seatByLabel(request, "A") : seatByLabel(request, "B");
  const supportSeat = seg.active === "A" ? seatByLabel(request, "B") : seatByLabel(request, "A");
  const activeDesc = `${nameOf(activeSeat)}, ${takenWord(activeSeat)}`;
  const supportDesc = request.team_size === 1
    ? "none"
    : `${nameOf(supportSeat)}, ${takenWord(supportSeat)}`;
  const activeSeg = `${start} to ${end}, active, ${activeDesc}`;
  const supportSeg = `${start} to ${end}, support, ${supportDesc}`;
  void other;
  void seat;
  return `${activeSeg}|${supportSeg}`;
}

export function seatByLabel(request: RequestRec, label: string): Seat | undefined {
  return request.seats.find((s) => s.label === label);
}

export function nameOf(seat: Seat | undefined): string {
  return seat?.interpreter?.display_name ?? "Open";
}

export function takenWord(seat: Seat | undefined): string {
  return seat?.status === "confirmed" ? "taken" : "open";
}

/**
 * Renders the braid lanes, crossover diagonals, playhead slider and readout.
 * The group "Rotation braid" holds list "Seat A lane" and "Seat B lane".
 */
export function renderBraid(opts: BraidOptions): { root: HTMLElement; slider: HTMLInputElement; readout: HTMLElement } {
  const { request } = opts;
  const rotation = request.rotation_minutes;
  const length = request.duration_minutes;
  const segs = segments(length, rotation, request.team_size);
  const reduced = opts.reducedMotion;

  const group = el("div", { role: "group", "aria-label": "Rotation braid", class: "braid" });
  const lanes = el("div", { class: "lanes" });
  const labels: string[] = [];
  const laneTrackHeights: number[] = [];

  const seatA = seatByLabel(request, "A");
  const seatB = seatByLabel(request, "B");

  for (const seat of request.seats) {
    const lane = el("div", { class: "lane" });
    lane.append(el("div", { class: "lane-title" }, `Seat ${seat.label}`));
    const track = el("div", { role: "list", "aria-label": `Seat ${seat.label} lane`, class: "lane-track" });
    for (const seg of segs) {
      const isActive = request.team_size === 1 || seg.active === seat.label;
      const open = seat.status !== "confirmed";
      const classes = ["seg"];
      if (open) classes.push("open-band");
      else if (isActive) classes.push("active-band");
      else classes.push("support-band");
      const fillKey = `${seat.label}:${seg.index}`;
      if (!reduced && opts.filling.has(fillKey)) classes.push("filling");
      const li = el("div", {
        role: "listitem",
        "aria-label": `${seg.start} to ${seg.end}, ${isActive ? "active" : "support"}, ${nameOf(seat)}, ${takenWord(seat)}`,
        class: classes.join(" "),
        style: `grid-column: span ${Math.max(1, Math.round(((seg.end - seg.start) / rotation) * 100))}`,
      });
      if (!open) {
        const sweep = el("span", { class: "sweep", "aria-hidden": "true" });
        li.append(sweep);
        const word = isActive ? "active" : "support";
        li.append(el("span", {}, fits(seg) ? `${nameOf(seat)} · ${word}` : word));
      } else {
        li.append(el("span", {}, fits(seg) ? `open · ${isActive ? "active" : "support"}` : "open"));
      }
      track.append(li);
    }
    lane.append(track);
    lanes.append(lane);
    labels.push(`Seat ${seat.label}`);
    laneTrackHeights.push(40);
  }
  group.append(lanes);

  // crossovers between lanes at each rotation boundary (only for teams of two)
  if (request.team_size === 2 && request.seats.length === 2) {
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "crossovers");
    svg.setAttribute("aria-hidden", "true");
    const wrap = lanes as HTMLElement;
    const width = wrap.clientWidth || 600;
    const topY = 40 + 14;
    const bottomY = 40 + 10 + 40 + 14;
    svg.setAttribute("viewBox", `0 0 ${width} ${bottomY + 4}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    for (let k = 1; k < segs.length; k++) {
      const seg = segs[k];
      if (seg === undefined) continue;
      const x = (seg.start / length) * width;
      const line = document.createElementNS(svgNs, "line");
      line.setAttribute("x1", String(x));
      line.setAttribute("y1", String(topY));
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(bottomY));
      line.setAttribute("class", reduced ? "" : "draw");
      svg.append(line);
    }
    group.append(svg);
  }

  // playhead
  const head = el("div", { class: "playhead", "aria-hidden": "true" });
  positionPlayhead(head, opts.minute, length);
  group.append(head);

  // slider
  const sliderId = "playhead-slider";
  const slider = el("input", {
    type: "range",
    id: sliderId,
    min: 0,
    max: length,
    step: 1,
    value: opts.minute,
    "aria-label": "Playhead",
  }) as HTMLInputElement;
  const readout = el("div", { role: "status", "aria-live": "polite", "aria-label": "Rotation readout", class: "readout" });
  updateReadout(readout, request, opts.minute);
  slider.addEventListener("input", () => {
    const m = Number(slider.value);
    opts.onMinute(m);
    positionPlayhead(head, m, length);
    updateReadout(readout, request, m);
  });
  const sliderRow = el("div", { class: "braid-slider" }, slider);
  group.append(sliderRow, readout);

  // pointer press/drag on the lanes moves the playhead
  const lanesEl = group.querySelector(".lanes") as HTMLElement;
  const applyFromEvent = (clientX: number) => {
    const rect = lanesEl.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const m = Math.round(ratio * length);
    opts.onMinute(m);
    slider.value = String(m);
    positionPlayhead(head, m, length);
    updateReadout(readout, request, m);
  };
  let dragging = false;
  lanesEl.addEventListener("pointerdown", (ev) => {
    dragging = true;
    lanesEl.setPointerCapture(ev.pointerId);
    applyFromEvent(ev.clientX);
  });
  lanesEl.addEventListener("pointermove", (ev) => {
    if (dragging) applyFromEvent(ev.clientX);
  });
  lanesEl.addEventListener("pointerup", () => { dragging = false; });
  lanesEl.addEventListener("pointercancel", () => { dragging = false; });

  return { root: group, slider, readout };
}

function fits(seg: Seg): boolean {
  return seg.end - seg.start >= 20;
}

export function positionPlayhead(head: HTMLElement, minute: number, length: number): void {
  const pct = length === 0 ? 0 : (minute / length) * 100;
  head.style.left = `calc(${pct.toFixed(3)}% - 1px)`;
}

export function updateReadout(readout: HTMLElement, request: RequestRec, minute: number): void {
  const rotation = request.rotation_minutes;
  const segs = segments(request.duration_minutes, rotation, request.team_size);
  const idx = segmentIndexAt(minute, request.duration_minutes, rotation);
  const seg = segs[idx] ?? segs[segs.length - 1];
  if (!seg) {
    readout.textContent = "";
    return;
  }
  const clock = new Date(request.starts_at).getTime() + minute * 60_000;
  const clockStr = fmtTime(new Date(clock).toISOString());
  if (request.team_size === 1 || request.seats.length === 1) {
    readout.textContent = `${clockStr} · Active: Seat A, ${nameOf(seatByLabel(request, "A"))}, ${takenWord(seatByLabel(request, "A"))} · Support: none`;
    return;
  }
  const activeLabel = seg.active;
  const supportLabel = activeLabel === "A" ? "B" : "A";
  const activeSeat = seatByLabel(request, activeLabel);
  const supportSeat = seatByLabel(request, supportLabel);
  readout.textContent = `${clockStr} · Active: Seat ${activeLabel}, ${nameOf(activeSeat)}, ${takenWord(activeSeat)} · Support: Seat ${supportLabel}, ${nameOf(supportSeat)}, ${takenWord(supportSeat)}`;
}

/** Rotation table: one row per segment. */
export function renderRotationTable(request: RequestRec): HTMLElement {
  const segs = segments(request.duration_minutes, request.rotation_minutes, request.team_size);
  const table = el("table", { class: "grid", "aria-label": "Rotation table" });
  const thead = el("thead");
  thead.append(el("tr", {},
    el("th", {}, "Start"),
    el("th", {}, "End"),
    el("th", {}, "Active"),
    el("th", {}, "Support"),
  ));
  table.append(thead);
  const tbody = el("tbody");
  for (const seg of segs) {
    const activeSeat = seatByLabel(request, seg.active);
    const supportLabel = seg.active === "A" ? "B" : "A";
    const supportSeat = seatByLabel(request, supportLabel);
    const activeCell = `Seat ${seg.active}, ${nameOf(activeSeat)}, ${takenWord(activeSeat)}`;
    const supportCell = request.team_size === 1
      ? "none"
      : `Seat ${supportLabel}, ${nameOf(supportSeat)}, ${takenWord(supportSeat)}`;
    tbody.append(el("tr", {},
      el("td", { class: "num", "data-label": "Start" }, String(seg.start)),
      el("td", { class: "num", "data-label": "End" }, String(seg.end)),
      el("td", { "data-label": "Active" }, activeCell),
      el("td", { "data-label": "Support" }, supportCell),
    ));
  }
  table.append(tbody);
  return table;
}
