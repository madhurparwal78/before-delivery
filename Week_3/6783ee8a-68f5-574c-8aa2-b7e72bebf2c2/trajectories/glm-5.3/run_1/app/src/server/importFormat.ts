import { one, query } from "./db.ts";
import { ApiError, type FieldErrors } from "./http.ts";
import { CELL_ID_RE } from "./store.ts";
import type { Output } from "../shared/types.ts";

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: Json): value is string {
  return typeof value === "string";
}

function isArray(value: Json): value is Json[] {
  return Array.isArray(value);
}

function countCodePoints(text: string): number {
  return [...text].length;
}

/** Import validation in one place: every error found, in document order, at its JSON path. */
export function validateImport(parsed: Json): { errors: FieldErrors } {
  const errors: FieldErrors = [];
  if (!isObject(parsed)) {
    return { errors: [{ path: "file", message: "is not valid JSON" }] };
  }
  const nbformat = parsed["nbformat"];
  if (nbformat === undefined) errors.push({ path: "nbformat", message: "is required" });
  else if (nbformat !== 4) errors.push({ path: "nbformat", message: "must be 4" });
  const minor = parsed["nbformat_minor"];
  let idRequired = false;
  if (minor === undefined) errors.push({ path: "nbformat_minor", message: "is required" });
  else if (minor !== 4 && minor !== 5) errors.push({ path: "nbformat_minor", message: "must be 4 or 5" });
  else idRequired = minor === 5;
  const metadata = parsed["metadata"];
  if (metadata === undefined) errors.push({ path: "metadata", message: "is required" });
  else if (!isObject(metadata)) errors.push({ path: "metadata", message: "must be an object" });
  const cells = parsed["cells"];
  if (cells === undefined) {
    errors.push({ path: "cells", message: "is required" });
    return { errors };
  }
  if (!isArray(cells)) {
    errors.push({ path: "cells", message: "must be an array" });
    return { errors };
  }
  const seenIds = new Map<string, number>();
  cells.forEach((cellValue, i) => {
    const base = `cells[${i}]`;
    if (!isObject(cellValue)) {
      errors.push({ path: base, message: "must be an object" });
      return;
    }
    const cellType = cellValue["cell_type"];
    const validType = cellType === "code" || cellType === "markdown";
    if (cellType === undefined) errors.push({ path: `${base}.cell_type`, message: "is required" });
    else if (!validType) errors.push({ path: `${base}.cell_type`, message: 'must be "code" or "markdown"' });
    if (idRequired) {
      const id = cellValue["id"];
      if (id === undefined) errors.push({ path: `${base}.id`, message: "is required" });
      else if (!isString(id) || !CELL_ID_RE.test(id)) {
        errors.push({ path: `${base}.id`, message: 'must be 1 to 64 characters of letters, digits, "-" or "_"' });
      } else if (seenIds.has(id)) {
        const j = seenIds.get(id) ?? 0;
        errors.push({ path: `${base}.id`, message: `duplicates cells[${j}].id` });
      } else {
        seenIds.set(id, i);
      }
    }
    const source = cellValue["source"];
    if (source === undefined) errors.push({ path: `${base}.source`, message: "is required" });
    else if (!sourceIsStringOrList(source)) errors.push({ path: `${base}.source`, message: "must be a string or a list of strings" });
    const cellMetadata = cellValue["metadata"];
    if (cellMetadata === undefined) errors.push({ path: `${base}.metadata`, message: "is required" });
    else if (!isObject(cellMetadata)) errors.push({ path: `${base}.metadata`, message: "must be an object" });
    if (validType && cellType === "code") {
      const execCount = cellValue["execution_count"];
      if (execCount === undefined) errors.push({ path: `${base}.execution_count`, message: "is required" });
      else if (!isWholeNumberOrNull(execCount)) {
        errors.push({ path: `${base}.execution_count`, message: "must be null or a whole number of at least 0" });
      }
      const outputs = cellValue["outputs"];
      if (outputs === undefined) errors.push({ path: `${base}.outputs`, message: "is required" });
      else if (!isArray(outputs)) errors.push({ path: `${base}.outputs`, message: "must be an array" });
      else outputs.forEach(checkOutput(errors, base));
    }
    if (validType && cellType === "markdown") {
      const outputs = cellValue["outputs"];
      if (outputs !== undefined) errors.push({ path: `${base}.outputs`, message: "is not allowed on a markdown cell" });
      const attachments = cellValue["attachments"];
      if (attachments !== undefined) {
        if (!isObject(attachments)) {
          errors.push({ path: `${base}.attachments`, message: "must be an object" });
        } else {
          for (const name of Object.keys(attachments)) {
            checkAttachment(errors, `${base}.attachments["${name}"]`, attachments[name]);
          }
        }
      }
    }
  });
  return { errors };
}

function checkOutput(errors: FieldErrors, base: string): (value: Json, k: number) => void {
  return (value, k) => {
    const outBase = `${base}.outputs[${k}]`;
    if (!isObject(value)) {
      errors.push({ path: outBase, message: "must be an object" });
      return;
    }
    const outputType = value["output_type"];
    if (outputType === undefined) {
      errors.push({ path: `${outBase}.output_type`, message: "is required" });
      return;
    }
    if (outputType === "stream") {
      requireKey(errors, value, outBase, "name", 'must be "stdout" or "stderr"', (v) => v === "stdout" || v === "stderr");
      const text = value["text"];
      if (text === undefined) errors.push({ path: `${outBase}.text`, message: "is required" });
      else if (!sourceIsStringOrList(text)) errors.push({ path: `${outBase}.text`, message: "must be a string or a list of strings" });
    } else if (outputType === "execute_result") {
      requireKey(errors, value, outBase, "execution_count", "must be null or a whole number of at least 0", isWholeNumberOrNull);
      requireObject(errors, value, outBase, "data");
      requireObject(errors, value, outBase, "metadata");
    } else if (outputType === "display_data") {
      requireObject(errors, value, outBase, "data");
      requireObject(errors, value, outBase, "metadata");
    } else if (outputType === "error") {
      requireKey(errors, value, outBase, "ename", "must be a string", isString);
      requireKey(errors, value, outBase, "evalue", "must be a string", isString);
      const traceback = value["traceback"];
      if (traceback === undefined) errors.push({ path: `${outBase}.traceback`, message: "is required" });
      else if (!isArray(traceback) || !traceback.every(isString)) {
        errors.push({ path: `${outBase}.traceback`, message: "must be a list of strings" });
      }
    } else {
      errors.push({ path: `${outBase}.output_type`, message: 'must be "stream", "execute_result", "display_data" or "error"' });
    }
  };
}

