import { test } from "node:test";
import assert from "node:assert/strict";
import { patternMatches } from "../src/server/repo/patterns.ts";

test("a name equals the pattern or fits its wildcards", () => {
  assert.equal(patternMatches("main", "main"), true);
  assert.equal(patternMatches("main", "main2"), false);
  assert.equal(patternMatches("v*", "v1.0"), true);
  assert.equal(patternMatches("v*", "xv1"), false);
  assert.equal(patternMatches("release/*", "release/2026/q1"), true);
  assert.equal(patternMatches("*", "anything/at all"), true);
  assert.equal(patternMatches("a.b", "aXb"), false);
  assert.equal(patternMatches("a+(b)*", "a+(b)c"), true);
});
