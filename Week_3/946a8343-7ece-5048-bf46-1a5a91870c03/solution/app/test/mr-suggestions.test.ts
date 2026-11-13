import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMessage, applySuggestions, findOverlap, parseSuggestionBlocks, suggestionRegion } from "../src/server/mr/suggestions.ts";

test("a bare block is -0+0 and the offsets are read from the opener", () => {
  const blocks = parseSuggestionBlocks("Try:\n```suggestion\none\n```\nand\n```suggestion:-2+1\na\nb\n```\n");
  assert.deepEqual(blocks, [{ above: 0, below: 0, lines: ["one"] }, { above: 2, below: 1, lines: ["a", "b"] }]);
});

test("an empty block deletes lines and an unclosed block is plain text", () => {
  assert.deepEqual(parseSuggestionBlocks("```suggestion\n```"), [{ above: 0, below: 0, lines: [] }]);
  assert.deepEqual(parseSuggestionBlocks("```suggestion\nnever closed"), []);
  assert.deepEqual(parseSuggestionBlocks("```ts\nnot a suggestion\n```"), []);
});

test("the region grows by the offsets", () => {
  assert.deepEqual(suggestionRegion(5, 7, { above: 1, below: 2 }), { start: 4, end: 9 });
});

test("overlap reports the span two suggestions cover together", () => {
  const plan = (path: string, start: number, end: number) => ({ path, start, end, lines: ["x"] });
  assert.equal(findOverlap([plan("a.ts", 1, 2), plan("b.ts", 1, 2)]), null);
  assert.equal(findOverlap([plan("a.ts", 1, 2), plan("a.ts", 3, 4)]), null);
  assert.deepEqual(findOverlap([plan("a.ts", 3, 4), plan("a.ts", 2, 3)]), { path: "a.ts", start: 2, end: 4 });
  assert.deepEqual(findOverlap([plan("a.ts", 2, 2), plan("a.ts", 2, 2)]), { path: "a.ts", start: 2, end: 2 });
});

test("suggestions apply from the bottom so earlier numbers stay valid", () => {
  const text = "a1\na2\na3\na4\na5\na6\n";
  const out = applySuggestions(text, [
    { path: "f", start: 2, end: 2, lines: ["two", "two and a half"] },
    { path: "f", start: 5, end: 6, lines: ["five"] },
  ]);
  assert.equal(out, "a1\ntwo\ntwo and a half\na3\na4\nfive\n");
});

test("a region outside the file refuses, and a file without a final newline keeps none", () => {
  assert.equal(applySuggestions("a\nb\n", [{ path: "f", start: 2, end: 3, lines: ["x"] }]), null);
  assert.equal(applySuggestions("a\nb", [{ path: "f", start: 2, end: 2, lines: ["c"] }]), "a\nc");
  assert.equal(applySuggestions("a\n", [{ path: "f", start: 1, end: 1, lines: [] }]), "");
});

test("commit messages follow the published wording", () => {
  assert.equal(applyMessage(1, 1, "src/app.ts"), "Apply suggestio" + "n to src/app.ts");
  assert.equal(applyMessage(2, 2, "src/app.ts"), "Apply 2 suggestions to 2 files");
});
