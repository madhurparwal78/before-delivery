import { describe, expect, it } from "vitest";
import type { DesignObject, Vec3, Workplane } from "../../shared/types";
import { CAMERA_MAX_DISTANCE, CAMERA_MIN_DISTANCE, UNDO_DEPTH } from "../../shared/limits";
import { START_CAMERA, orbit, publishedAzimuth, publishedDistance, zoom } from "./camera";
import {
  EMPTY_HISTORY, GROUND, addShape, align, faceOrigin, groupDraft, groupFromBounds, groupProblem, inCreationOrder, membersOf,
  moveVector, parseSize, record, release, removeObjects, replaceWithGroup, resize, setMode, setWorkplane, snapFace, stepBack,
  stepForward, tabTarget, toggledMode, translate, trimmed, turn, ungroup, workplaneOnFace, worldBounds, wholeDegrees,
  type Design, type Entry, type MoveKey,
} from "./model";

function shape(id: string, extra: Partial<DesignObject> = {}): DesignObject {
  return { id, kind: "box", mode: "solid", x: 0, y: 0, z: 10, w: 20, d: 20, h: 20, rotationZ: 0, color: "#2f6fed", children: [], ...extra };
}

const design = (objects: DesignObject[], workplane: Workplane = GROUND): Design => ({ objects, workplane });
const at = (object: DesignObject | undefined): Vec3 => [object?.x ?? NaN, object?.y ?? NaN, object?.z ?? NaN];
const onlyObject = (d: Design | null): DesignObject => {
  const first = d?.objects[0];
  if (!first) throw new Error("expected an object");
  return first;
};

describe("nudges follow the workplane's own axes", () => {
  const faces: { name: string; normal: Vec3; moves: Record<MoveKey, Vec3> }[] = [
    { name: "top", normal: [0, 0, 1], moves: { right: [1, 0, 0], left: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], raise: [0, 0, 1], lower: [0, 0, -1] } },
    { name: "bottom", normal: [0, 0, -1], moves: { right: [1, 0, 0], left: [-1, 0, 0], up: [0, -1, 0], down: [0, 1, 0], raise: [0, 0, -1], lower: [0, 0, 1] } },
    { name: "front", normal: [0, -1, 0], moves: { right: [1, 0, 0], left: [-1, 0, 0], up: [0, 0, 1], down: [0, 0, -1], raise: [0, -1, 0], lower: [0, 1, 0] } },
    { name: "back", normal: [0, 1, 0], moves: { right: [-1, 0, 0], left: [1, 0, 0], up: [0, 0, 1], down: [0, 0, -1], raise: [0, 1, 0], lower: [0, -1, 0] } },
    { name: "right", normal: [1, 0, 0], moves: { right: [0, 1, 0], left: [0, -1, 0], up: [0, 0, 1], down: [0, 0, -1], raise: [1, 0, 0], lower: [-1, 0, 0] } },
    { name: "left", normal: [-1, 0, 0], moves: { right: [0, -1, 0], left: [0, 1, 0], up: [0, 0, 1], down: [0, 0, -1], raise: [-1, 0, 0], lower: [1, 0, 0] } },
  ];
  for (const face of faces) {
    it(`on the ${face.name} face`, () => {
      const workplane: Workplane = { origin: [0, 0, 0], normal: face.normal };
      for (const [key, expected] of Object.entries(face.moves)) {
        const one = moveVector(workplane, key as MoveKey, 1);
        const ten = moveVector(workplane, key as MoveKey, 10);
        expect(one.map((v) => v + 0)).toEqual(expected.map((v) => v + 0));
        expect(ten.map((v) => v + 0)).toEqual(expected.map((v) => v * 10 + 0));
      }
    });
  }

  it("moves a group's members with it so they ungroup at the moved place", () => {
    const group = shape("g", { kind: "group", children: [shape("a"), shape("b", { x: 30 })] });
    const moved = onlyObject(translate(design([group]), ["g"], [1, 0, 0]));
    expect(moved.x).toBe(1);
    expect(moved.children.map((c) => c.x)).toEqual([1, 31]);
  });

  it("keeps positions to 0.01 mm", () => {
    const moved = onlyObject(translate(design([shape("a", { x: 0.1 })]), ["a"], [0.2, 0, 0]));
    expect(moved.x).toBe(0.3);
  });

  it("changes nothing when nothing is selected", () => {
    const d = design([shape("a")]);
    expect(translate(d, [], [1, 0, 0])).toBe(d);
  });
});

