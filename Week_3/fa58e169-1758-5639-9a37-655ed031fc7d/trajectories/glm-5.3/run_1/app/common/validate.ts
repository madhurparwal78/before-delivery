import { bind, fieldErrors } from "../common/copy";
import { env } from "../common/env";

export interface FieldError {
  field: string;
  message: string;
}

export function patternNameError(name: string): FieldError | null {
  if (name.trim() === "") return { field: "name", message: fieldErrors.patternNameEmpty };
  if (name.length > 120) return { field: "name", message: fieldErrors.patternNameLong };
  return null;
}

export function rowsError(rows: number): FieldError | null {
  if (!Number.isInteger(rows) || rows < 1 || rows > env.limits.maxChartRows) {
    return { field: "rows", message: bind(fieldErrors.rows, { max: env.limits.maxChartRows }) };
  }
  return null;
}

export function columnsError(columns: number): FieldError | null {
  if (!Number.isInteger(columns) || columns < 1 || columns > env.limits.maxChartCols) {
    return { field: "columns", message: bind(fieldErrors.columns, { max: env.limits.maxChartCols }) };
  }
  return null;
}

export function castOnError(castOn: number): FieldError | null {
  if (!Number.isInteger(castOn) || castOn < 1) return { field: "castOn", message: fieldErrors.castOn };
  return null;
}

export function colourNameValidationError(name: string): FieldError | null {
  if (name.trim() === "") return { field: "name", message: fieldErrors.colourName };
  return null;
}

export function colourHexValidationError(hex: string): FieldError | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { field: "hex", message: fieldErrors.colourHex };
  return null;
}

export function versionNoteError(note: string): FieldError | null {
  if (note.length > 200) return { field: "note", message: fieldErrors.versionNote };
  return null;
}

export function noteTextError(text: string): FieldError | null {
  if (text.trim() === "") return { field: "text", message: fieldErrors.noteEmpty };
  if (text.length > env.limits.noteMaxChars) {
    return { field: "text", message: bind(fieldErrors.noteLong, { max: env.limits.noteMaxChars }) };
  }
  return null;
}

export function emailValidationError(email: string): FieldError | null {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { field: "email", message: fieldErrors.testerEmail };
  return null;
}

export function passwordValidationError(password: string): FieldError | null {
  if (password.length < 10) return { field: "password", message: fieldErrors.passwordShort };
  return null;
}

export function nameValidationError(name: string): FieldError | null {
  if (name.trim() === "") return { field: "name", message: fieldErrors.nameEmpty };
  return null;
}
