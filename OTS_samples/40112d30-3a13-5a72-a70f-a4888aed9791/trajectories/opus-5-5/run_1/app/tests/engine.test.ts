import assert from "node:assert/strict";
import { test } from "node:test";
import type { Answers, Definition } from "../src/shared/types.js";
import { isEmail, pageErrors } from "../src/server/engine/checks.js";
import { formulaRefusal, locatedProblems } from "../src/server/engine/definition.js";
import { CalcError } from "../src/server/engine/decimal.js";
import { evaluate, toText, type Value } from "../src/server/engine/evaluate.js";
import { parseFormula } from "../src/server/engine/formula.js";
import { buildEvaluation, calcValue, walkForm } from "../src/server/engine/walk.js";

function show(source: string, refs: Record<string, Value> = {}): string {
  try {
    const value = evaluate(parseFormula(source), { today: "2026-03-16", ref: (key) => refs[key] ?? { t: "blank" } });
    if (value.t === "blank") return "Not calculated yet";
    return toText(value);
  } catch (error) {
    if (error instanceof CalcError) return `Cannot calculate: ${error.reason}`;
    throw error;
  }
}

test("arithmetic table", () => {
  const table: [string, string][] = [
    ["0.1 + 0.2", "0.3"],
    ["1.1 * 3", "3.3"],
    ["ROUND(2.675, 2)", "2.68"],
    ["ROUND(1.005, 2)", "1.01"],
    ["ROUND(-2.5, 0)", "-3"],
    ["ROUND(1234.5678, -2)", "1200"],
    ["2 + 3 * 4 ^ 2", "50"],
    ["-2 ^ 2", "-4"],
    ["2 ^ 3 ^ 2", "512"],
    ["(2 + 3) * 4", "20"],
    ["7 % 3", "1"],
    ["-7 % 3", "2"],
    ["10 / 4", "2.5"],
    ["1 / 3 * 3", "0.999999999999"],
    ["2 ^ 0.5", "Cannot calculate: the power must be a whole number from 0 to 64."],
    ["1 / 0", "Cannot calculate: division by zero."],
    ["5 % 0", "Cannot calculate: division by zero."],
    ["2 ^ 65", "Cannot calculate: the power must be a whole number from 0 to 64."],
    ["(10 ^ 60) ^ 20", "Cannot calculate: the number is too large."],
    ["FLOOR(-1.5)", "-2"],
    ["CEIL(-1.5)", "-1"],
    ['DATE("2026-02-30")', "Cannot calculate: it needs a date written YYYY-MM-DD."],
    ['"a" + 1', "Cannot calculate: it needs a number."],
    ['UPPER("ada")', "ADA"],
    ['LOWER("ADA")', "ada"],
    ['LEN("héllo")', "5"],
    ['"Yes" = "yes"', "true"],
    ['1 & " of " & 2', "1 of 2"],
    ['"10" = 10', "false"],
    ['ADD_DAYS(DATE("2026-02-27"), 2)', "1 Mar 2026"],
    ["TODAY()", "16 Mar 2026"],
    ['DAYS(TODAY(), DATE("2026-01-01"))', "74"],
  ];
  for (const [formula, expected] of table) assert.equal(show(formula), expected, formula);
});

test("functions with answers and blanks", () => {
  const refs: Record<string, Value> = {
    n: { t: "text", v: "  ana   maria " },
    s: { t: "date", v: "2026-03-14" },
    e: { t: "date", v: "2026-03-01" },
    b: show("4") === "4" ? { t: "num", v: parseNum("4") } : { t: "blank" },
  };
  const table: [string, string][] = [
    ["TRIM({n})", "ana maria"],
    ["DAYS({s}, {e})", "13"],
    ["DAYS({e}, {s})", "-13"],
    ["ADD_DAYS({s}, 20)", "3 Apr 2026"],
    ["{s} > {e}", "true"],
    ['"Due " & ADD_DAYS({s}, 1)', "Due 15 Mar 2026"],
    ["{a} + 5", "5"],
    ["{a} * 5", "0"],
    ['{a} & "x"', "x"],
    ["{a} = 0", "false"],
    ['{a} = ""', "true"],
    ["{a} > 3", "false"],
    ["{a} < 3", "false"],
    ["{a} <> 3", "true"],
    ["BLANK({a})", "true"],
    ["SUM({a}, {b})", "4"],
    ["AVG({a}, {b})", "4"],
    ["MIN({a}, {b})", "4"],
    ["MAX({a})", "Not calculated yet"],
    ["COUNT({a}, {b})", "1"],
    ["ROUND({a}, 2)", "Not calculated yet"],
    ["{a}", "Not calculated yet"],
    ["DAYS({a}, {b})", "Not calculated yet"],
    ["NOT {a}", "true"],
    ["IF({a}, 1, 2)", "2"],
    ["LEN({a})", "0"],
  ];
  for (const [formula, expected] of table) assert.equal(show(formula, refs), expected, formula);
});

