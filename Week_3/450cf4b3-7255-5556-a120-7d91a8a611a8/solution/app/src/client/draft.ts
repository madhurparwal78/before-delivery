// The interrupted upload: when a request on Documents answers 401 while the upload form holds a non-default
// value, the form is kept in page memory, bound to the signed-in user's id, and restored only when the same
// account signs in next without a reload.

import type { DocumentKind } from "../shared/api.js";

interface UploadDraft {
  userId: string;
  kind: DocumentKind;
  expiresOn: string;
  limit: string;
  insured: boolean;
  file: File | null;
}

let live: UploadDraft | null = null;
let kept: UploadDraft | null = null;

/** The mounted Documents form reports its values here (null when it unmounts). */
export function mirrorForm(draft: UploadDraft | null): void {
  live = draft;
}

const isDefault = (d: UploadDraft): boolean => d.kind === "insurance_certificate" && d.expiresOn === "" && d.limit === "" && !d.insured && d.file === null;

export function keepDraftOnSessionEnd(): void {
  kept = live && !isDefault(live) ? live : null;
}

export function takeDraft(userId: string): UploadDraft | null {
  const draft = kept?.userId === userId ? kept : null;
  kept = null;
  return draft;
}

/** Sign out (null) or a sign-in as another account discards the draft. */
export function discardDraftExcept(userId: string | null): void {
  if (kept && kept.userId !== userId) kept = null;
}
