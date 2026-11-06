/** The Service Dial: a 24-hour ring around the kitchen floor plan. */

import type { DialBlock, DialDay, DialStation, Hold, CancellationPolicy, User } from "../../../shared/api-types.js";
import { ApiClientError, apiJson, idempotencyKeys } from "../../api.js";
import type { Feedback } from "../../feedback.js";
import { fallbackCopy, showActivity, showError, clearProblem } from "../../feedback.js";
import type { Shell } from "../../shell.js";
import { openDialog } from "../../ui/dialog.js";
import { minuteLabel, mss } from "../../kitchen-time.js";
import {
  CX,
  CY,
  HANDLE_R,
  RING_INNER,
  RING_MID,
  RING_OUTER,
  angleToPoint,
  clamp,
  clientToSvg,
  minuteToAngle,
  pointToMinute,
  ringSector,
  snapStep
} from "./dial-geometry.js";

interface ScreenDeps {
  user: User | null;
  feedback: Feedback;
  navigate(path: string): void;
  zone(): string;
  kitchenName: string;
  registerCleanup(fn: () => void): void;
}

type StationState = "free" | "booked" | "held" | "cleaning";

interface InstantState {
  state: StationState;
  block: DialBlock | null;
  untilMinute: number | null;
}

const CLEANING_MINUTES = 30;
const TILE_LAYOUT: Array<{ id: string; left: string; top: string }> = [
  { id: "hot-line-1", left: "2%", top: "6%" },
  { id: "hot-line-2", left: "2%", top: "52%" },
  { id: "bake-deck", left: "58%", top: "6%" },
  { id: "cold-prep-a", left: "58%", top: "52%" },
  { id: "cold-prep-b", left: "30%", top: "78%" }
];

