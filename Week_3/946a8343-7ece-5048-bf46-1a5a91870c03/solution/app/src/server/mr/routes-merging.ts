// Merging, auto-merge, rebase, the conflict page and the version diff.
import { intParam, json, type Router } from "../http.ts";
import { db, withTx, type Tx } from "../db.ts";
import { FieldErrors, fieldError, notFound, staleHead, wrongState } from "../errors.ts";
import { iso } from "../clock.ts";
import type { Access, ProjectRow, UserRow } from "../access.ts";
import * as repo from "../repo/index.ts";
import { hasConflictMarkers, mergeTrees, resolveSegments } from "../../shared/merge.ts";
import { assertNotBlocked, targetGoneText } from "./checks.ts";
import { markedHunks } from "./conflicts.ts";
import { cancelAutoMerge, landRequest, refreshRequest } from "./engine.ts";
import { evaluateRequest } from "./evaluate.ts";
import { emitRequest } from "./notify.ts";
import { bodyRecord, optionalString } from "./input.ts";
import { ALREADY_MERGED, insertSystemNote, latestVersion, lockedRequest, openRequest, requireRequest, versionsOf, type MrRow } from "./store.ts";

const NO_MARKERS = "Remove all conflict markers before committing.";

function person(user: UserRow): { id: number; username: string } {
  return { id: user.id, username: user.username };
}

async function mergeNow(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow, access: Access, sha: string | undefined): Promise<string> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  const evaluation = await evaluateRequest(tx, project, mr);
  if (sha === undefined || sha !== evaluation.sourceHead) throw staleHead();
  assertNotBlocked(evaluation.checks);
  return landRequest(tx, project, mr, person(user), access, sha);
}

async function setAutoMerge(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow, sha: string | undefined): Promise<void> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  const evaluation = await evaluateRequest(tx, project, mr);
  if (sha === undefined || sha !== evaluation.sourceHead) throw staleHead();
  if (mr.auto_merge_by === null) {
    const text = "Set to auto-merge.";
    await tx.q("UPDATE merge_requests SET auto_merge_by = $2 WHERE id = $1", [mr.id, user.id]);
    await insertSystemNote(tx, mr.id, user.username, text);
    await emitRequest(tx, project, mr.iid, "updated", [text]);
  }
  await refreshRequest(tx, project, mr.id, { autoMerge: true, rulesMessage: true });
}

async function rebase(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow, access: Access): Promise<string> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  const targetHead = await repo.branchHead(tx, project.id, mr.target);
  const sourceHead = await repo.branchHead(tx, project.id, mr.source);
  if (targetHead === null) throw wrongState(targetGoneText(mr.target));
  if (sourceHead === null) throw notFound();
  if (await repo.isAncestor(tx, project.id, targetHead, sourceHead)) return sourceHead;
  const rebased = await repo.rebaseBranch(tx, { project, access, actor: person(user), sourceBranch: mr.source, targetBranch: mr.target });
  const text = `Rebased onto ${mr.target} at ${targetHead.slice(0, 7)}.`;
  await insertSystemNote(tx, mr.id, user.username, text);
  await emitRequest(tx, project, mr.iid, "updated", [text]);
  return rebased.head;
}

interface Resolution {
  readonly hunks: ("ours" | "theirs")[] | null;
  readonly content: string | null;
}

function isChoices(value: unknown): value is ("ours" | "theirs")[] {
  return Array.isArray(value) && value.every((choice) => choice === "ours" || choice === "theirs");
}

function readResolutions(value: unknown): Map<string, Resolution> {
  const resolutions = new Map<string, Resolution>();
  const files = bodyRecord(value)["files"];
  if (!Array.isArray(files)) return resolutions;
  for (const item of files) {
    const record = bodyRecord(item);
    const path = optionalString(record, "path");
    if (path === undefined) continue;
    const hunks = record["hunks"];
    resolutions.set(path, { hunks: isChoices(hunks) ? hunks : null, content: optionalString(record, "content") ?? null });
  }
  return resolutions;
}

async function resolveConflicts(tx: Tx, project: ProjectRow, mr: MrRow, user: UserRow, access: Access, rawBody: unknown): Promise<string> {
  if (mr.state === "merged") throw wrongState(ALREADY_MERGED);
  const targetHead = await repo.branchHead(tx, project.id, mr.target);
  const sourceHead = await repo.branchHead(tx, project.id, mr.source);
  if (targetHead === null || sourceHead === null) throw wrongState("This merge request has no conflicts.");
  const base = await repo.mergeBase(tx, project.id, targetHead, sourceHead);
  const merged = mergeTrees(
    base === null ? new Map<string, string>() : await repo.snapshot(tx, project.id, base),
    await repo.snapshot(tx, project.id, targetHead),
    await repo.snapshot(tx, project.id, sourceHead),
    { ours: mr.target, theirs: mr.source },
  );
  if (merged.conflicts.length === 0) throw wrongState("This merge request has no conflicts.");

  const resolutions = readResolutions(rawBody);
  for (const resolution of resolutions.values()) {
    if (resolution.content !== null && hasConflictMarkers(resolution.content)) {
      throw fieldError("conflict_markers", "files", NO_MARKERS);
    }
  }
  const errors = new FieldErrors();
  const files = new Map(merged.files);
  for (const found of merged.conflicts) {
    const resolution = resolutions.get(found.path);
    if (resolution === undefined || (resolution.content === null && resolution.hunks === null)) {
      errors.add("files", "Every conflicting file needs a resolution.");
      continue;
    }
    if (resolution.content !== null) {
      files.set(found.path, resolution.content);
      continue;
    }
    const choices = resolution.hunks ?? [];
    if (found.kind === "content" && found.segments !== undefined) {
      const hunks = found.segments.filter((segment) => segment.kind === "conflict").length;
      if (choices.length !== hunks) errors.add("files", "Choose ours or theirs for every hunk.");
      else files.set(found.path, resolveSegments(found.segments, choices));
    } else {
      const chosen = choices[0] === "ours" ? found.oursText : found.theirsText;
      if (choices.length !== 1) errors.add("files", "Choose ours or theirs for every hunk.");
      else if (chosen !== null) files.set(found.path, chosen);
    }
  }
  errors.throwIfAny();
  const result = await repo.commitWithParents(tx, {
    project,
    access,
    actor: person(user),
    branch: mr.source,
    expectedOld: sourceHead,
    parents: [sourceHead, targetHead],
    files,
    message: `Resolve conflicts with ${mr.target}`,
    source: "conflict",
  });
  return result.commit;
}

