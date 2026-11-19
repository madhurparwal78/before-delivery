import { crc32, md5, sha1, sha256 } from "./checksums";
import { gunzip, gzip } from "./compression";
import { csvToJson, jsonBeautify, jsonMinify, jsonToCsv } from "./data";
import {
  fromBase64, fromBinary, fromDecimal, fromHex, fromHexdump, toBase64, toBinary, toDecimal, toHex, toHexdump,
  urlDecode, urlEncode,
} from "./encoding";
import {
  changeCase, decodeTextOperation, encodeTextOperation, extractMatches, findAndReplace, normalizeLineEndings,
  removeWhitespace, reverse, sortLines, uniqueLines,
} from "./text";
import type {
  ArgSpec, Family, FlagsArg, IntegerArg, OptionArg, StepArgs, TextArg, ToggleArg,
} from "./types";

function keyOf(label: string): string {
  const [first = "", ...rest] = label.split(" ");
  return first.toLowerCase() + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

const option = (label: string, options: readonly string[]): OptionArg => ({
  kind: "option", label, key: keyOf(label), options, default: options[0] as string,
});
const toggle = (label: string, defaultValue: boolean): ToggleArg => ({
  kind: "toggle", label, key: keyOf(label), default: defaultValue,
});
const integer = (label: string, defaultValue: number, min: number, max: number): IntegerArg => ({
  kind: "integer", label, key: keyOf(label), min, max, default: defaultValue,
});
const text = (label: string, defaultValue: string): TextArg => ({
  kind: "text", label, key: keyOf(label), default: defaultValue,
});
const flags = (): FlagsArg => ({ kind: "flags", label: "Flags", key: "flags", default: "g" });

const labelOf = (args: StepArgs, key: string): string => String(args[key]);
const isOn = (args: StepArgs, key: string): boolean => args[key] === true;
const numberOf = (args: StepArgs, key: string): number => Number(args[key]);

interface OperationBase {
  name: string;
  family: Family;
  args: readonly ArgSpec[];
}

/** An operation that turns its input bytes into output bytes. */
interface TransformOperation extends OperationBase {
  kind: "transform";
  run: (input: Uint8Array, args: StepArgs) => Uint8Array;
}

/** Fork and Merge are executed by the bake itself because they reshape the data flow. */
interface FlowOperation extends OperationBase {
  kind: "fork" | "merge";
}

type OperationDefinition = TransformOperation | FlowOperation;

const transform = (
  name: string,
  family: Family,
  args: readonly ArgSpec[],
  run: (input: Uint8Array, args: StepArgs) => Uint8Array,
): TransformOperation => ({ kind: "transform", name, family, args, run });

const REGEX_OPERATIONS = ["Find and Replace", "Extract Matches"];

export const OPERATIONS: readonly OperationDefinition[] = [
  transform("To Base64", "Encoding", [option("Alphabet", ["Standard", "URL-safe"])],
    (input, a) => toBase64(input, labelOf(a, "alphabet"))),
  transform("From Base64", "Encoding", [option("Alphabet", ["Standard", "URL-safe"]), toggle("Strict", false)],
    (input, a) => fromBase64(input, labelOf(a, "alphabet"), isOn(a, "strict"))),
  transform("To Hex", "Encoding", [option("Delimiter", ["Space", "None", "Comma", "Colon", "Line feed"])],
    (input, a) => toHex(input, labelOf(a, "delimiter"))),
  transform("From Hex", "Encoding", [option("Delimiter", ["Auto"])], (input) => fromHex(input)),
  transform("To Hexdump", "Encoding", [integer("Width", 16, 1, 64)],
    (input, a) => toHexdump(input, numberOf(a, "width"))),
  transform("From Hexdump", "Encoding", [], (input) => fromHexdump(input)),
  transform("URL Encode", "Encoding", [toggle("Encode all reserved", true)],
    (input, a) => urlEncode(input, isOn(a, "encodeAllReserved"))),
  transform("URL Decode", "Encoding", [], (input) => urlDecode(input)),
  transform("To Binary", "Encoding", [option("Delimiter", ["Space", "None", "Comma", "Line feed"])],
    (input, a) => toBinary(input, labelOf(a, "delimiter"))),
  transform("From Binary", "Encoding", [option("Delimiter", ["Auto"])], (input) => fromBinary(input)),
  transform("To Decimal", "Encoding", [option("Delimiter", ["Space", "Comma", "Line feed"])],
    (input, a) => toDecimal(input, labelOf(a, "delimiter"))),
  transform("From Decimal", "Encoding", [option("Delimiter", ["Auto"])], (input) => fromDecimal(input)),

  transform("Encode Text", "Text", [option("Encoding", ["UTF-8", "UTF-16LE", "ISO-8859-1"])],
    (input, a) => encodeTextOperation(input, labelOf(a, "encoding"))),
  transform("Decode Text", "Text", [option("Encoding", ["UTF-8", "UTF-16LE", "ISO-8859-1"])],
    (input, a) => decodeTextOperation(input, labelOf(a, "encoding"))),
  transform("Change Case", "Text", [option("Case", ["Upper", "Lower"])],
    (input, a) => changeCase(input, labelOf(a, "case"))),
  transform("Reverse", "Text", [option("By", ["Character", "Line"])], (input, a) => reverse(input, labelOf(a, "by"))),
  transform("Remove Whitespace", "Text", [toggle("Spaces", true), toggle("Tabs", true), toggle("Line breaks", true)],
    (input, a) => removeWhitespace(input, isOn(a, "spaces"), isOn(a, "tabs"), isOn(a, "lineBreaks"))),
  transform("Normalize Line Endings", "Text", [option("To", ["LF", "CRLF"])],
    (input, a) => normalizeLineEndings(input, labelOf(a, "to"))),
  transform("Find and Replace", "Text", [text("Find", ""), text("Replace", ""), flags()],
    (input, a) => findAndReplace(input, labelOf(a, "find"), labelOf(a, "replace"), labelOf(a, "flags"))),
  transform("Extract Matches", "Text", [text("Find", ""), flags()],
    (input, a) => extractMatches(input, labelOf(a, "find"), labelOf(a, "flags"))),
  transform("Sort Lines", "Text",
    [option("Order", ["Alphabetical", "Alphabetical, ignore case", "Numeric"]), toggle("Reverse", false), toggle("Unique", false)],
    (input, a) => sortLines(input, labelOf(a, "order"), isOn(a, "reverse"), isOn(a, "unique"))),
  transform("Unique Lines", "Text", [], (input) => uniqueLines(input)),

  transform("JSON Beautify", "Data formats", [option("Indent", ["2", "4", "Tab"])],
    (input, a) => jsonBeautify(input, labelOf(a, "indent"))),
  transform("JSON Minify", "Data formats", [], (input) => jsonMinify(input)),
  transform("CSV to JSON", "Data formats", [text("Delimiter", ","), toggle("First row is header", true)],
    (input, a) => csvToJson(input, labelOf(a, "delimiter"), isOn(a, "firstRowIsHeader"))),
  transform("JSON to CSV", "Data formats", [], (input) => jsonToCsv(input)),

  transform("MD5", "Checksums", [], (input) => md5(input)),
  transform("SHA-1", "Checksums", [], (input) => sha1(input)),
  transform("SHA-256", "Checksums", [], (input) => sha256(input)),
  transform("CRC32", "Checksums", [], (input) => crc32(input)),

  transform("Gzip", "Compression", [integer("Level", 6, 1, 9)], (input, a) => gzip(input, numberOf(a, "level"))),
  transform("Gunzip", "Compression", [], (input) => gunzip(input)),

  { kind: "fork", name: "Fork", family: "Flow", args: [text("Split delimiter", "\\n")] },
  { kind: "merge", name: "Merge", family: "Flow", args: [text("Joiner", "\\n")] },
];

const BY_NAME = new Map(OPERATIONS.map((operation) => [operation.name, operation]));

export function operationNamed(name: string): OperationDefinition | undefined {
  return BY_NAME.get(name);
}

/** The definition of an operation whose name has already been validated. */
export const operationDefinition = (name: string): OperationDefinition => BY_NAME.get(name) as OperationDefinition;

export function isRegexOperation(name: string): boolean {
  return REGEX_OPERATIONS.includes(name);
}

export function defaultArgs(operation: OperationDefinition): StepArgs {
  return Object.fromEntries(operation.args.map((arg) => [arg.key, arg.default]));
}
