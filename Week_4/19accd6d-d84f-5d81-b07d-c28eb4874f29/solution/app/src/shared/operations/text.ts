import {
  INPUT_ENCODINGS, decodeBytes, encodeText, firstUnencodable, textOf, unencodableMessage, utf8Bytes,
} from "../bytes";
import type { InputEncoding } from "../bytes";
import { OperationError } from "./types";

const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

function encodingNamed(label: string): InputEncoding {
  return INPUT_ENCODINGS.find((name) => name === label) ?? "UTF-8";
}

/** Lines split on LF; a trailing LF is kept apart so it can stay at the end. */
interface Lines {
  lines: string[];
  trailingBreak: boolean;
}

function linesOf(text: string): Lines {
  if (text === "") return { lines: [], trailingBreak: false };
  const trailingBreak = text.endsWith("\n");
  const lines = (trailingBreak ? text.slice(0, -1) : text).split("\n");
  return { lines, trailingBreak };
}

function joinLines({ lines, trailingBreak }: Lines): Uint8Array {
  return utf8Bytes(lines.join("\n") + (trailingBreak ? "\n" : ""));
}

export function encodeTextOperation(input: Uint8Array, encoding: string): Uint8Array {
  const target = encodingNamed(encoding);
  const text = textOf(input);
  const unencodable = firstUnencodable(text, target);
  if (unencodable !== null) throw new OperationError(unencodableMessage(unencodable, target));
  return encodeText(text, target);
}

export function decodeTextOperation(input: Uint8Array, encoding: string): Uint8Array {
  const source = encodingNamed(encoding);
  if (source === "UTF-8") {
    textOf(input);
    return input;
  }
  if (source === "UTF-16LE" && input.length % 2 !== 0) throw new OperationError("UTF-16LE input has an odd number of bytes");
  return utf8Bytes(decodeBytes(input, source));
}

export function changeCase(input: Uint8Array, caseLabel: string): Uint8Array {
  const text = textOf(input);
  return utf8Bytes(caseLabel === "Lower" ? text.toLowerCase() : text.toUpperCase());
}

export function reverse(input: Uint8Array, by: string): Uint8Array {
  const text = textOf(input);
  if (by === "Line") {
    const lines = linesOf(text);
    return joinLines({ ...lines, lines: lines.lines.reverse() });
  }
  return utf8Bytes(Array.from(text).reverse().join(""));
}

function keepBytes(input: Uint8Array, drop: (byte: number) => boolean): Uint8Array {
  textOf(input);
  const out = new Uint8Array(input.length);
  let at = 0;
  for (const byte of input) if (!drop(byte)) out[at++] = byte;
  return out.slice(0, at);
}

export function removeWhitespace(input: Uint8Array, spaces: boolean, tabs: boolean, lineBreaks: boolean): Uint8Array {
  return keepBytes(input, (byte) =>
    (spaces && byte === SPACE) || (tabs && byte === TAB) || (lineBreaks && (byte === CR || byte === LF)));
}

export function normalizeLineEndings(input: Uint8Array, to: string): Uint8Array {
  textOf(input);
  const crlf = to === "CRLF";
  const out = new Uint8Array(crlf ? input.length * 2 : input.length);
  let at = 0;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] as number;
    if (byte !== CR && byte !== LF) {
      out[at++] = byte;
      continue;
    }
    if (byte === CR && input[i + 1] === LF) i++;
    if (crlf) out[at++] = CR;
    out[at++] = LF;
  }
  return out.slice(0, at);
}

const ENGINE_PREFIX = "Invalid regular expression: ";

function regexOf(find: string, flags: string): RegExp {
  try {
    return new RegExp(find, flags);
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    const message = description.startsWith(ENGINE_PREFIX) ? description.slice(ENGINE_PREFIX.length) : description;
    throw new OperationError(`${ENGINE_PREFIX}${message}`);
  }
}

export function findAndReplace(input: Uint8Array, find: string, replace: string, flags: string): Uint8Array {
  const text = textOf(input);
  if (find === "") return input;
  return utf8Bytes(text.replace(regexOf(find, flags), replace));
}

export function extractMatches(input: Uint8Array, find: string, flags: string): Uint8Array {
  const text = textOf(input);
  const pattern = regexOf(find, flags.includes("g") ? flags : `${flags}g`);
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) if (match[0] !== "") matches.push(match[0]);
  return utf8Bytes(matches.join("\n"));
}

const NUMBER_LINE = /^[+-]?\d+(?:\.\d+)?$/;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(lines: string[], order: string): string[] {
  if (order === "Alphabetical, ignore case") {
    return lines
      .map((line) => ({ line, key: line.toLowerCase() }))
      .sort((a, b) => compareCodeUnits(a.key, b.key))
      .map(({ line }) => line);
  }
  if (order === "Numeric") {
    const numbers = lines.filter((line) => NUMBER_LINE.test(line));
    const others = lines.filter((line) => !NUMBER_LINE.test(line));
    return [...numbers.sort((a, b) => Number(a) - Number(b)), ...others];
  }
  return [...lines].sort(compareCodeUnits);
}

function firstOccurrences(lines: string[], keyOf: (line: string) => string): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = keyOf(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortLines(input: Uint8Array, order: string, reversed: boolean, unique: boolean): Uint8Array {
  const { lines, trailingBreak } = linesOf(textOf(input));
  let result = sorted(lines, order);
  if (unique) {
    result = firstOccurrences(result, order === "Alphabetical, ignore case" ? (line) => line.toLowerCase() : (line) => line);
  }
  if (reversed) result.reverse();
  return joinLines({ lines: result, trailingBreak });
}

export function uniqueLines(input: Uint8Array): Uint8Array {
  const { lines, trailingBreak } = linesOf(textOf(input));
  return joinLines({ lines: firstOccurrences(lines, (line) => line), trailingBreak });
}
