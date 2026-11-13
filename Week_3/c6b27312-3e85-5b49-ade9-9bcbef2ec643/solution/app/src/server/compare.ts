// Comparing two revisions by the material added and removed, on a 0.5 mm voxel grid aligned to the origin.
// A cell is material when its centre is inside the solid. Each (x, y) column of a stored solid is one z interval,
// so the grid is handled per column and never per cell.
import type { CompareHunk, CompareJson } from "../shared/api";
import { compareKeys } from "../shared/order";
import { buildManifest, poseOfBox, type Solid, type Value, type Vec3 } from "../shared/tine";
import { db } from "./db";
import { ApiError, notFound } from "./errors";
import type { Ctx } from "./http";
import { get, type Route } from "./route";
import { requiredObject } from "./objects";
import { loadRevision, modelOf, readablePart, revisionJson, sourceText, type RevisionRow } from "./records";
import { jsonReply, type Reply } from "./reply";
import { confirmObject } from "./storage";

const CELL = 0.5;
const CELL_VOLUME = CELL ** 3;
const MAX_CELLS = 8_000_000;

interface Grid {
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  nz: number;
}

/** How many cells have their centre at or below the height. */
const cellsBelow = (height: number): number => Math.max(0, Math.floor(height / CELL - 0.5) + 1);

/** The solid's extent in x, y and z, bosses included. */
function extent(solid: Solid): { min: Vec3; max: Vec3 } {
  const body = solid.ops[0];
  if (!body || (body.op !== "box" && body.op !== "cylinder")) return { min: [0, 0, 0], max: [0, 0, 0] };
  const [w, d] = body.op === "box" ? [body.w, body.d] : [body.dia, body.dia];
  const min: Vec3 = [-w / 2, -d / 2, 0];
  const max: Vec3 = [w / 2, d / 2, body.h];
  for (const op of solid.ops) {
    if (op.op !== "boss") continue;
    min[0] = Math.min(min[0], op.x - op.dia / 2);
    min[1] = Math.min(min[1], op.y - op.dia / 2);
    max[0] = Math.max(max[0], op.x + op.dia / 2);
    max[1] = Math.max(max[1], op.y + op.dia / 2);
    max[2] = Math.max(max[2], body.h + op.h);
  }
  return { min, max };
}

/** The z cell interval [lo, hi) of every column: body material below the body's top, bosses above it. */
function columns(solid: Solid, grid: Grid): { lo: Int32Array; hi: Int32Array } {
  const size = grid.nx * grid.ny;
  const covered = new Uint8Array(size);
  const bossTop = new Int32Array(size);
  const body = solid.ops[0];
  const bodyTop = body && (body.op === "box" || body.op === "cylinder") ? cellsBelow(body.h) : 0;

  /** Visits the columns whose centre could lie within `reach` of (x, y). */
  const visit = (x: number, y: number, reachX: number, reachY: number, inside: (cx: number, cy: number) => boolean, apply: (column: number) => void) => {
    const xFrom = Math.max(0, Math.floor((x - reachX) / CELL) - grid.x0);
    const xTo = Math.min(grid.nx - 1, Math.ceil((x + reachX) / CELL) - grid.x0);
    const yFrom = Math.max(0, Math.floor((y - reachY) / CELL) - grid.y0);
    const yTo = Math.min(grid.ny - 1, Math.ceil((y + reachY) / CELL) - grid.y0);
    for (let ix = xFrom; ix <= xTo; ix++) {
      const cx = (ix + grid.x0 + 0.5) * CELL;
      for (let iy = yFrom; iy <= yTo; iy++) {
        if (inside(cx, (iy + grid.y0 + 0.5) * CELL)) apply(ix * grid.ny + iy);
      }
    }
  };

  for (const op of solid.ops) {
    if (op.op === "box") {
      visit(0, 0, op.w / 2, op.d / 2, (cx, cy) => Math.abs(cx) <= op.w / 2 && Math.abs(cy) <= op.d / 2, (c) => (covered[c] = 1));
    } else if (op.op === "cylinder") {
      visit(0, 0, op.dia / 2, op.dia / 2, (cx, cy) => cx * cx + cy * cy <= (op.dia / 2) ** 2, (c) => (covered[c] = 1));
    } else if (op.op === "hole") {
      visit(op.x, op.y, op.dia / 2, op.dia / 2, (cx, cy) => (cx - op.x) ** 2 + (cy - op.y) ** 2 < (op.dia / 2) ** 2, (c) => (covered[c] = 0));
    } else if (op.op === "slot") {
      const reach = op.len / 2 + op.w / 2;
      const inside = (cx: number, cy: number) => {
        const along = Math.min(Math.max(cx, op.x - op.len / 2), op.x + op.len / 2);
        return (cx - along) ** 2 + (cy - op.y) ** 2 < (op.w / 2) ** 2;
      };
      visit(op.x, op.y, reach, op.w / 2, inside, (c) => (covered[c] = 0));
    }
  }
  for (const op of solid.ops) {
    if (op.op !== "boss") continue;
    const top = cellsBelow((body && (body.op === "box" || body.op === "cylinder") ? body.h : 0) + op.h);
    visit(op.x, op.y, op.dia / 2, op.dia / 2, (cx, cy) => (cx - op.x) ** 2 + (cy - op.y) ** 2 <= (op.dia / 2) ** 2, (c) => (bossTop[c] = Math.max(bossTop[c], top)));
  }

  const lo = new Int32Array(size);
  const hi = new Int32Array(size);
  for (let c = 0; c < size; c++) {
    const top = bossTop[c];
    if (covered[c]) {
      hi[c] = Math.max(bodyTop, top);
    } else if (top > bodyTop) {
      lo[c] = bodyTop;
      hi[c] = top;
    }
  }
  return { lo, hi };
}

