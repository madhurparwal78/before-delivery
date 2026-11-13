import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diffHunks,
  diffLines,
  expandGap,
  expandedRows,
  hunksFromOps,
  mapRange,
  splitLines,
  splitRows,
  EXPAND_STEP,
  NO_EXPANSION,
} from "../src/shared/diff.ts";
import type { DiffOp, DiffRow, Expansion } from "../src/shared/diff.ts";

const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => `line ${String(i + 1).padStart(2, "0")}`);

function applyOps(ops: readonly DiffOp[]): string[] {
  return ops.filter((op) => op.type !== "del").map((op) => op.text);
}

function oldSide(ops: readonly DiffOp[]): string[] {
  return ops.filter((op) => op.type !== "add").map((op) => op.text);
}

function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    previous = row;
  }
  return previous[b.length];
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomLines(next: () => number, count: number, alphabet: number): string[] {
  return Array.from({ length: count }, () => `v${Math.floor(next() * alphabet)}`);
}

test("splitLines ignores the final newline", () => {
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("a\nb\n"), ["a", "b"]);
  assert.deepEqual(splitLines("a\nb"), ["a", "b"]);
  assert.deepEqual(splitLines("\n"), [""]);
  assert.deepEqual(splitLines("a\n\nb\n"), ["a", "", "b"]);
});

test("a final newline makes no difference", () => {
  const ops = diffLines(splitLines("a\nb\n"), splitLines("a\nb"));
  assert.ok(ops.every((op) => op.type === "equal"));
  assert.deepEqual(diffHunks(splitLines("a\nb\n"), splitLines("a\nb")), []);
});

test("hunk headers of the worked example", () => {
  const oldLines = numbered(30);
  const newLines = oldLines.flatMap((line) => (line === "line 05" ? ["changed 05"] : line === "line 12" ? ["changed 12"] : line === "line 25" ? [] : [line]));
  const hunks = diffHunks(oldLines, newLines);
  assert.deepEqual(hunks.map((h) => h.header), ["@@ -2,14 +2,14 @@", "@@ -22,7 +22,6 @@"]);
  assert.deepEqual(hunks[0].lines.map((l) => l.type), [
    ...Array(3).fill("context"), "del", "add", ...Array(6).fill("context"), "del", "add", ...Array(3).fill("context"),
  ]);
  const removed = hunks[0].lines[3];
  assert.deepEqual(removed, { type: "del", old: 5, new: null, text: "line 05" });
  assert.deepEqual(hunks[0].lines[4], { type: "add", old: null, new: 5, text: "changed 05" });
  assert.deepEqual(hunks[1].lines.map((l) => l.type), [...Array(3).fill("context"), "del", ...Array(3).fill("context")]);
  assert.deepEqual([hunks[1].oldStart, hunks[1].oldCount, hunks[1].newStart, hunks[1].newCount], [22, 7, 22, 6]);
});

test("hunks join exactly when their context touches", () => {
  const base = numbered(40);
  const change = (...lines: number[]): string[] => base.map((line, i) => (lines.includes(i + 1) ? `x${i + 1}` : line));
  assert.equal(diffHunks(base, change(10, 17)).length, 1);
  assert.equal(diffHunks(base, change(10, 18)).length, 2);
  assert.equal(diffHunks(base, change(10, 17), 0).length, 2);
  assert.equal(diffHunks(base, change(10, 11), 0).length, 1);
});

test("added and deleted files", () => {
  const added = diffHunks([], ["a", "b", "c"]);
  assert.deepEqual(added.map((h) => h.header), ["@@ -0,0 +1,3 @@"]);
  assert.deepEqual(added[0].lines.map((l) => [l.type, l.old, l.new]), [["add", null, 1], ["add", null, 2], ["add", null, 3]]);
  const deleted = diffHunks(["a", "b"], []);
  assert.deepEqual(deleted.map((h) => h.header), ["@@ -1,2 +0,0 @@"]);
  assert.deepEqual(diffHunks([], []), []);
});

test("a zero count names the line before", () => {
  const oldLines = ["a", "b", "c"];
  const hunks = diffHunks(oldLines, ["a", "b", "x", "c"], 0);
  assert.deepEqual(hunks.map((h) => h.header), ["@@ -2,0 +3,1 @@"]);
  assert.deepEqual(diffHunks(["a", "b", "c"], ["a", "c"], 0).map((h) => h.header), ["@@ -2,1 +1,0 @@"]);
});

test("deletions print before additions in a changed block", () => {
  const ops = diffLines(["a", "b", "c", "d"], ["a", "x", "y", "d"]);
  assert.deepEqual(ops.map((op) => `${op.type}:${op.text}`), ["equal:a", "del:b", "del:c", "add:x", "add:y", "equal:d"]);
  assert.deepEqual(ops.map((op) => [op.old, op.new]), [[1, 1], [2, null], [3, null], [null, 2], [null, 3], [4, 4]]);
});

