import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  allowedTargets,
  exceedsVisibility,
  groupLevels,
  groupPathProblem,
  isRegex,
  isSegment,
  NEST_MESSAGE,
  parentPath,
  sameList,
  SEGMENT_MESSAGE,
  signature,
  targetAllowed,
  targetOf,
} from "../src/server/admin/rules.ts";

test("path segments are 2 to 40 characters of a-z, 0-9 and -", () => {
  assert.equal(isSegment("ab"), true);
  assert.equal(isSegment("a"), false);
  assert.equal(isSegment("a".repeat(40)), true);
  assert.equal(isSegment("a".repeat(41)), false);
  assert.equal(isSegment("Cold"), false);
  assert.equal(isSegment("cold_brook"), false);
  assert.equal(isSegment("cold-brook-2"), true);
  assert.equal(isSegment("a/b"), false);
});

test("a group path nests at most four levels", () => {
  assert.equal(groupPathProblem("acme/apps/web/ui"), null);
  assert.equal(groupPathProblem("acme/apps/web/ui/extra"), NEST_MESSAGE);
  assert.equal(groupPathProblem("acme/x"), SEGMENT_MESSAGE);
  assert.equal(groupLevels("a/b/c"), 3);
  assert.equal(parentPath("acme/apps"), "acme");
  assert.equal(parentPath("acme"), null);
});

test("a child group is never more visible than its parent", () => {
  assert.equal(exceedsVisibility("public", "private"), true);
  assert.equal(exceedsVisibility("internal", "private"), true);
  assert.equal(exceedsVisibility("internal", "internal"), false);
  assert.equal(exceedsVisibility("private", "public"), false);
});

test("webhook targets compare host and port, with 80 and 443 as defaults", () => {
  assert.equal(targetOf("http://example.test/hook"), "example.test:80");
  assert.equal(targetOf("https://Example.test/hook"), "example.test:443");
  assert.equal(targetOf("http://127.0.0.1:4173/api/x"), "127.0.0.1:4173");
  assert.equal(targetOf("ftp://example.test/"), null);
  assert.equal(targetOf("not a url"), null);
  assert.equal(targetAllowed("http://127.0.0.1:4173/a", ["127.0.0.1:4173"]), true);
  assert.equal(targetAllowed("http://127.0.0.1:9/a", ["127.0.0.1:4173"]), false);
  assert.equal(targetAllowed("http://127.0.0.1:4173/a", []), false);
  assert.equal(targetAllowed("http://hooks.test/a", ["hooks.test"]), true);
  assert.equal(targetAllowed("https://hooks.test/a", ["hooks.test"]), true);
  assert.equal(targetAllowed("http://hooks.test:8080/a", ["hooks.test"]), false);
  assert.deepEqual([...allowedTargets(["A.test:81"])], ["a.test:81"]);
});

test("the signature is HMAC-SHA256 over timestamp, a dot and the raw body", () => {
  const expected = createHmac("sha256", "s3cret-value").update('1767225600.{"event":"push"}').digest("hex");
  assert.equal(signature("s3cret-value", 1767225600, '{"event":"push"}'), `sha256=${expected}`);
  assert.notEqual(signature("s3cret-value", 1767225601, '{"event":"push"}'), `sha256=${expected}`);
});

test("push rule patterns must be regular expressions", () => {
  assert.equal(isRegex("^(feat|fix)/"), true);
  assert.equal(isRegex("("), false);
});

test("lists compare by item and order", () => {
  assert.equal(sameList(["a", "b"], ["a", "b"]), true);
  assert.equal(sameList(["a", "b"], ["b", "a"]), false);
  assert.equal(sameList([], ["a"]), false);
});