function parseNum(text: string) {
  const value = evaluate(parseFormula(text), { today: "2026-03-16", ref: () => ({ t: "blank" }) });
  if (value.t !== "num") throw new Error("not a number");
  return value.v;
}

test("save-time refusals", () => {
  const table: [string, string][] = [
    ["", "Column 1: the formula is empty."],
    ["1 +", "Column 4: the formula ends too early."],
    ["(1 + 2", "Column 7: a closing bracket is missing."],
    ["SUM(1", "Column 6: a closing bracket is missing."],
    ["1 $ 2", "Column 3: unexpected character $."],
    ['"open', "Column 1: this text has no closing quote."],
    ["ROUND(1)", "Column 1: ROUND takes 2 values."],
    ["IF(1, 2)", "Column 1: IF takes 3 values."],
    ["SUMM(1)", "Column 1: there is no function called SUMM."],
    ["1 2", "Column 3: unexpected 2."],
    ["foo", "Column 1: unexpected foo."],
    ["TODAY(1)", "Column 1: TODAY takes 0 values."],
    ["SUM()", "Column 1: SUM takes at least 1 value."],
    ["FLOOR(1, 2)", "Column 1: FLOOR takes 1 value."],
    [")", "Column 1: unexpected )."],
    ["process.exit()", "Column 8: unexpected character .."],
    ["constructor.constructor(1)", "Column 12: unexpected character .."],
    ["1+" + "1".repeat(499), "The formula is longer than 500 characters."],
    ["(".repeat(17) + "1" + ")".repeat(17), "The formula has more than 16 levels of brackets."],
  ];
  const map = new Map();
  for (const [formula, expected] of table)
    assert.equal(formulaRefusal(formula, { kind: "page_rule", page: 0 }, map), expected, formula);
  assert.equal(formulaRefusal("(".repeat(16) + "1" + ")".repeat(16), { kind: "page_rule", page: 0 }, map), null);
  assert.equal(formulaRefusal("1+" + "1".repeat(498), { kind: "page_rule", page: 0 }, map), null);
});

const bakery: Definition = {
  title: "Bakery pre-order",
  pages: [
    {
      key: "order",
      title: "Your order",
      questions: [
        { key: "loaves", type: "number", label: "Loaves", decimals: 0, min: 0 },
        { key: "rolls", type: "number", label: "Rolls", decimals: 0, min: 0 },
        { key: "delivery", type: "choice", label: "Delivery", options: [{ value: "yes", label: "yes" }, { value: "no", label: "no" }] },
        { key: "people", type: "number", label: "People sharing", decimals: 0 },
        { key: "subtotal", type: "calculated", label: "Subtotal", formula: "{loaves} * 3.35 + {rolls} * 0.45", places: 2, prefix: "£" },
        { key: "discount", type: "calculated", label: "Discount", formula: "ROUND(IF({subtotal} >= 20, {subtotal} * 0.125, 0), 2)", places: 2, prefix: "£" },
        { key: "total", type: "calculated", label: "Total", formula: '{subtotal} - {discount} + IF({delivery} = "yes", 2.5, 0)', places: 2, prefix: "£" },
        { key: "each", type: "calculated", label: "Each", formula: "{total} / {people}", places: 2, prefix: "£" },
        { key: "margin", type: "calculated", label: "Margin", formula: "{total} * 0.3", places: 2, hidden: true },
        { key: "bulk_note", type: "short_text", label: "Collection time for large orders", show_rule: { name: "Large order", when: "{total} >= 20" } },
        { key: "email", type: "short_text", label: "Your email", pattern: "email" },
      ],
    },
  ],
  checks: [],
};

test("bakery table", () => {
  const rows: [string, string, string, string, string[]][] = [
    ["3", "7", "yes", "4", ["£13.20", "£0.00", "£15.70", "£3.93"]],
    ["3", "", "no", "2", ["£10.05", "£0.00", "£10.05", "£5.03"]],
    ["5", "7", "no", "3", ["£19.90", "£0.00", "£19.90", "£6.63"]],
    ["", "", "no", "1", ["£0.00", "£0.00", "£0.00", "£0.00"]],
    ["6", "3", "yes", "", ["£21.45", "£2.68", "£21.27", "Cannot calculate: division by zero."]],
    ["7", "1", "no", "2", ["£23.90", "£2.99", "£20.91", "£10.46"]],
    ["8", "4", "no", "3", ["£28.60", "£3.58", "£25.02", "£8.34"]],
  ];
  assert.deepEqual(locatedProblems(bakery), []);
  for (const [loaves, rolls, delivery, people, expected] of rows) {
    const answers: Answers = { loaves, rolls, delivery, people };
    const walk = walkForm(bakery, answers, "2026-03-16");
    const keys = ["subtotal", "discount", "total", "each"];
    const shown = keys.map((k) => calcValue(bakery.pages[0].questions.find((q) => q.key === k)!, walk).text);
    assert.deepEqual(shown, expected);
    const evaluation = buildEvaluation(walk, { seq: 1, audience: "respondent" });
    assert.equal(evaluation.values.margin, undefined);
  }
});

