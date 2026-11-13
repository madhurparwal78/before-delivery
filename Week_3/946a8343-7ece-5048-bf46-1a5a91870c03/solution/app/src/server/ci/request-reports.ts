// Reports on a merge request and its security findings (DP-44).
import type { ProjectRow } from "../access.ts";
import { audit } from "../audit.ts";
import { refreshChecks } from "../mr/index.ts";
import { branchHead } from "../repo/index.ts";
import type { Queryable, Tx } from "../db.ts";
import {
  coverageSummary, qualitySummary, securityText, testSummary,
  type QualityItem, type ReportData, type SecurityItem, type TestCase,
} from "./report-data.ts";
import { latestPipelineOnCommit } from "./pipelines.ts";

interface FindingView {
  readonly id: number;
  readonly report_id: string;
  readonly severity: string;
  readonly title: string;
  readonly path: string;
  readonly line: number;
  readonly state: string;
  readonly reason: string | null;
}

interface MergeRequestReports {
  readonly base_pipeline_id: number | null;
  readonly head_pipeline_id: number | null;
  readonly tests: { text: string; new_failures: string[]; failed: number; passed: number; skipped: number };
  readonly coverage: { text: string; head: number | null; base: number | null };
  readonly quality: { text: string; new: string[]; resolved: string[] };
  readonly security: { text: string; findings: FindingView[] };
}

interface PipelineReports {
  readonly tests: TestCase[] | null;
  readonly coverage: number | null;
  readonly quality: QualityItem[] | null;
  readonly security: SecurityItem[] | null;
}

/** What a pipeline's jobs reported: cases and items add up, the last job in config order that has coverage wins. */
async function pipelineReports(q: Queryable, pipelineId: number): Promise<PipelineReports> {
  const rows = await q.q<{ data: ReportData }>(
    `SELECT r.data FROM ci_reports r JOIN ci_jobs j ON j.id = r.job_id
      WHERE j.pipeline_id = $1 AND NOT j.retried ORDER BY j.config_order, j.id`,
    [pipelineId],
  );
  let tests: TestCase[] | null = null;
  let coverage: number | null = null;
  let quality: QualityItem[] | null = null;
  let security: SecurityItem[] | null = null;
  for (const { data } of rows) {
    if (data.kind === "tests") tests = [...(tests ?? []), ...data.cases];
    else if (data.kind === "coverage") coverage = data.percent;
    else if (data.kind === "quality") quality = [...(quality ?? []), ...data.items];
    else security = [...(security ?? []), ...data.items.filter((item) => !(security ?? []).some((known) => known.id === item.id))];
  }
  return { tests, coverage, quality, security };
}

export async function pipelineCoverage(q: Queryable, pipelineId: number): Promise<number | null> {
  return (await pipelineReports(q, pipelineId)).coverage;
}

const OPEN_STATES = ["detected", "confirmed"];

async function requestIid(q: Queryable, mrId: number): Promise<number | null> {
  const row = await q.maybe<{ iid: number }>("SELECT iid FROM merge_requests WHERE id = $1", [mrId]);
  return row?.iid ?? null;
}

async function findingTarget(q: Queryable, project: ProjectRow, mrId: number, reportId: string): Promise<string> {
  return `${project.path}!${(await requestIid(q, mrId)) ?? mrId}:${reportId}`;
}

/** One finding per report `id` on the request; one absent from the head report's later versions becomes `resolved`.
 *  True when any finding was created or changed. */
async function syncFindings(tx: Tx, project: ProjectRow, mrId: number, headSha: string): Promise<boolean> {
  const head = await latestPipelineOnCommit(tx, project.id, headSha);
  if (head === null) return false;
  const items = (await pipelineReports(tx, head.id)).security;
  if (items === null) return false;
  const known = await tx.q<{ id: number; report_id: string; state: string }>("SELECT id, report_id, state FROM ci_findings WHERE mr_id = $1", [mrId]);
  const states = new Map(known.map((row) => [row.report_id, row.state] as const));
  let changed = false;
  for (const item of items) {
    const before = states.get(item.id);
    const stored = await tx.q<{ state: string }>(
      `INSERT INTO ci_findings (project_id, mr_id, report_id, severity, title, path, line, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'detected')
       ON CONFLICT (mr_id, report_id) DO UPDATE SET severity = $4, title = $5, path = $6, line = $7,
         state = CASE WHEN ci_findings.state = 'resolved' THEN 'detected' ELSE ci_findings.state END,
         reason = CASE WHEN ci_findings.state = 'resolved' THEN NULL ELSE ci_findings.reason END
       RETURNING state`,
      [project.id, mrId, item.id, item.severity, item.title, item.path, item.line],
    );
    if (before === undefined) changed = true;
    if (before === "resolved" && stored[0]?.state === "detected") {
      changed = true;
      await audit(tx, {
        projectId: project.id, actor: "system", action: "finding.state", target: await findingTarget(tx, project, mrId, item.id),
        before: { state: "resolved" }, after: { state: "detected", reason: null },
      });
    }
  }
  const present = new Set(items.map((item) => item.id));
  for (const row of known) {
    if (present.has(row.report_id) || !OPEN_STATES.includes(row.state)) continue;
    changed = true;
    await tx.q("UPDATE ci_findings SET state = 'resolved' WHERE id = $1", [row.id]);
    await audit(tx, {
      projectId: project.id, actor: "system", action: "finding.state", target: await findingTarget(tx, project, mrId, row.report_id),
      before: { state: row.state }, after: { state: "resolved", reason: null },
    });
  }
  return changed;
}

