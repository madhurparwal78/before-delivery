import { createHash, randomUUID } from 'node:crypto';
import { COPY, say } from '../../domain/copy.js';
import { matchesAspect, readImageHeader } from '../../domain/imageHeader.js';
import { parseCsv } from '../../domain/csv.js';
import { parseDecimal, isPositive } from '../../domain/rational.js';
import {
  convertFrames,
  convertPlayhead,
  framesFromSeconds,
  FRAME_RATES,
  nominalFrames,
} from '../../domain/timecode.js';
import type { FrameRate } from '../../domain/timecode.js';
import { toInstantText } from '../../domain/time.js';
import { config, FILE_LIMIT } from '../config.js';
import type { Context, RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity, takeUpload } from '../http.js';
import { one, query } from '../infra/db.js';
import { putObject, StoreDown, storeKeys } from '../infra/store.js';
import { requireFile } from '../upload.js';
import { drawingReply } from './drawings.js';
import { FieldCollector, requireNumberParam, requireUuidParam } from '../validate.js';
import {
  addEvent,
  bumpStamp,
  frameJson,
  readBoard,
  readFrames,
  renumberPositions,
  requireJob,
  requireStamp,
  requireWritableJob,
} from './support.js';
import type { FrameRow, JobRow } from './support.js';

const FRAME_FILE_LIMIT = {
  bytes: FILE_LIMIT,
  message: COPY.uploadTooBig,
};

async function job(context: Context): Promise<JobRow> {
  const { desk } = requireIdentity(context);
  return requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
}

async function frameOf(jobId: string, number: number): Promise<FrameRow> {
  const frame = await one<FrameRow>(
    'select * from frames where job_id = $1 and number = $2 and removed_at is null',
    [jobId, number],
  );
  if (!frame) throw refuse.notFound();
  return frame;
}

async function nextFrameNumber(jobId: string): Promise<number> {
  const row = await one<{ next_frame_number: number }>(
    'update jobs set next_frame_number = next_frame_number + 1 where id = $1 returning next_frame_number - 1 as next_frame_number',
    [jobId],
  );
  return row?.next_frame_number ?? 1;
}

/** An accepted file fills the lowest-numbered frame with no drawing. */
async function emptyFrame(jobId: string): Promise<FrameRow | null> {
  return one<FrameRow>(
    `select * from frames where job_id = $1 and removed_at is null and drawing_kind is null
      order by number asc limit 1`,
    [jobId],
  );
}

async function lastPosition(jobId: string): Promise<number> {
  const row = await one<{ last: number | null }>(
    'select max(position) as last from frames where job_id = $1 and removed_at is null',
    [jobId],
  );
  return row?.last ?? 0;
}

