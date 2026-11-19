import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "../../../third_party/manifold/manifold.js";
import type { DesignObject, ObjectKind, ObjectMode } from "../../shared/types";
import { buildDesign, summarise } from "./build";
import { resolveDesignMesh, resolveObjectMesh } from "./csg";
import { meshBounds, meshVolume, primitiveMesh } from "./mesh";
import type { MeshData } from "./types";

async function loadManifold() {
  const api = await Module();
  api.setup();
  return api;
}

function shape(id: string, kind: ObjectKind = "box", mode: ObjectMode = "solid", fields: Partial<DesignObject> = {}): DesignObject {
  return { id, kind, mode, x: 0, y: 0, z: 10, w: 20, d: 20, h: 20, rotationZ: 0, color: "#35b558", children: [], ...fields };
}

/** How many triangles share each undirected edge, keyed by the coordinates of its ends. */
function edgeCounts(mesh: MeshData): Map<string, number> {
  const key = (i: number) => `${mesh.positions[i * 3]},${mesh.positions[i * 3 + 1]},${mesh.positions[i * 3 + 2]}`;
  const counts = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(mesh.indices[t + e] ?? 0);
      const b = key(mesh.indices[t + ((e + 1) % 3)] ?? 0);
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }
  }
  return counts;
}

function isClosed(mesh: MeshData): boolean {
  const counts = edgeCounts(mesh);
  return counts.size > 0 && [...counts.values()].every((n) => n === 2);
}

let api: ManifoldToplevel;
beforeAll(async () => {
  api = await loadManifold();
});

const gear = () => shape("gear", "group", "solid", {
  w: 40, d: 40, h: 20,
  children: [shape("box", "box", "solid", { w: 40, d: 40 }), shape("hole", "cylinder", "hole", { w: 16, d: 16 })],
});

describe("primitive meshes", () => {
  it("has the exact volume of a box, cylinder and sphere", () => {
    expect(meshVolume(primitiveMesh(shape("b", "box", "solid", { w: 30, d: 20, h: 10 })))).toBeCloseTo(6000, 2);
    expect(meshVolume(primitiveMesh(shape("c", "cylinder", "solid", { w: 10, d: 10, h: 20 })))).toBeCloseTo(Math.PI * 25 * 20, 2);
    expect(meshVolume(primitiveMesh(shape("s", "sphere")))).toBeCloseTo((4 / 3) * Math.PI * 1000, 2);
  });

  it("scales a cylinder radially and a sphere uniformly, never the height", () => {
    const cylinder = meshBounds(primitiveMesh(shape("c", "cylinder", "solid", { z: 0, h: 20 })).positions);
    expect(cylinder.min[2]).toBe(-10);
    expect(cylinder.max[2]).toBe(10);
    expect(cylinder.max[0]).toBeGreaterThan(10);
    expect(cylinder.max[0]).toBeLessThan(10.02);
  });

  it("uses 64 segments and 32 rings", () => {
    expect(primitiveMesh(shape("c", "cylinder")).indices.length / 3).toBe(256);
    expect(primitiveMesh(shape("s", "sphere")).positions.length / 3).toBe(2 + 31 * 64);
  });

  it("turns about the vertical axis through its own centre", () => {
    const rotated = primitiveMesh(shape("b", "box", "solid", { x: 5, y: 5, w: 40, d: 10, rotationZ: 90 }));
    const { min, max } = meshBounds(rotated.positions);
    expect(max[0] - min[0]).toBeCloseTo(10, 4);
    expect(max[1] - min[1]).toBeCloseTo(40, 4);
    expect((max[0] + min[0]) / 2).toBeCloseTo(5, 4);
    expect(meshVolume(rotated)).toBeCloseTo(8000, 2);
  });

  it("is closed", () => {
    for (const kind of ["box", "cylinder", "sphere"] as const) expect(isClosed(primitiveMesh(shape("p", kind)))).toBe(true);
  });
});

describe("groups", () => {
  it("subtracts a hole fully inside a box (6429)", () => {
    const group = shape("g", "group", "solid", {
      children: [shape("b"), shape("h", "cylinder", "hole", { w: 10, d: 10 })],
    });
    const result = resolveObjectMesh(api, group);
    expect(Math.round(result?.volume ?? 0)).toBe(6429);
    expect(isClosed(result ?? { positions: new Float32Array(), indices: new Uint32Array() })).toBe(true);
  });

  it("gives the gear box volume 27979 and a 40 x 40 x 20 bounding box", () => {
    const result = resolveObjectMesh(api, gear());
    expect(Math.round(result?.volume ?? 0)).toBe(27979);
    expect(result?.bounds.max[0]).toBe(20);
    expect(result?.bounds.min[2]).toBe(0);
    expect(result?.bounds.max[2]).toBe(20);
  });

  it("leaves the solids alone when a hole touches none", () => {
    const solid = shape("b");
    const alone = resolveObjectMesh(api, shape("g1", "group", "solid", { children: [solid, shape("b2", "box", "solid", { x: 30 })] }));
    const holed = resolveObjectMesh(api, shape("g2", "group", "solid", {
      children: [solid, shape("b2", "box", "solid", { x: 30 }), shape("h", "box", "hole", { x: 100, y: 3, w: 20, d: 2, h: 2 })],
    }));
    expect(holed?.triangleCount).toBe(alone?.triangleCount);
    expect(holed?.bounds).toEqual(alone?.bounds);
  });

  it("rotates the result about the group's own centre", () => {
    const group = shape("g", "group", "solid", {
      x: 100, y: 50, z: 10, w: 40, d: 10, h: 20, rotationZ: 90,
      children: [shape("b", "box", "solid", { x: 100, y: 50, w: 40, d: 10 })],
    });
    const result = resolveObjectMesh(api, group);
    expect(result?.bounds.max[0]).toBeCloseTo(105, 3);
    expect(result?.bounds.min[1]).toBeCloseTo(30, 3);
    expect(result?.volume).toBeCloseTo(8000, 1);
  });

  it("resolves nested groups with world coordinates", () => {
    const inner = shape("inner", "group", "solid", { children: [shape("a"), shape("h", "cylinder", "hole", { w: 10, d: 10 })] });
    const outer = shape("outer", "group", "solid", { children: [inner, shape("c", "box", "solid", { x: 40 })] });
    expect(Math.round(resolveObjectMesh(api, outer)?.volume ?? 0)).toBe(6429 + 8000);
  });

  it("gives null for a group with no solid", () => {
    expect(resolveObjectMesh(api, shape("g", "group", "solid", { children: [shape("h", "box", "hole")] }))).toBeNull();
  });

  it("is deterministic", () => {
    const first = resolveObjectMesh(api, gear());
    const second = resolveObjectMesh(api, gear());
    expect(Array.from(second?.positions ?? [])).toEqual(Array.from(first?.positions ?? []));
    expect(Array.from(second?.indices ?? [])).toEqual(Array.from(first?.indices ?? []));
  });
});

