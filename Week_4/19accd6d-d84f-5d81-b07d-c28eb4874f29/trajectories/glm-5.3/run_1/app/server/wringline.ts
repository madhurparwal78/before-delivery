import type { ArgSpec, ArgValue, OperationSpec, Step } from '../shared/catalogue.js';
import { operation, OPERATIONS } from '../shared/catalogue.js';

/** The one place Wring Line v1 matching is decided (DP-36). */

const RENAMED_OPS: Record<string, string> = {
  b64: 'To Base64',
  unb64: 'From Base64',
  hexify: 'To Hex',
  unhex: 'From Hex',
  regex_replace: 'Find and Replace',
};

const RENAMED_ARGS: Record<string, string> = {
  sep: 'delimiter',
  pattern: 'find',
  with: 'replace',
};

function norm(text: string): string {
  return text.toLowerCase().replace(/[\s\-_]/g, '');
}

function opByName(name: string): OperationSpec | undefined {
  const direct = RENAMED_OPS[norm(name)];
  if (direct) return operation(direct);
  // Normalised lookup: names, spaces, hyphens and underscores compare case-insensitively.
  const target = norm(name);
  const found = OPERATIONS.map((o) => o.name).find((o) => norm(o) === target);
  return found ? operation(found) : undefined;
}

function unescapeWl(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      const n = text[i + 1];
      if (n === ';' || n === ')' || n === '\\') {
        out += n;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

export interface ImportReport {
  name: string;
  steps: Step[];
  lineCount: number;
  errors: string[];
}

export function parseWringLine(rawText: string): ImportReport {
  const text = rawText.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const errors: string[] = [];
  let name = 'Imported recipe';
  const steps: Step[] = [];
  let lineCount = 0;

  if (lines[0]?.trim() !== 'wringline 1') {
    return { name, steps: [], lineCount: 0, errors: ["Line 1: expected 'wringline 1'"] };
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      const m = /^#\s*name:\s*(.+)$/.exec(trimmed);
      if (m) name = m[1].trim();
      continue;
    }
    lineCount++;
    const parsed = parseStepLine(trimmed, i + 1, errors);
    if (parsed) steps.push(parsed);
  }
  return { name, steps, lineCount, errors };
}

function parseStepLine(line: string, lineNo: number, errors: string[]): Step | null {
  const open = line.indexOf('(');
  let opName = '';
  let argsText = '';
  if (open === -1) {
    opName = line.trim();
  } else {
    if (!line.endsWith(')')) {
      errors.push(`Line ${lineNo}: unknown operation '${line.trim()}'`);
      return null;
    }
    opName = line.slice(0, open).trim();
    argsText = line.slice(open + 1, -1);
  }
  const spec = opByName(opName);
  if (!spec) {
    errors.push(`Line ${lineNo}: unknown operation '${opName}'`);
    return null;
  }
  const args: Record<string, ArgValue> = {};
  if (argsText.trim() !== '') {
    const pieces = splitArgs(argsText);
    for (const piece of pieces) {
      const eq = piece.indexOf('=');
      if (eq === -1) {
        errors.push(`Line ${lineNo}: unknown argument '${piece.trim()}' for ${spec.name}`);
        continue;
      }
      const rawKey = piece.slice(0, eq).trim();
      const rawValue = unescapeWl(piece.slice(eq + 1).trim());
      const key = RENAMED_ARGS[norm(rawKey)] ?? norm(rawKey);
      const arg = spec.args.find((a) => a.key === key);
      if (!arg) {
        errors.push(`Line ${lineNo}: unknown argument '${rawKey}' for ${spec.name}`);
        continue;
      }
      const value = coerceValue(arg, rawValue);
      if (value === null) {
        errors.push(`Line ${lineNo}: invalid value '${rawValue}' for ${labelOf(arg)} of ${spec.name}`);
        continue;
      }
      args[arg.key] = value;
    }
  }
  return { op: spec.name, args: { ...defaultsOf(spec), ...args }, disabled: false, breakpoint: false };
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && (text[i + 1] === ';' || text[i + 1] === ')')) {
      current += c + text[i + 1];
      i++;
      continue;
    }
    if (c === ';') {
      out.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  void depth;
  if (current.trim() !== '') out.push(current);
  return out.filter((p) => p.trim() !== '');
}

function labelOf(arg: ArgSpec): string {
  return arg.label;
}

function defaultsOf(spec: OperationSpec): Record<string, ArgValue> {
  const out: Record<string, ArgValue> = {};
  for (const a of spec.args) out[a.key] = a.default;
  return out;
}

function coerceValue(arg: ArgSpec, raw: string): ArgValue | null {
  if (arg.kind === 'toggle') {
    const n = norm(raw);
    if (['on', 'true', 'yes'].includes(n)) return true;
    if (['off', 'false', 'no'].includes(n)) return false;
    return null;
  }
  if (arg.kind === 'int') {
    if (/^[-]?[0-9]+$/.test(raw)) {
      const n = Number(raw);
      if (n >= arg.min && n <= arg.max) return n;
    }
    return null;
  }
  if (arg.kind === 'option') {
    const match = arg.options.find((o) => norm(o) === norm(raw));
    return match ?? null;
  }
  return raw;
}
