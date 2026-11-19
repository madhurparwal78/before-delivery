import { boundingBox, layoutMap } from '../shared/layout.js';
import { emptyDoc, newTopic } from '../shared/ops.js';
import { colourHex, derivedColour } from '../shared/style.js';
import { visibleTopics } from '../shared/tree.js';
import type { LayoutMode, MapDoc } from '../shared/types.js';
import { svg } from './dom.js';

export interface SampleNode {
  title: string;
  children?: SampleNode[];
}

let counter = 0;

/** Builds a working document from a plain outline, for samples and miniatures. */
export function sampleDoc(title: string, children: SampleNode[]): MapDoc {
  counter += 1;
  const doc = emptyDoc(`s${counter}-root`, title);
  let index = 0;
  const add = (parentId: string, node: SampleNode): void => {
    index += 1;
    const id = `s${counter}-${index}`;
    doc.topics[id] = newTopic(id, parentId, node.title);
    doc.topics[parentId].children.push(id);
    for (const child of node.children ?? []) add(id, child);
  };
  for (const child of children) add(doc.root, child);
  return doc;
}

/** A read-only rendering of a map, drawn by the app's own layout engine. */
export function renderMiniature(doc: MapDoc, mode: LayoutMode = 'map'): SVGElement {
  const view = { doc, collapsed: new Set<string>(), hidden: new Set<string>() };
  const layout = layoutMap(view, mode);
  const bounds = boundingBox(layout) ?? { x: 0, y: 0, w: 100, h: 100 };
  const pad = 20;
  const picture = svg('svg', {
    viewBox: `${Math.round(bounds.x - pad)} ${Math.round(bounds.y - pad)} ${Math.round(bounds.w + pad * 2)} ${Math.round(bounds.h + pad * 2)}`,
    class: 'miniature',
    'aria-hidden': 'true',
    focusable: 'false',
    preserveAspectRatio: 'xMidYMid meet',
  });
  for (const id of visibleTopics(view)) {
    const box = layout.get(id);
    const topic = doc.topics[id];
    if (!box || !topic || topic.parent_id === null) continue;
    const parent = layout.get(topic.parent_id);
    if (!parent) continue;
    picture.append(
      svg('path', {
        d: `M ${parent.x} ${parent.y} C ${(parent.x + box.x) / 2} ${parent.y}, ${(parent.x + box.x) / 2} ${box.y}, ${box.x} ${box.y}`,
        fill: 'none',
        stroke: colourHex(derivedColour(doc, id)),
        'stroke-width': 6,
        'stroke-linecap': 'round',
      }),
    );
  }
  for (const id of visibleTopics(view)) {
    const box = layout.get(id);
    if (!box) continue;
    const isRoot = id === doc.root;
    const colour = colourHex(derivedColour(doc, id));
    picture.append(
      svg('rect', {
        x: box.x - box.w / 2,
        y: box.y - box.h / 2,
        width: box.w,
        height: box.h,
        rx: isRoot ? 14 : 16,
        fill: isRoot ? colour : '#ffffff',
        stroke: colour,
        'stroke-width': 4,
      }),
    );
  }
  return picture;
}