function checkAttachment(errors: FieldErrors, path: string, value: Json): void {
  if (!isObject(value)) {
    errors.push({ path, message: "must be a PNG, JPEG or GIF image" });
    return;
  }
  const mime =
    typeof value["image/png"] === "string" ? "image/png"
    : typeof value["image/jpeg"] === "string" ? "image/jpeg"
    : typeof value["image/gif"] === "string" ? "image/gif"
    : null;
  if (mime === null) {
    errors.push({ path, message: "must be a PNG, JPEG or GIF image" });
    return;
  }
  const base64 = value[mime];
  if (typeof base64 !== "string") {
    errors.push({ path, message: "must be a PNG, JPEG or GIF image" });
    return;
  }
  const bytes = decodeBase64(base64);
  if (bytes === null) {
    errors.push({ path, message: "must be a PNG, JPEG or GIF image" });
    return;
  }
  const detected = sniffImageMime(bytes);
  if (detected === null) {
    errors.push({ path, message: "must be a PNG, JPEG or GIF image" });
  }
}

export function decodeBase64(text: string): Buffer | null {
  try {
    return Buffer.from(text, "base64");
  } catch {
    return null;
  }
}

/** The image type is judged from the decoded bytes, never the declared type. */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
  return null;
}

function requireKey(errors: FieldErrors, obj: Record<string, Json>, base: string, key: string, message: string, test: (v: Json) => boolean): void {
  const value = obj[key];
  if (value === undefined) errors.push({ path: `${base}.${key}`, message: "is required" });
  else if (!test(value)) errors.push({ path: `${base}.${key}`, message });
}

function requireObject(errors: FieldErrors, obj: Record<string, Json>, base: string, key: string): void {
  const value = obj[key];
  if (value === undefined) errors.push({ path: `${base}.${key}`, message: "is required" });
  else if (!isObject(value)) errors.push({ path: `${base}.${key}`, message: "must be an object" });
}

function sourceIsStringOrList(value: Json): boolean {
  if (isString(value)) return true;
  if (isArray(value)) return value.every(isString);
  return false;
}

function isWholeNumberOrNull(value: Json): boolean {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function joinSource(source: Json): string {
  if (isString(source)) return source;
  if (isArray(source)) return source.filter(isString).join("");
  return "";
}

/** The imported working copy keeps outputs exactly as they appear in the file. */
export function workingCopyFromImport(parsed: Json): {
  cells: {
    id: string;
    cell_type: "code" | "markdown";
    source: string;
    metadata: Record<string, Json>;
    execution_count: number | null;
    outputs: Output[];
    attachments: { name: string; bytes: Buffer; mime: string }[];
  }[];
} {
  const root = parsed as Record<string, Json>;
  const cellsRaw = (root["cells"] ?? []) as Json[];
  const newId = makeIdFactory();
  const cells = cellsRaw.map((raw) => {
    const cell = raw as Record<string, Json>;
    const cellType: "code" | "markdown" = cell["cell_type"] === "markdown" ? "markdown" : "code";
    const id = isString(cell["id"]) && CELL_ID_RE.test(cell["id"]) ? (cell["id"] as string) : newId();
    const source = joinSource(cell["source"]);
    const metadata = isObject(cell["metadata"]) ? (cell["metadata"] as Record<string, Json>) : {};
    const attachments: { name: string; bytes: Buffer; mime: string }[] = [];
    if (cellType === "markdown" && isObject(cell["attachments"])) {
      for (const name of Object.keys(cell["attachments"] as Record<string, Json>)) {
        const value = (cell["attachments"] as Record<string, Json>)[name];
        if (isObject(value)) {
          const mime =
            typeof value["image/png"] === "string" ? "image/png"
            : typeof value["image/jpeg"] === "string" ? "image/jpeg"
            : typeof value["image/gif"] === "string" ? "image/gif"
            : null;
          if (mime !== null) {
            const bytes = decodeBase64(value[mime] as string);
            const detected = bytes !== null ? sniffImageMime(bytes) : null;
            if (bytes !== null && detected !== null) {
              attachments.push({ name, bytes, mime: detected });
            }
          }
        }
      }
    }
    const outputs =
      cellType === "code" && isArray(cell["outputs"])
        ? (cell["outputs"] as Json[]).map((o) => o as Output)
        : [];
    const executionCount =
      cellType === "code" && typeof cell["execution_count"] === "number" ? (cell["execution_count"] as number) : null;
    return { id, cell_type: cellType, source, metadata, execution_count: executionCount, outputs, attachments };
  });
  return { cells };
}

function makeIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `cell-${Math.random().toString(36).slice(2, 8)}-${counter}`;
  };
}

export function importValidationError(errors: FieldErrors): ApiError {
  return new ApiError(422, "validation_failed", "Some fields are not valid.", { errors });
}
