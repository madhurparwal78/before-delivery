import type { Craft, Side, Terms } from "../../common/types";
import { CABLE_CELLS, CABLE_KEY, CABLE_TEXT, symbolByKey, symbolText, symbolsOf } from "../../common/symbols";

export interface ParsedItem {
  /** the chart symbol this item names */
  key: string;
  /** the printed stem, without count or colour */
  text: string;
  /** chart cells the item fills */
  cells: number;
  uses: number;
  makes: number;
  colour: string | null;
}

export interface ParsedRowText {
  before: ParsedItem[];
  unit: ParsedItem[];
  tail: ParsedItem[];
  /** 1-based position of the repeat's star, null when there is none */
  starPos: number | null;
  /** stitches the repeat's ending names: 0 for to end, n for last n sts */
  namedTail: number;
  countSays: number | null;
  /** 1-based position of the closing count's bracket */
  countPos: number | null;
}

export interface TextError {
  position: number | null;
  message: string;
}

export type ScanResult = { ok: true; parsed: ParsedRowText } | { ok: false; error: TextError };

const SEPARATORS = ",;.";

function textsFor(craft: Craft, terms: Terms | null, side: Side): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of symbolsOf(craft)) {
    const text = symbolText(def, { craft, terms }, side);
    if (text !== "") map.set(text, def.key);
  }
  return map;
}

function countedStitch(craft: Craft, key: string): boolean {
  return key === "k" || key === "p" || (craft === "crochet" && key !== "inc" && key !== "dec");
}

/**
 * The one place the text grammar is decided: the scan and its first pass.
 * Reads the typed text exactly as given, case included, and reports the first
 * failure in the published order: stitch, terms, side, colour, what follows.
 */
