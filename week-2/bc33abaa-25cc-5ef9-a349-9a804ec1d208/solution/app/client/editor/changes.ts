// The reduced-motion change list and the rewind announcement (Feedback states › Editor and timeline).
import type { Op } from "../../shared/api-types.js";
import { clockTime } from "../../shared/format.js";
import { OVERRIDE_FIELDS, namedNode, REST_STATE, type Graph, type Layer, type SceneNode } from "../../shared/graph.js";
import type { OpLog } from "./oplog.js";

const NODE_FIELDS = ["name", "parent", "position", "rotation", "scale", "visible"] as const;
const LAYER_FIELDS = ["type", "color", "roughness", "metalness"] as const;
const TRIGGER_ORDER = { hover: 0, click: 1, scroll: 2 } as const;
/** Scene-level items (states, transitions, camera views) come after every node. */
const SCENE = "scene";

const byCodePoint = (a: string, b: string) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
};

function number(n: number): string {
  const r = Number(n.toFixed(4));
  return String(r === 0 ? 0 : r);
}

type Value = string | number | boolean | number[] | null;

function show(value: Value): string {
  if (value === null) return "none";
  if (Array.isArray(value)) return `[${value.map(number).join(", ")}]`;
  if (typeof value === "number") return number(value);
  return String(value);
}

interface Item { key: string; group: string; order: (string | number)[]; label: (g: Graph, prev: Graph) => string; value: (g: Graph) => Value }

const node = (g: Graph, id: string) => g.nodes.find((n) => n.id === id);
const nameIn = (g: Graph, prev: Graph, id: string) => node(g, id)?.name ?? node(prev, id)?.name ?? id;
const stateName = (g: Graph, prev: Graph, id: string) => g.states.find((s) => s.id === id)?.name ?? prev.states.find((s) => s.id === id)?.name ?? id;

function nodeField(n: SceneNode, field: (typeof NODE_FIELDS)[number], g: Graph): Value {
  if (field === "parent") return n.parentId ? node(g, n.parentId)?.name ?? null : null;
  return n[field];
}

/** Every property that can change, keyed so the same property lines up across two graphs. */
function items(a: Graph, b: Graph): Item[] {
  const list: Item[] = [];
  const nodeIds = [...new Set([...a.nodes, ...b.nodes].map((n) => n.id))].sort(byCodePoint);
  for (const id of nodeIds) {
    const presence: Item = { key: `node:${id}`, group: id, order: [0], label: (g, p) => `${nameIn(g, p, id)} node`, value: (g) => (node(g, id) ? "present" : null) };
    list.push(presence);
    NODE_FIELDS.forEach((field, i) => list.push({
      key: `node:${id}:${field}`, group: id, order: [1, i], label: (g, p) => `${nameIn(g, p, id)} ${field}`,
      value: (g) => { const n = node(g, id); return n ? nodeField(n, field, g) : null; },
    }));
    const layerIds = [...new Set([a, b].flatMap((g) => node(g, id)?.materialLayers.map((l) => l.id) ?? []))];
    for (const layerId of layerIds) {
      const layer = (g: Graph): Layer | undefined => node(g, id)?.materialLayers.find((l) => l.id === layerId);
      const position = (g: Graph, p: Graph) => {
        const index = node(g, id)?.materialLayers.findIndex((l) => l.id === layerId) ?? -1;
        return index >= 0 ? index + 1 : (node(p, id)?.materialLayers.findIndex((l) => l.id === layerId) ?? 0) + 1;
      };
      LAYER_FIELDS.forEach((field, i) => list.push({
        key: `node:${id}:layer:${layerId}:${field}`, group: id, order: [2, Math.max(position(b, a), 0), i],
        label: (g, p) => `${nameIn(g, p, id)} layer ${position(g, p)} ${field}`, value: (g) => layer(g)?.[field] ?? null,
      }));
    }
    const stateIds = [...new Set([a, b].flatMap((g) => g.states.filter((s) => s.overrides.some((o) => o.nodeId === id)).map((s) => s.id)))];
    for (const stateId of stateIds) {
      OVERRIDE_FIELDS.forEach((field, i) => list.push({
        key: `node:${id}:override:${stateId}:${field}`, group: id, order: [3, stateName(b, a, stateId), i],
        label: (g, p) => `${nameIn(g, p, id)} ${field} in ${stateName(g, p, stateId)}`,
        value: (g) => g.states.find((s) => s.id === stateId)?.overrides.find((o) => o.nodeId === id && o.field === field)?.value ?? null,
      }));
    }
  }
  const sceneOrder = (rank: number, ...rest: (string | number)[]) => [rank, ...rest];
  for (const stateId of [...new Set([a, b].flatMap((g) => g.states.map((s) => s.id)))].filter((s) => s !== REST_STATE)) {
    list.push({ key: `state:${stateId}`, group: SCENE, order: sceneOrder(0, stateName(b, a, stateId)),
      label: (g, p) => `Scene graph state ${stateName(g, p, stateId)}`, value: (g) => (g.states.some((s) => s.id === stateId) ? "present" : null) });
  }
  for (const key of [...new Set([a, b].flatMap((g) => g.transitions.map((t) => `${t.from}|${t.trigger}`)))]) {
    const [from, trigger] = key.split("|");
    const rank = TRIGGER_ORDER[trigger === "click" || trigger === "scroll" ? trigger : "hover"];
    list.push({ key: `transition:${key}`, group: SCENE, order: sceneOrder(1, stateName(b, a, from), rank),
      label: (g, p) => `Scene graph transition ${stateName(g, p, from)} ${trigger}`,
      value: (g) => { const t = g.transitions.find((x) => x.from === from && x.trigger === trigger); return t ? `${t.durationMs} ms` : null; } });
  }
  for (const name of [...new Set([a, b].flatMap((g) => g.cameraViews.map((v) => v.name)))]) {
    list.push({ key: `camera:${name}`, group: SCENE, order: sceneOrder(2, name),
      label: () => `Scene graph camera view ${name}`, value: (g) => (g.cameraViews.some((v) => v.name === name) ? JSON.stringify(g.cameraViews.find((v) => v.name === name)) : null) });
  }
  return list;
}

