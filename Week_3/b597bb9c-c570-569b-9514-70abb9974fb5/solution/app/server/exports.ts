import { createHash } from "node:crypto";
import { EXPORT_SIZES } from "../shared/limits";
import { FIELD_ERRORS } from "../shared/copy";
import { ASPECTS, type ExportRecord, type ExportState } from "../shared/types";
import { rateOf, formatRational, roundExact } from "../shared/rational";
import type { Actor } from "./access";
import { allowance, allowanceExceeded, currentMonth, giveBackMinutes, takeMinutes } from "./allowance";
import { config } from "./config";
import { one, pool, query, tx } from "./db";
import { AppError, invalid, notFound } from "./errors";
import { newId } from "./ids";
import { hub } from "./live";
import { queueMail, kickOutbox } from "./mail";
import { exportQueue, type ExportMessage } from "./queue";
import { headObject, presignGet, putObject, reachable, StorageDown } from "./s3";
import type { CutSnapshot } from "./timeline/engine";
import { loadProjectRow } from "./timeline/store";

interface ExportRow {
  id: string;
  project_id: string;
  cut_id: string;
  cut_name: string;
  size: number;
  state: ExportState;
  progress: number;
  minutes: number;
  requested_by: string;
  requester: string;
  manifest_checksum: string | null;
  created_at: Date;
  finished_at: Date | null;
  finished_version: number | null;
  project_version: number;
  total_frames: number;
}

const SELECT = `SELECT e.*, c.name AS cut_name, c.total_frames, p.name AS requester, pr.version AS project_version
  FROM exports e JOIN cuts c ON c.id = e.cut_id JOIN people p ON p.id = e.requested_by JOIN projects pr ON pr.id = e.project_id`;

function record(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    project_id: row.project_id,
    cut_id: row.cut_id,
    cut_name: row.cut_name,
    size: row.size,
    state: row.state,
    progress: row.progress,
    minutes: row.minutes,
    stale: row.state === "done" && row.finished_version !== null && row.project_version > row.finished_version,
    requested_by: row.requester,
    manifest_checksum: row.manifest_checksum,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

export async function exportById(id: string): Promise<ExportRecord> {
  const row = await one<ExportRow>(`${SELECT} WHERE e.id = $1`, [id]);
  if (!row) throw notFound();
  return record(row);
}

export async function projectOfExport(id: string): Promise<string> {
  const row = await one<{ project_id: string }>("SELECT project_id FROM exports WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row.project_id;
}

export async function listExports(projectId: string): Promise<ExportRecord[]> {
  return (await query<ExportRow>(`${SELECT} WHERE e.project_id = $1 ORDER BY e.seq DESC`, [projectId])).map(record);
}

function publish(exported: ExportRecord): void {
  hub.toProject(exported.project_id, { type: "export", export: exported });
}

/** Minutes of a cut: its total frames at the exact rate, rounded up to a whole minute. */
function minutesOf(rateLabel: string, totalFrames: number): number {
  const rate = rateOf(rateLabel);
  const numerator = BigInt(totalFrames) * rate.den;
  const denominator = rate.num * 60n;
  return Number((numerator + denominator - 1n) / denominator);
}

function fail(code: "storage_unavailable" | "queue_unavailable"): never {
  throw new AppError(code);
}

export async function startExport(projectId: string, actor: Actor, raw: unknown): Promise<{ status: 200 | 202; body: ExportRecord }> {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const size = input["size"];
  if (typeof input["cut_id"] !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  const cut = await one<{ id: string; total_frames: number }>("SELECT id, total_frames FROM cuts WHERE id = $1 AND project_id = $2", [input["cut_id"], projectId]);
  if (!cut) throw notFound();
  const project = await loadProjectRow(pool, projectId);
  if (!project) throw notFound();
  const existing = (size === 2160 || size === 1080 || size === 720)
    ? await one<ExportRow>(`${SELECT} WHERE e.cut_id = $1 AND e.size = $2 AND e.state IN ('queued','running','done')`, [cut.id, size])
    : undefined;
  if (existing) return { status: 200, body: record(existing) };
  if (!EXPORT_SIZES.some((candidate) => candidate === size)) throw invalid({ size: FIELD_ERRORS.other });
  const minutes = minutesOf(project.frame_rate, cut.total_frames);
  const current = await allowance();
  if (current.export_minutes_used + minutes > current.export_minutes_allowance) throw allowanceExceeded(current);
  if (!(await reachable())) fail("storage_unavailable");
  if (!(await exportQueue.ensure())) fail("queue_unavailable");
  const id = newId("x");
  const message: ExportMessage = { export_id: id, project_id: projectId, cut_id: cut.id, size: size as number, requested_by: actor.id };
  const outcome = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`export:${cut.id}:${size}`]);
    const again = await one<ExportRow>(`${SELECT} WHERE e.cut_id = $1 AND e.size = $2 AND e.state IN ('queued','running','done')`, [cut.id, size], db);
    if (again) return { status: 200 as const, row: again };
    if (!(await takeMinutes(minutes))) throw allowanceExceeded(await allowance());
    try {
      await db.query("INSERT INTO exports (id, project_id, cut_id, size, minutes, requested_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, projectId, cut.id, size, minutes, actor.id]);
    } catch (error) {
      await giveBackMinutes(minutes, currentMonth());
      throw error;
    }
    return { status: 202 as const, row: undefined };
  });
  const row = await one<ExportRow>(`${SELECT} WHERE e.id = $1`, [outcome.row?.id ?? id]);
  if (!row) throw notFound();
  if (outcome.status === 202) {
    if (!(await exportQueue.publish(message))) {
      await query("DELETE FROM exports WHERE id = $1", [id]);
      await giveBackMinutes(minutes, currentMonth());
      fail("queue_unavailable");
    }
    publish(record(row));
  }
  return { status: outcome.status, body: record(row) };
}

