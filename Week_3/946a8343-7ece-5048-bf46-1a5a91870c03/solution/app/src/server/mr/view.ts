// The request body of `GET /<iid>`, and the shapes it is made of.
import type { Queryable } from "../db.ts";
import type { ProjectRow } from "../access.ts";
import { latestPipelineOnCommit } from "../ci/index.ts";
import { viewersOf } from "../live.ts";
import { readableIssueIids } from "../planning/index.ts";
import { carOfRequest } from "../train/index.ts";
import * as repo from "../repo/index.ts";
import { iso } from "../clock.ts";
import { rememberChecks } from "./engine.ts";
import { evaluateRequest, type Evaluation } from "./evaluate.ts";
import { closingIssueIids } from "./closing.ts";
import type { RuleView } from "./rules.ts";
import { isDraft, versionsOf, type MrRow } from "./store.ts";

export interface ApprovalsView {
  readonly rules: RuleView[];
  readonly approved_by: string[];
}

export function approvalsView(evaluation: Pick<Evaluation, "rules" | "approvedBy">): ApprovalsView {
  return { rules: evaluation.rules, approved_by: evaluation.approvedBy };
}

async function closesOf(q: Queryable, project: ProjectRow, mr: MrRow, evaluation: Evaluation, userId: number): Promise<number[]> {
  const commits = evaluation.sourceHead === null ? [] : await repo.commitsBetween(q, project.id, evaluation.mergeBase, evaluation.sourceHead);
  const named = closingIssueIids([mr.description, ...commits.map((commit) => commit.message)]);
  return named.length === 0 ? [] : readableIssueIids(q, userId, project, named);
}

export async function requestBody(q: Queryable, project: ProjectRow, mr: MrRow, userId: number): Promise<Record<string, unknown>> {
  const evaluation = await evaluateRequest(q, project, mr);
  await rememberChecks(q, mr, evaluation);
  const versions = await versionsOf(q, mr.id);
  const pipeline = evaluation.sourceHead === null ? null : await latestPipelineOnCommit(q, project.id, evaluation.sourceHead);
  const car = await carOfRequest(q, project.id, mr.id);
  return {
    iid: mr.iid,
    title: mr.title,
    state: mr.state,
    draft: isDraft(mr.title),
    author: evaluation.author,
    source: mr.source,
    target: mr.target,
    description: mr.description,
    assignees: mr.assignees,
    reviewers: mr.reviewers,
    delete_source_branch: mr.delete_source_branch,
    source_head: evaluation.sourceHead,
    target_head: evaluation.targetHead,
    merge_base: evaluation.mergeBase,
    versions: versions.map((version) => ({ number: version.number, base: version.base, head: version.head, start: version.start })),
    checks: evaluation.checks,
    approvals: approvalsView(evaluation),
    owners_problems: evaluation.problems,
    head_pipeline: pipeline === null ? null : { id: pipeline.id, status: pipeline.status },
    train: car === null ? null : { position: car.position, sha: car.sha, pipeline_id: car.pipeline_id },
    auto_merge: mr.auto_merge_by !== null,
    closes: await closesOf(q, project, mr, evaluation, userId),
    viewing: await viewersOf(q, project.id, mr.iid),
    merge_commit: mr.merge_commit,
    merged_by: mr.merged_by,
    created_at: iso(mr.created_at),
    updated_at: iso(mr.updated_at),
  };
}

interface ListedRequest {
  readonly iid: number;
  readonly title: string;
  readonly state: string;
  readonly draft: boolean;
  readonly author: string;
  readonly source: string;
  readonly target: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export async function listedRequests(q: Queryable, project: ProjectRow, state: string | null): Promise<ListedRequest[]> {
  const rows = await q.q<MrRow & { author: string }>(
    `SELECT m.*, u.username AS author FROM merge_requests m JOIN users u ON u.id = m.author_id
      WHERE m.project_id = $1 AND ($2::text IS NULL OR m.state = $2) ORDER BY m.iid DESC`,
    [project.id, state],
  );
  return rows.map((row) => ({
    iid: row.iid,
    title: row.title,
    state: row.state,
    draft: isDraft(row.title),
    author: row.author,
    source: row.source,
    target: row.target,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  }));
}
