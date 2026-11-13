import type { AppCtx } from "./ctx.js";
import { parseSource, labelOfName } from "./tine.js";
import type { Solid } from "../shared/records.js";

type Op = Record<string, unknown>;

/** A solid's inside test on the voxel grid. */
function solidCells(solid: Solid, bounds: { min: [number, number, number]; max: [number, number, number] }, cell: number): Uint8Array {
  const nx = Math.ceil((bounds.max[0] - bounds.min[0]) / cell) + 1;
  const ny = Math.ceil((bounds.max[1] - bounds.min[1]) / cell) + 1;
  const nz = Math.ceil((bounds.max[2] - bounds.min[2]) / cell) + 1;
  const body = solid.ops[0] as Op | undefined;
  const inside = new Uint8Array(nx * ny * nz);
  if (!body) return inside;
  const idx = (x: number, y: number, z: number): number => x + y * nx + z * nx * ny;
  const num = (o: Op, k: string): number => typeof o[k] === "number" ? o[k] as number : 0;
  const isInside = (x: number, y: number, z: number): boolean => {
    let insideBody = false;
    const bodyH = num(body, "h");
    if (body.op === "box") {
      const w = num(body, "w"), d = num(body, "d");
      insideBody = x >= -w / 2 && x <= w / 2 && y >= -d / 2 && y <= d / 2 && z >= 0 && z <= bodyH;
    } else {
      const dia = num(body, "dia");
      insideBody = Math.hypot(x, y) <= dia / 2 && z >= 0 && z <= bodyH;
    }
    if (!insideBody) return false;
    for (const raw of solid.ops.slice(1)) {
      const o = raw as unknown as Op;
      if (o.op === "hole") {
        if (Math.hypot(x - num(o, "x"), y - num(o, "y")) <= num(o, "dia") / 2 && z >= 0 && z <= bodyH) return false;
      } else if (o.op === "slot") {
        const cx = num(o, "x"), cy = num(o, "y"), w = num(o, "w"), len = num(o, "len");
        const lo = Math.min(cx - len / 2, cx + len / 2);
        const hi = Math.max(cx - len / 2, cx + len / 2);
        const nearSeg = x >= lo && x <= hi ? Math.abs(y - cy) <= w / 2
          : Math.hypot(x - (x < lo ? lo : hi), y - cy) <= w / 2;
        if (nearSeg && z >= 0 && z <= bodyH) return false;
      } else if (o.op === "boss") {
        if (Math.hypot(x - num(o, "x"), y - num(o, "y")) <= num(o, "dia") / 2 && z > bodyH && z <= bodyH + num(o, "h")) return true;
      }
    }
    return true;
  };
  for (let zi = 0; zi < nz; zi++) {
    const z = bounds.min[2] + (zi + 0.5) * cell;
    for (let yi = 0; yi < ny; yi++) {
      const y = bounds.min[1] + (yi + 0.5) * cell;
      for (let xi = 0; xi < nx; xi++) {
        const x = bounds.min[0] + (xi + 0.5) * cell;
        if (isInside(x, y, z)) inside[idx(xi, yi, zi)] = 1;
      }
    }
  }
  return inside;
}

export interface CompareResult {
  base: string;
  head: string;
  identical: boolean;
  added: number;
  removed: number;
  unchanged: number;
  hunks: { index: number; kind: "added" | "removed"; volume: number; box: { min: number[]; max: number[] }; pose: unknown }[];
  parameterChanges: { name: string; label: string; base: unknown; head: unknown; unit: string }[];
}