export async function cancelExport(id: string): Promise<ExportRecord> {
  const row = await one<ExportRow>(`${SELECT} WHERE e.id = $1`, [id]);
  if (!row) throw notFound();
  const stopped = await one<{ created_at: Date; minutes: number }>(
    "UPDATE exports SET state = 'cancelled' WHERE id = $1 AND state IN ('queued','running') RETURNING created_at, minutes",
    [id],
  );
  if (!stopped) throw new AppError("export_finished", { state: row.state });
  await giveBackMinutes(stopped.minutes, stopped.created_at.toISOString().slice(0, 7));
  const after = await exportById(id);
  publish(after);
  return after;
}

export async function manifestLink(id: string): Promise<string> {
  const exported = await exportById(id);
  if (exported.state !== "done") throw new AppError("export_not_ready");
  return presignGet(`manifests/${id}.json`, config.manifestLinkSeconds);
}

/** Flips the exports a new op just made stale, once, and tells every open screen. */
export async function exportsAfterOp(projectId: string, version: number): Promise<void> {
  const rows = await query<ExportRow>(`${SELECT} WHERE e.project_id = $1 AND e.state = 'done' AND e.finished_version = $2`, [projectId, version - 1]);
  for (const row of rows) publish(record(row));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function buildManifest(row: ExportRow): Promise<{ text: string; checksum: string }> {
  const project = await loadProjectRow(pool, row.project_id);
  const cut = await one<{ snapshot: CutSnapshot; total_frames: number }>("SELECT snapshot, total_frames FROM cuts WHERE id = $1", [row.cut_id]);
  if (!project || !cut) throw notFound();
  const media = await query<{ id: string; sha256: string }>("SELECT id, sha256 FROM media WHERE id = ANY($1)", [cut.snapshot.clips.flatMap((clip) => (clip.media_id ? [clip.media_id] : []))]);
  const sha = new Map(media.map((item) => [item.id, item.sha256]));
  const aspect = ASPECTS[project.aspect_ratio];
  const landscape = aspect.width >= aspect.height;
  const long = (shortSide: number, longPart: number, shortPart: number): number => roundExact(BigInt(shortSide) * BigInt(longPart), BigInt(shortPart));
  const body = {
    project: { id: project.id, title: project.title },
    cut: { id: row.cut_id, name: row.cut_name },
    frame_rate: formatRational(rateOf(project.frame_rate)),
    size: row.size,
    width: landscape ? long(row.size, aspect.width, aspect.height) : row.size,
    height: landscape ? row.size : long(row.size, aspect.height, aspect.width),
    total_frames: cut.total_frames,
    rows: [...cut.snapshot.rows]
      .sort((a, b) => a.position - b.position)
      .map((snapshotRow) => ({
        row_id: snapshotRow.id,
        name: snapshotRow.name,
        kind: snapshotRow.kind,
        items: cut.snapshot.clips
          .filter((clip) => clip.row_id === snapshotRow.id)
          .sort((a, b) => a.start_frame - b.start_frame)
          .map((clip) => ({
            clip_id: clip.id,
            name: clip.name,
            kind: clip.kind,
            media_sha256: clip.media_id ? (sha.get(clip.media_id) ?? null) : null,
            start_frame: clip.start_frame,
            end_frame: clip.end_frame,
            source_in: clip.source_in,
            source_out: clip.source_out,
            speed_percent: clip.speed_percent,
            hidden: clip.hidden,
            keyframes: clip.keyframes,
          })),
      })),
    captions: cut.snapshot.captions.map((caption) => ({ row_id: caption.row_id, start_frame: caption.start_frame, end_frame: caption.end_frame, text: caption.text })),
  };
  const checksum = `sha256:${createHash("sha256").update(canonical(body)).digest("hex")}`;
  return { text: JSON.stringify({ ...body, checksum }), checksum };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function stopFailed(id: string): Promise<void> {
  const failed = await one<{ created_at: Date; minutes: number }>("UPDATE exports SET state = 'failed' WHERE id = $1 AND state = 'running' RETURNING created_at, minutes", [id]);
  if (failed) await giveBackMinutes(failed.minutes, failed.created_at.toISOString().slice(0, 7));
  publish(await exportById(id));
}

/** Works one export in ten steps; a second delivery of a running or ended export does nothing. */
async function runExport(message: ExportMessage): Promise<void> {
  const claimed = await one<{ id: string }>("UPDATE exports SET state = 'running' WHERE id = $1 AND state = 'queued' RETURNING id", [message.export_id]);
  if (!claimed) return;
  publish(await exportById(message.export_id));
  for (let step = 1; step <= 10; step += 1) {
    await pause(config.exportStepMs);
    const advanced = await one<{ id: string }>("UPDATE exports SET progress = $2 WHERE id = $1 AND state = 'running' RETURNING id", [message.export_id, step * 10]);
    if (!advanced) return;
    publish(await exportById(message.export_id));
  }
  const row = await one<ExportRow>(`${SELECT} WHERE e.id = $1`, [message.export_id]);
  if (!row || row.state !== "running") return;
  try {
    const manifest = await buildManifest(row);
    const key = `manifests/${row.id}.json`;
    if (!(await headObject(key))) await putObject(key, Buffer.from(manifest.text, "utf8"));
    const done = await one<{ id: string }>(
      `UPDATE exports SET state = 'done', finished_at = now(), manifest_checksum = $2,
         finished_version = (SELECT version FROM projects WHERE id = $3) WHERE id = $1 AND state = 'running' RETURNING id`,
      [row.id, manifest.checksum, row.project_id],
    );
    if (!done) return;
    const finished = await exportById(row.id);
    publish(finished);
    const requester = await one<{ email: string }>("SELECT email FROM people WHERE id = $1", [row.requested_by]);
    if (requester) {
      await queueMail(
        pool,
        requester.email,
        `Gatecut · export ready · ${row.cut_name} · ${row.size}p`,
        `Manifest checksum: ${manifest.checksum}\nProject: ${config.publicUrl}/projects/${row.project_id}\n`,
      );
      kickOutbox();
    }
  } catch (error) {
    if (!(error instanceof StorageDown)) process.stderr.write(`export ${row.id} failed: ${String(error)}\n`);
    await stopFailed(row.id);
  }
}

const REPUBLISH_AFTER_SECONDS = 30;

/** An export committed but never published (a crash in between) is published again; a second delivery does nothing. */
async function republishLost(): Promise<void> {
  const lost = await query<{ id: string; project_id: string; cut_id: string; size: number; requested_by: string }>(
    "SELECT id, project_id, cut_id, size, requested_by FROM exports WHERE state = 'queued' AND created_at < now() - make_interval(secs => $1)",
    [REPUBLISH_AFTER_SECONDS],
  );
  for (const row of lost) await exportQueue.publish({ export_id: row.id, project_id: row.project_id, cut_id: row.cut_id, size: row.size, requested_by: row.requested_by });
}

export function startExports(): void {
  exportQueue.start(runExport);
  setInterval(() => void republishLost().catch(() => undefined), REPUBLISH_AFTER_SECONDS * 1000).unref();
}
