import { test } from "node:test";
import assert from "node:assert/strict";
import { hasConflictMarkers, merge3, mergeTrees, resolveSegments } from "../src/shared/merge.ts";

const labels = { ours: "main", theirs: "fx" };
const lines = (...items: string[]): string => items.map((item) => `${item}\n`).join("");
const tree = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("the published conflict format", () => {
  const merged = merge3("base\n", "main line\n", "feature line\n", labels);
  assert.equal(merged.text, "<<<<<<< main\nmain line\n=======\nfeature line\n>>>>>>> fx\n");
  assert.equal(merged.clean, false);
  assert.deepEqual(merged.segments, [{ kind: "conflict", ours: ["main line"], theirs: ["feature line"] }]);
});

test("separated changes from both sides apply", () => {
  const base = lines("1", "2", "3", "4", "5");
  const merged = merge3(base, lines("1", "ours", "3", "4", "5"), lines("1", "2", "3", "4", "theirs"), labels);
  assert.equal(merged.text, lines("1", "ours", "3", "4", "theirs"));
  assert.equal(merged.clean, true);
  assert.deepEqual(merged.segments, [{ kind: "common", lines: ["1", "ours", "3", "4", "theirs"] }]);
});

test("touching changes conflict", () => {
  const base = lines("1", "2", "3", "4");
  const merged = merge3(base, lines("1", "ours", "3", "4"), lines("1", "2", "theirs", "4"), labels);
  assert.equal(merged.text, lines("1", "<<<<<<< main", "ours", "3", "=======", "2", "theirs", ">>>>>>> fx", "4"));
  assert.equal(merged.clean, false);
});

test("changes one unchanged line apart do not conflict", () => {
  const base = lines("1", "2", "3", "4", "5");
  const merged = merge3(base, lines("1", "ours", "3", "4", "5"), lines("1", "2", "3", "theirs", "5"), labels);
  assert.equal(merged.text, lines("1", "ours", "3", "theirs", "5"));
});

test("insertions at the same point conflict unless identical", () => {
  const base = lines("a", "b");
  assert.equal(merge3(base, lines("a", "x", "b"), lines("a", "y", "b"), labels).clean, false);
  const same = merge3(base, lines("a", "x", "b"), lines("a", "x", "b"), labels);
  assert.equal(same.text, lines("a", "x", "b"));
  assert.equal(same.clean, true);
});

test("an insertion touching a replacement conflicts", () => {
  const base = lines("a", "b", "c");
  const merged = merge3(base, lines("a", "x", "b", "c"), lines("a", "B", "c"), labels);
  assert.equal(merged.clean, false);
  assert.equal(merged.text, lines("a", "<<<<<<< main", "x", "b", "=======", "B", ">>>>>>> fx", "c"));
});

test("the same change on both sides applies once", () => {
  const base = lines("a", "b", "c");
  const both = lines("a", "same", "c");
  const merged = merge3(base, both, both, labels);
  assert.equal(merged.text, both);
  assert.equal(merged.clean, true);
  const deletions = merge3(base, lines("a", "c"), lines("a", "c"), labels);
  assert.equal(deletions.text, lines("a", "c"));
});

test("a deletion against a modification of the same line conflicts with an empty side", () => {
  const base = lines("a", "b", "c");
  const merged = merge3(base, lines("a", "c"), lines("a", "B", "c"), labels);
  assert.equal(merged.text, lines("a", "<<<<<<< main", "=======", "B", ">>>>>>> fx", "c"));
  assert.deepEqual(merged.segments[1], { kind: "conflict", ours: [], theirs: ["B"] });
});

test("several conflicts and the final newline", () => {
  const base = lines("a", "b", "c", "d", "e");
  const merged = merge3(base, lines("A", "b", "c", "d", "E"), lines("1", "b", "c", "d", "5"), labels);
  assert.equal(merged.segments.filter((segment) => segment.kind === "conflict").length, 2);
  assert.equal(merged.text.endsWith(">>>>>>> fx\n"), true);
  assert.equal(merge3("a\nb", "a\nB", "a\nb", labels).text, "a\nB");
  assert.equal(merge3("a\nb", "a\nB", "a\nb\n", labels).text, "a\nB\n");
  assert.equal(merge3("", "", "", labels).text, "");
});

