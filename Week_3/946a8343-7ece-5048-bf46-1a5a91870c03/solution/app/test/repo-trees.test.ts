import { test } from "node:test";
import assert from "node:assert/strict";
import { blobId, commitId, treeId, treeIdFromFiles } from "../src/server/lib/objects.ts";
import { buildTrees, firstFileFolderClash, isUtf8Text, isValidPath } from "../src/server/repo/trees.ts";

const README_BLOB = "de5777551c59cba3dac8b9831f889bab03ece9824236e20616ac48bbefdc5594";
const ROOT_TREE = "d0604e08d4be0b90d067bc3f6f5d0d3fc5000d1822a8a487d4db71b94690e941";

test("the published worked example", () => {
  const blob = blobId(Buffer.from("hello\n"));
  assert.equal(blob, README_BLOB);
  const built = buildTrees(new Map([["README.md", blob]]));
  assert.equal(built.root, ROOT_TREE);
  assert.equal(
    commitId({ tree: built.root, parents: [], author: "asha", authoredAt: 1767225600, committer: "asha", committedAt: 1767225600, message: "First commit" }),
    "2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65",
  );
});

test("nested trees agree with the file-based formula", () => {
  const files = new Map([["src/a.ts", "a\n"], ["src/deep/b.ts", "b\n"], ["README.md", "hello\n"], ["z.txt", ""]]);
  const entries = new Map([...files].map(([path, text]) => [path, blobId(Buffer.from(text))]));
  const built = buildTrees(entries);
  assert.equal(built.root, treeIdFromFiles(files));
  assert.equal(built.trees.size, 3);
});

test("an empty snapshot is the empty tree", () => {
  assert.equal(buildTrees(new Map()).root, treeId([]));
});

test("paths", () => {
  assert.equal(isValidPath("a/b.txt"), true);
  for (const bad of ["", "/a", "a//b", "a/./b", "../a", "a/"]) assert.equal(isValidPath(bad), false, bad);
  assert.equal(firstFileFolderClash(["a", "a/b", "c"]), "a");
  assert.equal(firstFileFolderClash(["a/b", "a/c"]), undefined);
});

test("lone surrogates are not UTF-8 text", () => {
  assert.equal(isUtf8Text("ok \u{1F600}"), true);
  assert.equal(isUtf8Text("bad \ud800"), false);
});
