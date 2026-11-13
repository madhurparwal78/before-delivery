// Unsaved editor text kept in local storage, keyed by project, branch and path.
import { asString, isRecord } from "../../util.ts";
import type { Draft } from "./editor-model.ts";

function prefix(project: string, branch: string): string {
  return `spurline:editor:${project}:${branch}:`;
}

function stored(project: string, branch: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  try {
    const start = prefix(project, branch);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(start)) found.push([key, key.slice(start.length)]);
    }
  } catch {
    return [];
  }
  return found;
}

export function readDrafts(project: string, branch: string): Map<string, Draft> {
  const drafts = new Map<string, Draft>();
  for (const [key, path] of stored(project, branch)) {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      const text = isRecord(raw) ? asString(raw.text) : null;
      if (text !== null && isRecord(raw)) drafts.set(path, { text, created: raw.created === true });
    } catch {
      continue;
    }
  }
  return drafts;
}

/** Makes the stored drafts of this project and branch exactly `wanted`. */
export function writeDrafts(project: string, branch: string, wanted: ReadonlyMap<string, Draft>): void {
  try {
    for (const [key, path] of stored(project, branch)) if (!wanted.has(path)) localStorage.removeItem(key);
    for (const [path, draft] of wanted) localStorage.setItem(prefix(project, branch) + path, JSON.stringify(draft));
  } catch {
    return;
  }
}
