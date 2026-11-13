import type { Drawing, DrawingObject, LayerRow, Point } from '../../shared/api';
import { GRID_STEP } from './coords';
import { isLayerVisible, toScreen, type ViewState } from './view';

const CSS_BY_COLOR: Record<string, string> = {
  Red: '#ff4d4d',
  Yellow: '#f2d14b',
  Green: '#5ddc7a',
  Cyan: '#5fd8e8',
  Blue: '#6f8ff5',
  Magenta: '#e86fd8',
  White: '#f2f4f6',
};

const DASHES: Record<string, number[]> = {
  Continuous: [],
  Dashed: [10, 6],
  Hidden: [4, 4],
  Center: [16, 5, 4, 5],
};

const WEIGHTS: Record<string, number> = {
  '0.13 mm': 0.7,
  '0.18 mm': 0.9,
  '0.25 mm': 1,
  '0.35 mm': 1.3,
  '0.50 mm': 1.7,
  '0.70 mm': 2.2,
  '1.00 mm': 2.8,
};

function layerOf(layers: LayerRow[], name: string): LayerRow | undefined {
  return layers.find((layer) => layer.name === name);
}

function strokeFor(object: DrawingObject, layers: LayerRow[]): { color: string; dash: number[]; width: number } {
  const layer = layerOf(layers, object.layer);
  const colorName = object.color === 'ByLayer' ? (layer?.color ?? 'White') : object.color;
  const linetype = object.linetype === 'ByLayer' ? (layer?.linetype ?? 'Continuous') : object.linetype;
  const lineweight = object.lineweight === 'ByLayer' ? (layer?.lineweight ?? '0.25 mm') : object.lineweight;
  return {
    color: CSS_BY_COLOR[colorName] ?? '#f2f4f6',
    dash: (DASHES[linetype] ?? []).map((value) => value * (object.linetype_scale || 1)),
    width: WEIGHTS[lineweight] ?? 1,
  };
}

