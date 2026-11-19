import { FLAG_LETTERS, findOperation, operations, type ArgSpec, type Args } from './ops.js';
import type { RecipeStep } from './recipe.js';

export const DEFAULT_IMPORT_NAME = 'Imported recipe';

const OPERATION_RENAMES: Record<string, string> = {
  b64: 'To Base64',
  unb64: 'From Base64',
  hexify: 'To Hex',
  unhex: 'From Hex',
  regex_replace: 'Find and Replace',
};

const ARGUMENT_RENAMES: Record<string, string> = {
  sep: 'Delimiter',
  pattern: 'Find',
  with: 'Replace',
};

/** Names, argument names and option values compare with case, spaces, hyphens and underscores ignored. */
function fold(value: string): string {
  return value.toLowerCase().replaceAll(' ', '').replaceAll('-', '').replaceAll('_', '');
}

const operationByFolded = new Map<string, string>();
for (const op of operations) operationByFolded.set(fold(op.name), op.name);
for (const [alias, name] of Object.entries(OPERATION_RENAMES)) operationByFolded.set(fold(alias), name);

const argumentAliasByFolded = new Map<string, string>();
for (const [alias, label] of Object.entries(ARGUMENT_RENAMES)) argumentAliasByFolded.set(fold(alias), label);

export interface WringLineResult {
  name: string;
  steps: RecipeStep[];
  lineCount: number;
  problems: string[];
}

interface Entry {
  arg: string;
  value: string;
}

function unescapeValue(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\') {
      const next = raw[i + 1];
      if (next === ';' || next === ')' || next === '\\') {
        out += next;
        i += 1;
        continue;
      }
    }
    out += raw[i];
  }
  return out;
}

function splitUnescaped(raw: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && raw[i + 1] !== undefined) {
      current += raw[i]! + raw[i + 1]!;
      i += 1;
      continue;
    }
    if (raw[i] === separator) {
      parts.push(current);
      current = '';
      continue;
    }
    current += raw[i];
  }
  parts.push(current);
  return parts;
}

/** Reads the head of a step line: its operation name and the raw argument body. */
function splitStepLine(line: string): { name: string; body: string | null } {
  const open = line.indexOf('(');
  if (open < 0) return { name: line.trim(), body: null };
  let depthClosed = -1;
  for (let i = open + 1; i < line.length; i += 1) {
    if (line[i] === '\\' && line[i + 1] !== undefined) {
      i += 1;
      continue;
    }
    if (line[i] === ')') {
      depthClosed = i;
      break;
    }
  }
  if (depthClosed < 0 || line.slice(depthClosed + 1).trim() !== '') return { name: line.trim(), body: null };
  return { name: line.slice(0, open).trim(), body: line.slice(open + 1, depthClosed) };
}

function matchOption(spec: Extract<ArgSpec, { kind: 'option' }>, value: string): string | null {
  const wanted = fold(value);
  return spec.options.find((candidate) => fold(candidate) === wanted) ?? null;
}

const TOGGLE_TRUE = new Set(['on', 'true', 'yes']);
const TOGGLE_FALSE = new Set(['off', 'false', 'no']);

/** Parses Wring Line v1 text. The recipe is created only when `problems` is empty. */
export function parseWringLine(text: string): WringLineResult {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const problems: string[] = [];
  const steps: RecipeStep[] = [];
  let name = DEFAULT_IMPORT_NAME;
  let lineCount = 0;

  if ((lines[0] ?? '') !== 'wringline 1') {
    return { name, steps, lineCount, problems: ["Line 1: expected 'wringline 1'"] };
  }

  for (let index = 1; index < lines.length; index += 1) {
    const number = index + 1;
    const raw = lines[index]!;
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const named = /^#\s*name:\s*(.*)$/.exec(line);
      if (named !== null) name = named[1]!.trim();
      continue;
    }
    lineCount += 1;
    const { name: rawName, body } = splitStepLine(line);
    const opName = operationByFolded.get(fold(rawName));
    const op = opName === undefined ? undefined : findOperation(opName);
    if (op === undefined) {
      problems.push(`Line ${number}: unknown operation '${rawName}'`);
      continue;
    }
    const entries: Entry[] = [];
    if (body !== null) {
      for (const part of splitUnescaped(body, ';')) {
        if (part.trim() === '') continue;
        const halves = splitUnescaped(part, '=');
        const argName = halves[0]!.trim();
        entries.push({ arg: argName, value: halves.slice(1).join('=').trim() });
      }
    }
    const args: Args = {};
    let failed = false;
    for (const entry of entries) {
      const alias = argumentAliasByFolded.get(fold(entry.arg));
      const wanted = fold(alias ?? entry.arg);
      const spec = op.args.find((candidate) => fold(candidate.label) === wanted);
      if (spec === undefined) {
        problems.push(`Line ${number}: unknown argument '${entry.arg}' for ${op.name}`);
        failed = true;
        continue;
      }
      const value = unescapeValue(entry.value);
      const invalid = (): void => {
        problems.push(`Line ${number}: invalid value '${entry.value}' for ${spec.label} of ${op.name}`);
        failed = true;
      };
      switch (spec.kind) {
        case 'option': {
          const matched = matchOption(spec, value);
          if (matched === null) invalid();
          else args[spec.key] = matched;
          break;
        }
        case 'toggle': {
          const folded = fold(value);
          if (TOGGLE_TRUE.has(folded)) args[spec.key] = true;
          else if (TOGGLE_FALSE.has(folded)) args[spec.key] = false;
          else invalid();
          break;
        }
        case 'int': {
          if (!/^[+-]?\d+$/.test(value)) {
            invalid();
            break;
          }
          const parsed = Number.parseInt(value, 10);
          if (parsed < spec.min || parsed > spec.max) invalid();
          else args[spec.key] = parsed;
          break;
        }
        case 'text':
          args[spec.key] = value;
          break;
        case 'flags': {
          const letters = [...value.toLowerCase()];
          const unique = new Set(letters);
          if (letters.length !== unique.size || letters.some((letter) => !FLAG_LETTERS.includes(letter as 'g'))) {
            invalid();
            break;
          }
          args[spec.key] = FLAG_LETTERS.filter((letter) => unique.has(letter)).join('');
          break;
        }
      }
    }
    if (!failed) steps.push({ op: op.name, args, disabled: false, breakpoint: false });
  }

  return { name, steps, lineCount, problems };
}
