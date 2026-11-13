// Pure geometry of the drafting engine. Every geometry value is computed here, once, in millimetres.
import { BLOCK_LIBRARY } from './blocks.ts';
import { formatAngle, formatLength, round6 } from './format.ts';
import type {
  ApiObject, ArcGeometry, DimensionGeometry, Layer, Point, Primitive, RevcloudGeometry, Snaps, StoredObject,
  StyledPrimitive, Units,
} from './types.ts';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const RAD = Math.PI / 180;
/** Dimension text height at drawing scale. */
const DIMENSION_TEXT_HEIGHT = 180;
const DIMENSION_TICK = 120;
const TEXT_LINE_SPACING = 1.25;
/** Average glyph advance as a fraction of the letter height; the canvas, PDF and picking all lay text out with it. */
const TEXT_ADVANCE = 0.6;
const SPLINE_STEPS = 10;
/** Edge length of one revision-cloud arc, in millimetres. */
const REVCLOUD_ARC_MM = 150;

// ---- Points and angles ----

export const mod360 = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** An angle for output: rounded to 6 decimals and kept in [0, 360). */
export function angle6(degrees: number): number {
  const rounded = round6(mod360(degrees));
  return rounded >= 360 ? 0 : rounded;
}

export const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const polar = (center: Point, radius: number, degrees: number): Point =>
  [center[0] + radius * Math.cos(degrees * RAD), center[1] + radius * Math.sin(degrees * RAD)];

/** Direction from `from` to `to` in degrees, [0, 360). */
export function directionOf(from: Point, to: Point): number {
  return mod360(Math.atan2(to[1] - from[1], to[0] - from[0]) / RAD);
}

/** Counter-clockwise sweep of an arc; equal angles make a full turn. */
export const arcSweep = (startAngle: number, endAngle: number): number => mod360(endAngle - startAngle) || 360;

export function angleWithinArc(angle: number, arc: Pick<ArcGeometry, 'start_angle' | 'end_angle'>, slack = 1e-9): boolean {
  return mod360(angle - arc.start_angle) <= arcSweep(arc.start_angle, arc.end_angle) + slack;
}

/** Nearest point of segment a-b to p: parameter 0..1 and the point. */
export function closestOnSegment(a: Point, b: Point, p: Point): { t: number; point: Point } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return { t, point: [a[0] + t * dx, a[1] + t * dy] };
}

export function polylineSegments(points: Point[], closed: boolean): [Point, Point][] {
  const segments: [Point, Point][] = [];
  for (let i = 0; i + 1 < points.length; i++) segments.push([points[i] as Point, points[i + 1] as Point]);
  const first = points[0];
  const last = points[points.length - 1];
  if (closed && first && last && points.length > 2) segments.push([last, first]);
  return segments;
}

function polylineLength(points: Point[], closed: boolean): number {
  return polylineSegments(points, closed).reduce((sum, [a, b]) => sum + distance(a, b), 0);
}

/** Absolute area of a closed polygon. */
function polygonArea(points: Point[]): number {
  return Math.abs(signedArea(points));
}

/** Positive for counter-clockwise vertices. */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] as Point;
    const [x2, y2] = points[(i + 1) % points.length] as Point;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// ---- Rounding of stored objects ----

const rp = (p: Point): Point => [round6(p[0]), round6(p[1])];

/** Rounds every coordinate to 6 decimals and keeps angles in [0, 360): the form in which objects are stored. */
export function normalizeObject(object: StoredObject): StoredObject {
  switch (object.type) {
    case 'line': return { ...object, start: rp(object.start), end: rp(object.end) };
    case 'polyline': return { ...object, vertices: object.vertices.map(rp) };
    case 'circle': return { ...object, center: rp(object.center), radius: round6(object.radius) };
    case 'arc':
      return {
        ...object, center: rp(object.center), radius: round6(object.radius),
        start_angle: angle6(object.start_angle), end_angle: angle6(object.end_angle),
      };
    case 'spline': return { ...object, fit_points: object.fit_points.map(rp) };
    case 'mtext':
      return { ...object, position: rp(object.position), width: round6(object.width), height: round6(object.height) };
    case 'dimension': return { ...object, points: object.points.map(rp), location: rp(object.location) };
    case 'insert':
      return { ...object, position: rp(object.position), scale: round6(object.scale), rotation: angle6(object.rotation) };
    case 'revcloud': return { ...object, first: rp(object.first), opposite: rp(object.opposite) };
  }
}

