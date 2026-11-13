import { test } from "node:test";
import assert from "node:assert/strict";
import { edgePath, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "../src/shared/pipeline-layout.ts";

test("layers follow stages and needs, rows follow stage then config order", () => {
  const placed = layoutGraph([
    { name: "compile", stageIndex: 0, needs: [] },
    { name: "lint", stageIndex: 0, needs: [] },
    { name: "unit", stageIndex: 1, needs: ["compile"] },
    { name: "e2e", stageIndex: 1, needs: [] },
    { name: "pack", stageIndex: 2, needs: ["unit", "lint"] },
  ]);
  const summary = Object.fromEntries(placed.map((p) => [p.name, [p.layer, p.row, p.x, p.y]]));
  assert.deepEqual(summary, {
    compile: [0, 0, 40, 40],
    lint: [0, 1, 40, 136],
    unit: [1, 0, 280, 40],
    e2e: [1, 1, 280, 136],
    pack: [2, 0, 520, 40],
  });
});

test("a need pushes a job past its stage, and rows order by stage index inside a layer", () => {
  const placed = layoutGraph([
    { name: "bld [a]", stageIndex: 0, needs: [] },
    { name: "bld [b]", stageIndex: 0, needs: [] },
    { name: "chk", stageIndex: 1, needs: ["bld [a]", "bld [b]"] },
    { name: "late", stageIndex: 2, needs: [] },
    { name: "final", stageIndex: 1, needs: ["chk"] },
  ]);
  const at = (name: string) => placed.find((p) => p.name === name);
  assert.deepEqual([at("chk")?.layer, at("chk")?.row], [1, 0]);
  assert.deepEqual([at("final")?.layer, at("final")?.row], [2, 0]);
  assert.deepEqual([at("late")?.layer, at("late")?.row], [2, 1]);
});

test("an early-stage job needing a later layer still lands after its need", () => {
  const placed = layoutGraph([
    { name: "a", stageIndex: 0, needs: [] },
    { name: "b", stageIndex: 0, needs: ["a"] },
    { name: "c", stageIndex: 0, needs: ["b"] },
  ]);
  assert.deepEqual(placed.map((p) => p.layer), [0, 1, 2]);
});

test("needs naming no job in the list are ignored, and an empty needs list counts as none", () => {
  const placed = layoutGraph([{ name: "a", stageIndex: 1, needs: ["ghost"] }, { name: "b", stageIndex: 2, needs: [] }]);
  assert.deepEqual(placed.map((p) => p.layer), [1, 2]);
});

test("edge path is the published curve", () => {
  assert.equal(NODE_WIDTH, 200);
  assert.equal(NODE_HEIGHT, 64);
  assert.equal(edgePath({ x: 40, y: 40 }, { x: 280, y: 136 }), "M 240 72 C 260 72 260 168 280 168");
});
