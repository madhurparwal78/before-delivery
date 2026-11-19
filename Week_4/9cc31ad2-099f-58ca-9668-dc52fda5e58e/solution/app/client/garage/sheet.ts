import { LAYOUTS, type CarStats, type LayoutId } from "../../shared/model";
import { h, prefersReducedMotion, s } from "../dom";
import { MINUS, deltaClass, fmtCoins, fmtDelta, fmtSpeed, fmtTime, type Units } from "../format";
import { easeOutCubic, frames } from "../motion";
import { pathData, pointAt, trackPath, viewBox } from "../track";
import type { Reference } from "../types";

const PREVIEW_MS = 250;
const NO_CHANGE = "No change on the reference lap";

type MeterKey = "accel" | "brake" | "top" | "grip" | "lane";

interface MeterSpec {
  readonly key: MeterKey;
  readonly name: string;
  readonly max: number;
  readonly value: (stats: CarStats) => number;
  readonly text: (stats: CarStats, units: Units) => string;
}

export const METERS: readonly MeterSpec[] = [
  { key: "accel", name: "Acceleration", max: 10, value: (st) => st.accelMps2, text: (st) => `${st.accelMps2.toFixed(1)} m/s²` },
  { key: "brake", name: "Braking", max: 16, value: (st) => st.brakeMps2, text: (st) => `${st.brakeMps2.toFixed(1)} m/s²` },
  { key: "top", name: "Top speed", max: 80, value: (st) => st.topMps, text: (st, units) => fmtSpeed(st.topMps, units) },
  { key: "grip", name: "Grip", max: 130, value: (st) => st.gripPct, text: (st) => `${Math.round(st.gripPct)}%` },
  { key: "lane", name: "Lane change", max: 36, value: (st) => st.laneChangeSteps, text: (st) => `${Math.round(st.laneChangeSteps)} steps` },
];

// One setup sheet stat bar with its value text and the stage preview.
export class Meter {
  readonly element: HTMLElement;
  private readonly valueText: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly preview: HTMLElement;
  private current = 0;
  private target = 0;
  private progress = 0;
  private aim = 0;
  private stop: (() => void) | null = null;

  constructor(private readonly spec: MeterSpec) {
    this.valueText = h("span", { class: "meter-value" });
    this.fill = h("div", { class: "meter-fill" });
    this.preview = h("div", { class: "meter-preview" });
    this.element = h("div", { class: "meter", role: "meter", "aria-label": spec.name, "aria-valuemin": "0", "aria-valuemax": String(spec.max) },
      h("div", { class: "meter-top" }, h("span", { class: "label" }, spec.name), this.valueText),
      h("div", { class: "meter-track", "aria-hidden": "true" }, this.preview, this.fill));
  }

  set(stats: CarStats, units: Units): void {
    const value = this.spec.value(stats);
    this.current = value / this.spec.max;
    this.element.setAttribute("aria-valuenow", String(value));
    this.writeText(this.spec.text(stats, units));
    this.fill.style.transform = `scaleX(${this.current})`;
    this.cancel();
    this.progress = 0;
    this.aim = 0;
    this.target = this.current;
    this.drawPreview();
  }

  private writeText(text: string): void {
    this.element.setAttribute("aria-valuetext", text);
    this.valueText.textContent = text;
  }

  private drawPreview(): void {
    const length = this.current + (this.target - this.current) * easeOutCubic(this.progress);
    this.preview.style.transform = `scaleX(${Math.max(length, this.current)})`;
  }

  private cancel(): void {
    this.stop?.();
    this.stop = null;
  }

  // Extends the bar to the preview value; ending the preview retracts back through the same lengths.
  showPreview(current: CarStats, next: CarStats, units: Units): void {
    if (this.spec.value(current) === this.spec.value(next)) return;
    this.target = this.spec.value(next) / this.spec.max;
    this.writeText(`${this.spec.text(current, units)} → ${this.spec.text(next, units)}`);
    this.animate(1);
  }

  endPreview(current: CarStats, units: Units): void {
    if (this.aim === 0 && this.progress === 0) return;
    this.writeText(this.spec.text(current, units));
    this.animate(0);
  }

  private animate(aim: number): void {
    this.aim = aim;
    this.cancel();
    if (prefersReducedMotion()) {
      this.progress = aim;
      this.drawPreview();
      return;
    }
    let last = performance.now();
    this.stop = frames((now) => {
      const step = (now - last) / PREVIEW_MS;
      last = now;
      this.progress = aim > this.progress ? Math.min(aim, this.progress + step) : Math.max(aim, this.progress - step);
      this.drawPreview();
      return this.progress !== aim;
    });
  }
}