export function scanRowText(
  text: string,
  row: number,
  side: Side,
  craft: Craft,
  terms: Terms | null,
  colourLetters: string[],
): ScanResult {
  const valid = textsFor(craft, terms, side);
  const otherSide: Side = craft === "knit" ? (side === "RS" ? "WS" : "RS") : "RS";
  const otherSideTexts = craft === "knit" ? textsFor(craft, terms, otherSide) : new Map<string, string>();
  const otherTermsTexts =
    craft === "crochet" ? textsFor(craft, terms === "uk" ? "us" : "uk", "RS") : new Map<string, string>();
  const counted = new Set<string>();
  for (const [text, key] of valid) if (countedStitch(craft, key)) counted.add(text);
  const termsWord = terms === "uk" ? "UK" : "US";

  let i = 0;
  const len = text.length;

  const label = /^(?:Row|Rnd) (\d+)(?: \((?:RS|WS|RND)\))?:/.exec(text);
  if (label) {
    const labelRow = Number.parseInt(label[1]!, 10);
    if (labelRow !== row) {
      return { ok: false, error: { position: 1, message: `Row ${row}, position 1: the label says Row ${labelRow}.` } };
    }
    i = label[0].length;
  }

  const before: ParsedItem[] = [];
  const unit: ParsedItem[] = [];
  const tail: ParsedItem[] = [];
  let inUnit = false;
  let unitDone = false;
  let starPos: number | null = null;
  let namedTail = 0;
  let countSays: number | null = null;
  let countPos: number | null = null;
  let sawRepeat = false;

  const target = (): ParsedItem[] => (inUnit ? unit : unitDone ? tail : before);

  const skipSpaces = () => {
    while (i < len && text[i] === " ") i++;
  };

  const separatorError = (position: number): ScanResult => ({
    ok: false,
    error: { position, message: `Row ${row}, position ${position}: expected a comma or a full stop.` },
  });

  const scanItem = (): { ok: true; item: ParsedItem } | { ok: false; error: TextError } => {
    if (text.startsWith(CABLE_TEXT, i)) {
      i += CABLE_TEXT.length;
      return {
        ok: true,
        item: { key: CABLE_KEY, text: CABLE_TEXT, cells: CABLE_CELLS, uses: CABLE_CELLS, makes: CABLE_CELLS, colour: null },
      };
    }
    const start = i;
    let end = i;
    while (end < len && !SEPARATORS.includes(text[end]!) && text[end] !== " ") end++;
    const word = text.slice(start, end);
    const position = start + 1;
    if (word === "") return { ok: false, error: { position, message: `Row ${row}, position ${position}: expected a comma or a full stop.` } };
    const runMatch = /^(.+?)(\d+)$/.exec(word);
    const stem = runMatch ? runMatch[1]! : word;
    const runCount = runMatch ? Number.parseInt(runMatch[2]!, 10) : null;
    const key = valid.get(stem);
    if (key === undefined) {
      if (otherTermsTexts.has(stem)) {
        return {
          ok: false,
          error: { position, message: `Row ${row}, position ${position}: ${stem} is not valid in ${termsWord} terms.` },
        };
      }
      if (otherSideTexts.has(stem)) {
        const message =
          side === "WS"
            ? `Row ${row}, position ${position}: ${stem} is not valid on a wrong-side row.`
            : `Row ${row}, position ${position}: ${stem} is not valid on a right-side row.`;
        return { ok: false, error: { position, message } };
      }
      return { ok: false, error: { position, message: `Row ${row}, position ${position}: unknown stitch "${word}".` } };
    }
    if (counted.has(stem)) {
      if (runCount === null || runCount < 1) {
        return { ok: false, error: { position, message: `Row ${row}, position ${position}: unknown stitch "${word}".` } };
      }
    } else if (runCount !== null) {
      return { ok: false, error: { position, message: `Row ${row}, position ${position}: unknown stitch "${word}".` } };
    }
    const def = symbolByKey(craft, key)!;
    const count = runCount ?? 1;
    let cells = count;
    let uses = def.uses * count;
    let makes = def.makes * count;
    let colour: string | null = null;
    i = end;
    const xMatch = /^ x(\d+)/.exec(text.slice(i));
    if (xMatch && !counted.has(stem)) {
      const times = Number.parseInt(xMatch[1]!, 10);
      cells *= times;
      uses = def.uses * cells;
      makes = def.makes * cells;
      i += xMatch[0].length;
    }
    const inMatch = /^ in ([A-Z])/.exec(text.slice(i));
    if (inMatch) {
      const letterPosition = i + 5;
      const letter = inMatch[1]!;
      if (!colourLetters.includes(letter)) {
        return {
          ok: false,
          error: { position: letterPosition, message: `Row ${row}, position ${letterPosition}: colour ${letter} is not in the key.` },
        };
      }
      colour = letter;
      i += inMatch[0].length;
    }
    return { ok: true, item: { key, text: stem, cells, uses, makes, colour } };
  };

  let done = false;
  while (!done) {
    skipSpaces();
    if (i >= len) return separatorError(len + 1);
    const ch = text[i]!;
    if (ch === "*") {
      if (sawRepeat) return separatorError(i + 1);
      sawRepeat = true;
      inUnit = true;
      starPos = i + 1;
      i++;
      continue;
    }
    if (ch === ";") {
      if (!inUnit || unitDone) return separatorError(i + 1);
      i++;
      skipSpaces();
      const rep = "rep from * to ";
      if (!text.startsWith(rep, i)) return separatorError(i + 1);
      i += rep.length;
      if (text.startsWith("end", i)) {
        namedTail = 0;
        i += 3;
        unitDone = true;
        inUnit = false;
        if (i < len && text[i] === ",") {
          i++;
          if (i < len && text[i] === " ") i++;
        }
        continue;
      }
      const lastMatch = /^last (\d+) sts?,|^last (\d+) st,|^last st,/.exec(text.slice(i));
      if (!lastMatch) return separatorError(i + 1);
      namedTail = lastMatch[1]
        ? Number.parseInt(lastMatch[1]!, 10)
        : lastMatch[2]
          ? Number.parseInt(lastMatch[2]!, 10)
          : 1;
      i += lastMatch[0].length;
      unitDone = true;
      inUnit = false;
      continue;
    }
    if (ch === "." ) {
      i++;
      done = true;
      break;
    }
    if (ch === ",") return separatorError(i + 1);
    const itemResult = scanItem();
    if (!("item" in itemResult)) return { ok: false, error: itemResult.error };
    target().push(itemResult.item);
    if (i >= len) return separatorError(len + 1);
    const next = text[i]!;
    if (inUnit && next === ";") continue;
    if (next === ",") {
      i++;
      if (i >= len || text[i] !== " ") return separatorError(i + 1);
      i++;
      continue;
    }
    if (next === ".") {
      i++;
      done = true;
      break;
    }
    return separatorError(i + 1);
  }

  if (sawRepeat && !unitDone) return separatorError(len + 1);
  if (sawRepeat && unit.length === 0) return separatorError(len + 1);
  if (namedTail > 0 && tail.length === 0) return separatorError(len + 1);

  skipSpaces();
  if (i < len) {
    if (text[i] !== "(") return separatorError(i + 1);
    countPos = i + 1;
    const countMatch = /^\((\d+) sts?\)/.exec(text.slice(i));
    if (!countMatch) return separatorError(countPos);
    countSays = Number.parseInt(countMatch[1]!, 10);
    i += countMatch[0].length;
    skipSpaces();
    if (i !== len) return separatorError(i + 1);
  }

  return {
    ok: true,
    parsed: { before, unit: sawRepeat ? unit : [], tail, starPos, namedTail, countSays, countPos },
  };
}

