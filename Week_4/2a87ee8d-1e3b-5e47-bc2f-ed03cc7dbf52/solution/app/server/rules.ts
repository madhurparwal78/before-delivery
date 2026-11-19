// Who may write what in each workshop state, and the accepted keys of every board write.
import { ApiError, FIELD, fail, type Fields } from "./errors.js";
import type { Actor } from "./auth.js";
import type { WorkshopRow } from "./store.js";
import { STATUS_LABELS, isEnded, type Status } from "../shared/states.js";

type BoardWrite = "link" | "frame" | "noteCreate" | "noteEdit" | "notePlacement" | "noteDelete" | "cluster" | "connector" | "dot" | "versionRestore";

const PARTICIPANT_WRITES: Record<Status, readonly BoardWrite[]> = {
  draft: [],
  open: [],
  silent_round: ["noteCreate", "noteEdit", "noteDelete"],
  revealed: ["noteCreate", "noteEdit", "notePlacement", "noteDelete", "cluster", "connector"],
  voting: ["dot"],
  closed: [],
  archived: [],
};

const RESTORE_STATES: readonly Status[] = ["draft", "open", "revealed"];

export function phaseLocked(status: Status): never {
  throw new ApiError("phase_locked", { message: `That isn't available while the workshop is ${STATUS_LABELS[status]}` });
}

/** Step 8 of the error order for board writes: workshop_closed, phase_locked, then deadline_passed. */
export function checkState(actor: Actor, w: WorkshopRow, write: BoardWrite): void {
  if (isEnded(w.status)) fail("workshop_closed");
  if (write === "versionRestore") {
    if (!RESTORE_STATES.includes(w.status)) phaseLocked(w.status);
    return;
  }
  if (actor.kind === "facilitator") return;
  if (!PARTICIPANT_WRITES[w.status].includes(write)) phaseLocked(w.status);
  const deadline = w.status === "silent_round" ? w.round_ends_at : w.status === "voting" ? w.voting_ends_at : null;
  if (deadline && Date.now() >= deadline.getTime()) fail("deadline_passed");
}

type Spec = { top: readonly string[]; nested?: Record<string, readonly string[]> };

export const ACCEPTED = {
  createFrame: { top: ["clientOpId", "title", "x", "y", "width", "height"] },
  patchFrame: { top: ["clientOpId", "title", "x", "y", "width", "height"] },
  opOnly: { top: ["clientOpId"] },
  createNote: { top: ["clientOpId", "frameId", "kind", "text", "imageId", "x", "y", "facilitatorOnly"] },
  patchNote: {
    top: ["clientOpId", "position", "text", "placement", "facilitatorOnly"],
    nested: { position: ["x", "y"], placement: ["frameId", "clusterId", "index"] },
  },
  createCluster: { top: ["clientOpId", "frameId", "title", "x", "y"] },
  patchCluster: { top: ["clientOpId", "title", "x", "y"] },
  createConnector: { top: ["clientOpId", "fromNoteId", "toNoteId"] },
} satisfies Record<string, Spec>;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Every key a board write does not publish, at the top level and inside its nested objects. */
export function unknownKeys(body: Record<string, unknown>, spec: Spec): Fields {
  const fields: Fields = {};
  for (const key of Object.keys(body)) {
    if (!spec.top.includes(key)) fields[key] = FIELD.unknownKey;
    const nested = spec.nested?.[key];
    const value = body[key];
    if (nested && value && typeof value === "object" && !Array.isArray(value)) {
      for (const inner of Object.keys(value)) if (!nested.includes(inner)) fields[`${key}.${inner}`] = FIELD.unknownKey;
    }
  }
  return fields;
}

export function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -100000 && value <= 100000;
}

export function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000;
}

/** Trimmed text of min..max characters, or null. */
export function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= min && length <= max ? trimmed : null;
}

export function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function throwFields(fields: Fields): void {
  if (Object.keys(fields).length) throw new ApiError("validation", { fields });
}
