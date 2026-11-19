import type { Value } from "../../../shared/expression.js";
import type { FieldSpec } from "../../../shared/fields.js";
import type { AttachmentJson } from "../../../server/files.js";
import type { RecordJson } from "../../../server/records.js";

/** A record as the API presents it, with its attachments. */
export type Detail = RecordJson & { attachments: AttachmentJson[] };

/** What a person has edited and not saved yet: the value, and the version of the field when they began editing it. */
export type Draft = Record<string, { value: Value; version: number }>;

export interface Conflict {
  field: string;
  label: string;
  yours: Value;
  theirs: Value;
  theirs_by: string;
  version: number;
}

export interface Problem {
  field: string;
  label: string;
  message: string;
}

export const isBlank = (value: Value): boolean => value === null || value === "";

/** True when an edited value says the same as the stored one; blank text and null are the same. */
export function sameAsStored(spec: FieldSpec, edited: Value, stored: Value, storedDisplay: string): boolean {
  if (spec.kind === "instant") return edited === storedDisplay || (isBlank(edited) && isBlank(stored));
  if (isBlank(edited) || isBlank(stored)) return isBlank(edited) && isBlank(stored);
  return edited === stored;
}

export function sentence(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
