// The SVG canvas: step nodes on a snapping grid, ports, dashed curved
// edges, run tokens and ghost edges of older versions. Also the keyboard
// table and pointer interactions live here.

import { h } from "./runtime";
import type { VNode } from "preact";
import type { EdgeRec, StepDraft, TriggerRec } from "./runtime";
import { CANVAS_COLS, CANVAS_ROWS } from "./runtime";

export const CELL = 112;

export function stepTitle(s: { kind: string; name: string }): string {
  return s.name;
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    form: "Form", schedule: "Schedule", webhook: "Webhook", row_added: "Row added", manual: "Manual",
    set: "Set values", filter: "Filter", branch: "Branch", loop: "Loop", wait: "Wait",
    send_email: "Send email", add_row: "Add row", update_row: "Update row", call_webhook: "Call webhook",
  };
  return map[kind] ?? kind;
}

export function portsOfKind(kind: string): string[] {
  const map: Record<string, string[]> = {
    trigger: ["out"], set: ["out", "error"], filter: ["out"], branch: ["true", "false"], loop: ["each", "done"],
    wait: ["out"], send_email: ["out", "error"], add_row: ["out", "error"], update_row: ["out", "error"], call_webhook: ["out", "error"],
  };
  return map[kind] ?? ["out"];
}

export interface NodeLike { id: string; kind: string; name: string; col: number; row: number }

export function nodePos(col: number, row: number): { x: number; y: number } {
  return { x: (col - 1) * CELL + 8, y: (row - 1) * CELL + 8 };
}

// Execution order for Tab navigation and the run step list.
export function executionOrderIds(trigger: TriggerRec, steps: StepDraft[], edges: EdgeRec[]): string[] {
  const map = new Map<string, NodeLike>();
  map.set("trigger", trigger as unknown as NodeLike);
  steps.forEach((s) => map.set(s.id, s as unknown as NodeLike));
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    const node = map.get(id);
    if (!node) return;
    for (const port of portsOfKind(node.kind)) {
      edges.filter((e) => e.from === id && e.port === port).sort((a, b) => a.order - b.order).forEach((e) => visit(e.to));
    }
  };
  visit("trigger");
  steps.filter((s) => !seen.has(s.id)).forEach((s) => visit(s.id));
  return out;
}

