import { test } from "node:test";
import assert from "node:assert/strict";
import { blobId } from "../src/server/lib/objects.ts";
import { applyActions, oversizedFile } from "../src/server/repo/actions.ts";

const id = (text: string): string => blobId(Buffer.from(text));
const before = new Map([["README.md", id("hello\n")], ["src/a.ts", id("a\n")]]);

test("actions apply in order", () => {
  const out = applyActions(before, [
    { action: "create", path: "b.txt", content: "b\n" },
    { action: "update", path: "b.txt", content: "b2\n" },
    { action: "delete", path: "README.md" },
    { action: "move", path: "lib/a.ts", previous_path: "src/a.ts" },
  ]);
  assert.equal(out.errors.size, 0);
  assert.deepEqual([...out.entries], [["b.txt", id("b2\n")], ["lib/a.ts", id("a\n")]]);
  assert.equal(out.texts.get(id("b2\n")), "b2\n");
});

test("path errors use the published messages and leave nothing applied", () => {
  const out = applyActions(before, [
    { action: "create", path: "ok.txt", content: "ok\n" },
    { action: "update", path: "missing.txt", content: "m\n" },
    { action: "create", path: "README.md", content: "again\n" },
  ]);
  assert.deepEqual([...out.errors.values()], ["File missing.txt does not exist.", "File README.md already exists."]);
});

test("a move needs its source and a free target", () => {
  const out = applyActions(before, [
    { action: "move", path: "README.md", previous_path: "src/a.ts" },
    { action: "move", path: "x.txt", previous_path: "nope.txt" },
  ]);
  assert.deepEqual([...out.errors.values()], ["File README.md already exists.", "File nope.txt does not exist."]);
});

test("text that is not UTF-8 is refused", () => {
  const out = applyActions(before, [{ action: "create", path: "bad.txt", content: "x\ud800" }]);
  assert.deepEqual([...out.errors.values()], ["File bad.txt is not UTF-8 text."]);
});

test("a file cannot also be a folder", () => {
  const out = applyActions(before, [{ action: "create", path: "README.md/inner.txt", content: "x" }]);
  assert.deepEqual([...out.errors.values()], ["File README.md already exists."]);
});

test("the size limit allows exactly the limit", () => {
  assert.equal(oversizedFile([{ action: "create", path: "a", content: "aaaa" }], 4), undefined);
  assert.equal(oversizedFile([{ action: "create", path: "a", content: "aaaa" }, { action: "update", path: "b", content: "aaaaa" }], 4)?.path, "b");
  assert.equal(oversizedFile([{ action: "create", path: "a", content: "ééé" }], 5)?.path, "a");
});
