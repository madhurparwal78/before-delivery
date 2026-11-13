import { ProjectRow, writeAudit } from './access';
import { Sql } from './db';
import { errors } from './errors';
import { Tx, emit } from './live';
import { MergeRequestRow, latestVersion, loadRequest, openRequestsForBranch } from './mr';
import { JobRow, loadPipeline } from './pipeline';

export type Finding = {
  id: number;
  report_id: string;
  severity: string;
  title: string;
  path: string;
  line: number;
  state: string;
  reason: string | null;
};

type RawFinding = { id: string; severity: string; title: string; path: string; line: number };

export async function syncFindings(t: Tx, project: ProjectRow, job: JobRow, raw: RawFinding[]): Promise<void> {
  const pipeline = await loadPipeline(t.sql, job.pipeline_id);
  if (pipeline === null) return;
  const requests: MergeRequestRow[] = [];
  if (pipeline.mr_iid !== null) {
    const request = await loadRequest(t.sql, project.id, pipeline.mr_iid);
    if (request !== null) requests.push(request);
  } else {
    requests.push(...(await openRequestsForBranch(t.sql, project.id, pipeline.ref)));
  }
  for (const request of requests) {
    const existing = await findingsOf(t.sql, request.id);
    for (const item of raw) {
      const found = existing.find((candidate) => candidate.report_id === item.id);
      if (found === undefined) {
        await t.sql.query(
          `insert into findings (project_id, mr_id, report_id, severity, title, path, line, state)
           values ($1, $2, $3, $4, $5, $6, $7, 'detected')
           on conflict (mr_id, report_id) do nothing`,
          [project.id, request.id, item.id, item.severity, item.title, item.path, item.line],
        );
        continue;
      }
      if (found.state === 'resolved') {
        await t.sql.query("update findings set state = 'detected' where id = $1", [found.id]);
      }
    }
    for (const candidate of existing) {
      if (raw.some((item) => item.id === candidate.report_id)) continue;
      if (candidate.state === 'resolved') continue;
      await t.sql.query("update findings set state = 'resolved' where id = $1", [candidate.id]);
    }
    await emit(t, project.id, 'checks', { iid: request.iid });
  }
}

export async function findingsOf(sql: Sql, requestId: number): Promise<Finding[]> {
  const rows = await sql.query<Finding>(
    'select id, report_id, severity, title, path, line, state, reason from findings where mr_id = $1 order by id',
    [requestId],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), line: Number(row.line) }));
}

const transitions: Record<string, string[]> = {
  detected: ['confirmed', 'dismissed', 'resolved'],
  confirmed: ['dismissed', 'resolved'],
  dismissed: ['detected'],
  resolved: [],
};

export async function changeFinding(
  t: Tx,
  project: ProjectRow,
  request: MergeRequestRow,
  findingId: number,
  state: string,
  reason: string | null,
  actor: string,
): Promise<Finding> {
  const findings = await findingsOf(t.sql, request.id);
  const finding = findings.find((item) => item.id === findingId);
  if (finding === undefined) throw errors.notFound();
  if (!(transitions[finding.state] ?? []).includes(state)) {
    throw errors.conflict('illegal_transition', `A finding can't go from ${finding.state} to ${state}.`);
  }
  if (state === 'dismissed' && (reason === null || reason.trim().length < 10)) {
    throw errors.validation('reason', 'Give a reason of at least 10 characters.');
  }
  await t.sql.query('update findings set state = $2, reason = $3 where id = $1', [findingId, state, reason]);
  await writeAudit(
    t,
    { projectId: project.id },
    actor,
    'finding.state',
    `${project.path}!${request.iid}:${finding.report_id}`,
    { state: finding.state },
    { state, reason },
  );
  await emit(t, project.id, 'checks', { iid: request.iid, finding: findingId, state });
  return { ...finding, state, reason };
}

type TestsReport = { cases: { name: string; status: string; ms: number }[] };
type CoverageReport = { percent: number };
type QualityItem = { fingerprint: string; severity: string; path: string; line: number; message: string };

async function reportOf(sql: Sql, pipelineId: number | null, kind: string): Promise<unknown | null> {
  if (pipelineId === null) return null;
  const rows = await sql.query<{ data: unknown; config_order: number }>(
    `select r.data, j.config_order from reports r join jobs j on j.id = r.job_id
     where j.pipeline_id = $1 and r.kind = $2 order by j.config_order desc limit 1`,
    [pipelineId, kind],
  );
  return rows.length === 0 ? null : rows[0].data;
}

