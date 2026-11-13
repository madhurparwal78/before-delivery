import { checkChart, type CheckChartInput } from "../server/chart/check";
import { applyTextToRow } from "../server/chart/apply";

function chart(
  cellsByRow: Record<number, string>,
  castOn: number,
  width: number,
  height: number,
  mode: "flat" | "round" = "flat",
  craft: "knit" | "crochet" = "knit",
  terms: "us" | "uk" | null = null,
  colourRows: Record<number, string> = {},
): CheckChartInput {
  const cells: { row: number; col: number; stitch: string; colour: string }[] = [];
  for (let row = 1; row <= height; row++) {
    const symbols = (cellsByRow[row] ?? "").split(/\s+/).filter(Boolean);
    const colours = (colourRows[row] ?? "").split(/\s+/).filter(Boolean);
    for (let col = 1; col <= width; col++) {
      cells.push({
        row,
        col,
        stitch: symbols[col - 1] ?? "ns",
        colour: colours[col - 1] ?? "A",
      });
    }
  }
  return { craft, mode, terms, castOn, width, height, repeats: [], cells };
}

let failures = 0;
function expect(actual: unknown, wanted: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(wanted);
  if (a !== b) {
    failures++;
    console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

// Shaping example from the Row rule.
const shaping = checkChart(
  chart(
    {
      1: "k k k k k k k k k k k k",
      2: "k k k k k k k k k k k k",
      3: "ns k k2tog k k k k k k ssk k ns",
      4: "ns k ssk k k k k k2tog k ns ns ns",
      5: "ns k k k k k k k k ns ns ns",
      6: "ns k k k k k k k k ns ns ns",
      7: "ns k m1r k k k k k k m1l k ns",
    },
    12,
    12,
    7,
  ),
);
expect(shaping.errors, [], "shaping has no errors");
const shapingText = shaping.rows.map((row) => row.text).filter(Boolean);
expect(shapingText, [
  "Row 1 (RS): k12. (12 sts)",
  "Row 2 (WS): p12. (12 sts)",
  "Row 3 (RS): k1, ssk, k6, k2tog, k1. (10 sts)",
  "Row 4 (WS): p1, ssp, p4, p2tog, p1. (8 sts)",
  "Row 5 (RS): k8. (8 sts)",
  "Row 6 (WS): p8. (8 sts)",
  "Row 7 (RS): k1, m1l, k6, m1r, k1. (10 sts)",
], "shaping lines");

// Rib example.
const ribCells = "k k p p k k p p k k";
const rib = checkChart(chart({ 1: ribCells, 2: ribCells }, 10, 10, 2));
expect(rib.rows[0]!.text, "Row 1 (RS): *k2, p2; rep from * to last 2 sts, k2. (10 sts)", "rib row 1");
expect(rib.rows[1]!.text, "Row 2 (WS): *p2, k2; rep from * to last 2 sts, p2. (10 sts)", "rib row 2");

// Round rib: 24 stitches of k k p p.
const roundCells: string[] = [];
for (let i = 0; i < 24; i++) roundCells.push(i % 4 < 2 ? "k" : "p");
const round = checkChart(chart({ 1: roundCells.join(" "), 2: roundCells.join(" ") }, 24, 24, 2, "round"));
expect(round.rows[0]!.text, "Rnd 1: *p2, k2; rep from * to end. (24 sts)", "round 1");
expect(round.rows[1]!.text, "Rnd 2: *p2, k2; rep from * to end. (24 sts)", "round 2");

// Lace example.
const lace = checkChart(chart({ 3: "k yo k2tog yo k2tog yo k2tog yo k2tog k" }, 10, 10, 7));
expect(lace.rows[2]!.text, "Row 3 (RS): k1, *k2tog, yo; rep from * to last st, k1. (10 sts)", "lace row 3");

// k1 p1 with k4 tail.
const k1p1 = checkChart(chart({ 1: "k k k k p k p k" }, 8, 8, 2));
expect(k1p1.rows[0]!.text, "Row 1 (RS): *k1, p1; rep from * to last 4 sts, k4. (8 sts)", "k1 p1 tail 4");

// Nested starts.
const lateStart = checkChart(chart({ 1: "k p k p k p p k" }, 8, 8, 2));
expect(lateStart.rows[0]!.text, "Row 1 (RS): k1, p1, *p1, k1; rep from * to end. (8 sts)", "late repeat start");

// yo tail with no stitches.
const yoTail = checkChart(chart({ 1: "yo k p k p" }, 5, 5, 2));
expect(yoTail.rows[0]!.text, "Row 1 (RS): *p1, k1; rep from * to end, yo. (5 sts)", "yo tail");

// Cables.
const cables = checkChart(chart({ 1: "p c22 c22 c22 c22 p p c22 c22 c22 c22 p" }, 12, 12, 2));
expect(cables.rows[0]!.text, "Row 1 (RS): *p1, 2/2 LC, p1; rep from * to end. (12 sts)", "cables row 1");
expect(cables.errors, [], "cables no errors");

// Broken cable run: leftover of three reads as one item using 3.
const broken = checkChart(chart({ 1: "p c22 c22 c22 p p" }, 6, 6, 2));
expect(broken.errors.map((entry) => entry.message), ["Row 1: a 2/2 cable needs 4 cells."], "broken cable");

// Wrong-side cable.
const wsCable = checkChart(chart({ 2: "c22 c22 c22 c22" }, 4, 4, 2));
expect(
  wsCable.errors.map((entry) => entry.message).includes("Row 2: 2/2 LC can only be worked on a right-side row."),
  true,
  "wrong-side cable",
);

// Crochet US.
const crochetUs = checkChart(
  chart(
    {
      1: "sc sc sc sc sc sc ns ns",
      2: "sc inc sc sc inc sc ns ns",
      3: "dc dc dc dc dc dc dc dc",
      4: "dec dc dc dc dec dc ns ns",
    },
    6,
    8,
    4,
    "flat",
    "crochet",
    "us",
  ),
);
expect(crochetUs.rows.map((row) => row.text), [
  "Row 1 (RS): sc6. (6 sts)",
  "Row 2 (WS): *sc1, inc, sc1; rep from * to end. (8 sts)",
  "Row 3 (RS): dc8. (8 sts)",
  "Row 4 (WS): dec, dc3, dec, dc1. (6 sts)",
], "crochet US lines");

// Crochet UK.
const crochetUk = checkChart(
  chart(
    {
      1: "sc sc sc sc sc sc ns ns",
      2: "sc inc sc sc inc sc ns ns",
      3: "dc dc dc dc dc dc dc dc",
      4: "dec dc dc dc dec dc ns ns",
    },
    6,
    8,
    4,
    "flat",
    "crochet",
    "uk",
  ),
);
expect(crochetUk.rows.map((row) => row.text), [
  "Row 1 (RS): dc6. (6 sts)",
  "Row 2 (WS): *dc1, inc, dc1; rep from * to end. (8 sts)",
  "Row 3 (RS): tr8. (8 sts)",
  "Row 4 (WS): dec, tr3, dec, tr1. (6 sts)",
], "crochet UK lines");

// Colour runs.
const colourRun = checkChart(
  chart({ 1: "k k k k k k k k k k" }, 10, 10, 2, "round", "knit", null, {
    1: "A A B B B B B B A A",
  }),
);
expect(colourRun.rows[0]!.text, "Rnd 1: k2 in A, k6 in B, k2 in A. (10 sts)", "colour run");

const colourAlt = checkChart(
  chart({ 1: "k k k k k k k k" }, 8, 8, 2, "round", "knit", null, { 1: "A B A B A B A B" }),
);
expect(colourAlt.rows[0]!.text, "Rnd 1: *k1 in B, k1 in A; rep from * to end. (8 sts)", "colour alternation");

// Row errors.
const unbalanced = checkChart(chart({ 1: "k k k k k k k k k k k k k k k k k k k k k k k k", 2: "k k k k k k k k k k k k k k k k k k k k k k k ns" }, 24, 24, 2));
expect(unbalanced.errors.map((entry) => entry.message), ["Row 2 needs 24 stitches, found 23."], "unbalanced row");

// Repeat box expansion in counts.
const boxed = checkChart({
  craft: "knit",
  mode: "flat",
  terms: null,
  castOn: 8,
  width: 4,
  height: 1,
  repeats: [{ id: "A", fromCol: 2, toCol: 3, fromRow: 1, toRow: 1, times: 3 }],
  cells: [
    { row: 1, col: 1, stitch: "k", colour: "A" },
    { row: 1, col: 2, stitch: "p", colour: "A" },
    { row: 1, col: 3, stitch: "p", colour: "A" },
    { row: 1, col: 4, stitch: "k", colour: "A" },
  ],
});
expect(boxed.rows[0]!.text, "Row 1 (RS): k1, p6, k1. (8 sts)", "repeat box expansion");
expect(boxed.errors, [], "repeat box no errors");

// Text grammar worked examples.
const textChart = (width: number, castOn: number, height: number, mode: "flat" | "round" = "flat") => ({
  craft: "knit" as const,
  mode,
  terms: null,
  castOn,
  width,
  height,
  repeats: [] as { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }[],
  cells: [] as { row: number; col: number; stitch: string; colour: string }[],
  colourLetters: () => ["A", "B"],
});

// Good text applies.
const applied = applyTextToRow({ ...textChart(10, 10, 2), cells: fullRowCells(10, 2) }, 1, "k4, p6.");
expect(applied.ok, true, "text applies");
if (applied.ok) {
  const cols = new Map(applied.cells.filter((cell) => cell.stitch !== "ns").map((cell) => [cell.col, cell.stitch]));
  expect(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((col) => cols.get(col)).join(" "),
    "p p p p p p k k k k",
    "text cell placement",
  );
}

function fullRowCells(width: number, height: number) {
  const cells: { row: number; col: number; stitch: string; colour: string }[] = [];
  for (let row = 1; row <= height; row++) {
    for (let col = 1; col <= width; col++) {
      cells.push({ row, col, stitch: row === 1 ? "k" : "ns", colour: "A" });
    }
  }
  return cells;
}

// Errors.
const labelWrong = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "Row 4 (WS): k4.");
expect(labelWrong.ok, false, "label wrong rejected");
if (!labelWrong.ok) expect(labelWrong.error.message, "Row 3, position 1: the label says Row 4.", "label wrong message");

const unknown = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "yo, k2tog, k2t.");
expect(unknown.ok, false, "unknown stitch rejected");
if (!unknown.ok) expect(unknown.error.message, 'Row 3, position 12: unknown stitch "k2t".', "unknown stitch message");