function versionNumber(value: string | null): number | null {
  return value !== null && /^\d{1,9}$/u.test(value) ? Number(value) : null;
}

export function registerMergingRoutes(router: Router): void {
  router.post("/api/projects/:id/merge_requests/:iid/merge", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, access, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      const mergeCommit = await mergeNow(tx, project, mr, ctx.user, access, optionalString(bodyRecord(ctx.body), "sha"));
      return json(200, { state: "merged", merge_commit: mergeCommit, seq: await tx.currentSeq(project.id) });
    });
  }, { idempotent: true });

  router.post("/api/projects/:id/merge_requests/:iid/auto_merge", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      await setAutoMerge(tx, project, mr, ctx.user, optionalString(bodyRecord(ctx.body), "sha"));
      const fresh = await requireRequest(tx, project.id, iid);
      return json(200, { auto_merge: fresh.auto_merge_by !== null, state: fresh.state, seq: await tx.currentSeq(project.id) });
    });
  });

  router.delete("/api/projects/:id/merge_requests/:iid/auto_merge", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      const text = await cancelAutoMerge(tx, mr, `canceled by ${ctx.user.username}`, ctx.user.username);
      if (text !== null) {
        await emitRequest(tx, project, mr.iid, "updated", [text]);
        await refreshRequest(tx, project, mr.id, { autoMerge: false, rulesMessage: true });
      }
      return json(200, { auto_merge: false, state: mr.state, seq: await tx.currentSeq(project.id) });
    });
  });

  router.post("/api/projects/:id/merge_requests/:iid/rebase", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, access, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      const head = await rebase(tx, project, mr, ctx.user, access);
      return json(200, { source_head: head, seq: await tx.currentSeq(project.id) });
    });
  });

  router.get("/api/projects/:id/merge_requests/:iid/conflicts", async (ctx) => {
    const { project, mr } = await openRequest(db, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
    const targetHead = await repo.branchHead(db, project.id, mr.target);
    const sourceHead = mr.state === "merged" ? null : await repo.branchHead(db, project.id, mr.source);
    if (targetHead === null || sourceHead === null) return json(200, { files: [] });
    const found = await repo.conflictsFor(db, project.id, targetHead, sourceHead, { ours: mr.target, theirs: mr.source });
    return json(200, { files: found.map((file) => ({ path: file.path, kind: file.kind, hunks: markedHunks(file.markedText), marked: file.markedText })) });
  });

  router.post("/api/projects/:id/merge_requests/:iid/conflicts", async (ctx) => {
    const projectId = intParam(ctx, "id");
    const iid = intParam(ctx, "iid");
    return withTx(async (tx) => {
      const { project, access, mr } = await lockedRequest(tx, ctx.user, projectId, iid, "mr.write");
      const commit = await resolveConflicts(tx, project, mr, ctx.user, access, ctx.body);
      return json(201, { commit, seq: await tx.currentSeq(project.id) });
    });
  });

  router.get("/api/projects/:id/merge_requests/:iid/diff", async (ctx) => {
    const { project, mr } = await openRequest(db, ctx.user, intParam(ctx, "id"), intParam(ctx, "iid"), "mr.read");
    const versions = await versionsOf(db, mr.id);
    const last = await latestVersion(db, mr.id);
    const toNumber = ctx.query.has("to") ? versionNumber(ctx.query.get("to")) : (last?.number ?? null);
    const to = versions.find((version) => version.number === toNumber);
    if (to === undefined) throw notFound();
    const from = ctx.query.get("from") ?? "target";
    let fromCommit: string | null;
    if (from === "target") {
      fromCommit = to.base;
    } else {
      const chosen = versions.find((version) => version.number === versionNumber(from));
      if (chosen === undefined) throw notFound();
      fromCommit = chosen.head;
    }
    const commits = await repo.commitsBetween(db, project.id, fromCommit, to.head);
    return json(200, {
      merge_base: fromCommit === null ? null : await repo.mergeBase(db, project.id, fromCommit, to.head),
      commits: commits.map((commit) => ({
        id: commit.id,
        parents: commit.parents,
        author: commit.author,
        authored_at: iso(commit.authored_at * 1000),
        committer: commit.committer,
        committed_at: iso(commit.committed_at * 1000),
        message: commit.message,
      })),
      diffs: await repo.diffCommits(db, project.id, fromCommit, to.head),
    });
  });
}
