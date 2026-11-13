import type { CellType, FieldError, Output } from "../shared/api";
import { isObject } from "./validate";

/** The one place that decides what a notebook file or a run output may contain. */

const Q = '"';
/** The published validation messages that quote words. */
export const CELL_TYPE_MESSAGE = `must be ${Q}code${Q} or ${Q}markdown${Q}`;
const STREAM_NAME_MESSAGE = `must be ${Q}stdout${Q} or ${Q}stderr${Q}`;
const OUTPUT_TYPE_MESSAGE = `must be ${Q}stream${Q}, ${Q}execute_result${Q}, ${Q}display_data${Q} or ${Q}error${Q}`;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;


const isStringOrList = (value: unknown): value is string | string[] =>
  typeof value === "string" || (Array.isArray(value) && value.every((part) => typeof part === "string"));

const isCount = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);

export const joinSource = (value: string | string[]): string => (Array.isArray(value) ? value.join("") : value);

const IMAGE_SIGNATURES: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];

/** The image type judged from the bytes, never from a declared type. */
export function imageType(bytes: Uint8Array): string | null {
  for (const [type, signature] of IMAGE_SIGNATURES) {
    if (signature.every((byte, index) => bytes[index] === byte)) return type;
  }
  return null;
}

/** Checks one output; errors are appended with `path` as their prefix. */
export function checkOutput(value: unknown, path: string, errors: FieldError[]): void {
  const fail = (key: string, message: string): void => void errors.push({ path: key ? `${path}.${key}` : path, message });
  if (!isObject(value)) return fail("", "must be an object");
  const kind = value.output_type;
  if (kind === undefined) return fail("output_type", "is required");
  if (kind !== "stream" && kind !== "execute_result" && kind !== "display_data" && kind !== "error") {
    return fail("output_type", OUTPUT_TYPE_MESSAGE);
  }
  const need = (key: string, valid: (v: unknown) => boolean, message: string): void => {
    if (!(key in value)) fail(key, "is required");
    else if (!valid(value[key])) fail(key, message);
  };
  const objectField = (key: string): void => need(key, isObject, "must be an object");
  if (kind === "stream") {
    need("name", (v) => v === "stdout" || v === "stderr", STREAM_NAME_MESSAGE);
    need("text", isStringOrList, "must be a string or a list of strings");
  } else if (kind === "execute_result") {
    need("execution_count", isCount, "must be null or a whole number of at least 0");
    objectField("data");
    objectField("metadata");
  } else if (kind === "display_data") {
    objectField("data");
    objectField("metadata");
  } else {
    need("ename", (v) => typeof v === "string", "must be a string");
    need("evalue", (v) => typeof v === "string", "must be a string");
    need("traceback", (v) => Array.isArray(v) && v.every((line) => typeof line === "string"), "must be a list of strings");
  }
}

export interface ImportedCell {
  id: string | null;
  cell_type: CellType;
  source: string;
  metadata: Record<string, unknown>;
  execution_count: number | null;
  outputs: Output[];
  attachments: { name: string; bytes: Buffer }[];
}

export interface ImportedNotebook {
  cells: ImportedCell[];
}

/** Validates a parsed notebook file against the accepted subset and lists every error in document order. */
export function readNotebookFile(parsed: unknown): { errors: FieldError[]; notebook: ImportedNotebook } {
  const errors: FieldError[] = [];
  const fail = (path: string, message: string): void => void errors.push({ path, message });
  const notebook: ImportedNotebook = { cells: [] };
  const file: Record<string, unknown> = isObject(parsed) ? parsed : {};
  if (!("nbformat" in file)) fail("nbformat", "is required");
  else if (file.nbformat !== 4) fail("nbformat", "must be 4");
  const minor = file.nbformat_minor;
  if (!("nbformat_minor" in file)) fail("nbformat_minor", "is required");
  else if (minor !== 4 && minor !== 5) fail("nbformat_minor", "must be 4 or 5");
  if (!("metadata" in file)) fail("metadata", "is required");
  else if (!isObject(file.metadata)) fail("metadata", "must be an object");
  if (!("cells" in file)) {
    fail("cells", "is required");
    return { errors, notebook };
  }
  if (!Array.isArray(file.cells)) {
    fail("cells", "must be an array");
    return { errors, notebook };
  }
  const firstIdAt = new Map<string, number>();
  file.cells.forEach((raw: unknown, i: number) => {
    const at = `cells[${i}]`;
    if (!isObject(raw)) return fail(at, "must be an object");
    const kind = raw.cell_type;
    if (!("cell_type" in raw)) fail(`${at}.cell_type`, "is required");
    else if (kind !== "code" && kind !== "markdown") fail(`${at}.cell_type`, CELL_TYPE_MESSAGE);
    let id: string | null = null;
    if (!("id" in raw)) {
      if (minor === 5) fail(`${at}.id`, "is required");
    } else if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
      fail(`${at}.id`, 'must be 1 to 64 characters of letters, digits, "-" or "_"');
    } else if (firstIdAt.has(raw.id)) {
      fail(`${at}.id`, `duplicates cells[${firstIdAt.get(raw.id)}].id`);
    } else {
      id = raw.id;
      firstIdAt.set(id, i);
    }
    if (!("source" in raw)) fail(`${at}.source`, "is required");
    else if (!isStringOrList(raw.source)) fail(`${at}.source`, "must be a string or a list of strings");
    if (!("metadata" in raw)) fail(`${at}.metadata`, "is required");
    else if (!isObject(raw.metadata)) fail(`${at}.metadata`, "must be an object");
    if (kind !== "code" && kind !== "markdown") return;
    const outputs: Output[] = [];
    let count: number | null = null;
    const attachments: ImportedCell["attachments"] = [];
    if (kind === "code") {
      if (!("execution_count" in raw)) fail(`${at}.execution_count`, "is required");
      else if (!isCount(raw.execution_count)) fail(`${at}.execution_count`, "must be null or a whole number of at least 0");
      else count = raw.execution_count as number | null;
      if (!("outputs" in raw)) fail(`${at}.outputs`, "is required");
      else if (!Array.isArray(raw.outputs)) fail(`${at}.outputs`, "must be an array");
      else {
        raw.outputs.forEach((out: unknown, k: number) => {
          const before = errors.length;
          checkOutput(out, `${at}.outputs[${k}]`, errors);
          if (errors.length === before) outputs.push(out as Output);
        });
      }
    } else {
      if ("outputs" in raw) fail(`${at}.outputs`, "is not allowed on a markdown cell");
      if ("attachments" in raw) {
        if (!isObject(raw.attachments)) fail(`${at}.attachments`, "must be an object");
        else {
          for (const [name, bundle] of Object.entries(raw.attachments)) {
            const entry = isObject(bundle) ? Object.values(bundle)[0] : undefined;
            const text = isStringOrList(entry) ? joinSource(entry) : "";
            const bytes = Buffer.from(text, "base64");
            if (!isObject(bundle) || Object.keys(bundle).length !== 1 || !imageType(bytes)) {
              fail(`${at}.attachments["${name}"]`, "must be a PNG, JPEG or GIF image");
            } else attachments.push({ name, bytes });
          }
        }
      }
    }
    notebook.cells.push({
      id,
      cell_type: kind,
      source: isStringOrList(raw.source) ? joinSource(raw.source) : "",
      metadata: isObject(raw.metadata) ? raw.metadata : {},
      execution_count: count,
      outputs,
      attachments,
    });
  });
  return { errors, notebook };
}
