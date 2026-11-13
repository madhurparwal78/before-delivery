import { test } from "node:test";
import assert from "node:assert/strict";
import { diffTexts, mapRegion, type Mapped } from "../src/server/mr/remap.ts";
import { closingIssueIids } from "../src/server/mr/closing.ts";
import { markedHunks } from "../src/server/mr/conflicts.ts";

function remapLines(before: string | null, after: string | null, lines: Mapped): Mapped | null {
  return before === null || after === null ? null : mapRegion(diffTexts(before, after), lines.start, lines.end);
}

const eight = Array.from({ length: 8 }, (_, i) => `line ${i + 1}\n`).join("");

test("a line in an unchanged block takes its new number", () => {
  const after = eight.replace("line 2\n", "new 2a\nnew 2b\n");
  assert.deepEqual(remapLines(eight, after, { start: 6, end: 6 }), { start: 7, end: 7 });
});

test("a line in a changed block is outdated", () => {
  const after = eight.replace("line 2\n", "new 2a\nnew 2b\n");
  assert.equal(remapLines(eight, after, { start: 2, end: 2 }), null);
});

test("a range is outdated when any of its lines changed", () => {
  const after = eight.replace("line 4\n", "feat 4\n");
  assert.deepEqual(remapLines(eight, after, { start: 5, end: 7 }), { start: 5, end: 7 });
  assert.equal(remapLines(eight, after, { start: 3, end: 5 }), null);
});

test("a deleted file makes every thread on it outdated", () => {
  assert.equal(remapLines(eight, null, { start: 1, end: 1 }), null);
  assert.equal(remapLines(null, eight, { start: 1, end: 1 }), null);
});

test("closing keywords: three words, any case, unique and ascending", () => {
  assert.deepEqual(closingIssueIids(["Closes #3 and fixes #1", "RESOLVES #3\nCloses #12"]), [1, 3, 12]);
  assert.deepEqual(closingIssueIids(["Closing #4", "see #5", "unfixes #6"]), []);
});

test("conflict hunks are read back from marked text", () => {
  const marked = "head\n<<<<<<< main\nours 1\nours 2\n=======\ntheirs\n>>>>>>> fx\nmiddle\n<<<<<<< main\n=======\nonly theirs\n>>>>>>> fx\n";
  assert.deepEqual(markedHunks(marked), [
    { ours: ["ours 1", "ours 2"], theirs: ["theirs"] },
    { ours: [], theirs: ["only theirs"] },
  ]);
});