export class DialScreen {
  private day: DialDay | null = null;
  private value = 0;
  private selectedStation: string | null = null;
  private svg!: SVGSVGElement;
  private handleGroup!: SVGGElement;
  private nowMark!: SVGGElement;
  private blocksLayer!: SVGGElement;
  private dragArc: SVGPathElement | null = null;
  private dragState: { pressMinute: number; from: number; to: number; direction: 1 | -1 } | null = null;
  private draggingHandle = false;
  private tileEls = new Map<
    string,
    {
      tile: HTMLElement;
      layerA: HTMLElement;
      layerB: HTMLElement;
      active: "a" | "b";
      state: HTMLElement;
      name: HTMLElement;
      lastState: StationState | null;
    }
  >();
  private railRowsEl!: HTMLElement;
  private holdPanelEl!: HTMLElement;
  private openActionsEl!: HTMLElement;
  private sliderEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private countEl!: HTMLElement;
  private dateInput!: HTMLInputElement;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private tileTimer: ReturnType<typeof setTimeout> | null = null;
  private readoutTimer: ReturnType<typeof setTimeout> | null = null;
  private policy: CancellationPolicy | null = null;
  private reducedMotion = false;
  private rails: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: ScreenDeps,
    private readonly shell: Shell
  ) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async render(): Promise<void> {
    const user = this.deps.user;
    if (user === null) return;
    const wrap = document.createElement("div");
    wrap.className = "screen dial-screen";

    const grid = document.createElement("div");
    grid.className = "dial-grid";

    const dialCol = document.createElement("section");
    const daybar = document.createElement("div");
    daybar.className = "daybar";

    const prevDay = document.createElement("button");
    prevDay.className = "btn";
    prevDay.textContent = "Previous day";
    const dayLabel = document.createElement("label");
    dayLabel.textContent = "Day";
    dayLabel.className = "hint";
    this.dateInput = document.createElement("input");
    this.dateInput.type = "date";
    this.dateInput.setAttribute("aria-label", "Day");
    this.dateInput.style.minHeight = "40px";
    dayLabel.appendChild(this.dateInput);
    const nextDay = document.createElement("button");
    nextDay.className = "btn";
    nextDay.textContent = "Next day";
    const nowButton = document.createElement("button");
    nowButton.className = "btn";
    nowButton.textContent = "Now";
    daybar.append(prevDay, dayLabel, nextDay, nowButton);
    dialCol.appendChild(daybar);

    // The slider wraps the whole dial; the ring, tiles and readout live inside it.
    this.sliderEl = document.createElement("div");
    this.sliderEl.className = "dial-wrap";
    this.sliderEl.setAttribute("role", "slider");
    this.sliderEl.setAttribute("aria-label", "Service dial");
    this.sliderEl.setAttribute("aria-valuemin", "0");
    this.sliderEl.setAttribute("aria-valuemax", "1440");
    this.sliderEl.tabIndex = 0;
    dialCol.appendChild(this.sliderEl);

    this.buildSvg();
    this.buildFloorPlan();

    const rail = document.createElement("aside");
    rail.className = "rail";
    rail.setAttribute("role", "region");
    rail.setAttribute("aria-label", "Selected instant");
    const railTitle = document.createElement("h2");
    railTitle.textContent = "Selected instant";
    this.railRowsEl = document.createElement("div");
    this.openActionsEl = document.createElement("div");
    this.openActionsEl.className = "open-actions";
    this.holdPanelEl = document.createElement("div");
    const sweep = document.createElement("div");
    sweep.className = "pending-sweep";
    const workingNote = document.createElement("div");
    workingNote.className = "working-note";
    workingNote.textContent = "Working…";
    rail.append(sweep, workingNote, railTitle, this.railRowsEl, this.openActionsEl, this.holdPanelEl);
    this.rails = rail;
    if (this.reducedMotion) {
      rail.appendChild(this.buildTimeListbox());
    }

    grid.append(dialCol, rail);
    wrap.appendChild(grid);
    this.root.replaceChildren(wrap);

    prevDay.addEventListener("click", () => this.changeDay(-1));
    nextDay.addEventListener("click", () => this.changeDay(1));
    nowButton.addEventListener("click", () => void this.jumpToNow());
    this.dateInput.addEventListener("change", () => void this.loadDay(this.dateInput.value));

    this.sliderEl.addEventListener("wheel", (event) => this.onWheel(event as WheelEvent), { passive: false });
    this.sliderEl.addEventListener("keydown", (event) => this.onSliderKey(event as KeyboardEvent));
    this.svg.addEventListener("pointerdown", (event) => this.onPointerDown(event as PointerEvent));
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);

    try {
      this.policy = (await apiJson<{ current: CancellationPolicy }>("GET", "/api/cancellation-policy")).current;
    } catch {
      this.policy = null;
    }

    await this.loadDay(undefined, true);
    this.refreshTimer = setInterval(() => void this.refreshDay(true), 30_000);
  }

  destroy(): void {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    if (this.timerInterval !== null) clearInterval(this.timerInterval);
  }

  // ---- svg scaffolding ----
  private buildSvg(): void {
    const NS = "http://www.w3.org/2000/svg";
    this.svg = document.createElementNS(NS, "svg");
    this.svg.setAttribute("viewBox", "0 0 600 600");
    this.svg.classList.add("dial-svg");
    this.sliderEl.appendChild(this.svg);

    const defs = document.createElementNS(NS, "defs");
    const defsHtml = `
      <pattern id="heldDots" width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="1.4" fill="#0d5c50"/>
      </pattern>
      <pattern id="cleanStripes" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(135)">
        <rect width="4" height="9" fill="#6b777c"/>
      </pattern>`;
    defs.innerHTML = defsHtml;
    this.svg.appendChild(defs);

    const track = document.createElementNS(NS, "circle");
    track.setAttribute("cx", String(CX));
    track.setAttribute("cy", String(CY));
    track.setAttribute("r", String(RING_MID));
    track.setAttribute("fill", "none");
    track.setAttribute("stroke", "#d7dcde");
    track.setAttribute("stroke-width", String(RING_OUTER - RING_INNER));
    this.svg.appendChild(track);

    // hour ticks
    const ticks = document.createElementNS(NS, "g");
    for (let h = 0; h < 24; h++) {
      const a = angleToPoint(h * 15, RING_INNER - 8);
      const b = angleToPoint(h * 15, RING_INNER - 1);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", a.x.toFixed(2));
      line.setAttribute("y1", a.y.toFixed(2));
      line.setAttribute("x2", b.x.toFixed(2));
      line.setAttribute("y2", b.y.toFixed(2));
      line.setAttribute("stroke", "#8a9499");
      line.setAttribute("stroke-width", "1.4");
      ticks.appendChild(line);
      if (h % 3 === 0) {
        const labelPos = angleToPoint(h * 15, RING_OUTER + 14);
        const label = document.createElementNS(NS, "text");
        label.setAttribute("x", labelPos.x.toFixed(2));
        label.setAttribute("y", (labelPos.y + 4).toFixed(2));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("font-size", "11");
        label.setAttribute("fill", "#45585c");
        label.setAttribute("font-family", "IBM Plex Mono, monospace");
        label.textContent = String(h).padStart(2, "0");
        ticks.appendChild(label);
      }
    }
    this.svg.appendChild(ticks);

    this.blocksLayer = document.createElementNS(NS, "g");
    this.svg.appendChild(this.blocksLayer);

    // the "now" marker on today's ring
    this.nowMark = document.createElementNS(NS, "g");
    const nowLine = document.createElementNS(NS, "line");
    this.nowMark.appendChild(nowLine);
    this.svg.appendChild(this.nowMark);

    // orange spoke from the centre to the handle
    const spoke = document.createElementNS(NS, "line");
    spoke.setAttribute("x1", String(CX));
    spoke.setAttribute("y1", String(CY));
    spoke.setAttribute("x2", String(CX));
    spoke.setAttribute("y2", String(CY - RING_MID));
    spoke.setAttribute("stroke", "#d95704");
    spoke.setAttribute("stroke-width", "2.5");
    this.handleGroup = document.createElementNS(NS, "g");
    this.handleGroup.appendChild(spoke);
    const handle = document.createElementNS(NS, "circle");
    handle.setAttribute("cx", String(CX));
    handle.setAttribute("cy", String(CY - RING_MID));
    handle.setAttribute("r", String(HANDLE_R));
    handle.setAttribute("fill", "#d95704");
    handle.setAttribute("stroke", "#fff");
    handle.setAttribute("stroke-width", "2");
    handle.setAttribute("data-handle", "true");
    this.handleGroup.appendChild(handle);
    // A transparent halo keeps the grab target at least 44px.
    const halo = document.createElementNS(NS, "circle");
    halo.setAttribute("cx", String(CX));
    halo.setAttribute("cy", String(CY - RING_MID));
    halo.setAttribute("r", "24");
    halo.setAttribute("fill", "rgba(0,0,0,0)");
    halo.setAttribute("data-handle", "true");
    this.handleGroup.appendChild(halo);
    this.svg.appendChild(this.handleGroup);
    this.handleGroup.style.transformOrigin = `${CX}px ${CY}px`;

    const centre = document.createElement("div");
    centre.className = "dial-center";
    this.timeEl = document.createElement("div");
    this.timeEl.className = "time";
    this.countEl = document.createElement("div");
    this.countEl.className = "open-count";
    centre.append(this.timeEl, this.countEl);
    this.sliderEl.appendChild(centre);
  }

  private buildFloorPlan(): void {
    const plan = document.createElement("div");
    plan.className = "floor-plan";
    plan.setAttribute("role", "group");
    plan.setAttribute("aria-label", "Floor plan");

    const walkIn = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    walkIn.setAttribute("viewBox", "0 0 100 100");
    walkIn.style.position = "absolute";
    walkIn.style.inset = "0";
    walkIn.style.width = "100%";
    walkIn.style.height = "100%";
    walkIn.innerHTML = `
      <rect x="2" y="2" width="96" height="96" fill="none" stroke="#8a9499" stroke-width="1.2" stroke-dasharray="4 3"/>
      <rect x="60" y="2" width="38" height="22" fill="none" stroke="#8a9499" stroke-width="1.2"/>
      <text x="79" y="15" text-anchor="middle" font-size="7" fill="#45585c" font-family="Public Sans, sans-serif">Walk-in</text>
      <rect x="2" y="2" width="96" height="96" fill="none"/>`;
    plan.appendChild(walkIn);

    for (const layout of TILE_LAYOUT) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "station-tile";
      tile.style.left = layout.left;
      tile.style.top = layout.top;
      const layerA = document.createElement("div");
      layerA.className = "tile-fill layer-a";
      const layerB = document.createElement("div");
      layerB.className = "tile-fill layer-b";
      const state = document.createElement("span");
      state.className = "tile-state";
      const name = document.createElement("span");
      name.className = "tile-name";
      tile.append(layerA, layerB, state, name);
      tile.addEventListener("click", () => this.selectStation(layout.id));
      this.tileEls.set(layout.id, { tile, layerA, layerB, active: "a", state, name, lastState: null });
      plan.appendChild(tile);
    }
    this.sliderEl.appendChild(plan);
  }

  /** Under reduced motion the arc drag is replaced by a listbox of the day's steps. */
  private buildTimeListbox(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";
    const label = document.createElement("div");
    label.className = "hint";
    label.textContent = "Time";
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    listbox.setAttribute("aria-label", "Time");
    listbox.tabIndex = 0;
    listbox.style.maxHeight = "140px";
    listbox.style.overflowY = "auto";
    listbox.style.border = "1px solid var(--rule)";
    listbox.style.background = "#fff";
    for (let m = 0; m <= 1440; m += 15) {
      const option = document.createElement("div");
      option.setAttribute("role", "option");
      option.dataset.minute = String(m);
      option.textContent = minuteLabel(m);
      option.style.padding = "6px 10px";
      option.addEventListener("click", () => {
        this.value = m;
        this.applyValue(true);
        this.markSelectedOption(listbox);
      });
      listbox.appendChild(option);
    }
    listbox.addEventListener("keydown", (event) => {
      const current = listbox.querySelector('[aria-selected="true"]');
      const options = Array.from(listbox.querySelectorAll<HTMLElement>("[role=option]"));
      const idx = options.findIndex((o) => o === current);
      let next = idx;
      if (event.key === "ArrowDown") next = Math.min(options.length - 1, idx + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, idx - 1);
      else return;
      event.preventDefault();
      this.value = Number(options[next].dataset.minute);
      this.markSelectedOption(listbox);
      this.applyValue(true);
      options[next].scrollIntoView({ block: "nearest" });
    });
    wrap.append(label, listbox);
    return wrap;
  }

  private markSelectedOption(listbox: HTMLElement): void {
    for (const option of listbox.querySelectorAll<HTMLElement>("[role=option]")) {
      const selected = Number(option.dataset.minute) === this.value;
      option.setAttribute("aria-selected", String(selected));
      option.style.background = selected ? "#eef3f2" : "";
      if (selected) option.scrollIntoView({ block: "nearest" });
    }
  }

  // ---- data ----
  private async loadDay(date: string | undefined, firstLoad = false): Promise<void> {
    const query = date === undefined ? "" : `?date=${encodeURIComponent(date)}`;
    if (!firstLoad) showActivity(this.deps.feedback, "");
    try {
      const day = await apiJson<DialDay>("GET", `/api/dial${query}`);
      this.day = day;
      this.dateInput.value = day.date;
      if (firstLoad) {
        // Open at kitchen today on the current 15-minute step.
        const now = day.now_minute ?? 0;
        this.value = day.date === day.today ? Math.floor(now / 15) * 15 : 0;
        this.selectedStation = day.stations[0]?.id ?? null;
        this.applyValue(true);
      } else {
        this.applyValue(true);
      }
      this.renderTiles(true);
      this.renderRail();
      this.renderNowMark();
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(this.deps.feedback, fallbackCopy(e));
      }
    }
  }

  private async refreshDay(background: boolean): Promise<void> {
    try {
      const day = await apiJson<DialDay>("GET", `/api/dial?date=${encodeURIComponent(this.day?.date ?? "")}`);
      this.day = day;
      this.renderTiles(true);
      this.renderRail();
      this.renderNowMark();
      this.renderStationArcs();
    } catch (e) {
      if (e instanceof ApiClientError && !background) {
        showError(this.deps.feedback, fallbackCopy(e));
      } else if (e instanceof ApiClientError) {
        showError(this.deps.feedback, "Couldn't load the day. Retrying in 30 seconds.");
      }
    }
  }

  private async changeDay(delta: number): Promise<void> {
    if (this.day === null) return;
    const base = new Date(`${this.day.date}T12:00:00Z`);
    const next = new Date(base.getTime() + delta * 86_400_000);
    const iso = next.toISOString().slice(0, 10);
    showActivity(this.deps.feedback, "Loading the day…");
    await this.loadDay(iso);
    clearProblem(this.deps.feedback);
  }

  private async jumpToNow(): Promise<void> {
    const day = await apiJson<DialDay>("GET", "/api/dial");
    this.day = day;
    this.dateInput.value = day.date;
    this.value = Math.floor((day.now_minute ?? 0) / 15) * 15;
    this.applyValue(true);
    this.renderTiles(true);
    this.renderRail();
    this.renderNowMark();
    this.renderStationArcs();
  }

  // ---- state model ----
  /** The state of a station at a wall minute (value 1440 reads the last minute of the day). */
  private stateAt(station: DialStation, value: number): InstantState {
    const m = value === 1440 ? 1439.999 : value;
    let found: DialBlock | null = null;
    for (const block of station.blocks) {
      if (block.kind !== "cleaning" && block.start_minute <= m && m < block.end_minute) {
        found = found ?? block;
      }
    }
    if (found !== null) {
      const own = found.tenant_id === this.deps.user?.tenant_id;
      const isHold = found.kind === "hold";
      const visible = this.deps.user?.role === "operator" || own;
      return { state: isHold && visible ? "held" : "booked", block: found, untilMinute: found.end_minute };
    }
    for (const block of station.blocks) {
      if (block.kind === "cleaning" && block.start_minute <= m && m < block.end_minute) {
        return { state: "cleaning", block, untilMinute: block.end_minute };
      }
    }
    return { state: "free", block: null, untilMinute: null };
  }

  private openCount(): number {
    if (this.day === null) return 0;
    return this.day.stations.filter((s) => this.stateAt(s, this.value).state === "free").length;
  }

  // ---- rendering ----
  private applyValue(immediate = false): void {
    const count = this.openCount();
    this.sliderEl.setAttribute("aria-valuenow", String(this.value));
    const timeText = minuteLabel(this.value);
    this.sliderEl.setAttribute("aria-valuetext", `${timeText}, ${count} of ${this.day?.stations.length ?? 0} open`);

    const angle = minuteToAngle(this.value);
    const reduced = this.reducedMotion || immediate;
    if (reduced) {
      this.handleGroup.style.transition = "none";
    } else {
      this.handleGroup.style.transition = "transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)";
    }
    this.handleGroup.style.transform = `rotate(${angle}deg)`;

    const listbox = this.rails?.querySelector<HTMLElement>("[role=listbox]");
    if (listbox !== null && listbox !== undefined) this.markSelectedOption(listbox);
    if (reduced) {
      this.rollReadout(timeText, count, true);
    } else {
      if (this.readoutTimer !== null) clearTimeout(this.readoutTimer);
      this.readoutTimer = setTimeout(() => this.rollReadout(timeText, count, false), 100);
    }
    if (this.tileTimer !== null) clearTimeout(this.tileTimer);
    if (reduced) {
      this.renderTiles(false);
    } else {
      this.tileTimer = setTimeout(() => this.renderTiles(false), 50);
    }
    this.renderRail();
    this.renderOpenActions();
  }

  private rollReadout(timeText: string, count: number, instant: boolean): void {
    const direction = timeText >= (this.timeEl.dataset.value ?? "") ? 1 : -1;
    this.timeEl.dataset.value = timeText;
    this.countEl.dataset.value = String(count);
    if (instant || this.reducedMotion) {
      this.timeEl.textContent = timeText;
      this.countEl.textContent = `${count} of ${this.day?.stations.length ?? 0} open`;
      return;
    }
    rollText(this.timeEl, timeText, direction);
    rollText(this.countEl, `${count} of ${this.day?.stations.length ?? 0} open`, direction);
  }

  /** Fill layers cross-fade when a tile's state changes; instant under reduced motion. */
  private renderTiles(instant = false): void {
    if (this.day === null) return;
    for (const station of this.day.stations) {
      const entry = this.tileEls.get(station.id);
      if (entry === undefined) continue;
      const state = this.stateAt(station, this.value);
      entry.tile.setAttribute("aria-pressed", String(this.selectedStation === station.id));
      entry.name.textContent = station.name;

      const own = state.block?.tenant_id === this.deps.user?.tenant_id;
      const isOperator = this.deps.user?.role === "operator";
      let stateText: string;
      let label: string;
      switch (state.state) {
        case "free":
          stateText = "Free";
          label = "free";
          break;
        case "booked":
          stateText = "Booked";
          label = (isOperator || own) && state.block?.tenant_name ? `booked by ${state.block.tenant_name}` : "booked";
          break;
        case "held":
          stateText = `Held ${this.holdCountdown()}`;
          label = (isOperator || own) && state.block?.tenant_name ? `held by ${state.block.tenant_name}` : "held";
          break;
        case "cleaning":
          stateText = "Cleaning";
          label = "cleaning";
          break;
      }
      entry.state.textContent = stateText;
      entry.tile.setAttribute("aria-label", `${station.name}, ${label}`);

      const changed = entry.lastState !== state.state;
      entry.lastState = state.state;
      const targetOpacity = state.state === "free" ? "0" : state.state === "booked" ? "1" : state.state === "held" ? "0.9" : "0.7";
      if (!changed || instant || this.reducedMotion) {
        const active = entry.active === "a" ? entry.layerA : entry.layerB;
        const inactive = entry.active === "a" ? entry.layerB : entry.layerA;
        active.className = `tile-fill ${entry.active === "a" ? "layer-a" : "layer-b"} state-${state.state}`;
        active.style.transition = "none";
        active.style.opacity = targetOpacity;
        inactive.className = `tile-fill ${entry.active === "a" ? "layer-b" : "layer-a"}`;
        inactive.style.opacity = "0";
        entry.tile.classList.toggle("state-free", state.state === "free");
        continue;
      }
      // Cross-fade: the new pattern comes in on the inactive layer while the old fades out.
      const active = entry.active === "a" ? entry.layerA : entry.layerB;
      const incoming = entry.active === "a" ? entry.layerB : entry.layerA;
      incoming.className = `tile-fill ${entry.active === "a" ? "layer-b" : "layer-a"} state-${state.state}`;
      incoming.style.transition = "none";
      incoming.style.opacity = "0";
      requestAnimationFrame(() => {
        incoming.style.transition = this.reducedMotion ? "none" : "opacity 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
        incoming.style.opacity = targetOpacity;
        active.style.transition = this.reducedMotion ? "none" : "opacity 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)";
        active.style.opacity = "0";
      });
      entry.active = entry.active === "a" ? "b" : "a";
      entry.tile.classList.toggle("state-free", state.state === "free");
    }
  }

  private renderRail(): void {
    if (this.day === null) return;
    this.railRowsEl.replaceChildren();
    this.day.stations.forEach((station, index) => {
      const state = this.stateAt(station, this.value);
      const row = document.createElement("div");
      row.className = `instant-row${this.selectedStation === station.id ? " row-selected" : ""}`;
      const num = document.createElement("span");
      num.className = "row-num mono";
      num.textContent = String(index + 1);
      const main = document.createElement("div");
      main.className = "row-main";
      const stationLine = document.createElement("div");
      stationLine.className = "row-station";
      stationLine.textContent = station.name;
      main.appendChild(stationLine);
      const detail = document.createElement("div");
      detail.className = "row-detail";
      const own = state.block?.tenant_id === this.deps.user?.tenant_id;
      const isOperator = this.deps.user?.role === "operator";
      if (state.block !== null && state.block.kind !== "cleaning" && (isOperator || own)) {
        const parts: string[] = [];
        parts.push(state.block.ref ?? "");
        if (isOperator && state.block.contact_email) parts.push(state.block.contact_email);
        if (state.block.notes) parts.push(state.block.notes);
        detail.textContent = parts.filter(Boolean).join(" · ");
      }
      main.appendChild(detail);
      const stateLine = document.createElement("div");
      stateLine.className = "row-state mono";
      let stateText = state.state === "booked" ? "Booked" : state.state === "held" ? "Held" : state.state === "cleaning" ? "Cleaning" : "Free";
      if ((isOperator || own) && state.block?.kind !== "cleaning" && state.block?.tenant_name && (state.state === "booked" || state.state === "held")) {
        stateText = `${stateText} — ${state.block.tenant_name}`;
      }
      if (state.untilMinute !== null) {
        stateLine.textContent = `${stateText} until ${minuteLabel(state.untilMinute)}`;
      } else {
        stateLine.textContent = stateText;
      }
      row.append(num, main, stateLine);
      row.addEventListener("click", () => this.selectStation(station.id));
      this.railRowsEl.appendChild(row);
    });
  }

  private renderNowMark(): void {
    const line = this.nowMark.querySelector("line") as SVGLineElement;
    if (this.day?.now_minute === null || this.day?.now_minute === undefined) {
      this.nowMark.style.display = "none";
      return;
    }
    this.nowMark.style.display = "";
    const m = this.day.now_minute;
    const a = angleToPoint(minuteToAngle(m), RING_INNER - 2);
    const b = angleToPoint(minuteToAngle(m), RING_OUTER + 2);
    line.setAttribute("x1", a.x.toFixed(2));
    line.setAttribute("y1", a.y.toFixed(2));
    line.setAttribute("x2", b.x.toFixed(2));
    line.setAttribute("y2", b.y.toFixed(2));
    line.setAttribute("stroke", "#d95704");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "3 2");
  }

  private renderOpenActions(): void {
    this.openActionsEl.replaceChildren();
    const holdButton = document.createElement("button");
    holdButton.className = "btn primary";
    holdButton.textContent = "Hold this station";
    const station = this.day?.stations.find((s) => s.id === this.selectedStation);
    const free = station !== undefined && this.stateAt(station, this.value).state === "free";
    holdButton.disabled = !free;
    holdButton.addEventListener("click", () => this.openPlaceHoldDialog());
    this.openActionsEl.appendChild(holdButton);
  }

  /** The viewer's live hold, found among their own blocks on the dial. */
  private ownLiveHold(): { block: DialBlock; stationId: string } | null {
    if (this.day === null) return null;
    for (const station of this.day.stations) {
      for (const block of station.blocks) {
        if (block.kind === "hold" && block.tenant_id === this.deps.user?.tenant_id) {
          return { block, stationId: station.id };
        }
      }
    }
    return null;
  }

  private holdCountdown(): string {
    const hold = this.ownLiveHold();
    if (hold === null || !hold.block.expires_at) return "";
    const remaining = Math.max(0, Math.round((Date.parse(hold.block.expires_at) - Date.now()) / 1000));
    return mss(remaining);
  }

  private startHoldTimer(): void {
    if (this.timerInterval !== null) clearInterval(this.timerInterval);
    const update = (): void => {
      const hold = this.ownLiveHold();
      if (hold === null) {
        this.stopHoldTimer();
        this.renderHoldPanel(null);
        void this.refreshDay(true);
        return;
      }
      const timerEl = this.holdPanelEl.querySelector<HTMLElement>("[data-timer]");
      if (timerEl !== null) {
        const remaining = Math.max(0, Math.round((Date.parse(hold.block.expires_at ?? "") - Date.now()) / 1000));
        timerEl.textContent = `Expires in ${mss(remaining)}`;
        const tile = this.tileEls.get(hold.stationId);
        if (tile !== undefined) tile.state.textContent = `Held ${mss(remaining)}`;
      }
    };
    this.timerInterval = setInterval(update, 1000);
    update();
  }

  private stopHoldTimer(): void {
    if (this.timerInterval !== null) clearInterval(this.timerInterval);
    this.timerInterval = null;
  }

  private renderHoldPanel(afterConfirmRef?: string | null): void {
    this.holdPanelEl.replaceChildren();
    const hold = this.ownLiveHold();
    if (hold === null) {
      if (afterConfirmRef !== null && afterConfirmRef !== undefined) {
        const note = document.createElement("div");
        note.textContent = `Hold ${afterConfirmRef} confirmed.`;
        this.holdPanelEl.appendChild(note);
      }
      return;
    }
    const block = hold.block;
    const ref = block.hold_ref ?? "";
    const panel = document.createElement("div");
    panel.className = "hold-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", `Hold ${ref}`);

    const timerRegion = document.createElement("div");
    timerRegion.setAttribute("role", "timer");
    timerRegion.setAttribute("aria-label", "Hold time left");
    timerRegion.className = "timer-line";
    timerRegion.dataset.timer = "true";
    timerRegion.textContent = "Expires in --:--";
    panel.appendChild(timerRegion);

    const radioRow = document.createElement("div");
    radioRow.className = "radio-row";
    radioRow.setAttribute("role", "radiogroup");
    radioRow.setAttribute("aria-label", "Pay with");
    const account = document.createElement("label");
    const accountRadio = document.createElement("input");
    accountRadio.type = "radio";
    accountRadio.name = "pay-with";
    accountRadio.value = "account";
    accountRadio.checked = true;
    accountRadio.id = "pay-account";
    account.append(accountRadio, document.createTextNode("Account"));
    const pack = document.createElement("label");
    const packRadio = document.createElement("input");
    packRadio.type = "radio";
    packRadio.name = "pay-with";
    packRadio.value = "hour_pack";
    packRadio.id = "pay-pack";
    pack.append(packRadio, document.createTextNode("Hour pack"));
    radioRow.append(account, pack);
    panel.appendChild(radioRow);

    if (this.policy !== null) {
      const policyLine = document.createElement("div");
      policyLine.className = "policy-line";
      policyLine.textContent = `Cancellation: free until ${this.policy.free_window_hours} hours before start, then ${this.policy.late_fee_percent}% charge (policy v${this.policy.version})`;
      panel.appendChild(policyLine);
    }

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn primary";
    confirmBtn.textContent = "Confirm booking";
    const releaseBtn = document.createElement("button");
    releaseBtn.className = "btn";
    releaseBtn.textContent = "Release hold";
    actions.append(confirmBtn, releaseBtn);
    panel.appendChild(actions);

    confirmBtn.addEventListener("click", () =>
      void this.confirmHold(ref, accountRadio.checked ? "account" : "hour_pack", confirmBtn)
    );
    releaseBtn.addEventListener("click", () => void this.releaseHold(ref));

    this.holdPanelEl.appendChild(panel);
    this.startHoldTimer();
  }

  // ---- interactions ----
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.value <= 0 && event.deltaY < 0) return;
    if (this.value >= 1440 && event.deltaY > 0) return;
    this.value = clamp(this.value + (event.deltaY > 0 ? 15 : -15), 0, 1440);
    this.applyValue();
  }

  private onSliderKey(event: KeyboardEvent): void {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = this.value + 15;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = this.value - 15;
        break;
      case "PageUp":
        next = this.value + 60;
        break;
      case "PageDown":
        next = this.value - 60;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 1440;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.value = clamp(next, 0, 1440);
    this.applyValue();
  }

  private selectStation(id: string): void {
    this.selectedStation = id;
    this.renderTiles(true);
    this.renderRail();
    this.renderOpenActions();
    this.renderStationArcs();
  }

  private onPointerDown(event: PointerEvent): void {
    const target = event.target as Element;
    if (target.closest("[data-handle]") !== null) {
      this.draggingHandle = true;
      return;
    }
    const pt = clientToSvg(this.svg, event.clientX, event.clientY);
    const minute = clamp(snapStep(pointToMinute(pt.x, pt.y)), 0, 1440);
    if (this.reducedMotion) {
      // Under reduced motion, pressing the ring track only moves the dial.
      this.value = minute;
      this.applyValue(true);
      return;
    }
    // Drawing a hold arc: a free station must be selected.
    const station = this.day?.stations.find((s) => s.id === this.selectedStation);
    if (station === undefined || this.stateAt(station, this.value).state !== "free") return;
    this.dragState = { pressMinute: minute, from: minute, to: minute, direction: 1 };
    this.setDragArc(minute, minute, false);
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.draggingHandle) {
      const pt = clientToSvg(this.svg, event.clientX, event.clientY);
      this.value = clamp(snapStep(pointToMinute(pt.x, pt.y)), 0, 1440);
      this.applyValue();
      return;
    }
    if (this.dragState !== null) {
      const pt = clientToSvg(this.svg, event.clientX, event.clientY);
      const minute = clamp(snapStep(pointToMinute(pt.x, pt.y)), 0, 1440);
      const press = this.dragState.pressMinute;
      let from = press;
      let to = minute;
      if (minute < press) {
        [from, to] = [minute, press];
      }
      // limit the arc length to the hold rules
      const length = to - from;
      if (length > 480) {
        if (minute >= press) to = press + 480;
        else from = press - 480;
      }
      this.dragState = { ...this.dragState, from, to, direction: minute >= press ? 1 : -1 };
      this.setDragArc(from, to, to - from < 60);
    }
  };

  private onPointerUp = (): void => {
    if (this.draggingHandle) {
      this.draggingHandle = false;
      return;
    }
    const drag = this.dragState;
    if (drag === null) return;
    this.dragState = null;
    const length = drag.to - drag.from;
    if (length < 60) {
      this.retractArc();
      return;
    }
    const startMinute = drag.direction === 1 ? drag.from : drag.to;
    const endMinute = drag.direction === 1 ? drag.to : drag.from;
    void this.placeHoldFromArc(startMinute, endMinute);
  };

  private setDragArc(from: number, to: number, tooShort: boolean): void {
    if (this.dragArc === null) {
      this.dragArc = document.createElementNS("http://www.w3.org/2000/svg", "path");
      this.dragArc.setAttribute("fill", "rgba(13, 92, 80, 0.25)");
      this.dragArc.setAttribute("stroke", "#0d5c50");
      this.dragArc.setAttribute("stroke-width", "1.5");
      this.dragArc.setAttribute("stroke-dasharray", "5 4");
      this.blocksLayer.appendChild(this.dragArc);
    }
    if (tooShort) {
      this.dragArc.setAttribute("fill", "rgba(107, 119, 124, 0.18)");
      this.dragArc.setAttribute("stroke", "#8a9499");
    } else {
      this.dragArc.setAttribute("fill", "rgba(13, 92, 80, 0.25)");
      this.dragArc.setAttribute("stroke", "#0d5c50");
    }
    this.dragArc.setAttribute("d", ringSector(from, Math.max(to, from + 4)));
  }

  private retractArc(): void {
    const arc = this.dragArc;
    if (arc === null) return;
    this.dragArc = null;
    if (this.reducedMotion) {
      arc.remove();
      return;
    }
    arc.style.transition = "opacity 0.2s ease";
    arc.style.opacity = "0";
    setTimeout(() => arc.remove(), 220);
  }

  private async placeHoldFromArc(startMinute: number, endMinute: number): Promise<void> {
    if (this.day === null) return;
    const station = this.day.stations.find((s) => s.id === this.selectedStation);
    if (station === undefined) return;
    const arc = this.dragArc;
    this.dragArc = null;
    showActivity(this.deps.feedback, "Placing hold…");
    this.deps.feedback.setPending(this.rails, true);
    try {
      const hold = await apiJson<Hold>("POST", "/api/holds", {
        station_id: station.id,
        date: this.day.date,
        start_local: minuteLabel(startMinute),
        end_local: minuteLabel(endMinute)
      });
      if (arc !== null) {
        arc.setAttribute("fill", "rgba(13, 92, 80, 0.35)");
        arc.setAttribute("stroke", "#0d5c50");
        arc.style.transition = "opacity 0.3s ease";
        setTimeout(() => arc.remove(), 350);
      }
      showActivity(
        this.deps.feedback,
        `Hold ${hold.ref} placed. It expires at ${hold.expires_at.slice(11, 19)}.`
      );
      await this.refreshDay(true);
      this.renderHoldPanel();
    } catch (e) {
      if (arc !== null) this.retractArc();
      if (e instanceof ApiClientError) {
        showError(this.deps.feedback, holdErrorCopy(e));
      }
    } finally {
      this.deps.feedback.setPending(this.rails, false);
    }
  }

  private openPlaceHoldDialog(): void {
    if (this.day === null) return;
    const station = this.day.stations.find((s) => s.id === this.selectedStation);
    if (station === undefined) return;
    const date = this.day.date;
    const defaultStart = minuteLabel(this.value);
    const defaultEnd = minuteLabel(clamp(this.value + 60, 60, 1440));
    openDialog({
      label: "Place hold",
      build: (root, close) => {
        const form = document.createElement("form");
        form.setAttribute("aria-label", "Place hold");
        form.innerHTML = `
          <div><label for="hold-start">Start</label>
            <select id="hold-start" name="start" required></select></div>
          <div><label for="hold-end">End</label>
            <select id="hold-end" name="end" required></select></div>
          <div><label for="hold-repeat">Repeat weekly</label>
            <select id="hold-repeat" name="weeks">
              <option value="1" selected>Just this day</option>
              <option value="2">2 weeks</option><option value="3">3 weeks</option>
              <option value="4">4 weeks</option><option value="5">5 weeks</option>
              <option value="6">6 weeks</option><option value="7">7 weeks</option>
              <option value="8">8 weeks</option><option value="9">9 weeks</option>
              <option value="10">10 weeks</option><option value="11">11 weeks</option>
              <option value="12">12 weeks</option>
            </select></div>
          <div><label for="hold-notes">Notes</label>
            <input id="hold-notes" name="notes" maxlength="500"></div>`;
        const startSelect = form.querySelector("#hold-start") as HTMLSelectElement;
        const endSelect = form.querySelector("#hold-end") as HTMLSelectElement;
        for (let m = 0; m <= 1440; m += 15) {
          const label = minuteLabel(m);
          startSelect.add(new Option(label === "24:00" ? "24:00" : label, label));
          endSelect.add(new Option(label, label));
        }
        startSelect.value = defaultStart;
        endSelect.value = defaultEnd;

        let tenantSelect: HTMLSelectElement | null = null;
        if (this.deps.user?.role === "operator") {
          const row = document.createElement("div");
          row.innerHTML = `<label for="hold-tenant">Tenant</label>`;
          tenantSelect = document.createElement("select");
          tenantSelect.id = "hold-tenant";
          tenantSelect.required = true;
          tenantSelect.add(new Option("Choose a tenant", ""));
          row.appendChild(tenantSelect);
          form.appendChild(row);
          void apiJson<{ tenants: Array<{ id: string; business_name: string; status: string }> }>(
            "GET",
            "/api/tenants"
          ).then((res) => {
            for (const t of res.tenants) {
              if (t.status === "active") tenantSelect?.add(new Option(t.business_name, t.id));
            }
          });
        }

        const actions = document.createElement("div");
        actions.className = "dialog-actions";
        const place = document.createElement("button");
        place.className = "btn primary";
        place.type = "submit";
        place.textContent = "Place hold";
        const cancel = document.createElement("button");
        cancel.className = "btn";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => close());
        actions.append(place, cancel);
        form.appendChild(actions);
        root.appendChild(form);

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void this.placeHoldFromForm(
            station.id,
            date,
            startSelect.value,
            endSelect.value,
            Number((form.querySelector("#hold-repeat") as HTMLSelectElement).value),
            (form.querySelector("#hold-notes") as HTMLInputElement).value,
            tenantSelect !== null ? tenantSelect.value : undefined,
            () => close()
          );
        });
      }
    });
  }

  private async placeHoldFromForm(
    stationId: string,
    date: string,
    start: string,
    end: string,
    weeks: number,
    notes: string,
    tenantId: string | undefined,
    onDone: () => void
  ): Promise<void> {
    showActivity(this.deps.feedback, "Placing hold…");
    this.deps.feedback.setPending(this.rails, true);
    try {
      const body: Record<string, unknown> = {
        station_id: stationId,
        date,
        start_local: start,
        end_local: end,
        weeks,
        notes
      };
      if (tenantId !== undefined && tenantId !== "") {
        body["tenant_id"] = tenantId;
      }
      const hold = await apiJson<Hold>("POST", "/api/holds", body);
      onDone();
      showActivity(
        this.deps.feedback,
        `Hold ${hold.ref} placed. It expires at ${hold.expires_at.slice(11, 19)}.`
      );
      await this.refreshDay(true);
      this.renderHoldPanel();
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(this.deps.feedback, holdErrorCopy(e));
      }
    } finally {
      this.deps.feedback.setPending(this.rails, false);
    }
  }

  private async confirmHold(ref: string, payWith: "account" | "hour_pack", button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    showActivity(this.deps.feedback, "Confirming…");
    this.deps.feedback.setPending(this.rails, true);
    const key = idempotencyKeys.confirmKey(ref, payWith);
    try {
      await apiJson("POST", `/api/holds/${encodeURIComponent(ref)}/confirm`, { pay_with: payWith }, key);
      idempotencyKeys.clearConfirm(ref);
      const ownerEmail = await this.ownerEmailFor(ref);
      showActivity(this.deps.feedback, `Booked. Confirmation for ${ref} was emailed to ${ownerEmail}.`);
      await this.refreshDay(true);
      this.renderHoldPanel(ref);
    } catch (e) {
      button.disabled = false;
      if (e instanceof ApiClientError) {
        showError(this.deps.feedback, confirmErrorCopy(e));
      }
    } finally {
      this.deps.feedback.setPending(this.rails, false);
    }
  }

  private async ownerEmailFor(holdRef: string): Promise<string> {
    const user = this.deps.user;
    if (user === null) return "";
    if (user.role === "owner") return user.email;
    // Operators and cooks read the tenant's owner email.
    const block = this.day?.stations.flatMap((s) => s.blocks).find((b) => b.hold_ref === holdRef);
    if (user.role === "operator" && block?.contact_email) return block.contact_email;
    if (user.tenant_id !== null) {
      try {
        const tenant = await apiJson<{ owner_email: string }>("GET", `/api/tenants/${user.tenant_id}`);
        return tenant.owner_email;
      } catch {
        return "";
      }
    }
    return "";
  }

  private async releaseHold(ref: string): Promise<void> {
    showActivity(this.deps.feedback, "Releasing hold…");
    this.deps.feedback.setPending(this.rails, true);
    try {
      await apiJson("DELETE", `/api/holds/${encodeURIComponent(ref)}`);
      idempotencyKeys.clearConfirm(ref);
      showActivity(this.deps.feedback, `Hold ${ref} released.`);
      await this.refreshDay(true);
      this.renderHoldPanel();
    } catch (e) {
      if (e instanceof ApiClientError) {
        showError(this.deps.feedback, releaseErrorCopy(e));
      }
    } finally {
      this.deps.feedback.setPending(this.rails, false);
    }
  }

  /** Arcs on the ring for the selected station's blocks. */
  private renderStationArcs(): void {
    this.blocksLayer.replaceChildren();
    if (this.day === null || this.selectedStation === null) return;
    const station = this.day.stations.find((s) => s.id === this.selectedStation);
    if (station === undefined) return;
    const own = this.deps.user?.tenant_id;
    for (const block of station.blocks) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", ringSector(block.start_minute, Math.max(block.end_minute, block.start_minute + 4)));
      if (block.kind === "cleaning") {
        path.setAttribute("fill", "url(#cleanStripes)");
        path.setAttribute("opacity", "0.55");
      } else if (block.kind === "hold") {
        path.setAttribute("fill", "url(#heldDots)");
      } else if (block.tenant_id === own || this.deps.user?.role === "operator") {
        path.setAttribute("fill", "#0e1f1c");
      } else {
        path.setAttribute("fill", "#0e1f1c");
        path.setAttribute("opacity", "0.85");
      }
      this.blocksLayer.appendChild(path);
    }
  }
}

