import { createHash } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { drawingSvg } from '../../shared/drawing';
import { clockIn, instantText, TOWN_ZONES } from '../../shared/time';
import { convertClip, convertPlayhead, secondsToFrames, type FrameRate } from '../../shared/timecode';
import {
  addHistory, assertJobWritable, roundedNow, boardFrames, boardJson, cutOfJob, frameJson, jobOfDesk, loadJob, newStamp, pathNumber, slateFrames, type CutFrame,
} from '../records';
import { config } from '../config';
import { one, pool, rows, transaction, type Row, type Runner } from '../db';
import { conflict, FRAME_FILE_LIMIT, notFound, ok, refused, route, stale, type Answer, type Context } from '../http';
import { getObject, objectKeys, putObject, storeDown, StoreFailure } from '../s3';
import { checkRate, checkStamp, checkWhole, throwIfAny, type Fields } from '../validate';
import type pg from 'pg';

export function staleBoard(job: Row): ReturnType<typeof stale> {
  return stale(fill(COPY.boardStale, { time: clockIn((job.stamp_at as Date).getTime(), TOWN_ZONES.amsterdam) }));
}

/** Runs one board write under the job's lock, checking the state and the stamp it was read with. */
async function boardWrite<T>(context: Context, stamp: string | null, work: (tx: pg.PoolClient, job: Row) => Promise<T>): Promise<T> {
  return transaction(async (tx) => {
    await tx.query('SELECT 1 FROM jobs WHERE id = $1 FOR UPDATE', [context.found.job?.id ?? context.found.id]);
    const job = await jobOfDesk(tx, context.found.job?.id ?? context.found.id, context.desk.id);
    assertJobWritable(job);
    if (stamp !== null && stamp !== job.stamp) throw staleBoard(job);
    return work(tx, job);
  });
}

async function touchBoard(tx: pg.PoolClient, job: Row, now: number): Promise<void> {
  job.stamp = newStamp();
  job.stamp_at = new Date(now);
  await tx.query('UPDATE jobs SET stamp = $1, stamp_at = $2 WHERE id = $3', [job.stamp, job.stamp_at, job.id]);
}

async function writeOrder(tx: pg.PoolClient, jobId: string, numbers: number[]): Promise<void> {
  for (const [index, number] of numbers.entries()) {
    await tx.query('UPDATE frames SET position = $1 WHERE job_id = $2 AND number = $3', [index + 1, jobId, number]);
  }
}

async function answerBoard(tx: pg.PoolClient, job: Row, status = 200): Promise<Answer> {
  return ok(boardJson(job, await boardFrames(tx, job.id)), status);
}

async function loadFrame(context: Context): Promise<{ job: Row; frame: Row }> {
  const job = await loadJob(context);
  const number = pathNumber(context.params.number);
  const frame = await one(pool, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2 AND removal_ends_at IS NULL', [job.id, number]);
  if (!frame) throw notFound();
  return { job, frame };
}

route('GET', '/api/jobs/:id/board', { load: loadJob }, async ({ found }) => ok(boardJson(found, await boardFrames(pool, found.id))));

// Files ------------------------------------------------------------------------------------------

interface JudgedPicture {
  kind: 'png' | 'jpeg';
  width: number;
  height: number;
}

export function pictureKind(bytes: Buffer): 'png' | 'jpeg' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

function judgePicture(bytes: Buffer): JudgedPicture | null {
  const kind = pictureKind(bytes);
  if (kind === 'png') {
    return bytes.length >= 24 && bytes.subarray(12, 16).toString('latin1') === 'IHDR'
      ? { kind, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : null;
  }
  if (kind === 'jpeg') {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] as number;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { kind, height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
      }
      at += 2 + bytes.readUInt16BE(at + 2);
    }
  }
  return null;
}

function fitsAspect(aspect: string, width: number, height: number): boolean {
  const [across, down] = aspect.split(':').map(Number) as [number, number];
  return width * down === height * across;
}

export function drawingType(bytes: Buffer): string {
  return pictureKind(bytes) === 'jpeg' ? 'image/jpeg' : 'image/png';
}