describe("rotation steps", () => {
  it("turns each object about its own centre and folds to 0..359", () => {
    let d = design([shape("a"), shape("b", { x: 50, rotationZ: 350 })]);
    d = turn(d, ["a", "b"], 15);
    expect(d.objects.map((o) => o.rotationZ)).toEqual([15, 5]);
    d = turn(d, ["a"], -1);
    expect(d.objects.map((o) => o.rotationZ)).toEqual([14, 5]);
    d = turn(d, ["a"], -15);
    expect(d.objects.map((o) => o.rotationZ)).toEqual([359, 5]);
    expect(d.objects.map((o) => o.x)).toEqual([0, 50]);
    expect(d.objects.map((o) => o.w)).toEqual([20, 20]);
  });

  it("publishes whole degrees", () => {
    expect([wholeDegrees(0), wholeDegrees(15), wholeDegrees(359.6), wholeDegrees(-1)]).toEqual([0, 15, 0, 359]);
  });
});

describe("undo history", () => {
  const entry = (n: number): Entry => ({ design: design([shape(`s${n}`)]), selected: [] });

  it("keeps only the last 100 steps", () => {
    let history = EMPTY_HISTORY;
    for (let n = 0; n < UNDO_DEPTH + 5; n++) history = record(history, entry(n));
    expect(history.past).toHaveLength(UNDO_DEPTH);
    expect(history.past[0]?.design.objects[0]?.id).toBe("s5");
  });

  it("steps back and forward one entry at a time and drops redo on a new edit", () => {
    let history = record(record(EMPTY_HISTORY, entry(1)), entry(2));
    const back = stepBack(history, entry(3));
    expect(back?.restore.design.objects[0]?.id).toBe("s2");
    history = back?.history ?? EMPTY_HISTORY;
    expect(history.future).toHaveLength(1);
    const forward = stepForward(history, entry(2));
    expect(forward?.restore.design.objects[0]?.id).toBe("s3");
    expect(record(history, entry(9)).future).toEqual([]);
  });

  it("has nothing to undo or redo at the ends", () => {
    expect(stepBack(EMPTY_HISTORY, entry(0))).toBeNull();
    expect(stepForward(EMPTY_HISTORY, entry(0))).toBeNull();
  });
});

describe("align", () => {
  it("puts centres at the middle of the selection's bounding box and leaves other axes", () => {
    const d = design([shape("a"), shape("b", { x: 30, y: 10 })]);
    const aligned = align(d, ["a", "b"], "x");
    expect(aligned.objects.map(at)).toEqual([[15, 0, 10], [15, 10, 10]]);
  });

  it("aligns three shapes on Z using each shape's own height", () => {
    const d = design([shape("a"), shape("b", { x: 30, z: 40 }), shape("c", { x: 60, z: 70, h: 40 })]);
    const aligned = align(d, ["a", "b", "c"], "z");
    expect(aligned.objects.map((o) => o.z)).toEqual([45, 45, 45]);
    expect(aligned.objects.map((o) => o.x)).toEqual([0, 30, 60]);
  });

  it("takes a turned shape's world bounds into account", () => {
    const d = design([shape("a", { w: 40, d: 10, rotationZ: 90 }), shape("b", { x: 100 })]);
    expect(worldBounds(onlyObject(d)).min[1]).toBeCloseTo(-20);
    expect(align(d, ["a", "b"], "y").objects.map((o) => o.y)).toEqual([0, 0]);
  });

  it("changes nothing when already aligned", () => {
    const d = design([shape("a"), shape("b", { x: 30 })]);
    expect(align(d, ["a", "b"], "y")).toBe(d);
  });
});