/** Error copy for Place hold, per Feedback states. */
function holdErrorCopy(e: ApiClientError): string {
  switch (e.detail.code) {
    case "slot_taken":
      return "That station isn't free for that whole time, including cleaning. Pick another gap.";
    case "tenant_not_active":
      return "Your business can't book right now. Check Documents.";
    case "document_expires_before_booking":
      return "A required document expires before this booking. Upload a renewal first.";
    case "validation_failed":
      return "Check the start and end times.";
    default:
      return fallbackCopy(e);
  }
}

function confirmErrorCopy(e: ApiClientError): string {
  switch (e.detail.code) {
    case "hold_expired":
      return "This hold expired. Place it again if the time is still free.";
    case "invalid_transition":
      return "This hold is already confirmed.";
    case "tenant_not_active":
      return "Your business can't book right now. Check Documents.";
    case "document_expires_before_booking":
      return "A required document expires before this booking. Upload a renewal first.";
    case "insufficient_hours":
      return `Your hour pack has ${hmmText(e)} left; this booking needs ${needText(e)}.`;
    case "billing_unavailable":
      return "Billing is unreachable. Nothing was booked or charged, and your hold is kept until it expires.";
    case "mail_unavailable":
      return "Email is unreachable. Nothing was booked or charged, and your hold is kept until it expires.";
    default:
      return fallbackCopy(e);
  }
}

