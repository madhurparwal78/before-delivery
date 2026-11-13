// Writing commits and moving refs. Every branch update ends in `afterBranchUpdate`, so versions, pipelines and
// webhooks happen in the same transaction as the ref change.
import { config } from "../config.ts";
import type { Tx, Queryable } from "../db.ts";
import { now, nowSeconds } from "../clock.ts";
import { requireAction, type ProjectRow } from "../access.ts";
import { ApiError, FieldErrors, conflict, payloadTooLarge, validationOne } from "../errors.ts";
import { afterBranchUpdate } from "../push.ts";
import { normalizeMessage, shortId } from "../lib/objects.ts";
import { applyActions, oversizedFile } from "./actions.ts";
import { enforcePushRules } from "./enforce.ts";
import { branchHead, commitsBetween, resolveRef } from "./history.ts";
import { assertMayTag, assertMayUpdate } from "./protection.ts";
import { entriesOfCommit, entriesOfFiles, storeCommit } from "./store.ts";
import { isUtf8Text } from "./trees.ts";
import type {
  BranchUpdate, CommitInput, CommitRow, CommitWithParentsInput, MoveBranchInput, Person, PipelineOutcome, PushSource,
  TagInput, WriteCommitInput,
} from "./types.ts";

const shortOrNone = (id: string | null): string => (id === null ? "none" : shortId(id));

export function staleBase(base: string | null, branch: string, current: string | null): ApiError {
  return conflict("stale_base", `Your base commit ${shortOrNone(base)} is behind ${branch} at ${shortOrNone(current)}. Refresh and try again.`);
}

interface Advance {
  readonly project: ProjectRow;
  readonly branch: string;
  readonly oldHead: string | null;
  readonly newHead: string;
  readonly actor: Person;
  readonly source: PushSource;
  // The commit a new branch started from: its history is not new.
  readonly startedFrom?: string | null;
}

/** Points the branch at `newHead` and runs every consequence of the push. The caller holds the project lock. */
export async function advanceBranch(tx: Tx, advance: Advance): Promise<{ pipeline: PipelineOutcome; update: BranchUpdate }> {
  const { project, branch, oldHead, newHead } = advance;
  if (oldHead === null) {
    await tx.q("INSERT INTO refs (project_id, kind, name, commit_id, created_at) VALUES ($1, 'branch', $2, $3, $4)", [project.id, branch, newHead, now()]);
  } else {
    const moved = await tx.q("UPDATE refs SET commit_id = $3 WHERE project_id = $1 AND kind = 'branch' AND name = $2 AND commit_id = $4 RETURNING name", [project.id, branch, newHead, oldHead]);
    if (moved.length === 0) throw staleBase(oldHead, branch, await branchHead(tx, project.id, branch));
  }
  const newCommits = await commitsBetween(tx, project.id, oldHead ?? advance.startedFrom ?? null, newHead);
  const update: BranchUpdate = { project, branch, oldHead, newHead, actor: advance.actor, source: advance.source, newCommits };
  return { pipeline: await afterBranchUpdate(tx, update), update };
}

function tooLargeFile(path: string): ApiError {
  return payloadTooLarge(`File ${path} is too large (${config.fileMaxBytes} bytes at most).`);
}

// Seeding bypasses protection and push rules; every other source, trains included, is checked.
const checked = (source: PushSource): boolean => source !== "seed";

/** The commit API's primitive: one all-or-nothing commit with stale-base refusal, protection, push rules and every push consequence. */
export async function commitToBranch(tx: Tx, input: CommitInput): Promise<{ commit: string; pipeline: PipelineOutcome; update: BranchUpdate }> {
  const { project, access, actor, branch } = input;
  await tx.lockProject(project.id);
  const oversized = oversizedFile(input.actions, config.fileMaxBytes);
  if (oversized !== undefined) throw tooLargeFile(oversized.path);
  if (access !== null) requireAction(access, "commit");

  const invalid = input.invalid ?? {};
  const head = branch === "" ? null : await branchHead(tx, project.id, branch);
  const startRef = input.startRef ?? null;
  const startHead = head === null && startRef !== null && startRef !== "" ? await resolveRef(tx, project.id, startRef) : null;
  const parent = head ?? startHead;
  if (branch !== "") {
    if (checked(input.source)) await assertMayUpdate(tx, project, access, branch, "push");
    if (invalid["base_commit"] === undefined && input.baseCommit !== parent) throw staleBase(input.baseCommit, branch, parent);
  }

  const fields = new FieldErrors();
  for (const [field, message] of Object.entries(invalid)) if (!field.startsWith("actions")) fields.add(field, message);
  const message = normalizeMessage(input.message);
  if (message === "") fields.add("message", "Commit message can't be blank.");
  for (const [field, text] of Object.entries(invalid)) if (field.startsWith("actions")) fields.add(field, text);
  const before = await entriesOfCommit(tx, project.id, parent);
  const prepared = applyActions(before, input.actions);
  for (const [field, text] of prepared.errors) fields.add(field, text);
  fields.throwIfAny();

  if (checked(input.source)) {
    await enforcePushRules(tx, {
      projectId: project.id, branch, isNewBranch: head === null, message, before: parent === null ? null : before,
      after: prepared.entries, known: prepared.texts,
    });
  }

  const at = input.authoredAt ?? nowSeconds();
  const commit = await storeCommit(tx, {
    projectId: project.id, parents: parent === null ? [] : [parent], entries: prepared.entries, blobs: prepared.blobs,
    author: actor.username, authoredAt: at, committer: actor.username, committedAt: at, message,
  });
  const landed = await advanceBranch(tx, { project, branch, oldHead: head, newHead: commit.id, actor, source: input.source, startedFrom: startHead });
  return { commit: commit.id, ...landed };
}

