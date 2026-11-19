import { INK_HEX, cascadeStyles, colourHex } from '../shared/derive.ts';
import { BOUNDARY_PAD, LINE_HEIGHT, boundaryRect, connectorPath, layoutDoc, type Box } from '../shared/layout.ts';
import type { MapDoc, ShapeName } from '../shared/model.ts';
import { branchOf, newTopics } from '../shared/tree.ts';

const MARGIN = 24;
const WHITE = '#ffffff';
const FONT = 'Figtree, Helvetica, Arial, sans-serif';
const XML_ILLEGAL = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

/** Text safe inside XML content and double-quoted attributes: illegal characters dropped, markup characters escaped. */
const escapeXml = (text: string): string =>
  text.replace(XML_ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The branch alone, with its top topic standing as the root, so the layout engine draws it by itself. */
function branchDoc(doc: MapDoc, topicId: string): MapDoc {
  const members = branchOf(doc.topics, topicId);
  const ids = new Set(members.map((t) => t.id));
  const topics = newTopics();
  for (const topic of members) topics[topic.id] = topic.id === topicId ? { ...topic, parent_id: null, floating: false } : topic;
  return { ...doc, topics, links: doc.links.filter((l) => ids.has(l.from) && ids.has(l.to)), boundaries: doc.boundaries.filter((b) => ids.has(b.topic_id)) };
}

function outlineOf(box: Box, shape: ShapeName, colour: string): string {
  const left = box.x - box.w / 2;
  const top = box.y - box.h / 2;
  if (shape === 'underline') {
    return `<line x1="${left}" y1="${top + box.h}" x2="${left + box.w}" y2="${top + box.h}" stroke="${colour}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const radius = shape === 'rounded' ? 8 : box.h / 2;
  const fill = shape === 'pill' ? WHITE : colour;
  return `<rect x="${left}" y="${top}" width="${box.w}" height="${box.h}" rx="${radius}" fill="${fill}" stroke="${colour}" stroke-width="3"/>`;
}

function textOf(box: Box, fill: string): string {
  const first = box.y - ((box.lines.length - 1) * LINE_HEIGHT) / 2;
  const lines = box.lines.map((line, at) => `<tspan x="${box.x}" dy="${at === 0 ? 0 : LINE_HEIGHT}">${escapeXml(line)}</tspan>`).join('');
  return `<text x="${box.x}" y="${first}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="14" font-weight="600" fill="${fill}">${lines}</text>`;
}

/**
 * One standalone SVG picture of a document, laid out in the map's current layout with nothing collapsed:
 * connectors, boundaries and one group per topic. It holds no script and no reference to anything outside itself.
 */
export function renderSvg(doc: MapDoc, title: string, topicId: string | null): string {
  const shown = topicId === null ? doc : branchDoc(doc, topicId);
  const layout = layoutDoc(shown, new Set(), shown.layout);
  const styles = cascadeStyles(shown);
  const rects = shown.boundaries.flatMap((b) => {
    const rect = boundaryRect(layout, shown, b.topic_id);
    return rect ? [{ boundary: b, rect }] : [];
  });
  const xs = [...layout.boxes.values()].flatMap((box) => [box.x - box.w / 2, box.x + box.w / 2]);
  const ys = [...layout.boxes.values()].flatMap((box) => [box.y - box.h / 2, box.y + box.h / 2]);
  for (const { rect } of rects) {
    xs.push(rect.x - rect.w / 2, rect.x + rect.w / 2);
    ys.push(rect.y - rect.h / 2, rect.y + rect.h / 2);
  }
  const left = Math.min(...xs, 0) - MARGIN;
  const top = Math.min(...ys, 0) - MARGIN;
  const width = Math.max(...xs, 0) + MARGIN - left;
  const height = Math.max(...ys, 0) + MARGIN - top;

  const boundaries = rects.map(({ boundary, rect }) => {
    const label = boundary.label ? `<text x="${rect.x - rect.w / 2 + BOUNDARY_PAD}" y="${rect.y - rect.h / 2 + BOUNDARY_PAD}" dominant-baseline="central" font-family="${FONT}" font-size="12" fill="${INK_HEX}">${escapeXml(boundary.label)}</text>` : '';
    return `<g data-boundary="${escapeXml(boundary.id)}"><rect x="${rect.x - rect.w / 2}" y="${rect.y - rect.h / 2}" width="${rect.w}" height="${rect.h}" rx="${BOUNDARY_PAD}" fill="none" stroke="${INK_HEX}" stroke-width="1.5" stroke-dasharray="6 4"/>${label}</g>`;
  });
  const connectors = Object.values(shown.topics).flatMap((topic) => {
    const parent = topic.parent_id === null ? undefined : layout.boxes.get(topic.parent_id);
    const box = layout.boxes.get(topic.id);
    const style = styles.get(topic.id);
    if (!parent || !box || !style) return [];
    return [`<path data-connector="${escapeXml(topic.id)}" d="${connectorPath(shown.layout, parent, box)}" fill="none" stroke="${colourHex(style.colour)}" stroke-width="3" stroke-linecap="round"/>`];
  });
  const topics = layout.order.flatMap((id) => {
    const box = layout.boxes.get(id);
    const style = styles.get(id);
    if (!box || !style) return [];
    const colour = colourHex(style.colour);
    const attributes = `data-topic-id="${escapeXml(id)}" data-x="${box.x}" data-y="${box.y}" data-w="${box.w}" data-h="${box.h}"`;
    return [`<g ${attributes}>${outlineOf(box, style.shape, colour)}${textOf(box, style.text === 'white' ? WHITE : INK_HEX)}</g>`];
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="${WHITE}"/>`,
    ...boundaries,
    ...connectors,
    ...topics,
    '</svg>',
    '',
  ].join('\n');
}
