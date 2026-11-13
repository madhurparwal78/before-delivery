import { test } from "node:test";
import assert from "node:assert/strict";
import { isFinished, isStalled, positionAnnouncements, rebuildChain, verdictOf, type BuildResult } from "../src/server/train/plan.ts";

const sha = (letter: string): string => letter.repeat(64);

test("pipeline statuses become a verdict", () => {
  assert.equal(verdictOf("success"), "passed");
  assert.equal(verdictOf("warning"), "passed");
  assert.equal(verdictOf("failed"), "failed");
  for (const status of ["created", "pending", "running", "manual", "scheduled"]) {
    assert.equal(verdictOf(status), "unfinished");
    assert.equal(isFinished(status), false);
  }
  assert.equal(isFinished("canceled"), true);
  assert.equal(isFinished("failed"), true);
});

test("a car is stalled exactly when the job timeout has passed since its pipeline was created", () => {
  assert.equal(isStalled(1000, 3999, 3000), false);
  assert.equal(isStalled(1000, 4000, 3000), true);
});

test("only cars whose position or stored commit changed are announced, front to back", () => {
  const before = [
    { iid: 1, position: 1, sha: sha("a") },
    { iid: 2, position: 2, sha: sha("b") },
    { iid: 3, position: 3, sha: sha("c") },
  ];
  const afterRemoval = [
    { iid: 3, position: 2, sha: sha("d") },
    { iid: 1, position: 1, sha: sha("a") },
  ];
  assert.deepEqual(positionAnnouncements(before, afterRemoval), [{ iid: 3, text: `!3 is now position 2, testing ${"d".repeat(7)}` }]);
  assert.deepEqual(positionAnnouncements(before, before), []);
});

test("a car that joins is announced, and a car that only moved up keeps its stored commit in the line", () => {
  const before = [{ iid: 1, position: 1, sha: sha("a") }, { iid: 2, position: 2, sha: sha("b") }];
  const merged = [{ iid: 2, position: 1, sha: sha("b") }, { iid: 5, position: 2, sha: sha("e") }];
  assert.deepEqual(positionAnnouncements(before, merged).map((line) => line.text), [
    `!2 is now position 1, testing ${"b".repeat(7)}`,
    `!5 is now position 2, testing ${"e".repeat(7)}`,
  ]);
});

interface Car {
  readonly iid: number;
}

// Each car's commit is named after the base it was built on, so the chain of bases is visible in the result.
function builder(refuse: ReadonlySet<number>, bases: string[]): (car: Car, base: string) => Promise<BuildResult<{ sha: string }>> {
  return async (car, base) => {
    bases.push(`${car.iid}<${base}`);
    return refuse.has(car.iid) ? { refused: "the merge conflicted with the cars ahead" } : { built: { sha: `${car.iid}(${base})` } };
  };
}

test("a rebuild builds every car on the one in front of it", async () => {
  const bases: string[] = [];
  const result = await rebuildChain("head", [{ iid: 1 }, { iid: 2 }, { iid: 3 }], builder(new Set(), bases));
  assert.deepEqual(bases, ["1<head", "2<1(head)", "3<2(1(head))"]);
  assert.deepEqual(result.kept.map((entry) => entry.car.iid), [1, 2, 3]);
  assert.deepEqual(result.dropped, []);
});

test("a refused car leaves and the cars behind build on what remains", async () => {
  const bases: string[] = [];
  const result = await rebuildChain("1(head)", [{ iid: 2 }, { iid: 3 }, { iid: 4 }], builder(new Set([2, 4]), bases));
  assert.deepEqual(bases, ["2<1(head)", "3<1(head)", "4<3(1(head))"]);
  assert.deepEqual(result.kept.map((entry) => entry.car.iid), [3]);
  assert.deepEqual(result.dropped.map((entry) => [entry.car.iid, entry.reason]), [
    [2, "the merge conflicted with the cars ahead"],
    [4, "the merge conflicted with the cars ahead"],
  ]);
});

test("rebuilding nothing builds nothing", async () => {
  const bases: string[] = [];
  const result = await rebuildChain("head", [], builder(new Set(), bases));
  assert.deepEqual([bases, result.kept, result.dropped], [[], [], []]);
});
