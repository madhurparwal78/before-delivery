// Repository API routes.
import { LIMITS } from "../config.ts";
import { db, withTx, type Queryable } from "../db.ts";
import { iso } from "../clock.ts";
import { projectScope, requireAction, type ProjectRow } from "../access.ts";
import { FieldErrors, notFound } from "../errors.ts";
import { intParam, json, noContent, type Ctx, type Reply, type Router } from "../http.ts";
import { compareUtf8 } from "../lib/objects.ts";
import { assertMayTag, assertMayDelete, assertMayUpdate, protectedAmong } from "./protection.ts";
import { commitToBranch, createBranch, createTag, deleteBranchRef, tagExists } from "./commits.ts";
import { onBranchDeleted } from "../mr/index.ts";
import { diffCommits } from "./diffs.ts";
import { blameFile, branchHead, commitsBetween, firstParentHistory, mergeBase, resolveRef } from "./history.ts";
import { entryAt, readTexts, requireCommit, treeEntries } from "./store.ts";
import { splitPath } from "./trees.ts";
import type { CommitRow, FileAction } from "./types.ts";
import { isRecord } from "../json.ts";

function isActionKind(value: unknown): value is FileAction["action"] {
  return value === "create" || value === "update" || value === "delete" || value === "move";
}

interface CommitRequest {
  readonly branch: string;
  readonly startRef: string | null;
  readonly baseCommit: string | null;
  readonly message: string;
  readonly actions: FileAction[];
  readonly invalid: Record<string, string>;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Reads a commit request body; whatever is malformed is reported later with the other 422 errors. */
export function readCommitRequest(body: unknown): CommitRequest {
  const fields = record(body);
  const invalid: Record<string, string> = {};
  const branch = typeof fields["branch"] === "string" ? fields["branch"] : "";
  if (branch.trim() === "") invalid["branch"] = "Branch can't be blank.";
  const start = fields["start_ref"];
  if (start !== undefined && start !== null && typeof start !== "string") invalid["start_ref"] = "Start ref must be text.";
  const base = fields["base_commit"];
  if (base !== undefined && base !== null && typeof base !== "string") invalid["base_commit"] = "Base commit must be a commit id or null.";
  const message = typeof fields["message"] === "string" ? fields["message"] : "";
  const actions: FileAction[] = [];
  const listed = fields["actions"];
  if (!Array.isArray(listed)) {
    invalid["actions"] = "Actions must be a list.";
  } else {
    listed.forEach((item: unknown, index) => {
      const action = record(item);
      const kind = action["action"];
      const path = action["path"];
      const content = action["content"];
      const previous = action["previous_path"];
      if (!isActionKind(kind) || typeof path !== "string") {
        invalid[`actions.${index}`] = `Action ${index + 1} isn't valid.`;
        return;
      }
      actions.push({
        action: kind,
        path,
        ...(typeof content === "string" ? { content } : {}),
        ...(typeof previous === "string" ? { previous_path: previous } : {}),
      });
    });
  }
  return {
    branch: branch.trim() === "" ? "" : branch,
    startRef: typeof start === "string" && start !== "" ? start : null,
    baseCommit: typeof base === "string" ? base : null,
    message,
    actions,
    invalid,
  };
}

function commitJson(commit: CommitRow): Record<string, unknown> {
  return {
    id: commit.id,
    parents: commit.parents,
    author: commit.author,
    authored_at: iso(commit.authored_at * 1000),
    committer: commit.committer,
    committed_at: iso(commit.committed_at * 1000),
    message: commit.message,
  };
}

// A name for a branch or tag: no blanks or control characters, no leading, trailing or doubled slash, no `..`.
function nameProblem(label: string, name: string): string | null {
  if (name.trim() === "") return `${label} name can't be blank.`;
  if (name.length > 255 || /[\s~^:?*[\\\u0000-\u001f\u007f]/u.test(name) || name.startsWith("/") || name.endsWith("/") || name.includes("//") || name.includes("..")) {
    return `${label} name isn't valid.`;
  }
  return null;
}

async function readable(ctx: Ctx, q: Queryable): Promise<ProjectRow> {
  const { project, access } = await projectScope(q, ctx.user, intParam(ctx, "id"));
  requireAction(access, "code.read");
  return project;
}

async function commitOf(q: Queryable, project: ProjectRow, ref: string | null): Promise<CommitRow> {
  const id = await resolveRef(q, project.id, ref === null || ref === "" ? project.default_branch : ref);
  if (id === null) throw notFound();
  return requireCommit(q, project.id, id);
}

async function listRefs(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const rows = await db.q<{ kind: "branch" | "tag"; name: string; commit_id: string; message: string | null }>(
    "SELECT kind, name, commit_id, message FROM refs WHERE project_id = $1", [project.id],
  );
  const byName = (a: { name: string }, b: { name: string }): number => compareUtf8(a.name, b.name);
  const branches = rows.filter((row) => row.kind === "branch").sort(byName);
  const guarded = await protectedAmong(db, project.id, branches.map((row) => row.name));
  return json(200, {
    branches: branches.map((row) => ({ name: row.name, commit: row.commit_id, protected: guarded.has(row.name) })),
    tags: rows.filter((row) => row.kind === "tag").sort(byName).map((row) => ({ name: row.name, commit: row.commit_id, message: row.message ?? "" })),
  });
}

async function addBranch(ctx: Ctx): Promise<Reply> {
  const pid = intParam(ctx, "id");
  return withTx(async (tx) => {
    const { project, access } = await projectScope(tx, ctx.user, pid);
    requireAction(access, "commit");
    await tx.lockProject(project.id);
    const body = record(ctx.body);
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const ref = typeof body["ref"] === "string" ? body["ref"] : "";
    await assertMayUpdate(tx, project, access, name, "push");
    const fields = new FieldErrors();
    const problem = nameProblem("Branch", name);
    if (problem !== null) fields.add("name", problem);
    else if ((await branchHead(tx, project.id, name)) !== null) fields.add("name", `Branch ${name} already exists.`);
    const commit = ref === "" ? null : await resolveRef(tx, project.id, ref);
    if (commit === null) fields.add("ref", ref === "" ? "Ref can't be blank." : `Ref ${ref} does not exist.`);
    fields.throwIfAny();
    if (commit === null) throw notFound();
    await createBranch(tx, project, name, commit);
    return json(201, { name, commit, seq: await tx.currentSeq(project.id) });
  });
}

async function removeBranch(ctx: Ctx): Promise<Reply> {
  const pid = intParam(ctx, "id");
  const name = ctx.params["name"] ?? "";
  return withTx(async (tx) => {
    const { project, access } = await projectScope(tx, ctx.user, pid);
    await tx.lockProject(project.id);
    if ((await branchHead(tx, project.id, name)) === null) throw notFound();
    requireAction(access, "commit");
    await assertMayDelete(tx, project.id, name);
    await deleteBranchRef(tx, project, name);
    await onBranchDeleted(tx, project, name);
    return noContent();
  });
}

async function addTag(ctx: Ctx): Promise<Reply> {
  const pid = intParam(ctx, "id");
  return withTx(async (tx) => {
    const { project, access } = await projectScope(tx, ctx.user, pid);
    requireAction(access, "commit");
    await tx.lockProject(project.id);
    const body = record(ctx.body);
    const name = typeof body["name"] === "string" ? body["name"] : "";
    const ref = typeof body["ref"] === "string" ? body["ref"] : "";
    const message = typeof body["message"] === "string" ? body["message"] : "";
    await assertMayTag(tx, project, access, name);
    const fields = new FieldErrors();
    const problem = nameProblem("Tag", name);
    if (problem !== null) fields.add("name", problem);
    else if (await tagExists(tx, project.id, name)) fields.add("name", `Tag ${name} already exists.`);
    const commit = ref === "" ? null : await resolveRef(tx, project.id, ref);
    if (commit === null) fields.add("ref", ref === "" ? "Ref can't be blank." : `Ref ${ref} does not exist.`);
    fields.throwIfAny();
    if (commit === null) throw notFound();
    await createTag(tx, { project, access, name, commit, message, creator: { id: ctx.user.id, username: ctx.user.username } });
    return json(201, { name, commit, message, seq: await tx.currentSeq(project.id) });
  });
}

async function showTree(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const commit = await commitOf(db, project, ctx.query.get("ref"));
  const path = ctx.query.get("path") ?? "";
  let id = commit.tree;
  if (splitPath(path).length > 0) {
    const entry = await entryAt(db, project.id, commit.tree, path);
    if (entry === undefined || entry.mode !== "040000") throw notFound();
    id = entry.id;
  }
  const entries = await treeEntries(db, project.id, id);
  return json(200, { id, entries: entries.map((entry) => ({ name: entry.name, mode: entry.mode, id: entry.id, type: entry.mode === "040000" ? "tree" : "blob" })) });
}

async function showFile(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const commit = await commitOf(db, project, ctx.query.get("ref"));
  const path = splitPath(ctx.query.get("path") ?? "").join("/");
  const entry = path === "" ? undefined : await entryAt(db, project.id, commit.tree, path);
  if (entry === undefined || entry.mode !== "100644") throw notFound();
  const bytes = (await readTexts(db, project.id, [entry.id])).get(entry.id) ?? "";
  return json(200, { path, blob: entry.id, size: Buffer.byteLength(bytes, "utf8"), content: bytes });
}

async function listCommits(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const head = await commitOf(db, project, ctx.query.get("ref"));
  const path = splitPath(ctx.query.get("path") ?? "").join("/");
  const commits = await firstParentHistory(db, project.id, head.id, path === "" ? undefined : path);
  return json(200, { commits: commits.map(commitJson) });
}

async function showCommit(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const id = await resolveRef(db, project.id, ctx.params["commit"] ?? "");
  if (id === null) throw notFound();
  const commit = await requireCommit(db, project.id, id);
  const diffs = await diffCommits(db, project.id, commit.parents[0] ?? null, commit.id);
  return json(200, { ...commitJson(commit), tree: commit.tree, diffs });
}

async function showBlame(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const head = await commitOf(db, project, ctx.query.get("ref"));
  const path = splitPath(ctx.query.get("path") ?? "").join("/");
  const lines = path === "" ? null : await blameFile(db, project.id, head.id, path);
  if (lines === null) throw notFound();
  return json(200, { lines });
}

async function compare(ctx: Ctx): Promise<Reply> {
  const project = await readable(ctx, db);
  const fromRef = ctx.query.get("from");
  const toRef = ctx.query.get("to");
  if (fromRef === null || fromRef === "" || toRef === null || toRef === "") throw notFound();
  const from = await commitOf(db, project, fromRef);
  const to = await commitOf(db, project, toRef);
  const [base, commits, diffs] = await Promise.all([
    mergeBase(db, project.id, from.id, to.id),
    commitsBetween(db, project.id, from.id, to.id),
    diffCommits(db, project.id, from.id, to.id),
  ]);
  return json(200, { merge_base: base, commits: commits.map(commitJson), diffs });
}

async function postCommit(ctx: Ctx): Promise<Reply> {
  const pid = intParam(ctx, "id");
  const request = readCommitRequest(ctx.body);
  return withTx(async (tx) => {
    const { project, access } = await projectScope(tx, ctx.user, pid);
    const result = await commitToBranch(tx, {
      project, access, actor: { id: ctx.user.id, username: ctx.user.username }, branch: request.branch, startRef: request.startRef,
      baseCommit: request.baseCommit, message: request.message, actions: request.actions, source: "api", invalid: request.invalid,
    });
    return json(201, { commit: result.commit, seq: await tx.currentSeq(project.id), pipeline: result.pipeline });
  });
}

export function registerRepoRoutes(router: Router): void {
  router.get("/api/projects/:id/refs", listRefs);
  router.post("/api/projects/:id/branches", addBranch);
  router.delete("/api/projects/:id/branches/*name", removeBranch);
  router.post("/api/projects/:id/tags", addTag);
  router.get("/api/projects/:id/tree", showTree);
  router.get("/api/projects/:id/files", showFile);
  router.get("/api/projects/:id/commits", listCommits);
  router.get("/api/projects/:id/commits/:commit", showCommit);
  router.get("/api/projects/:id/blame", showBlame);
  router.get("/api/projects/:id/compare", compare);
  router.post("/api/projects/:id/commits", postCommit, { idempotent: true, bodyLimit: LIMITS.commitBodyBytes });
}