function assertText(files: ReadonlyMap<string, string>): void {
  for (const [path, text] of files) {
    if (!isUtf8Text(text)) throw validationOne("content", `File ${path} is not UTF-8 text.`);
  }
}

/** Stores a commit object (and its trees and blobs) without moving any ref. Large blobs go to file storage first. */
export async function writeCommit(tx: Tx, input: WriteCommitInput): Promise<CommitRow> {
  assertText(input.files);
  const { entries, blobs } = entriesOfFiles(input.files);
  return storeCommit(tx, {
    projectId: input.projectId, parents: input.parents, entries, blobs, author: input.author, authoredAt: input.authoredAt,
    committer: input.committer, committedAt: input.committedAt, message: input.message,
  });
}

/** Compare-and-set a branch to an existing commit, checking protection, then running every push consequence. */
export async function moveBranch(tx: Tx, input: MoveBranchInput): Promise<{ pipeline: PipelineOutcome; update: BranchUpdate }> {
  const { project, branch } = input;
  await tx.lockProject(project.id);
  if (checked(input.source)) await assertMayUpdate(tx, project, input.access, branch, input.kind);
  const head = await branchHead(tx, project.id, branch);
  if (head !== input.expectedOld) throw staleBase(input.expectedOld, branch, head);
  return advanceBranch(tx, { project, branch, oldHead: head, newHead: input.to, actor: input.actor, source: input.source });
}

/** Writes a commit with explicit parents and moves the branch to it (conflict resolutions, merge commits for the train).
 *  Push rules and protection apply (unless `access` is null for protection); runs every push consequence. */
export async function commitWithParents(tx: Tx, input: CommitWithParentsInput): Promise<{ commit: string; pipeline: PipelineOutcome; update: BranchUpdate }> {
  const { project, actor, branch } = input;
  await tx.lockProject(project.id);
  if (checked(input.source)) await assertMayUpdate(tx, project, input.access, branch, "push");
  const head = await branchHead(tx, project.id, branch);
  if (head !== input.expectedOld) throw staleBase(input.expectedOld, branch, head);
  assertText(input.files);
  const { entries, blobs } = entriesOfFiles(input.files);
  const message = normalizeMessage(input.message);
  const first = input.parents[0] ?? null;
  if (checked(input.source)) {
    await enforcePushRules(tx, {
      projectId: project.id, branch, isNewBranch: head === null, message,
      before: first === null ? null : await entriesOfCommit(tx, project.id, first), after: entries,
    });
  }
  const at = input.authoredAt ?? nowSeconds();
  const commit = await storeCommit(tx, {
    projectId: project.id, parents: input.parents, entries, blobs, author: actor.username, authoredAt: at,
    committer: actor.username, committedAt: at, message,
  });
  const landed = await advanceBranch(tx, { project, branch, oldHead: head, newHead: commit.id, actor, source: input.source, startedFrom: first });
  return { commit: commit.id, ...landed };
}

export async function createBranch(tx: Tx, project: ProjectRow, name: string, commit: string): Promise<void> {
  await tx.q("INSERT INTO refs (project_id, kind, name, commit_id, created_at) VALUES ($1, 'branch', $2, $3, $4)", [project.id, name, commit, now()]);
}

export async function deleteBranchRef(tx: Tx, project: ProjectRow, name: string): Promise<void> {
  await tx.q("DELETE FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2", [project.id, name]);
}

export async function tagExists(q: Queryable, projectId: number, name: string): Promise<boolean> {
  return (await q.maybe("SELECT 1 FROM refs WHERE project_id = $1 AND kind = 'tag' AND name = $2", [projectId, name])) !== undefined;
}

/** Creates an annotated tag (protected tags apply unless `access` is null). */
export async function createTag(tx: Tx, input: TagInput): Promise<void> {
  const { project, name } = input;
  await assertMayTag(tx, project, input.access, name);
  if (await tagExists(tx, project.id, name)) throw validationOne("name", `Tag ${name} already exists.`);
  await tx.q(
    "INSERT INTO refs (project_id, kind, name, commit_id, message, creator, created_at) VALUES ($1, 'tag', $2, $3, $4, $5, $6)",
    [project.id, name, input.commit, input.message, input.creator.username, now()],
  );
}
