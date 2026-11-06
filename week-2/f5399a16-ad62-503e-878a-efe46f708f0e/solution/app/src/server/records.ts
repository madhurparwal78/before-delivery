// The desk's records: loading them with their ownership checks, and their published JSON shapes.

import { randomUUID } from 'node:crypto';
import { COPY, fill, type Language } from '../shared/copy';
import { foldedKey } from '../shared/fold';
import { dateIn, daysBetween, instantText, printDate, TOWN_ZONES, type Town } from '../shared/time';
import { nominalFrames, secondsText, targetFrames, targetText, timecode, type FrameRate } from '../shared/timecode';
import { one, pool, rows, type Row, type Runner } from './db';
import { conflict, isUuid, notFound, type Context } from './http';

export const JOB_SELECT = `SELECT j.*, c.name AS client_name, c.state AS client_state, c.closes_at AS client_closes_at, c.place AS client_place FROM jobs j JOIN clients c ON c.id = j.client_id`;

export function instant(value: Date | null | undefined): string | null {
  return value ? instantText(value.getTime()) : null;
}

/** Whole seconds: every stored instant that is printed or compared to its printed form. */
export function roundedNow(at: number): number {
  return at - (at % 1000);
}

/** The wait ends exactly at closesAt, whatever the sweeper has got to. */
export function clientState(client: Row, now: number): string {
  if (client.state === 'closing' && client.closes_at.getTime() <= now) return 'erasing';
  return client.state as string;
}

export function clientJson(client: Row, now: number): Row {
  return {
    id: client.id,
    name: client.name,
    place: client.place,
    state: clientState(client, now),
    closesAt: instant(client.closes_at),
    createdAt: instant(client.created_at),
  };
}

export function producerJson(producer: Row): Row {
  return { id: producer.id, clientId: producer.client_id, name: producer.name, email: producer.email, town: producer.town, language: producer.language };
}

export function jobJson(job: Row): Row {
  return {
    id: job.id,
    clientId: job.client_id,
    clientName: job.client_name,
    title: job.title,
    adId: job.ad_id,
    dueDate: job.due_date,
    targetSeconds: job.target_seconds,
    frameRate: job.frame_rate,
    aspect: job.aspect,
    state: job.state,
    createdAt: instant(job.created_at),
  };
}

export async function loadClient(context: Context): Promise<Row> {
  const id = context.params.id;
  if (!isUuid(id)) throw notFound();
  const client = await one(pool, `SELECT * FROM clients WHERE id = $1 AND desk_id = $2 AND state <> 'erased'`, [id, context.desk.id]);
  if (!client) throw notFound();
  return client;
}

export async function jobOfDesk(db: Runner, jobId: string | undefined, deskId: string): Promise<Row> {
  if (!isUuid(jobId)) throw notFound();
  const job = await one(db, `${JOB_SELECT} WHERE j.id = $1 AND j.desk_id = $2 AND c.state <> 'erased'`, [jobId, deskId]);
  if (!job) throw notFound();
  return job;
}

export async function loadJob(context: Context): Promise<Row> {
  return jobOfDesk(pool, context.params.id, context.desk.id);
}

/** Refuses a write under a client that is closing or on an archived job. */
export function assertJobWritable(job: Row): void {
  if (job.client_state !== 'active') throw conflict(COPY.clientClosing);
  assertNotArchived(job);
}

export function assertNotArchived(job: Row): void {
  if (job.state === 'archived') throw conflict(COPY.jobIsArchived);
}

/** The one place a job changes state: an archived job stays archived, and only a draft goes in review. */
export async function moveJobState(db: Runner, jobId: string, to: 'inReview' | 'signedOff' | 'delivered' | 'archived'): Promise<void> {
  const from = to === 'inReview' ? `state = 'draft'` : to === 'archived' ? 'true' : `state <> 'archived'`;
  await db.query(`UPDATE jobs SET state = $1 WHERE id = $2 AND ${from}`, [to, jobId]);
}

/** A desk id for another desk's producer, in a body, answers like an unknown one. */
export async function producerOfDesk(db: Runner, producerId: unknown, deskId: string): Promise<Row> {
  if (!isUuid(producerId)) throw notFound();
  const producer = await one(
    db,
    `SELECT p.*, c.state AS client_state, c.id AS owner_client FROM producers p JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1 AND c.desk_id = $2 AND c.state <> 'erased'`,
    [producerId, deskId],
  );
  if (!producer) throw notFound();
  return producer;
}

export async function addHistory(db: Runner, jobId: string, actor: string, action: string, text: string, now: number): Promise<void> {
  await db.query('INSERT INTO history (job_id, at, actor, action, text) VALUES ($1, $2, $3, $4, $5)', [jobId, new Date(now), actor, action, text]);
}

export function newStamp(): string {
  return randomUUID();
}

interface FrameJson {
  number: number;
  position: number;
  durationFrames: number;
  actionNote: string;
  audioNote: string;
  shot: string;
  visual: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  drawingUrl: string | null;
}

/** A frame kept in a cut: the published fields plus the seed of a generated drawing. */
export interface CutFrame extends Omit<FrameJson, 'drawingUrl'> {
  drawingSeed: number | null;
}