export interface WorkedText {
  items: ParsedItem[];
  uses: number;
  makes: number;
  cells: number;
  repeats: number;
}

function sumOf(items: ParsedItem[], key: "uses" | "makes" | "cells"): number {
  return items.reduce((total, item) => total + item[key], 0);
}

/** Second pass: repeat fit, cell count, closing count, in the published order. */
export function checkFit(
  parsed: ParsedRowText,
  row: number,
  width: number,
  needed: number,
): { ok: true; worked: WorkedText } | { ok: false; error: TextError } {
  const beforeUses = sumOf(parsed.before, "uses");
  const unitUses = sumOf(parsed.unit, "uses");
  const tailUses = sumOf(parsed.tail, "uses");
  let repeats = 1;
  if (parsed.starPos !== null) {
    const position = parsed.starPos;
    const misfit = (): TextError => ({
      position,
      message: `Row ${row}, position ${position}: the repeat does not fit ${needed} stitches.`,
    });
    if (unitUses === 0) return { ok: false, error: misfit() };
    if (parsed.namedTail !== tailUses) return { ok: false, error: misfit() };
    const remaining = needed - beforeUses - tailUses;
    if (remaining < unitUses || remaining % unitUses !== 0) return { ok: false, error: misfit() };
    repeats = remaining / unitUses;
  }
  const items: ParsedItem[] = [...parsed.before];
  for (let time = 0; time < repeats; time++) items.push(...parsed.unit);
  items.push(...parsed.tail);
  const cells = sumOf(items, "cells");
  if (cells > width) {
    return {
      ok: false,
      error: {
        position: 1,
        message: `Row ${row}, position 1: the text needs ${cells} cells, the chart is ${width} wide.`,
      },
    };
  }
  const made = sumOf(items, "makes");
  if (parsed.countSays !== null && parsed.countSays !== made) {
    const says = parsed.countSays;
    return {
      ok: false,
      error: {
        position: parsed.countPos,
        message: `Row ${row}, position ${parsed.countPos}: the closing count says ${says} ${says === 1 ? "st" : "sts"}, the row makes ${made}.`,
      },
    };
  }
  return { ok: true, worked: { items, uses: sumOf(items, "uses"), makes: made, cells, repeats } };
}

/** Chart cells a worked text fills, in reading order, before placement. */
export function applyItems(
  items: ParsedItem[],
): { stitch: string; cells: number; colour: string | null }[] {
  const flat: { stitch: string; cells: number; colour: string | null }[] = [];
  for (const item of items) {
    if (item.key === CABLE_KEY) {
      for (let cell = 0; cell < item.cells; cell += CABLE_CELLS) {
        flat.push({ stitch: CABLE_KEY, cells: CABLE_CELLS, colour: item.colour });
      }
      continue;
    }
    flat.push({ stitch: item.key, cells: item.cells, colour: item.colour });
  }
  return flat;
}
