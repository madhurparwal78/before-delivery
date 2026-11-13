/**
 * Exports: the state machine, the worker and the one manifest per cut and size.
 */
import { ApiError } from '../domain/api-error.js';
import { buildManifest, manifestBytes } from '../domain/manifest.js';
import { exactRate, framesToMinutesCeiling } from '../domain/rate.js';
import type { TimelineSnapshot } from '../domain/timeline-state.js';
import { allowance, giveBackMinutes } from './allowance.js';
import { config } from './config.js';
import { query } from './db.js';
import { broadcastAllowance, broadcastExport } from './live.js';
import { enqueueMail } from './services/mail.js';
import { headObject, putObject, StorageDown, StorageKeys } from './services/storage.js';
import type { ExportMessage } from './services/queue.js';
import type { AspectRatio, ExportRecord, ExportSize, ExportState } from '../shared/types.js';
import type { FrameRateName } from '../domain/rate.js';

interface ExportRow {
  id: string;
  project_id: string;
  cut_id: string;
  size: ExportSize;
  state: ExportState;
  progress: number;
  minutes: number;
  requested_by: string;
  requested_by_id: string | null;
  manifest_checksum: string | null;
  created_at: Date;
  finished_at: Date | null;
  finished_version: number | null;
  cut_name: string;
  project_version: number;
  title: string;
  frame_rate: FrameRateName;
  aspect_ratio: AspectRatio;
}

const EXPORT_COLUMNS = `e.id, e.project_id, e.cut_id, e.size, e.state, e.progress, e.minutes, e.requested_by,
  e.requested_by_id, e.manifest_checksum, e.created_at, e.finished_at, e.finished_version,
  c.name as cut_name, p.version as project_version, p.title, p.frame_rate, p.aspect_ratio`;

const EXPORT_FROM = `from exports e join cuts c on c.id = e.cut_id join projects p on p.id = e.project_id`;

export function exportRecord(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    cut_id: row.cut_id,
    cut_name: row.cut_name,
    size: row.size,
    state: row.state,
    progress: row.progress,
    minutes: row.minutes,
    stale: row.state === 'done' && row.finished_version !== null && row.project_version > row.finished_version,
    requested_by: row.requested_by,
    manifest_checksum: row.manifest_checksum,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at === null ? null : row.finished_at.toISOString(),
  };
}

export async function exportById(id: string): Promise<ExportRow | null> {
  const rows = await query<ExportRow>(`select ${EXPORT_COLUMNS} ${EXPORT_FROM} where e.id = $1`, [id]);
  return rows.length > 0 ? rows[0] : null;
}

export async function exportsOfProject(projectId: string): Promise<ExportRow[]> {
  return query<ExportRow>(`select ${EXPORT_COLUMNS} ${EXPORT_FROM} where e.project_id = $1 order by e.created_at desc`, [
    projectId,
  ]);
}

export async function openExportFor(projectId: string, cutId: string, size: ExportSize): Promise<ExportRow | null> {
  const rows = await query<ExportRow>(
    `select ${EXPORT_COLUMNS} ${EXPORT_FROM}
     where e.project_id = $1 and e.cut_id = $2 and e.size = $3 and e.state in ('queued','running','done')
     order by e.created_at desc limit 1`,
    [projectId, cutId, size],
  );
  return rows.length > 0 ? rows[0] : null;
}

export function minutesFor(totalFrames: number, rateName: FrameRateName): number {
  return framesToMinutesCeiling(totalFrames, exactRate(rateName));
}

async function broadcast(id: string): Promise<ExportRow | null> {
  const row = await exportById(id);
  if (row !== null) broadcastExport(row.project_id, exportRecord(row));
  return row;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The worker: ten steps, each EXPORT_STEP_MS long, then the manifest. */
export async function runExport(message: ExportMessage): Promise<void> {
  const started = await query<{ state: ExportState }>(
    `update exports set state = 'running', progress = 0 where id = $1 and state = 'queued' returning state`,
    [message.export_id],
  );
  if (started.length === 0) return;
  await broadcast(message.export_id);

  for (let step = 1; step <= 10; step += 1) {
    await pause(config.exportStepMs);
    const current = await query<{ state: ExportState }>(`select state from exports where id = $1`, [message.export_id]);
    if (current.length === 0 || current[0].state !== 'running') return;
    if (step < 10) {
      await query(`update exports set progress = $2 where id = $1 and state = 'running'`, [message.export_id, step * 10]);
      await broadcast(message.export_id);
    }
  }

  const row = await exportById(message.export_id);
  if (row === null || row.state !== 'running') return;
  const cut = await query<{ snapshot: TimelineSnapshot; total_frames: number; name: string }>(
    `select snapshot, total_frames, name from cuts where id = $1`,
    [row.cut_id],
  );
  if (cut.length === 0) return;
  const checksums = await query<{ id: string; sha256: string }>(`select id, sha256 from media`);
  const manifest = buildManifest({
    project: { id: row.project_id, title: row.title, aspect_ratio: row.aspect_ratio },
    cut: { id: row.cut_id, name: cut[0].name, total_frames: cut[0].total_frames },
    snapshot: cut[0].snapshot,
    size: row.size,
    rate: exactRate(row.frame_rate),
    checksumOf: (mediaId) => checksums.find((media) => media.id === mediaId)?.sha256 ?? null,
  });
  try {
    const key = StorageKeys.manifest(row.id);
    if (!(await headObject(key))) await putObject(key, manifestBytes(manifest), 'application/json');
  } catch (error) {
    if (error instanceof StorageDown) {
      await query(`update exports set state = 'failed', finished_at = now() where id = $1 and state = 'running'`, [row.id]);
      await giveBackMinutes(row.minutes, row.created_at.toISOString().slice(0, 7));
      await broadcast(row.id);
      broadcastAllowance(await allowance());
      return;
    }
    throw error;
  }
  await query(
    `update exports set state = 'done', progress = 100, finished_at = now(), manifest_checksum = $2,
       finished_version = (select version from projects where id = exports.project_id)
     where id = $1 and state = 'running'`,
    [row.id, manifest.checksum],
  );
  const done = await broadcast(row.id);
  if (done !== null && done.state === 'done' && done.requested_by_id !== null) {
    const person = await query<{ email: string }>(`select email from people where id = $1`, [done.requested_by_id]);
    if (person.length > 0) {
      await enqueueMail(
        person[0].email,
        `Gatecut · export ready · ${done.cut_name} · ${done.size}p`,
        `${done.cut_name} at ${done.size}p is ready.\nManifest checksum: ${manifest.checksum}\n${config.publicUrl}/projects/${done.project_id}`,
      );
    }
  }
}

export async function cancelExport(id: string): Promise<ExportRow> {
  const row = await exportById(id);
  if (row === null) throw ApiError.of('not_found', undefined);
  if (row.state !== 'queued' && row.state !== 'running') {
    throw ApiError.of('export_finished', { state: row.state });
  }
  await query(`update exports set state = 'cancelled', finished_at = now() where id = $1`, [id]);
  await giveBackMinutes(row.minutes, row.created_at.toISOString().slice(0, 7));
  const cancelled = await broadcast(id);
  broadcastAllowance(await allowance());
  if (cancelled === null) throw ApiError.of('not_found', undefined);
  return cancelled;
}