// ---- Dimensions ----

/** Which axis a linear dimension measures: x when the location is above or below both origins (and by default). */
function linearAxis(points: Point[], location: Point): 'x' | 'y' {
  const [a, b] = points as [Point, Point];
  const beside = location[0] > Math.max(a[0], b[0]) || location[0] < Math.min(a[0], b[0]);
  const aboveOrBelow = location[1] > Math.max(a[1], b[1]) || location[1] < Math.min(a[1], b[1]);
  return beside && !aboveOrBelow ? 'y' : 'x';
}

/** The sector between the lines through `vertex` that holds `location`: start direction and width (0..180). */
function angularSector(vertex: Point, first: Point, second: Point, location: Point): { start: number; width: number } {
  const a1 = directionOf(vertex, first);
  const a2 = directionOf(vertex, second);
  const rays = [a1, mod360(a1 + 180), a2, mod360(a2 + 180)].sort((x, y) => x - y);
  const target = directionOf(vertex, location);
  let narrowest = { start: a1, width: 180 };
  for (let i = 0; i < rays.length; i++) {
    const start = rays[i] as number;
    const width = mod360((rays[(i + 1) % rays.length] as number) - start);
    if (width === 0) continue;
    if (mod360(target - start) < width) return { start, width };
    if (width < narrowest.width) narrowest = { start, width };
  }
  return narrowest;
}

/** Millimetres, or degrees for angular dimensions. */
function dimensionMeasurement(dimension: DimensionGeometry): number {
  const [p0, p1, p2] = dimension.points as [Point, Point, Point];
  switch (dimension.kind) {
    case 'linear': return linearAxis(dimension.points, dimension.location) === 'x' ? Math.abs(p1[0] - p0[0]) : Math.abs(p1[1] - p0[1]);
    case 'aligned': case 'radius': return distance(p0, p1);
    case 'angular': return angularSector(p0, p1, p2, dimension.location).width;
  }
}

/** The shown text: the measurement in the current format, or the override with every `<>` standing for it. */
function dimensionText(dimension: DimensionGeometry, units: Units): string {
  const measurement = dimensionMeasurement(dimension);
  const shown = dimension.kind === 'angular' ? formatAngle(measurement)
    : dimension.kind === 'radius' ? `R${formatLength(measurement, units)}` : formatLength(measurement, units);
  return dimension.text_override === null ? shown : dimension.text_override.split('<>').join(shown);
}

// ---- Revision clouds ----

function revcloudCorners(cloud: Pick<RevcloudGeometry, 'first' | 'opposite'>): Point[] {
  const x0 = Math.min(cloud.first[0], cloud.opposite[0]);
  const x1 = Math.max(cloud.first[0], cloud.opposite[0]);
  const y0 = Math.min(cloud.first[1], cloud.opposite[1]);
  const y1 = Math.max(cloud.first[1], cloud.opposite[1]);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const arcsOnSide = (length: number): number => Math.ceil(length / REVCLOUD_ARC_MM - 1e-9);

function revcloudArcCount(cloud: Pick<RevcloudGeometry, 'first' | 'opposite'>): number {
  return polylineSegments(revcloudCorners(cloud), true).reduce((sum, [a, b]) => sum + arcsOnSide(distance(a, b)), 0);
}

// ---- Primitives ----

function textWidth(text: string, height: number): number {
  return text.length * height * TEXT_ADVANCE;
}

function catmullRom(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const sampled: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)] as Point;
    const p1 = points[i] as Point;
    const p2 = points[i + 1] as Point;
    const p3 = points[Math.min(points.length - 1, i + 2)] as Point;
    for (let step = 0; step < SPLINE_STEPS; step++) {
      const t = step / SPLINE_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const at = (k: 0 | 1): number => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      sampled.push([at(0), at(1)]);
    }
  }
  sampled.push(points[points.length - 1] as Point);
  return sampled;
}

