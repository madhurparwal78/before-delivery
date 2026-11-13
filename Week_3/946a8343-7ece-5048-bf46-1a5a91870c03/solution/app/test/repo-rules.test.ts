import { test } from "node:test";
import assert from "node:assert/strict";
import { firstViolation, matchesPattern, requiredFilePresent, type AddedLines, type PushFacts, type PushRules } from "../src/server/repo/rules.ts";

const open: PushRules = { branch_name: null, commit_message: null, forbidden_files: [], required_files: [], secrets: false };

function facts(overrides: Omit<Partial<PushFacts>, "added"> & { added?: readonly AddedLines[] } = {}): PushFacts {
  const { added = [], ...rest } = overrides;
  return {
    branch: "feat/x", isNewBranch: true, message: "Add", changed: [], result: new Set(["README.md"]), added: async () => added, ...rest,
  };
}

test("an invalid pattern matches nothing", () => {
  assert.equal(matchesPattern("^(feat", "feat/x"), false);
  assert.equal(matchesPattern("^(feat|fix)/", "fix/y"), true);
});

test("the branch name rule applies to new branches only", async () => {
  const rules = { ...open, branch_name: "^(feat|fix)/" };
  const bad = await firstViolation(rules, facts({ branch: "bad-name" }));
  assert.equal(bad?.message, "Branch name bad-name doesn't match ^(feat|fix)/.");
  assert.equal(await firstViolation(rules, facts({ branch: "bad-name", isNewBranch: false })), null);
});

test("an invalid branch pattern is a violation, not an error", async () => {
  const bad = await firstViolation({ ...open, branch_name: "(" }, facts());
  assert.equal(bad?.message, "Branch name feat/x doesn't match (.");
});

test("rules run in the published order", async () => {
  const rules: PushRules = { branch_name: "^zzz", commit_message: "^[A-Z]", forbidden_files: ["*.pem"], required_files: ["README.md"], secrets: true };
  const everything = facts({ message: "lower", changed: ["key.pem"], result: new Set(["key.pem"]), added: [{ path: "key.pem", lines: [{ line: 1, text: "AK" + "ABCDEFGHIJKLMNOPQR" }] }] });
  assert.equal((await firstViolation(rules, everything))?.message, "Branch name feat/x doesn't match ^zzz.");
  assert.equal((await firstViolation({ ...rules, branch_name: null }, everything))?.message, "Commit message doesn't match ^[A-Z].");
  assert.equal((await firstViolation({ ...rules, branch_name: null }, { ...everything, message: "Add" }))?.message, "File key.pem is forbidden by push rule *.pem.");
  assert.equal(
    (await firstViolation({ ...rules, branch_name: null, forbidden_files: [] }, { ...everything, message: "Add" }))?.message,
    "Required file README.md is missing.",
  );
  assert.equal(
    (await firstViolation({ ...rules, branch_name: null, forbidden_files: [], required_files: [] }, { ...everything, message: "Add" }))?.message,
    "Secret found:" + " cloud-key in key.pem at line 1.",
  );
});

test("secrets are reported by path, then line, with the first matching pattern", async () => {
  const rules = { ...open, secrets: true };
  const added: AddedLines[] = [
    { path: "a.txt", lines: [{ line: 1, text: "fine" }, { line: 2, text: 'password = "super' + 'secret1"' }, { line: 3, text: "AK" + "ABCDEFGHIJKLMNOPQR" }] },
    { path: "b.txt", lines: [{ line: 1, text: "sptk_" + "ABCDEFGHIJKLMNOPQRST" }] },
  ];
  assert.equal((await firstViolation(rules, facts({ added })))?.message, "Secret found: password-line in a.txt at line 2.");
  const keys: AddedLines[] = [{ path: "k.pem", lines: [{ line: 4, text: "-----BEGIN RSA " + "PRIVATE KEY-----" }] }];
  assert.equal((await firstViolation(rules, facts({ added: keys })))?.message, "Secret found: private-key in k.pem at line 4.");
  const upper: AddedLines[] = [{ path: "c.txt", lines: [{ line: 1, text: 'PASSWORD="short"' }, { line: 2, text: 'PASSWORD="longenough"' }] }];
  assert.equal((await firstViolation(rules, facts({ added: upper })))?.message, "Secret found: password-line in c.txt at line 2.");
});

test("secrets are not looked for when the rule is off", async () => {
  const added: AddedLines[] = [{ path: "a.txt", lines: [{ line: 1, text: "AK" + "ABCDEFGHIJKLMNOPQR" }] }];
  assert.equal(await firstViolation(open, facts({ added })), null);
});

test("required files match a path exactly or by glob", () => {
  const paths = new Set(["README.md", "docs/guide.md"]);
  assert.equal(requiredFilePresent("README.md", paths), true);
  assert.equal(requiredFilePresent("guide.md", paths), false);
  assert.equal(requiredFilePresent("docs/*.md", paths), true);
  assert.equal(requiredFilePresent("*.txt", paths), false);
});