/** Compare two revisions from their stored solids, on the 0.5 mm voxel grid. */
export async function compareRevisions(
  ctx: AppCtx,
  base: Record<string, unknown>,
  head: Record<string, unknown>,
  _part: Record<string, unknown>
): Promise<CompareResult & { tooLarge?: boolean }> {
  const baseDigest = base.geometry_digest as string;
  const headDigest = head.geometry_digest as string;
  const parameterChanges = await parameterDiff(ctx, _part, base, head);
  if (baseDigest === headDigest) {
    return {
      base: base.id as string, head: head.id as string, identical: true,
      added: 0, removed: 0, unchanged: 0, hunks: [], parameterChanges,
    };
  }
  const baseSolid = await ctx.getSolid(baseDigest);
  const headSolid = await ctx.getSolid(headDigest);
  const bb = (solid: Solid): { min: [number, number, number]; max: [number, number, number] } => {
    const body = solid.ops[0] as unknown as Op | undefined;
    if (!body) return { min: [0, 0, 0], max: [0, 0, 0] };
    const num = (o: Op, k: string): number => typeof o[k] === "number" ? o[k] as number : 0;
    const w = body.op === "box" ? num(body, "w") : num(body, "dia");
    const d = body.op === "box" ? num(body, "d") : num(body, "dia");
    let top = num(body, "h");
    for (const raw of solid.ops.slice(1)) {
      const o = raw as unknown as Op;
      if (o.op === "boss") top = Math.max(top, num(body, "h") + num(o, "h"));
    }
    return { min: [-w / 2, -d / 2, 0], max: [w / 2, d / 2, top] };
  };
  const bbBase = bb(baseSolid);
  const bbHead = bb(headSolid);
  const min: [number, number, number] = [
    Math.min(bbBase.min[0], bbHead.min[0]),
    Math.min(bbBase.min[1], bbHead.min[1]),
    Math.min(bbBase.min[2], bbHead.min[2]),
  ];
  const max: [number, number, number] = [
    Math.max(bbBase.max[0], bbHead.max[0]),
    Math.max(bbBase.max[1], bbHead.max[1]),
    Math.max(bbBase.max[2], bbHead.max[2]),
  ];
  const cell = 0.5;
  const nx = Math.ceil((max[0] - min[0]) / cell);
  const ny = Math.ceil((max[1] - min[1]) / cell);
  const nz = Math.ceil((max[2] - min[2]) / cell);
  if (nx * ny * nz > 8_000_000) {
    return { base: base.id as string, head: head.id as string, identical: false, added: 0, removed: 0, unchanged: 0, hunks: [], parameterChanges, tooLarge: true };
  }
  const a = solidCells(baseSolid, { min, max }, cell);
  const b = solidCells(headSolid, { min, max }, cell);
  let added = 0, removed = 0, unchanged = 0;
  const nx2 = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny2 = Math.ceil((max[1] - min[1]) / cell) + 1;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!, bv = b[i]!;
    if (av && bv) unchanged++;
    else if (bv) added++;
    else if (av) removed++;
  }
  // Hunks: 6-connected groups of added and of removed cells.
  const hunks: CompareResult["hunks"] = [];
  for (const kind of ["removed", "added"] as const) {
    const target = kind === "added" ? b : a;
    const other = kind === "added" ? a : b;
    const visited = new Uint8Array(target.length);
    for (let i = 0; i < target.length; i++) {
      if (!target[i] || visited[i] || other[i]) continue;
      // Flood fill.
      const stack = [i];
      visited[i] = 1;
      let count = 0;
      let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      while (stack.length > 0) {
        const j = stack.pop()!;
        count++;
        const xi = j % nx2;
        const yi = Math.floor(j / nx2) % ny2;
        const zi = Math.floor(j / (nx2 * ny2));
        if (xi < minx) minx = xi;
        if (yi < miny) miny = yi;
        if (zi < minz) minz = zi;
        if (xi > maxx) maxx = xi;
        if (yi > maxy) maxy = yi;
        if (zi > maxz) maxz = zi;
        const neighbours = [j - 1, j + 1, j - nx2, j + nx2, j - nx2 * ny2, j + nx2 * ny2];
        for (const n of neighbours) {
          if (n < 0 || n >= target.length) continue;
          if (visited[n] || !target[n] || other[n]) continue;
          // 6-connected: guard wrap-around at x and y edges.
          const nxj = n % nx2, nyj = Math.floor(n / nx2) % ny2;
          if (Math.abs(nxj - xi) > 1 || Math.abs(nyj - yi) > 1) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }
      hunks.push({
        index: 0,
        kind,
        volume: count * 0.125,
        box: {
          min: [min[0] + minx * cell, min[1] + miny * cell, min[2] + minz * cell],
          max: [min[0] + (maxx + 1) * cell, min[1] + (maxy + 1) * cell, min[2] + (maxz + 1) * cell],
        },
        pose: null,
      });
    }
  }
  // Hunk order per H3: volume desc; removed before added; then min corner; then max corner.
  hunks.sort((h1, h2) => {
    if (h1.volume !== h2.volume) return h2.volume - h1.volume;
    const k1 = h1.kind === "removed" ? 0 : 1;
    const k2 = h2.kind === "removed" ? 0 : 1;
    if (k1 !== k2) return k1 - k2;
    for (let i = 0; i < 3; i++) {
      if (h1.box.min[i] !== h2.box.min[i]) return h1.box.min[i]! - h2.box.min[i]!;
    }
    for (let i = 0; i < 3; i++) {
      if (h1.box.max[i] !== h2.box.max[i]) return h1.box.max[i]! - h2.box.max[i]!;
    }
    return 0;
  });
  hunks.forEach((h, i) => { h.index = i + 1; });
  return {
    base: base.id as string, head: head.id as string, identical: false,
    added: added * 0.125, removed: removed * 0.125, unchanged: unchanged * 0.125,
    hunks, parameterChanges,
  };
}

/**
 * One parameter change line per differing parameter: each side's effective
 * value resolves absent names against the source defaults, and the label and
 * unit come from the part's manifest.
 */
async function parameterDiff(
  ctx: AppCtx,
  _part: Record<string, unknown>,
  base: Record<string, unknown>,
  head: Record<string, unknown>
): Promise<CompareResult["parameterChanges"]> {
  // The part's source from PostgreSQL gives the defaults.
  const sourceRow = await ctx.db.query(`select bytes from sources where key = $1`, [head.source_key]);
  const source = sourceRow.rows[0] ? Buffer.from(sourceRow.rows[0].bytes).toString("utf8") : "";
  const defaults: Record<string, { default: unknown; label: string; unit: string }> = {};
  if (source) {
    const parsed = parseSource(source);
    if ("parsed" in parsed) {
      for (const p of parsed.parsed.params) {
        const unit = p.kind === "length" ? "mm" : p.kind === "angle" ? "\u00b0" : "";
        defaults[p.name] = { default: p.default, label: labelOfName(p.name), unit };
      }
    }
  }
  const effective = (rev: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, meta] of Object.entries(defaults)) out[name] = meta.default;
    return { ...out, ...(rev.values as Record<string, unknown>) };
  };
  const be = effective(base);
  const he = effective(head);
  const out: CompareResult["parameterChanges"] = [];
  for (const name of Object.keys(defaults).sort()) {
    const before = be[name];
    const after = he[name];
    if (before !== after) {
      out.push({ name, label: defaults[name]!.label, base: before, head: after, unit: defaults[name]!.unit });
    }
  }
  return out;
}