export const boardRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/board',
    handler: async (context) => ({ status: 200, body: await readBoard(await job(context)) }),
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/frames',
    body: 'upload',
    uploadLimit: async () => FRAME_FILE_LIMIT,
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = requireWritableJob(await job(context));
      const file = requireFile(takeUpload(context), 'file');
      const header = readImageHeader(file.bytes);
      if (header === null) throw refuse.value(COPY.uploadNotImage);
      if (!matchesAspect(header.width, header.height, held.aspect)) {
        throw refuse.value(say.wrongAspect(header.width, header.height, held.aspect));
      }
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      const repeat = await one<{ number: number }>(
        'select number from frames where job_id = $1 and removed_at is null and sha256 = $2',
        [held.id, sha256],
      );
      if (repeat) throw refuse.value(say.alreadyOnBoard(repeat.number));

      try {
        await putObject(
          storeKeys.frame(held.client_id, held.id, sha256),
          file.bytes,
          header.contentType,
        );
      } catch (error) {
        if (error instanceof StoreDown) throw refuse.unavailable(COPY.storeUnavailable);
        throw error;
      }

      const slot = await emptyFrame(held.id);
      let number: number;
      if (slot) {
        number = slot.number;
        await query(
          'update frames set file_name = $1, width = $2, height = $3, sha256 = $4, drawing_kind = $5 where id = $6',
          [file.fileName, header.width, header.height, sha256, 'stored', slot.id],
        );
      } else {
        number = await nextFrameNumber(held.id);
        await query(
          `insert into frames (id, job_id, number, position, duration_frames, shot, file_name,
                               width, height, sha256, drawing_kind, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'stored',now())`,
          [
            randomUUID(),
            held.id,
            number,
            (await lastPosition(held.id)) + 1,
            nominalFrames(held.frame_rate),
            String(number),
            file.fileName,
            header.width,
            header.height,
            sha256,
          ],
        );
      }
      const stamp = await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameStored', say.fileStored(file.fileName));
      const stored = await frameOf(held.id, number);
      return { status: 201, body: { frame: frameJson(held, stored), stamp } };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/jobs/:id/frames/:number',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const frame = await frameOf(held.id, number);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const durationFrames =
        'durationFrames' in body
          ? fields.wholeNumber(body, 'durationFrames', 1, 1_000_000)
          : frame.duration_frames;
      const actionNote =
        'actionNote' in body ? fields.optionalText(body, 'actionNote') : frame.action_note;
      const audioNote =
        'audioNote' in body ? fields.optionalText(body, 'audioNote') : frame.audio_note;
      fields.done();
      requireWritableJob(held);
      requireStamp(held, body);
      await query(
        'update frames set duration_frames = $1, action_note = $2, audio_note = $3 where id = $4',
        [durationFrames, actionNote, audioNote, frame.id],
      );
      await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameSaved', say.frameSaved(number));
      return { status: 200, body: await readBoard(await requireJob(desk.id, held.id)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/frames/:number/drawing',
    handler: async (context) => {
      const held = await job(context);
      const frame = await frameOf(held.id, requireNumberParam(context.params['number'] ?? ''));
      return drawingReply(held, frame);
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/frames/:number/move',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const frame = await frameOf(held.id, number);
      const frames = await readFrames(held.id);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const position = fields.wholeNumber(body, 'position', 1, frames.length);
      fields.done();
      requireWritableJob(held);
      requireStamp(held, body);
      const others = frames.filter((candidate) => candidate.number !== frame.number);
      others.splice(position - 1, 0, frame);
      for (const [index, moved] of others.entries()) {
        await query('update frames set position = $1 where id = $2', [index + 1, moved.id]);
      }
      await bumpStamp(held.id);
      await addEvent(
        held.id,
        desk.name,
        'frameMoved',
        say.frameMoved(number, position, frames.length),
      );
      return { status: 200, body: await readBoard(await requireJob(desk.id, held.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/frames/:number/duplicate',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const frame = await frameOf(held.id, number);
      const body = await readJsonBody(context);
      requireWritableJob(held);
      requireStamp(held, body);
      const made = await nextFrameNumber(held.id);
      await query('update frames set position = position + 1 where job_id = $1 and removed_at is null and position > $2', [
        held.id,
        frame.position,
      ]);
      await query(
        `insert into frames (id, job_id, number, position, duration_frames, action_note,
                             audio_note, shot, visual, file_name, width, height, sha256,
                             drawing_kind, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
        [
          randomUUID(),
          held.id,
          made,
          frame.position + 1,
          frame.duration_frames,
          frame.action_note,
          frame.audio_note,
          String(made),
          frame.visual,
          frame.file_name,
          frame.width,
          frame.height,
          frame.sha256,
          frame.drawing_kind,
        ],
      );
      await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameDuplicated', say.frameDuplicated(number, made));
      return { status: 201, body: await readBoard(await requireJob(desk.id, held.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/frames/:number/insert-after',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const frame = await frameOf(held.id, number);
      const body = await readJsonBody(context);
      requireWritableJob(held);
      requireStamp(held, body);
      const made = await nextFrameNumber(held.id);
      await query('update frames set position = position + 1 where job_id = $1 and removed_at is null and position > $2', [
        held.id,
        frame.position,
      ]);
      await query(
        `insert into frames (id, job_id, number, position, duration_frames, shot, created_at)
         values ($1,$2,$3,$4,$5,$6,now())`,
        [
          randomUUID(),
          held.id,
          made,
          frame.position + 1,
          nominalFrames(held.frame_rate),
          String(made),
        ],
      );
      await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameInserted', say.frameInserted(made, number));
      return { status: 201, body: await readBoard(await requireJob(desk.id, held.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/frame-rate',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const frameRate = fields.choice(body, 'frameRate', FRAME_RATES);
      const playhead = fields.wholeNumber(body, 'playhead', 0, 10_000_000);
      fields.done();
      requireWritableJob(held);
      requireStamp(held, body);
      const frames = await readFrames(held.id);
      for (const frame of frames) {
        await query('update frames set duration_frames = $1 where id = $2', [
          convertFrames(frame.duration_frames, held.frame_rate, frameRate),
          frame.id,
        ]);
      }
      await query('update jobs set frame_rate = $1 where id = $2', [frameRate, held.id]);
      await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameRateChanged', say.frameRateNow(frameRate));
      const after = await requireJob(desk.id, held.id);
      const board = await readBoard(after);
      const total = board['totalFrames'] as number;
      const moved = Math.min(
        convertPlayhead(playhead, held.frame_rate, frameRate),
        Math.max(0, total - 1),
      );
      return { status: 200, body: { ...board, playhead: moved } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/jobs/:id/removals',
    handler: async (context) => {
      const held = await job(context);
      const removals = await query<{ frame_number: number; position: number; ends_at: Date }>(
        `select frame_number, position, ends_at from removals
          where job_id = $1 and settled_at is null and ends_at > now()
          order by ends_at asc`,
        [held.id],
      );
      return {
        status: 200,
        body: {
          removals: removals.map((removal) => ({
            frame: removal.frame_number,
            position: removal.position,
            endsAt: toInstantText(removal.ends_at),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/removals',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const number = fields.wholeNumber(body, 'frame', 1, 10_000_000);
      fields.done();
      const frame = await frameOf(held.id, number);
      requireWritableJob(held);
      requireStamp(held, body);
      const endsAt = new Date(
        Math.floor(Date.now() / 1000) * 1000 + config.timers.undoSeconds * 1000,
      );
      await query('delete from removals where job_id = $1 and frame_number = $2', [
        held.id,
        number,
      ]);
      await query(
        `insert into removals (id, job_id, frame_number, position, ends_at)
         values ($1,$2,$3,$4,$5)`,
        [randomUUID(), held.id, number, frame.position, endsAt],
      );
      await query('update frames set removed_at = now() where id = $1', [frame.id]);
      await renumberPositions(held.id);
      const stamp = await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameRemoved', say.frameRemoved(number));
      return {
        status: 201,
        body: {
          frame: number,
          position: frame.position,
          endsAt: toInstantText(endsAt),
          stamp,
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/removals/:number/hold',
    handler: async (context) => {
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const removal = await openRemoval(held.id, number);
      const endsAt = new Date(
        Math.floor(Date.now() / 1000) * 1000 + config.timers.undoSeconds * 1000,
      );
      await query('update removals set ends_at = $1 where id = $2', [endsAt, removal.id]);
      return {
        status: 200,
        body: {
          frame: number,
          position: removal.position,
          endsAt: toInstantText(endsAt),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/removals/:number/undo',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = await job(context);
      const number = requireNumberParam(context.params['number'] ?? '');
      const removal = await openRemoval(held.id, number);
      requireWritableJob(held);
      await query(
        'update frames set position = position + 1 where job_id = $1 and removed_at is null and position >= $2',
        [held.id, removal.position],
      );
      await query(
        'update frames set removed_at = null, position = $1 where job_id = $2 and number = $3',
        [removal.position, held.id, number],
      );
      await query('update removals set settled_at = now() where id = $1', [removal.id]);
      await renumberPositions(held.id);
      await bumpStamp(held.id);
      await addEvent(held.id, desk.name, 'frameBack', say.frameBack(number));
      return { status: 200, body: await readBoard(await requireJob(desk.id, held.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/script/preview',
    body: 'upload',
    uploadLimit: async () => FRAME_FILE_LIMIT,
    handler: async (context) => {
      const held = await job(context);
      const file = requireFile(takeUpload(context), 'file');
      const read = readScript(file.bytes, held, await readFrames(held.id));
      return { status: 200, body: { rows: read.rows } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/script',
    body: 'upload',
    uploadLimit: async () => FRAME_FILE_LIMIT,
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const held = requireWritableJob(await job(context));
      const file = requireFile(takeUpload(context), 'file');
      const frames = await readFrames(held.id);
      const read = readScript(file.bytes, held, frames);
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let position = await lastPosition(held.id);

      for (const entry of read.entries) {
        if (entry.result === 'refused') continue;
        const existing = frames.find((frame) => frame.shot === entry.shot);
        if (existing) {
          const same =
            existing.action_note === entry.visual &&
            existing.visual === entry.visual &&
            existing.audio_note === entry.audio &&
            existing.duration_frames === entry.durationFrames;
          if (same) {
            unchanged += 1;
            continue;
          }
          await query(
            `update frames set action_note = $1, visual = $2, audio_note = $3,
                               duration_frames = $4 where id = $5`,
            [entry.visual, entry.visual, entry.audio, entry.durationFrames, existing.id],
          );
          updated += 1;
          continue;
        }
        position += 1;
        await query(
          `insert into frames (id, job_id, number, position, duration_frames, action_note,
                               audio_note, shot, visual, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
          [
            randomUUID(),
            held.id,
            await nextFrameNumber(held.id),
            position,
            entry.durationFrames,
            entry.visual,
            entry.audio,
            entry.shot,
            entry.visual,
          ],
        );
        created += 1;
      }
      if (created > 0 || updated > 0) {
        await bumpStamp(held.id);
        await addEvent(held.id, desk.name, 'scriptSaved', say.scriptSaved(created, updated));
      }
      return {
        status: 200,
        body: {
          created,
          updated,
          unchanged,
          refused: read.entries.filter((entry) => entry.result === 'refused').length,
          rows: read.rows,
        },
      };
    },
  },
];

async function openRemoval(
  jobId: string,
  number: number,
): Promise<{ id: string; position: number }> {
  const removal = await one<{ id: string; position: number; ends_at: Date }>(
    'select id, position, ends_at from removals where job_id = $1 and frame_number = $2',
    [jobId, number],
  );
  if (!removal) throw refuse.notFound();
  if (removal.ends_at.getTime() <= Date.now()) throw refuse.state(COPY.undoPassed);
  return removal;
}

type ScriptRow = { row: number; shot: string; result: string; reason: string | null };

type ScriptEntry = ScriptRow & {
  visual: string;
  audio: string;
  durationFrames: number;
};

/** A refused row never blocks the others, and nothing is saved by a preview. */
function readScript(
  bytes: Buffer,
  held: JobRow,
  frames: readonly FrameRow[],
): { rows: ScriptRow[]; entries: ScriptEntry[] } {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw refuse.value(COPY.scriptNotText);
  }
  const rows = parseCsv(text);
  const header = rows[0];
  if (
    !header ||
    header.length < 4 ||
    header[0] !== 'shot' ||
    header[1] !== 'visual' ||
    header[2] !== 'audio' ||
    header[3] !== 'seconds'
  ) {
    throw refuse.value(COPY.scriptHeader);
  }
  const shotRows = new Map<string, number>();
  const entries: ScriptEntry[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    const rowNumber = index + 2;
    if (row.every((field) => field === '')) continue;
    const shot = row[0] ?? '';
    const visual = row[1] ?? '';
    const audio = row[2] ?? '';
    const seconds = row[3] ?? '';
    const refuseRow = (reason: string): void => {
      entries.push({
        row: rowNumber,
        shot,
        result: 'refused',
        reason,
        visual,
        audio,
        durationFrames: 0,
      });
    };
    if (shot.trim() === '') {
      refuseRow(say.rowShotEmpty(rowNumber));
      continue;
    }
    const firstRow = shotRows.get(shot);
    if (firstRow !== undefined) {
      refuseRow(say.rowShotRepeated(rowNumber, shot, firstRow));
      continue;
    }
    shotRows.set(shot, rowNumber);
    const value = parseDecimal(seconds, '.');
    if (value === null || !isPositive(value)) {
      refuseRow(say.rowSeconds(rowNumber));
      continue;
    }
    entries.push({
      row: rowNumber,
      shot,
      result: frames.some((frame) => frame.shot === shot) ? 'matched' : 'new',
      reason: null,
      visual,
      audio,
      durationFrames: framesFromSeconds(value, held.frame_rate as FrameRate),
    });
  }
  return {
    rows: entries.map((entry) => ({
      row: entry.row,
      shot: entry.shot,
      result: entry.result,
      reason: entry.reason,
    })),
    entries,
  };
}
