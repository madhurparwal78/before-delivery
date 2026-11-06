import { randomBytes, randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import type { Language } from '../../domain/privateCopy.js';
import { secondsText, targetFrames, targetText } from '../../domain/timecode.js';
import type { FrameRate } from '../../domain/timecode.js';
import { clockTimeIn, toInstantText } from '../../domain/time.js';
import type { Place, Town } from '../../domain/time.js';
import { one, query } from '../infra/db.js';
import { refuse } from '../http.js';

export type JobRow = {
  id: string;
  desk_id: string;
  client_id: string;
  title: string;
  ad_id: string;
  due_date: Date;
  target_seconds: number;
  frame_rate: FrameRate;
  aspect: string;
  state: string;
  stamp: string;
  next_frame_number: number;
  next_cut_number: number;
  created_at: Date;
  client_name: string;
  client_place: Place;
  client_state: string;
};

export type FrameRow = {
  id: string;
  job_id: string;
  number: number;
  position: number;
  duration_frames: number;
  action_note: string;
  audio_note: string;
  shot: string;
  visual: string;
  file_name: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawing_kind: string | null;
};

export type ClientRow = {
  id: string;
  desk_id: string;
  name: string;
  place: Place;
  state: string;
  closes_at: Date | null;
  erased_at: Date | null;
  created_at: Date;
};

export type ProducerRow = {
  id: string;
  client_id: string;
  name: string;
  email: string;
  town: Town;
  language: Language;
};

export function newStamp(): string {
  return randomBytes(12).toString('hex');
}

export function isoDateText(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(
    value.getUTCMonth() + 1,
  ).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const JOB_SELECT = `
  select j.*, c.name as client_name, c.place as client_place, c.state as client_state
    from jobs j join clients c on c.id = j.client_id
`;

/** An erased client's rows are gone; a desk's id for another desk answers 404. */
export async function findJob(deskId: string, jobId: string): Promise<JobRow | null> {
  return one<JobRow>(`${JOB_SELECT} where j.id = $1 and j.desk_id = $2`, [jobId, deskId]);
}

export async function requireJob(deskId: string, jobId: string): Promise<JobRow> {
  const job = await findJob(deskId, jobId);
  if (!job) throw refuse.notFound();
  return job;
}

/** While closing or erasing, a client's writes answer 409; an archived job too. */
export function requireWritableJob(job: JobRow): JobRow {
  if (job.client_state !== 'active') throw refuse.state(COPY.clientClosing);
  if (job.state === 'archived') throw refuse.state(COPY.jobArchived);
  return job;
}

export async function requireClient(deskId: string, clientId: string): Promise<ClientRow> {
  const client = await one<ClientRow>(
    "select * from clients where id = $1 and desk_id = $2 and state <> 'erased'",
    [clientId, deskId],
  );
  if (!client) throw refuse.notFound();
  return client;
}

export async function requireProducer(
  deskId: string,
  producerId: string,
): Promise<ProducerRow & { client_place: Place; client_name: string }> {
  const producer = await one<ProducerRow & { client_place: Place; client_name: string }>(
    `select p.*, c.place as client_place, c.name as client_name
       from producers p join clients c on c.id = p.client_id
      where p.id = $1 and c.desk_id = $2 and c.state <> 'erased'`,
    [producerId, deskId],
  );
  if (!producer) throw refuse.notFound();
  return producer;
}

export async function readFrames(jobId: string): Promise<FrameRow[]> {
  return query<FrameRow>(
    'select * from frames where job_id = $1 and removed_at is null order by position asc, number asc',
    [jobId],
  );
}

export function frameJson(job: JobRow, frame: FrameRow): Record<string, unknown> {
  const hasDrawing = frame.drawing_kind !== null;
  return {
    number: frame.number,
    position: frame.position,
    durationFrames: frame.duration_frames,
    actionNote: frame.action_note,
    audioNote: frame.audio_note,
    shot: frame.shot,
    visual: frame.visual,
    fileName: hasDrawing ? frame.file_name : null,
    width: hasDrawing ? frame.width : null,
    height: hasDrawing ? frame.height : null,
    sha256: hasDrawing ? frame.sha256 : null,
    drawingUrl: hasDrawing ? `/api/jobs/${job.id}/frames/${frame.number}/drawing` : null,
  };
}

export type Board = Record<string, unknown>;

export async function readBoard(job: JobRow): Promise<Board> {
  const frames = await readFrames(job.id);
  const totalFrames = frames.reduce((sum, frame) => sum + frame.duration_frames, 0);
  const target = targetFrames(job.target_seconds, job.frame_rate);
  return {
    jobId: job.id,
    stamp: job.stamp,
    frameRate: job.frame_rate,
    targetSeconds: job.target_seconds,
    targetFrames: target,
    totalFrames,
    secondsText: secondsText(totalFrames, job.frame_rate),
    targetText: targetText(totalFrames, target),
    frames: frames.map((frame) => frameJson(job, frame)),
  };
}

export function jobJson(job: JobRow): Record<string, unknown> {
  return {
    id: job.id,
    clientId: job.client_id,
    clientName: job.client_name,
    title: job.title,
    adId: job.ad_id,
    dueDate: isoDateText(job.due_date),
    targetSeconds: job.target_seconds,
    frameRate: job.frame_rate,
    aspect: job.aspect,
    state: job.state,
    createdAt: toInstantText(job.created_at),
  };
}

export function clientJson(client: ClientRow): Record<string, unknown> {
  return {
    id: client.id,
    name: client.name,
    place: client.place,
    state: client.state,
    closesAt: client.closes_at === null ? null : toInstantText(client.closes_at),
    createdAt: toInstantText(client.created_at),
  };
}

export function producerJson(producer: ProducerRow): Record<string, unknown> {
  return {
    id: producer.id,
    clientId: producer.client_id,
    name: producer.name,
    email: producer.email,
    town: producer.town,
    language: producer.language,
  };
}

/** Every write on a job adds one event with who, what and when, in order. */
export async function addEvent(
  jobId: string,
  actor: string,
  action: string,
  text: string,
): Promise<void> {
  await query(
    'insert into job_events (id, job_id, at, actor, action, text) values ($1,$2,now(),$3,$4,$5)',
    [randomUUID(), jobId, actor, action, text],
  );
}

/** Any change to the board gives it a new stamp. */
export async function bumpStamp(jobId: string): Promise<string> {
  const stamp = newStamp();
  await query('update jobs set stamp = $1 where id = $2', [stamp, jobId]);
  return stamp;
}

export function requireStamp(job: JobRow, body: Record<string, unknown>): void {
  if (body['stamp'] !== job.stamp) {
    throw refuse.stale(say.staleBoard(clockTimeIn(new Date(), 'amsterdam')));
  }
}

export async function renumberPositions(jobId: string): Promise<void> {
  await query(
    `with ordered as (
        select id, row_number() over (order by position asc, number asc) as place
          from frames where job_id = $1 and removed_at is null
      )
      update frames f set position = ordered.place from ordered where f.id = ordered.id`,
    [jobId],
  );
}

export async function setJobState(job: JobRow, state: string): Promise<void> {
  if (job.state === state || job.state === 'archived') return;
  await query('update jobs set state = $1 where id = $2', [state, job.id]);
}

