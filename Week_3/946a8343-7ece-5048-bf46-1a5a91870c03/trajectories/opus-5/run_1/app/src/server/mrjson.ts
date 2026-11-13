import { ProjectRow } from './access';
import { Sql } from './db';
import {
  MergeRequestRow,
  ThreadRow,
  approvalRules,
  closingIssues,
  isDraft,
  latestVersion,
  mergeChecks,
  notesOf,
  suggestionsOf,
  threadsOf,
  versionsOf,
} from './mr';
import { branchHead, mergeBase } from './repo';
import { carOfRequest } from './train';
import { viewersOf } from './live';
import { requestReports } from './reports';

export async function threadJson(sql: Sql, request: MergeRequestRow, viewer: string): Promise<Record<string, unknown>[]> {
  const threads = await threadsOf(sql, request.id);
  const notes = await notesOf(sql, request, viewer, 'all');
  const suggestions = await suggestionsOf(sql, request.id);
  return threads.map((thread: ThreadRow) => ({
    id: thread.id,
    position: thread.position,
    current_line: thread.current_line,
    resolved: thread.resolved,
    outdated: thread.outdated,
    notes: notes
      .filter((note) => note.thread_id === thread.id)
      .map((note) => ({
        id: note.id,
        author: note.author,
        body: note.body,
        system: note.system,
        pending: note.pending,
        thread_id: note.thread_id,
        created_at: note.created_at,
      })),
    suggestions: suggestions
      .filter((suggestion) => suggestion.thread_id === thread.id)
      .map((suggestion) => ({
        id: suggestion.id,
        note_id: suggestion.note_id,
        path: suggestion.path,
        start_line: suggestion.start_line,
        end_line: suggestion.end_line,
        lines: suggestion.lines,
        state: suggestion.state,
      })),
  }));
}

export async function requestJson(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
  viewerId: number,
  viewer: string,
): Promise<Record<string, unknown>> {
  const sourceHead = await branchHead(sql, project.id, request.source);
  const targetHead = await branchHead(sql, project.id, request.target);
  const base =
    sourceHead === null || targetHead === null ? null : await mergeBase(sql, project.id, targetHead, sourceHead);
  const versions = await versionsOf(sql, request.id);
  const checks = await mergeChecks(sql, project, request);
  const approvals = await approvalRules(sql, project, request);
  const car = await carOfRequest(sql, request);
  const headPipeline =
    sourceHead === null
      ? null
      : await sql.one<{ id: string; status: string }>(
          'select id, status from pipelines where project_id = $1 and sha = $2 order by id desc limit 1',
          [project.id, sourceHead],
        );
  const reports = await requestReports(sql, project, request);
  const latest = await latestVersion(sql, request.id);
  return {
    iid: request.iid,
    id: request.id,
    title: request.title,
    state: request.state,
    draft: isDraft(request.title),
    author: request.author,
    source: request.source,
    target: request.target,
    description: request.description,
    assignees: request.assignees,
    reviewers: request.reviewers,
    delete_source_branch: request.delete_source_branch,
    source_head: sourceHead,
    target_head: targetHead,
    merge_base: base,
    merge_commit: request.merge_commit,
    latest_version: latest === null ? null : latest.number,
    versions: versions.map((version) => ({
      number: version.number,
      base: version.base,
      head: version.head,
      start: version.start_commit,
    })),
    checks,
    approvals: {
      rules: approvals.rules.map((rule) => ({
        name: rule.name,
        kind: rule.kind,
        required: rule.required,
        given: rule.given,
        optional: rule.optional,
        eligible: rule.eligible,
      })),
      approved_by: approvals.approvedBy,
    },
    owners_problems: approvals.problems.map((problem) => `Line ${problem.line}: ${problem.reason}`),
    head_pipeline: headPipeline === null ? null : { id: Number(headPipeline.id), status: headPipeline.status },
    train:
      car === null
        ? null
        : { position: car.position, sha: car.sha, pipeline_id: car.pipeline_id },
    auto_merge: request.auto_merge,
    closes: await closingIssues(sql, project, request, viewerId),
    viewing: viewersOf(project.id),
    reports,
    threads: await threadJson(sql, request, viewer),
  };
}
