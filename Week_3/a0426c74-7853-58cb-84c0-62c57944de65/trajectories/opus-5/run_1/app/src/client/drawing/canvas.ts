import { fmtStored } from '../../shared/numbers.js';
import type { Entity } from '../../shared/model.js';
import { effectiveAppearance, findLayer } from '../../shared/model.js';
import {
  type Box,
  type Vec,
  blockDrawnEntities,
  boxCentre,
  boxesMeet,
  dist,
  entityBox,
  modelBox,
  vec,
} from '../../shared/geometry.js';
import { entityDataAttributes, strokeFor } from '../../shared/render.js';
import { dimensionText } from '../../shared/dimensions.js';
import { entityShape, hatchPoints } from '../../shared/svgtext.js';
import { settings } from '../api.js';
import { applyAttributes, clear, el, reducedMotion, svg } from '../dom.js';
import { store } from '../store.js';

export interface CanvasHandles {
  root: HTMLElement;
  svgRoot: SVGSVGElement;
  viewGroup: SVGGElement;
  render(): void;
  worldAt(event: { clientX: number; clientY: number }): Vec;
  zoomAll(): void;
  panTo(box: Box, insetPx: number): void;
  setPreview(points: Vec[] | null): void;
  setWindow(box: Box | null, kind: 'window' | 'crossing' | null): void;
}

let handles: CanvasHandles | null = null;

export function canvas(): CanvasHandles {
  if (!handles) throw new Error('canvas not built');
  return handles;
}