test("random diffs are minimal and reconstruct both sides", () => {
  const next = random(7);
  for (let round = 0; round < 400; round++) {
    const a = randomLines(next, Math.floor(next() * 25), 1 + Math.floor(next() * 6));
    const b = randomLines(next, Math.floor(next() * 25), 1 + Math.floor(next() * 6));
    const ops = diffLines(a, b);
    assert.deepEqual(applyOps(ops), b);
    assert.deepEqual(oldSide(ops), a);
    assert.equal(ops.filter((op) => op.type === "equal").length, lcsLength(a, b));
    for (const op of ops) {
      if (op.type === "equal") assert.equal(a[(op.old ?? 0) - 1], b[(op.new ?? 0) - 1]);
    }
  }
});

test("random edits of a file reconstruct through hunks", () => {
  const next = random(11);
  for (let round = 0; round < 100; round++) {
    const a = randomLines(next, 60, 40);
    const b = a.filter(() => next() > 0.1).flatMap((line) => (next() < 0.1 ? [line, `new${Math.floor(next() * 5)}`] : [line]));
    const hunks = diffHunks(a, b, 2);
    const rebuilt: string[] = [];
    let oldCursor = 1;
    for (const hunk of hunks) {
      while (oldCursor < hunk.oldStart) rebuilt.push(a[oldCursor++ - 1]);
      for (const line of hunk.lines) {
        if (line.type !== "del") rebuilt.push(line.text);
        if (line.type !== "add") oldCursor++;
      }
    }
    while (oldCursor <= a.length) rebuilt.push(a[oldCursor++ - 1]);
    assert.deepEqual(rebuilt, b);
  }
});

test("large inputs diff quickly", () => {
  const a = Array.from({ length: 5000 }, (_, i) => `row ${i}`);
  const b = a.map((line, i) => (i % 7 === 0 ? `edited ${i}` : line));
  const started = Date.now();
  const ops = diffLines(a, b);
  assert.equal(ops.filter((op) => op.type === "equal").length, a.length - Math.ceil(a.length / 7));
  const different = diffLines(a, Array.from({ length: 5000 }, (_, i) => `other ${i}`));
  assert.equal(different.length, 10000);
  const shuffled = diffLines(a, [...a].reverse());
  assert.equal(applyOps(shuffled).length, 5000);
  assert.ok(Date.now() - started < 5000);
});

test("many repeated lines still diff correctly", () => {
  const a = Array(2000).fill("");
  const b = [...Array(1500).fill(""), "x", ...Array(400).fill("")];
  const ops = diffLines(a, b);
  assert.deepEqual(applyOps(ops), b);
  assert.equal(ops.filter((op) => op.type === "equal").length, 1900);
});

test("hunksFromOps matches diffHunks", () => {
  const a = numbered(20);
  const b = a.slice(0, 10).concat(["extra"], a.slice(10));
  assert.deepEqual(hunksFromOps(diffLines(a, b)), diffHunks(a, b));
});

// --- Context expansion -------------------------------------------------------------------------------------------------

function bigOps(): DiffOp[] {
  const oldLines = numbered(100);
  const newLines = oldLines.map((line) => (line === "line 50" ? "changed 50" : line));
  return diffLines(oldLines, newLines);
}

function gaps(rows: readonly DiffRow[]): { gap: number; hidden: number }[] {
  return rows.flatMap((row) => (row.kind === "gap" ? [{ gap: row.gap, hidden: row.hidden }] : []));
}

function lineNumbers(rows: readonly DiffRow[]): (number | null)[] {
  return rows.flatMap((row) => (row.kind === "line" ? [row.old ?? row.new] : []));
}

test("collapsed rows show the hunks and the hidden counts around them", () => {
  const rows = expandedRows(bigOps());
  assert.deepEqual(gaps(rows), [{ gap: 0, hidden: 46 }, { gap: 1, hidden: 47 }]);
  assert.equal(rows.filter((row) => row.kind === "line").length, 8);
  const first = rows[0];
  assert.equal(first.kind, "gap");
  assert.ok(first.kind === "gap" && first.canExpandAbove && !first.canExpandBelow);
  const last = rows[rows.length - 1];
  assert.ok(last.kind === "gap" && !last.canExpandAbove && last.canExpandBelow);
});

