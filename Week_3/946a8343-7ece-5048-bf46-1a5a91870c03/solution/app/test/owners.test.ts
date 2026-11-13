import { test } from "node:test";
import assert from "node:assert/strict";
import { ownersForFiles, parseOwners } from "../src/server/lib/owners.ts";

const resolver = (owner: string): boolean => ["boss", "rev", "maint", "acme/core"].includes(owner);

const FILE = [
  "* @boss",
  "[Backend][2]",
  "/src/ @rev @maint",
  "src/legacy/ @maint",
  "[Docs]",
  "*.md @rev",
  "^[Optional]",
  "*.ts @maint",
  "[Tail]",
  "nofiles",
  "*.txt @nouser",
  "*.cfg @nogroup/x",
  "[Bad",
  "[Count][x]",
].join("\n");

test("sections, counts and problems", () => {
  const { sections, problems } = parseOwners(FILE, resolver);
  assert.deepEqual(
    sections.map((s) => [s.name, s.optional, s.count, s.lines.length]),
    [
      ["Owners", false, 1, 1],
      ["Backend", false, 2, 2],
      ["Docs", false, 1, 1],
      ["Optional", true, 1, 1],
      ["Tail", false, 1, 0],
    ],
  );
  assert.deepEqual(problems, [
    { line: 10, reason: "no owners" },
    { line: 11, reason: "unknown user @nouser" },
    { line: 12, reason: "unknown group @nogroup/x" },
    { line: 13, reason: "bad section header" },
    { line: 14, reason: "bad count" },
  ]);
});

test("last matching line wins per file and owners are a de-duplicated union", () => {
  const { sections } = parseOwners(FILE, resolver);
  const applied = ownersForFiles(sections, ["src/app.ts", "src/legacy/old.ts"]);
  assert.deepEqual(applied, [
    { name: "Owners", optional: false, count: 1, owners: ["boss"], files: ["src/app.ts", "src/legacy/old.ts"] },
    { name: "Backend", optional: false, count: 2, owners: ["rev", "maint"], files: ["src/app.ts", "src/legacy/old.ts"] },
    { name: "Optional", optional: true, count: 1, owners: ["maint"], files: ["src/app.ts", "src/legacy/old.ts"] },
  ]);
  const legacyOnly = ownersForFiles(sections, ["src/legacy/old.ts"]);
  assert.deepEqual(legacyOnly[1]?.owners, ["maint"]);
});

test("a section with no matching changed file does not apply", () => {
  const { sections } = parseOwners(FILE, resolver);
  assert.deepEqual(ownersForFiles(sections, ["README.md"]).map((s) => s.name), ["Owners", "Docs"]);
  assert.deepEqual(ownersForFiles(sections, []), []);
});

test("group owners, first reason wins and one problem per line", () => {
  const { sections, problems } = parseOwners("*.go @acme/core @boss\nx @ghost @nogroup/y\n\n  # \n", resolver);
  assert.deepEqual(sections[0]?.lines[0]?.owners, ["acme/core", "boss"]);
  assert.deepEqual(problems, [
    { line: 2, reason: "unknown user @ghost" },
    { line: 4, reason: "no owners" },
  ]);
});

test("lines under a malformed header are never matched", () => {
  const { sections, problems } = parseOwners("[Bad\n*.ts @boss\n[Good]\n*.md @rev\n", resolver);
  assert.deepEqual(sections.map((s) => s.name), ["Good"]);
  assert.deepEqual(problems, [{ line: 1, reason: "bad section header" }]);
  assert.deepEqual(parseOwners("[]\n[Name][0]\n", resolver).problems, [
    { line: 1, reason: "bad section header" },
    { line: 2, reason: "bad count" },
  ]);
});
