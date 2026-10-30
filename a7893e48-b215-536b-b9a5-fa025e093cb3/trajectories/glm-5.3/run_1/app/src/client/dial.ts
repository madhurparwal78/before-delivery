import { DayData, DayStation, DaySegment } from "./api.js";
import { hours } from "./api.js";

export interface DialCallbacks {
  onPlaceHold: (stationId: string, startTick: number, endTick: number) => void;
  onStatus: (msg: string) => void;
  onFocusStation: (stationId: string) => void;
}

const TAU = Math.PI * 2;
const cx = 210;
const cy = 210;

interface RingLayout {
  station: DayStation;
  r: number;      // center radius of the ring band
  width: number;  // band width
}

export class Dial {
  el: SVGSVGElement;
  group: SVGGElement;
  data: DayData | null = null;
  rings: RingLayout[] = [];
  tickCount = 96; // quarter-hour slots in the day
  dayMinutes = 1440;
  selection: { stationIndex: number; startTick: number; endTick: number } | null = null;
  selectedStation = 0;
  drag: { ring: number; moved: boolean } | null = null;
  reducedMotion = false;
  callbacks: DialCallbacks;

  constructor(callbacks: DialCallbacks) {
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.el.setAttribute("viewBox", "0 0 420 420");
    this.el.setAttribute("role", "group");
    this.el.setAttribute("aria-label", "Station dial");
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `
      <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#5b6770"/>
        <line x1="0" y1="0" x2="0" y2="6" stroke="#8b97a0" stroke-width="3"/>
      </pattern>`;
    this.el.appendChild(defs);
    this.group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.el.appendChild(this.group);
    this.bindPointer();
    this.bindKeys();
  }

  setData(data: DayData, selectedStation: number): void {
    this.data = data;
    this.selectedStation = selectedStation;
    this.tickCount = data.ticks.length * 4;
    this.dayMinutes = data.hours * 60;
    const n = data.stations.length;
    const outer = 178;
    const width = Math.min(22, (outer - 92) / Math.max(n, 1));
    this.rings = data.stations.map((s, i) => ({ station: s, r: outer - i * width, width }));
    this.selection = null;
    this.drag = null;
    this.render();
  }

  private tickToAngle(tick: number): number {
    return (tick / this.tickCount) * TAU - Math.PI / 2;
  }

