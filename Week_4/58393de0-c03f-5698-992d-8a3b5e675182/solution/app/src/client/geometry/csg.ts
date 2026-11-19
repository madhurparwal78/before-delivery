import type { Manifold, ManifoldToplevel } from "../../../third_party/manifold/manifold.js";
import type { DesignObject } from "../../shared/types";
import { meshBounds, meshVolume, primitiveMesh } from "./mesh";
import type { MeshData, SolidResult } from "./types";

/** Owns every WASM object created while one job runs, so none leaks whatever path the job takes. */
export class Arena {
  private readonly owned: { delete(): void }[] = [];

  keep<T extends { delete(): void }>(item: T): T {
    this.owned.push(item);
    return item;
  }

  release(): void {
    for (const item of this.owned.splice(0)) item.delete();
  }
}

function manifoldOf(api: ManifoldToplevel, arena: Arena, mesh: MeshData): Manifold {
  const manifold = arena.keep(api.Manifold.ofMesh(new api.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices })));
  if (manifold.status() !== "NoError") throw new Error(`A shape could not be built (${manifold.status()}).`);
  return manifold;
}

function unionOf(api: ManifoldToplevel, arena: Arena, parts: Manifold[]): Manifold | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  return arena.keep(api.Manifold.union(parts));
}

/**
 * The union of the solids minus the union of the holes, for objects whose coordinates are already in the world.
 * A hole that does not touch the solids is left out, so the result is then exactly the solids alone. Null when
 * there is no solid. A group child is resolved first and then counts as a solid or a hole by its own mode.
 */
function combine(api: ManifoldToplevel, arena: Arena, objects: DesignObject[]): Manifold | null {
  const solids: Manifold[] = [];
  const holes: Manifold[] = [];
  for (const object of objects) {
    const part = object.kind === "group" ? resolveGroup(api, arena, object) : manifoldOf(api, arena, primitiveMesh(object));
    if (part) (object.mode === "hole" ? holes : solids).push(part);
  }
  const body = unionOf(api, arena, solids);
  if (!body) return null;
  const cutter = unionOf(api, arena, holes);
  if (!cutter) return body;
  if (arena.keep(body.intersect(cutter)).isEmpty()) return body;
  return arena.keep(body.subtract(cutter));
}

/** A group's result, turned by its rotationZ about the vertical axis through its centre x,y. */
function resolveGroup(api: ManifoldToplevel, arena: Arena, group: DesignObject): Manifold | null {
  const body = combine(api, arena, group.children);
  if (!body || group.rotationZ % 360 === 0) return body;
  const moved = arena.keep(body.translate(-group.x, -group.y, 0));
  return arena.keep(arena.keep(moved.rotate(0, 0, group.rotationZ)).translate(group.x, group.y, 0));
}

/** The published numbers of a manifold: its merged mesh, bounds, double-precision volume and triangle count. */
export function solidResult(manifold: Manifold): SolidResult | null {
  if (manifold.isEmpty()) return null;
  const mesh = manifold.getMesh();
  const stride = mesh.numProp;
  const positions = new Float32Array(mesh.numVert * 3);
  for (let v = 0; v < mesh.numVert; v++) {
    positions[v * 3] = mesh.vertProperties[v * stride] ?? 0;
    positions[v * 3 + 1] = mesh.vertProperties[v * stride + 1] ?? 0;
    positions[v * 3 + 2] = mesh.vertProperties[v * stride + 2] ?? 0;
  }
  const indices = Uint32Array.from(mesh.triVerts);
  return { positions, indices, bounds: meshBounds(positions), volume: meshVolume({ positions, indices }), triangleCount: indices.length / 3 };
}

/** The final manifold of a whole design, or null when it has no solid. It is owned by `arena`. */
export function designManifold(api: ManifoldToplevel, arena: Arena, objects: DesignObject[]): Manifold | null {
  return combine(api, arena, objects);
}

/** The mesh of one top-level object. A primitive comes straight from its generator; a group is resolved. */
export function resolveObjectMesh(api: ManifoldToplevel, object: DesignObject): SolidResult | null {
  const arena = new Arena();
  try {
    const manifold = object.kind === "group" ? resolveGroup(api, arena, object) : manifoldOf(api, arena, primitiveMesh(object));
    return manifold ? solidResult(manifold) : null;
  } finally {
    arena.release();
  }
}

export function resolveDesignMesh(api: ManifoldToplevel, objects: DesignObject[]): SolidResult | null {
  const arena = new Arena();
  try {
    const manifold = designManifold(api, arena, objects);
    return manifold ? solidResult(manifold) : null;
  } finally {
    arena.release();
  }
}
