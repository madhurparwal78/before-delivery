import { randomUUID, createHash } from 'node:crypto';
import { COPY, fill } from '../../shared/copy';
import { printDate, clockRoundedUp, TOWN_ZONES } from '../../shared/time';
import { config } from '../config';
import { one, pool, rows, transaction, type Row } from '../db';
import { editDecisionList, shotList } from '../domain';
import { escapeHtml, renderPdf } from '../gotenberg';
import { conflict, invalid, isUuid, limited, notFound, ok, route, type Context } from '../http';
import { claimEvent, readWindow, releaseEvent, retryAfterSeconds } from '../rate';
import { addHistory, assertJobWritable, moveJobState, roundedNow, cutOfJob, framesWithTimecode, instant, jobOfDesk, licenceHasEnded, loadJob, type CutFrame } from '../records';
import { getObject, objectKeys, putObject, removeQuietly, storeDown, StoreFailure } from '../s3';
import { drawingBytes } from './board';

const DOWNLOAD_LIMIT = 5;

const FILE_NAMES = { boards: 'boards.pdf', editDecisionList: 'edit-decision-list.edl', shotList: 'shot-list.csv' } as const;
const FILE_TYPES = { boards: 'application/pdf', editDecisionList: 'text/plain; charset=us-ascii', shotList: 'text/csv; charset=utf-8' } as const;
type FileKind = keyof typeof FILE_NAMES;

interface PackageFile {
  kind: FileKind;
  fileName: string;
  size: number;
  sha256: string;
  url: string;
}

function packageJson(row: Row): Row {
  return { id: row.id, cut: row.cut, state: row.state, files: row.files, createdAt: instant(row.created_at) };
}

const BOARDS_CSS = `
@page { size: A4 portrait; margin: 10mm; }
body { margin: 0; font-family: 'Source Serif 4', serif; color: #17171a; font-size: 10pt; }
h1 { font-family: 'Libre Franklin', sans-serif; font-size: 13pt; margin: 0 0 4mm; text-transform: uppercase; }
.page { height: 268mm; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 4mm; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
figure { margin: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; break-inside: avoid; }
img { width: 100%; flex: 1 1 auto; min-height: 0; object-fit: contain; border: 0.3mm solid #17171a; }
.empty { flex: 1 1 auto; border: 0.3mm solid #17171a; }
figcaption { padding-top: 1.5mm; overflow-wrap: anywhere; }
b { font-family: 'Libre Franklin', sans-serif; }
.time { font-variant-numeric: tabular-nums; }
`;

async function boardsPdf(job: Row, cut: Row): Promise<Buffer> {
  const frames = framesWithTimecode(cut.frames as CutFrame[], cut.frame_rate);
  const figures: string[] = [];
  for (const { frame, timecodeIn } of frames) {
    const drawing = await drawingBytes(job.client_id, job.id, frame.sha256 as string, frame.drawingSeed);
    const address = `data:${drawing.type};base64,${drawing.data.toString('base64')}`;
    figures.push(`<figure><img src="${address}" alt=""><figcaption><b>${frame.number}</b> <span class="time">${timecodeIn}</span> ${escapeHtml(frame.actionNote)}</figcaption></figure>`);
  }
  const pages: string[] = [];
  for (let at = 0; at < figures.length; at += 6) pages.push(`<div class="page">${figures.slice(at, at + 6).join('')}</div>`);
  return renderPdf(BOARDS_CSS, pages.join(''));
}

route('GET', '/api/jobs/:id/packages', { load: loadJob }, async ({ found }) => {
  const packages = await rows(pool, 'SELECT * FROM packages WHERE job_id = $1 ORDER BY cut', [found.id]);
  return ok({ packages: packages.map(packageJson) });
});

