import { ProjectRow, loadProject, projectAccess } from './access';
import { Sql } from './db';
import { branchHead, filesOfCommit } from './repo';
import { splitLines } from './diff';
import { visibleIssues } from './planning';

export type SearchResult = Record<string, unknown>;

async function readableProjects(sql: Sql, userId: number): Promise<ProjectRow[]> {
  const rows = await sql.query<{ id: string }>('select id from projects order by id', []);
  const out: ProjectRow[] = [];
  for (const row of rows) {
    const project = await loadProject(sql, Number(row.id));
    if (project === null) continue;
    const access = await projectAccess(sql, project, userId);
    if (access.level === 0) continue;
    out.push(project);
  }
  return out;
}

export async function search(
  sql: Sql,
  userId: number,
  scope: string,
  query: string,
): Promise<{ count: number; results: SearchResult[] }> {
  const needle = query.toLowerCase();
  const projects = await readableProjects(sql, userId);
  const results: SearchResult[] = [];
  if (needle === '') return { count: 0, results };
  for (const project of projects) {
    if (scope === 'code') {
      const head = await branchHead(sql, project.id, project.default_branch);
      if (head === null) continue;
      const files = await filesOfCommit(sql, project.id, head);
      for (const path of [...files.keys()].sort()) {
        const lines = splitLines(files.get(path) ?? '');
        lines.forEach((text, index) => {
          if (text.toLowerCase().includes(needle)) {
            results.push({ project: project.path, project_id: project.id, path, line: index + 1, text });
          }
        });
      }
      continue;
    }
    if (scope === 'issues') {
      for (const issue of await visibleIssues(sql, project, userId)) {
        if (!issue.title.toLowerCase().includes(needle) && !issue.description.toLowerCase().includes(needle)) continue;
        results.push({ project: project.path, project_id: project.id, iid: issue.iid, title: issue.title });
      }
      continue;
    }
    if (scope === 'requests') {
      const rows = await sql.query<{ iid: number; title: string }>(
        'select iid, title from merge_requests where project_id = $1 order by iid',
        [project.id],
      );
      for (const row of rows) {
        if (!row.title.toLowerCase().includes(needle)) continue;
        results.push({ project: project.path, project_id: project.id, iid: Number(row.iid), title: row.title });
      }
      continue;
    }
    const pages = await sql.query<{ slug: string; title: string; content: string; version: number }>(
      `select slug, title, content, version from wiki_pages w where project_id = $1
       and version = (select max(version) from wiki_pages where project_id = $1 and slug = w.slug)`,
      [project.id],
    );
    for (const page of pages) {
      if (!page.title.toLowerCase().includes(needle) && !page.content.toLowerCase().includes(needle)) continue;
      results.push({ project: project.path, project_id: project.id, slug: page.slug, title: page.title });
    }
  }
  if (scope === 'code') {
    results.sort((a, b) => {
      const pathA = String(a.path);
      const pathB = String(b.path);
      if (pathA !== pathB) return pathA < pathB ? -1 : 1;
      return Number(a.line) - Number(b.line);
    });
  }
  return { count: results.length, results };
}