describe("size rules", () => {
  it("accepts 0.1 to 1000 inclusive and rounds to one decimal", () => {
    expect([parseSize("0.1"), parseSize("1000"), parseSize("12.34"), parseSize(" 7 ")]).toEqual([0.1, 1000, 12.3, 7]);
    expect([parseSize("0"), parseSize("0.09"), parseSize("1000.1"), parseSize("abc"), parseSize("")]).toEqual([null, null, null, null, null]);
  });

  it("keeps a cylinder's width and depth equal", () => {
    const d = design([shape("c", { kind: "cylinder" })]);
    expect(resize(d, ["c"], "d", 12).objects.map((o) => [o.w, o.d, o.h])).toEqual([[12, 12, 20]]);
    expect(resize(d, ["c"], "w", 8).objects.map((o) => [o.w, o.d, o.h])).toEqual([[8, 8, 20]]);
    expect(resize(d, ["c"], "h", 35).objects.map((o) => [o.w, o.d, o.h])).toEqual([[20, 20, 35]]);
  });

  it("keeps a sphere's three sizes equal and its bottom fixed", () => {
    const next = onlyObject(resize(design([shape("s", { kind: "sphere" })]), ["s"], "w", 30));
    expect([next.w, next.d, next.h, next.z]).toEqual([30, 30, 30, 15]);
  });

  it("keeps the bottom-centre point fixed when the height changes", () => {
    const next = onlyObject(resize(design([shape("c", { kind: "cylinder", z: 10 })]), ["c"], "h", 35));
    expect(next.z).toBe(17.5);
  });

  it("leaves groups and unchanged sizes alone", () => {
    const d = design([shape("g", { kind: "group" }), shape("a")]);
    expect(resize(d, ["g"], "w", 5)).toBe(d);
    expect(resize(d, ["a"], "w", 20)).toBe(d);
  });
});

describe("adding shapes", () => {
  it("rests the new shape on the default workplane", () => {
    expect(at(onlyObject(addShape(design([]), "box", "a", "#35b558")))).toEqual([0, 0, 10]);
  });

  it("rests it against the picked face on every workplane", () => {
    const centres: [Vec3, Vec3, Vec3][] = [
      [[0, 0, 20], [0, 0, 1], [0, 0, 30]],
      [[0, 0, 0], [0, 0, -1], [0, 0, -10]],
      [[0, -10, 10], [0, -1, 0], [0, -20, 10]],
      [[0, 10, 10], [0, 1, 0], [0, 20, 10]],
      [[10, 0, 10], [1, 0, 0], [20, 0, 10]],
      [[-10, 0, 10], [-1, 0, 0], [-20, 0, 10]],
    ];
    for (const [origin, normal, centre] of centres) {
      const added = addShape(design([], { origin, normal }), "cylinder", "n", "#7a3fd1");
      expect(at(onlyObject(added))).toEqual(centre);
      expect(onlyObject(added)).toMatchObject({ w: 20, d: 20, h: 20, rotationZ: 0, mode: "solid" });
    }
  });

  it("refuses the 201st object", () => {
    const full = design(Array.from({ length: 200 }, (_, i) => shape(`o${i}`)));
    expect(addShape(full, "box", "extra", "#fff")).toBeNull();
  });
});

describe("modes and deleting", () => {
  it("toggles a selection: all holes become solid, anything else becomes hole", () => {
    expect(toggledMode([shape("a"), shape("b")])).toBe("hole");
    expect(toggledMode([shape("a", { mode: "hole" }), shape("b")])).toBe("hole");
    expect(toggledMode([shape("a", { mode: "hole" })])).toBe("solid");
  });

  it("turns a whole group into a hole", () => {
    const group = shape("g", { kind: "group", children: [shape("a")] });
    const holed = onlyObject(setMode(design([group]), ["g"], "hole"));
    expect(holed.mode).toBe("hole");
    expect(holed.children[0]?.mode).toBe("solid");
  });

  it("removes only the listed objects", () => {
    const d = design([shape("a"), shape("b")]);
    expect(removeObjects(d, ["a"]).objects.map((o) => o.id)).toEqual(["b"]);
    expect(removeObjects(d, [])).toBe(d);
  });
});