export function buildCanvas(): CanvasHandles {
  const root = el('section', {
    class: 'drawing-pane',
    role: 'region',
    'aria-label': 'Drawing',
    tabindex: '0',
  });
  const svgRoot = svg('svg', { class: 'drawing-svg' });
  const underlayGroup = svg('g', { 'data-role': 'underlays' });
  const viewGroup = svg('g', { 'data-role': 'view' });
  const entityGroup = svg('g', { 'data-role': 'entities' });
  const overlayGroup = svg('g', { 'data-role': 'overlay' });
  const gripGroup = svg('g', { 'data-role': 'grips' });
  const presenceGroup = svg('g', { 'data-role': 'presence' });
  const pinGroup = svg('g', { 'data-role': 'pins' });
  viewGroup.append(underlayGroup, entityGroup, gripGroup, overlayGroup, presenceGroup, pinGroup);
  svgRoot.append(viewGroup);
  root.append(svgRoot);

  let preview: Vec[] | null = null;
  let windowBox: { box: Box; kind: 'window' | 'crossing' } | null = null;

  const worldAt = (event: { clientX: number; clientY: number }): Vec => {
    const rect = root.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return vec((screenX - store.view.panX) / store.view.zoom, -(screenY - store.view.panY) / store.view.zoom);
  };

  const visibleEntities = (): { id: string; entity: Entity }[] => {
    const all: { id: string; entity: Entity }[] = [];
    for (const entity of store.model.entities) {
      const layer = findLayer(store.model, entity.layer);
      if (layer && (!layer.on || layer.frozen)) continue;
      all.push({ id: store.optimistic.has(entity.handle) ? `new-${entity.handle}` : entity.handle, entity });
    }
    for (const item of store.xrefEntities()) all.push(item);
    return all;
  };

  /** Only the nearest entities within the view grown by the margin stay in the page. */
  const inPageEntities = (): { id: string; entity: Entity }[] => {
    const config = settings();
    const rect = root.getBoundingClientRect();
    const width = rect.width || 1280;
    const height = rect.height || 800;
    const margin = config.domMarginPx;
    const left = (-margin - store.view.panX) / store.view.zoom;
    const right = (width + margin - store.view.panX) / store.view.zoom;
    const top = -(-margin - store.view.panY) / store.view.zoom;
    const bottom = -(height + margin - store.view.panY) / store.view.zoom;
    const viewBox: Box = {
      minX: Math.min(left, right),
      maxX: Math.max(left, right),
      minY: Math.min(top, bottom),
      maxY: Math.max(top, bottom),
    };
    const centre = boxCentre(viewBox);
    const near: { id: string; entity: Entity; distance: number }[] = [];
    const selected: { id: string; entity: Entity }[] = [];
    for (const item of visibleEntities()) {
      const box = entityBox(store.model, item.entity);
      if (store.selection.has(item.entity.handle)) {
        selected.push(item);
        continue;
      }
      if (!boxesMeet(box, viewBox)) continue;
      near.push({ ...item, distance: dist(boxCentre(box), centre) });
    }
    near.sort((a, b) => a.distance - b.distance);
    return [...near.slice(0, config.domCeiling).map((item) => ({ id: item.id, entity: item.entity })), ...selected];
  };

  const renderEntity = (item: { id: string; entity: Entity }): SVGElement => {
    const entity = item.entity;
    const shape = entityShape(entity);
    const appearance = effectiveAppearance(store.model, entity);
    const stroke = strokeFor(appearance);
    const attributes: Record<string, string> = {
      ...entityDataAttributes(store.model, entity, item.id),
      fill: entity.type === 'hatch' ? stroke.stroke : 'none',
      stroke: stroke.stroke,
      'stroke-width': String(Math.max(stroke.width, 0.15)),
      'vector-effect': 'non-scaling-stroke',
      class: 'entity',
    };
    if (stroke.dash) attributes['stroke-dasharray'] = stroke.dash;
    if (store.selection.has(entity.handle)) attributes['aria-selected'] = 'true';
    if (entity.type === 'hatch') {
      attributes['fill-opacity'] = '0.25';
      shape.geometry.points = hatchPoints(store.model, entity);
    }
    if (entity.type === 'insert') {
      const group = svg('g', attributes);
      for (const child of blockDrawnEntities(store.model, entity)) {
        const childShape = entityShape(child);
        const childAppearance = effectiveAppearance(store.model, child, appearance);
        const childStroke = strokeFor(childAppearance);
        group.append(
          svg(childShape.tag as 'line', {
            ...childShape.geometry,
            fill: 'none',
            stroke: childStroke.stroke,
            'stroke-width': String(Math.max(childStroke.width, 0.15)),
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      }
      return group;
    }
    if (entity.type === 'dimension') {
      const group = svg('g', attributes);
      group.append(
        svg('polyline', {
          points: shape.geometry.points ?? '',
          fill: 'none',
          stroke: stroke.stroke,
          'stroke-width': '1',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      const label = svg('text', {
        x: String(entity.text_x),
        y: String(-entity.text_y),
        class: 'dimension-text',
        'font-size': String(12 / store.view.zoom),
      });
      label.textContent = dimensionText(store.model, entity);
      group.append(label);
      return group;
    }
    return svg(shape.tag as 'line', { ...attributes, ...shape.geometry });
  };

  const renderGrips = (): void => {
    clear(gripGroup);
    for (const handle of store.selection) {
      const entity = store.model.entities.find((candidate) => candidate.handle === handle);
      if (!entity) continue;
      for (const grip of gripsFor(entity)) {
        gripGroup.append(
          svg('rect', {
            'data-grip': grip.kind,
            'data-entity-id': entity.handle,
            'data-grip-index': String(grip.index),
            'data-x': fmtStored(grip.point.x),
            'data-y': fmtStored(grip.point.y),
            x: String(grip.point.x - 4 / store.view.zoom),
            y: String(-grip.point.y - 4 / store.view.zoom),
            width: String(8 / store.view.zoom),
            height: String(8 / store.view.zoom),
            class: 'grip',
          }),
        );
      }
    }
  };

  const renderPresence = (): void => {
    clear(presenceGroup);
    for (const person of store.presence) {
      if (person.username === store.username) continue;
      const size = 10 / store.view.zoom;
      const group = svg('g', {
        class: `crosshair colour-${person.colour}`,
        'data-presence': person.username,
        'data-colour': String(person.colour),
        'data-x': fmtStored(person.x),
        'data-y': fmtStored(person.y),
      });
      group.append(
        svg('line', {
          x1: String(person.x - size),
          y1: String(-person.y),
          x2: String(person.x + size),
          y2: String(-person.y),
          'vector-effect': 'non-scaling-stroke',
        }),
        svg('line', {
          x1: String(person.x),
          y1: String(-person.y - size),
          x2: String(person.x),
          y2: String(-person.y + size),
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      const label = svg('text', { x: String(person.x + size), y: String(-person.y - size), 'font-size': String(size) });
      label.textContent = person.username;
      group.append(label);
      presenceGroup.append(group);
    }
  };

  const renderPins = (): void => {
    clear(pinGroup);
    for (const issue of store.issues) {
      const size = 8 / store.view.zoom;
      pinGroup.append(
        svg('circle', {
          'data-issue-pin': issue.id,
          'data-issue-state': issue.state,
          cx: String(issue.x),
          cy: String(-issue.y),
          r: String(size),
          class: 'pin',
        }),
      );
    }
  };

  const renderUnderlays = (): void => {
    clear(underlayGroup);
    for (const underlay of store.underlays) {
      underlayGroup.append(
        svg('image', {
          'data-underlay-id': underlay.id,
          x: String(Math.min(underlay.x1, underlay.x2)),
          y: String(-Math.max(underlay.y1, underlay.y2)),
          width: String(Math.abs(underlay.x2 - underlay.x1)),
          height: String(Math.abs(underlay.y2 - underlay.y1)),
          opacity: '0.5',
        }),
      );
    }
  };

  const renderOverlay = (): void => {
    clear(overlayGroup);
    if (preview && preview.length > 1) {
      overlayGroup.append(
        svg('polyline', {
          class: 'preview',
          points: preview.map((point) => `${point.x},${-point.y}`).join(' '),
          fill: 'none',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    if (windowBox) {
      overlayGroup.append(
        svg('rect', {
          'data-window': windowBox.kind,
          x: String(windowBox.box.minX),
          y: String(-windowBox.box.maxY),
          width: String(Math.abs(windowBox.box.maxX - windowBox.box.minX)),
          height: String(Math.abs(windowBox.box.maxY - windowBox.box.minY)),
          class: 'select-window',
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
    if (store.snap.kind !== 'none') {
      const size = 6 / store.view.zoom;
      overlayGroup.append(
        svg('rect', {
          class: 'snap-marker',
          x: String(store.snap.x - size),
          y: String(-store.snap.y - size),
          width: String(size * 2),
          height: String(size * 2),
          'vector-effect': 'non-scaling-stroke',
        }),
      );
    }
  };

  const render = (): void => {
    const rect = root.getBoundingClientRect();
    svgRoot.setAttribute('width', String(rect.width || 1280));
    svgRoot.setAttribute('height', String(rect.height || 800));
    viewGroup.setAttribute('transform', `translate(${store.view.panX} ${store.view.panY}) scale(${store.view.zoom})`);
    applyAttributes(root, {
      'data-revision': String(store.revision),
      'data-pending-ops': String(store.pendingOps),
      'data-total-entities': String(store.model.entities.length + store.xrefEntities().length),
      'data-snap-kind': store.snap.kind,
      'data-snap-x': fmtStored(store.snap.x),
      'data-snap-y': fmtStored(store.snap.y),
      'data-zoom': fmtStored(store.view.zoom),
      'data-pan-x': fmtStored(store.view.panX),
      'data-pan-y': fmtStored(store.view.panY),
    });
    clear(entityGroup);
    for (const item of inPageEntities()) entityGroup.append(renderEntity(item));
    renderUnderlays();
    renderGrips();
    renderPresence();
    renderPins();
    renderOverlay();
  };

  const panTo = (box: Box, insetPx: number): void => {
    const rect = root.getBoundingClientRect();
    const width = rect.width || 1280;
    const height = rect.height || 800;
    const toScreen = (point: Vec): Vec =>
      vec(point.x * store.view.zoom + store.view.panX, -point.y * store.view.zoom + store.view.panY);
    const topLeft = toScreen(vec(box.minX, box.maxY));
    const bottomRight = toScreen(vec(box.maxX, box.minY));
    let dx = 0;
    let dy = 0;
    if (topLeft.x < insetPx) dx = insetPx - topLeft.x;
    else if (bottomRight.x > width - insetPx) dx = width - insetPx - bottomRight.x;
    if (topLeft.y < insetPx) dy = insetPx - topLeft.y;
    else if (bottomRight.y > height - insetPx) dy = height - insetPx - bottomRight.y;
    store.view.panX += dx;
    store.view.panY += dy;
    store.following = null;
    render();
  };

  /** ZOOMALL fits every visible entity with 24 px on each side. */
  const zoomAll = (): void => {
    const rect = root.getBoundingClientRect();
    const width = rect.width || 1280;
    const height = rect.height || 800;
    const entities = visibleEntities().map((item) => item.entity);
    const box = modelBox(store.model, entities);
    const from = { ...store.view };
    if (box) {
      const boxWidth = Math.max(box.maxX - box.minX, 0.001);
      const boxHeight = Math.max(box.maxY - box.minY, 0.001);
      const zoom = Math.min((width - 48) / boxWidth, (height - 48) / boxHeight);
      const centre = boxCentre(box);
      store.view = { zoom, panX: width / 2 - centre.x * zoom, panY: height / 2 + centre.y * zoom };
    }
    render();
    if (!reducedMotion()) {
      viewGroup.animate(
        [
          { transform: `translate(${from.panX}px, ${from.panY}px) scale(${from.zoom})` },
          { transform: `translate(${store.view.panX}px, ${store.view.panY}px) scale(${store.view.zoom})` },
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', id: 'zoom-all' },
      );
    }
  };

  handles = {
    root,
    svgRoot,
    viewGroup,
    render,
    worldAt,
    zoomAll,
    panTo,
    setPreview: (points) => {
      preview = points;
      renderOverlay();
    },
    setWindow: (box, kind) => {
      windowBox = box && kind ? { box, kind } : null;
      renderOverlay();
    },
  };
  return handles;
}

export interface Grip {
  kind: 'end' | 'mid' | 'centre' | 'quadrant' | 'vertex';
  point: Vec;
  index: number;
}

export function gripsFor(entity: Entity): Grip[] {
  switch (entity.type) {
    case 'line':
      return [
        { kind: 'end', point: vec(entity.x1, entity.y1), index: 0 },
        { kind: 'end', point: vec(entity.x2, entity.y2), index: 1 },
        { kind: 'mid', point: vec((entity.x1 + entity.x2) / 2, (entity.y1 + entity.y2) / 2), index: 2 },
      ];
    case 'circle':
      return [
        { kind: 'centre', point: vec(entity.cx, entity.cy), index: 0 },
        { kind: 'quadrant', point: vec(entity.cx + entity.r, entity.cy), index: 1 },
        { kind: 'quadrant', point: vec(entity.cx, entity.cy + entity.r), index: 2 },
        { kind: 'quadrant', point: vec(entity.cx - entity.r, entity.cy), index: 3 },
        { kind: 'quadrant', point: vec(entity.cx, entity.cy - entity.r), index: 4 },
      ];
    case 'arc': {
      const radians = (angle: number): number => (angle * Math.PI) / 180;
      return [
        { kind: 'centre', point: vec(entity.cx, entity.cy), index: 0 },
        {
          kind: 'end',
          point: vec(entity.cx + entity.r * Math.cos(radians(entity.start)), entity.cy + entity.r * Math.sin(radians(entity.start))),
          index: 1,
        },
        {
          kind: 'end',
          point: vec(entity.cx + entity.r * Math.cos(radians(entity.end)), entity.cy + entity.r * Math.sin(radians(entity.end))),
          index: 2,
        },
      ];
    }
    case 'pline':
      return entity.points.map(([x, y], index) => ({ kind: 'vertex' as const, point: vec(x, y), index }));
    default:
      return [];
  }
}