test("resolveSegments picks one side per conflict", () => {
  const base = lines("a", "b", "c", "d", "e");
  const merged = merge3(base, lines("A", "b", "c", "d", "E"), lines("1", "b", "c", "d", "5"), labels);
  assert.equal(resolveSegments(merged.segments, ["ours", "theirs"]), lines("A", "b", "c", "d", "5"));
  assert.equal(resolveSegments(merged.segments, ["theirs", "ours"]), lines("1", "b", "c", "d", "E"));
  const single = merge3("base\n", "main line\n", "feature line\n", labels);
  assert.equal(resolveSegments(single.segments, ["theirs"]), "feature line\n");
});

test("conflict marker detection", () => {
  assert.equal(hasConflictMarkers("<<<<<<< main\nx\n=======\ny\n>>>>>>> fx\n"), true);
  assert.equal(hasConflictMarkers("ok\n=======\n"), true);
  assert.equal(hasConflictMarkers("ok\n=======x\n"), true);
  assert.equal(hasConflictMarkers("ok\n>>>>>>> fx"), true);
  assert.equal(hasConflictMarkers("<<<<<<< "), true);
  assert.equal(hasConflictMarkers("resolved line\n"), false);
  assert.equal(hasConflictMarkers("<<<<<<<main\n>>>>>>>x\n  =======\n"), false);
  assert.equal(hasConflictMarkers("a ======= b\n"), false);
});

test("random merges: a side equal to the base yields the other side", () => {
  const next = random(5);
  const randomText = (): string => lines(...Array.from({ length: Math.floor(next() * 15) }, () => `v${Math.floor(next() * 5)}`));
  for (let round = 0; round < 300; round++) {
    const base = randomText();
    const other = randomText();
    const oursIsBase = merge3(base, base, other, labels);
    assert.equal(oursIsBase.text, other);
    assert.equal(oursIsBase.clean, true);
    const theirsIsBase = merge3(base, other, base, labels);
    assert.equal(theirsIsBase.text, other);
    assert.equal(theirsIsBase.clean, true);
    const same = merge3(base, other, other, labels);
    assert.equal(same.text, other);
  }
});

test("random merges: resolving every conflict yields no markers and keeps untouched lines", () => {
  const next = random(9);
  const pick = (): string => lines(...Array.from({ length: 12 }, (_, i) => `l${i}`).map((line) => (next() < 0.25 ? `${line}-${Math.floor(next() * 3)}` : line)));
  const base = lines(...Array.from({ length: 12 }, (_, i) => `l${i}`));
  for (let round = 0; round < 200; round++) {
    const ours = pick();
    const theirs = pick();
    const merged = merge3(base, ours, theirs, labels);
    const conflicts = merged.segments.filter((segment) => segment.kind === "conflict").length;
    const allOurs = resolveSegments(merged.segments, Array(conflicts).fill("ours"));
    const allTheirs = resolveSegments(merged.segments, Array(conflicts).fill("theirs"));
    assert.equal(hasConflictMarkers(allOurs) || hasConflictMarkers(allTheirs), false);
    if (merged.clean) assert.equal(allOurs, allTheirs);
    assert.equal(merged.text.split("\n").filter((line) => line.startsWith("<<<<<<< ")).length, conflicts);
  }
});

// --- Trees -------------------------------------------------------------------------------------------------------------

test("tree merge takes single-sided changes, deletions and identical changes", () => {
  const result = mergeTrees(
    tree({ "keep.txt": "k\n", "ours-edit.txt": "o\n", "theirs-edit.txt": "t\n", "gone.txt": "g\n", "theirs-gone.txt": "b\n", "same.txt": "s\n" }),
    tree({ "keep.txt": "k\n", "ours-edit.txt": "O\n", "theirs-edit.txt": "t\n", "theirs-gone.txt": "b\n", "same.txt": "S\n", "ours-new.txt": "n\n" }),
    tree({ "keep.txt": "k\n", "ours-edit.txt": "o\n", "theirs-edit.txt": "T\n", "gone.txt": "g\n", "same.txt": "S\n", "theirs-new.txt": "m\n" }),
    labels,
  );
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual([...result.files.entries()].sort(), [
    ["keep.txt", "k\n"],
    ["ours-edit.txt", "O\n"],
    ["ours-new.txt", "n\n"],
    ["same.txt", "S\n"],
    ["theirs-edit.txt", "T\n"],
    ["theirs-new.txt", "m\n"],
  ]);
});