route('POST', '/api/jobs/:id/packages', { load: loadJob }, async ({ found, body, desk, now }) => {
  if (!Number.isInteger(body.cut)) throw invalid({ cut: COPY.pickCut });
  const cut = await cutOfJob(pool, found.id, body.cut);
  const stored = await one(pool, 'SELECT * FROM packages WHERE job_id = $1 AND cut = $2', [found.id, cut.number]);
  if (stored) return ok(packageJson(stored));
  assertJobWritable(found);
  if (!cut.signed_off_at) throw conflict(COPY.onlySigned);
  const missing = framesWithTimecode(cut.frames, cut.frame_rate).find(({ frame }) => !frame.fileName);
  if (missing) throw conflict(fill(COPY.noDrawing, { number: missing.frame.number }));
  const cues = await rows(pool, 'SELECT * FROM cues WHERE job_id = $1 ORDER BY seq', [found.id]);
  const ended = cues.find((cue) => licenceHasEnded(cue.market, cue.until_date, now));
  if (ended) throw conflict(fill(COPY.licenceEndedFor, { title: ended.title, date: printDate(ended.until_date) }));

  const id = randomUUID();
  const keys = objectKeys(found.client_id, found.id);
  const written: string[] = [];
  let contents: Record<FileKind, Buffer>;
  try {
    contents = {
      boards: await boardsPdf(found, cut),
      editDecisionList: Buffer.from(editDecisionList(found.title, cut.frames, cut.frame_rate), 'ascii'),
      shotList: Buffer.from(shotList(cut.frames, cut.frame_rate), 'utf8'),
    };
    for (const kind of Object.keys(FILE_NAMES) as FileKind[]) {
      const key = keys.packageFile(id, FILE_NAMES[kind]);
      written.push(key);
      await putObject(key, contents[kind], FILE_TYPES[kind]);
    }
  } catch (error) {
    await removeQuietly(written);
    if (error instanceof StoreFailure) throw storeDown();
    throw error;
  }
  const files: PackageFile[] = (Object.keys(FILE_NAMES) as FileKind[]).map((kind) => ({
    kind,
    fileName: FILE_NAMES[kind],
    size: contents[kind].length,
    sha256: createHash('sha256').update(contents[kind]).digest('hex'),
    url: `/api/packages/${id}/files/${kind}`,
  }));
  return transaction(async (tx) => {
    const row = await one(
      tx,
      `INSERT INTO packages (id, job_id, cut, state, files, created_at) VALUES ($1, $2, $3, 'ready', $4, $5)
       ON CONFLICT (job_id, cut) DO NOTHING RETURNING *`,
      [id, found.id, cut.number, JSON.stringify(files), new Date(roundedNow(now))],
    );
    if (!row) {
      await removeQuietly(written);
      return ok(packageJson((await one(tx, 'SELECT * FROM packages WHERE job_id = $1 AND cut = $2', [found.id, cut.number])) as Row));
    }
    await moveJobState(tx, found.id, 'delivered');
    await addHistory(tx, found.id, desk.name, 'packageMade', COPY.packageReady, now);
    return ok(packageJson(row), 201);
  });
});

async function loadPackage(context: Context): Promise<{ row: Row; job: Row; kind: FileKind }> {
  const { id, kind } = context.params;
  if (!isUuid(id) || !(kind && kind in FILE_NAMES)) throw notFound();
  const row = await one(pool, 'SELECT p.* FROM packages p JOIN jobs j ON j.id = p.job_id WHERE p.id = $1 AND j.desk_id = $2', [id, context.desk.id]);
  if (!row) throw notFound();
  return { row, job: await jobOfDesk(pool, row.job_id, context.desk.id), kind: kind as FileKind };
}

route(
  'GET',
  '/api/packages/:id/files/:kind',
  {
    rate: async ({ desk, now }) => {
      if (!desk) return;
      const held = await readWindow(`download:${desk.id}`, config.fileRateWindowSeconds, now);
      if (held.count >= DOWNLOAD_LIMIT) {
        throw limited(fill(COPY.tooManyDownloads, { time: clockRoundedUp(held.retryAt, TOWN_ZONES.amsterdam) }), retryAfterSeconds(held.retryAt, now));
      }
    },
    load: loadPackage,
  },
  async ({ found, desk, now }) => {
    const { row, job, kind } = found as { row: Row; job: Row; kind: FileKind };
    const key = `download:${desk.id}`;
    const full = await claimEvent(key, config.fileRateWindowSeconds, DOWNLOAD_LIMIT, now);
    if (full) throw limited(fill(COPY.tooManyDownloads, { time: clockRoundedUp(full.retryAt, TOWN_ZONES.amsterdam) }), retryAfterSeconds(full.retryAt, now));
    try {
      const data = await getObject(objectKeys(job.client_id, job.id).packageFile(row.id, FILE_NAMES[kind]));
      return { status: 200, bytes: { data, type: FILE_TYPES[kind], fileName: FILE_NAMES[kind] } };
    } catch (error) {
      await releaseEvent(key, now);
      if (error instanceof StoreFailure) throw storeDown();
      throw error;
    }
  },
);
