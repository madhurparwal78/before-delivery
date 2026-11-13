import type { Mode, SketchSnapshot, Width } from "../field/sketch";

export interface FormValues {
  object_id: string;
  ut: string;
  seeing: string;
  nelm: string;
  concentration: string;
  description: string;
}

export interface Draft {
  values: FormValues;
  dirty: string[];
  editedAt: Record<string, string>;
  sketch: SketchSnapshot;
  mode: Mode;
  width: Width;
  brightness: number;
  newId: string | null;
}

const key = (account: string, session: string, observation: string | null) =>
  `lowlamp:draft:${account}:${session}:${observation ?? "new"}`;

export function readDraft(account: string, session: string, observation: string | null): Draft | null {
  try {
    const raw = window.localStorage.getItem(key(account, session, observation));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(account: string, session: string, observation: string | null, draft: Draft): void {
  try {
    window.localStorage.setItem(key(account, session, observation), JSON.stringify(draft));
  } catch {
    // storage full: the in-memory form still works
  }
}

export function deleteDraft(account: string, session: string, observation: string | null): void {
  window.localStorage.removeItem(key(account, session, observation));
}