test("a file deleted on one side and unchanged on the other is deleted", () => {
  const result = mergeTrees(tree({ "a.txt": "a\n", "b.txt": "b\n" }), tree({ "b.txt": "b\n" }), tree({ "a.txt": "a\n" }), labels);
  assert.deepEqual([...result.files.keys()], []);
  assert.deepEqual(result.conflicts, []);
});

test("a file deleted on both sides stays deleted", () => {
  const result = mergeTrees(tree({ "a.txt": "a\n" }), tree({}), tree({}), labels);
  assert.equal(result.files.size, 0);
  assert.equal(result.conflicts.length, 0);
});

test("content merge inside a tree", () => {
  const base = tree({ "f.txt": lines("1", "2", "3", "4", "5") });
  const clean = mergeTrees(base, tree({ "f.txt": lines("o", "2", "3", "4", "5") }), tree({ "f.txt": lines("1", "2", "3", "4", "t") }), labels);
  assert.deepEqual(clean.files.get("f.txt"), lines("o", "2", "3", "4", "t"));
  const conflicted = mergeTrees(base, tree({ "f.txt": "main line\n" }), tree({ "f.txt": "feature line\n" }), labels);
  assert.equal(conflicted.files.has("f.txt"), false);
  assert.equal(conflicted.conflicts.length, 1);
  const [conflict] = conflicted.conflicts;
  assert.equal(conflict.kind, "content");
  assert.equal(conflict.path, "f.txt");
  assert.equal(conflict.markedText, "<<<<<<< main\nmain line\n=======\nfeature line\n>>>>>>> fx\n");
  assert.equal(conflict.oursText, "main line\n");
  assert.equal(conflict.theirsText, "feature line\n");
  assert.deepEqual(conflict.segments, [{ kind: "conflict", ours: ["main line"], theirs: ["feature line"] }]);
});

test("a file added on both sides conflicts as a whole unless identical", () => {
  const result = mergeTrees(tree({}), tree({ "n.txt": "ours\n", "same.txt": "x\n" }), tree({ "n.txt": "theirs\n", "same.txt": "x\n" }), labels);
  assert.deepEqual([...result.files.entries()], [["same.txt", "x\n"]]);
  assert.deepEqual(result.conflicts, [{
    path: "n.txt",
    kind: "whole",
    markedText: "<<<<<<< main\nours\n=======\ntheirs\n>>>>>>> fx\n",
    oursText: "ours\n",
    theirsText: "theirs\n",
  }]);
});

test("delete against modify conflicts as a whole file", () => {
  const base = tree({ "a.txt": "a\n", "b.txt": "b\n" });
  const result = mergeTrees(base, tree({ "b.txt": "b\n" }), tree({ "a.txt": "A\n", "b.txt": "b\n" }), labels);
  assert.equal(result.files.has("a.txt"), false);
  assert.deepEqual(result.conflicts, [{
    path: "a.txt",
    kind: "whole",
    markedText: "<<<<<<< main\n=======\nA\n>>>>>>> fx\n",
    oursText: null,
    theirsText: "A\n",
  }]);
  const reverse = mergeTrees(base, tree({ "a.txt": "A\n", "b.txt": "b\n" }), tree({ "b.txt": "b\n" }), labels);
  assert.equal(reverse.conflicts[0].markedText, "<<<<<<< main\nA\n=======\n>>>>>>> fx\n");
  assert.equal(reverse.conflicts[0].theirsText, null);
});

test("conflicts are listed in UTF-8 byte order", () => {
  const base = tree({ "b": "0\n", "a/z": "0\n", "a.txt": "0\n", "é": "0\n", "z": "0\n", "😀": "0\n" });
  const change = (value: string): Map<string, string> => new Map([...base.keys()].map((path) => [path, value]));
  const result = mergeTrees(base, change("1\n"), change("2\n"), labels);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.path), ["a.txt", "a/z", "b", "z", "é", "😀"]);
});
