import { one, query } from '../db.js';
import { CitationLists, computeCitationLists } from './citations.js';
import { newId } from './ids.js';
import { countOpenSuggestions, countOpenThreads } from './review.js';

export interface CitationReport extends CitationLists {
  projectRevision: number;
  checkId: string;
}

interface StoredRow {
  check_id: string;
  lists: CitationLists;
}

/** The report is computed once per project revision and then read from the store. */
export async function citationReport(
  projectId: string,
  projectRevision: number,
): Promise<CitationReport> {
  const stored = await one<StoredRow>(
    `select check_id, lists from citation_reports where project_id = $1 and project_revision = $2`,
    [projectId, projectRevision],
  );
  if (stored !== null) {
    return { projectRevision, checkId: stored.check_id, ...stored.lists };
  }

  const rows = await query<{ path: string; content: string | null }>(
    `select path, content from files
      where project_id = $1 and deleted = false and kind = 'text'`,
    [projectId],
  );
  const files = new Map<string, string>();
  for (const row of rows) files.set(row.path, row.content ?? '');
  const lists = computeCitationLists(files);
  const checkId = newId('chk');
  await query(
    `insert into citation_reports (project_id, project_revision, check_id, lists)
     values ($1, $2, $3, $4) on conflict (project_id, project_revision) do nothing`,
    [projectId, projectRevision, checkId, JSON.stringify(lists)],
  );
  const written = await one<StoredRow>(
    `select check_id, lists from citation_reports where project_id = $1 and project_revision = $2`,
    [projectId, projectRevision],
  );
  if (written === null) return { projectRevision, checkId, ...lists };
  return { projectRevision, checkId: written.check_id, ...written.lists };
}

export interface Readiness {
  openSuggestions: number;
  openThreads: number;
  undefinedCitations: number;
  duplicateKeys: number;
}

export async function exportReadiness(
  projectId: string,
  projectRevision: number,
): Promise<Readiness> {
  const report = await citationReport(projectId, projectRevision);
  return {
    openSuggestions: await countOpenSuggestions(projectId),
    openThreads: await countOpenThreads(projectId),
    undefinedCitations: report.undefined.length,
    duplicateKeys: report.duplicate.length,
  };
}

export function isReady(readiness: Readiness): boolean {
  return (
    readiness.openSuggestions === 0 &&
    readiness.openThreads === 0 &&
    readiness.undefinedCitations === 0 &&
    readiness.duplicateKeys === 0
  );
}
