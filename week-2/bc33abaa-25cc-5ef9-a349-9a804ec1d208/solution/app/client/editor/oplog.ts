// The browser's copy of a scene's operation log: graphs at any operation number by checkpointed replay,
// so the rewind can redraw within one frame.
import type { Op } from "../../shared/api-types.js";
import { applyOperation, graphHash, parseOperation, type Graph, type Operation } from "../../shared/graph.js";

const CHECKPOINT_EVERY = 25;

export class OpLog {
  private ops: Op[] = [];
  private parsed: Operation[] = [];
  private checkpoints = new Map<number, Graph>();
  private memo = new Map<number, { graph: Graph; hash: string }>();

  constructor(private readonly base: Graph, ops: Op[]) {
    this.checkpoints.set(0, structuredClone(base));
    this.append(ops);
  }

  get latestSeq(): number { return this.ops.length; }

  op(seq: number): Op | undefined { return this.ops[seq - 1]; }
  operation(seq: number): Operation | undefined { return this.parsed[seq - 1]; }
  all(): readonly Op[] { return this.ops; }

  /** Appends operations in order; false when one is missing, so the caller reloads from the server. */
  append(incoming: Op[]): boolean {
    for (const op of [...incoming].sort((a, b) => a.seq - b.seq)) {
      if (op.seq <= this.ops.length) continue;
      if (op.seq !== this.ops.length + 1) return false;
      const operation = parseOperation({ type: op.type, payload: op.payload }, "op", {});
      if (!operation) return false;
      this.ops.push(op);
      this.parsed.push(operation);
    }
    return true;
  }

  private build(seq: number): Graph {
    let start = Math.floor(seq / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    while (!this.checkpoints.has(start)) start -= CHECKPOINT_EVERY;
    const graph = structuredClone(this.checkpoints.get(start) ?? this.base);
    for (let s = start + 1; s <= seq; s++) {
      applyOperation(graph, this.parsed[s - 1]);
      if (s % CHECKPOINT_EVERY === 0 && !this.checkpoints.has(s)) this.checkpoints.set(s, structuredClone(graph));
    }
    return graph;
  }

  /** The graph just after operation seq (0 is the scene's initial graph). Callers must not change it. */
  at(seq: number): { graph: Graph; hash: string } {
    const hit = this.memo.get(seq);
    if (hit) return hit;
    const graph = this.build(seq);
    const entry = { graph, hash: graphHash(graph) };
    if (this.memo.size > 160) this.memo.delete(this.memo.keys().next().value ?? 0);
    this.memo.set(seq, entry);
    return entry;
  }
}
