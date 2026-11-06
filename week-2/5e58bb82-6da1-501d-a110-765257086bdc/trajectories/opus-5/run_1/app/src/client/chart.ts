import { fixed } from '../shared/numbers.js';
import type {
  CoverageGrid,
  Holiday,
  Line,
  Mission,
  Position,
  Track,
  Units,
  Vessel,
} from '../shared/types.js';
import { areaText, lengthValue } from '../shared/units.js';

export const INK = '#15181c';
export const PAPER = '#faf7f0';
export const SEA_BLUE = '#10456e';
export const WARM_GREY = '#bfb6a8';
export const SIGNAL_ORANGE = '#c25208';

export const LENS_DIAMETER_PX = 168;
const GRID_SPACING_M = 50;
const CELL_M = 5;

export interface ChartData {
  mission: Mission;
  lines: Line[];
  tracks: Track[];
  holidays: Holiday[];
  coverage: CoverageGrid | null;
  vessels: { vessel: Vessel; label: string; replay?: boolean }[];
  /** Further survey areas and geofences, so the fleet board shows every open mission. */
  extraAreas?: Position[][];
  extraFences?: Position[][];
}

interface ViewState {
  centre: Position;
  scale: number;
}

/**
 * The chart is drawn in code from mission data: grid, survey area, geofence,
 * lines, depth-tinted swaths, holiday outlines and vessel chevrons. Nothing here
 * loads a picture.
 */
export class Chart {
  readonly canvas: HTMLCanvasElement;
  private view: ViewState = { centre: { easting: 0, northing: 0 }, scale: 1 };
  private data: ChartData | null = null;
  private units: Units = 'metric';
  /** The lens is tied to a ground position; only pointer, tap and arrow input moves it. */
  lensGround: Position | null = null;
  lensOpenProgress = 0;
  private lensDrawn: Position | null = null;
  private frame: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  setUnits(units: Units): void {
    this.units = units;
  }

  setData(data: ChartData): void {
    const first = this.data === null;
    this.data = data;
    if (first) this.fit();
    this.schedule();
  }

  /** Fits the survey area, leaving a margin. */
  fit(): void {
    if (!this.data) return;
    const points = [
      ...this.data.mission.survey_area,
      ...this.data.mission.geofence,
      ...(this.data.extraAreas ?? []).flat(),
      ...(this.data.extraFences ?? []).flat(),
    ];
    if (points.length === 0) return;
    const eastings = points.map((point) => point.easting);
    const northings = points.map((point) => point.northing);
    const width = Math.max(1, Math.max(...eastings) - Math.min(...eastings));
    const height = Math.max(1, Math.max(...northings) - Math.min(...northings));
    const box = this.size();
    this.view = {
      centre: {
        easting: (Math.max(...eastings) + Math.min(...eastings)) / 2,
        northing: (Math.max(...northings) + Math.min(...northings)) / 2,
      },
      scale: Math.min(box.width / (width * 1.1), box.height / (height * 1.1)),
    };
    this.schedule();
  }

  zoom(factor: number): void {
    this.view = { ...this.view, scale: Math.max(0.05, Math.min(40, this.view.scale * factor)) };
    this.schedule();
  }

  panByPixels(dx: number, dy: number): void {
    this.view = {
      ...this.view,
      centre: {
        easting: this.view.centre.easting - dx / this.view.scale,
        northing: this.view.centre.northing + dy / this.view.scale,
      },
    };
    this.schedule();
  }

  private size(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  }

  toScreen(point: Position): { x: number; y: number } {
    const box = this.size();
    return {
      x: box.width / 2 + (point.easting - this.view.centre.easting) * this.view.scale,
      y: box.height / 2 - (point.northing - this.view.centre.northing) * this.view.scale,
    };
  }

  toGround(x: number, y: number): Position {
    const box = this.size();
    return {
      easting: this.view.centre.easting + (x - box.width / 2) / this.view.scale,
      northing: this.view.centre.northing - (y - box.height / 2) / this.view.scale,
    };
  }

  /** Keeps the lens in view by scrolling the chart itself. */
  ensureLensVisible(): void {
    if (!this.lensGround) return;
    const box = this.size();
    const at = this.toScreen(this.lensGround);
    const margin = LENS_DIAMETER_PX / 2 + 8;
    let dx = 0;
    let dy = 0;
    if (at.x < margin) dx = at.x - margin;
    if (at.x > box.width - margin) dx = at.x - (box.width - margin);
    if (at.y < margin) dy = at.y - margin;
    if (at.y > box.height - margin) dy = at.y - (box.height - margin);
    if (dx !== 0 || dy !== 0) this.panByPixels(-dx, -dy);
  }

