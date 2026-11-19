import { describe, expect, it } from "vitest";
import type { DesignObject, ObjectKind, ObjectMode } from "../../shared/types";
import { primitiveMesh } from "../geometry";
import { creaseGeometry } from "./creaseGeometry";
import { partsOf } from "./flatten";
import { circuitObjects } from "./model";
import { TOY_COLORS, displayColor, mixHex, nextShapeColor } from "./palette";

function shape(id: string, kind: ObjectKind, mode: ObjectMode, fields: Partial<DesignObject> = {}): DesignObject {
  return { id, kind, mode, x: 0, y: 0, z: 10, w: 20, d: 20, h: 20, rotationZ: 0, color: "#35b558", children: [], ...fields };
}

describe("colours", () => {
  it("cycles the toy primaries in creation order", () => {
    expect([0, 1, 2, 3, 4, 5].map(nextShapeColor)).toEqual([...TOY_COLORS, TOY_COLORS[0], TOY_COLORS[1]]);
  });

  it("keeps a valid hex colour and replaces anything else with the toy primary for its place", () => {
    expect(displayColor("#2F6FED", 0)).toBe("#2f6fed");
    expect(displayColor("#abc", 0)).toBe("#aabbcc");
    expect(displayColor("not a colour", 2)).toBe(TOY_COLORS[2]);
  });

  it("mixes towards white and black", () => {
    expect(mixHex("#102030", "#ffffff", 0)).toBe("#102030");
    expect(mixHex("#102030", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#ffffff", "#000000", 0.5)).toBe("#808080");
  });
});

describe("parts of a design", () => {
  it("dissolves a group into its members and makes every member of a hole group a hole", () => {
    const group = shape("g", "group", "hole", { children: [shape("a", "box", "solid"), shape("b", "sphere", "solid", { x: 30 })] });
    expect(partsOf([group]).map((p) => [p.kind, p.hole])).toEqual([["box", true], ["sphere", true]]);
  });

  it("turns member positions about the group's centre", () => {
    const group = shape("g", "group", "solid", { x: 0, y: 0, rotationZ: 90, children: [shape("a", "box", "solid", { x: 10 })] });
    const [part] = partsOf([group]);
    expect(part?.x).toBeCloseTo(0, 6);
    expect(part?.y).toBeCloseTo(10, 6);
    expect(part?.rotationZ).toBe(90);
  });
});

describe("render geometry", () => {
  it("keeps box edges sharp and gives a sphere smooth normals", () => {
    const box = creaseGeometry(primitiveMesh(shape("b", "box", "solid")), 5).getAttribute("normal");
    const axes = new Set<string>();
    for (let i = 0; i < box.count; i++) axes.add([box.getX(i), box.getY(i), box.getZ(i)].map((v) => v.toFixed(3)).join(","));
    expect(axes.size).toBe(6);
    const sphere = primitiveMesh(shape("s", "sphere", "solid", { z: 0 }));
    const geometry = creaseGeometry(sphere, 5);
    const normals = geometry.getAttribute("normal");
    const positions = geometry.getAttribute("position");
    let worst = 0;
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      const dot = (normals.getX(i) * positions.getX(i) + normals.getY(i) * positions.getY(i) + normals.getZ(i) * positions.getZ(i)) / length;
      worst = Math.max(worst, 1 - dot);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("lays a circuit out as a board with one block per part", () => {
    const objects = circuitObjects({
      kind: "circuit",
      components: [{ label: "BAT-1", type: "battery" }, { label: "R-1", type: "resistor" }, { label: "LED-1", type: "led" }, { label: "SW-1", type: "switch" }],
      wires: [],
    });
    expect(objects.map((o) => o.kind)).toEqual(["box", "box", "cylinder", "sphere", "box"]);
    expect(new Set(objects.map((o) => o.id)).size).toBe(5);
  });
});
