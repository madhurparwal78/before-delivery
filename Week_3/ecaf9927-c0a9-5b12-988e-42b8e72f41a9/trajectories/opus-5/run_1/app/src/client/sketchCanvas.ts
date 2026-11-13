import type { Constraint, Entity, Sketch } from '../shared/api.js';
import { CONSTRAINT_LABEL_WORD } from '../shared/api.js';
import type { Tolerance } from '../shared/units.js';
import type { Ctx } from './context.js';
import { svg } from './dom.js';
import { show, type Display } from './format.js';
import { reducedMotion, RING_PX_PER_FREEDOM } from './motion.js';

export type CanvasItem = { ref: string; name: string; kind: 'origin' | 'entity' | 'point' };

/** Roving-highlight order: Origin, then each entity followed by its own points. */
export function canvasItems(sketch: Sketch): CanvasItem[] {
  const items: CanvasItem[] = [{ ref: 'origin', name: 'Origin', kind: 'origin' }];
  for (const entity of sketch.entities) {
    items.push({ ref: entity.id, name: entity.label, kind: 'entity' });
    for (const point of sketch.points) {
      if (point.ref === entity.id || point.ref.startsWith(`${entity.id}.`)) {
        items.push({ ref: point.ref, name: point.name, kind: 'point' });
      }
    }
  }
  return items;
}

type Projector = {
  toScreen: (x: number, y: number) => [number, number];
  toModel: (x: number, y: number) => [number, number];
  scale: number;
};

/** The free canvas area, so the sketch is framed between the floating panels. */
export type Viewport = { width: number; height: number; left: number; right: number; top: number; bottom: number };

function projector(sketch: Sketch, view: Viewport, zoom: number, pan: { x: number; y: number }): Projector {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const visit = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const entity of sketch.entities) {
    if (entity.type === 'line') {
      visit(entity.start.x, entity.start.y);
      visit(entity.end.x, entity.end.y);
    } else if (entity.type === 'point') visit(entity.x, entity.y);
    else {
      visit(entity.center.x - entity.radius, entity.center.y - entity.radius);
      visit(entity.center.x + entity.radius, entity.center.y + entity.radius);
    }
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const usableWidth = Math.max(160, view.width - view.left - view.right);
  const usableHeight = Math.max(160, view.height - view.top - view.bottom);
  const fit = Math.min((usableWidth - 80) / spanX, (usableHeight - 80) / spanY);
  const scale = Math.max(0.05, fit * zoom);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const originX = view.left + usableWidth / 2;
  const originY = view.top + usableHeight / 2;
  return {
    scale,
    toScreen: (x, y) => [
      originX + (x - centreX) * scale + pan.x,
      originY - (y - centreY) * scale + pan.y,
    ],
    toModel: (x, y) => [
      (x - pan.x - originX) / scale + centreX,
      (originY + pan.y - y) / scale + centreY,
    ],
  };
}

function arcPath(
  entity: Extract<Entity, { type: 'arc' }>,
  project: Projector,
): string {
  const start = (entity.start_angle_deg * Math.PI) / 180;
  const end = (entity.end_angle_deg * Math.PI) / 180;
  let sweep = (end - start) % (2 * Math.PI);
  if (sweep <= 0) sweep += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil((sweep / (2 * Math.PI)) * 96));
  const parts: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + (sweep * i) / steps;
    const [x, y] = project.toScreen(
      entity.center.x + entity.radius * Math.cos(angle),
      entity.center.y + entity.radius * Math.sin(angle),
    );
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return parts.join(' ');
}

function constraintAnchor(
  constraint: Constraint,
  sketch: Sketch,
  project: Projector,
): [number, number] {
  const positions: [number, number][] = [];
  for (const ref of constraint.refs) {
    if (ref === 'origin') {
      positions.push(project.toScreen(0, 0));
      continue;
    }
    const point = sketch.points.find((candidate) => candidate.ref === ref);
    if (point) {
      positions.push(project.toScreen(point.x, point.y));
      continue;
    }
    const entity = sketch.entities.find((candidate) => candidate.id === ref);
    if (!entity) continue;
    if (entity.type === 'line') {
      positions.push(
        project.toScreen((entity.start.x + entity.end.x) / 2, (entity.start.y + entity.end.y) / 2),
      );
    } else if (entity.type === 'point') positions.push(project.toScreen(entity.x, entity.y));
    else positions.push(project.toScreen(entity.center.x, entity.center.y + entity.radius));
  }
  if (positions.length === 0) return project.toScreen(0, 0);
  const x = positions.reduce((sum, position) => sum + position[0], 0) / positions.length;
  const y = positions.reduce((sum, position) => sum + position[1], 0) / positions.length;
  return [x, y];
}