/** Read before the store and again under the job's lock, so windows sending one file at once land it once. */
async function refuseRepeat(db: Runner, jobId: string, sha256: string): Promise<void> {
  const repeat = await one(db, 'SELECT number FROM frames WHERE job_id = $1 AND sha256 = $2 AND removal_ends_at IS NULL', [jobId, sha256]);
  if (repeat) throw refused(fill(COPY.repeatFile, { number: repeat.number }));
}

route('POST', '/api/jobs/:id/frames', { load: loadJob, body: 'multipart', fileLimit: FRAME_FILE_LIMIT }, async (context) => {
  const { found, file, desk, now } = context;
  if (!file) throw refused(COPY.notImage);
  const picture = judgePicture(file.bytes);
  if (!picture) throw refused(COPY.notImage);
  if (!fitsAspect(found.aspect, picture.width, picture.height)) {
    throw refused(fill(COPY.wrongAspect, { width: picture.width, height: picture.height, aspect: found.aspect }));
  }
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  await refuseRepeat(pool, found.id, sha256);
  assertJobWritable(found);
  try {
    await putObject(objectKeys(found.client_id, found.id).frame(sha256), file.bytes, drawingType(file.bytes));
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
  return boardWrite(context, null, async (tx, job) => {
    await refuseRepeat(tx, job.id, sha256);
    const empty = await one(tx, 'SELECT number FROM frames WHERE job_id = $1 AND file_name IS NULL AND removal_ends_at IS NULL ORDER BY number LIMIT 1', [job.id]);
    let number: number;
    if (empty) {
      number = empty.number;
      await tx.query('UPDATE frames SET file_name = $1, width = $2, height = $3, sha256 = $4, drawing_seed = NULL WHERE job_id = $5 AND number = $6', [
        file.fileName, picture.width, picture.height, sha256, job.id, number,
      ]);
    } else {
      number = await nextNumber(tx, job);
      const count = (await boardFrames(tx, job.id)).length;
      await tx.query(
        `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256)
         VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, $7, $8)`,
        [job.id, number, count + 1, slateFrames(job), file.fileName, picture.width, picture.height, sha256],
      );
    }
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameStored', fill(COPY.stored, { 'file name': file.fileName }), now);
    const frame = await one(tx, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2', [job.id, number]);
    return ok({ frame: frameJson(job.id, frame as Row), stamp: job.stamp }, 201);
  });
});

async function nextNumber(tx: pg.PoolClient, job: Row): Promise<number> {
  const row = await one(tx, 'UPDATE jobs SET next_frame = next_frame + 1 WHERE id = $1 RETURNING next_frame', [job.id]);
  return (row?.next_frame as number) - 1;
}

route('GET', '/api/jobs/:id/frames/:number/drawing', { load: loadJob }, async ({ found, params, query }) => {
  const number = pathNumber(params.number);
  const cutNumber = query.get('cut');
  let held: { sha256: string | null; fileName: string | null; drawingSeed: number | null } | undefined;
  if (cutNumber !== null) {
    const cut = await cutOfJob(pool, found.id, pathNumber(cutNumber));
    held = (cut.frames as CutFrame[]).find((frame) => frame.number === number);
  } else {
    const frame = await one(pool, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2 AND removal_ends_at IS NULL', [found.id, number]);
    if (frame) held = { sha256: frame.sha256, fileName: frame.file_name, drawingSeed: frame.drawing_seed };
  }
  if (!held?.fileName || !held.sha256) throw notFound();
  return drawingAnswer(found.client_id, found.id, held.sha256, held.drawingSeed);
});

export async function drawingBytes(clientId: string, jobId: string, sha256: string, drawingSeed: number | null): Promise<{ data: Buffer; type: string }> {
  if (drawingSeed !== null) return { data: Buffer.from(drawingSvg(drawingSeed)), type: 'image/svg+xml' };
  const data = await getObject(objectKeys(clientId, jobId).frame(sha256));
  return { data, type: drawingType(data) };
}

export async function drawingAnswer(clientId: string, jobId: string, sha256: string, drawingSeed: number | null): Promise<Answer> {
  try {
    return { status: 200, bytes: await drawingBytes(clientId, jobId, sha256, drawingSeed) };
  } catch (error) {
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
}

// Editing ----------------------------------------------------------------------------------------

route('PATCH', '/api/jobs/:id/frames/:number', { load: loadFrame }, async (context) => {
  const { body, found, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  if ('durationFrames' in body) checkWhole(fields, 'durationFrames', body.durationFrames, 1, 'Type a whole number of frames, at least 1.');
  if ('actionNote' in body && typeof body.actionNote !== 'string') fields.actionNote = 'Type a note.';
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const number = found.frame.number as number;
    await tx.query('UPDATE frames SET duration_frames = COALESCE($1, duration_frames), action_note = COALESCE($2, action_note) WHERE job_id = $3 AND number = $4', [
      body.durationFrames ?? null, body.actionNote ?? null, job.id, number,
    ]);
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameSaved', fill(COPY.frameSaved, { number }), now);
    return answerBoard(tx, job);
  });
});

route('POST', '/api/jobs/:id/frames/:number/move', { load: loadFrame }, async (context) => {
  const { body, found, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  const position = checkWhole(fields, 'position', body.position, 1, 'Pick a position on the board.');
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const frames = await boardFrames(tx, job.id);
    const number = found.frame.number as number;
    const order = frames.map((frame) => frame.number as number).filter((value) => value !== number);
    const place = Math.min(position, frames.length);
    order.splice(place - 1, 0, number);
    await writeOrder(tx, job.id, order);
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameMoved', fill(COPY.frameMoved, { number, position: place, count: frames.length }), now);
    return answerBoard(tx, job);
  });
});

route('POST', '/api/jobs/:id/frames/:number/duplicate', { load: loadFrame }, async (context) => {
  const { body, found, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const source = found.frame as Row;
    const number = await nextNumber(tx, job);
    const frames = await boardFrames(tx, job.id);
    await tx.query(
      `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, drawing_seed)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, $10, $11, $12)`,
      [job.id, number, frames.length + 1, source.duration_frames, source.action_note, source.audio_note, source.visual, source.file_name, source.width, source.height, source.sha256, source.drawing_seed],
    );
    const order = frames.map((frame) => frame.number as number);
    order.splice(order.indexOf(source.number) + 1, 0, number);
    await writeOrder(tx, job.id, order);
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameDuplicated', fill(COPY.frameDuplicated, { number: source.number, copy: number }), now);
    return answerBoard(tx, job, 201);
  });
});

route('POST', '/api/jobs/:id/frames/:number/insert-after', { load: loadFrame }, async (context) => {
  const { body, found, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const number = await nextNumber(tx, job);
    const frames = await boardFrames(tx, job.id);
    await tx.query(
      `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual) VALUES ($1, $2, $3, $4, '', '', '', '')`,
      [job.id, number, frames.length + 1, slateFrames(job)],
    );
    const order = frames.map((frame) => frame.number as number);
    order.splice(order.indexOf(found.frame.number) + 1, 0, number);
    await writeOrder(tx, job.id, order);
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameInserted', fill(COPY.frameInserted, { copy: number, number: found.frame.number }), now);
    return answerBoard(tx, job, 201);
  });
});

