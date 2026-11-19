import { outlineCopy, copy } from './copy.js';
import {
  type Connector,
  type DiagramDocument,
  type Page,
  type Shape,
  byId,
  findShape,
  groupOf,
  layersTopFirst,
  pagesInOrder,
  readingOrder,
  shapeLabel,
  shownConnectors,
  visibleShapes,
} from './document.js';
import { unionBox, boxOf } from './geometry.js';
import { type RoutedConnector } from './router.js';

export type OutlineKind = 'page' | 'layer' | 'shape' | 'group' | 'connector';

export interface OutlineItem {
  id: string;
  kind: OutlineKind;
  text: string;
  /** The page this item belongs to, so Enter can open it. */
  page: string;
  /** The shape an Enter should select, for shape items. */
  shape?: string;
  children: OutlineItem[];
  expandable: boolean;
}

export function connectorName(page: Page, connector: Connector, blocked: boolean): string {
  const from = findShape(page, connector.from.shape);
  const to = findShape(page, connector.to.shape);
  const source = from ? shapeLabel(from) : '';
  const target = to ? shapeLabel(to) : '';
  return blocked ? copy.blockedConnectorName(source, target) : copy.connectorName(source, target);
}

/** Connectors under a layer are ordered by source reading order, then target, then id. */
function connectorsOfLayer(page: Page, layerId: string): Connector[] {
  const order = new Map(readingOrder(visibleShapes(page)).map((s, i) => [s.id, i]));
  return shownConnectors(page)
    .filter((c) => c.layer === layerId)
    .sort(
      (a, b) =>
        (order.get(a.from.shape) ?? 0) - (order.get(b.from.shape) ?? 0) ||
        (order.get(a.to.shape) ?? 0) - (order.get(b.to.shape) ?? 0) ||
        byId(a.id, b.id),
    );
}

function shapeItemText(page: Page, shape: Shape): string {
  const shown = shownConnectors(page);
  const order = new Map(readingOrder(visibleShapes(page)).map((s, i) => [s.id, i]));
  const collect = (ids: readonly string[]): string[] =>
    [...new Set(ids)]
      .map((id) => findShape(page, id))
      .filter((s): s is Shape => s !== undefined)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map(shapeLabel);
  const targets = collect(shown.filter((c) => c.from.shape === shape.id).map((c) => c.to.shape));
  const sources = collect(shown.filter((c) => c.to.shape === shape.id).map((c) => c.from.shape));
  return outlineCopy.shape(shapeLabel(shape), shape.kind, targets, sources);
}

/**
 * The Diagram outline tree: pages, then layers, then shapes and groups, then the members
 * of each group, with connector items under their layer after its shapes and groups.
 */
export function buildOutline(
  doc: DiagramDocument,
  routed: Map<string, Map<string, RoutedConnector>>,
): OutlineItem[] {
  return pagesInOrder(doc).map((page) => {
    const shown = shownConnectors(page);
    const layers = layersTopFirst(page).filter((layer) => layer.visible);
    const children: OutlineItem[] = layers.map((layer) => {
      const layerShapes = page.shapes.filter((s) => s.layer === layer.id);
      const ungrouped = layerShapes.filter((s) => s.group === null);
      const groupIds = [...new Set(layerShapes.map((s) => s.group).filter((g): g is string => g !== null))];
      const entries: { x: number; y: number; key: string; item: OutlineItem }[] = [];
      for (const shape of ungrouped) {
        entries.push({
          x: shape.x,
          y: shape.y,
          key: shape.id,
          item: {
            id: `shape-${shape.id}`,
            kind: 'shape',
            text: shapeItemText(page, shape),
            page: page.id,
            shape: shape.id,
            children: [],
            expandable: false,
          },
        });
      }
      for (const groupId of groupIds) {
        const group = groupOf(page, groupId);
        const members = (group?.members ?? [])
          .map((id) => findShape(page, id))
          .filter((s): s is Shape => s !== undefined);
        if (members.length === 0) continue;
        const box = unionBox(members.map(boxOf));
        entries.push({
          x: box.x,
          y: box.y,
          key: groupId,
          item: {
            id: `group-${groupId}`,
            kind: 'group',
            text: outlineCopy.group(members.length),
            page: page.id,
            children: readingOrder(members).map((member) => ({
              id: `shape-${member.id}`,
              kind: 'shape' as const,
              text: shapeItemText(page, member),
              page: page.id,
              shape: member.id,
              children: [],
              expandable: false,
            })),
            expandable: true,
          },
        });
      }
      entries.sort((a, b) => a.y - b.y || a.x - b.x || byId(a.key, b.key));
      const connectorItems = connectorsOfLayer(page, layer.id).map((connector) => ({
        id: `connector-${connector.id}`,
        kind: 'connector' as const,
        text: connectorName(page, connector, routed.get(page.id)?.get(connector.id)?.blocked === true),
        page: page.id,
        children: [],
        expandable: false,
      }));
      const items = [...entries.map((e) => e.item), ...connectorItems];
      return {
        id: `layer-${layer.id}`,
        kind: 'layer' as const,
        text: outlineCopy.layer(layer.name, layer.locked, layerShapes.length),
        page: page.id,
        children: items,
        expandable: items.length > 0,
      };
    });
    return {
      id: `page-${page.id}`,
      kind: 'page' as const,
      text: outlineCopy.page(page.name, visibleShapes(page).length, shown.length),
      page: page.id,
      children,
      expandable: children.length > 0,
    };
  });
}