interface Runs {
  column: number[];
  from: number[];
  to: number[];
  kind: number[];
}

const ADDED = 0;
const REMOVED = 1;

/** Groups the runs into 6-connected hunks with a union-find over runs of neighbouring columns that touch in z. */
function hunksOf(runs: Runs, grid: Grid): CompareHunk[] {
  const count = runs.column.length;
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    for (let node = i; parent[node] !== root; ) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const size = grid.nx * grid.ny;
  const first = new Int32Array(2 * size).fill(-1);
  for (let r = count - 1; r >= 0; r--) first[runs.kind[r] * size + runs.column[r]] = r;
  const touching = (r: number, column: number): void => {
    for (let s = first[runs.kind[r] * size + column]; s >= 0 && runs.column[s] === column && runs.kind[s] === runs.kind[r]; s++) {
      if (runs.from[r] < runs.to[s] && runs.from[s] < runs.to[r]) parent[find(s)] = find(r);
    }
  };
  for (let r = 0; r < count; r++) {
    const column = runs.column[r];
    const iy = column % grid.ny;
    if (iy + 1 < grid.ny) touching(r, column + 1);
    if (column + grid.ny < size) touching(r, column + grid.ny);
  }

  const groups = new Map<number, { kind: number; cells: number; min: Vec3; max: Vec3 }>();
  for (let r = 0; r < count; r++) {
    const column = runs.column[r];
    const ix = Math.floor(column / grid.ny) + grid.x0;
    const iy = (column % grid.ny) + grid.y0;
    const root = find(r);
    const group = groups.get(root) ?? { kind: runs.kind[r], cells: 0, min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 };
    group.cells += runs.to[r] - runs.from[r];
    group.min = [Math.min(group.min[0], ix), Math.min(group.min[1], iy), Math.min(group.min[2], runs.from[r])];
    group.max = [Math.max(group.max[0], ix + 1), Math.max(group.max[1], iy + 1), Math.max(group.max[2], runs.to[r])];
    groups.set(root, group);
  }
  const ordered = [...groups.values()].map((group) => ({
    kind: group.kind,
    volume: group.cells * CELL_VOLUME,
    min: group.min.map((v) => v * CELL) as Vec3,
    max: group.max.map((v) => v * CELL) as Vec3,
  }));
  // House rule H3: volume descending; removed before added; then the minimum and maximum corners ascending.
  ordered.sort((a, b) => b.volume - a.volume || b.kind - a.kind || compareKeys([...a.min, ...a.max], [...b.min, ...b.max]));
  return ordered.map((h, i) => ({
    index: i + 1,
    kind: h.kind === ADDED ? "added" : "removed",
    volume: h.volume,
    box: { min: h.min, max: h.max },
    pose: poseOfBox(h.min, h.max),
  }));
}

interface Difference {
  added: number;
  removed: number;
  unchanged: number;
  hunks: CompareHunk[];
}

