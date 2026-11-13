import type { Part, PartError, PartLayout, PartStatus } from '../../shared/types.js';
import { query, one } from '../db/pool.js';
import { embeddedFontFaces, engrave } from '../engrave/service.js';
import { ApiError, errors } from '../errors.js';
import { renderPartPdf } from '../services/gotenberg.js';
import { getObject, objectKeys, putObject } from '../services/s3.js';
import { broadcast } from '../services/valkey.js';
import { loadScore, partOf } from './score.js';

interface PartRow {
  id: string;
  score_id: string;
  name: string;
  status: PartStatus;
  revision: number;
  extracted_at_lamport: number | null;
  page_count: number | null;
  layout: PartLayout;
  extracted_layout: PartLayout | null;
  last_error: string | null;
  ord: number;
}

/** The one place a part's status changes, following the published lifecycle. */
type LifecycleEvent =
  | { kind: 'extract' }
  | { kind: 'pages_stored' }
  | { kind: 'pages_refused' }
  | { kind: 'pdf_stored' }
  | { kind: 'pdf_failed'; reason: PartError };

const LIFECYCLE: Record<PartStatus, Partial<Record<LifecycleEvent['kind'], PartStatus>>> = {
  draft: { extract: 'engraving' },
  engraving: { pages_stored: 'rendering', pages_refused: 'draft' },
  rendering: { pdf_stored: 'ready', pdf_failed: 'pdf_pending' },
  ready: { extract: 'engraving' },
  pdf_pending: { extract: 'engraving', pdf_stored: 'ready', pdf_failed: 'pdf_pending' },
};

function nextStatus(from: PartStatus, event: LifecycleEvent): PartStatus {
  return LIFECYCLE[from][event.kind]!;
}

function canExtract(status: PartStatus): boolean {
  return LIFECYCLE[status].extract !== undefined;
}

async function findRow(scoreId: string, partId: string): Promise<PartRow> {
  const row = await one<PartRow>('select * from parts where score_id = $1 and id = $2', [
    scoreId,
    partId,
  ]);
  if (!row) throw errors.notFound();
  return row;
}

async function publish(scoreId: string, partId: string): Promise<Part> {
  const state = await loadScore(scoreId);
  const part = state.parts.find((candidate) => candidate.id === partId)!;
  await broadcast.publish(scoreId, { type: 'part', part });
  return part;
}

export async function listParts(scoreId: string): Promise<Part[]> {
  const state = await loadScore(scoreId);
  return state.parts;
}

export async function findPart(scoreId: string, partId: string): Promise<Part> {
  const row = await findRow(scoreId, partId);
  const state = await loadScore(scoreId);
  const staffIds = state.staves
    .filter((staff) => staff.partId === partId)
    .map((staff) => staff.id);
  return partOf(row, staffIds, state.head.lamport);
}

export async function savePartLayout(
  scoreId: string,
  partId: string,
  layout: PartLayout,
): Promise<Part> {
  await findRow(scoreId, partId);
  await query('update parts set layout = $3::jsonb where score_id = $1 and id = $2', [
    scoreId,
    partId,
    JSON.stringify(layout),
  ]);
  const part = await publish(scoreId, partId);
  const state = await loadScore(scoreId);
  await broadcast.publish(scoreId, { type: 'score', score: state.head });
  return part;
}

export async function startExtraction(scoreId: string, partId: string): Promise<Part> {
  const row = await findRow(scoreId, partId);
  if (!canExtract(row.status)) throw errors.partBusy(row.name, row.status);
  await query(
    `update parts set status = $3, revision = revision + 1, last_error = null
     where score_id = $1 and id = $2`,
    [scoreId, partId, nextStatus(row.status, { kind: 'extract' })],
  );
  const part = await publish(scoreId, partId);
  void runExtraction(scoreId, partId);
  return part;
}