export function summary(reference: Reference): string {
  if (reference.deltaMs === 0) return NO_CHANGE;
  const deltas = reference.sectorDeltasMs;
  let worst = 0;
  deltas.forEach((delta, i) => { if (Math.abs(delta) > Math.abs(deltas[worst])) worst = i; });
  return `${fmtDelta(reference.deltaMs)}, mostly S${worst + 1}`;
}

// The Reference lap figure: track outline coloured by sector, the marker, sector chips,
// predicted lap with the old time struck through, cost and summary.
export class ReferenceFigure {
  readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly sectors: SVGPathElement[] = [];
  private readonly marker: SVGCircleElement;
  private readonly chips: HTMLElement[];
  private readonly predictedNew: HTMLElement;
  private readonly predictedOld: HTMLElement;
  private readonly cost: HTMLElement;
  private readonly summaryText: HTMLElement;
  private layoutId: LayoutId = "saltflat-ring";

  constructor() {
    this.svg = s("svg", { "aria-hidden": "false", focusable: "false" });
    this.marker = s("circle", { r: 14, class: "ref-marker", role: "img", "aria-label": "Reference marker" });
    this.chips = [1, 2, 3].map((n) => h("span", { class: "chip" }, `S${n}`));
    this.predictedNew = h("span", { class: "predicted-new" });
    this.predictedOld = h("span");
    this.cost = h("p", { class: "mono loss" });
    this.summaryText = h("p", { class: "ref-summary mono" });
    this.element = h("figure", { class: "reference", "aria-label": "Reference lap" },
      this.svg,
      h("figcaption", null,
        h("div", { class: "chips" }, ...this.chips),
        h("p", { class: "predicted" }, "Predicted lap ", this.predictedNew, " ", this.predictedOld),
        this.cost, this.summaryText));
  }

  private drawTrack(layoutId: LayoutId): void {
    this.layoutId = layoutId;
    const path = trackPath(layoutId);
    const ends = [0, ...LAYOUTS[layoutId].sectorEnds];
    this.sectors.length = 0;
    this.svg.setAttribute("viewBox", viewBox(path, 30));
    this.svg.replaceChildren(s("path", { class: "ref-base", d: pathData(path) }));
    for (let i = 0; i < 3; i += 1) {
      const sector = s("path", { class: "ref-sector", d: pathData(path, ends[i], ends[i + 1]) });
      this.sectors.push(sector);
      this.svg.append(sector);
    }
    this.svg.append(this.marker);
    this.placeMarker(0);
  }

  placeMarker(distance: number): void {
    const point = pointAt(trackPath(this.layoutId), distance);
    this.marker.setAttribute("cx", point.x.toFixed(1));
    this.marker.setAttribute("cy", (-point.y).toFixed(1));
  }

  // The figure with no purchase result yet: the predicted lap of the current setup.
  showBaseline(layoutId: LayoutId, lapMs: number): void {
    this.drawTrack(layoutId);
    this.chips.forEach((chip, i) => { chip.textContent = `S${i + 1}`; chip.className = "chip"; });
    this.predictedNew.textContent = fmtTime(lapMs);
    this.predictedOld.replaceChildren();
    this.cost.textContent = "";
    this.summaryText.textContent = "";
  }

  // The committed result, at once and with no animation.
  showCommitted(reference: Reference): void {
    this.drawTrack(reference.layoutId);
    this.sectors.forEach((sector, i) => this.colourSector(sector, reference.sectorDeltasMs[i], 1));
    this.chips.forEach((_, i) => this.flipChip(i, reference));
    this.setPredicted(reference.newLapMs, reference.oldLapMs);
    this.cost.textContent = `Cost ${MINUS}${fmtCoins(reference.price)} coins`;
    this.showSummary(reference);
  }

  // Sweep start: the outline in ink, plain chips and the old predicted lap.
  prepareSweep(reference: Reference): void {
    this.drawTrack(reference.layoutId);
    this.sectors.forEach((sector) => this.colourSector(sector, 0, 0));
    this.chips.forEach((chip, i) => { chip.textContent = `S${i + 1}`; chip.className = "chip"; chip.style.transform = ""; });
    this.setPredicted(reference.oldLapMs, null);
    this.cost.textContent = `Cost ${MINUS}${fmtCoins(reference.price)} coins`;
    this.summaryText.textContent = "";
  }