export function frameJson(jobId: string, frame: Row): FrameJson {
  return {
    number: frame.number,
    position: frame.position,
    durationFrames: frame.duration_frames,
    actionNote: frame.action_note,
    audioNote: frame.audio_note,
    shot: frame.shot,
    visual: frame.visual,
    fileName: frame.file_name,
    width: frame.width,
    height: frame.height,
    sha256: frame.sha256,
    drawingUrl: frame.file_name ? `/api/jobs/${jobId}/frames/${frame.number}/drawing` : null,
  };
}

export async function boardFrames(db: Runner, jobId: string): Promise<Row[]> {
  return rows(db, 'SELECT * FROM frames WHERE job_id = $1 AND removal_ends_at IS NULL ORDER BY position', [jobId]);
}

export function boardJson(job: Row, frames: Row[]): Row {
  const rate = job.frame_rate as FrameRate;
  const totalFrames = frames.reduce((sum, frame) => sum + (frame.duration_frames as number), 0);
  const target = targetFrames(rate, job.target_seconds);
  return {
    jobId: job.id,
    stamp: job.stamp,
    frameRate: rate,
    targetSeconds: job.target_seconds,
    targetFrames: target,
    totalFrames,
    secondsText: secondsText(totalFrames, rate),
    targetText: targetText(totalFrames, target),
    frames: frames.map((frame) => frameJson(job.id, frame)),
  };
}

export function cutSnapshot(frames: Row[]): CutFrame[] {
  return frames.map((frame) => ({
    number: frame.number,
    position: frame.position,
    durationFrames: frame.duration_frames,
    actionNote: frame.action_note,
    audioNote: frame.audio_note,
    shot: frame.shot,
    visual: frame.visual,
    fileName: frame.file_name,
    width: frame.width,
    height: frame.height,
    sha256: frame.sha256,
    drawingSeed: frame.drawing_seed,
  }));
}

export function cutJson(cut: Row): Row {
  return {
    id: cut.id,
    number: cut.number,
    name: cut.name,
    frameRate: cut.frame_rate,
    createdAt: instant(cut.created_at),
    signedOffAt: instant(cut.signed_off_at),
    signedOffBy: cut.signed_off_by,
  };
}

export function cutFrameJson(jobId: string, cutNumber: number, frame: CutFrame): FrameJson {
  const { drawingSeed: _seed, ...published } = frame;
  return { ...published, drawingUrl: frame.fileName ? `/api/jobs/${jobId}/frames/${frame.number}/drawing?cut=${cutNumber}` : null };
}

export async function cutOfJob(db: Runner, jobId: string, number: unknown): Promise<Row> {
  if (!Number.isInteger(number)) throw notFound();
  const cut = await one(db, 'SELECT * FROM cuts WHERE job_id = $1 AND number = $2', [jobId, number]);
  if (!cut) throw notFound();
  return cut;
}

export function pathNumber(value: string | undefined): number {
  return value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) : -1;
}

/** Frames of a cut, position order, each with the timecode it starts at. */
export function framesWithTimecode(frames: CutFrame[], rate: FrameRate): { frame: CutFrame; timecodeIn: string; startFrame: number }[] {
  let start = 0;
  return [...frames].sort((a, b) => a.position - b.position).map((frame) => {
    const entry = { frame, timecodeIn: timecode(start, rate), startFrame: start };
    start += frame.durationFrames;
    return entry;
  });
}

/** Licence state counts dates in the market's local wall time. */
const MARKET_TOWNS: Record<string, Town> = { NL: 'amsterdam', US: 'newYork', CA: 'toronto', AE: 'dubai' };

function licenceDays(market: string, until: string, now: number): number {
  return daysBetween(dateIn(now, TOWN_ZONES[MARKET_TOWNS[market] as Town]), until);
}

function licenceText(market: string, until: string, now: number): string {
  const days = licenceDays(market, until, now);
  if (days < 0) return fill(COPY.licenceEnded, { date: printDate(until) });
  if (days === 0) return COPY.licenceToday;
  if (days === 1) return COPY.licenceOneDay;
  return fill(COPY.licenceDays, { count: days });
}

export function licenceHasEnded(market: string, until: string, now: number): boolean {
  return licenceDays(market, until, now) < 0;
}

export function cueJson(cue: Row, now: number): Row {
  return {
    id: cue.id,
    trackId: cue.track_id,
    title: cue.title,
    composer: cue.composer,
    seconds: cue.seconds,
    market: cue.market,
    from: cue.from_date,
    until: cue.until_date,
    fee: cue.fee,
    licenceId: cue.licence_id,
    licenceText: licenceText(cue.market, cue.until_date, now),
  };
}

export function nameMatches(typed: string, held: string): boolean {
  return foldedKey(typed.trim()) === foldedKey(held);
}

export function languageOf(producer: Row): Language {
  return producer.language as Language;
}

/** One nominal second of a job's rate: the length of a new slate. */
export function slateFrames(job: Row): number {
  return nominalFrames(job.frame_rate as FrameRate);
}

export function isUuidList(values: unknown[]): values is string[] {
  return values.every(isUuid);
}