  schedule(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  /** Holidays whose cells fall inside the lens, biggest first. */
  holidaysInLens(): { holiday: Holiday; cellsInside: number }[] {
    if (!this.data || !this.lensGround || !this.data.coverage) return [];
    const radius = LENS_DIAMETER_PX / 2 / this.view.scale;
    const result: { holiday: Holiday; cellsInside: number }[] = [];
    for (const holiday of this.data.holidays) {
      if (holiday.status === 'Closed') continue;
      let inside = 0;
      for (const [col, row] of holiday.cells) {
        const centre = this.cellCentre(col, row);
        if (
          Math.hypot(centre.easting - this.lensGround.easting, centre.northing - this.lensGround.northing) <=
          radius
        ) {
          inside += 1;
        }
      }
      if (inside > 0) result.push({ holiday, cellsInside: inside });
    }
    return result.sort((a, b) => b.cellsInside - a.cellsInside);
  }

  /** The holiday under the lens centre, if any. */
  holidayUnderCentre(): Holiday | null {
    if (!this.data || !this.lensGround || !this.data.coverage) return null;
    const grid = this.data.coverage;
    const col = Math.floor((this.lensGround.easting - grid.origin.easting) / CELL_M);
    const row = Math.floor((this.lensGround.northing - grid.origin.northing) / CELL_M);
    for (const holiday of this.data.holidays) {
      if (holiday.status === 'Closed') continue;
      if (holiday.cells.some(([c, r]) => c === col && r === row)) return holiday;
    }
    return null;
  }

  cellCentre(col: number, row: number): Position {
    const origin = this.data?.coverage?.origin ?? { easting: 0, northing: 0 };
    return {
      easting: origin.easting + col * CELL_M + CELL_M / 2,
      northing: origin.northing + row * CELL_M + CELL_M / 2,
    };
  }

  draw(): void {
    const data = this.data;
    const context = this.canvas.getContext('2d');
    if (!context || !data) return;
    const box = this.size();
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== box.width * ratio || this.canvas.height !== box.height * ratio) {
      this.canvas.width = box.width * ratio;
      this.canvas.height = box.height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);
    context.fillStyle = PAPER;
    context.fillRect(0, 0, box.width, box.height);

    this.drawGrid(context, box);
    this.drawSwaths(context);
    this.drawPolygon(context, data.mission.survey_area, INK, 1.4, false);
    this.drawPolygon(context, data.mission.geofence, INK, 1.2, true);
    for (const area of data.extraAreas ?? []) this.drawPolygon(context, area, INK, 1.4, false);
    for (const fence of data.extraFences ?? []) this.drawPolygon(context, fence, INK, 1.2, true);
    this.drawHolidayOutlines(context);
    this.drawLines(context);
    this.drawLens(context);
    this.drawVessels(context);
  }

  private drawGrid(context: CanvasRenderingContext2D, box: { width: number; height: number }): void {
    const topLeft = this.toGround(0, 0);
    const bottomRight = this.toGround(box.width, box.height);
    context.strokeStyle = WARM_GREY;
    context.globalAlpha = 0.5;
    context.lineWidth = 0.5;
    context.font = '10px "IBM Plex Mono", monospace';
    context.fillStyle = INK;

    const firstEast = Math.floor(topLeft.easting / GRID_SPACING_M) * GRID_SPACING_M;
    for (let easting = firstEast; easting <= bottomRight.easting; easting += GRID_SPACING_M) {
      const at = this.toScreen({ easting, northing: topLeft.northing });
      context.beginPath();
      context.moveTo(at.x, 0);
      context.lineTo(at.x, box.height);
      context.stroke();
      context.globalAlpha = 1;
      context.fillText(String(Math.round(lengthValue(easting, this.units))), at.x + 2, box.height - 3);
      context.globalAlpha = 0.5;
    }
    const firstNorth = Math.floor(bottomRight.northing / GRID_SPACING_M) * GRID_SPACING_M;
    for (let northing = firstNorth; northing <= topLeft.northing; northing += GRID_SPACING_M) {
      const at = this.toScreen({ easting: topLeft.easting, northing });
      context.beginPath();
      context.moveTo(0, at.y);
      context.lineTo(box.width, at.y);
      context.stroke();
      context.globalAlpha = 1;
      context.fillText(String(Math.round(lengthValue(northing, this.units))), 3, at.y - 3);
      context.globalAlpha = 0.5;
    }
    context.globalAlpha = 1;
  }

  private drawPolygon(
    context: CanvasRenderingContext2D,
    polygon: Position[],
    colour: string,
    width: number,
    dashed: boolean,
  ): void {
    if (polygon.length < 2) return;
    context.save();
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.setLineDash(dashed ? [6, 4] : []);
    context.beginPath();
    polygon.forEach((point, index) => {
      const at = this.toScreen(point);
      if (index === 0) context.moveTo(at.x, at.y);
      else context.lineTo(at.x, at.y);
    });
    context.closePath();
    context.stroke();
    context.restore();
  }