function insertPrimitives(object: Extract<StoredObject, { type: 'insert' }>): Primitive[] {
  const c = Math.cos(object.rotation * RAD);
  const s = Math.sin(object.rotation * RAD);
  const place = (p: Point): Point => [
    object.position[0] + object.scale * (p[0] * c - p[1] * s),
    object.position[1] + object.scale * (p[0] * s + p[1] * c),
  ];
  return BLOCK_LIBRARY[object.block].parts.map((part): Primitive => {
    switch (part.kind) {
      case 'line': return { kind: 'line', a: place(part.a), b: place(part.b) };
      case 'polyline': return { kind: 'polyline', points: part.points.map(place), closed: part.closed };
      case 'arc':
        return {
          kind: 'arc', center: place(part.center), radius: part.radius * object.scale,
          start_angle: mod360(part.start_angle + object.rotation), end_angle: mod360(part.end_angle + object.rotation),
        };
      case 'text': return { kind: 'text', at: place(part.at), height: part.height * object.scale, text: part.text, width: null };
    }
  });
}

function tick(at: Point, direction: number): Primitive {
  const half = DIMENSION_TICK / 2;
  return { kind: 'line', a: polar(at, half, direction + 45), b: polar(at, half, direction + 225) };
}

function textAround(at: Point, text: string): Primitive {
  const width = textWidth(text, DIMENSION_TEXT_HEIGHT);
  return { kind: 'text', at: [at[0] - width / 2, at[1] + DIMENSION_TEXT_HEIGHT / 2], height: DIMENSION_TEXT_HEIGHT, text, width: null };
}

function dimensionPrimitives(dimension: DimensionGeometry, units: Units): Primitive[] {
  const text = dimensionText(dimension, units);
  const [p0, p1, p2] = dimension.points as [Point, Point, Point];
  const location = dimension.location;
  if (dimension.kind === 'radius') {
    return [
      { kind: 'line', a: p1, b: location }, tick(p1, directionOf(p1, location)),
      textAround(polar(location, DIMENSION_TEXT_HEIGHT * 0.75, 90), text),
    ];
  }
  if (dimension.kind === 'angular') {
    const { start, width } = angularSector(p0, p1, p2, location);
    const radius = Math.max(distance(p0, location), 1);
    const end = start + width;
    const from = polar(p0, radius, start);
    const to = polar(p0, radius, end);
    return [
      { kind: 'arc', center: p0, radius, start_angle: mod360(start), end_angle: mod360(end) },
      tick(from, start + 90), tick(to, end + 90),
      textAround(polar(p0, radius + DIMENSION_TEXT_HEIGHT * 0.75, start + width / 2), text),
    ];
  }
  let d0: Point;
  let d1: Point;
  if (dimension.kind === 'linear') {
    [d0, d1] = linearAxis(dimension.points, location) === 'x'
      ? [[p0[0], location[1]], [p1[0], location[1]]] : [[location[0], p0[1]], [location[0], p1[1]]];
  } else {
    const along = directionOf(p0, p1);
    const normal = along + 90;
    const offset = (location[0] - p0[0]) * Math.cos(normal * RAD) + (location[1] - p0[1]) * Math.sin(normal * RAD);
    d0 = polar(p0, offset, normal);
    d1 = polar(p1, offset, normal);
  }
  const direction = directionOf(d0, d1);
  return [
    { kind: 'line', a: p0, b: d0 }, { kind: 'line', a: p1, b: d1 }, { kind: 'line', a: d0, b: d1 },
    tick(d0, direction), tick(d1, direction),
    textAround(polar(midpoint(d0, d1), DIMENSION_TEXT_HEIGHT * 0.75, direction + 90), text),
  ];
}

function revcloudPrimitives(cloud: RevcloudGeometry): Primitive[] {
  const arcs: Primitive[] = [];
  for (const [a, b] of polylineSegments(revcloudCorners(cloud), true)) {
    const count = arcsOnSide(distance(a, b));
    const travel = directionOf(a, b);
    const chord = distance(a, b) / count;
    for (let i = 0; i < count; i++) {
      const from = polar(a, chord * i, travel);
      // Corners run counter-clockwise, so the outside is on the right of travel.
      arcs.push({ kind: 'arc', center: polar(from, chord / 2, travel), radius: chord / 2, start_angle: mod360(travel + 180), end_angle: mod360(travel) });
    }
  }
  return arcs;
}

