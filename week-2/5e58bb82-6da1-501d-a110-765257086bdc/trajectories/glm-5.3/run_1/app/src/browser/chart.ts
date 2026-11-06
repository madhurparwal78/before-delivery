/* Procedural survey chart drawn on a canvas from mission data. */
import { Position, Mission, Line, Holiday, Vessel, Units } from './app.js';

export interface ChartData {
  mission: Mission;
  lines: Line[];
  holidays: Holiday[];
  coverage?: { origin: Position; cols: number; rows: number; overlap: number[][] } | null;
  tracks?: Record<string, { t: string; easting: number; northing: number; depth_m: number; swath_m: number }[]>;
  vessels: Vessel[];
  clientMode: boolean;
  replayPositions?: Record<string, Position | null>;
}

export interface ChartView {
  cx: number; // centre easting
  cy: number; // centre northing
  scale: number; // px per metre
}

export class Chart {
  canvas: HTMLCanvasElement;
  data: ChartData | null = null;
  view: ChartView = { cx: 0, cy: 0, scale: 1 };
  units: Units = 'metric';
  lensPos: Position | null = null;
  lensTarget: Position | null = null;
  lensOpen = false;
  onLensChange: (() => void) | null = null;
  onQueueInfill: ((holidayId: string) => void) | null = null;
  keyboardMode = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Coverage chart');
  }

  setData(data: ChartData): void {
    this.data = data;
    if (this.view.cx === 0 && this.view.cy === 0 && this.view.scale === 1) {
      this.fit(data.mission.survey_area);
    }
  }

  fit(area: Position[]): void {
    const xs = area.map(p => p.easting);
    const ys = area.map(p => p.northing);
    const w = Math.max(...xs) - Math.min(...xs);
    const hgt = Math.max(...ys) - Math.min(...ys);
    this.view.cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    this.view.cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const cw = this.canvas.clientWidth || 600;
    const ch = this.canvas.clientHeight || 400;
    this.view.scale = Math.max(0.05, Math.min(cw / Math.max(10, w * 1.3), ch / Math.max(10, hgt * 1.3)));
    this.draw();
  }

  zoom(factor: number): void {
    this.view.scale = Math.max(0.05, Math.min(50, this.view.scale * factor));
    this.draw();
  }

  pan(dx: number, dy: number): void {
    this.view.cx += dx / this.view.scale;
    this.view.cy -= dy / this.view.scale;
    this.draw();
  }

  toScreen(p: Position): { x: number; y: number } {
    const cw = this.canvas.clientWidth || 600;
    const ch = this.canvas.clientHeight || 400;
    return {
      x: cw / 2 + (p.easting - this.view.cx) * this.view.scale,
      y: ch / 2 - (p.northing - this.view.cy) * this.view.scale,
    };
  }

  toGround(x: number, y: number): Position {
    const cw = this.canvas.clientWidth || 600;
    const ch = this.canvas.clientHeight || 400;
    return {
      easting: this.view.cx + (x - cw / 2) / this.view.scale,
      northing: this.view.cy - (y - ch / 2) / this.view.scale,
    };
  }

  // ---------- lens ----------

  openLens(at: Position | null): void {
    this.lensOpen = true;
    if (at) {
      this.lensTarget = at;
      this.lensPos = prefersReduced() ? at : this.lensPos ?? at;
    }
    this.onLensChange?.();
    this.draw();
  }

  moveLensBy(metres: number, dx: number, dy: number): void {
    if (!this.lensPos) this.lensPos = { easting: this.view.cx, northing: this.view.cy };
    this.lensPos = { easting: this.lensPos.easting + dx * metres, northing: this.lensPos.northing + dy * metres };
    this.lensTarget = { ...this.lensPos };
    this.ensureLensVisible();
    this.onLensChange?.();
    this.draw();
  }

  setLensTarget(p: Position, trail: boolean): void {
    this.lensTarget = p;
    if (!trail || prefersReduced()) this.lensPos = { ...p };
    else if (!this.lensPos) this.lensPos = { ...p };
    this.ensureLensVisible();
    this.onLensChange?.();
    this.draw();
  }

  closeLens(): void {
    this.lensOpen = false;
    this.onLensChange?.();
    this.draw();
  }

  private ensureLensVisible(): void {
    if (!this.lensPos) return;
    const cw = this.canvas.clientWidth || 600;
    const ch = this.canvas.clientHeight || 400;
    const s = this.toScreen(this.lensPos);
    const margin = 84;
    if (s.x < margin) this.view.cx -= (margin - s.x) / this.view.scale;
    if (s.x > cw - margin) this.view.cx += (s.x - (cw - margin)) / this.view.scale;
    if (s.y < margin) this.view.cy += (margin - s.y) / this.view.scale;
    if (s.y > ch - margin) this.view.cy -= (s.y - (ch - margin)) / this.view.scale;
  }

  holidayAt(p: Position): Holiday | null {
    if (!this.data) return null;
    for (const h of this.data.holidays) {
      if (h.status === 'Closed') continue;
      for (const cr of h.cells) {
        const [c, r] = cr as [number, number];
        // cell bounds from coverage grid
        if (this.data.coverage) {
          const { origin } = this.data.coverage;
          const x0 = origin.easting + c * 5;
          const x1 = x0 + 5;
          const y0 = origin.northing + r * 5;
          const y1 = y0 + 5;
          if (p.easting >= x0 && p.easting <= x1 && p.northing >= y0 && p.northing <= y1) return h;
        }
      }
    }
    return null;
  }

  lensHolidays(): Holiday[] {
    if (!this.lensPos || !this.data || !this.data.coverage) return [];
    const out: Holiday[] = [];
    const radius = 84 / this.view.scale;
    for (const h of this.data.holidays) {
      if (h.status === 'Closed') continue;
      const d = Math.hypot(h.centroid.easting - this.lensPos.easting, h.centroid.northing - this.lensPos.northing);
      if (d <= radius + Math.sqrt(h.area_m2) / 2) out.push(h);
    }
    return out;
  }

  // ---------- drawing ----------

  draw(): void {
    const d = this.data;
    const ctx = this.canvas.getContext('2d');
    if (!ctx || !d) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth || 600;
    const ch = this.canvas.clientHeight || 400;
    if (this.canvas.width !== cw * dpr || this.canvas.height !== ch * dpr) {
      this.canvas.width = cw * dpr;
      this.canvas.height = ch * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // paper
    ctx.fillStyle = '#faf8f2';
    ctx.fillRect(0, 0, cw, ch);

    const m = d.mission;
    // grid every 50 m
    const scale = this.view.scale;
    const gridStep = 50;
    const startX = this.view.cx - cw / 2 / scale;
    const endX = this.view.cx + cw / 2 / scale;
    const startY = this.view.cy - ch / 2 / scale;
    const endY = this.view.cy + ch / 2 / scale;
    ctx.strokeStyle = 'rgba(60,60,50,0.14)';
    ctx.lineWidth = 1;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(30,30,25,0.55)';
    const stepPx = gridStep * scale;
    if (stepPx > 18) {
      for (let x = Math.floor(startX / gridStep) * gridStep; x <= endX; x += gridStep) {
        const sx = this.toScreen({ easting: x, northing: 0 }).x;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, ch);
        ctx.stroke();
        ctx.fillText(String(x), sx + 2, ch - 4);
      }
      for (let y = Math.floor(startY / gridStep) * gridStep; y <= endY; y += gridStep) {
        const sy = this.toScreen({ easting: 0, northing: y }).y;
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(cw, sy);
        ctx.stroke();
        ctx.fillText(String(y), 2, sy - 3);
      }
    }

    const drawPoly = (pts: Position[], stroke: string, dash: number[], fill: string | null): void => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.setLineDash(dash);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    drawPoly(m.survey_area, 'rgba(28,28,24,0.9)', [], 'rgba(120,150,170,0.06)');
    drawPoly(m.geofence, 'rgba(28,28,24,0.75)', [6, 4], null);

    // swaths: depth-tinted rectangles along sweeping pairs of each line's track
    if (d.tracks) {
      for (const line of d.lines) {
        const pts = d.tracks[line.id];
        if (!pts || pts.length < 2) continue;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          const half = b.swath_m / 2;
          const len = Math.hypot(b.easting - a.easting, b.northing - a.northing);
          if (len <= 0) continue;
          const ux = (b.easting - a.easting) / len;
          const uy = (b.northing - a.northing) / len;
          const corners = [
            { easting: a.easting - uy * half, northing: a.northing + ux * half },
            { easting: b.easting - uy * half, northing: b.northing + ux * half },
            { easting: b.easting + uy * half, northing: b.northing - ux * half },
            { easting: a.easting + uy * half, northing: a.northing - ux * half },
          ];
          ctx.beginPath();
          corners.forEach((p, idx) => {
            const s = this.toScreen(p);
            if (idx === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
          });
          ctx.closePath();
          // tint by depth: shallow lighter, deep darker blue
          const t = Math.max(0, Math.min(1, b.depth_m / 30));
          ctx.fillStyle = `rgba(38, 82, ${Math.round(150 - t * 60)}, ${0.20 + t * 0.28})`;
          ctx.fill();
        }
      }
    }

    // holidays: orange outlines; hatched inside the lens
    for (const h of d.holidays) {
      if (h.status === 'Closed') continue;
      for (const cr of h.cells) {
        const [c, r] = cr as [number, number];
        if (!d.coverage) break;
        const { origin } = d.coverage;
        const x0 = origin.easting + c * 5;
        const y0 = origin.northing + r * 5;
        const p0 = this.toScreen({ easting: x0, northing: y0 });
        const p1 = this.toScreen({ easting: x0 + 5, northing: y0 + 5 });
        const w = p1.x - p0.x;
        const hh = p0.y - p1.y;
        ctx.strokeStyle = 'rgba(204, 86, 20, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p0.x, p1.y, w, hh);
        if (this.lensOpen && this.lensPos) {
          const centre = { easting: x0 + 2.5, northing: y0 + 2.5 };
          const dist = Math.hypot(centre.easting - this.lensPos.easting, centre.northing - this.lensPos.northing) * scale;
          if (dist <= 84) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(p0.x, p1.y, w, hh);
            ctx.clip();
            ctx.strokeStyle = 'rgba(204, 86, 20, 0.95)';
            ctx.lineWidth = 2;
            for (let o = -hh; o < w + hh; o += 6) {
              ctx.beginPath();
              ctx.moveTo(p0.x + o, p1.y + hh);
              ctx.lineTo(p0.x + o + hh, p1.y);
              ctx.stroke();
            }
            ctx.restore();
            ctx.fillStyle = 'rgba(30,30,25,0.95)';
            ctx.font = '10px "IBM Plex Mono", monospace';
            ctx.fillText(`${Math.round(h.area_m2)} m²`, p0.x + 2, p1.y + 11);
          }
        }
      }
    }

    // lines
    for (const line of d.lines) {
      const a = this.toScreen(line.start);
      const b = this.toScreen(line.end);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (line.kind === 'infill') {
        ctx.setLineDash([7, 5]);
        ctx.strokeStyle = 'rgba(28,28,24,0.9)';
      } else {
        ctx.setLineDash([]);
        ctx.strokeStyle = '#1f4f7a';
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.kind === 'crossline') {
        // small perpendicular ticks
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        const px = -uy, py = ux;
        const tick = 4;
        const steps = Math.max(1, Math.floor(len / 24));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const cx2 = a.x + (b.x - a.x) * t;
          const cy2 = a.y + (b.y - a.y) * t;
          ctx.beginPath();
          ctx.moveTo(cx2 - px * tick, cy2 - py * tick);
          ctx.lineTo(cx2 + px * tick, cy2 + py * tick);
          ctx.strokeStyle = '#1f4f7a';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // vessel markers: ink chevrons at the track's last point
    for (const v of d.vessels) {
      let pos: Position | null = null;
      let heading = 0;
      let label = v.name;
      if (d.replayPositions && v.id in d.replayPositions) {
        pos = d.replayPositions[v.id] ?? null;
        label = 'Replay';
      }
      if (!pos && v.last_fix) {
        pos = v.last_fix.position;
        heading = v.last_fix.heading_deg;
      }
      if (!pos && d.tracks) {
        // last point of this vessel's track on this mission
        outer: for (const line of d.lines) {
          if (line.vessel_id !== v.id) continue;
          const pts = d.tracks[line.id];
          if (pts && pts.length) { pos = { easting: pts[pts.length - 1]!.easting, northing: pts[pts.length - 1]!.northing }; break outer; }
        }
      }
      if (!pos) continue;
      const s = this.toScreen(pos);
      const rad = -heading * Math.PI / 180;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fillStyle = '#1c1c18';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#1c1c18';
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(label, s.x + 8, s.y - 6);
    }

    // lens
    if (this.lensOpen && this.lensPos) {
      const s = this.toScreen(this.lensPos);
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 84, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(28,28,24,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    this.tickLensTrail();
  }

  tickLensTrail(): void {
    if (!prefersReduced() && this.lensOpen && this.lensTarget && this.lensPos) {
      const dx = this.lensTarget.easting - this.lensPos.easting;
      const dy = this.lensTarget.northing - this.lensPos.northing;
      const dist = Math.hypot(dx, dy);
      if (dist * this.view.scale > 0.5) {
        const t = 0.18;
        this.lensPos = { easting: this.lensPos.easting + dx * t, northing: this.lensPos.northing + dy * t };
        this.draw();
      } else if (this.lensPos !== this.lensTarget) {
        this.lensPos = { ...this.lensTarget };
        this.draw();
      }
      requestAnimationFrame(() => this.tickLensTrail());
    }
  }

  bindTouch(region: HTMLElement): void {
    let last: { x: number; y: number } | null = null;
    let pinch: number | null = null;
    region.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) {
        last = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      } else if (e.touches.length === 2) {
        pinch = Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
      }
    }, { passive: true });
    region.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length === 1 && last) {
        const dx = e.touches[0]!.clientX - last.x;
        const dy = e.touches[0]!.clientY - last.y;
        this.pan(-dx, -dy);
        last = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        e.preventDefault();
      } else if (e.touches.length === 2 && pinch) {
        const d = Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
        this.zoom(d / pinch);
        pinch = d;
        e.preventDefault();
      }
    }, { passive: false });
    region.addEventListener('touchend', (e: TouchEvent) => {
      if (e.changedTouches.length === 1 && last) {
        const rect = this.canvas.getBoundingClientRect();
        const p = this.toGround(e.changedTouches[0]!.clientX - rect.left, e.changedTouches[0]!.clientY - rect.top);
        this.setLensTarget(p, false);
        this.openLens(p);
        this.onLensChange?.();
        this.draw();
      }
      last = null;
      pinch = null;
    });
  }
}

function prefersReduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
