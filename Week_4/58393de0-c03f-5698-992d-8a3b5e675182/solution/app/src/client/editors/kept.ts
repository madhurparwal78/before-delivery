import type { ProjectKind, Snapshot } from "../../shared/types";

/** Unsaved edits of one project, kept in this browser until a save is confirmed. */
export interface KeptEdits {
  snapshot: Snapshot;
  name: string;
}

const PREFIX = "qy:kept:";

/** Keyed by project id, or by `new:<kind>` for a design that has no project yet. */
export function keptKey(projectId: string | null, kind: ProjectKind): string {
  return `${PREFIX}${projectId ?? `new:${kind}`}`;
}

function isKept(value: unknown): value is KeptEdits {
  if (typeof value !== "object" || value === null) return false;
  const { snapshot, name } = value as { snapshot?: unknown; name?: unknown };
  return typeof name === "string" && typeof snapshot === "object" && snapshot !== null && typeof (snapshot as { kind?: unknown }).kind === "string";
}

export function readKept(key: string): KeptEdits | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isKept(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A full browser store or blocked storage only loses the safety copy, never the open design. */
export function writeKept(key: string, edits: KeptEdits): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(edits));
  } catch {
    return;
  }
}

export function clearKept(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}