const GLYPH_SYMBOL: Record<string, string> = {
  coincident: '\u25cf',
  horizontal: '\u2014',
  vertical: '|',
  parallel: '\u2225',
  perpendicular: '\u22a5',
  equal: '=',
  fix: '\u2715',
};

function glyphText(constraint: Constraint, display: Display): string {
  if (constraint.value_mm === undefined) {
    return GLYPH_SYMBOL[constraint.kind] ?? CONSTRAINT_LABEL_WORD[constraint.kind].slice(0, 1);
  }
  return show.dimension(
    constraint.value_mm,
    (constraint.tolerance as Tolerance | undefined) ?? null,
    display,
    false,
  );
}

export type SketchRender = {
  root: SVGSVGElement;
  items: CanvasItem[];
  scale: number;
  toModel: (x: number, y: number) => [number, number];
};

/** The sketch drawn flat on its plane: strokes, points, slack rings and constraint glyphs. */
export function renderSketchCanvas(
  ctx: Ctx,
  sketch: Sketch,
  display: Display,
  view: Viewport,
): SketchRender {
  const project = projector(sketch, view, ctx.state.zoom, ctx.state.pan);
  const items = canvasItems(sketch);
  const strokeClass = (ctx.state.slackShown ?? sketch.slack) === 0 ? 'ink-stroke' : 'slack-stroke';
  const root = svg('svg', {
    class: 'sketch-canvas',
    viewBox: `0 0 ${view.width} ${view.height}`,
    role: 'group',
    'aria-label': 'Sketch canvas',
    tabindex: '0',
  });
  const highlighted = items[ctx.state.highlight];
  if (highlighted) root.setAttribute('aria-activedescendant', `item-${cssId(highlighted.ref)}`);

  const selected = new Set(ctx.state.selection);
  const strokes = svg('g', { class: 'strokes' });
  const targets = svg('g', { class: 'targets' });

  const classesFor = (ref: string): string =>
    `${selected.has(ref) ? 'selected' : ''} ${highlighted?.ref === ref ? 'highlighted' : ''}`;

  const target = (ref: string, name: string, x: number, y: number, width: number, height: number): void => {
    const group = svg('g', {
      id: `item-${cssId(ref)}`,
      role: 'button',
      'aria-label': name,
      'aria-pressed': selected.has(ref) ? 'true' : 'false',
      tabindex: '-1',
      class: 'canvas-target',
      'data-ref': ref,
    });
    group.appendChild(
      svg('rect', { x: x - width / 2, y: y - height / 2, width, height, class: 'target-box' }),
    );
    targets.appendChild(group);
  };

  for (const entity of sketch.entities) {
    const shape = entityShape(entity, project);
    shape.setAttribute('class', `stroke ${strokeClass} ${classesFor(entity.id)}`);
    const hit = entityShape(entity, project);
    hit.setAttribute('class', 'hit');
    hit.setAttribute('data-ref', entity.id);
    strokes.appendChild(hit);
    strokes.appendChild(shape);
    const spot = representativePoint(entity, project);
    target(entity.id, entity.label, spot[0], spot[1], spot[2], spot[3]);
  }

  const [ox, oy] = project.toScreen(0, 0);
  strokes.appendChild(
    svg('circle', { cx: ox, cy: oy, r: 4, class: `origin-dot ${classesFor('origin')}` }),
  );
  target('origin', 'Origin', ox, oy, 44, 44);

  for (const point of sketch.points) {
    const [x, y] = project.toScreen(point.x, point.y);
    strokes.appendChild(
      svg('circle', { cx: x, cy: y, r: 3.5, class: `point-dot ${strokeClass} ${classesFor(point.ref)}` }),
    );
    target(point.ref, point.name, x, y, 44, 44);
  }

  root.appendChild(strokes);

  for (const point of sketch.points) {
    const [x, y] = project.toScreen(point.x, point.y);
    const previous = ctx.state.ringsFrom?.get(point.ref) ?? point.freedom;
    if (point.freedom === 0 && previous === 0) continue;
    const radius = previous * RING_PX_PER_FREEDOM;
    root.appendChild(
      svg('circle', {
        cx: x,
        cy: y,
        r: radius,
        role: 'img',
        'aria-label': `Slack ring at ${point.name}`,
        class: 'slack-ring',
        'data-ring': point.ref,
      }),
    );
  }

  const ghost = ctx.state.ghost;
  const conflictClass = (): string => {
    if (!ghost) return '';
    if (reducedMotion()) return 'conflict-steady';
    return ghost.flash ? 'conflict-flash' : '';
  };

  sketch.constraints.forEach((constraint, index) => {
    const [x, y] = constraintAnchor(constraint, sketch, project);
    const offset = 16 + (index % 4) * 15;
    const group = svg('g', {
      role: 'img',
      'aria-label': constraint.label,
      class: `glyph ${ghost?.conflictId === constraint.id ? conflictClass() : ''}`,
      'data-constraint': constraint.id,
    });
    group.appendChild(
      svg('text', { x: x + offset, y: y - offset, class: 'glyph-text' }, [
        glyphText(constraint, display),
      ]),
    );
    root.appendChild(group);
  });

  root.appendChild(targets);

  if (ghost) {
    const [gx, gy] = project.toScreen(0, 0);
    root.appendChild(
      svg(
        'g',
        {
          role: 'img',
          'aria-label': ghost.label,
          class: `glyph ghost ${conflictClass()}`,
          'data-ghost': 'true',
        },
        [svg('text', { x: gx + 40, y: gy - 40, class: 'glyph-text' }, [ghost.label])],
      ),
    );
  }
  return { root, items, scale: project.scale, toModel: project.toModel };
}

