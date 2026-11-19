import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { id, q1 } from '../db.js';
import { broadcastExport } from '../events.js';
import { putObject } from '../storage.js';
import type { SessionUser } from '../http.js';
import type { FilterSpec, QueryResult } from '../../shared/types.js';
import { dashboardSheetIds, loadDashboardRecord } from './dashboards.js';
import { loadSheetBundle, runSheetQuery, toQueryResult } from './sheetquery.js';
import { renderCsv, renderPdf, renderPng, type RenderView } from './render.js';
import { type QueryOutput, ViewRefused } from './query.js';

export type ExportKind = 'pdf' | 'png' | 'csv';
export type ExportStatus = 'queued' | 'rendering' | 'ready' | 'failed';

export interface ExportRequest {
  filters: FilterSpec[];
  parameters: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  user_id: string;
  kind: ExportKind;
  target_kind: 'sheet' | 'dashboard';
  target_id: string;
  request: ExportRequest;
  status: ExportStatus;
  progress: number;
  object_key: string | null;
}

let paused = false;

export function setExportsPaused(value: boolean): void {
  paused = value;
}

type Listener = (job: JobRecord) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeJob(jobId: string, listener: Listener): () => void {
  const set = listeners.get(jobId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(jobId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(jobId);
  };
}

function emit(job: JobRecord): void {
  broadcastExport(job.user_id, { id: job.id, status: job.status, progress: job.progress });
  for (const listener of listeners.get(job.id) ?? []) listener(job);
}

export function publicJob(job: JobRecord): Record<string, unknown> {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    download: job.status === 'ready' ? `/api/exports/${job.id}/file` : null,
  };
}

export function fingerprint(
  userId: string,
  kind: ExportKind,
  targetKind: string,
  targetId: string,
  request: ExportRequest,
): string {
  return createHash('sha256')
    .update(JSON.stringify([userId, kind, targetKind, targetId, request.filters, request.parameters]))
    .digest('hex');
}

export async function findRunning(fp: string): Promise<JobRecord | null> {
  return q1<JobRecord>(
    `SELECT id, user_id, kind, target_kind, target_id, request, status, progress, object_key
     FROM export_jobs WHERE fingerprint = $1 AND status IN ('queued','rendering') ORDER BY created_at DESC LIMIT 1`,
    [fp],
  );
}

export async function loadJob(jobId: string): Promise<JobRecord | null> {
  return q1<JobRecord>(
    `SELECT id, user_id, kind, target_kind, target_id, request, status, progress, object_key
     FROM export_jobs WHERE id = $1`,
    [jobId],
  );
}

async function setStatus(job: JobRecord, status: ExportStatus, progress: number, objectKey?: string): Promise<JobRecord> {
  await q1('UPDATE export_jobs SET status = $2, progress = $3, object_key = COALESCE($4, object_key) WHERE id = $1', [
    job.id,
    status,
    progress,
    objectKey ?? null,
  ]);
  const updated: JobRecord = { ...job, status, progress, object_key: objectKey ?? job.object_key };
  emit(updated);
  return updated;
}

export async function createJob(
  user: SessionUser,
  kind: ExportKind,
  targetKind: 'sheet' | 'dashboard',
  targetId: string,
  request: ExportRequest,
): Promise<JobRecord> {
  const jobId = id();
  const fp = fingerprint(user.id, kind, targetKind, targetId, request);
  await q1(
    `INSERT INTO export_jobs (id, user_id, kind, target_kind, target_id, request, fingerprint, status, progress)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', 0)`,
    [jobId, user.id, kind, targetKind, targetId, JSON.stringify(request), fp],
  );
  const job: JobRecord = {
    id: jobId,
    user_id: user.id,
    kind,
    target_kind: targetKind,
    target_id: targetId,
    request,
    status: 'queued',
    progress: 0,
    object_key: null,
  };
  void run(job, user);
  return job;
}

