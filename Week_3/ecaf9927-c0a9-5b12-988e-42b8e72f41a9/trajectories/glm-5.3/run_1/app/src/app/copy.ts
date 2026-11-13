import type { Part, Sketch } from "../shared/types.js";

/** Feedback copy, in the exact words of the brief. */

export function bodyStatusChip(part: Part): { text: string; conflict: boolean } {
  if (part.body.status === "stored") return { text: "Stored", conflict: false };
  if (part.body.status === "not_stored") return { text: "Not stored", conflict: true };
  if (part.body.status === "saving") return { text: "Saving…", conflict: false };
  return { text: "No body", conflict: false };
}

export const saveStatusText = {
  idle: "",
  saving: "Saving…",
  stored: "Stored",
  not_stored: "Not stored",
  no_body: "No body yet"
} as const;

export function measurementsCopy(part: Part): { heading: "Preview" | "Confirmed" | "None"; noBody: boolean } {
  if (part.body.status === "none") return { heading: "None", noBody: true };
  if (part.body.status === "not_stored" && !part.confirmed) return { heading: "None", noBody: true };
  return { heading: "Confirmed", noBody: false };
}

export function sketchStrokesInk(sketch: Sketch): boolean {
  return sketch.fully_held;
}
