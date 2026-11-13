// Applies a parsed spurpack to a freshly created project (DP-46): objects, refs, planning records and requests.
import { now } from "../clock.ts";
import type { Tx } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { writeCommit } from "../repo/index.ts";
import { seedMergeRequests } from "../mr/index.ts";
import type { PackModel } from "../lib/spurpack.ts";
import type { SeedKeys, SeedMergeRequest } from "./seed-spec.ts";

const ISSUE_POSITION_GAP = 1024;

async function userIds(tx: Tx, names: readonly string[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const row of await tx.q<{ id: number; username: string }>("SELECT id, username FROM users WHERE username = ANY($1)", [names])) {
    ids.set(row.username, row.id);
  }
  return ids;
}

function idOf(ids: ReadonlyMap<string, number>, username: string): number {
  const id = ids.get(username);
  if (id === undefined) throw new Error(`Unknown user ${username}`);
  return id;
}

async function applyObjects(tx: Tx, project: ProjectRow, model: PackModel): Promise<void> {
  for (const commit of model.commits) {
    await writeCommit(tx, {
      projectId: project.id,
      parents: commit.parents,
      files: new Map(commit.files),
      author: commit.author.username,
      authoredAt: commit.author.at,
      committer: commit.committer.username,
      committedAt: commit.committer.at,
      message: commit.message,
    });
  }
  for (const ref of model.refs) {
    await tx.q("INSERT INTO refs (project_id, kind, name, commit_id, message, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      project.id, ref.kind, ref.name, ref.commit, ref.kind === "tag" ? "" : null, now(),
    ]);
  }
}

async function applyPlanning(tx: Tx, project: ProjectRow, model: PackModel, ids: ReadonlyMap<string, number>): Promise<void> {
  const at = now();
  for (const label of model.labels) {
    await tx.q("INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4)", [project.id, label.name, label.description, at]);
  }
  const milestoneIds = new Map<string, number>();
  for (const milestone of model.milestones) {
    const created = await tx.one<{ id: number }>(
      "INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [project.id, milestone.title, milestone.start, milestone.due, milestone.zone, milestone.state, at],
    );
    milestoneIds.set(milestone.title, created.id);
  }
  let position = (await tx.one<{ top: number }>("SELECT COALESCE(MAX(position), 0) AS top FROM issues")).top;
  for (const issue of model.issues) {
    position += ISSUE_POSITION_GAP;
    const created = await tx.one<{ id: number }>(
      `INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, labels, milestone_id, weight, position,
                           created_at, updated_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13) RETURNING id`,
      [
        project.id, issue.iid, issue.title, issue.description, issue.state, idOf(ids, issue.author), issue.confidential, issue.labels,
        issue.milestone === null ? null : (milestoneIds.get(issue.milestone) ?? null), issue.weight, position, at,
        issue.state === "closed" ? at : null,
      ],
    );
    await tx.q("INSERT INTO issue_history (issue_id, at, weight, state) VALUES ($1, $2, $3, $4)", [created.id, at, issue.weight, issue.state]);
  }
  const nextIssue = model.issues.reduce((top, issue) => Math.max(top, issue.iid), 0) + 1;
  await tx.q("UPDATE projects SET next_issue_iid = GREATEST(next_issue_iid, $2) WHERE id = $1", [project.id, nextIssue]);
  for (const page of model.wikiPages) {
    await tx.q(
      "INSERT INTO wiki_versions (project_id, slug, version, title, content, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [project.id, page.slug, page.version, page.title, page.content, page.author, at],
    );
  }
}

// Requests go through the merge request module so they get their first version; the pack's iids are restored afterwards.
async function applyRequests(tx: Tx, project: ProjectRow, model: PackModel, ids: Map<string, number>): Promise<void> {
  const ordered = [...model.requests].sort((a, b) => a.iid - b.iid);
  if (ordered.length === 0) return;
  const specs: SeedMergeRequest[] = ordered.map((request) => ({
    key: String(request.iid),
    title: request.title,
    source: request.source,
    target: request.target,
    author: request.author,
    description: request.description,
    assignees: [],
    reviewers: [],
    delete_source_branch: false,
    state: request.state,
    approvals: [],
    threads: model.threads
      .filter((thread) => thread.request === request.iid)
      .map((thread, index) => ({
        key: `${request.iid}.${index}`,
        author: thread.author,
        body: thread.body,
        path: thread.path,
        old_line: null,
        new_line: thread.line,
        end_line: null,
        resolved: thread.resolved,
      })),
  }));
  const keys: SeedKeys = { userIds: ids, commitIds: new Map(), issueIds: new Map(), mergeRequestIds: new Map() };
  const seeded = await seedMergeRequests(tx, project, keys, specs);
  for (const request of [...ordered].reverse()) {
    const made = seeded.merge_requests[String(request.iid)];
    if (made !== undefined && made.iid !== request.iid) {
      await tx.q("UPDATE merge_requests SET iid = $2 WHERE id = $1", [made.id, request.iid]);
    }
  }
  const next = ordered.reduce((top, request) => Math.max(top, request.iid), 0) + 1;
  await tx.q("UPDATE projects SET next_mr_iid = GREATEST(next_mr_iid, $2) WHERE id = $1", [project.id, next]);
}

export async function applyPack(tx: Tx, project: ProjectRow, model: PackModel): Promise<void> {
  const ids = await userIds(tx, model.users);
  await applyObjects(tx, project, model);
  await applyPlanning(tx, project, model, ids);
  await applyRequests(tx, project, model, ids);
}
