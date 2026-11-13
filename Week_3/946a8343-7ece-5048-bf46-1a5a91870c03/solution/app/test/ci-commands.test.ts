import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/server/ci/commands.ts";

test("print keeps the rest of the line", () => {
  assert.deepEqual(parseCommand("print hello  world"), { kind: "print", text: "hello  world" });
  assert.deepEqual(parseCommand("print"), { kind: "print", text: "" });
});

test("write takes a path and the rest of the line", () => {
  assert.deepEqual(parseCommand("write dist/app.txt tidepool build"), { kind: "write", path: "dist/app.txt", text: "tidepool build" });
  assert.deepEqual(parseCommand("write a.txt"), { kind: "write", path: "a.txt", text: "" });
  assert.equal(parseCommand("write ../a.txt x").kind, "unknown");
  assert.equal(parseCommand("write /a.txt x").kind, "unknown");
});

test("wait and exit take whole numbers", () => {
  assert.deepEqual(parseCommand("wait 1000"), { kind: "wait", ms: 1000 });
  assert.deepEqual(parseCommand("exit 0"), { kind: "exit", code: 0 });
  assert.deepEqual(parseCommand("exit 3"), { kind: "exit", code: 3 });
  assert.equal(parseCommand("wait soon").kind, "unknown");
  assert.equal(parseCommand("exit").kind, "unknown");
});

test("emit names a report kind and a path", () => {
  assert.deepEqual(parseCommand("emit tests r/t.json"), { kind: "emit", report: "tests", path: "r/t.json" });
  assert.equal(parseCommand("emit logs r/t.json").kind, "unknown");
  assert.equal(parseCommand("emit tests").kind, "unknown");
});

test("anything else is unknown and keeps its text", () => {
  assert.deepEqual(parseCommand("rm -rf /"), { kind: "unknown", text: "rm -rf /" });
  assert.deepEqual(parseCommand(""), { kind: "unknown", text: "" });
});
