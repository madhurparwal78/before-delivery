import assert from "node:assert/strict";
import { test } from "node:test";
import { diffHunks, diffLines, NO_EXPANSION, expandGap } from "../src/shared/diff.ts";
import { fileItems, placeThreads, rowLabel, selectionRange, stepSelection, threadLabel, threadLines, type Selection } from "../src/client/pages/mr/diff-model.ts";
import type { DiffFile, ThreadLike } from "../src/client/pages/mr/diff-types.ts";

const before = Array.from({ length: 30 }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`);
const after = before.map((text, i) => (i === 4 ? "changed 05" : i === 11 ? "changed 12" : text)).filter((text) => text !== "line 25");
const file: DiffFile = { path: "big.txt", old_path: null, status: "modified", hunks: diffHunks(before, after) };

function thread(over: Partial<ThreadLike> & Pick<ThreadLike, "id">): ThreadLike {
  return { position: null, current_line: null, resolved: false, ...over };
}

test("rows from the compare body show gaps with their size, the last one unknown", () => {
  const gapsOf = (items: ReturnType<typeof fileItems>) => items.flatMap((item) => (item.kind === "gap" ? [item] : []));
  const gaps = gapsOf(fileItems(file, null, NO_EXPANSION, "inline"));
  assert.deepEqual(gaps.map((gap) => [gap.gap, gap.hidden]), [[0, 1], [1, 6], [2, null]]);
  assert.equal(gaps[0].canExpandAbove && !gaps[0].canExpandBelow, true);
  assert.equal(gaps[1].canExpandAbove && gaps[1].canExpandBelow, true);
  assert.equal(gaps[2].canExpandBelow && !gaps[2].canExpandAbove, true);
  const known = gapsOf(fileItems(file, diffLines(before, after), NO_EXPANSION, "inline"));
  assert.deepEqual(known.map((gap) => [gap.gap, gap.hidden]), [[0, 1], [1, 6], [2, 2]]);
});

test("with both versions known the same rows appear and expansion reveals twenty lines", () => {
  const ops = diffLines(before, after);
  const first = fileItems(file, ops, NO_EXPANSION, "inline");
  assert.equal(first.filter((item) => item.kind === "line").length, fileItems(file, null, NO_EXPANSION, "inline").filter((item) => item.kind === "line").length);
  const more = fileItems(file, ops, expandGap(NO_EXPANSION, 0, "above"), "inline");
  const labels = more.flatMap((item) => (item.kind === "line" ? [rowLabel(item.cell, 0)] : []));
  assert.ok(labels.includes("Line 1 unchanged, big.txt"));
});

test("side by side puts the removed and added line of a change in one pair", () => {
  const items = fileItems(file, null, NO_EXPANSION, "split");
  const pair = items.find((item) => item.kind === "pair" && item.left?.kind === "removed");
  assert.ok(pair && pair.kind === "pair");
  assert.equal(pair.left?.n, 5);
  assert.equal(pair.right?.n, 5);
  assert.equal(pair.right?.kind, "added");
});

test("row labels count unresolved threads", () => {
  const cell = { path: "a.ts", kind: "added", n: 42 } as const;
  assert.equal(rowLabel(cell, 0), "Line 42 added, a.ts");
  assert.equal(rowLabel(cell, 1), "Line 42 added, a.ts, 1 unreso" + "lved thread");
  assert.equal(rowLabel(cell, 2), "Line 42 added, a.ts, 2 unresolved threads");
});

test("thread labels follow the latest line and name ranges", () => {
  const made = { path: "src/app.ts", old_line: null, new_line: 5, end_line: 7, version: 1 };
  const moved = thread({ id: 1, position: made, current_line: 9 });
  assert.equal(threadLabel(moved), "Thread on src/app.ts lines 9-11, unresolved");
  assert.deepEqual(threadLines(moved), { start: 9, end: 11 });
  assert.equal(threadLabel(thread({ id: 2, resolved: true })), "Thread on merge request, resolved");
  assert.equal(threadLabel(thread({ id: 3, position: { ...made, end_line: null } })), "Thread on src/app.ts line 5, unresolved");
});

test("threads hang under the end line of the version being viewed", () => {
  const position = { path: "a.ts", old_line: null, new_line: 3, end_line: 5, version: 1 };
  const latest = thread({ id: 1, position, current_line: 4 });
  const outdated = thread({ id: 2, position });
  const onLatest = placeThreads([latest, outdated], 2, 2, true);
  assert.equal(onLatest.spots.get(1)?.end, 6);
  assert.equal(onLatest.spots.has(2), false);
  const onFirst = placeThreads([latest, outdated], 1, 2, true);
  assert.equal(onFirst.spots.get(1)?.end, 5);
  assert.equal(onFirst.spots.get(2)?.start, 3);
});

test("range selection keeps to drawn lines and reports start and end", () => {
  const drawn = (n: number) => n >= 4 && n <= 6;
  let selection: Selection = { path: "a.ts", side: "new", anchor: 4, head: 4 };
  selection = stepSelection(stepSelection(selection, 1, drawn), 1, drawn);
  assert.deepEqual(selectionRange(selection), { start: 4, end: 6 });
  assert.equal(stepSelection(selection, 1, drawn), selection);
  assert.deepEqual(selectionRange({ ...selection, head: 4 }), { start: 4, end: null });
});