  private pointAt(r: number, tick: number): [number, number] {
    const a = this.tickToAngle(tick);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  private arcPath(r: number, startTick: number, endTick: number): string {
    const [x1, y1] = this.pointAt(r, startTick);
    const [x2, y2] = this.pointAt(r, endTick);
    const sweep = endTick - startTick >= this.tickCount ? 1 : 0;
    const large = endTick - startTick > this.tickCount / 2 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  }

  /** The nearest quarter tick for a pointer event, in day ticks. */
  private nearestTick(ev: PointerEvent): { ring: number; tick: number } | null {
    const rect = this.el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 420 - cx;
    const y = ((ev.clientY - rect.top) / rect.height) * 420 - cy;
    const dist = Math.sqrt(x * x + y * y);
    let ring = -1;
    let best = 1e9;
    this.rings.forEach((r, i) => {
      const d = Math.abs(dist - r.r);
      if (d < r.width / 2 + 6 && d < best) { best = d; ring = i; }
    });
    if (ring === -1) return null;
    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += TAU;
    const tick = Math.round((angle / TAU) * this.tickCount) % this.tickCount;
    return { ring, tick };
  }

  private segmentsFor(ring: number): DaySegment[] {
    return this.rings[ring]?.station.segments ?? [];
  }

  /** Does a quarter range [a,b) collide with a segment? Returns its label. */
  private collide(ring: number, a: number, b: number): DaySegment | null {
    const dayStart = this.data ? Date.parse(this.data.ticks[0].at) : 0;
    const minMs = 60000 * this.dayMinutes / this.tickCount;
    const sa = dayStart + a * minMs;
    const sb = dayStart + b * minMs;
    for (const seg of this.segmentsFor(ring)) {
      const ss = Date.parse(seg.start_at);
      const se = Date.parse(seg.end_at);
      if (sa < se && ss < sb) return seg;
    }
    return null;
  }

  private bindPointer(): void {
    this.el.addEventListener("pointerdown", (ev) => {
      const hit = this.nearestTick(ev as PointerEvent);
      if (!hit || !this.data) return;
      ev.preventDefault();
      const seg = this.collide(hit.ring, hit.tick, hit.tick + 1);
      if (seg) {
        this.callbacks.onStatus(seg.label);
        return;
      }
      this.selection = { stationIndex: hit.ring, startTick: hit.tick, endTick: hit.tick + 1 };
      this.drag = { ring: hit.ring, moved: false };
      this.selectedStation = hit.ring;
      this.callbacks.onFocusStation(this.rings[hit.ring].station.id);
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      this.render();
    });
    this.el.addEventListener("pointermove", (ev) => {
      if (!this.drag || !this.selection) return;
      const hit = this.nearestTick(ev as PointerEvent);
      if (!hit || hit.ring !== this.drag.ring) return;
      ev.preventDefault();
      const sel = this.selection;
      let end = hit.tick;
      let start = sel.startTick;
      if (end === sel.startTick) return;
      if (end > sel.startTick) {
        // clockwise: extend end
        const maxEnd = Math.min(sel.startTick + 48, this.tickCount); // 12 h cap
        end = Math.min(end, maxEnd);
        if (end <= sel.startTick) return;
        const blocker = this.collide(sel.stationIndex, sel.startTick, end);
        if (blocker) {
          // stop at the boundary with a short spring-back
          const dayStart = Date.parse(this.data!.ticks[0].at);
          const minMs = 60000 * this.dayMinutes / this.tickCount;
          const bStart = Date.parse(blocker.start_at);
          end = Math.max(sel.startTick + 1, Math.round((bStart - dayStart) / minMs));
          this.callbacks.onStatus(`Stopped at ${blocker.label}`);
          this.springBack();
        }
        sel.endTick = end;
      } else {
        // anticlockwise: move start earlier
        const minStart = Math.max(sel.endTick - 48, 0);
        start = Math.max(end, minStart);
        if (start >= sel.endTick) return;
        const blocker = this.collide(sel.stationIndex, start, sel.endTick);
        if (blocker) {
          const dayStart = Date.parse(this.data!.ticks[0].at);
          const minMs = 60000 * this.dayMinutes / this.tickCount;
          const bEnd = Date.parse(blocker.end_at);
          start = Math.min(sel.endTick - 1, Math.round((bEnd - dayStart) / minMs));
          this.callbacks.onStatus(`Stopped at ${blocker.label}`);
          this.springBack();
        }
        sel.startTick = start;
      }
      this.drag.moved = true;
      this.render();
    });
    const finish = () => {
      if (!this.drag || !this.selection) return;
      const sel = this.selection;
      const moved = this.drag.moved;
      this.drag = null;
      if (!moved) {
        this.selection = null;
        this.render();
        return;
      }
      this.callbacks.onPlaceHold(this.rings[sel.stationIndex].station.id, sel.startTick, sel.endTick);
    };
    this.el.addEventListener("pointerup", finish);
    this.el.addEventListener("pointercancel", () => {
      this.drag = null;
      this.selection = null;
      this.render();
    });
  }

  private bindKeys(): void {
    this.el.addEventListener("keydown", (ev) => {
      const target = ev.target as HTMLElement;
      if (target.getAttribute("data-ring") === null) return;
      const ring = Number(target.getAttribute("data-ring"));
      const step = (dir: number, shift: boolean) => {
        ev.preventDefault();
        if (!this.selection) {
          this.selection = { stationIndex: ring, startTick: 0, endTick: 1 };
        }
        const sel = this.selection!;
        if (sel.stationIndex !== ring) {
          this.selection = { stationIndex: ring, startTick: 0, endTick: 1 };
        }
        const s = this.selection!;
        if (shift) {
          s.endTick = Math.max(s.startTick + 1, Math.min(this.tickCount, s.endTick + dir));
        } else {
          const len = s.endTick - s.startTick;
          s.startTick = Math.max(0, Math.min(this.tickCount - len, s.startTick + dir));
          s.endTick = s.startTick + len;
        }
        this.announceSelection();
        this.render();
      };
      switch (ev.key) {
        case "ArrowRight": case "ArrowUp": step(1, ev.shiftKey); break;
        case "ArrowLeft": case "ArrowDown": step(-1, ev.shiftKey); break;
        case "Enter":
          ev.preventDefault();
          if (this.selection) {
            this.callbacks.onPlaceHold(this.rings[this.selection.stationIndex].station.id, this.selection.startTick, this.selection.endTick);
          }
          break;
        case "Escape":
          ev.preventDefault();
          this.selection = null;
          this.callbacks.onStatus("Selection cleared.");
          this.render();
          break;
      }
    });
  }

  announceSelection(): void {
    if (!this.selection || !this.data) return;
    const sel = this.selection;
    const s = this.timeAt(sel.startTick);
    const e = this.timeAt(sel.endTick);
    const mins = (sel.endTick - sel.startTick) * (this.dayMinutes / this.tickCount);
    this.callbacks.onStatus(`Selection ${s}–${e}, ${hours(mins)} h.`);
  }

  timeAt(tick: number): string {
    if (!this.data) return "";
    const idx = Math.floor(tick / 4) % this.data.ticks.length;
    const hour = this.data.ticks[idx].label;
    const quarter = (tick % 4) * 15;
    return `${hour.slice(0, 3)}${String(quarter).padStart(2, "0")}`;
  }

  clearSelection(): void {
    this.selection = null;
    this.render();
  }

  render(): void {
    if (!this.data) return;
    const g = this.group;
    g.innerHTML = "";
    const data = this.data;

    // Hour ticks around the rim + numerals.
    data.ticks.forEach((tick, i) => {
      const a = (i / data.ticks.length) * TAU - Math.PI / 2;
      const r1 = 186;
      const r2 = 194;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const [x1, y1] = [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)];
      const [x2, y2] = [cx + r2 * Math.cos(a), cy + r2 * Math.sin(a)];
      line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", "var(--ink)");
      line.setAttribute("stroke-width", "2");
      g.appendChild(line);
      // repeated hour label with zone
      const isRepeat = i > 0 && tick.label === data.ticks[i - 1].label;
      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const rt = 203;
      const [tx, ty] = [cx + rt * Math.cos(a), cy + rt * Math.sin(a)];
      txt.setAttribute("x", String(tx));
      txt.setAttribute("y", String(ty + 3));
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("class", `dial-tick${i % 6 === 0 ? " major" : ""}`);
      txt.textContent = isRepeat ? `${tick.label} ${tick.zone}` : tick.label;
      g.appendChild(txt);
    });

    // Rings.
    this.rings.forEach((ring, idx) => {
      const gRing = document.createElementNS("http://www.w3.org/2000/svg", "g");
      gRing.setAttribute("class", "dial-ring");
      // base track
      const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
      track.setAttribute("d", this.arcPath(ring.r, 0, this.tickCount));
      track.setAttribute("fill", "none");
      track.setAttribute("stroke", "rgba(36,29,21,0.12)");
      track.setAttribute("stroke-width", String(ring.width - 3));
      gRing.appendChild(track);

      // segments
      for (const seg of ring.station.segments) {
        const dayStart = Date.parse(data.ticks[0].at);
        const minMs = 60000 * this.dayMinutes / this.tickCount;
        const sTick = (Date.parse(seg.start_at) - dayStart) / minMs;
        const eTick = (Date.parse(seg.end_at) - dayStart) / minMs;
        const st = Math.max(0, Math.round(sTick));
        const et = Math.min(this.tickCount, Math.round(eTick));
        if (et - st <= 0) continue;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", this.arcPath(ring.r, st, et));
        path.setAttribute("fill", "none");
        const accent = seg.state === "yours_booked" || seg.state === "yours_held";
        if (seg.state === "booked" || seg.state === "yours_booked") {
          path.setAttribute("stroke", accent ? "none" : "url(#hatch)");
          path.setAttribute("stroke-width", String(ring.width - 3));
          if (accent) path.setAttribute("stroke", "var(--accent)");
          path.setAttribute("stroke-linecap", "butt");
        } else {
          path.setAttribute("stroke", "var(--sand)");
          path.setAttribute("stroke-width", String(ring.width - 5));
          path.setAttribute("stroke-dasharray", "2 3");
          if (accent) path.setAttribute("stroke", "var(--accent)");
        }
        gRing.appendChild(path);
        // label on ring if wide enough, else callout
        const span = et - st;
        if (span >= 8) {
          const mid = (st + et) / 2;
          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          const [lx, ly] = this.pointAt(ring.r, mid);
          label.setAttribute("x", String(lx));
          label.setAttribute("y", String(ly + 3));
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("class", "dial-label");
          label.setAttribute("fill", accent ? "#fff" : "var(--ink)");
          label.textContent = seg.state.includes("hold") === false
            ? seg.state.startsWith("yours") ? seg.label.replace(/^Your (booking|hold) /, "Yours ") : seg.label.replace(/^[A-Za-z]+ /, "")
            : seg.label.replace(/^[A-Za-z]+ /, "");
          const angle = this.tickToAngle(mid);
          label.setAttribute("transform", `rotate(${(angle * 180) / Math.PI + 90} ${lx} ${ly})`);
          gRing.appendChild(label);
        }
      }

      // selection arc
      if (this.selection && this.selection.stationIndex === idx) {
        const sel = this.selection;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", this.arcPath(ring.r, sel.startTick, sel.endTick));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--accent)");
        path.setAttribute("stroke-width", String(ring.width - 3));
        path.setAttribute("stroke-linecap", "butt");
        if (!this.reducedMotion) path.setAttribute("opacity", "0.85");
        gRing.appendChild(path);
        // start and end markers
        for (const t of [sel.startTick, sel.endTick]) {
          const [mx, my] = this.pointAt(ring.r, t);
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", String(mx)); dot.setAttribute("cy", String(my));
          dot.setAttribute("r", "3");
          dot.setAttribute("fill", "var(--accent-ink)");
          gRing.appendChild(dot);
        }
      }

      // invisible hit area + keyboard slider
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", this.arcPath(ring.r, 0, this.tickCount));
      hit.setAttribute("class", "ring-hit");
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", String(ring.width + 8));
      hit.setAttribute("tabindex", "0");
      hit.setAttribute("data-ring", String(idx));
      const sel = this.selection && this.selection.stationIndex === idx ? this.selection : null;
      hit.setAttribute("role", "slider");
      hit.setAttribute("aria-label", ring.station.name);
      hit.setAttribute("aria-valuemin", "0");
      hit.setAttribute("aria-valuemax", String(this.tickCount));
      hit.setAttribute("aria-valuenow", sel ? String(sel.startTick) : "0");
      hit.setAttribute("aria-valuetext", sel
        ? `Selection ${this.timeAt(sel.startTick)}–${this.timeAt(sel.endTick)}, ${hours((sel.endTick - sel.startTick) * (this.dayMinutes / this.tickCount))} h`
        : "No selection");
      if (idx === this.selectedStation) hit.classList.add("focused-ring");
      gRing.appendChild(hit);
      g.appendChild(gRing);
    });