export function Canvas(p: {
  trigger: TriggerRec;
  steps: StepDraft[];
  edges: EdgeRec[];
  statusOf?: (id: string) => string | undefined;
  reusedOf?: (id: string) => boolean | undefined;
  ghostEdges?: { edges: EdgeRec[]; version: number }[];
  tokens?: { run_id: string; version: number; step_id: string }[];
  focusId: string;
  onFocus: (id: string) => void;
  onOpen?: (id: string) => void;
  readOnly?: boolean;
  animOf?: (id: string) => string | undefined;
  freshEdgeIds?: Set<string>;
}): VNode {
  const { trigger, steps, edges } = p;
  const nodes: NodeLike[] = [trigger as unknown as NodeLike, ...steps.map((s) => s as unknown as NodeLike)];
  const w = CANVAS_COLS * CELL + 16;
  const hgt = CANVAS_ROWS * CELL + 16;

  const edgePath = (from: NodeLike, to: NodeLike) => {
    const a = nodePos(from.col, from.row);
    const b = nodePos(to.col, to.row);
    const x1 = a.x + 96, y1 = a.y + 48;
    const x2 = b.x - 8, y2 = b.y + 48;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  return h("svg", { class: "canvas-svg", viewBox: `0 0 ${w} ${hgt}`, "aria-label": "Automation canvas", role: "group" },
    // dots
    Array.from({ length: CANVAS_COLS * CANVAS_ROWS }).map((_v, i) => {
      const c = i % CANVAS_COLS, r = Math.floor(i / CANVAS_COLS);
      const pos = nodePos(c + 1, r + 1);
      return h("circle", { key: "d" + i, class: "grid-dot", cx: pos.x + 56, cy: pos.y + 56, r: 1.5 });
    }),
    // ghost edges of older versions
    (p.ghostEdges ?? []).map((g) =>
      g.edges.map((e) => {
        const from = nodes.find((n) => n.id === e.from);
        const to = nodes.find((n) => n.id === e.to);
        if (!from || !to) return null;
        return h("path", {
          key: `ghost-${g.version}-${e.id}`, class: "edge ghost-edge", d: edgePath(from, to),
          "data-ghost": "true", "data-version": String(g.version), "data-edge-id": e.id,
          "data-from": e.from, "data-port": e.port, "data-to": e.to, "data-order": String(e.order), "data-anim": "none",
        });
      })),
    // live edges
    edges.map((e) => {
      const from = nodes.find((n) => n.id === e.from);
      const to = nodes.find((n) => n.id === e.to);
      if (!from || !to) return null;
      const fresh = p.freshEdgeIds?.has(e.id);
      return h("path", {
        key: e.id, class: "edge" + (fresh ? " edge-draw" : ""), d: edgePath(from, to),
        "data-edge-id": e.id, "data-from": e.from, "data-port": e.port, "data-to": e.to,
        "data-order": String(e.order), "data-anim": fresh ? "running" : "none",
        tabIndex: -1,
      });
    }),
    // nodes
    nodes.map((n) => {
      const pos = nodePos(n.col, n.row);
      const status = p.statusOf?.(n.id);
      const reused = p.reusedOf?.(n.id);
      const anim = (status === "running" ? "running" : "none");
      return h("g", {
        key: n.id, transform: `translate(${pos.x},${pos.y})`,
        "data-step-id": n.id, "data-kind": n.kind, "data-col": String(n.col), "data-row": String(n.row),
        ...(status !== undefined ? { "data-status": status, "data-reused": reused ? "true" : "false", "data-anim": anim } : {}),
      },
        h("rect", {
          class: "node-box" + (status ? " node-" + status : "") + (p.focusId === n.id ? " node-focus" : ""),
          width: 96, height: 96, rx: 8,
        }),
        h("text", { class: "node-title", x: 48, y: 40, "text-anchor": "middle" }, n.name.length > 12 ? n.name.slice(0, 11) + "…" : n.name),
        h("text", { class: "node-kind", x: 48, y: 58, "text-anchor": "middle" }, kindLabel(n.kind)),
        status ? h("rect", { class: "node-chip chip-" + status, x: 48 - 28, y: 70, width: 56, height: 18, rx: 9 }) : null,
        status ? h("text", { class: "node-chip-text", x: 48, y: 83, "text-anchor": "middle" }, status) : null,
        h("foreignObject", { x: 88, y: 40, width: 20, height: 16 },
          h("button", {
            class: "port port-out",
            "aria-label": `Output port out of ${n.name}`,
            "data-port-of": n.id, "data-port-name": portsOfKind(n.kind)[0],
            tabIndex: -1,
          })),
        h("foreignObject", { x: -8, y: 40, width: 20, height: 16 },
          h("button", { class: "port port-in", "aria-label": `Input port of ${n.name}`, "data-port-of": n.id, tabIndex: -1 })),
        portsOfKind(n.kind).map((port, pi) =>
          h("foreignObject", { key: port, x: 88, y: 60 + pi * 14, width: 20, height: 16 },
            h("button", {
              class: "port port-out",
              "aria-label": `Output port ${port} of ${n.name}`,
              "data-port-of": n.id, "data-port-name": port,
              tabIndex: -1,
            }))),
        p.onOpen
          ? h("foreignObject", { x: 0, y: 0, width: 96, height: 96 },
              h("button", {
                class: "node-hit",
                "aria-label": n.name,
                "data-step-id": n.id,
                tabIndex: 0,
                onClick: () => p.onOpen?.(n.id),
                onFocus: () => p.onFocus(n.id),
              }))
          : null);
    }),
    // run tokens
    (p.tokens ?? []).map((t) => {
      const node = nodes.find((n) => n.id === t.step_id);
      if (!node) return null;
      const pos = nodePos(node.col, node.row);
      return h("g", {
        key: "tok-" + t.run_id, class: "run-token",
        transform: `translate(${pos.x + 44},${pos.y + 44})`,
        "data-run-token": t.run_id, "data-version": String(t.version), "data-at-step": t.step_id,
      },
        h("rect", { class: "token-box" + (t.version ? " token-old" : ""), width: 8, height: 8 }),
        t.version ? h("text", { class: "token-label", x: 14, y: 8 }, "v" + t.version) : null);
    }));
}
