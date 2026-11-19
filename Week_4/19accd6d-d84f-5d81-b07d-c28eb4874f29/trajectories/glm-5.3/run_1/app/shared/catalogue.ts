export interface ArgOption {
  readonly kind: 'option';
  readonly key: string;
  readonly label: string;
  readonly options: readonly string[];
  readonly default: string;
}

export interface ArgText {
  readonly kind: 'text';
  readonly key: string;
  readonly label: string;
  readonly default: string;
}

export interface ArgInt {
  readonly kind: 'int';
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
}

export interface ArgToggle {
  readonly kind: 'toggle';
  readonly key: string;
  readonly label: string;
  readonly default: boolean;
}

export type ArgSpec = ArgOption | ArgText | ArgInt | ArgToggle;

export type ArgValue = string | number | boolean;

export type ArgValues = Record<string, ArgValue>;

export type Family = 'Encoding' | 'Text' | 'Data formats' | 'Checksums' | 'Compression' | 'Flow';

export const FAMILIES: readonly Family[] = ['Encoding', 'Text', 'Data formats', 'Checksums', 'Compression', 'Flow'];

export interface OperationSpec {
  readonly name: string;
  readonly family: Family;
  readonly args: readonly ArgSpec[];
  readonly regexStep: boolean;
  readonly spanSupported: boolean;
}

const ALPHABET = ['Standard', 'URL-safe'] as const;
const DELIMS = ['Space', 'None', 'Comma', 'Colon', 'Line feed'] as const;
const AUTO = ['Auto'] as const;
const ENCODINGS = ['UTF-8', 'UTF-16LE', 'ISO-8859-1'] as const;

