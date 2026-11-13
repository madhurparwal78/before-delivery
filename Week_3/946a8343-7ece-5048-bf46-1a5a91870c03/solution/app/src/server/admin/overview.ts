// Read models for the project home: health figures, the latest tag and pipeline, release notes and recent activity.
import { iso } from "../clock.ts";
import { db, type Queryable } from "../db.ts";
import { projectScope, requireAction, type ProjectRow } from "../access.ts";
import { intParam, json, type Router } from "../http.ts";
import { openIssueCount, readableIssueIids } from "../planning/index.ts";

interface TagRow { readonly name: string; readonly commit_id: string; readonly message: string | null }
interface PipelineRow { readonly id: number; readonly status: string; readonly sha: string; readonly ref: string }

const FINISHED = ["success", "failed", "canceled", "warning", "skipped"];

async function tagsOf(q: Queryable, projectId: number): Promise<{ name: string; commit: string; message: string }[]> {
  const rows = await q.q<TagRow>(
    "SELECT name, commit_id, message FROM refs WHERE project_id = $1 AND kind = 'tag' ORDER BY created_at DESC, name DESC",
    [projectId],
  );
  return rows.map((row) => ({ name: row.name, commit: row.commit_id, message: row.message ?? "" }));
}

async function passedPercent(q: Queryable, project: ProjectRow): Promise<number | null> {
  const recent = await q.q<{ status: string }>(
    "SELECT status FROM ci_pipelines WHERE project_id = $1 AND ref = $2 AND status = ANY($3) ORDER BY id DESC LIMIT 20",
    [project.id, project.default_branch, FINISHED],
  );
  if (recent.length === 0) return null;
  return Math.round((recent.filter((row) => row.status === "success").length * 100) / recent.length);
}

interface ActivityRow { readonly kind: string; readonly title: string; readonly detail: string; readonly at: number; readonly href: string }

async function recentActivity(q: Queryable, userId: number, project: ProjectRow, limit: number): Promise<ActivityRow[]> {
  const base = `/projects/${project.id}/-`;
  const pushes = await q.q<{ id: string; message: string; author: string; at: number }>(
    "SELECT id, message, author, committed_at * 1000 AS at FROM commits WHERE project_id = $1 AND author <> 'spurline-train' ORDER BY committed_at DESC, id LIMIT $2",
    [project.id, limit],
  );
  const requests = await q.q<{ iid: number; title: string; state: string; author: string; at: number }>(
    `SELECT m.iid, m.title, m.state, u.username AS author, m.updated_at AS at FROM merge_requests m
       JOIN users u ON u.id = m.author_id WHERE m.project_id = $1 ORDER BY m.updated_at DESC, m.iid DESC LIMIT $2`,
    [project.id, limit],
  );
  const issueRows = await q.q<{ iid: number; title: string; state: string; author: string; at: number }>(
    `SELECT i.iid, i.title, i.state, u.username AS author, i.updated_at AS at FROM issues i
       JOIN users u ON u.id = i.author_id WHERE i.project_id = $1 ORDER BY i.updated_at DESC, i.iid DESC LIMIT $2`,
    [project.id, limit * 3],
  );
  const readable = new Set(await readableIssueIids(q, userId, project, issueRows.map((row) => row.iid)));
  const pipelines = await q.q<{ id: number; status: string; sha: string; at: number }>(
    "SELECT id, status, sha, COALESCE(finished_at, created_at) AS at FROM ci_pipelines WHERE project_id = $1 AND status = ANY($2) ORDER BY id DESC LIMIT $3",
    [project.id, FINISHED, limit],
  );
  const events: ActivityRow[] = [
    ...pushes.map((row) => ({ kind: "push", title: row.message.split("\n")[0] ?? row.message, detail: `${row.author} committed ${row.id.slice(0, 7)}`, at: row.at, href: `${base}/commit/${row.id}` })),
    ...requests.map((row) => ({ kind: "merge_request", title: `!${row.iid} ${row.title}`, detail: `${row.author}, ${row.state}`, at: row.at, href: `${base}/merge_requests/${row.iid}` })),
    ...issueRows.filter((row) => readable.has(row.iid)).slice(0, limit).map((row) => ({ kind: "issue", title: `#${row.iid} ${row.title}`, detail: `${row.author}, ${row.state}`, at: row.at, href: `${base}/issues/${row.iid}` })),
    ...pipelines.map((row) => ({ kind: "pipeline", title: `Pipeline ${row.id}`, detail: `${row.status} on ${row.sha.slice(0, 7)}`, at: row.at, href: `${base}/pipelines/${row.id}` })),
  ];
  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function registerOverviewRoutes(router: Router): void {
  router.get("/api/projects/:id/overview", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "code.read");
    const tags = await tagsOf(db, project.id);
    const open = await db.one<{ count: number }>(
      "SELECT count(*) AS count FROM merge_requests WHERE project_id = $1 AND state = 'opened'",
      [project.id],
    );
    const latest = await db.maybe<PipelineRow>(
      "SELECT id, status, sha, ref FROM ci_pipelines WHERE project_id = $1 AND ref = $2 ORDER BY id DESC LIMIT 1",
      [project.id, project.default_branch],
    );
    return json(200, {
      open_merge_requests: open.count,
      pipelines_passed: await passedPercent(db, project),
      open_issues: await openIssueCount(db, ctx.user.id, project),
      latest_tag: tags[0] ?? null,
      latest_pipeline: latest ?? null,
      tags,
    });
  });

  router.get("/api/projects/:id/activity", async (ctx) => {
    const { project, access } = await projectScope(db, ctx.user, intParam(ctx, "id"));
    requireAction(access, "code.read");
    const requested = Number(ctx.query.get("limit") ?? "3");
    const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 20) : 3;
    const events = await recentActivity(db, ctx.user.id, project, limit);
    return json(200, { events: events.map((event) => ({ ...event, at: iso(event.at) })) });
  });
}