describe("groups", () => {
  it("needs two members and one solid", () => {
    expect(groupProblem([shape("a")])).toBe("select-two");
    expect(groupProblem([shape("a", { mode: "hole" }), shape("b", { mode: "hole" })])).toBe("needs-solid");
    expect(groupProblem([shape("a"), shape("b", { mode: "hole" })])).toBeNull();
  });

  it("builds a group at the centre of its result's bounding box, where the first member stood", () => {
    const a = shape("a");
    const b = shape("b", { x: 30, mode: "hole" });
    const c = shape("c", { x: 80 });
    const d = design([a, b, c]);
    const members = membersOf(d, ["a", "b"]);
    const group = groupFromBounds(groupDraft(members, "g"), { min: [-10, -10, 0], max: [40.04, 10, 20] });
    expect([group.x, group.y, group.z, group.w, group.d, group.h]).toEqual([15.02, 0, 10, 50, 20, 20]);
    expect(group).toMatchObject({ kind: "group", mode: "solid", rotationZ: 0 });
    expect(replaceWithGroup(d, members, group).objects.map((o) => o.id)).toEqual(["g", "c"]);
  });

  it("ungroups to the members as they were, moved by any move the group received", () => {
    const group = shape("g", { kind: "group", children: [shape("a"), shape("b", { x: 30, mode: "hole" })] });
    const moved = translate(design([shape("z", { x: -50 }), group]), ["g"], [5, -2, 0]);
    const result = ungroup(moved, ["g"]);
    expect(result?.design.objects.map((o) => o.id)).toEqual(["z", "a", "b"]);
    expect(result?.design.objects.map(at)).toEqual([[-50, 0, 10], [5, -2, 10], [35, -2, 10]]);
    expect(result?.design.objects.map((o) => o.mode)).toEqual(["solid", "solid", "hole"]);
  });

  it("turns the members about the group's centre by the group's rotation on ungroup", () => {
    const group = shape("g", { kind: "group", rotationZ: 90, children: [shape("a", { x: -10 }), shape("b", { x: 10, rotationZ: 15 })] });
    const members = release(group);
    expect(members.map((m) => [m.x, m.y])).toEqual([[0, -10], [0, 10]]);
    expect(members.map((m) => m.rotationZ)).toEqual([90, 105]);
  });

  it("carries a nested group's own members along when its parent turns", () => {
    const inner = shape("i", { kind: "group", x: 10, rotationZ: 30, children: [shape("p", { x: 5 }), shape("q", { x: 15 })] });
    const outer = shape("o", { kind: "group", rotationZ: 90, children: [inner] });
    const [turned] = release(outer);
    expect(turned).toMatchObject({ x: 0, y: 10, rotationZ: 120 });
    expect(turned?.children.map((c) => [c.x, c.y])).toEqual([[-5, 10], [5, 10]]);
  });

  it("returns null when no listed object is a group", () => {
    expect(ungroup(design([shape("a")]), ["a"])).toBeNull();
  });
});

describe("selection order", () => {
  const d = design([shape("a"), shape("b"), shape("c")]);

  it("keeps creation order and drops missing ids", () => {
    expect(inCreationOrder(d, ["c", "a", "gone"])).toEqual(["a", "c"]);
  });

  it("Tab and Shift+Tab walk creation order and leave at either end", () => {
    expect(tabTarget(d, [], 1)).toBe("a");
    expect(tabTarget(d, ["a"], 1)).toBe("b");
    expect(tabTarget(d, ["b"], -1)).toBe("a");
    expect(tabTarget(d, ["c"], 1)).toBeNull();
    expect(tabTarget(d, ["a"], -1)).toBeNull();
    expect(tabTarget(d, [], -1)).toBeNull();
    expect(tabTarget(design([]), [], 1)).toBeNull();
  });
});