export const OPERATIONS: readonly OperationSpec[] = [
  { name: 'To Base64', family: 'Encoding', args: [{ kind: 'option', key: 'alphabet', label: 'Alphabet', options: ALPHABET, default: 'Standard' }], regexStep: false, spanSupported: true },
  { name: 'From Base64', family: 'Encoding', args: [{ kind: 'option', key: 'alphabet', label: 'Alphabet', options: ALPHABET, default: 'Standard' }, { kind: 'toggle', key: 'strict', label: 'Strict', default: false }], regexStep: false, spanSupported: false },
  { name: 'To Hex', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: DELIMS, default: 'Space' }], regexStep: false, spanSupported: true },
  { name: 'From Hex', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: AUTO, default: 'Auto' }], regexStep: false, spanSupported: false },
  { name: 'To Hexdump', family: 'Encoding', args: [{ kind: 'int', key: 'width', label: 'Width', min: 1, max: 64, default: 16 }], regexStep: false, spanSupported: false },
  { name: 'From Hexdump', family: 'Encoding', args: [], regexStep: false, spanSupported: false },
  { name: 'URL Encode', family: 'Encoding', args: [{ kind: 'toggle', key: 'encodeAllReserved', label: 'Encode all reserved', default: true }], regexStep: false, spanSupported: false },
  { name: 'URL Decode', family: 'Encoding', args: [], regexStep: false, spanSupported: false },
  { name: 'To Binary', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: DELIMS, default: 'Space' }], regexStep: false, spanSupported: true },
  { name: 'From Binary', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: AUTO, default: 'Auto' }], regexStep: false, spanSupported: false },
  { name: 'To Decimal', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: ['Space', 'Comma', 'Line feed'], default: 'Space' }], regexStep: false, spanSupported: false },
  { name: 'From Decimal', family: 'Encoding', args: [{ kind: 'option', key: 'delimiter', label: 'Delimiter', options: AUTO, default: 'Auto' }], regexStep: false, spanSupported: false },
  { name: 'Encode Text', family: 'Text', args: [{ kind: 'option', key: 'encoding', label: 'Encoding', options: ENCODINGS, default: 'UTF-8' }], regexStep: false, spanSupported: false },
  { name: 'Decode Text', family: 'Text', args: [{ kind: 'option', key: 'encoding', label: 'Encoding', options: ENCODINGS, default: 'UTF-8' }], regexStep: false, spanSupported: false },
  { name: 'Change Case', family: 'Text', args: [{ kind: 'option', key: 'case', label: 'Case', options: ['Upper', 'Lower'], default: 'Upper' }], regexStep: false, spanSupported: true },
  { name: 'Reverse', family: 'Text', args: [{ kind: 'option', key: 'by', label: 'By', options: ['Character', 'Line'], default: 'Character' }], regexStep: false, spanSupported: false },
  { name: 'Remove Whitespace', family: 'Text', args: [{ kind: 'toggle', key: 'spaces', label: 'Spaces', default: true }, { kind: 'toggle', key: 'tabs', label: 'Tabs', default: true }, { kind: 'toggle', key: 'lineBreaks', label: 'Line breaks', default: true }], regexStep: false, spanSupported: false },
  { name: 'Normalize Line Endings', family: 'Text', args: [{ kind: 'option', key: 'to', label: 'To', options: ['LF', 'CRLF'], default: 'LF' }], regexStep: false, spanSupported: false },
  { name: 'Find and Replace', family: 'Text', args: [{ kind: 'text', key: 'find', label: 'Find', default: '' }, { kind: 'text', key: 'replace', label: 'Replace', default: '' }, { kind: 'text', key: 'flags', label: 'Flags', default: 'g' }], regexStep: true, spanSupported: false },
  { name: 'Extract Matches', family: 'Text', args: [{ kind: 'text', key: 'find', label: 'Find', default: '' }, { kind: 'text', key: 'flags', label: 'Flags', default: 'g' }], regexStep: true, spanSupported: false },
  { name: 'Sort Lines', family: 'Text', args: [{ kind: 'option', key: 'order', label: 'Order', options: ['Alphabetical', 'Alphabetical, ignore case', 'Numeric'], default: 'Alphabetical' }, { kind: 'toggle', key: 'reverse', label: 'Reverse', default: false }, { kind: 'toggle', key: 'unique', label: 'Unique', default: false }], regexStep: false, spanSupported: false },
  { name: 'Unique Lines', family: 'Text', args: [], regexStep: false, spanSupported: false },
  { name: 'JSON Beautify', family: 'Data formats', args: [{ kind: 'option', key: 'indent', label: 'Indent', options: ['2', '4', 'Tab'], default: '2' }], regexStep: false, spanSupported: false },
  { name: 'JSON Minify', family: 'Data formats', args: [], regexStep: false, spanSupported: false },
  { name: 'CSV to JSON', family: 'Data formats', args: [{ kind: 'text', key: 'delimiter', label: 'Delimiter', default: ',' }, { kind: 'toggle', key: 'firstRowIsHeader', label: 'First row is header', default: true }], regexStep: false, spanSupported: false },
  { name: 'JSON to CSV', family: 'Data formats', args: [], regexStep: false, spanSupported: false },
  { name: 'MD5', family: 'Checksums', args: [], regexStep: false, spanSupported: false },
  { name: 'SHA-1', family: 'Checksums', args: [], regexStep: false, spanSupported: false },
  { name: 'SHA-256', family: 'Checksums', args: [], regexStep: false, spanSupported: false },
  { name: 'CRC32', family: 'Checksums', args: [], regexStep: false, spanSupported: false },
  { name: 'Gzip', family: 'Compression', args: [{ kind: 'int', key: 'level', label: 'Level', min: 1, max: 9, default: 6 }], regexStep: false, spanSupported: false },
  { name: 'Gunzip', family: 'Compression', args: [], regexStep: false, spanSupported: false },
  { name: 'Fork', family: 'Flow', args: [{ kind: 'text', key: 'splitDelimiter', label: 'Split delimiter', default: '\\n' }], regexStep: false, spanSupported: false },
  { name: 'Merge', family: 'Flow', args: [{ kind: 'text', key: 'joiner', label: 'Joiner', default: '\\n' }], regexStep: false, spanSupported: false },
];