export async function headPipelineId(sql: Sql, project: ProjectRow, request: MergeRequestRow): Promise<number | null> {
  const version = await latestVersion(sql, request.id);
  if (version === null) return null;
  const row = await sql.one<{ id: string }>(
    'select id from pipelines where project_id = $1 and sha = $2 order by id desc limit 1',
    [project.id, version.head],
  );
  return row === null ? null : Number(row.id);
}

export async function basePipelineId(sql: Sql, project: ProjectRow, request: MergeRequestRow): Promise<number | null> {
  const version = await latestVersion(sql, request.id);
  if (version === null) return null;
  const row = await sql.one<{ id: string }>(
    `select id from pipelines where project_id = $1 and sha = $2 and status = 'success' order by id desc limit 1`,
    [project.id, version.base],
  );
  return row === null ? null : Number(row.id);
}

export type RequestReports = {
  base_pipeline_id: number | null;
  head_pipeline_id: number | null;
  tests: { text: string; new_failures: string[]; failed: number; passed: number; skipped: number };
  coverage: { text: string; head: number | null; base: number | null };
  quality: { text: string; new: string[]; resolved: string[] };
  security: { text: string; findings: Finding[] };
};

export async function requestReports(
  sql: Sql,
  project: ProjectRow,
  request: MergeRequestRow,
): Promise<RequestReports> {
  const headId = await headPipelineId(sql, project, request);
  const baseId = await basePipelineId(sql, project, request);
  const headTests = (await reportOf(sql, headId, 'tests')) as TestsReport | null;
  const baseTests = (await reportOf(sql, baseId, 'tests')) as TestsReport | null;
  const headCoverage = (await reportOf(sql, headId, 'coverage')) as CoverageReport | null;
  const baseCoverage = (await reportOf(sql, baseId, 'coverage')) as CoverageReport | null;
  const headQuality = (await reportOf(sql, headId, 'quality')) as QualityItem[] | null;
  const baseQuality = (await reportOf(sql, baseId, 'quality')) as QualityItem[] | null;

  let testsText = 'No test report.';
  let newFailures: string[] = [];
  let failed = 0;
  let passed = 0;
  let skipped = 0;
  if (headTests !== null) {
    failed = headTests.cases.filter((item) => item.status === 'failed').length;
    passed = headTests.cases.filter((item) => item.status === 'passed').length;
    skipped = headTests.cases.filter((item) => item.status === 'skipped').length;
    const baseFailed = new Set(
      (baseTests?.cases ?? []).filter((item) => item.status === 'failed').map((item) => item.name),
    );
    newFailures = headTests.cases
      .filter((item) => item.status === 'failed' && !baseFailed.has(item.name))
      .map((item) => item.name);
    testsText = `${newFailures.length} new failures, ${failed} failed, ${passed} passed, ${skipped} skipped`;
  }

  let coverageText = 'Coverage unknown';
  if (headCoverage !== null) {
    if (baseCoverage === null) {
      coverageText = `Coverage ${headCoverage.percent.toFixed(2)}% (no base)`;
    } else {
      const difference = headCoverage.percent - baseCoverage.percent;
      const sign = difference >= 0 ? '+' : '-';
      coverageText = `Coverage ${headCoverage.percent.toFixed(2)}% (${sign}${Math.abs(difference).toFixed(2)})`;
    }
  }

  let qualityText = 'No code quality report.';
  let qualityNew: string[] = [];
  let qualityResolved: string[] = [];
  if (headQuality !== null) {
    const baseSet = new Set((baseQuality ?? []).map((item) => item.fingerprint));
    const headSet = new Set(headQuality.map((item) => item.fingerprint));
    qualityNew = headQuality.filter((item) => !baseSet.has(item.fingerprint)).map((item) => item.fingerprint);
    qualityResolved = (baseQuality ?? []).filter((item) => !headSet.has(item.fingerprint)).map((item) => item.fingerprint);
    qualityText = `${qualityNew.length} new, ${qualityResolved.length} resolved`;
  }

  const findings = await findingsOf(sql, request.id);
  const pending = findings.filter((item) => ['detected', 'confirmed'].includes(item.state));
  const securityText =
    pending.length === 0
      ? 'No security findings need review.'
      : pending.length === 1
        ? '1 security finding needs review.'
        : `${pending.length} security findings need review.`;

  return {
    base_pipeline_id: baseId,
    head_pipeline_id: headId,
    tests: { text: testsText, new_failures: newFailures, failed, passed, skipped },
    coverage: {
      text: coverageText,
      head: headCoverage === null ? null : headCoverage.percent,
      base: baseCoverage === null ? null : baseCoverage.percent,
    },
    quality: { text: qualityText, new: qualityNew, resolved: qualityResolved },
    security: { text: securityText, findings },
  };
}