const separator = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "k1, p1, k10 p1.");
expect(separator.ok, false, "separator rejected");
if (!separator.ok) expect(separator.error.message, "Row 3, position 12: expected a comma or a full stop.", "separator message");

const wrongSide = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 4, "p1, k2tog, p1.");
expect(wrongSide.ok, false, "wrong-side stitch rejected");
if (!wrongSide.ok) expect(wrongSide.error.message, "Row 4, position 5: k2tog is not valid on a wrong-side row.", "wrong-side message");

const rightSide = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "k1, p2tog.");
expect(rightSide.ok, false, "right-side stitch rejected");
if (!rightSide.ok) expect(rightSide.error.message, "Row 3, position 5: p2tog is not valid on a right-side row.", "right-side message");

const crochetTerms = applyTextToRow(
  {
    craft: "crochet" as const,
    mode: "flat" as const,
    terms: "uk" as const,
    castOn: 6,
    width: 8,
    height: 4,
    repeats: [],
    cells: fullRowCells(8, 4),
    colourLetters: () => ["A"],
  },
  2,
  "hdc4.",
);
expect(crochetTerms.ok, false, "crochet terms rejected");
if (!crochetTerms.ok) expect(crochetTerms.error.message, "Row 2, position 1: hdc is not valid in UK terms.", "crochet terms message");