export interface Step {
  op: string;
  args: ArgValues;
  disabled: boolean;
  breakpoint: boolean;
}

const opMap: Map<string, OperationSpec> = new Map(OPERATIONS.map((o) => [o.name, o]));

export function operation(name: string): OperationSpec | undefined {
  return opMap.get(name);
}

export function argLabels(name: string): readonly string[] {
  return opMap.get(name)?.args.map((a) => a.label) ?? [];
}

export function defaultArgs(name: string): ArgValues {
  const out: ArgValues = {};
  for (const a of opMap.get(name)?.args ?? []) out[a.key] = a.default;
  return out;
}

export function stepFrom(op: string, args: ArgValues = {}): Step {
  return { op, args: { ...defaultArgs(op), ...args }, disabled: false, breakpoint: false };
}

/** Coerces a raw argument value to its declared type, or explains why it cannot be. */
export function coerceArg(spec: OperationSpec, key: string, value: unknown): { value: ArgValue } | { message: string } {
  const a = spec.args.find((s) => s.key === key);
  if (!a) return { message: `Unknown argument '${key}' for ${spec.name}` };
  if (a.kind === 'toggle') {
    if (typeof value !== 'boolean') return { message: `Argument '${key}' of ${spec.name} must be a boolean` };
    return { value };
  }
  if (a.kind === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return { message: `Argument '${key}' of ${spec.name} must be an integer` };
    if (value < a.min || value > a.max) return { message: `Argument '${key}' of ${spec.name} must be between ${a.min} and ${a.max}` };
    return { value };
  }
  if (typeof value !== 'string') return { message: `Argument '${key}' of ${spec.name} must be a string` };
  if (a.kind === 'option' && !a.options.includes(value)) return { message: `Argument '${key}' of ${spec.name} must be one of ${a.options.join(', ')}` };
  if (a.key === 'flags' && !/^[gims]*$/.test(value)) return { message: `Argument 'flags' of ${spec.name} must be a subset of g, i, m, s` };
  return { value };
}

/** The one place a steps payload is validated, with messages keyed like `steps.2.args.width`. */
export function validateSteps(steps: readonly unknown[]): { steps: Step[] } | { fields: Record<string, string> } {
  if (steps.length > 100) return { fields: { steps: 'A recipe has at most 100 steps.' } };
  const fields: Record<string, string> = {};
  const out: Step[] = [];
  steps.forEach((raw, i) => {
    const base = `steps.${i}`;
    if (typeof raw !== 'object' || raw === null) {
      fields[`${base}.op`] = 'A step must be an object.';
      return;
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.op !== 'string') {
      fields[`${base}.op`] = 'A step needs an operation name.';
      return;
    }
    const spec = operation(rec.op);
    if (!spec) {
      fields[`${base}.op`] = `Unknown operation '${rec.op}'.`;
      return;
    }
    const args: ArgValues = {};
    for (const [k, v] of Object.entries(rec.args ?? {})) {
      const r = coerceArg(spec, k, v);
      if ('message' in r) fields[`${base}.args.${k}`] = r.message;
      else args[k] = r.value;
    }
    if (rec.disabled !== undefined && typeof rec.disabled !== 'boolean') fields[`${base}.disabled`] = 'disabled must be a boolean.';
    if (rec.breakpoint !== undefined && typeof rec.breakpoint !== 'boolean') fields[`${base}.breakpoint`] = 'breakpoint must be a boolean.';
    out.push({ op: spec.name, args: { ...defaultArgs(spec.name), ...args }, disabled: rec.disabled === true, breakpoint: rec.breakpoint === true });
  });
  if (Object.keys(fields).length > 0) return { fields };
  return { steps: out };
}

export const TAG_RE = /^[a-z0-9-]{1,30}$/;

export function parseTags(text: string): { tags: string[] } | { message: string } {
  const tags = text.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  if (tags.length > 10 || tags.some((t) => !TAG_RE.test(t))) {
    return { message: 'Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most.' };
  }
  return { tags };
}