async function storePages(
  scoreId: string,
  partId: string,
  revision: number,
): Promise<{ pages: string[]; lamport: number } | null> {
  const result = await engrave({ scoreId, view: 'part', partId });
  const fontFaces = await embeddedFontFaces();
  const pages = result.engraving.pages.map((page) => result.engraving.pageSvg(page, fontFaces));
  try {
    for (const [index, svg] of pages.entries()) {
      await putObject(
        objectKeys.partPage(scoreId, partId, revision, index + 1),
        Buffer.from(svg, 'utf8'),
        'image/svg+xml',
      );
    }
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'storage_unavailable') return null;
    throw cause;
  }
  return { pages, lamport: result.lamport };
}

async function runExtraction(scoreId: string, partId: string): Promise<void> {
  const row = await findRow(scoreId, partId);
  const stored = await storePages(scoreId, partId, row.revision);
  if (!stored) {
    await query(
      `update parts set status = $3, last_error = 'storage_unavailable'
       where score_id = $1 and id = $2`,
      [scoreId, partId, nextStatus('engraving', { kind: 'pages_refused' })],
    );
    await publish(scoreId, partId);
    return;
  }
  await query(
    `update parts set status = $3, page_count = $4, extracted_at_lamport = $5,
       extracted_layout = layout where score_id = $1 and id = $2`,
    [
      scoreId,
      partId,
      nextStatus('engraving', { kind: 'pages_stored' }),
      stored.pages.length,
      stored.lamport,
    ],
  );
  await publish(scoreId, partId);
  await renderAndStorePdf(scoreId, partId, row.revision, 'rendering', stored.pages);
}

async function renderAndStorePdf(
  scoreId: string,
  partId: string,
  revision: number,
  from: PartStatus,
  pages: string[],
): Promise<void> {
  const pdf = await renderPartPdf(pages.map((svg) => ({ html: svg })));
  if (!pdf) {
    await failPdf(scoreId, partId, from, 'renderer_unavailable');
    return;
  }
  try {
    await putObject(objectKeys.partPdf(scoreId, partId, revision), pdf, 'application/pdf');
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'storage_unavailable') {
      await failPdf(scoreId, partId, from, 'storage_unavailable');
      return;
    }
    throw cause;
  }
  await query(`update parts set status = $3, last_error = null where score_id = $1 and id = $2`, [
    scoreId,
    partId,
    nextStatus(from, { kind: 'pdf_stored' }),
  ]);
  await publish(scoreId, partId);
}

async function failPdf(
  scoreId: string,
  partId: string,
  from: PartStatus,
  reason: PartError,
): Promise<void> {
  await query('update parts set status = $3, last_error = $4 where score_id = $1 and id = $2', [
    scoreId,
    partId,
    nextStatus(from, { kind: 'pdf_failed', reason }),
    reason,
  ]);
  await publish(scoreId, partId);
}

/** Retries every part waiting on the renderer, from the pages already stored. */
export async function retryPendingPdfs(): Promise<void> {
  const rows = await query<PartRow>(`select * from parts where status = 'pdf_pending'`);
  for (const row of rows) {
    const pages: string[] = [];
    let readable = true;
    for (let page = 1; page <= (row.page_count ?? 0); page += 1) {
      try {
        const bytes = await getObject(
          objectKeys.partPage(row.score_id, row.id, row.revision, page),
        );
        if (!bytes) {
          readable = false;
          break;
        }
        pages.push(bytes.toString('utf8'));
      } catch {
        readable = false;
        break;
      }
    }
    if (!readable || pages.length === 0) continue;
    await renderAndStorePdf(row.score_id, row.id, row.revision, 'pdf_pending', pages);
  }
}

export async function readPartPage(
  scoreId: string,
  partId: string,
  page: number,
): Promise<Buffer | null> {
  const row = await findRow(scoreId, partId);
  return getObject(objectKeys.partPage(scoreId, partId, row.revision, page));
}

export async function readPartPdf(scoreId: string, partId: string): Promise<Buffer | null> {
  const row = await findRow(scoreId, partId);
  if (row.status !== 'ready') throw errors.pdfNotReady(row.name, row.status);
  return getObject(objectKeys.partPdf(scoreId, partId, row.revision));
}