    // countdown ring on the outer rim while a hold is live
  }

  setCountdown(ratio: number): void {
    let ring = this.el.querySelector("#countdown-ring") as SVGPathElement | null;
    if (!ring) {
      ring = document.createElementNS("http://www.w3.org/2000/svg", "path");
      ring.id = "countdown-ring";
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "var(--accent)");
      ring.setAttribute("stroke-width", "5");
      this.el.appendChild(ring);
    }
    if (ratio <= 0) {
      ring.remove();
      return;
    }
    const r = 200;
    const circumference = TAU * r;
    ring.setAttribute("d", this.arcPath(r, 0, this.tickCount));
    ring.setAttribute("stroke-dasharray", `${circumference}`);
    ring.setAttribute("stroke-dashoffset", String(circumference * (1 - ratio)));
  }

  clearCountdown(): void {
    this.el.querySelector("#countdown-ring")?.remove();
  }

  /** Spring-back: a short overshoot then settle, or instant when reduced. */
  springBack(): void {
    if (this.reducedMotion) return;
    this.group.style.transition = "transform 0.1s ease";
    this.group.style.transform = "scale(1.012)";
    setTimeout(() => {
      this.group.style.transform = "";
    }, 100);
  }

  /** Retract the selection along its path after a refused claim. */
  retract(cb: () => void): void {
    if (this.reducedMotion || !this.selection) { this.selection = null; cb(); return; }
    const sel = this.selection;
    let step = 2;
    const timer = setInterval(() => {
      sel.endTick -= step;
      if (sel.endTick <= sel.startTick) {
        clearInterval(timer);
        this.selection = null;
        cb();
        return;
      }
      this.render();
    }, 40);
  }

  selectionSummary(): { minutes: number; cardCents: number; packMinutes: number; cardMinutes: number } | null {
    if (!this.selection || !this.data) return null;
    const perTick = this.dayMinutes / this.tickCount;
    const minutes = (this.selection.endTick - this.selection.startTick) * perTick;
    const station = this.rings[this.selection.stationIndex].station;
    const packAvail = this.data.pack_minutes_available ?? 0;
    const packMinutes = Math.min(packAvail, minutes);
    const cardMinutes = minutes - packMinutes;
    const cardCents = Math.round(cardMinutes * station.rate_cents / 60);
    return { minutes, cardCents, packMinutes, cardMinutes };
  }
}