route('POST', '/api/jobs/:id/frame-rate', { load: loadJob }, async (context) => {
  const { body, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  const frameRate = checkRate(fields, 'frameRate', body.frameRate);
  const playhead = checkWhole(fields, 'playhead', body.playhead, 0, 'Pick a frame.');
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const from = job.frame_rate as FrameRate;
    let total = 0;
    for (const frame of await boardFrames(tx, job.id)) {
      const duration = convertClip(frame.duration_frames, from, frameRate);
      total += duration;
      await tx.query('UPDATE frames SET duration_frames = $1 WHERE job_id = $2 AND number = $3', [duration, job.id, frame.number]);
    }
    await tx.query('UPDATE jobs SET frame_rate = $1 WHERE id = $2', [frameRate, job.id]);
    job.frame_rate = frameRate;
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameRateChanged', fill(COPY.rateChanged, { rate: frameRate }), now);
    const board = await answerBoard(tx, job);
    return ok({ ...(board.json as Row), playhead: convertPlayhead(playhead, total - 1, from, frameRate) });
  });
});

// Removals and the Undo window ---------------------------------------------------------------------



function removalJson(frame: Row): Row {
  return { frame: frame.number, position: frame.removed_position, endsAt: instantText((frame.removal_ends_at as Date).getTime()) };
}

