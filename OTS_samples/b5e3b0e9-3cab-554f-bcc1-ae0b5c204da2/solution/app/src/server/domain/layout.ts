import { member, parseJsonWithLines, type JsonNode } from "./json-lines.ts";
import type { Layout, LayoutNode, NodeKind } from "../../shared/layout.ts";

export { BUILT_IN_LAYOUTS } from "../../shared/layout.ts";
export type { Layout } from "../../shared/layout.ts";

type LayoutCheck = { ok: true; layout: Layout } | { ok: false; lines: string[] };

const NODE_KINDS: readonly string[] = ["threshold", "holding", "junction", "stand"];

const syntaxLine = (line: number): string => `Line ${line}: this is not valid JSON.`;

/**
 * Judges a layout file by its content alone. Every problem is listed with the 1-based line of the offending key,
 * in the order of the lines of the file.
 */
export function checkLayoutFile(bytes: Buffer): LayoutCheck {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, lines: [syntaxLine(1)] };
  }
  const parsed = parseJsonWithLines(text);
  if (!parsed.ok) return { ok: false, lines: [syntaxLine(parsed.line)] };
  const root = parsed.root;
  const shape = readLayout(root);
  if (!shape.ok) return { ok: false, lines: [syntaxLine(shape.line)] };
  const problems = findProblems(root, shape.layout);
  if (problems.length > 0) {
    const ordered = problems.map((problem, order) => ({ ...problem, order })).sort((a, b) => a.line - b.line || a.order - b.order);
    return { ok: false, lines: ordered.map((problem) => `Line ${problem.line}: ${problem.message}`) };
  }
  return { ok: true, layout: shape.layout };
}

type Shape = { ok: true; layout: Layout } | { ok: false; line: number };

class ShapeFault extends Error {
  readonly line: number;
  constructor(line: number) {
    super("shape");
    this.line = line;
  }
}

/** Reads the five top-level keys into a typed layout; a wrong shape reports the line of the offending value. */
function readLayout(root: JsonNode): Shape {
  try {
    if (root.kind !== "object") throw new ShapeFault(1);
    const field = (node: JsonNode, key: string): JsonNode => {
      const found = member(node, key);
      if (!found) throw new ShapeFault(node.line);
      return found.value;
    };
    const text = (node: JsonNode, key: string): string => {
      const value = field(node, key);
      if (value.kind !== "string") throw new ShapeFault(value.line);
      return value.value;
    };
    const num = (node: JsonNode, key: string): number => {
      const value = field(node, key);
      if (value.kind !== "number") throw new ShapeFault(value.line);
      return value.value;
    };
    const list = (node: JsonNode, key: string): JsonNode[] => {
      const value = field(node, key);
      if (value.kind !== "array") throw new ShapeFault(value.line);
      return value.items;
    };
    const objects = (node: JsonNode, key: string): JsonNode[] =>
      list(node, key).map((element) => {
        if (element.kind !== "object") throw new ShapeFault(element.line);
        return element;
      });
    const runways = objects(root, "runways").map((runway) => ({
      id: text(runway, "id"),
      lengthM: num(runway, "lengthM"),
      thresholds: objects(runway, "thresholds").map((threshold) => ({
        id: text(threshold, "id"),
        node: text(threshold, "node"),
        heading: num(threshold, "heading"),
      })),
    }));
    const nodes = objects(root, "nodes").map((node): LayoutNode => {
      const kind = text(node, "kind");
      if (!NODE_KINDS.includes(kind)) throw new ShapeFault(field(node, "kind").line);
      const serves = member(node, "serves");
      if (serves && serves.value.kind !== "string") throw new ShapeFault(serves.value.line);
      return {
        id: text(node, "id"),
        kind: kind as NodeKind,
        x: num(node, "x"),
        y: num(node, "y"),
        ...(serves && serves.value.kind === "string" ? { serves: serves.value.value } : {}),
      };
    });
    const segments = objects(root, "segments").map((segment) => ({
      id: text(segment, "id"),
      from: text(segment, "from"),
      to: text(segment, "to"),
      lengthM: num(segment, "lengthM"),
      speedMps: num(segment, "speedMps"),
      taxiway: text(segment, "taxiway"),
    }));
    return { ok: true, layout: { name: text(root, "name"), code: text(root, "code"), runways, nodes, segments } };
  } catch (fault) {
    if (fault instanceof ShapeFault) return { ok: false, line: fault.line };
    throw fault;
  }
}

interface Problem {
  line: number;
  message: string;
}

function findProblems(root: JsonNode, layout: Layout): Problem[] {
  const problems: Problem[] = [];
  const nodeIds = new Set<string>();
  const thresholdIds = new Set(layout.runways.flatMap((runway) => runway.thresholds.map((t) => t.id)));
  const itemsOf = (key: string): JsonNode[] => {
    const found = member(root, key);
    return found && found.value.kind === "array" ? found.value.items : [];
  };
  const keyLine = (node: JsonNode | undefined, key: string): number => (node ? (member(node, key)?.keyLine ?? node.line) : 1);

  const nodeItems = itemsOf("nodes");
  layout.nodes.forEach((node, index) => {
    const source = nodeItems[index];
    if (nodeIds.has(node.id)) problems.push({ line: keyLine(source, "id"), message: `node ${node.id} is listed more than once.` });
    nodeIds.add(node.id);
    if (node.kind === "holding" && node.serves !== undefined && node.serves !== "cross" && !thresholdIds.has(node.serves)) {
      problems.push({ line: keyLine(source, "serves"), message: `holding point ${node.id} serves unknown runway ${node.serves}.` });
    }
  });
  const segmentItems = itemsOf("segments");
  layout.segments.forEach((segment, index) => {
    const source = segmentItems[index];
    if (!nodeIds.has(segment.from)) {
      problems.push({ line: keyLine(source, "from"), message: `segment ${segment.id} starts at unknown node ${segment.from}.` });
    }
    if (!nodeIds.has(segment.to)) {
      problems.push({ line: keyLine(source, "to"), message: `segment ${segment.id} ends at unknown node ${segment.to}.` });
    }
    if (!(segment.lengthM > 0)) {
      problems.push({ line: keyLine(source, "lengthM"), message: `segment ${segment.id} must be longer than 0 m.` });
    }
  });
  return problems;
}
