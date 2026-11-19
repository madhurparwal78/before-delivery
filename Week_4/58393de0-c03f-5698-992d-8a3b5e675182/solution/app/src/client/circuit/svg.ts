import { CIRCUIT_PAGE_MM } from "../../shared/limits";
import type { CircuitComponent, SnapshotCircuit } from "../../shared/types";
import { INK, ROYAL, SLATE, partNodes, terminalDot, terminalMark, textNode, wireColour, type SvgNode } from "./drawing";
import { boardGeometry, roundedPath, slotCenter, terminalPoint, wireRoute } from "./layout";
import { normaliseCircuit, parseEnd, wireName } from "./model";
import { groupName, viewOf } from "./readouts";

const COLUMNS = 4;
const MARGIN = 14;
const DIAGRAM_TOP = 24;
const DIAGRAM_HEIGHT = 124;
const LIST_TOP = 158;
const LIST_LINE = 3.8;
const LIST_LINES = 11;
const LIST_SIZE = 3.1;

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markup(node: SvgNode): string {
  const attrs = Object.entries(node.attrs).map(([name, value]) => ` ${name}="${escapeText(String(value))}"`).join("");
  if (node.text !== undefined) return `<${node.tag}${attrs}>${escapeText(node.text)}</${node.tag}>`;
  if (!node.children || node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(markup).join("")}</${node.tag}>`;
}

function group(attrs: SvgNode["attrs"], children: SvgNode[]): SvgNode {
  return { tag: "g", attrs, children };
}

function partLines(part: CircuitComponent): string {
  return groupName(viewOf(part, null));
}

function listNodes(heading: string, lines: string[], column: number, columnWidth: number): SvgNode[] {
  const x = MARGIN + column * columnWidth;
  return [
    textNode(heading, x, LIST_TOP, LIST_SIZE + 0.4, ROYAL, 700, "start"),
    ...lines.map((text, i) => textNode(text, x, LIST_TOP + LIST_LINE * (i + 1), LIST_SIZE, INK, 400, "start")),
  ];
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The wiring diagram of a circuit as an SVG document string, `width="297mm" height="210mm"`. Pure and deterministic. */
export function circuitSvg(snapshot: SnapshotCircuit): string {
  const circuit = normaliseCircuit(snapshot);
  const board = boardGeometry(circuit.components.length, COLUMNS, 1);
  const available = CIRCUIT_PAGE_MM.width - 2 * MARGIN;
  const scale = Math.min(available / board.width, DIAGRAM_HEIGHT / board.height);
  const indexOf = new Map(circuit.components.map((c, i) => [c.label, i]));

  const wires: SvgNode[] = [];
  const marks: SvgNode[] = [];
  circuit.wires.forEach((wire, lane) => {
    const from = parseEnd(wire.from);
    const to = parseEnd(wire.to);
    const fromIndex = from ? indexOf.get(from.label) : undefined;
    const toIndex = to ? indexOf.get(to.label) : undefined;
    if (!from || !to || fromIndex === undefined || toIndex === undefined) return;
    const route = wireRoute({ index: fromIndex, sign: from.sign }, { index: toIndex, sign: to.sign }, COLUMNS, lane);
    wires.push({ tag: "path", attrs: { d: roundedPath(route), fill: "none", stroke: wireColour(lane), "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round" } });
  });
  circuit.components.forEach((_, index) => {
    for (const sign of ["+", "-"] as const) {
      const point = terminalPoint(index, COLUMNS, sign);
      marks.push(terminalDot(point.x, point.y), terminalMark(point.x, point.y, sign));
    }
  });
  const parts = circuit.components.map((part, index) => {
    const centre = slotCenter(index, COLUMNS);
    const view = viewOf(part, null);
    return group({ transform: `translate(${centre.x} ${centre.y})` }, partNodes(part, { status: view.status, glow: 0, detail: view.words }));
  });

  const wireLines = circuit.wires.map((wire, i) => `${i + 1}. ${wireName(wire)}`);
  const partColumns = chunks(circuit.components.map(partLines), LIST_LINES);
  const wireColumns = chunks(wireLines, LIST_LINES);
  const listColumns = partColumns.length + wireColumns.length;
  const columnWidth = Math.min(60, available / Math.max(1, listColumns));
  const lists = [
    ...partColumns.flatMap((lines, i) => listNodes(i === 0 ? "Parts" : "Parts (continued)", lines, i, columnWidth)),
    ...wireColumns.flatMap((lines, i) => listNodes(i === 0 ? "Wires" : "Wires (continued)", lines, partColumns.length + i, columnWidth)),
  ];

  const page: SvgNode[] = [
    { tag: "title", attrs: {}, text: "Quarkyard wiring diagram" },
    { tag: "rect", attrs: { x: 0, y: 0, width: CIRCUIT_PAGE_MM.width, height: CIRCUIT_PAGE_MM.height, fill: "#ffffff" } },
    textNode("Wiring diagram", MARGIN, 14, 7, ROYAL, 700, "start"),
    textNode(`${circuit.components.length} parts, ${circuit.wires.length} wires`, CIRCUIT_PAGE_MM.width - MARGIN, 14, 3.6, SLATE, 400, "end"),
    group({ transform: `translate(${MARGIN} ${DIAGRAM_TOP}) scale(${scale.toFixed(4)})` }, [
      { tag: "rect", attrs: { x: 0, y: 0, width: board.width, height: board.height, rx: 16, fill: "#f6f8fa", stroke: "#dadde3", "stroke-width": 2 } },
      group({}, wires),
      ...parts,
      ...marks,
    ]),
    ...lists,
  ];
  const attrs = `xmlns="http://www.w3.org/2000/svg" width="${CIRCUIT_PAGE_MM.width}mm" height="${CIRCUIT_PAGE_MM.height}mm" viewBox="0 0 ${CIRCUIT_PAGE_MM.width} ${CIRCUIT_PAGE_MM.height}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg ${attrs}>${page.map(markup).join("")}</svg>\n`;
}