function windowEnd(now: number): Date {
  return new Date(roundedNow(now) + config.undoSeconds * 1000);
}

route('POST', '/api/jobs/:id/removals', { load: loadJob }, async (context) => {
  const { body, desk, now } = context;
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  const number = checkWhole(fields, 'frame', body.frame, 1, 'Pick a frame.');
  throwIfAny(fields);
  return boardWrite(context, stamp, async (tx, job) => {
    const frames = await boardFrames(tx, job.id);
    const frame = frames.find((row) => row.number === number);
    if (!frame) throw notFound();
    await tx.query('UPDATE frames SET position = NULL, removed_position = $1, removal_ends_at = $2 WHERE job_id = $3 AND number = $4', [frame.position, windowEnd(now), job.id, number]);
    await writeOrder(tx, job.id, frames.filter((row) => row.number !== number).map((row) => row.number as number));
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameRemoved', fill(COPY.frameRemoved, { number }), now);
    const removed = await one(tx, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2', [job.id, number]);
    return ok({ ...removalJson(removed as Row), stamp: job.stamp }, 201);
  });
});

route('GET', '/api/jobs/:id/removals', { load: loadJob }, async ({ found, now }) => {
  const open = await rows(pool, 'SELECT * FROM frames WHERE job_id = $1 AND removal_ends_at > $2 ORDER BY removal_ends_at, number', [found.id, new Date(now)]);
  return ok({ removals: open.map(removalJson) });
});

async function loadRemoval(context: Context): Promise<{ job: Row; removal: Row }> {
  const job = await loadJob(context);
  const removal = await one(pool, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2 AND removal_ends_at IS NOT NULL', [job.id, pathNumber(context.params.number)]);
  if (!removal) throw notFound();
  return { job, removal };
}

route('POST', '/api/jobs/:id/removals/:number/hold', { load: loadRemoval, body: 'none' }, async (context) => {
  const { found, now } = context;
  return boardWrite(context, null, async (tx) => {
    const updated = await one(
      tx,
      'UPDATE frames SET removal_ends_at = $1 WHERE job_id = $2 AND number = $3 AND removal_ends_at > $4 RETURNING *',
      [windowEnd(now), found.job.id, found.removal.number, new Date(now)],
    );
    if (!updated) throw conflict(COPY.undoPassed);
    return ok(removalJson(updated));
  });
});

route('POST', '/api/jobs/:id/removals/:number/undo', { load: loadRemoval, body: 'none' }, async (context) => {
  const { found, desk, now } = context;
  return boardWrite(context, null, async (tx, job) => {
    const number = found.removal.number as number;
    const open = await one(tx, 'SELECT * FROM frames WHERE job_id = $1 AND number = $2 AND removal_ends_at > $3', [job.id, number, new Date(now)]);
    if (!open) throw conflict(COPY.undoPassed);
    const order = (await boardFrames(tx, job.id)).map((frame) => frame.number as number);
    order.splice(Math.min((open.removed_position as number) - 1, order.length), 0, number);
    await tx.query('UPDATE frames SET removal_ends_at = NULL, removed_position = NULL WHERE job_id = $1 AND number = $2', [job.id, number]);
    await writeOrder(tx, job.id, order);
    await touchBoard(tx, job, now);
    await addHistory(tx, job.id, desk.name, 'frameBack', fill(COPY.frameBack, { number }), now);
    return answerBoard(tx, job);
  });
});

// Script files -------------------------------------------------------------------------------------

interface ScriptRow {
  row: number;
  shot: string;
  result: 'new' | 'matched' | 'refused';
  reason: string | null;
  visual: string;
  audio: string;
  durationFrames: number;
}

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let at = 0;
  while (at < text.length) {
    const character = text[at] as string;
    if (quoted) {
      if (character === '"' && text[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\n' || (character === '\r' && text[at + 1] === '\n')) {
      if (character === '\r') at += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += character;
    }
    at += 1;
  }
  if (cell !== '' || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

function readScript(bytes: Buffer, frames: Row[], rate: FrameRate): ScriptRow[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw refused(COPY.scriptNotText);
  }
  const records = parseCsv(text.replace(/^﻿/, ''));
  if (records[0]?.join(',') !== 'shot,visual,audio,seconds') throw refused(COPY.scriptHeader);
  const firstRow = new Map<string, number>();
  const answer: ScriptRow[] = [];
  records.slice(1).forEach((record, index) => {
    const row = index + 2;
    if (record.length === 1 && record[0] === '') return;
    const [shot = '', visual = '', audio = '', seconds = ''] = record;
    let reason: string | null = null;
    if (shot.trim() === '') reason = fill(COPY.rowNoShot, { number: row });
    else if (firstRow.has(shot)) reason = fill(COPY.rowRepeat, { number: row, shot, first: firstRow.get(shot) as number });
    else if (!/^\d+(\.\d+)?$/.test(seconds) || !/[1-9]/.test(seconds)) reason = fill(COPY.rowSeconds, { number: row });
    if (shot.trim() !== '' && !firstRow.has(shot)) firstRow.set(shot, row);
    answer.push({
      row,
      shot,
      result: reason ? 'refused' : frames.some((frame) => frame.shot === shot) ? 'matched' : 'new',
      reason,
      visual,
      audio,
      durationFrames: reason ? 0 : secondsToFrames(seconds, rate),
    });
  });
  return answer;
}

const publishedRow = ({ row, shot, result, reason }: ScriptRow) => ({ row, shot, result, reason });

function scriptBytes(context: Context): Buffer {
  if (!context.file) throw refused(COPY.scriptHeader);
  return context.file.bytes;
}

route('POST', '/api/jobs/:id/script/preview', { load: loadJob, body: 'multipart' }, async (context) => {
  const { found } = context;
  const parsed = readScript(scriptBytes(context), await boardFrames(pool, found.id), found.frame_rate);
  return ok({ rows: parsed.map(publishedRow) });
});

route('POST', '/api/jobs/:id/script', { load: loadJob, body: 'multipart' }, async (context) => {
  const { found, desk, now } = context;
  const bytes = scriptBytes(context);
  readScript(bytes, [], found.frame_rate);
  return boardWrite(context, null, async (tx, job) => {
    const frames = await boardFrames(tx, job.id);
    const parsed = readScript(bytes, frames, job.frame_rate);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let position = frames.length;
    for (const row of parsed) {
      if (row.result === 'new') {
        position += 1;
        await tx.query(
          `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual) VALUES ($1, $2, $3, $4, $5, $6, $7, $5)`,
          [job.id, await nextNumber(tx, job), position, row.durationFrames, row.visual, row.audio, row.shot],
        );
        created += 1;
      } else if (row.result === 'matched') {
        const frame = frames.find((held) => held.shot === row.shot) as Row;
        if (frame.visual === row.visual && frame.action_note === row.visual && frame.audio_note === row.audio && frame.duration_frames === row.durationFrames) {
          unchanged += 1;
        } else {
          await tx.query('UPDATE frames SET visual = $1, action_note = $1, audio_note = $2, duration_frames = $3 WHERE job_id = $4 AND number = $5', [
            row.visual, row.audio, row.durationFrames, job.id, frame.number,
          ]);
          updated += 1;
        }
      }
    }
    const refusedCount = parsed.filter((row) => row.result === 'refused').length;
    if (created || updated) {
      await touchBoard(tx, job, now);
      await addHistory(tx, job.id, desk.name, 'scriptSaved', fill(COPY.scriptSaved, { new: created, changed: updated }), now);
    }
    return ok({ created, updated, unchanged, refused: refusedCount, rows: parsed.map(publishedRow) });
  });
});
