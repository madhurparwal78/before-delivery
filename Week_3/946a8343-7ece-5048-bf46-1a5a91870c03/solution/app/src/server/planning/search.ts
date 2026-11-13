// Search over code, issues, requests and wiki pages. Access is decided per project before anything is listed or counted.
import type { Queryable } from "../db.ts";
import { db } from "../db.ts";
import { can, projectAccess, type Access, type ProjectRow, type UserRow } from "../access.ts";
import { validationOne } from "../errors.ts";
import { json, type Router } from "../http.ts";
import { branchHead, snapshot } from "../repo/index.ts";
import { compareHits, matchingLines, type CodeHit } from "./search-match.ts";
import { mayRead, viewerOf } from "./visibility.ts";

const SCOPES = ["code", "issues", "requests", "wiki"] as const;
type Scope = (typeof SCOPES)[number];

const RESULT_LIMIT = 500;

/** What the viewer may do in each project, asked once per project. */
class Rights {
  private readonly q: Queryable;
  private readonly user: UserRow;
  private readonly known = new Map<number, Access | undefined>();

  constructor(q: Queryable, user: UserRow) {
    this.q = q;
    this.user = user;
  }

  async of(project: ProjectRow): Promise<Access | undefined> {
    if (!this.known.has(project.id)) {
      const access = await projectAccess(this.q, this.user.id, project);
      this.known.set(project.id, access.canRead ? access : undefined);
    }
    return this.known.get(project.id);
  }
}

async function projectsById(ids: readonly number[]): Promise<Map<number, ProjectRow>> {
  const rows = await db.q<ProjectRow>("SELECT * FROM projects WHERE id = ANY($1)", [ids]);
  return new Map(rows.map((row) => [row.id, row]));
}

const MATCH = (column: string): string => `position(lower($1) in lower(${column})) > 0`;

async function searchIssues(user: UserRow, q: string): Promise<Record<string, unknown>[]> {
  const rows = await db.q<{ id: number; iid: number; title: string; state: string; confidential: boolean; author_id: number; project_id: number }>(
    `SELECT i.id, i.iid, i.title, i.state, i.confidential, i.author_id, i.project_id FROM issues i JOIN projects p ON p.id = i.project_id
      WHERE ${MATCH("i.title")} OR ${MATCH("i.description")} ORDER BY p.path, i.iid`,
    [q],
  );
  const projects = await projectsById([...new Set(rows.map((row) => row.project_id))]);
  const rights = new Rights(db, user);
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const project = projects.get(row.project_id);
    const access = project === undefined ? undefined : await rights.of(project);
    if (project === undefined || access === undefined || !can(access, "issue.read")) continue;
    if (!(await mayRead(db, viewerOf(user.id, access), row))) continue;
    results.push({ project: project.path, project_id: project.id, iid: row.iid, title: row.title, state: row.state, confidential: row.confidential });
  }
  return results;
}

async function searchRequests(user: UserRow, q: string): Promise<Record<string, unknown>[]> {
  const rows = await db.q<{ project_id: number; iid: number; title: string; state: string }>(
    `SELECT m.project_id, m.iid, m.title, m.state FROM merge_requests m JOIN projects p ON p.id = m.project_id
      WHERE ${MATCH("m.title")} OR ${MATCH("m.description")} ORDER BY p.path, m.iid`,
    [q],
  );
  const projects = await projectsById([...new Set(rows.map((row) => row.project_id))]);
  const rights = new Rights(db, user);
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const project = projects.get(row.project_id);
    const access = project === undefined ? undefined : await rights.of(project);
    if (project === undefined || access === undefined || !can(access, "mr.read")) continue;
    results.push({ project: project.path, project_id: project.id, iid: row.iid, title: row.title, state: row.state });
  }
  return results;
}

async function searchWiki(user: UserRow, q: string): Promise<Record<string, unknown>[]> {
  const rows = await db.q<{ project_id: number; slug: string; title: string; content: string }>(
    `SELECT w.project_id, w.slug, w.title, w.content FROM (
        SELECT DISTINCT ON (project_id, slug) project_id, slug, title, content FROM wiki_versions ORDER BY project_id, slug, version DESC
      ) w JOIN projects p ON p.id = w.project_id WHERE ${MATCH("w.title")} OR ${MATCH("w.content")} ORDER BY p.path, w.slug`,
    [q],
  );
  const projects = await projectsById([...new Set(rows.map((row) => row.project_id))]);
  const rights = new Rights(db, user);
  const results: Record<string, unknown>[] = [];
  for (const row of rows) {
    const project = projects.get(row.project_id);
    const access = project === undefined ? undefined : await rights.of(project);
    if (project === undefined || access === undefined || !can(access, "wiki.read")) continue;
    const line = matchingLines(row.content, q)[0];
    results.push({ project: project.path, project_id: project.id, slug: row.slug, title: row.title, text: line?.text ?? row.title });
  }
  return results;
}

async function searchCode(user: UserRow, q: string): Promise<Record<string, unknown>[]> {
  const projects = await db.q<ProjectRow>("SELECT * FROM projects ORDER BY path");
  const rights = new Rights(db, user);
  const hits: { hit: CodeHit; result: Record<string, unknown> }[] = [];
  for (const project of projects) {
    const access = await rights.of(project);
    if (access === undefined || !can(access, "code.read")) continue;
    const head = await branchHead(db, project.id, project.default_branch);
    if (head === null) continue;
    for (const [path, content] of await snapshot(db, project.id, head)) {
      for (const match of matchingLines(content, q)) {
        hits.push({
          hit: { project: project.path, path, line: match.line },
          result: { project: project.path, project_id: project.id, path, line: match.line, text: match.text },
        });
      }
    }
  }
  return hits.sort((a, b) => compareHits(a.hit, b.hit)).map((entry) => entry.result);
}

export function registerSearchRoutes(router: Router): void {
  router.get("/api/search", async (ctx) => {
    const scope = SCOPES.find((candidate) => candidate === ctx.query.get("scope"));
    if (scope === undefined) throw validationOne("scope", "Scope must be code, issues, requests or wiki.");
    const q = ctx.query.get("q") ?? "";
    const found = q === "" ? [] : await run(scope, ctx.user, q);
    return json(200, { count: found.length, results: found.slice(0, RESULT_LIMIT) });
  });
}

function run(scope: Scope, user: UserRow, q: string): Promise<Record<string, unknown>[]> {
  switch (scope) {
    case "code":
      return searchCode(user, q);
    case "issues":
      return searchIssues(user, q);
    case "requests":
      return searchRequests(user, q);
    case "wiki":
      return searchWiki(user, q);
  }
}