test("expanding reveals 20 lines at a time, up to the file ends", () => {
  let expansion: Expansion = NO_EXPANSION;
  expansion = expandGap(expansion, 0, "above");
  let rows = expandedRows(bigOps(), 3, expansion);
  assert.deepEqual(gaps(rows), [{ gap: 0, hidden: 26 }, { gap: 1, hidden: 47 }]);
  assert.deepEqual(lineNumbers(rows).slice(0, 3), [27, 28, 29]);
  assert.equal(EXPAND_STEP, 20);

  expansion = expandGap(expandGap(expansion, 0, "above"), 0, "above");
  rows = expandedRows(bigOps(), 3, expansion);
  assert.deepEqual(gaps(rows), [{ gap: 1, hidden: 47 }]);
  assert.deepEqual(lineNumbers(rows).slice(0, 2), [1, 2]);

  expansion = expandGap(expansion, 1, "below");
  rows = expandedRows(bigOps(), 3, expansion);
  assert.deepEqual(gaps(rows), [{ gap: 1, hidden: 27 }]);
  assert.equal(lineNumbers(rows).at(-1), 100 - 27);
  for (let i = 0; i < 3; i++) expansion = expandGap(expansion, 1, "below");
  rows = expandedRows(bigOps(), 3, expansion);
  assert.deepEqual(gaps(rows), []);
  assert.deepEqual(lineNumbers(rows).length, 101);
});

test("expansion between hunks reveals from both ends and never repeats a line", () => {
  const oldLines = numbered(60);
  const newLines = oldLines.map((line) => (line === "line 10" || line === "line 50" ? `x ${line}` : line));
  const ops = diffLines(oldLines, newLines);
  const collapsed = expandedRows(ops);
  assert.deepEqual(gaps(collapsed), [{ gap: 0, hidden: 6 }, { gap: 1, hidden: 33 }, { gap: 2, hidden: 7 }]);
  const middle = collapsed.find((row) => row.kind === "gap" && row.gap === 1);
  assert.ok(middle?.kind === "gap" && middle.canExpandAbove && middle.canExpandBelow);

  let expansion = expandGap(NO_EXPANSION, 1, "below");
  let rows = expandedRows(ops, 3, expansion);
  assert.deepEqual(gaps(rows), [{ gap: 0, hidden: 6 }, { gap: 1, hidden: 13 }, { gap: 2, hidden: 7 }]);
  expansion = expandGap(expansion, 1, "above");
  rows = expandedRows(ops, 3, expansion);
  assert.deepEqual(gaps(rows), [{ gap: 0, hidden: 6 }, { gap: 2, hidden: 7 }]);
  expansion = expandGap(expansion, 1, "below");
  rows = expandedRows(ops, 3, expansion);
  const oldNumbers = rows.flatMap((row) => (row.kind === "line" && row.old !== null ? [row.old] : []));
  assert.deepEqual(oldNumbers, Array.from({ length: 47 }, (_, i) => i + 7));
});

test("an unchanged file has no rows", () => {
  const ops = diffLines(["a"], ["a"]);
  assert.deepEqual(expandedRows(ops), []);
});

test("a gap without a hunk after it ignores expansion above", () => {
  const rows = expandedRows(bigOps(), 3, expandGap(NO_EXPANSION, 1, "above"));
  assert.deepEqual(gaps(rows), [{ gap: 0, hidden: 46 }, { gap: 1, hidden: 47 }]);
});

test("side-by-side rows pair deletions with additions", () => {
  const ops = diffLines(["a", "b", "c", "d", "e"], ["a", "x", "d", "e", "f"]);
  const split = splitRows(expandedRows(ops));
  assert.deepEqual(
    split.map((row) => (row.kind === "gap" ? "gap" : `${row.left?.text ?? "-"}|${row.right?.text ?? "-"}`)),
    ["a|a", "b|x", "c|-", "d|d", "e|e", "-|f"],
  );
  const pure = splitRows(expandedRows(diffLines(["a"], ["a", "b", "c"]), 0));
  assert.deepEqual(pure.map((row) => (row.kind === "pair" ? [row.left, row.right?.text] : null)), [null, [null, "b"], [null, "c"]]);
});

// --- Line mapping ------------------------------------------------------------------------------------------------------

test("mapRange is null when any line is", () => {
  const ops = diffLines(["a", "b", "c", "d", "e"], ["a", "b", "x", "d", "e", "f"]);
  assert.deepEqual(mapRange(ops, "old", 1, 2), { start: 1, end: 2 });
  assert.equal(mapRange(ops, "old", 2, 4), null);
  assert.deepEqual(mapRange(ops, "old", 4, 5), { start: 4, end: 5 });
  assert.deepEqual(mapRange(ops, "new", 4, 5), { start: 4, end: 5 });
  assert.equal(mapRange(ops, "new", 5, 6), null);
  assert.deepEqual(mapRange(ops, "old", 1, 1), { start: 1, end: 1 });
  assert.equal(mapRange(ops, "old", 3, 2), null);
});

