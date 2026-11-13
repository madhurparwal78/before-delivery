// Field-level conflict resolution, shared by browser and server (DP-22, DP-65).
export type ResolvableField =
  | "observed_at"
  | "seeing"
  | "transparency_nelm"
  | "concentration_class"
  | "pair"
  | "description"
  | "optics"
  | "sketch";

export const resolvableFields: readonly ResolvableField[] = [
  "observed_at",
  "seeing",
  "transparency_nelm",
  "concentration_class",
  "pair",
  "description",
  "optics",
  "sketch",
];

export interface FieldEdit {
  readonly edited_at: string; // canonical UTC text
  readonly edited_epoch_ms: number;
  readonly device: string;
}

export interface ConflictReport {
  readonly field: ResolvableField;
  readonly outcome: "kept" | "replaced";
  readonly other_device: string;
  readonly other_edited_at: string;
}

// One decision in one place: an incoming value applies when its edited_at is
// the same as or later than the stored one.
export function incomingWins(incoming: FieldEdit, stored: FieldEdit): boolean {
  if (incoming.edited_epoch_ms !== stored.edited_epoch_ms) return incoming.edited_epoch_ms > stored.edited_epoch_ms;
  return incoming.edited_at >= stored.edited_at;
}
