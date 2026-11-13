// Builds the spurpack model of a project from the database (DP-46). The pack writer owns the byte layout.
import type { Queryable } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { snapshot } from "../repo/index.ts";
import {
  CONFIG_KEYS,
  packUsers,
  type PackCommit,
  type PackConfigEntry,
  type PackIssue,
  type PackLabel,
  type PackMilestone,
  type PackModel,
  type PackRef,
  type PackRequest,
  type PackThread,
  type PackWikiPage,
} from "../lib/spurpack.ts";
import { isFlagSetting } from "../../shared/settings.ts";

interface CommitRecord {
  readonly id: string;
  readonly parents: string[];
  readonly author: string;
  readonly authored_at: number;
  readonly committer: string;
  readonly committed_at: number;
  readonly message: string;
}

// Commits reachable from any branch or tag, with their full file snapshots.
async function packCommits(q: Queryable, projectId: number, refs: readonly PackRef[]): Promise<PackCommit[]> {
  const all = new Map<string, CommitRecord>();
  for (const row of await q.q<CommitRecord>(
    "SELECT id, parents, author, authored_at, committer, committed_at, message FROM commits WHERE project_id = $1",
    [projectId],
  )) {
    all.set(row.id, row);
  }
  const reachable = new Set<string>();
  const pending = refs.map((ref) => ref.commit);
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || reachable.has(id)) continue;
    const commit = all.get(id);
    if (commit === undefined) continue;
    reachable.add(id);
    pending.push(...commit.parents);
  }
  const commits: PackCommit[] = [];
  for (const id of reachable) {
    const commit = all.get(id);
    if (commit === undefined) continue;
    commits.push({
      id,
      parents: commit.parents,
      author: { username: commit.author, at: commit.authored_at },
      committer: { username: commit.committer, at: commit.committed_at },
      message: commit.message,
      files: await snapshot(q, projectId, id),
    });
  }
  return commits;
}

async function packLabels(q: Queryable, project: ProjectRow, issues: readonly PackIssue[]): Promise<PackLabel[]> {
  const own = await q.q<PackLabel>("SELECT name, description FROM labels WHERE project_id = $1", [project.id]);
  const named = new Map<string, PackLabel>(own.map((label) => [label.name, label]));
  const carried = new Set(issues.flatMap((issue) => issue.labels));
  const groupPath = project.path.slice(0, project.path.lastIndexOf("/"));
  const inherited = await q.q<PackLabel>(
    `SELECT l.name, l.description FROM labels l JOIN groups g ON g.id = l.group_id
      WHERE $1 = g.path OR $1 LIKE g.path || '/%' ORDER BY length(g.path) DESC`,
    [groupPath],
  );
  for (const label of inherited) if (carried.has(label.name) && !named.has(label.name)) named.set(label.name, label);
  return [...named.values()];
}

async function packIssues(q: Queryable, projectId: number): Promise<PackIssue[]> {
  const rows = await q.q<Omit<PackIssue, "milestone"> & { milestone: string | null }>(
    `SELECT i.iid, i.title, i.state, u.username AS author, i.labels, m.title AS milestone, i.weight, i.confidential, i.description
       FROM issues i JOIN users u ON u.id = i.author_id LEFT JOIN milestones m ON m.id = i.milestone_id
      WHERE i.project_id = $1 ORDER BY i.iid`,
    [projectId],
  );
  return rows;
}

async function packRequests(q: Queryable, projectId: number): Promise<PackRequest[]> {
  return q.q<PackRequest>(
    `SELECT r.iid, r.title, r.state, u.username AS author, r.source, r.target, r.description
       FROM merge_requests r JOIN users u ON u.id = r.author_id WHERE r.project_id = $1 ORDER BY r.iid`,
    [projectId],
  );
}

async function packThreads(q: Queryable, projectId: number): Promise<PackThread[]> {
  const rows = await q.q<{ request: number; path: string | null; new_line: number | null; old_line: number | null; resolved: boolean; author: string; body: string }>(
    `SELECT r.iid AS request, t.path, t.new_line, t.old_line, t.resolved, n.author, n.body
       FROM mr_threads t JOIN merge_requests r ON r.id = t.mr_id
       JOIN LATERAL (SELECT author, body FROM mr_notes WHERE thread_id = t.id AND NOT system AND NOT pending ORDER BY id LIMIT 1) n ON true
      WHERE r.project_id = $1 AND NOT t.pending ORDER BY r.iid, t.id`,
    [projectId],
  );
  return rows.map((row) => ({
    request: row.request,
    path: row.path,
    line: row.path === null ? null : (row.new_line ?? row.old_line),
    resolved: row.resolved,
    author: row.author,
    body: row.body,
  }));
}

function packConfig(project: ProjectRow): PackConfigEntry[] {
  return CONFIG_KEYS.map((key) => ({ key, value: isFlagSetting(key) ? String(project[key]) : project[key] }));
}

export async function buildPack(q: Queryable, project: ProjectRow): Promise<PackModel> {
  const refs = await q.q<{ kind: "branch" | "tag"; name: string; commit: string }>(
    "SELECT kind, name, commit_id AS commit FROM refs WHERE project_id = $1",
    [project.id],
  );
  const issues = await packIssues(q, project.id);
  const parts: Omit<PackModel, "users"> = {
    commits: await packCommits(q, project.id, refs),
    refs,
    labels: await packLabels(q, project, issues),
    milestones: await q.q<PackMilestone>(
      "SELECT title, start_date AS start, due_date AS due, time_zone AS zone, state FROM milestones WHERE project_id = $1",
      [project.id],
    ),
    issues,
    requests: await packRequests(q, project.id),
    threads: await packThreads(q, project.id),
    wikiPages: await q.q<PackWikiPage>("SELECT slug, version, author, title, content FROM wiki_versions WHERE project_id = $1", [project.id]),
    config: packConfig(project),
  };
  return { users: packUsers(parts), ...parts };
}