const supper: Definition = {
  title: "Supper club RSVP",
  pages: [
    {
      key: "about",
      title: "About you",
      questions: [
        { key: "attending", type: "choice", label: "Are you coming?", required: true, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] },
        { key: "guests", type: "number", label: "How many guests?", help: "Count yourself.", required: false, min: 1, max: 8, decimals: 0 },
      ],
      jumps: [{ name: "Not attending", when: '{attending} = "No"', to: "thanks" }],
    },
    {
      key: "meals",
      title: "Meals",
      questions: [
        { key: "meal", type: "dropdown", label: "Main course", required: true, options: [{ value: "Vegetarian", label: "Vegetarian" }, { value: "Fish", label: "Fish" }] },
        { key: "diet", type: "short_text", label: "Which diet?", required: false, max_length: 40, show_rule: { name: "Vegetarian meal", when: '{meal} = "Vegetarian"' } },
      ],
    },
    {
      key: "travel",
      title: "Travel",
      show_rule: { name: "Two or more guests", when: "{guests} >= 2" },
      questions: [{ key: "parking", type: "choice", label: "Do you need parking?", required: true, options: [{ value: "Yes", label: "Yes" }, { value: "No", label: "No" }] }],
    },
    { key: "thanks", title: "Anything else", questions: [{ key: "comment", type: "long_text", label: "Anything to add about your {{meal}} meal?", required: false }] },
  ],
  checks: [],
};

test("supper club walk", () => {
  const base: Answers = { attending: "Yes", guests: "3", meal: "Vegetarian", diet: "Vegan", parking: "Yes" };
  const lit = (answers: Answers) => {
    const walk = walkForm(supper, answers, "2026-03-16");
    return { pages: walk.litPages, questions: [...walk.questions].filter(([, s]) => s.state === "lit").map(([k]) => k), walk };
  };
  assert.deepEqual(lit(base).pages, ["about", "meals", "travel", "thanks"]);
  assert.deepEqual(lit({ ...base, guests: "1" }).pages, ["about", "meals", "thanks"]);
  const no = lit({ ...base, guests: "1", attending: "No" });
  assert.deepEqual(no.pages, ["about", "thanks"]);
  assert.deepEqual(no.questions, ["attending", "guests", "comment"]);
  const fish = lit({ ...base, meal: "Fish" });
  assert.deepEqual(fish.questions, ["attending", "guests", "meal", "parking", "comment"]);
  const blank = lit({ ...base, guests: "" });
  assert.deepEqual(blank.pages, ["about", "meals", "thanks"]);
  const before = lit(base).walk;
  const after = walkForm(supper, { ...base, attending: "No" }, "2026-03-16");
  const evaluation = buildEvaluation(after, { seq: 2, audience: "respondent", previous: before });
  assert.equal(evaluation.hidden_now, 3);
  assert.equal(evaluation.pages[1].skipped_by, "Not attending");
  assert.equal(evaluation.pages[3].questions[0].label, "Anything to add about your (not answered yet) meal?");
  const ev2 = buildEvaluation(before, { seq: 1, audience: "respondent" });
  assert.equal(ev2.pages[3].questions[0].label, "Anything to add about your Vegetarian meal?");
});

test("email check matches the published pattern", () => {
  const pattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  for (const text of ["a@b.c", "a@.c", "a@b.", "a@b..c", "@b.c", "a@b@c.d", "a b@c.d", "a@bc", "name@example.com", "a@b.c.d", "a@.b.c"])
    assert.equal(isEmail(text), pattern.test(text), text);
});

test("budget check", () => {
  const def: Definition = {
    title: "Household budget",
    pages: [
      {
        key: "budget",
        title: "Budget",
        questions: [
          { key: "rent", type: "number", label: "Rent percent", required: true, decimals: 1 },
          { key: "food", type: "number", label: "Food percent", required: true, decimals: 1 },
          { key: "other", type: "number", label: "Other percent", required: true, decimals: 1 },
          { key: "pct_total", type: "calculated", label: "Percent total", formula: "{rent} + {food} + {other}" },
        ],
      },
    ],
    checks: [{ name: "Adds to 100", page: "budget", target: "other", fail_when: "{pct_total} <> 100", message: "The percentages must total 100. They total {{pct_total}}." }],
  };
  assert.deepEqual(locatedProblems(def), []);
  const run = (a: string, b: string, c: string) => pageErrors(walkForm(def, { rent: a, food: b, other: c }, "2026-03-16"), "budget");
  assert.deepEqual(run("33.3", "33.3", "33.4"), []);
  assert.deepEqual(run("70.1", "29.8", "0.1"), []);
  assert.deepEqual(run("0.1", "0.2", "99.7"), []);
  assert.equal(run("33.3", "33.3", "33.3")[0].message, "The percentages must total 100. They total 99.9.");
  assert.equal(run("50", "50", "1").length, 1);
  assert.equal(run("", "x", "1.25").map((e) => e.message).join("|"), "Rent percent: answer this question.|Food percent: enter a number.|Other percent: use at most 1 decimal places.");
});
