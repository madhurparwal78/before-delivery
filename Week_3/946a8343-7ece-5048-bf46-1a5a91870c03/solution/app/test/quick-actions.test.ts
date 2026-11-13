import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  isValidWeight,
  labelChange,
  parseCommentBody,
  parseDuration,
  parseNames,
  parseWeight,
} from "../src/server/lib/quick-actions.ts";
import { scopedKey } from "../src/shared/labels.ts";

test("recognised actions leave the comment, unknown ones stay as text", () => {
  const body = "Working on it\n/label ~priority" + "::high ~type::bug\n/frobnicate now\n/close\n/weight 5\r\n/closed\n  /reopen\nDone";
  const { text, actions } = parseCommentBody(body);
  assert.equal(text, "Working on it\n/frobnicate now\n/closed\n  /reopen\nDone");
  assert.deepEqual(actions, [
    { name: "label", args: "~priority::high ~type::bug", raw: "/label ~priority" + "::high ~type::bug" },
    { name: "close", args: "", raw: "/close" },
    { name: "weight", args: "5", raw: "/weight 5" },
  ]);
  assert.deepEqual(parseCommentBody("/promote"), { text: "", actions: [{ name: "promote", args: "", raw: "/promote" }] });
  assert.equal(parseCommentBody("/title  Fix the thing ").actions[0]?.args, "Fix the thing");
});

test("names, with quotes", () => {
  assert.deepEqual(parseNames('~a ~"needs review" ~b', "~"), ["a", "needs review", "b"]);
  assert.deepEqual(parseNames("@asha @cy", "@"), ["asha", "cy"]);
  assert.deepEqual(parseNames('%"Sprint 1"', "%"), ["Sprint 1"]);
  assert.deepEqual(parseNames("", "~"), []);
});

test("durations", () => {
  assert.equal(parseDuration("2d 3h"), 2 * 480 + 180);
  assert.equal(parseDuration("1w 6d"), 5280);
  assert.equal(parseDuration("1mo"), 9600);
  assert.equal(parseDuration("90m"), 90);
  for (const bad of ["3x", "", "d", "1.5h", "-1h", "2 d", "h2", "1d x"]) assert.equal(parseDuration(bad), null, bad);
  assert.equal(formatDuration(5280), "2w 1d");
  assert.equal(formatDuration(parseDuration("1w 6d") ?? 0), "2w 1d");
  assert.equal(formatDuration(9600), "1mo");
  assert.equal(formatDuration(90), "1h 30m");
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(parseDuration("4w 1m") ?? 0), "1mo 1m");
});

test("weights", () => {
  assert.equal(parseWeight("5"), 5);
  assert.equal(parseWeight("100"), 100);
  assert.equal(parseWeight("101"), null);
  assert.equal(parseWeight("-1"), null);
  assert.equal(parseWeight("1.5"), null);
  assert.ok(isValidWeight(0) && !isValidWeight(101) && !isValidWeight(2.5));
});

test("scoped keys use the last separator", () => {
  assert.equal(scopedKey("priority::high"), "priority");
  assert.equal(scopedKey("a::b::c"), "a::b");
  assert.equal(scopedKey("bug"), null);
  assert.equal(scopedKey("::x"), null);
  assert.equal(scopedKey("x::"), null);
});

test("label change notes", () => {
  const replaced = labelChange(["priority::low"], ["priority::high", "type::bug"], []);
  assert.deepEqual(replaced.labels, ["priority::high", "type::bug"]);
  assert.deepEqual(replaced.notes, ["Replaced ~priority::low with ~priority::high.", "Added ~type::bug."]);

  const move = labelChange(["type::bug", "ui"], ["workflow::doing"], ["type::bug"]);
  assert.deepEqual(move.labels, ["ui", "workflow::doing"]);
  assert.deepEqual(move.notes, ["Added ~workflow::doing.", "Removed ~type::bug."]);

  const full = labelChange(["a", "s::1", "b"], ["s::2", "c", "d"], ["a"]);
  assert.deepEqual(full.notes, ["Replaced ~s::1 with ~s::2.", "Added ~c ~d.", "Removed ~a."]);

  const twice = labelChange(["p::low"], ["p::a", "p::b"], []);
  assert.deepEqual(twice.labels, ["p::b"]);
  assert.deepEqual(twice.notes, ["Replaced ~p::low with ~p::b."]);

  const fresh = labelChange([], ["p::a", "p::b"], []);
  assert.deepEqual(fresh.labels, ["p::b"]);
  assert.deepEqual(fresh.notes, ["Added ~p::b."]);

  const nothing = labelChange(["x", "p::a"], ["x", "p::a"], ["absent"]);
  assert.deepEqual(nothing, { labels: ["x", "p::a"], notes: [] });

  assert.deepEqual(labelChange(["a", "b"], [], ["a", "b"]).notes, ["Removed ~a ~b."]);
});
