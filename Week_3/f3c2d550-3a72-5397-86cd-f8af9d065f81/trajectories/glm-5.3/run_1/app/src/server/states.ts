// Reference and sheet state transitions, decided in exactly one place.
// The whole API asks these functions whether a transition is legal; the error
// codes they return are the published ones.

export type ReferenceState = "stored" | "trashed" | "purged";

export type ReferenceEvent = "trash" | "restore" | "edit" | "reswatch" | "append";

export function referenceTransition(from: ReferenceState, event: ReferenceEvent):
  { ok: true; to: ReferenceState } | { ok: false; code: "already_trashed" | "not_trashed" | "reference_trashed" } {
  switch (event) {
    case "trash":
      if (from === "trashed") return { ok: false, code: "already_trashed" };
      return { ok: true, to: "trashed" };
    case "restore":
      if (from === "stored") return { ok: false, code: "not_trashed" };
      return { ok: true, to: "stored" };
    case "edit":
    case "reswatch":
    case "append":
      if (from === "trashed") return { ok: false, code: "reference_trashed" };
      return { ok: true, to: from };
  }
}

export type SheetState = "queued" | "rendering" | "ready" | "failed";

export type SheetEvent = "start" | "finish" | "fail" | "retry";

// The sheet state machine; no other transition exists.
export function sheetTransition(from: SheetState, event: SheetEvent):
  { ok: true; to: SheetState } | { ok: false } {
  switch (event) {
    case "start": return from === "queued" ? { ok: true, to: "rendering" } : { ok: false };
    case "finish": return from === "rendering" ? { ok: true, to: "ready" } : { ok: false };
    case "fail": return from === "rendering" ? { ok: true, to: "failed" } : { ok: false };
    case "retry": return from === "failed" ? { ok: true, to: "queued" } : { ok: false };
  }
}