const colourBad = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 1, "k2 in C.");
expect(colourBad.ok, false, "colour rejected");
if (!colourBad.ok) expect(colourBad.error.message, "Row 1, position 7: colour C is not in the key.", "colour message");

const repeatFit = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "k1, *k5; rep from * to end.");
expect(repeatFit.ok, false, "repeat fit rejected");
if (!repeatFit.ok) expect(repeatFit.error.message, "Row 3, position 5: the repeat does not fit 24 stitches.", "repeat fit message");

const cellCount = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "k26.");
expect(cellCount.ok, false, "cell count rejected");
if (!cellCount.ok) expect(cellCount.error.message, "Row 3, position 1: the text needs 26 cells, the chart is 24 wide.", "cell count message");

const closing = applyTextToRow({ ...textChart(24, 24, 7), cells: fullRowCells(24, 7) }, 3, "Row 3 (RS): ssk, k2tog, k20. (24 sts)");
expect(closing.ok, false, "closing count rejected");
if (!closing.ok) expect(closing.error.message, "Row 3, position 30: the closing count says 24 sts, the row makes 22.", "closing count message");

// A balanced row with no `ns` between its stitches applies its own line back
// to identical cells.
const rtRow = "ns ssk k k k k k k k2tog k ns";
const rtBase = {
  craft: "knit" as const,
  mode: "flat" as const,
  terms: null,
  castOn: 12,
  width: 12,
  height: 7,
  repeats: [] as { id: string; fromCol: number; toCol: number; fromRow: number; toRow: number; times: number }[],
  colourLetters: () => ["A"],
};
function rtCells(row: string) {
  const symbols = row.split(/\s+/).filter(Boolean);
  const cells: { row: number; col: number; stitch: string; colour: string }[] = [];
  for (let r = 1; r <= 7; r++) {
    for (let col = 1; col <= 12; col++) {
      cells.push({ row: r, col, stitch: r === 3 ? (symbols[col - 1] ?? "ns") : "ns", colour: "A" });
    }
  }
  return cells;
}
const rtCheck = checkChart({
  craft: "knit",
  mode: "flat",
  terms: null,
  castOn: 12,
  width: 12,
  height: 7,
  repeats: [],
  cells: rtCells(rtRow),
});
const rtLine = rtCheck.byRow.get(3)!.text.replace(/^Row 3 \(RS\): /, "").replace(/ \(\d+ sts\)$/, "");
const selfApply = applyTextToRow({ ...rtBase, cells: rtCells(rtRow) }, 3, rtLine);
expect(selfApply.ok, true, "own line applies");
if (selfApply.ok) {
  const before = new Map<string, string>();
  for (const cell of rtCells(rtRow)) before.set(`${cell.row}:${cell.col}`, cell.stitch);
  const after = new Map<string, string>();
  for (const cell of selfApply.cells) after.set(`${cell.row}:${cell.col}`, cell.stitch);
  let same = true;
  for (let col = 1; col <= 12; col++) {
    if (before.get(`3:${col}`) !== after.get(`3:${col}`)) same = false;
  }
  expect(same, true, "own line returns identical cells");
}

