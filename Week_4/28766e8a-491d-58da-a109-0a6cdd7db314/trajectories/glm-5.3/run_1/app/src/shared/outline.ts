import type { Page, Shape, Document, Connector } from './model.js';
import { shapeLabel } from './ids.js';
import { labelAnchor, routePage } from './router.js';

export type Plural = (n: number) => string;

export function connectorName(source: string, target: string): string {
  return `Connector from ${source} to ${target}`;
}

export function blockedConnectorName(source: string, target: string): string {
  return `Connector from ${source} to ${target}, blocked`;
}

export function readingOrder(shapes: Shape[]): Shape[] {
  return [...shapes].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    return a.id < b.id ? -1 : 1;
  });
}

export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1]}`;
}

export interface OutlineItem {
  id: string;
  text: string;
  kind: 'page' | 'layer' | 'shape' | 'group' | 'connector';
  children: OutlineItem[];
  shapeId?: string;
  pageId?: string;
}

function countWord(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function buildOutline(doc: Document, blocked: Set<string>): OutlineItem[] {
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const items: OutlineItem[] = [];
  for (const page of pages) {
    const visibleLayers = page.layers.filter((l) => l.visible);
    const visibleIds = new Set(visibleLayers.map((l) => l.id));
    const shownConnectors = page.connectors.filter((c) =>
      connectorShownForOutline(c, page, visibleIds));
    const shapes = page.shapes.filter((s) => visibleIds.has(s.layer));
    const groups = page.groups.filter((g) => g.members.some((m) => {
      const s = shapes.find((sh) => sh.id === m);
      return s !== undefined;
    }));
    const pageItem: OutlineItem = {
      id: page.id,
      kind: 'page',
      pageId: page.id,
      text: `${page.name}, ${countWord(shapes.length, 'shape')}, ${countWord(shownConnectors.length, 'connector')}`,
      children: [],
    };
    for (const layer of [...visibleLayers].sort((a, b) => b.order - a.order)) {
      const layerShapes = shapes.filter((s) => s.layer === layer.id);
      const layerText = layer.locked
        ? `${layer.name} layer, locked, ${countWord(layerShapes.length, 'shape')}`
        : `${layer.name} layer, ${countWord(layerShapes.length, 'shape')}`;
      const layerItem: OutlineItem = { id: layer.id, kind: 'layer', text: layerText, children: [], pageId: page.id };

      const ordered = readingOrder(layerShapes);
      const grouped = new Set<string>();
      for (const g of groups) for (const m of g.members) grouped.add(m);

      const units: (Shape | { groupId: string; members: Shape[] })[] = [];
      for (const shape of ordered) {
        if (grouped.has(shape.id)) continue;
        units.push(shape);
      }
      const memberShapes = (members: string[]): Shape[] =>
        members.map((m) => shapes.find((s) => s.id === m)).filter((s): s is Shape => s !== undefined);
      for (const g of groups) {
        const members = memberShapes(g.members).filter((s) => s.layer === layer.id);
        if (members.length === 0) continue;
        units.push({ groupId: g.id, members });
      }

      for (const unit of sortUnits(units)) {
        if ('groupId' in unit) {
          const members = readingOrder(unit.members);
          layerItem.children.push({
            id: unit.groupId,
            kind: 'group',
            text: `Group of ${unit.members.length} shapes`,
            children: members.map((m) => shapeItem(m, page, shownConnectors, blocked)),
            pageId: page.id,
          });
        } else {
          layerItem.children.push(shapeItem(unit, page, shownConnectors, blocked));
        }
      }

      const orderedConnectors = layerConnectors(layer.id, page, shapes, shownConnectors);
      for (const c of orderedConnectors) {
        const from = shapes.find((s) => s.id === c.from.shape);
        const to = shapes.find((s) => s.id === c.to.shape);
        if (!from || !to) continue;
        layerItem.children.push({
          id: c.id,
          kind: 'connector',
          text: blocked.has(c.id)
            ? blockedConnectorName(shapeLabel(from), shapeLabel(to))
            : connectorName(shapeLabel(from), shapeLabel(to)),
          children: [],
          pageId: page.id,
        });
      }
      pageItem.children.push(layerItem);
    }
    items.push(pageItem);
  }
  return items;
}

function sortUnits(units: (Shape | { groupId: string; members: Shape[] })[]): (Shape | { groupId: string; members: Shape[] })[] {
  const key = (u: (Shape | { groupId: string; members: Shape[] })) => {
    if ('groupId' in u) {
      let minX = Infinity, minY = Infinity;
      for (const m of u.members) { minX = Math.min(minX, m.x); minY = Math.min(minY, m.y); }
      return { y: minY, x: minX, id: u.groupId };
    }
    return { y: u.y, x: u.x, id: u.id };
  };
  return [...units].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka.y !== kb.y) return ka.y - kb.y;
    if (ka.x !== kb.x) return ka.x - kb.x;
    return ka.id < kb.id ? -1 : 1;
  });
}

function connectorShownForOutline(c: Connector, page: Page, visibleIds: Set<string>): boolean {
  const own = page.layers.find((l) => l.id === c.layer);
  if (!own || !own.visible) return false;
  const from = page.shapes.find((s) => s.id === c.from.shape);
  const to = page.shapes.find((s) => s.id === c.to.shape);
  if (!from || !to) return false;
  return visibleIds.has(from.layer) && visibleIds.has(to.layer);
}

function shapeItem(shape: Shape, page: Page, shown: Connector[], blocked: Set<string>): OutlineItem {
  const visibleIds = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
  const targets: Shape[] = [];
  const sources: Shape[] = [];
  for (const c of shown) {
    if (c.from.shape === shape.id) {
      const t = page.shapes.find((s) => s.id === c.to.shape);
      if (t) targets.push(t);
    }
    if (c.to.shape === shape.id) {
      const s = page.shapes.find((s) => s.id === c.from.shape);
      if (s) sources.push(s);
    }
  }
  const targetNames = joinNames(dedupe(readingOrder(targets).map((s) => shapeLabel(s))));
  const sourceNames = joinNames(dedupe(readingOrder(sources).map((s) => shapeLabel(s))));
  const kind = shape.kind;
  let conn = '';
  if (targetNames && sourceNames) conn = `, connected to ${targetNames}, connected from ${sourceNames}`;
  else if (targetNames) conn = `, connected to ${targetNames}`;
  else if (sourceNames) conn = `, connected from ${sourceNames}`;
  else conn = ', not connected';
  void visibleIds;
  return {
    id: shape.id,
    kind: 'shape',
    text: `${shapeLabel(shape)}, ${kind}${conn}`,
    children: [],
    shapeId: shape.id,
    pageId: page.id,
  };
}

function dedupe(names: string[]): string[] {
  return [...new Set(names)];
}

function layerConnectors(layerId: string, page: Page, shapes: Shape[], shown: Connector[]): Connector[] {
  const orderIndex = new Map(readingOrder(shapes).map((s, i) => [s.id, i]));
  return shown
    .filter((c) => c.layer === layerId)
    .sort((a, b) => {
      const fa = orderIndex.get(a.from.shape) ?? -1;
      const fb = orderIndex.get(b.from.shape) ?? -1;
      if (fa !== fb) return fa - fb;
      const ta = orderIndex.get(a.to.shape) ?? -1;
      const tb = orderIndex.get(b.to.shape) ?? -1;
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : 1;
    });
}

export function blockedConnectorIds(doc: Document): Set<string> {
  const ids = new Set<string>();
  for (const page of doc.pages) {
    const { routes, shown } = routePage(page);
    for (const id of shown) {
      const r = routes.get(id);
      if (r && r.blocked) ids.add(id);
    }
  }
  return ids;
}

export function outlineLabelAnchor(route: [number, number][]): { x: number; y: number } {
  return labelAnchor(route);
}