describe("designs", () => {
  it("unions top-level solids and subtracts top-level holes", () => {
    const design = [shape("a"), shape("b", "box", "solid", { x: 30 }), shape("h", "box", "hole", { x: 30, w: 10, d: 10, h: 10 })];
    expect(Math.round(resolveDesignMesh(api, design)?.volume ?? 0)).toBe(16000 - 1000);
  });

  it("summarises an empty and a non-empty design", () => {
    expect(summarise(api, [])).toEqual({ empty: true, size: null });
    expect(summarise(api, [shape("h", "box", "hole")])).toEqual({ empty: true, size: null });
    expect(summarise(api, [gear()])).toEqual({ empty: false, size: [40, 40, 20] });
  });
});

describe("files", () => {
  const objects = [gear()];

  it("writes a closed binary STL with the Quarkyard header", () => {
    const file = buildDesign(api, objects, "stl", "mm");
    const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    expect(new TextDecoder().decode(file.bytes.slice(0, 9))).toBe("Quarkyard");
    const count = view.getUint32(80, true);
    expect(file.bytes.length).toBe(84 + 50 * count);
    expect(file.triangleCount).toBe(count);
    const positions: number[] = [];
    const indices: number[] = [];
    for (let t = 0; t < count; t++) {
      for (let v = 0; v < 3; v++) {
        for (let axis = 0; axis < 3; axis++) positions.push(view.getFloat32(84 + 50 * t + 12 + v * 12 + axis * 4, true));
        indices.push(indices.length);
      }
    }
    const mesh = { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
    expect(isClosed(mesh)).toBe(true);
    expect(file.bbox).toEqual({ x: 40, y: 40, z: 20 });
  });

  it("divides every coordinate by 25.4 for inches", () => {
    const mm = buildDesign(api, objects, "stl", "mm");
    const inches = buildDesign(api, objects, "stl", "in");
    const a = new DataView(mm.bytes.buffer, mm.bytes.byteOffset, mm.bytes.byteLength);
    const b = new DataView(inches.bytes.buffer, inches.bytes.byteOffset, inches.bytes.byteLength);
    for (let t = 0; t < (mm.triangleCount ?? 0); t++) {
      for (let k = 0; k < 9; k++) {
        const at = 84 + 50 * t + 12 + k * 4;
        const expected = a.getFloat32(at, true) / 25.4;
        expect(Math.abs(b.getFloat32(at, true) - expected)).toBeLessThanOrEqual(Math.abs(expected) * 4e-5 + 1e-9);
      }
    }
    expect(inches.bbox?.x).toBeCloseTo(40 / 25.4, 5);
  });

  it("writes one closed OBJ object with shared vertices", () => {
    const file = buildDesign(api, objects, "obj", "mm");
    const lines = new TextDecoder().decode(file.bytes).split("\n");
    expect(lines.filter((line) => line.startsWith("o ")).length).toBe(1);
    const vertices = lines.filter((line) => line.startsWith("v ")).map((line) => line.split(" ").slice(1).join(","));
    expect(new Set(vertices).size).toBe(vertices.length);
    const faces = lines.filter((line) => line.startsWith("f ")).map((line) => line.split(" ").slice(1).map(Number));
    expect(faces.length).toBe(file.triangleCount);
    expect(Math.max(...faces.flat())).toBe(vertices.length);
    expect(Math.min(...faces.flat())).toBe(1);
    const mesh = {
      positions: Float32Array.from(vertices.flatMap((v) => v.split(",").map(Number))),
      indices: Uint32Array.from(faces.flat().map((n) => n - 1)),
    };
    expect(isClosed(mesh)).toBe(true);
  });

  it("writes the top view as an SVG whose size is the bounding box", () => {
    const mm = new TextDecoder().decode(buildDesign(api, objects, "svg", "mm").bytes);
    expect(mm).toContain('width="40mm" height="40mm"');
    expect(mm).toContain('viewBox="0 0 40 40"');
    expect(mm.match(/M/g)?.length).toBe(2);
    const inches = buildDesign(api, objects, "svg", "in");
    expect(new TextDecoder().decode(inches.bytes)).toContain('width="1.5748in"');
    expect(inches.triangleCount).toBeNull();
    expect(inches.bbox?.z).toBeCloseTo(20 / 25.4, 5);
  });

  it("refuses a design without a solid", () => {
    expect(() => buildDesign(api, [shape("h", "box", "hole")], "stl", "mm")).toThrow();
  });
});