async function voxelDifference(base: RevisionRow, head: RevisionRow): Promise<Difference> {
  const [baseSolid, headSolid] = (await Promise.all([base, head].map(async (r) => JSON.parse((await requiredObject(`solids/${r.geometry_digest}.json`)).toString("utf8"))))) as [Solid, Solid];
  const a = extent(baseSolid);
  const b = extent(headSolid);
  const x0 = Math.floor(Math.min(a.min[0], b.min[0]) / CELL);
  const y0 = Math.floor(Math.min(a.min[1], b.min[1]) / CELL);
  const grid: Grid = {
    x0,
    y0,
    nx: Math.ceil(Math.max(a.max[0], b.max[0]) / CELL) - x0,
    ny: Math.ceil(Math.max(a.max[1], b.max[1]) / CELL) - y0,
    nz: Math.ceil(Math.max(a.max[2], b.max[2]) / CELL),
  };
  if (grid.nx * grid.ny * grid.nz > MAX_CELLS) {
    throw new ApiError(422, "too_large_to_compare", "These revisions are too large to compare at 0.5 mm.");
  }
  const before = columns(baseSolid, grid);
  const after = columns(headSolid, grid);
  const runs: Runs = { column: [], from: [], to: [], kind: [] };
  const push = (column: number, from: number, to: number, kind: number) => {
    if (to <= from) return;
    runs.column.push(column);
    runs.from.push(from);
    runs.to.push(to);
    runs.kind.push(kind);
  };
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (let c = 0; c < grid.nx * grid.ny; c++) {
    const [baseLo, baseHi, headLo, headHi] = [before.lo[c], before.hi[c], after.lo[c], after.hi[c]];
    const shared = Math.max(0, Math.min(baseHi, headHi) - Math.max(baseLo, headLo));
    unchanged += shared;
    added += headHi - headLo - shared;
    removed += baseHi - baseLo - shared;
    if (headHi === headLo && baseHi === baseLo) continue;
    // Each side's cells outside the other's interval, split around it.
    const outside = (lo: number, hi: number, otherLo: number, otherHi: number, kind: number) => {
      if (otherHi <= otherLo || otherHi <= lo || otherLo >= hi) return push(c, lo, hi, kind);
      push(c, lo, Math.min(hi, otherLo), kind);
      push(c, Math.max(lo, otherHi), hi, kind);
    };
    outside(headLo, headHi, baseLo, baseHi, ADDED);
    outside(baseLo, baseHi, headLo, headHi, REMOVED);
  }
  return { added: added * CELL_VOLUME, removed: removed * CELL_VOLUME, unchanged: unchanged * CELL_VOLUME, hunks: hunksOf(runs, grid) };
}

async function parameterChanges(base: RevisionRow, head: RevisionRow): Promise<CompareJson["parameterChanges"]> {
  const [baseEntries, headEntries] = await Promise.all(
    [base, head].map(async (r) => buildManifest(modelOf(await sourceText(db, r.source_ref)), r.param_values)),
  );
  const earlier = new Map((baseEntries ?? []).map((entry) => [entry.name, entry.value]));
  const changes: CompareJson["parameterChanges"] = [];
  for (const entry of headEntries ?? []) {
    const before: Value | undefined = earlier.get(entry.name);
    if (entry.derived || before === undefined || before === entry.value) continue;
    changes.push({ name: entry.name, label: entry.label, base: before, head: entry.value, unit: entry.unit });
  }
  return changes;
}

async function compare(ctx: Ctx): Promise<Reply> {
  const [base, head] = await Promise.all(["base", "head"].map((name) => loadRevision(db, ctx.url.searchParams.get(name) ?? "")));
  if (!base || !head || base.part_slug !== head.part_slug) throw notFound();
  await readablePart(ctx, base.part_slug);
  const identical = base.geometry_digest === head.geometry_digest;
  let difference: Difference;
  if (identical) {
    await confirmObject(`solids/${head.geometry_digest}.json`);
    const evaluation = await db.one<{ volume: number }>("SELECT volume FROM evaluations WHERE id = $1", [head.evaluation_id]);
    difference = { added: 0, removed: 0, unchanged: evaluation.volume, hunks: [] };
  } else {
    difference = await voxelDifference(base, head);
  }
  const body: CompareJson = {
    base: revisionJson(base),
    head: revisionJson(head),
    identical,
    ...difference,
    parameterChanges: await parameterChanges(base, head),
  };
  return jsonReply(200, body);
}

export const compareRoutes: Route[] = [get("/api/compare", compare, { outage: "download" })];
