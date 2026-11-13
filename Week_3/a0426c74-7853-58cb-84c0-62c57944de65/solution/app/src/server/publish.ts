// Publishing a sheet version: the record takes the next number, both files are stored, and only then is it `published`.
// A failed store rolls the record back, so the number is never used.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { buildScene, sheetSvg } from '../shared/geometry/index.ts';
import { buildSnapshot, flagMarkups } from '../shared/model/index.ts';
import { MINIMUM_ROLE, moveVersion, voidReview } from '../shared/rules.ts';
import type { DrawingState, VersionSnapshot } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { db, type Queryable } from './db.ts';
import { getDrawing, announceXrefVersion } from './drawings.ts';
import { hub } from './live.ts';
import { insertMarkup, markupsOf } from './markups.ts';
import { withOutageText } from './outage.ts';
import { route } from './router.ts';
import { s3 } from './s3.ts';
import { loadSheet } from './sheets.ts';
import { summaryOf, type VersionRow } from './versions.ts';

/**
 * A publish keeps its database transaction open while it waits for storage. At most this many do at once, so storage that hangs
 * (each call gives up after seconds) cannot take all the connections of the pool from everything else.
 */
const MAX_OPEN_PUBLISHES = 4;
let openPublishes = 0;
const waitingPublishes: Array<() => void> = [];

async function withPublishSlot<T>(work: () => Promise<T>): Promise<T> {
  if (openPublishes === MAX_OPEN_PUBLISHES) await new Promise<void>((resume) => waitingPublishes.push(resume));
  else openPublishes += 1;
  try {
    return await work();
  } finally {
    const next = waitingPublishes.shift();
    if (next) next();
    else openPublishes -= 1;
  }
}

export interface PublishedVersion { id: string; number: number; state: 'published'; keys: [string, string] }

const versionKeys = (sheetId: string, number: number): [string, string] => [`versions/${sheetId}/${number}.json`, `versions/${sheetId}/${number}.svg`];

/** The versions a new one replaced: voided ones tell their review area, approved and rejected ones only get `replaced_by`. */
async function replaceOlder(q: Queryable, sheetId: string, version: { id: string; number: number; snapshot: VersionSnapshot }): Promise<VersionRow[]> {
  const older = await q.query<VersionRow>('SELECT * FROM versions WHERE sheet_id = $1 AND number < $2 ORDER BY number FOR UPDATE', [sheetId, version.number]);
  const voided: VersionRow[] = [];
  for (const row of older) {
    const review = voidReview(row.state, row.steps);
    if (review.state === row.state) continue;
    await q.query('UPDATE versions SET state = $2, steps = $3 WHERE id = $1', [row.id, review.state, JSON.stringify(review.steps)]);
    voided.push({ ...row, state: review.state, steps: review.steps });
  }
  await q.query('UPDATE versions SET replaced_by = $2 WHERE sheet_id = $1 AND number < $3 AND replaced_by IS NULL', [sheetId, version.id, version.number]);
  const previous = older.at(-1);
  if (previous) {
    const markups = await markupsOf(previous.id, q);
    const flags = flagMarkups(markups, previous.snapshot.model, version.snapshot.model);
    for (const [i, markup] of markups.entries()) await insertMarkup(q, version.id, markup, flags[i], markup.author);
  }
  return voided;
}

/** Stores the snapshot and the sheet drawing, then makes the version `published` and replaces the older ones. */
export async function publishSheet(drawingId: string, sheetId: string, state: DrawingState): Promise<PublishedVersion> {
  const published = await withPublishSlot(() => db.tx(async (q) => {
    await q.query('SELECT 1 FROM sheets WHERE id = $1 FOR UPDATE', [sheetId]);
    const sheet = await loadSheet(sheetId, q);
    const snapshot = buildSnapshot(state, sheet);
    const snapshotJson = JSON.stringify(snapshot);
    const svg = sheetSvg(sheet, buildScene(state));
    const [{ number }] = await q.query<{ number: number }>('SELECT coalesce(max(number), 0) + 1 AS number FROM versions WHERE sheet_id = $1', [sheet.id]);
    const id = randomUUID();
    await q.query('INSERT INTO versions (id, sheet_id, number, state, snapshot) VALUES ($1, $2, $3, $4, $5)', [id, sheet.id, number, 'publishing', snapshotJson]);
    const keys = versionKeys(sheet.id, number);
    await withOutageText(copy.PUBLISH_OUTAGE, async () => {
      await s3.put(keys[0], Buffer.from(snapshotJson), 'application/json');
      await s3.put(keys[1], Buffer.from(svg), 'image/svg+xml');
    });
    await q.query('UPDATE versions SET state = $2 WHERE id = $1', [id, moveVersion('publishing', 'published')]);
    return { id, number, keys, snapshot, voided: await replaceOlder(q, sheet.id, { id, number, snapshot }) };
  }));
  const row: VersionRow = { id: published.id, sheet_id: sheetId, number: published.number, state: 'published', replaced_by: null, snapshot: published.snapshot, steps: [], stamps: [] };
  hub.broadcast(drawingId, { type: 'version', data: { event: 'published', version: { ...summaryOf(row), sheet_id: sheetId } } });
  for (const voided of published.voided) {
    hub.broadcast(drawingId, {
      type: 'review',
      data: { version_id: voided.id, sheet_id: sheetId, state: voided.state, steps: voided.steps, stamps: summaryOf(voided).stamps, message: copy.reviewVoided(published.number) },
    });
  }
  await announceXrefVersion(drawingId, published.id);
  return { id: published.id, number: published.number, state: 'published', keys: published.keys };
}

route('POST', '/api/sheets/:id/versions', async (ctx) => {
  const { drawingId } = await accessTo(ctx, 'sheet', ctx.params.id, MINIMUM_ROLE.publish);
  const runtime = await getDrawing(drawingId);
  return ctx.reply(201, await publishSheet(drawingId, ctx.params.id, runtime.state));
});
