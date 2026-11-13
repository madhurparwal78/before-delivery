import { test } from "node:test";
import assert from "node:assert/strict";
import { byPosition, listsOf, place, planMove, POSITION_STEP, type ListDef } from "../src/server/planning/board-order.ts";

const lists: ListDef[] = [
  { id: 1, kind: "open", title: "Open", ref: null },
  { id: 2, kind: "list", title: "doing", ref: "doing" },
  { id: 3, kind: "list", title: "review", ref: "review" },
  { id: 4, kind: "closed", title: "Closed", ref: null },
];
const card = (labels: string[], state: "opened" | "closed" = "opened") => ({ state, labels, assignees: [], milestone: null });

test("an open card shows in every list it matches, else in Open; a closed card only in Closed", () => {
  assert.deepEqual(listsOf("label", lists, card([])), [1]);
  assert.deepEqual(listsOf("label", lists, card(["doing"])), [2]);
  assert.deepEqual(listsOf("label", lists, card(["doing", "review"])), [2, 3]);
  assert.deepEqual(listsOf("label", lists, card(["doing"], "closed")), [4]);
  assert.deepEqual(listsOf("assignee", [{ id: 5, kind: "list", title: "ana", ref: "ana" }], { ...card([]), assignees: ["ana"] }), [5]);
  assert.deepEqual(listsOf("milestone", [{ id: 6, kind: "list", title: "S1", ref: "S1" }], { ...card([]), milestone: "S1" }), [6]);
});

function at(id: number): ListDef {
  const found = lists.find((list) => list.id === id);
  if (found === undefined) throw new Error("no list");
  return found;
}

test("a move removes the left list's field, adds the target's, closes into Closed and reopens out of it", () => {
  const out = planMove("label", lists, card(["doing"]), at(3));
  assert.deepEqual([out.remove?.id, out.add?.id, out.close, out.reopen], [2, 3, false, false]);
  const toOpen = planMove("label", lists, card(["doing"]), at(1));
  assert.deepEqual([toOpen.remove?.id, toOpen.add, toOpen.close], [2, null, false]);
  const toClosed = planMove("label", lists, card(["doing"]), at(4));
  assert.deepEqual([toClosed.remove, toClosed.add, toClosed.close], [null, null, true]);
  const fromClosed = planMove("label", lists, card(["doing"], "closed"), at(3));
  assert.deepEqual([fromClosed.remove, fromClosed.add?.id, fromClosed.reopen], [null, 3, true]);
  const same = planMove("label", lists, card(["doing"]), at(2));
  assert.deepEqual([same.remove, same.add?.id], [null, 2]);
  const chosen = planMove("label", lists, card(["doing", "review"]), at(1), at(3));
  assert.equal(chosen.remove?.id, 3);
});

test("a card lands after the named card, at the top for null and at the end when that card left", () => {
  const members = [{ id: 10, position: 1024 }, { id: 11, position: 2048 }, { id: 12, position: 4096 }];
  assert.deepEqual(place(members, 10, 0), { kind: "placed", position: 1536, fellBack: false });
  assert.deepEqual(place(members, 12, 0), { kind: "placed", position: 4096 + POSITION_STEP, fellBack: false });
  assert.deepEqual(place(members, null, 0), { kind: "placed", position: 1024 - POSITION_STEP, fellBack: false });
  assert.deepEqual(place(members, 99, 0), { kind: "placed", position: 4096 + POSITION_STEP, fellBack: true });
  assert.deepEqual(place([], 99, 7), { kind: "placed", position: 7, fellBack: true });
  assert.deepEqual(place([{ id: 1, position: 1 }, { id: 2, position: 1 + Number.EPSILON }], 1, 0), { kind: "crowded" });
});

test("cards are ordered by position and then id", () => {
  assert.deepEqual(byPosition([{ id: 3, position: 5 }, { id: 1, position: 5 }, { id: 2, position: 1 }]).map((c) => c.id), [2, 1, 3]);
});