/** Primitives of one object in model space: blocks expanded, dimensions drawn (extension lines, dimension line, arrows, text). */
export function primitivesOf(object: StoredObject, units: Units): Primitive[] {
  switch (object.type) {
    case 'line': return [{ kind: 'line', a: object.start, b: object.end }];
    case 'polyline': return [{ kind: 'polyline', points: object.vertices, closed: object.closed }];
    case 'circle': return [{ kind: 'circle', center: object.center, radius: object.radius }];
    case 'arc':
      return [{ kind: 'arc', center: object.center, radius: object.radius, start_angle: object.start_angle, end_angle: object.end_angle }];
    case 'spline': return [{ kind: 'polyline', points: catmullRom(object.fit_points), closed: false }];
    case 'mtext':
      return object.contents.split(/\r?\n/).map((line, i): Primitive => ({
        kind: 'text', at: [object.position[0], object.position[1] - i * object.height * TEXT_LINE_SPACING],
        height: object.height, text: line, width: object.width,
      }));
    case 'dimension': return dimensionPrimitives(object, units);
    case 'insert': return insertPrimitives(object);
    case 'revcloud': return revcloudPrimitives(object);
  }
}

/** Primitives with the effective look resolved against the layer table (ByLayer resolved). */
export function styledPrimitivesOf(object: StoredObject, layers: Layer[], units: Units): StyledPrimitive[] {
  const layer = layers.find((l) => l.name === object.layer);
  const color = object.color === 'ByLayer' ? (layer?.color ?? 'White') : object.color;
  const linetype = object.linetype === 'ByLayer' ? (layer?.linetype ?? 'Continuous') : object.linetype;
  const lineweight = object.lineweight === 'ByLayer' ? (layer?.lineweight ?? '0.25 mm') : object.lineweight;
  return primitivesOf(object, units).map((primitive) => ({ handle: object.handle, primitive, color, linetype, lineweight }));
}

// ---- Snaps ----

function snapsOfPrimitives(primitives: Primitive[]): Snaps {
  const snaps: Snaps = { endpoint: [], midpoint: [], center: [] };
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'line':
        snaps.endpoint.push(primitive.a, primitive.b);
        snaps.midpoint.push(midpoint(primitive.a, primitive.b));
        break;
      case 'polyline':
        snaps.endpoint.push(...primitive.points);
        for (const [a, b] of polylineSegments(primitive.points, primitive.closed)) snaps.midpoint.push(midpoint(a, b));
        break;
      case 'circle':
        snaps.center.push(primitive.center);
        break;
      case 'arc':
        snaps.endpoint.push(polar(primitive.center, primitive.radius, primitive.start_angle), polar(primitive.center, primitive.radius, primitive.end_angle));
        snaps.midpoint.push(polar(primitive.center, primitive.radius, primitive.start_angle + arcSweep(primitive.start_angle, primitive.end_angle) / 2));
        snaps.center.push(primitive.center);
        break;
      case 'text':
        break;
    }
  }
  return snaps;
}

function snapsOf(object: StoredObject): Snaps {
  const snaps = (() => {
    switch (object.type) {
      case 'spline': {
        const first = object.fit_points[0];
        const last = object.fit_points[object.fit_points.length - 1];
        return { endpoint: first && last ? [first, last] : [], midpoint: [], center: [] };
      }
      case 'mtext': case 'dimension': case 'revcloud': return { endpoint: [], midpoint: [], center: [] };
      default: return snapsOfPrimitives(primitivesOf(object, 'mm'));
    }
  })();
  return { endpoint: snaps.endpoint.map(rp), midpoint: snaps.midpoint.map(rp), center: snaps.center.map(rp) };
}

// ---- Reading an object ----

/** Adds derived values and snap points to a stored object (the API object). */
export function presentObject(object: StoredObject, units: Units): ApiObject {
  const stored = normalizeObject(object);
  const snaps = snapsOf(stored);
  switch (stored.type) {
    case 'line':
      return { ...stored, snaps, length: round6(distance(stored.start, stored.end)), angle: angle6(directionOf(stored.start, stored.end)) };
    case 'polyline':
      return {
        ...stored, snaps, length: round6(polylineLength(stored.vertices, stored.closed)),
        area: stored.closed ? round6(polygonArea(stored.vertices)) : null,
      };
    case 'circle':
      return {
        ...stored, snaps, diameter: round6(2 * stored.radius), circumference: round6(2 * Math.PI * stored.radius),
        area: round6(Math.PI * stored.radius * stored.radius),
      };
    case 'arc':
      return { ...stored, snaps, length: round6(stored.radius * arcSweep(stored.start_angle, stored.end_angle) * RAD) };
    case 'dimension':
      return {
        ...stored, snaps,
        measurement: round6(dimensionMeasurement(stored)), text: dimensionText(stored, units),
      };
    case 'revcloud': return { ...stored, snaps, arcs: revcloudArcCount(stored) };
    case 'spline': case 'mtext': case 'insert': return { ...stored, snaps };
  }
}

