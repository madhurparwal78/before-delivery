import { randomUUID } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { addHistory, assertJobWritable, roundedNow, boardFrames, boardJson, cutFrameJson, cutJson, cutOfJob, cutSnapshot, loadJob, newStamp, pathNumber, type CutFrame } from '../records';
import { one, pool, rows, transaction, type Row } from '../db';
import { conflict, noContent, ok, route, type Context } from '../http';
import { checkName, checkStamp, throwIfAny, type Fields } from '../validate';
import { staleBoard } from './board';

function unit(count: number, one: string, many: string, number: number): string {
  return count === 1 ? fill(one, { number }) : fill(many, { number, count });
}

/** The difference list, in its published order. */
function differences(older: CutFrame[], newer: CutFrame[]): string[] {
  const oldByNumber = new Map(older.map((frame) => [frame.number, frame]));
  const newNumbers = new Set(newer.map((frame) => frame.number));
  const list: string[] = [];
  for (const frame of [...newer].sort((a, b) => a.position - b.position)) {
    const number = frame.number;
    const before = oldByNumber.get(number);
    if (!before) {
      list.push(fill(COPY.diffNew, { number }));
      continue;
    }
    if (before.position !== frame.position) list.push(fill(COPY.diffMoved, { number, from: before.position, to: frame.position }));
    if (frame.durationFrames < before.durationFrames) list.push(unit(before.durationFrames - frame.durationFrames, COPY.diffShorterOne, COPY.diffShorter, number));
    if (frame.durationFrames > before.durationFrames) list.push(unit(frame.durationFrames - before.durationFrames, COPY.diffLongerOne, COPY.diffLonger, number));
    if (before.sha256 !== frame.sha256) list.push(fill(COPY.diffDrawing, { number }));
  }
  for (const frame of [...older].sort((a, b) => a.number - b.number)) {
    if (!newNumbers.has(frame.number)) list.push(fill(COPY.diffGone, { number: frame.number }));
  }
  return list;
}

function fullCut(jobId: string, cut: Row): Row {
  return { ...cutJson(cut), frames: (cut.frames as CutFrame[]).map((frame) => cutFrameJson(jobId, cut.number, frame)) };
}

async function loadCut(context: Context): Promise<{ job: Row; cut: Row }> {
  const job = await loadJob(context);
  return { job, cut: await cutOfJob(pool, job.id, pathNumber(context.params.number)) };
}

route('GET', '/api/jobs/:id/cuts', { load: loadJob }, async ({ found }) => {
  const cuts = await rows(pool, 'SELECT * FROM cuts WHERE job_id = $1 ORDER BY number', [found.id]);
  return ok({ cuts: cuts.map(cutJson) });
});

route('POST', '/api/jobs/:id/cuts', { load: loadJob }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const name = checkName(fields, 'name', body.name);
  throwIfAny(fields);
  assertJobWritable(found);
  const cut = await transaction(async (tx) => {
    const numbered = await one(tx, 'UPDATE jobs SET next_cut = next_cut + 1 WHERE id = $1 RETURNING next_cut, frame_rate', [found.id]);
    const number = ((numbered as Row).next_cut as number) - 1;
    const made = await one(
      tx,
      'INSERT INTO cuts (id, job_id, number, name, frame_rate, frames, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [randomUUID(), found.id, number, name, (numbered as Row).frame_rate, JSON.stringify(cutSnapshot(await boardFrames(tx, found.id))), new Date(roundedNow(now))],
    );
    await addHistory(tx, found.id, desk.name, 'cutMade', fill(COPY.cutMade, { number }), now);
    return made;
  });
  return ok(cutJson(cut as Row), 201);
});

route('GET', '/api/jobs/:id/cuts/:number', { load: loadCut }, async ({ found }) => ok(fullCut(found.job.id, found.cut)));

route('PATCH', '/api/jobs/:id/cuts/:number', { load: loadCut }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const name = checkName(fields, 'name', body.name);
  throwIfAny(fields);
  assertJobWritable(found.job);
  if (found.cut.signed_off_at) throw conflict(COPY.cutLocked);
  const cut = await one(pool, 'UPDATE cuts SET name = $1 WHERE id = $2 RETURNING *', [name, found.cut.id]);
  await addHistory(pool, found.job.id, desk.name, 'cutRenamed', fill(COPY.cutSaved, { number: found.cut.number }), now);
  return ok(cutJson(cut as Row));
});

route('DELETE', '/api/jobs/:id/cuts/:number', { load: loadCut }, async ({ found, desk, now }) => {
  assertJobWritable(found.job);
  if (found.cut.signed_off_at) throw conflict(COPY.cutLocked);
  await pool.query('DELETE FROM cuts WHERE id = $1', [found.cut.id]);
  await addHistory(pool, found.job.id, desk.name, 'cutDeleted', fill(COPY.cutDeleted, { number: found.cut.number }), now);
  return noContent();
});

route('POST', '/api/jobs/:id/cuts/:number/bring-back', { load: loadCut }, async ({ found, body, desk, now }) => {
  const fields: Fields = {};
  const stamp = checkStamp(fields, body.stamp);
  throwIfAny(fields);
  assertJobWritable(found.job);
  return transaction(async (tx) => {
    const job = await one(tx, 'SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [found.job.id]);
    if (job?.stamp !== stamp) throw staleBoard(job as Row);
    await tx.query('DELETE FROM frames WHERE job_id = $1', [found.job.id]);
    for (const frame of found.cut.frames as CutFrame[]) {
      await tx.query(
        `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, drawing_seed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [found.job.id, frame.number, frame.position, frame.durationFrames, frame.actionNote, frame.audioNote, frame.shot, frame.visual, frame.fileName, frame.width, frame.height, frame.sha256, frame.drawingSeed],
      );
    }
    const updated = { ...found.job, frame_rate: found.cut.frame_rate, stamp: newStamp() };
    await tx.query('UPDATE jobs SET frame_rate = $1, stamp = $2, stamp_at = $3 WHERE id = $4', [updated.frame_rate, updated.stamp, new Date(now), found.job.id]);
    await addHistory(tx, found.job.id, desk.name, 'cutBroughtBack', fill(COPY.cutBack, { number: found.cut.number }), now);
    return ok(boardJson(updated, await boardFrames(tx, found.job.id)));
  });
});

route('GET', '/api/jobs/:id/compare', { load: loadJob }, async ({ found, query }) => {
  const a = await cutOfJob(pool, found.id, pathNumber(query.get('a') ?? undefined));
  const b = await cutOfJob(pool, found.id, pathNumber(query.get('b') ?? undefined));
  const [older, newer] = a.number <= b.number ? [a, b] : [b, a];
  return ok({ differences: differences(older.frames, newer.frames), a: fullCut(found.id, a), b: fullCut(found.id, b) });
});
