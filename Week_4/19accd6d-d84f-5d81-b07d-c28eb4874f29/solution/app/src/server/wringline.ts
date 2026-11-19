import { OPERATIONS, defaultArgs } from "../shared/operations/catalogue";
import type { ArgSpec, ArgValue, Step } from "../shared/operations/types";
import { parseStep } from "../shared/operations/validate";

const HEADER = "wringline 1";
const OPERATION_RENAMES: Record<string, string> = {
  b64: "To Base64", unb64: "From Base64", hexify: "To Hex", unhex: "From Hex", regexreplace: "Find and Replace",
};
const ARGUMENT_RENAMES: Record<string, string> = { sep: "Delimiter", pattern: "Find", with: "Replace" };
const TOGGLES: Record<string, boolean> = { on: true, true: true, yes: true, off: false, false: false, no: false };

const DEFAULT_IMPORT_NAME = "Imported recipe";

/** Names, arguments and option values compare case-insensitively with spaces, hyphens and underscores removed. */
const comparable = (text: string): string => text.toLowerCase().replace(/[ _-]/g, "");

interface RawStepLine {
  name: string;
  args: { name: string; value: string }[] | null;
}

/** Splits `name(arg=value; arg=value)`; inside values `\;`, `\)` and `\\` stand for `;`, `)` and `\`. */
function splitStepLine(line: string): RawStepLine | null {
  const open = line.indexOf("(");
  if (open === -1) return { name: line, args: null };
  const segments: string[] = [];
  let current = "";
  let closedAt = -1;
  for (let i = open + 1; i < line.length && closedAt === -1; i++) {
    const char = line.charAt(i);
    const next = line.charAt(i + 1);
    if (char === "\\" && (next === ";" || next === ")" || next === "\\")) {
      current += next;
      i++;
    } else if (char === ";") {
      segments.push(current);
      current = "";
    } else if (char === ")") {
      segments.push(current);
      closedAt = i;
    } else {
      current += char;
    }
  }
  if (closedAt === -1 || line.slice(closedAt + 1).trim() !== "") return null;
  const args = segments.filter((segment) => segment.trim() !== "").map((segment) => {
    const equals = segment.indexOf("=");
    return equals === -1
      ? { name: segment.trim(), value: "" }
      : { name: segment.slice(0, equals).trim(), value: segment.slice(equals + 1).trim() };
  });
  return { name: line.slice(0, open).trim(), args };
}

/** The typed value a written value stands for, or null when it names no option or toggle state or is not a number. */
function argumentValue(arg: ArgSpec, value: string): ArgValue | null {
  switch (arg.kind) {
    case "option":
      return arg.options.find((option) => comparable(option) === comparable(value)) ?? null;
    case "toggle":
      return TOGGLES[value.toLowerCase()] ?? null;
    case "integer":
      return /^-?\d+$/.test(value) ? Number(value) : null;
    case "text":
    case "flags":
      return value;
  }
}

type WringLineResult = { name: string; steps: Step[]; lineCount: number } | { unmatched: string[] };

export const normalizedLineEndings = (text: string): string => text.replace(/\r\n?/g, "\n");

/** Reads Wring Line v1 text. A recipe comes out only when every line matched; otherwise each unmatched line is reported. */
export function parseWringLine(text: string): WringLineResult {
  const lines = normalizedLineEndings(text).split("\n");
  if (lines[0] !== HEADER) return { unmatched: ["Line 1: expected 'wringline 1'"] };
  let name = DEFAULT_IMPORT_NAME;
  const steps: Step[] = [];
  const unmatched: string[] = [];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;
    if (index === 0 || line === "") return;
    if (line.startsWith("#")) {
      const title = /^#\s*name:\s*(.*)$/.exec(line)?.[1]?.trim();
      if (title) name = title;
      return;
    }
    const parsed = splitStepLine(line);
    const operationName = parsed?.name ?? line;
    const operation = OPERATIONS.find((candidate) => candidate.name === OPERATION_RENAMES[comparable(operationName)])
      ?? OPERATIONS.find((candidate) => comparable(candidate.name) === comparable(operationName));
    if (!parsed || !operation) {
      unmatched.push(`Line ${number}: unknown operation '${operationName}'`);
      return;
    }
    const args = defaultArgs(operation);
    const written: Record<string, string> = {};
    for (const given of parsed.args ?? []) {
      const wanted = comparable(ARGUMENT_RENAMES[comparable(given.name)] ?? given.name);
      const arg = operation.args.find((candidate) => comparable(candidate.label) === wanted);
      if (!arg) {
        unmatched.push(`Line ${number}: unknown argument '${given.name}' for ${operation.name}`);
        continue;
      }
      const value = argumentValue(arg, given.value);
      written[arg.key] = given.value;
      if (value === null) unmatched.push(`Line ${number}: invalid value '${given.value}' for ${arg.label} of ${operation.name}`);
      else args[arg.key] = value;
    }
    const checked = parseStep({ op: operation.name, args }, "step");
    if ("step" in checked) {
      steps.push(checked.step);
      return;
    }
    for (const problem of checked.problems) {
      const key = problem.path.split(".").pop() as string;
      const arg = operation.args.find((candidate) => candidate.key === key) as ArgSpec;
      unmatched.push(`Line ${number}: invalid value '${written[key]}' for ${arg.label} of ${operation.name}`);
    }
  });
  return unmatched.length ? { unmatched } : { name, steps, lineCount: steps.length };
}