/** The strokes a dimension shows on screen; its measurement and text come from the server. */
export function dimensionStrokes(object: Extract<DrawingObject, { type: 'dimension' }>): {
  segments: Array<[Point, Point]>;
  textAt: Point;
} {
  const location = object.location;
  if (object.kind === 'linear' && object.points.length >= 2) {
    const [first, second] = object.points as [Point, Point];
    const horizontal = Math.abs(object.measurement - Math.abs(second[0] - first[0])) < 1e-6;
    const a: Point = horizontal ? [first[0], location[1]] : [location[0], first[1]];
    const b: Point = horizontal ? [second[0], location[1]] : [location[0], second[1]];
    return {
      segments: [
        [a, b],
        [first, a],
        [second, b],
      ],
      textAt: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
  }
  if (object.kind === 'aligned' && object.points.length >= 2) {
    const [first, second] = object.points as [Point, Point];
    const dx = second[0] - first[0];
    const dy = second[1] - first[1];
    const length = Math.hypot(dx, dy) || 1;
    const normal: Point = [-dy / length, dx / length];
    const offset = (location[0] - first[0]) * normal[0] + (location[1] - first[1]) * normal[1];
    const a: Point = [first[0] + normal[0] * offset, first[1] + normal[1] * offset];
    const b: Point = [second[0] + normal[0] * offset, second[1] + normal[1] * offset];
    return {
      segments: [
        [a, b],
        [first, a],
        [second, b],
      ],
      textAt: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    };
  }
  if (object.kind === 'radius' && object.points.length >= 1) {
    return { segments: [[object.points[0]!, location]], textAt: location };
  }
  if (object.points.length === 4) {
    return {
      segments: [
        [object.points[0]!, object.points[1]!],
        [object.points[2]!, object.points[3]!],
      ],
      textAt: location,
    };
  }
  return { segments: [], textAt: location };
}

interface Painter {
  moveTo(point: Point): void;
  lineTo(point: Point): void;
}

function tracePath(ctx: CanvasRenderingContext2D, map: (point: Point) => Point): Painter {
  return {
    moveTo: (point) => {
      const screen = map(point);
      ctx.moveTo(screen[0], screen[1]);
    },
    lineTo: (point) => {
      const screen = map(point);
      ctx.lineTo(screen[0], screen[1]);
    },
  };
}

function paintObject(
  ctx: CanvasRenderingContext2D,
  object: DrawingObject,
  map: (point: Point) => Point,
  scale: number,
): void {
  ctx.beginPath();
  const painter = tracePath(ctx, map);
  switch (object.type) {
    case 'line':
      painter.moveTo(object.start);
      painter.lineTo(object.end);
      break;
    case 'polyline': {
      if (object.vertices.length === 0) break;
      painter.moveTo(object.vertices[0]!);
      for (const vertex of object.vertices.slice(1)) painter.lineTo(vertex);
      if (object.closed) ctx.closePath();
      break;
    }
    case 'spline': {
      if (object.fit_points.length === 0) break;
      painter.moveTo(object.fit_points[0]!);
      for (const vertex of object.fit_points.slice(1)) painter.lineTo(vertex);
      break;
    }
    case 'circle': {
      const centre = map(object.center);
      ctx.arc(centre[0], centre[1], object.radius * scale, 0, Math.PI * 2);
      break;
    }
    case 'arc': {
      const centre = map(object.center);
      const start = (-object.start_angle * Math.PI) / 180;
      const sweep = (((object.end_angle - object.start_angle) % 360) + 360) % 360 || 360;
      ctx.arc(centre[0], centre[1], object.radius * scale, start, start - (sweep * Math.PI) / 180, true);
      break;
    }
    case 'dimension': {
      const strokes = dimensionStrokes(object);
      for (const [a, b] of strokes.segments) {
        painter.moveTo(a);
        painter.lineTo(b);
      }
      break;
    }
    case 'revcloud': {
      const x0 = Math.min(object.first[0], object.opposite[0]);
      const x1 = Math.max(object.first[0], object.opposite[0]);
      const y0 = Math.min(object.first[1], object.opposite[1]);
      const y1 = Math.max(object.first[1], object.opposite[1]);
      const corners: Point[] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      for (let side = 0; side < 4; side += 1) {
        const a = corners[side]!;
        const b = corners[(side + 1) % 4]!;
        const sideLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const count = Math.max(1, Math.ceil(sideLength / 150));
        for (let i = 0; i < count; i += 1) {
          const from: Point = [a[0] + ((b[0] - a[0]) * i) / count, a[1] + ((b[1] - a[1]) * i) / count];
          const to: Point = [
            a[0] + ((b[0] - a[0]) * (i + 1)) / count,
            a[1] + ((b[1] - a[1]) * (i + 1)) / count,
          ];
          const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
          const centre = map(mid);
          const radius = (Math.hypot(to[0] - from[0], to[1] - from[1]) / 2) * scale;
          const base = Math.atan2(-(to[1] - from[1]), to[0] - from[0]);
          ctx.moveTo(centre[0] + radius * Math.cos(base), centre[1] + radius * Math.sin(base));
          ctx.arc(centre[0], centre[1], radius, base, base - Math.PI, true);
        }
      }
      break;
    }
    case 'insert': {
      const span = 450 * object.scale;
      const centre = map(object.position);
      ctx.moveTo(centre[0] - span * scale, centre[1]);
      ctx.lineTo(centre[0] + span * scale, centre[1]);
      ctx.moveTo(centre[0], centre[1] - span * scale);
      ctx.lineTo(centre[0], centre[1] + span * scale);
      break;
    }
    case 'mtext':
      break;
  }
  ctx.stroke();
}

function paintText(
  ctx: CanvasRenderingContext2D,
  object: DrawingObject,
  map: (point: Point) => Point,
  scale: number,
  color: string,
): void {
  if (object.type === 'mtext') {
    const at = map(object.position);
    ctx.fillStyle = color;
    ctx.font = `${Math.max(9, object.height * scale)}px 'Fira Sans', sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(object.contents, at[0], at[1]);
    return;
  }
  if (object.type === 'dimension') {
    const at = map(dimensionStrokes(object).textAt);
    ctx.fillStyle = color;
    ctx.font = `${Math.max(9, 250 * scale)}px 'Fira Sans', sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(object.text, at[0] + 4, at[1] - 4);
  }
}

/** An SVG path for one object, used by the overlay strokes that draw in on a remote change. */
export function objectPathData(object: DrawingObject, map: (point: Point) => Point): string {
  const move = (point: Point): string => {
    const screen = map(point);
    return `M${screen[0].toFixed(2)} ${screen[1].toFixed(2)}`;
  };
  const line = (point: Point): string => {
    const screen = map(point);
    return `L${screen[0].toFixed(2)} ${screen[1].toFixed(2)}`;
  };
  const circlePath = (center: Point, radius: number): string => {
    const steps = 48;
    const points: Point[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      points.push([center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]);
    }
    return `${move(points[0]!)}${points.slice(1).map(line).join('')}`;
  };
  switch (object.type) {
    case 'line':
      return `${move(object.start)}${line(object.end)}`;
    case 'polyline': {
      if (object.vertices.length === 0) return '';
      const body = `${move(object.vertices[0]!)}${object.vertices.slice(1).map(line).join('')}`;
      return object.closed ? `${body}Z` : body;
    }
    case 'spline':
      return object.fit_points.length === 0
        ? ''
        : `${move(object.fit_points[0]!)}${object.fit_points.slice(1).map(line).join('')}`;
    case 'circle':
      return circlePath(object.center, object.radius);
    case 'arc': {
      const sweep = (((object.end_angle - object.start_angle) % 360) + 360) % 360 || 360;
      const steps = Math.max(8, Math.ceil(sweep / 6));
      const points: Point[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const angle = ((object.start_angle + (sweep * i) / steps) * Math.PI) / 180;
        points.push([
          object.center[0] + object.radius * Math.cos(angle),
          object.center[1] + object.radius * Math.sin(angle),
        ]);
      }
      return `${move(points[0]!)}${points.slice(1).map(line).join('')}`;
    }
    case 'dimension': {
      const strokes = dimensionStrokes(object);
      return strokes.segments.map(([a, b]) => `${move(a)}${line(b)}`).join('');
    }
    case 'revcloud': {
      const x0 = Math.min(object.first[0], object.opposite[0]);
      const x1 = Math.max(object.first[0], object.opposite[0]);
      const y0 = Math.min(object.first[1], object.opposite[1]);
      const y1 = Math.max(object.first[1], object.opposite[1]);
      return `${move([x0, y0])}${line([x1, y0])}${line([x1, y1])}${line([x0, y1])}Z`;
    }
    case 'insert': {
      const span = 450 * object.scale;
      return `${move([object.position[0] - span, object.position[1]])}${line([object.position[0] + span, object.position[1]])}${move([object.position[0], object.position[1] - span])}${line([object.position[0], object.position[1] + span])}`;
    }
    case 'mtext':
      return `${move(object.position)}${line([object.position[0] + object.width, object.position[1]])}`;
  }
}

/** The vertices that show grips when an object is selected or has just changed. */
export function objectVertices(object: DrawingObject): Point[] {
  switch (object.type) {
    case 'line':
      return [object.start, object.end];
    case 'polyline':
      return object.vertices;
    case 'spline':
      return object.fit_points;
    case 'circle':
      return [object.center];
    case 'arc':
      return [object.center];
    case 'mtext':
      return [object.position];
    case 'dimension':
      return [object.location];
    case 'insert':
      return [object.position];
    case 'revcloud':
      return [object.first, object.opposite];
  }
}

export interface SceneOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: ViewState;
  drawing: Drawing;
  traceObjects: DrawingObject[];
  dimBase: boolean;
  showGrid: boolean;
  paper: { sheetWidth: number; sheetHeight: number; viewportScale: number } | null;
}