describe("workplane faces", () => {
  it("snaps a direction to the nearest axis, ties going to +Z, -Z, +X, -X, +Y, -Y", () => {
    expect(snapFace([0.1, 0.2, 0.9]).name).toBe("top");
    expect(snapFace([0, -1, 0.1]).name).toBe("front");
    expect(snapFace([1, 0, 1]).name).toBe("top");
    expect(snapFace([1, 0, -1]).name).toBe("bottom");
    expect(snapFace([1, 1, 0]).name).toBe("right");
    expect(snapFace([-1, 1, 0]).name).toBe("left");
    expect(snapFace([0, 1, 1]).name).toBe("top");
    expect(snapFace([-1, -1, 0]).name).toBe("left");
    expect(snapFace([0, 1, 0]).name).toBe("back");
    expect(snapFace([0, 0, 0]).name).toBe("top");
  });

  it("puts the origin at the centre of the bounding-box side facing the normal", () => {
    const box = shape("a");
    expect(faceOrigin(box, [0, 0, 1])).toEqual([0, 0, 20]);
    expect(faceOrigin(box, [0, 0, -1])).toEqual([0, 0, 0]);
    expect(faceOrigin(box, [1, 0, 0])).toEqual([10, 0, 10]);
    expect(faceOrigin(box, [-1, 0, 0])).toEqual([-10, 0, 10]);
    expect(faceOrigin(box, [0, 1, 0])).toEqual([0, 10, 10]);
    expect(faceOrigin(box, [0, -1, 0])).toEqual([0, -10, 10]);
  });

  it("uses the turned shape's world bounding box", () => {
    expect(faceOrigin(shape("a", { w: 40, d: 10, rotationZ: 90 }), [1, 0, 0])).toEqual([5, 0, 10]);
    expect(faceOrigin(shape("a", { kind: "cylinder", w: 20, d: 20, rotationZ: 33 }), [0, 1, 0])).toEqual([0, 10, 10]);
  });

  it("picks the workplane for a clicked face and ignores no-op changes", () => {
    const wp = workplaneOnFace(shape("a", { x: 5 }), [0.9, 0.1, 0]);
    expect(wp).toEqual({ origin: [15, 0, 10], normal: [1, 0, 0] });
    const d = design([]);
    expect(setWorkplane(d, wp).workplane).toEqual(wp);
    expect(setWorkplane(d, GROUND)).toBe(d);
  });
});

describe("number text", () => {
  it("trims trailing zeros", () => {
    expect([trimmed(10, 2), trimmed(17.5, 2), trimmed(0.1 + 0.2, 2), trimmed(-0, 2)]).toEqual(["10", "17.5", "0.3", "0"]);
  });
});

describe("camera", () => {
  it("starts at azimuth 45 and distance 200.0", () => {
    expect(publishedAzimuth(START_CAMERA)).toBe(45);
    expect(publishedDistance(START_CAMERA)).toBe("200.0");
  });

  it("turns one degree per two pixels of horizontal drag", () => {
    expect(publishedAzimuth(orbit(START_CAMERA, 60, 0))).toBe(15);
    expect(publishedAzimuth(orbit(START_CAMERA, -60, 0))).toBe(75);
    expect(publishedAzimuth(orbit(START_CAMERA, 200, 0))).toBe(305);
  });

  it("keeps the distance between 20 and 2000 and allows both ends", () => {
    expect(zoom(START_CAMERA, 1e-9).distance).toBe(CAMERA_MIN_DISTANCE);
    expect(zoom(START_CAMERA, 1e9).distance).toBe(CAMERA_MAX_DISTANCE);
    expect(zoom(START_CAMERA, 0.5).distance).toBe(100);
  });

  it("limits the tilt", () => {
    expect(orbit(START_CAMERA, 0, 1e6).elevation).toBe(85);
    expect(orbit(START_CAMERA, 0, -1e6).elevation).toBe(5);
  });
});

describe("translate keeps move vectors exact", () => {
  it("applies a workplane move to the selection", () => {
    const moved = translate(design([shape("a")]), ["a"], moveVector({ origin: [0, 0, 0], normal: [1, 0, 0] }, "raise", 10));
    expect(at(moved.objects[0])).toEqual([10, 0, 10]);
  });
});
