import { describe, expect, it } from "vitest";
import type { Block } from "../../shared/types";
import { endOfProgram, focusAfterRemoval, insertBlock, newBlock, parseCount, parseMove, pointAfterRemoval, pointIsValid, removeBlock, updateBlock } from "./program";

const repeat = (...body: Block[]): Block => ({ block: "repeat", count: 3, body });

describe("program editing", () => {
  it("inserts at a point in the program and inside a body", () => {
    const first = insertBlock([], { list: [], index: 0 }, repeat());
    const second = insertBlock(first, { list: [0], index: 0 }, { block: "addSphere" });
    expect(second).toEqual([repeat({ block: "addSphere" })]);
    expect(insertBlock(second, endOfProgram(second), { block: "addBox" }).map((b) => b.block)).toEqual(["repeat", "addBox"]);
  });

  it("removes and updates blocks by path without changing the original", () => {
    const program = [repeat({ block: "moveX", mm: 5 }, { block: "addBox" })];
    expect(removeBlock(program, [0, 0])).toEqual([repeat({ block: "addBox" })]);
    expect(updateBlock(program, [0, 0], { mm: 12 })[0]?.body?.[0]).toEqual({ block: "moveX", mm: 12 });
    expect(program[0]?.body).toHaveLength(2);
  });

  it("keeps the insertion point between the same blocks after a delete", () => {
    expect(pointAfterRemoval({ list: [], index: 3 }, [1])).toEqual({ list: [], index: 2 });
    expect(pointAfterRemoval({ list: [], index: 1 }, [1])).toEqual({ list: [], index: 1 });
    expect(pointAfterRemoval({ list: [2], index: 1 }, [0])).toEqual({ list: [1], index: 1 });
    expect(pointAfterRemoval({ list: [1], index: 1 }, [1])).toEqual({ list: [], index: 1 });
    expect(pointAfterRemoval({ list: [1], index: 2 }, [1, 0])).toEqual({ list: [1], index: 1 });
  });

  it("hands focus to the neighbour of a deleted block", () => {
    const program = [{ block: "addBox" }, repeat({ block: "moveX" }, { block: "moveY" }), { block: "addSphere" }] satisfies Block[];
    expect(focusAfterRemoval(program, [0])).toEqual([0]);
    expect(focusAfterRemoval(program, [2])).toEqual([1]);
    expect(focusAfterRemoval(program, [1, 1])).toEqual([1, 0]);
    expect(focusAfterRemoval([repeat({ block: "moveX" })], [0, 0])).toEqual([0]);
    expect(focusAfterRemoval([{ block: "addBox" }], [0])).toBeNull();
  });

  it("recognises a point that no longer names a gap", () => {
    const program = [repeat({ block: "addBox" })];
    expect(pointIsValid(program, { list: [0], index: 1 })).toBe(true);
    expect(pointIsValid(program, { list: [0], index: 2 })).toBe(false);
    expect(pointIsValid(program, { list: [1], index: 0 })).toBe(false);
  });

  it("starts palette blocks at their defaults", () => {
    expect(newBlock("repeat")).toEqual({ block: "repeat", count: 3, body: [] });
    expect(newBlock("moveZ")).toEqual({ block: "moveZ", mm: 10 });
    expect(newBlock("addBox")).toEqual({ block: "addBox" });
  });

  it("accepts counts 1 to 50 and moves -500 to 500 only", () => {
    expect([parseCount("1"), parseCount("50"), parseCount("0"), parseCount("51"), parseCount("2.5"), parseCount("")]).toEqual([1, 50, null, null, null, null]);
    expect([parseMove("-500"), parseMove("500"), parseMove("-500.5"), parseMove("7.25"), parseMove("x"), parseMove("")]).toEqual([-500, 500, null, 7.25, null, null]);
  });
});
