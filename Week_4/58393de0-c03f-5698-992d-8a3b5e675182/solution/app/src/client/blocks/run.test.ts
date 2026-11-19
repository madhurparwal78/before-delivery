import { describe, expect, it } from "vitest";
import type { Block } from "../../shared/types";
import { planSteps, runProgram } from "./run";

const tower: Block[] = [{ block: "repeat", count: 3, body: [{ block: "addSphere" }, { block: "moveZ", mm: 10 }] }];

describe("running a program", () => {
  it("builds the tower: 6 steps and spheres at z 0, 10 and 20", () => {
    expect(planSteps(tower).steps).toHaveLength(6);
    const { state } = runProgram(tower);
    expect(state.objects.map((o) => [o.kind, o.x, o.y, o.z, o.w])).toEqual([["sphere", 0, 0, 0, 20], ["sphere", 0, 0, 10, 20], ["sphere", 0, 0, 20, 20]]);
    expect(state.cursor).toEqual([0, 0, 30]);
  });

  it("counts Repeat as no step and takes defaults for missing values", () => {
    const { steps } = planSteps([{ block: "repeat", count: 2, body: [{ block: "moveX" }] }]);
    expect(steps).toEqual([{ block: "moveX", mm: 10 }, { block: "moveX", mm: 10 }]);
  });

  it("places each shape on the cursor after every kind of move", () => {
    const program: Block[] = [{ block: "moveX", mm: -5 }, { block: "moveY", mm: 7.5 }, { block: "addBox" }, { block: "moveZ", mm: 20 }, { block: "addCylinder" }];
    const { state } = runProgram(program);
    expect(state.objects.map((o) => [o.kind, o.x, o.y, o.z])).toEqual([["box", -5, 7.5, 0], ["cylinder", -5, 7.5, 20]]);
  });

  it("turns the most recent object into a hole, and does nothing with no object", () => {
    const { state } = runProgram([{ block: "makeHole" }, { block: "addBox" }, { block: "moveX", mm: 5 }, { block: "addSphere" }, { block: "makeHole" }]);
    expect(state.objects.map((o) => o.mode)).toEqual(["solid", "hole"]);
  });

  it("never runs the 501st step", () => {
    const moves: Block[] = Array.from({ length: 11 }, () => ({ block: "moveX", mm: 10 }));
    const { steps, truncated } = planSteps([{ block: "addBox" }, { block: "repeat", count: 50, body: moves }]);
    expect(steps).toHaveLength(500);
    expect(truncated).toBe(true);
    expect(runProgram([{ block: "addBox" }, { block: "repeat", count: 50, body: moves }]).state.objects).toHaveLength(1);
  });

  it("is not truncated at exactly 500 steps", () => {
    const plan = planSteps([{ block: "repeat", count: 50, body: Array.from({ length: 10 }, () => ({ block: "moveY" })) }]);
    expect(plan.steps).toHaveLength(500);
    expect(plan.truncated).toBe(false);
  });

  it("ends at once when nested repeats hold no action", () => {
    const empty: Block = { block: "repeat", count: 50, body: [{ block: "repeat", count: 50, body: [{ block: "repeat", count: 50, body: [] }] }] };
    expect(planSteps([empty, empty]).steps).toHaveLength(0);
  });

  it("gives equal output for equal programs", () => {
    expect(runProgram(tower)).toEqual(runProgram(structuredClone(tower)));
  });
});