/** Findings of a request whose head report was never read yet: created as `detected`, nothing else touched. */
async function ensureFindings(q: Queryable, projectId: number, mrId: number): Promise<void> {
  const request = await q.maybe<{ source: string; state: string }>("SELECT source, state FROM merge_requests WHERE id = $1 AND project_id = $2", [mrId, projectId]);
  if (request === undefined || request.state !== "opened") return;
  const sha = await branchHead(q, projectId, request.source);
  const head = sha === null ? null : await latestPipelineOnCommit(q, projectId, sha);
  const items = head === null ? null : (await pipelineReports(q, head.id)).security;
  for (const item of items ?? []) {
    await q.q(
      `INSERT INTO ci_findings (project_id, mr_id, report_id, severity, title, path, line, state) VALUES ($1, $2, $3, $4, $5, $6, $7, 'detected')
       ON CONFLICT (mr_id, report_id) DO NOTHING`,
      [projectId, mrId, item.id, item.severity, item.title, item.path, item.line],
    );
  }
}

async function findingsOf(q: Queryable, mrId: number): Promise<FindingView[]> {
  return q.q<FindingView>(
    "SELECT id, report_id, severity, title, path, line, state, reason FROM ci_findings WHERE mr_id = $1 ORDER BY id",
    [mrId],
  );
}

/** Reports of a request: its head pipeline compared with the latest successful target pipeline at the merge base commit. */
export async function reportsForRequest(
  tx: Tx,
  input: { project: ProjectRow; mrId: number; headSha: string; mergeBaseSha: string | null; target: string },
): Promise<MergeRequestReports> {
  const { project, mrId, headSha, mergeBaseSha, target } = input;
  const head = await latestPipelineOnCommit(tx, project.id, headSha);
  const base =
    mergeBaseSha === null
      ? undefined
      : await tx.maybe<{ id: number }>(
          `SELECT id FROM ci_pipelines WHERE project_id = $1 AND sha = $2 AND ref = $3 AND source <> 'train' AND status IN ('success', 'warning')
            ORDER BY id DESC LIMIT 1`,
          [project.id, mergeBaseSha, target],
        );
  const headReports = head === null ? null : await pipelineReports(tx, head.id);
  const baseReports = base === undefined ? null : await pipelineReports(tx, base.id);
  if (await syncFindings(tx, project, mrId, headSha)) await refreshChecks(tx, project, mrId);
  const findings = await findingsOf(tx, mrId);
  const open = findings.filter((finding) => OPEN_STATES.includes(finding.state)).length;
  return {
    base_pipeline_id: base?.id ?? null,
    head_pipeline_id: head?.id ?? null,
    tests: testSummary(headReports?.tests ?? null, baseReports?.tests ?? null),
    coverage: coverageSummary(headReports?.coverage ?? null, baseReports?.coverage ?? null),
    quality: qualitySummary(headReports?.quality ?? null, baseReports?.quality ?? null),
    security: { text: securityText(open), findings },
  };
}

/** Number of high or critical security findings of the request that are still detected or confirmed. */
export async function blockingFindingCount(q: Queryable, projectId: number, mrId: number): Promise<number> {
  await ensureFindings(q, projectId, mrId);
  const row = await q.one<{ count: number }>(
    `SELECT count(*)::int AS count FROM ci_findings
      WHERE project_id = $1 AND mr_id = $2 AND state = ANY($3::text[]) AND severity IN ('high', 'critical')`,
    [projectId, mrId, OPEN_STATES],
  );
  return row.count;
}

/** A job stored a security report: the open requests whose head is that commit pick up the findings. */
export async function syncRequestsOnHead(tx: Tx, project: ProjectRow, pipeline: { ref: string; sha: string; source: string }): Promise<void> {
  if (pipeline.source === "train" || (await branchHead(tx, project.id, pipeline.ref)) !== pipeline.sha) return;
  const requests = await tx.q<{ id: number; iid: number }>(
    "SELECT id, iid FROM merge_requests WHERE project_id = $1 AND source = $2 AND state = 'opened' ORDER BY iid",
    [project.id, pipeline.ref],
  );
  for (const request of requests) {
    if (!(await syncFindings(tx, project, request.id, pipeline.sha))) continue;
    await tx.emit(project.id, "approvals", { iid: request.iid });
    await refreshChecks(tx, project, request.id);
  }
}