export function drawScene(options: SceneOptions): void {
  const { ctx, width, height, view, drawing } = options;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#1b2531';
  ctx.fillRect(0, 0, width, height);

  const map = (point: Point): Point => toScreen(view, width, height, point);

  if (options.paper !== null) {
    const sheet = options.paper;
    const topLeft = map([-sheet.sheetWidth / 2, sheet.sheetHeight / 2]);
    const bottomRight = map([sheet.sheetWidth / 2, -sheet.sheetHeight / 2]);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(topLeft[0], topLeft[1], bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]);
  }

  if (options.showGrid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1;
    const stepPixels = GRID_STEP * view.scale;
    if (stepPixels > 6) {
      const originScreen = map([0, 0]);
      ctx.beginPath();
      for (let x = originScreen[0] % stepPixels; x < width; x += stepPixels) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = originScreen[1] % stepPixels; y < height; y += stepPixels) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = options.dimBase ? 0.4 : 1;

  for (const xref of drawing.xrefs) {
    if (xref.status !== 'loaded') continue;
    ctx.save();
    ctx.globalAlpha = (options.dimBase ? 0.4 : 1) * 0.35;
    for (const object of xref.objects) {
      const stroke = strokeFor(object, drawing.layers);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.setLineDash(stroke.dash);
      paintObject(ctx, object, map, view.scale);
      paintText(ctx, object, map, view.scale, stroke.color);
    }
    ctx.restore();
  }

  for (const object of drawing.objects) {
    if (!isLayerVisible(drawing.layers, object.layer)) continue;
    const stroke = strokeFor(object, drawing.layers);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.setLineDash(stroke.dash);
    paintObject(ctx, object, map, view.scale);
    paintText(ctx, object, map, view.scale, stroke.color);
  }
  ctx.restore();

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#8fd8f7';
  ctx.lineWidth = 1.4;
  for (const object of options.traceObjects) {
    paintObject(ctx, object, map, view.scale);
    paintText(ctx, object, map, view.scale, '#8fd8f7');
  }
  ctx.restore();

  if (options.paper !== null) {
    const sheet = options.paper;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    const frameTopLeft = map([-sheet.sheetWidth / 2 + 10, sheet.sheetHeight / 2 - 10]);
    const frameBottomRight = map([sheet.sheetWidth / 2 - 10, -sheet.sheetHeight / 2 + 70]);
    ctx.strokeRect(
      frameTopLeft[0],
      frameTopLeft[1],
      frameBottomRight[0] - frameTopLeft[0],
      frameBottomRight[1] - frameTopLeft[1],
    );
    ctx.restore();
  }
}