  colourSector(sector: SVGPathElement, delta: number, revealed: number): void {
    sector.setAttribute("class", `ref-sector ${revealed > 0 ? deltaClass(delta) : ""}`);
    if (revealed >= 1 || revealed <= 0) {
      sector.style.strokeDasharray = "";
      sector.style.strokeDashoffset = "";
      sector.style.visibility = revealed <= 0 ? "hidden" : "visible";
      return;
    }
    const length = sector.getTotalLength();
    sector.style.visibility = "visible";
    sector.style.strokeDasharray = `${length}`;
    sector.style.strokeDashoffset = `${length * (1 - revealed)}`;
  }

  revealTo(distance: number, reference: Reference): void {
    const ends = [0, ...LAYOUTS[reference.layoutId].sectorEnds];
    this.sectors.forEach((sector, i) => {
      const share = (distance - ends[i]) / (ends[i + 1] - ends[i]);
      this.colourSector(sector, reference.sectorDeltasMs[i], Math.min(1, Math.max(0, share)));
    });
    this.placeMarker(distance);
  }

  flipChip(index: number, reference: Reference, turn = 0): void {
    const chip = this.chips[index];
    const delta = reference.sectorDeltasMs[index];
    chip.textContent = `S${index + 1} ${fmtDelta(delta)}`;
    chip.className = `chip ${deltaClass(delta)}`;
    chip.style.transform = turn > 0 && turn < 1 ? `perspective(200px) rotateX(${(1 - turn) * 90}deg)` : "";
  }

  setPredicted(lapMs: number, struck: number | null): void {
    this.predictedNew.textContent = fmtTime(lapMs);
    this.predictedOld.replaceChildren(...(struck === null ? [] : [h("del", null, fmtTime(struck))]));
  }

  showSummary(reference: Reference): void {
    this.summaryText.className = `ref-summary mono ${deltaClass(reference.deltaMs)}`;
    this.summaryText.textContent = summary(reference);
  }
}

const SWEEP = { markerMs: 1200, flipMs: 250, countStart: 1450, countMs: 250, pipsAt: 1700, announceAt: 1950 } as const;

// The Reference lap sweep, in its published order. `finish` jumps to the end state; after the
// sweep ends nothing of it touches the page again.
export class Sweep {
  private stop: (() => void) | null = null;
  private started = 0;
  private flipped = 0;
  private balanceStepped = false;
  private pipsFilled = false;
  private ended = false;
  private readonly flipTimes: number[] = [];

  constructor(private readonly effects: {
    readonly figure: ReferenceFigure;
    readonly reference: Reference;
    readonly fromBalance: number;
    readonly toBalance: number;
    readonly showBalance: (value: number) => void;
    readonly balanceDone: () => void;
    readonly fillPips: () => void;
    readonly announce: () => void;
  }) {}

  get running(): boolean {
    return !this.ended;
  }

  start(reduced: boolean): void {
    if (reduced) {
      this.finish();
      return;
    }
    this.effects.figure.prepareSweep(this.effects.reference);
    this.started = performance.now();
    this.stop = frames((now) => this.tick(now - this.started));
  }

  private tick(t: number): boolean {
    const { figure, reference } = this.effects;
    const length = LAYOUTS[reference.layoutId].length;
    const along = easeOutCubic(Math.min(1, t / SWEEP.markerMs));
    figure.revealTo(along * length, reference);
    while (this.flipped < 3 && along >= (this.flipped + 1) / 3 - 1e-9) {
      this.flipped += 1;
      this.flipTimes.push(t);
    }
    this.flipTimes.forEach((at, i) => figure.flipChip(i, reference, Math.min(1, (t - at) / SWEEP.flipMs)));
    if (t >= SWEEP.countStart && !this.balanceStepped) {
      const k = easeOutCubic(Math.min(1, (t - SWEEP.countStart) / SWEEP.countMs));
      const lap = Math.round(reference.oldLapMs + (reference.newLapMs - reference.oldLapMs) * k);
      figure.setPredicted(lap, k >= 1 ? reference.oldLapMs : null);
      const { fromBalance, toBalance } = this.effects;
      this.effects.showBalance(Math.round(fromBalance + (toBalance - fromBalance) * k));
      if (k >= 1) this.stepBalance();
    }
    if (t >= SWEEP.pipsAt && !this.pipsFilled) {
      this.pipsFilled = true;
      this.effects.fillPips();
    }
    if (t >= SWEEP.announceAt) {
      this.finish();
      return false;
    }
    return true;
  }

  private stepBalance(): void {
    this.balanceStepped = true;
    this.effects.balanceDone();
  }

  finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.stop?.();
    const { figure, reference } = this.effects;
    figure.showCommitted(reference);
    if (!this.balanceStepped) this.stepBalance();
    if (!this.pipsFilled) {
      this.pipsFilled = true;
      this.effects.fillPips();
    }
    figure.showSummary(reference);
    this.effects.announce();
  }
}
