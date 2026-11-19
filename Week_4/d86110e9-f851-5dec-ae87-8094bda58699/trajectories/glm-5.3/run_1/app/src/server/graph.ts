// Automation graph helpers shared by the editor API, publish checks and the
// run engine: execution order, depth-first part ordering, port rules.

import { PORTS } from "./config.js";
import { ApiError, Errors } from "./errors.js";

export interface StepNode { id: string; kind: string; name: string; col: number; row: number; fields: Record<string, unknown> }
export interface TriggerNode { id: "trigger"; kind: string; name: string; col: number; row: number; fields: Record<string, unknown>; sample: unknown }
export interface EdgeLink { id: string; from: string; port: string; to: string; order: number }

export interface AutomationContent {
  trigger: TriggerNode;
  steps: StepNode[];
  edges: EdgeLink[];
}

export function stepMap(c: AutomationContent): Map<string, StepNode | TriggerNode> {
  const m = new Map<string, StepNode | TriggerNode>();
  m.set("trigger", c.trigger);
  for (const s of c.steps) m.set(s.id, s);
  return m;
}

export function edgesFrom(edges: EdgeLink[], from: string, port: string): EdgeLink[] {
  return edges.filter((e) => e.from === from && e.port === port).sort((a, b) => a.order - b.order);
}

export function incoming(edges: EdgeLink[], to: string): EdgeLink | undefined {
  return edges.find((e) => e.to === to);
}

export function portOf(kind: string, port: string): boolean {
  return (PORTS[kind] ?? []).includes(port);
}

// Would an edge from->to close a cycle (to reaches from)?
export function reaches(edges: EdgeLink[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.from === cur) stack.push(e.to);
  }
  return false;
}

export function connectedFromTrigger(c: AutomationContent): Set<string> {
  const seen = new Set<string>(["trigger"]);
  const stack: string[] = ["trigger"];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of c.edges) {
      if (e.from === cur && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

// Execution-order step ids: trigger first, then depth first with each port's
// edges in data-order, loop each-part before done, branch true before false.
// Unconnected steps come last by id number.
export function executionOrder(c: AutomationContent): string[] {
  const m = stepMap(c);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const node = m.get(id);
    if (!node) return;
    const ports = PORTS[node.kind] ?? [];
    for (const p of ports) {
      for (const e of edgesFrom(c.edges, id, p)) visit(e.to);
    }
  };
  visit("trigger");
  const rest = c.steps.filter((s) => !seen.has(s.id)).sort(byStepNumber);
  for (const s of rest) visit(s.id);
  return out;
}

export function byStepNumber(a: { id: string }, b: { id: string }): number {
  return stepNumber(a.id) - stepNumber(b.id);
}

export function stepNumber(id: string): number {
  const m = /^s(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

// The "part" of the graph downstream of a port. Used for skipping when a
// filter stops, a branch takes one port, a loop finishes, or an error edge
// replaces the out part.
export function partOf(c: AutomationContent, fromId: string, port: string): string[] {
  const m = stepMap(c);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const node = m.get(id);
    if (!node) return;
    for (const p of PORTS[node.kind] ?? []) {
      for (const e of edgesFrom(c.edges, id, p)) visit(e.to);
    }
  };
  for (const e of edgesFrom(c.edges, fromId, port)) visit(e.to);
  return out;
}

// Steps inside a loop's each part (for publish refusal and replay refusal).
export function insideLoopEach(c: AutomationContent, loopId: string): Set<string> {
  return new Set(partOf(c, loopId, "each"));
}

export function isInsideALoop(c: AutomationContent, stepId: string): string | null {
  for (const s of c.steps) {
    if (s.kind === "loop" && insideLoopEach(c, s.id).has(stepId)) return s.id;
  }
  return null;
}

export function loopStackAt(c: AutomationContent, stepId: string): string[] {
  const stack: string[] = [];
  let cur = stepId;
  while (cur !== "trigger") {
    const loop = isInsideALoop(c, cur);
    if (!loop) break;
    stack.unshift(loop);
    cur = loop;
  }
  return stack;
}
