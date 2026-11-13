// Push rules against the database: loads the project's rules and works out what a commit changes.
import type { Queryable } from "../db.ts";
import { fieldError } from "../errors.ts";
import { diffLines, splitLines } from "../../shared/diff.ts";
import { compareUtf8 } from "../lib/objects.ts";
import { entriesOfFiles, readTexts } from "./store.ts";
import type { Entries } from "./trees.ts";
import type { FileMap } from "./types.ts";
import { firstViolation, type AddedLines, type PushRules } from "./rules.ts";

async function loadPushRules(q: Queryable, projectId: number): Promise<PushRules | undefined> {
  return q.maybe<PushRules>("SELECT branch_name, commit_message, forbidden_files, required_files, secrets FROM push_rules WHERE project_id = $1", [projectId]);
}

interface RuleCheck {
  readonly projectId: number;
  readonly branch: string;
  readonly isNewBranch: boolean;
  readonly message: string;
  // The first parent's snapshot (null = none).
  readonly before: Entries | null;
  readonly after: Entries;
  // Text of blobs the caller already holds, so they need not be read back.
  readonly known?: ReadonlyMap<string, string>;
}

/** Throws 422 `push_rule` with the first violation in the published order. */
export async function enforcePushRules(q: Queryable, check: RuleCheck): Promise<void> {
  const rules = await loadPushRules(q, check.projectId);
  if (rules === undefined) return;
  const before = check.before ?? new Map<string, string>();
  const changed = [...check.after].filter(([path, blob]) => before.get(path) !== blob).map(([path]) => path).sort(compareUtf8);
  const added = async (): Promise<AddedLines[]> => {
    const blobs = new Set<string>();
    for (const path of changed) {
      blobs.add(check.after.get(path) ?? "");
      const old = before.get(path);
      if (old !== undefined) blobs.add(old);
    }
    const known = check.known ?? new Map<string, string>();
    const texts = new Map<string, string>();
    const unread = [...blobs].filter((blob) => !known.has(blob));
    for (const [blob, text] of await readTexts(q, check.projectId, unread)) texts.set(blob, text);
    const textOf = (blob: string | undefined): string => (blob === undefined ? "" : known.get(blob) ?? texts.get(blob) ?? "");
    return changed.map((path) => {
      const ops = diffLines(splitLines(textOf(before.get(path))), splitLines(textOf(check.after.get(path))));
      return {
        path,
        lines: ops.flatMap((op) => (op.type === "add" && op.new !== null ? [{ line: op.new, text: op.text }] : [])),
      };
    });
  };
  const violation = await firstViolation(rules, {
    branch: check.branch, isNewBranch: check.isNewBranch, message: check.message,
    changed, result: new Set(check.after.keys()), added,
  });
  if (violation !== null) throw fieldError("push_rule", violation.field, violation.message);
}

/** Push rules for a commit about to be written (branch name, message, forbidden/required files, secrets). Throws 422 `push_rule`. */
export async function checkPushRules(
  q: Queryable,
  input: { projectId: number; branch: string; isNewBranch: boolean; message: string; before: FileMap | null; after: FileMap },
): Promise<void> {
  const texts = new Map<string, string>();
  const entriesOf = (files: FileMap): Map<string, string> => {
    const built = entriesOfFiles(files);
    for (const [path, blob] of built.entries) texts.set(blob, files.get(path) ?? "");
    return built.entries;
  };
  await enforcePushRules(q, {
    projectId: input.projectId, branch: input.branch, isNewBranch: input.isNewBranch, message: input.message,
    before: input.before === null ? null : entriesOf(input.before), after: entriesOf(input.after), known: texts,
  });
}