export async function retryJob(job: JobRecord, user: SessionUser): Promise<JobRecord> {
  const queued = await setStatus(job, 'queued', 0);
  void run(queued, user);
  return queued;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extensionOf(kind: ExportKind): string {
  return kind === 'csv' ? 'csv' : kind;
}

export function contentTypeOf(kind: ExportKind): string {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'png') return 'image/png';
  return 'text/csv; charset=utf-8';
}

export async function targetName(job: JobRecord): Promise<string> {
  if (job.target_kind === 'sheet') {
    const bundle = await loadSheetBundle(job.target_id);
    return bundle === null ? 'export' : bundle.sheet.name;
  }
  const record = await loadDashboardRecord(job.target_id);
  return record === null ? 'export' : record.name;
}

/** A hidden field leaves every export, so its columns are dropped from the answer. */
function withoutHiddenFields(output: QueryOutput, result: QueryResult, hidden: Set<string>): QueryResult {
  const fields = [...output.dims.map((d) => d.field), ...output.measures.map((m) => m.pill.field)];
  const keep = fields.map((field) => !hidden.has(field));
  if (keep.every((ok) => ok)) return result;
  const pick = <T>(values: T[]): T[] => values.filter((_, index) => keep[index] === true);
  return {
    ...result,
    columns: pick(result.columns),
    rows: result.rows.map(pick),
    total: result.total === null ? null : pick(result.total),
  };
}

async function viewsFor(job: JobRecord, user: SessionUser): Promise<{ name: string; views: RenderView[]; filters: FilterSpec[] }> {
  const body = { filters: job.request.filters, parameters: job.request.parameters, sets: {} };
  if (job.target_kind === 'sheet') {
    const bundle = await loadSheetBundle(job.target_id);
    if (bundle === null) throw new Error('missing');
    const output = runSheetQuery(bundle, user, body);
    const hidden = new Set(bundle.source.fields.filter((f) => f.hidden).map((f) => f.name));
    return {
      name: bundle.sheet.name,
      filters: [...bundle.sheet.spec.filters, ...job.request.filters],
      views: [
        { name: bundle.sheet.name, output, result: withoutHiddenFields(output, toQueryResult(output, 0), hidden) },
      ],
    };
  }
  const record = await loadDashboardRecord(job.target_id);
  if (record === null) throw new Error('missing');
  const views: RenderView[] = [];
  for (const sheetId of dashboardSheetIds(record.spec)) {
    const bundle = await loadSheetBundle(sheetId);
    if (bundle === null) continue;
    try {
      const output = runSheetQuery(bundle, user, body);
      const hidden = new Set(bundle.source.fields.filter((f) => f.hidden).map((f) => f.name));
      views.push({
        name: bundle.sheet.name,
        output,
        result: withoutHiddenFields(output, toQueryResult(output, 0), hidden),
      });
    } catch (err) {
      if (!(err instanceof ViewRefused)) throw err;
    }
  }
  return { name: record.name, filters: job.request.filters, views };
}

async function run(job: JobRecord, user: SessionUser): Promise<void> {
  await sleep(config.exportStepMs);
  while (paused) await sleep(25);
  let current = await loadJob(job.id);
  if (current === null || current.status !== 'queued') return;
  current = await setStatus(current, 'rendering', 50);
  await sleep(config.exportStepMs);
  try {
    const { name, views, filters } = await viewsFor(current, user);
    let bytes: Uint8Array;
    if (current.kind === 'pdf') bytes = await renderPdf(name, filters, views);
    else if (current.kind === 'png') bytes = renderPng(views);
    else bytes = renderCsv(views);
    const key = `exports/${current.id}.${extensionOf(current.kind)}`;
    await putObject(key, bytes, contentTypeOf(current.kind).split(';')[0]);
    await setStatus(current, 'ready', 100, key);
  } catch {
    await setStatus(current, 'failed', 0);
  }
}

