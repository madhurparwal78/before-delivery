// The web editor's model: open files, the commit actions they make, and the three-way merge onto a newer head.
import { merge3 } from "../../../shared/merge.ts";

export interface OpenFile {
  key: number;
  path: string;
  /** Path at the base commit; null for a file that does not exist there yet. */
  originPath: string | null;
  /** Text at the base commit; null for a new file. */
  original: string | null;
  text: string;
  deleted: boolean;
  /** Set when "Refresh and reapply" left conflict markers in the text. */
  conflicted: boolean;
}

interface CommitAction {
  action: "create" | "update" | "delete" | "move";
  path: string;
  content?: string;
  previous_path?: string;
}

export function isChanged(file: OpenFile): boolean {
  if (file.originPath === null) return !file.deleted;
  return file.deleted || file.path !== file.originPath || file.text !== file.original;
}

function actionOf(file: OpenFile): CommitAction | null {
  if (!isChanged(file)) return null;
  if (file.originPath === null) return { action: "create", path: file.path, content: file.text };
  if (file.deleted) return { action: "delete", path: file.originPath };
  if (file.path !== file.originPath) return { action: "move", path: file.path, previous_path: file.originPath, content: file.text };
  return { action: "update", path: file.path, content: file.text };
}

export function actionsOf(files: readonly OpenFile[]): CommitAction[] {
  const actions: CommitAction[] = [];
  for (const file of files) {
    const action = actionOf(file);
    if (action) actions.push(action);
  }
  return actions;
}

export function describeAction(action: CommitAction): string {
  if (action.action === "create") return `Create ${action.path}`;
  if (action.action === "delete") return `Delete ${action.path}`;
  if (action.action === "move") return `Rename ${action.previous_path ?? ""} to ${action.path}`;
  return `Update ${action.path}`;
}

export interface Draft {
  text: string;
  created: boolean;
}

/** What survives a reload: edited text of a file in place, and new files. Renames and deletions are not kept. */
export function draftOf(file: OpenFile): Draft | null {
  if (file.deleted || (file.originPath !== null && file.path !== file.originPath)) return null;
  if (file.originPath === null) return { text: file.text, created: true };
  return file.text !== file.original ? { text: file.text, created: false } : null;
}

/**
 * Moves an open file onto a newer head. base = the file at the old head, ours = the file at the new head, theirs = the user's
 * edit. Returns null when nothing is left to do for a deleted file that is already gone.
 */
export function reapply(file: OpenFile, ours: string | null, branch: string): OpenFile | null {
  if (file.deleted) return ours === null ? null : { ...file, original: ours };
  if (ours === null) return { ...file, originPath: null, original: null, conflicted: false };
  const merged = merge3(file.original ?? "", ours, file.text, { ours: branch, theirs: "your changes" });
  return { ...file, originPath: file.originPath ?? file.path, original: ours, text: merged.text, conflicted: !merged.clean };
}
