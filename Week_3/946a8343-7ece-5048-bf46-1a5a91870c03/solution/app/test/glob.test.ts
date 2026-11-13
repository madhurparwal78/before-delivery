import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesGlob } from "../src/shared/glob.ts";
import { blobId, commitId, treeId } from "../src/server/lib/objects.ts";

test("glob forms", () => {
  assert.ok(matchesGlob("*.md", "README.md"));
  assert.ok(matchesGlob("*.md", "docs/a.md"));
  assert.ok(matchesGlob("/src/", "src/app.ts"));
  assert.ok(!matchesGlob("/src/", "lib/src/app.ts"));
  assert.ok(matchesGlob("src/legacy/", "src/legacy/old.ts"));
  assert.ok(matchesGlob("**/*.ts", "a/b/c.ts"));
  assert.ok(!matchesGlob("/*.md", "docs/a.md"));
  assert.ok(matchesGlob("*", "any/where.txt"));
});

test("published worked example hashes", () => {
  const blob = blobId(Buffer.from("hello\n"));
  assert.equal(blob, "de5777551c59cba3dac8b9831f889bab03ece9824236e20616ac48bbefdc5594");
  const tree = treeId([{ name: "README.md", mode: "100644", id: blob }]);
  assert.equal(tree, "d0604e08d4be0b90d067bc3f6f5d0d3fc5000d1822a8a487d4db71b94690e941");
  const commit = commitId({ tree, parents: [], author: "asha", authoredAt: 1767225600, committer: "asha", committedAt: 1767225600, message: "First commit" });
  assert.equal(commit, "2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65");
});