const needText = (e: ApiClientError): string => {
  const minutes = Number(e.detail.details["needed_minutes"] ?? 0);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

const hmmText = (e: ApiClientError): string => {
  const minutes = Number(e.detail.details["balance_minutes"] ?? 0);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

function releaseErrorCopy(e: ApiClientError): string {
  if (e.detail.code === "not_found") {
    return "That hold is no longer live.";
  }
  return fallbackCopy(e);
}

/** Digit roll: old digits slide up and out, new digits slide in; direction reverses when scrubbing back. */
function rollText(el: HTMLElement, text: string, direction: number): void {
  el.style.position = "relative";
  el.style.overflow = "hidden";
  el.style.whiteSpace = "nowrap";
  for (const old of Array.from(el.querySelectorAll<HTMLElement>(".roll-out"))) {
    old.remove();
  }
  const current = el.querySelector<HTMLElement>(".roll-inner");
  if (current !== null) {
    current.classList.remove("roll-inner");
    current.classList.add("roll-out");
    current.style.position = "absolute";
    current.style.left = "0";
    current.style.right = "0";
    current.style.opacity = "0";
    current.style.transition = "transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)";
    current.style.transform = direction >= 0 ? "translateY(-110%)" : "translateY(110%)";
    setTimeout(() => current.remove(), 260);
  } else if (el.firstChild !== null && el.firstChild.nodeType === Node.TEXT_NODE) {
    // Wrap the initial plain text so it can roll out.
    const initial = document.createElement("span");
    initial.className = "roll-out";
    initial.style.position = "absolute";
    initial.style.left = "0";
    initial.style.right = "0";
    initial.style.transition = "none";
    initial.style.transform = direction >= 0 ? "translateY(0)" : "translateY(0)";
    initial.textContent = el.textContent ?? "";
    el.textContent = "";
    requestAnimationFrame(() => {
      initial.style.transition = "transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)";
      initial.style.transform = direction >= 0 ? "translateY(-110%)" : "translateY(110%)";
    });
    setTimeout(() => initial.remove(), 260);
    el.appendChild(initial);
  }
  const inner = document.createElement("span");
  inner.className = "roll-inner";
  inner.textContent = text;
  inner.style.display = "inline-block";
  inner.style.transition = "none";
  inner.style.transform = direction >= 0 ? "translateY(110%)" : "translateY(-110%)";
  el.appendChild(inner);
  requestAnimationFrame(() => {
    inner.style.transition = "transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)";
    inner.style.transform = "translateY(0)";
  });
}

export async function renderDial(root: HTMLElement, deps: ScreenDeps, shell: Shell): Promise<void> {
  const screen = new DialScreen(root, deps, shell);
  deps.registerCleanup(() => screen.destroy());
  await screen.render();
}
