import type { DrawingObject, LayerRow, Point } from '../../shared/api';

export interface Extents {
  min: Point;
  max: Point;
}

export const FALLBACK_EXTENTS: Extents = { min: [0, 0], max: [10000, 7000] };

export interface ViewState {
  scale: number;
  centre: Point;
}

function arcBox(center: Point, radius: number, start: number, end: number): Extents {
  const sweep = ((end - start) % 360 + 360) % 360 || 360;
  const points: Point[] = [
    [center[0] + radius * Math.cos((start * Math.PI) / 180), center[1] + radius * Math.sin((start * Math.PI) / 180)],
    [
      center[0] + radius * Math.cos(((start + sweep) * Math.PI) / 180),
      center[1] + radius * Math.sin(((start + sweep) * Math.PI) / 180),
    ],
  ];
  for (const axis of [0, 90, 180, 270]) {
    const offset = ((axis - start) % 360 + 360) % 360;
    if (offset <= sweep) {
      points.push([
        center[0] + radius * Math.cos((axis * Math.PI) / 180),
        center[1] + radius * Math.sin((axis * Math.PI) / 180),
      ]);
    }
  }
  return boxOf(points);
}

function boxOf(points: Point[]): Extents {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

export function objectBox(object: DrawingObject): Extents | null {
  switch (object.type) {
    case 'line':
      return boxOf([object.start, object.end]);
    case 'polyline':
      return object.vertices.length === 0 ? null : boxOf(object.vertices);
    case 'spline':
      return object.fit_points.length === 0 ? null : boxOf(object.fit_points);
    case 'circle':
      return {
        min: [object.center[0] - object.radius, object.center[1] - object.radius],
        max: [object.center[0] + object.radius, object.center[1] + object.radius],
      };
    case 'arc':
      return arcBox(object.center, object.radius, object.start_angle, object.end_angle);
    case 'mtext':
      return boxOf([object.position, [object.position[0] + object.width, object.position[1] + object.height]]);
    case 'dimension':
      return boxOf([...object.points, object.location]);
    case 'insert': {
      const span = 1200 * object.scale;
      return boxOf([
        [object.position[0] - span, object.position[1] - span],
        [object.position[0] + span, object.position[1] + span],
      ]);
    }
    case 'revcloud':
      return boxOf([object.first, object.opposite]);
  }
}

export function isLayerVisible(layers: LayerRow[], name: string): boolean {
  const layer = layers.find((candidate) => candidate.name === name);
  return layer !== undefined && layer.on && !layer.frozen;
}

/** The extents of every base object on a layer that is neither frozen nor off. */
export function drawingExtents(objects: DrawingObject[], layers: LayerRow[]): Extents {
  const boxes = objects
    .filter((object) => isLayerVisible(layers, object.layer))
    .map(objectBox)
    .filter((box): box is Extents => box !== null);
  if (boxes.length === 0) return FALLBACK_EXTENTS;
  return boxOf(boxes.flatMap((box) => [box.min, box.max]));
}

export function fittedScale(extents: Extents, width: number, height: number): number {
  const extentsWidth = Math.max(1e-6, extents.max[0] - extents.min[0]);
  const extentsHeight = Math.max(1e-6, extents.max[1] - extents.min[1]);
  return Math.min((0.8 * width) / extentsWidth, (0.8 * height) / extentsHeight);
}

export function fitView(extents: Extents, width: number, height: number): ViewState {
  return {
    scale: fittedScale(extents, width, height),
    centre: [(extents.min[0] + extents.max[0]) / 2, (extents.min[1] + extents.max[1]) / 2],
  };
}

export function toScreen(view: ViewState, width: number, height: number, point: Point): Point {
  return [
    width / 2 + (point[0] - view.centre[0]) * view.scale,
    height / 2 - (point[1] - view.centre[1]) * view.scale,
  ];
}

export function toModel(view: ViewState, width: number, height: number, screen: Point): Point {
  return [
    view.centre[0] + (screen[0] - width / 2) / view.scale,
    view.centre[1] - (screen[1] - height / 2) / view.scale,
  ];
}

export function zoomPercent(view: ViewState, fitted: number): number {
  return Math.round((view.scale / fitted) * 100);
}

export function zoomAbout(
  view: ViewState,
  factor: number,
  anchorModel: Point,
): ViewState {
  const scale = view.scale * factor;
  return {
    scale,
    centre: [
      anchorModel[0] + (view.centre[0] - anchorModel[0]) / factor,
      anchorModel[1] + (view.centre[1] - anchorModel[1]) / factor,
    ],
  };
}