// ---- Extents, distance, picking ----

/** Objects on layers that are on and not frozen. */
export function visibleLayerNames(layers: Layer[]): Set<string> {
  return new Set(layers.filter((l) => l.on && !l.frozen).map((l) => l.name));
}

function extend(bounds: Bounds | null, points: Point[]): Bounds | null {
  let result = bounds;
  for (const [x, y] of points) {
    result = result
      ? { minX: Math.min(result.minX, x), minY: Math.min(result.minY, y), maxX: Math.max(result.maxX, x), maxY: Math.max(result.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return result;
}

/** Extents of base objects on layers that are neither frozen nor off; null when there are none. */
export function drawingExtents(objects: StoredObject[], layers: Layer[]): Bounds | null {
  const visible = visibleLayerNames(layers);
  let bounds: Bounds | null = null;
  for (const object of objects) {
    if (!visible.has(object.layer)) continue;
    switch (object.type) {
      case 'line': bounds = extend(bounds, [object.start, object.end]); break;
      case 'polyline': bounds = extend(bounds, object.vertices); break;
      case 'circle':
        bounds = extend(bounds, [[object.center[0] - object.radius, object.center[1] - object.radius], [object.center[0] + object.radius, object.center[1] + object.radius]]);
        break;
      default: {
        const snaps = snapsOf(object);
        bounds = extend(bounds, [...snaps.endpoint, ...snaps.center]);
      }
    }
  }
  return bounds;
}

function distanceToPrimitive(primitive: Primitive, p: Point): number {
  switch (primitive.kind) {
    case 'line': return distance(closestOnSegment(primitive.a, primitive.b, p).point, p);
    case 'polyline': {
      let best = Infinity;
      for (const [a, b] of polylineSegments(primitive.points, primitive.closed)) best = Math.min(best, distance(closestOnSegment(a, b, p).point, p));
      return primitive.points.length === 1 ? distance(primitive.points[0] as Point, p) : best;
    }
    case 'circle': return Math.abs(distance(primitive.center, p) - primitive.radius);
    case 'arc': {
      if (angleWithinArc(directionOf(primitive.center, p), primitive)) return Math.abs(distance(primitive.center, p) - primitive.radius);
      return Math.min(
        distance(polar(primitive.center, primitive.radius, primitive.start_angle), p),
        distance(polar(primitive.center, primitive.radius, primitive.end_angle), p),
      );
    }
    case 'text': {
      const dx = Math.max(primitive.at[0] - p[0], 0, p[0] - (primitive.at[0] + textWidth(primitive.text, primitive.height)));
      const dy = Math.max(primitive.at[1] - primitive.height - p[1], 0, p[1] - primitive.at[1]);
      return Math.hypot(dx, dy);
    }
  }
}

/** Shortest distance from `point` to the object's geometry in millimetres. */
function distanceToObject(object: StoredObject, point: Point): number {
  return Math.min(...primitivesOf(object, 'mm').map((primitive) => distanceToPrimitive(primitive, point)));
}

/** The selectable object nearest to `point` within `tolerance` mm; ties go to the most recently created. Frozen/off-layer objects are never selectable. */
export function pickObject(objects: StoredObject[], layers: Layer[], point: Point, tolerance: number): StoredObject | null {
  const visible = visibleLayerNames(layers);
  let best: StoredObject | null = null;
  let bestDistance = Infinity;
  for (const object of objects) {
    if (!visible.has(object.layer)) continue;
    const d = distanceToObject(object, point);
    if (d <= tolerance && d <= bestDistance + 1e-9) {
      best = object;
      bestDistance = Math.min(d, bestDistance);
    }
  }
  return best;
}

/** DIST result: distance, angle (first to second, 0..360), deltas, and the DIST history line in the given units. */
export function measureDistance(first: Point, second: Point, units: Units): {
  distance: number; angle: number; delta_x: number; delta_y: number; text: string;
} {
  const deltaX = round6(second[0] - first[0]);
  const deltaY = round6(second[1] - first[1]);
  const length = round6(distance(first, second));
  const angle = angle6(directionOf(first, second));
  return {
    distance: length, angle, delta_x: deltaX, delta_y: deltaY,
    text: `Distance = ${formatLength(length, units)}, Angle in XY Plane = ${formatAngle(angle)}, Delta X = ${formatLength(deltaX, units)}, Delta Y = ${formatLength(deltaY, units)}`,
  };
}