export function cssId(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9_-]/g, (character) => `_${character.charCodeAt(0)}`);
}

/** Where an entity's keyboard and pointer target sits: [x, y, width, height]. */
function representativePoint(
  entity: Entity,
  project: Projector,
): [number, number, number, number] {
  if (entity.type === 'line') {
    const [x1, y1] = project.toScreen(entity.start.x, entity.start.y);
    const [x2, y2] = project.toScreen(entity.end.x, entity.end.y);
    return [
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.max(44, Math.abs(x2 - x1)),
      Math.max(44, Math.abs(y2 - y1)),
    ];
  }
  if (entity.type === 'point') {
    const [x, y] = project.toScreen(entity.x, entity.y);
    return [x, y, 44, 44];
  }
  const angle =
    entity.type === 'arc'
      ? ((entity.start_angle_deg + arcSweepDegrees(entity) / 2) * Math.PI) / 180
      : Math.PI / 2;
  const [x, y] = project.toScreen(
    entity.center.x + entity.radius * Math.cos(angle),
    entity.center.y + entity.radius * Math.sin(angle),
  );
  return [x, y, 44, 44];
}

function arcSweepDegrees(entity: Extract<Entity, { type: 'arc' }>): number {
  const sweep = (entity.end_angle_deg - entity.start_angle_deg) % 360;
  return sweep <= 0 ? sweep + 360 : sweep;
}

function entityShape(entity: Entity, project: Projector): SVGElement {
  if (entity.type === 'line') {
    const [x1, y1] = project.toScreen(entity.start.x, entity.start.y);
    const [x2, y2] = project.toScreen(entity.end.x, entity.end.y);
    return svg('line', { x1, y1, x2, y2 });
  }
  if (entity.type === 'circle') {
    const [cx, cy] = project.toScreen(entity.center.x, entity.center.y);
    return svg('circle', { cx, cy, r: entity.radius * project.scale, fill: 'none' });
  }
  if (entity.type === 'arc') {
    return svg('path', { d: arcPath(entity, project), fill: 'none' });
  }
  const [cx, cy] = project.toScreen(entity.x, entity.y);
  return svg('circle', { cx, cy, r: 4 });
}