  /** Swaths are filled with a blue tint, lighter where shallow and darker where deep. */
  private drawSwaths(context: CanvasRenderingContext2D): void {
    const data = this.data;
    if (!data) return;
    const ratio = data.mission.swath_ratio;
    context.save();
    for (const track of data.tracks) {
      for (let index = 1; index < track.points.length; index += 1) {
        const from = track.points[index - 1]!;
        const to = track.points[index]!;
        const halfWidth = (to.depth_m * ratio) / 2;
        const a = this.toScreen({ easting: from.easting, northing: from.northing });
        const b = this.toScreen({ easting: to.easting, northing: to.northing });
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length === 0) continue;
        const nx = (-(b.y - a.y) / length) * halfWidth * this.view.scale;
        const ny = ((b.x - a.x) / length) * halfWidth * this.view.scale;
        const deep = Math.min(1, to.depth_m / 60);
        context.fillStyle = `rgba(16, 69, 110, ${0.1 + deep * 0.35})`;
        context.beginPath();
        context.moveTo(a.x + nx, a.y + ny);
        context.lineTo(b.x + nx, b.y + ny);
        context.lineTo(b.x - nx, b.y - ny);
        context.lineTo(a.x - nx, a.y - ny);
        context.closePath();
        context.fill();
      }
    }
    context.restore();
  }

  private drawLines(context: CanvasRenderingContext2D): void {
    const data = this.data;
    if (!data) return;
    context.save();
    context.strokeStyle = SEA_BLUE;
    for (const line of data.lines) {
      if (line.status === 'Superseded') continue;
      const a = this.toScreen(line.start);
      const b = this.toScreen(line.end);
      context.lineWidth = 1;
      context.setLineDash(line.kind === 'infill' ? [5, 4] : []);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      if (line.kind === 'crossline') this.drawCrosslineTicks(context, a, b);
    }
    context.restore();
  }

  /** Crosslines carry small perpendicular ticks. */
  private drawCrosslineTicks(
    context: CanvasRenderingContext2D,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): void {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) return;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    context.setLineDash([]);
    for (let along = 10; along < length; along += 24) {
      const px = a.x + ux * along;
      const py = a.y + uy * along;
      context.beginPath();
      context.moveTo(px + uy * 3, py - ux * 3);
      context.lineTo(px - uy * 3, py + ux * 3);
      context.stroke();
    }
  }

  /** Outside the lens, holidays show as thin orange outlines and specks get no mark. */
  private drawHolidayOutlines(context: CanvasRenderingContext2D): void {
    const data = this.data;
    if (!data) return;
    context.save();
    context.strokeStyle = SIGNAL_ORANGE;
    context.lineWidth = 1;
    for (const holiday of data.holidays) {
      if (holiday.status === 'Closed') continue;
      for (const [col, row] of holiday.cells) {
        const centre = this.cellCentre(col, row);
        const corner = this.toScreen({
          easting: centre.easting - CELL_M / 2,
          northing: centre.northing + CELL_M / 2,
        });
        const side = CELL_M * this.view.scale;
        context.strokeRect(corner.x, corner.y, side, side);
      }
    }
    context.restore();
  }

  /**
   * Inside the lens the swath tint gives way to three labelled overlap bands, and
   * every holiday cell is covered with orange diagonal strokes.
   */
  private drawLens(context: CanvasRenderingContext2D): void {
    const data = this.data;
    if (!data || !this.lensGround || this.lensOpenProgress <= 0) return;
    const at = this.toScreen(this.lensDrawn ?? this.lensGround);
    const radius = (LENS_DIAMETER_PX / 2) * this.lensOpenProgress;

    context.save();
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = PAPER;
    context.fillRect(at.x - radius, at.y - radius, radius * 2, radius * 2);

    const grid = data.coverage;
    const side = CELL_M * this.view.scale;
    if (grid) {
      const bands = ['rgba(90,115,140,0.22)', 'rgba(70,100,130,0.38)', 'rgba(45,80,115,0.55)'];
      for (let row = 0; row < grid.rows; row += 1) {
        for (let col = 0; col < grid.cols; col += 1) {
          const overlap = grid.overlap[row]?.[col] ?? -1;
          if (overlap <= 0) continue;
          const centre = this.cellCentre(col, row);
          const corner = this.toScreen({
            easting: centre.easting - CELL_M / 2,
            northing: centre.northing + CELL_M / 2,
          });
          if (Math.hypot(corner.x - at.x, corner.y - at.y) > radius + side) continue;
          context.fillStyle = bands[Math.min(2, overlap - 1)]!;
          context.fillRect(corner.x, corner.y, side + 0.5, side + 0.5);
        }
      }
    }

    for (const holiday of data.holidays) {
      if (holiday.status === 'Closed') continue;
      for (const [col, row] of holiday.cells) {
        const centre = this.cellCentre(col, row);
        const corner = this.toScreen({
          easting: centre.easting - CELL_M / 2,
          northing: centre.northing + CELL_M / 2,
        });
        if (Math.hypot(corner.x - at.x, corner.y - at.y) > radius + side) continue;
        this.hatchCell(context, corner.x, corner.y, side);
      }
    }

    context.restore();

    context.save();
    context.font = '10px "IBM Plex Mono", monospace';
    context.fillStyle = INK;
    const legend = ['1×', '2×', '3×+'];
    legend.forEach((label, index) => {
      context.fillText(label, at.x - radius + 6, at.y - radius + 14 + index * 12);
    });
    for (const { holiday } of this.holidaysInLens()) {
      const centre = this.toScreen(holiday.centroid);
      context.fillStyle = INK;
      context.fillText(areaText(holiday.area_m2, this.units), centre.x + 4, centre.y - 4);
    }
    context.strokeStyle = SEA_BLUE;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  /** Orange diagonal strokes dense enough to cover at least a third of the cell. */
  private hatchCell(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    side: number,
  ): void {
    context.save();
    context.beginPath();
    context.rect(x, y, side, side);
    context.clip();
    context.strokeStyle = SIGNAL_ORANGE;
    context.lineWidth = Math.max(1.5, side / 6);
    const step = Math.max(3, side / 3);
    for (let offset = -side; offset <= side * 2; offset += step) {
      context.beginPath();
      context.moveTo(x + offset, y);
      context.lineTo(x + offset + side, y + side);
      context.stroke();
    }
    context.restore();
  }

  /** Vessels are small ink chevrons pointing along their heading, each labelled. */
  private drawVessels(context: CanvasRenderingContext2D): void {
    const data = this.data;
    if (!data) return;
    context.save();
    for (const entry of data.vessels) {
      const fix = entry.vessel.last_fix;
      if (!fix) continue;
      const at = this.toScreen(fix.position);
      const heading = ((fix.heading_deg - 90) * Math.PI) / 180;
      context.strokeStyle = INK;
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(at.x + Math.cos(heading) * 8, at.y + Math.sin(heading) * 8);
      context.lineTo(
        at.x + Math.cos(heading + 2.4) * 8,
        at.y + Math.sin(heading + 2.4) * 8,
      );
      context.moveTo(at.x + Math.cos(heading) * 8, at.y + Math.sin(heading) * 8);
      context.lineTo(
        at.x + Math.cos(heading - 2.4) * 8,
        at.y + Math.sin(heading - 2.4) * 8,
      );
      context.stroke();
      context.font = '10px "IBM Plex Mono", monospace';
      context.fillStyle = INK;
      context.fillText(entry.label, at.x + 10, at.y - 6);
    }
    context.restore();
  }

  /** With normal motion the lens centre trails the pointer; under reduced motion it snaps. */
  moveLens(ground: Position, options: { trail: boolean }): void {
    this.lensGround = ground;
    if (!options.trail) {
      this.lensDrawn = ground;
      this.schedule();
      return;
    }
    const start = this.lensDrawn ?? ground;
    const startedAt = performance.now();
    const step = (): void => {
      if (!this.lensGround) return;
      const progress = Math.min(1, (performance.now() - startedAt) / 125);
      this.lensDrawn = {
        easting: start.easting + (ground.easting - start.easting) * progress,
        northing: start.northing + (ground.northing - start.northing) * progress,
      };
      this.draw();
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  openLens(ground: Position, animate: boolean): void {
    this.lensGround = ground;
    this.lensDrawn = ground;
    if (!animate) {
      this.lensOpenProgress = 1;
      this.schedule();
      return;
    }
    const startedAt = performance.now();
    const step = (): void => {
      if (!this.lensGround) return;
      const progress = Math.min(1, (performance.now() - startedAt) / 180);
      this.lensOpenProgress = 0.6 + 0.4 * progress;
      this.draw();
      if (progress < 1) window.requestAnimationFrame(step);
    };
    this.lensOpenProgress = 0.6;
    window.requestAnimationFrame(step);
  }

  closeLens(): void {
    this.lensOpenProgress = 0;
    this.schedule();
  }

  readoutPosition(): Position | null {
    return this.lensGround;
  }

  positionLabel(point: Position): string {
    return `E ${fixed(lengthValue(point.easting, this.units), 1)} N ${fixed(lengthValue(point.northing, this.units), 1)}`;
  }
}