// Twin lift: worked example tokens for row 1 and row 2 of the rib.
const twinCheck = checkChart(chart({ 1: ribCells, 2: ribCells }, 10, 10, 2));
expect(twinCheck.rows[0]!.line!.tokens.map((token) => ({ text: token.text, cols: token.cols })), [
  { text: "k2", cols: [10, 9, 6, 5] },
  { text: "p2", cols: [8, 7, 4, 3] },
  { text: "k2", cols: [2, 1] },
], "twin tokens row 1");
expect(twinCheck.rows[1]!.line!.tokens.map((token) => ({ text: token.text, cols: token.cols })), [
  { text: "p2", cols: [1, 2, 5, 6] },
  { text: "k2", cols: [3, 4, 7, 8] },
  { text: "p2", cols: [9, 10] },
], "twin tokens row 2");

// Mirror example.
const mirrorBefore = "k2tog k yo ssk m1r";
const mirrored = mirrorRow(mirrorBefore.split(" "));
expect(mirrored.join(" "), "m1l k2tog yo k ssk", "mirror partners");

function mirrorRow(symbols: string[]): string[] {
  const partners: Record<string, string> = { k2tog: "ssk", ssk: "k2tog", m1l: "m1r", m1r: "m1l" };
  return [...symbols].reverse().map((symbol) => partners[symbol] ?? symbol);
}

// Colourwork: float warning example.
const floatWarn = colourWarningsFor(
  chart({ 1: "k k k k k k k k k k" }, 10, 10, 2, "flat", "knit", null, { 1: "A A B B B B B B A A" }),
  [{ letter: "A", name: "Main", hex: "#eeeeee" }, { letter: "B", name: "Contrast", hex: "#111111" }],
  2,
  6,
);
expect(floatWarn, [], "float under the limit");
const floatWarnTight = colourWarningsFor(
  chart({ 1: "k k k k k k k k k k" }, 10, 10, 2, "flat", "knit", null, { 1: "A A B B B B B B A A" }),
  [{ letter: "A", name: "Main", hex: "#eeeeee" }, { letter: "B", name: "Contrast", hex: "#111111" }],
  2,
  5,
);
expect(floatWarnTight, [{ row: 1, message: "Row 1: float of 6 stitches in colour A." }], "float over the limit");

function colourWarningsFor(
  input: CheckChartInput,
  colours: { letter: string; name: string; hex: string }[],
  coloursPerRow: number,
  maxFloat: number,
) {
  const check = checkChart(input);
  const warnings: { row: number; message: string }[] = [];
  for (const row of check.rows) {
    const distinct = [...new Set(row.worked.filter((cell) => cell.stitch !== "ns").map((cell) => cell.colour))];
    if (distinct.length > coloursPerRow) {
      warnings.push({ row: row.row, message: `Row ${row.row} uses ${distinct.length} colours, the limit is ${coloursPerRow}.` });
    }
    for (const colour of colours) {
      let best = 0;
      let start = -1;
      const cells = row.worked.filter((cell) => cell.stitch !== "ns");
      cells.forEach((cell, index) => {
        if (cell.colour !== colour.letter) return;
        if (start >= 0 && index > start + 1) best = Math.max(best, index - start - 1);
        start = index;
      });
      if (best > maxFloat) {
        warnings.push({ row: row.row, message: `Row ${row.row}: float of ${best} stitches in colour ${colour.letter}.` });
      }
    }
  }
  return warnings;
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