const compareOrder = (x: (string | number)[], y: (string | number)[]) => {
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const a = x[i], b = y[i];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return byCodePoint(String(a), String(b));
  }
  return 0;
};

const differs = (x: Value, y: Value) => JSON.stringify(x) !== JSON.stringify(y);

/** One line per property that differs between two playhead positions, each credited to its latest author. */
export function changeList(log: OpLog, from: number, to: number): string[] {
  if (from === to) return [];
  const prev = log.at(from).graph, next = log.at(to).graph;
  const candidates = items(prev, next).filter((item) => differs(item.value(prev), item.value(next)));
  const absent = new Set(candidates.filter((i) => i.order[0] === 0 && i.group !== SCENE).map((i) => i.group));
  const shown = candidates.filter((i) => i.group === SCENE || !absent.has(i.group) || i.order[0] === 0);
  const authors = new Map<string, string>();
  const [lo, hi] = from < to ? [from, to] : [to, from];
  for (let seq = lo + 1; seq <= hi; seq++) {
    const before = log.at(seq - 1).graph, after = log.at(seq).graph;
    const op = log.op(seq);
    if (!op) continue;
    for (const item of shown) if (differs(item.value(before), item.value(after))) authors.set(item.key, op.author.name);
  }
  return shown
    .sort((x, y) => compareOrder([x.group === SCENE ? 1 : 0, x.group, ...x.order], [y.group === SCENE ? 1 : 0, y.group, ...y.order]))
    .map((item) => {
      const oldValue = item.value(prev), newValue = item.value(next);
      const shownValue = (v: Value) => (item.key.startsWith("camera:") && v !== null ? "present" : show(v));
      return `${item.label(next, prev)}: ${shownValue(oldValue)} → ${shownValue(newValue)} by ${authors.get(item.key) ?? ""}`;
    });
}

/** "Operation N of L: <type> on <node> by <author> (<person or agent>) at <time>", or "Start of log" at 0. */
export function announcement(log: OpLog, seq: number, timeZone: string): string {
  const op: Op | undefined = log.op(seq);
  const operation = log.operation(seq);
  if (seq === 0 || !op || !operation) return "Start of log";
  const who = `${op.author.name} (${op.author.kind === "agent" ? "agent" : "person"})`;
  const when = clockTime(op.createdAt, timeZone);
  const id = namedNode(operation);
  if (id === null) return `Operation ${seq} of ${log.latestSeq}: ${op.type} by ${who} at ${when}`;
  const graph = op.type === "node.remove" ? log.at(seq - 1).graph : log.at(seq).graph;
  const name = graph.nodes.find((n) => n.id === id)?.name ?? id;
  return `Operation ${seq} of ${log.latestSeq}: ${op.type} on ${name} by ${who} at ${when}`;
}
