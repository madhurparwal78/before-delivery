import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHits, matchingLines } from "../src/server/planning/search-match.ts";

test("lines match an exact substring, ignoring case", () => {
  const content = "Hello World\nnothing\r\nsay HELLO again\n";
  assert.deepEqual(matchingLines(content, "hello"), [{ line: 1, text: "Hello World" }, { line: 3, text: "say HELLO again" }]);
  assert.deepEqual(matchingLines(content, "o w"), [{ line: 1, text: "Hello World" }]);
  assert.deepEqual(matchingLines(content, "hel lo"), []);
  assert.deepEqual(matchingLines(content, ""), []);
  assert.deepEqual(matchingLines("a.b\naxb", "a.b"), [{ line: 1, text: "a.b" }]);
});

test("hits sort by path and then line", () => {
  const hits = [
    { project: "g/p", path: "src/b.ts", line: 1 },
    { project: "g/p", path: "src/a.ts", line: 9 },
    { project: "g/p", path: "src/a.ts", line: 2 },
    { project: "g/o", path: "src/a.ts", line: 2 },
  ];
  assert.deepEqual([...hits].sort(compareHits).map((h) => `${h.project}:${h.path}:${h.line}`), [
    "g/o:src/a.ts:2", "g/p:src/a.ts:2", "g/p:src/a.ts:9", "g/p:src/b.ts:1",
  ]);
});
