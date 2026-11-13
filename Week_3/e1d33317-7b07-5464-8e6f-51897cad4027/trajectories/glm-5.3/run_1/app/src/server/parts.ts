import { db, repo, engraver, hubFor, broadcastPart, PDF_RETRY_SECONDS } from './routes.js';
import { MINIO } from './services/minio.js';
import { GOTENBERG } from './services/gotenberg.js';
import { partPageKey, partPdfKey } from './keys.js';
import { ScoreModel } from '../domain/scoremodel.js';
import { nextPartStatus } from '../domain/partlifecycle.js';

/**
 * The part extraction pipeline, following the published lifecycle exactly:
 * draft → engraving → rendering → ready, or back to draft when storage
 * refuses the pages, and pdf_pending when the renderer or storage fails.
 */
export async function partPipeline(scoreId: string, partId: string): Promise<void> {
  const part = (await repo.parts(scoreId)).find((p) => p.id === partId);
  if (!part || part.status !== 'engraving') return;
  const hub = await hubFor(scoreId);
  const model = hub.model!;
  const staves = await repo.staves(scoreId);
  const partStaves = staves.filter((s) => s.partId === partId);

  // engrave every page of the part with its stored layout
  const voices = new Map<string, ReturnType<ScoreModel['voiceEvents']>>();
  for (const staff of partStaves) {
    for (const voice of [1, 2]) {
      voices.set(`${staff.id}:${voice}`, model.voiceEvents(staff.id, voice, true, staff.transpose));
    }
  }
  const all = engraver.engrave(
    partStaves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
    voices,
    model.timeSignatures,
    model.measureCount,
    {
      view: 'part',
      partId,
      limit: 16,
      cursor: null,
      systemBreaks: part.layout.systemBreaks,
      pageBreaks: part.layout.pageBreaks,
      maxSystemsPerPage: partStaves.length >= 2 ? 5 : 10,
    },
  );

  // gather all systems by paging through the engraver
  const systems = [...all.systems];
  let cursor = all.nextCursor;
  let guard = 0;
  while (cursor && guard < 200) {
    guard++;
    const next = engraver.engrave(
      partStaves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
      voices,
      model.timeSignatures,
      model.measureCount,
      {
        view: 'part',
        partId,
        limit: 16,
        cursor,
        systemBreaks: part.layout.systemBreaks,
        pageBreaks: part.layout.pageBreaks,
        maxSystemsPerPage: partStaves.length >= 2 ? 5 : 10,
      },
    );
    systems.push(...next.systems);
    cursor = next.nextCursor;
  }

  // group systems into pages
  const pages: { firstMeasure: number; lastMeasure: number; systems: { index: number; svg: string }[] }[] = [];
  for (const sys of systems) {
    const page = pages[sys.page - 1] ?? { firstMeasure: sys.firstMeasure, lastMeasure: sys.lastMeasure, systems: [] };
    page.systems.push({ index: sys.index, svg: sys.svg });
    page.lastMeasure = sys.lastMeasure;
    pages[sys.page - 1] = page;
  }

  // store the SVG pages; storage refusal sends the part back to draft
  const stored: Buffer[] = [];
  for (let i = 0; i < pages.length; i++) {
    const svg = Buffer.from(pages[i].systems.map((s) => s.svg).join('\n'), 'utf8');
    const ok = await MINIO.putObject(partPageKey(scoreId, partId, part.revision, i + 1), svg, 'image/svg+xml');
    if (!ok) {
      await db.query('UPDATE parts SET status = $1, last_error = $2 WHERE score_id = $3 AND id = $4', [
        'draft',
        'storage_unavailable',
        scoreId,
        partId,
      ]);
      await broadcastPart(hub, scoreId, partId);
      return;
    }
    stored.push(svg);
  }
  const toRendering = nextPartStatus('engraving', 'pages_stored')!;
  await db.query('UPDATE parts SET status = $1 WHERE score_id = $2 AND id = $3', [toRendering, scoreId, partId]);
  await db.query('UPDATE parts SET page_count = $1 WHERE score_id = $2 AND id = $3', [pages.length, scoreId, partId]);
  await broadcastPart(hub, scoreId, partId);
  await renderPdf(scoreId, partId, pages.map((p) => p.systems.map((s) => s.svg).join('\n')));
}

async function renderPdf(scoreId: string, partId: string, pageSvgs: string[]): Promise<void> {
  const part = (await repo.parts(scoreId)).find((p) => p.id === partId);
  if (!part || part.status !== 'rendering') return;
  const score = await repo.scoreRow(scoreId);
  const html = pdfHtml(score?.title ?? '', part.name, pageSvgs);
  const pdf = await GOTENBERG.renderPdf(html);
  if (pdf === null) {
    await db.query('UPDATE parts SET status = $1, last_error = $2 WHERE score_id = $3 AND id = $4', [
      'pdf_pending',
      'renderer_unavailable',
      scoreId,
      partId,
    ]);
    await broadcastPart(await hubFor(scoreId), scoreId, partId);
    return;
  }
  const stored = await MINIO.putObject(partPdfKey(scoreId, partId, part.revision), pdf, 'application/pdf');
  if (!stored) {
    await db.query('UPDATE parts SET status = $1, last_error = $2 WHERE score_id = $3 AND id = $4', [
      'pdf_pending',
      'storage_unavailable',
      scoreId,
      partId,
    ]);
    await broadcastPart(await hubFor(scoreId), scoreId, partId);
    return;
  }
  const toReady = nextPartStatus('rendering', 'pdf_stored')!;
  await db.query('UPDATE parts SET status = $1, last_error = null WHERE score_id = $2 AND id = $3', [toReady, scoreId, partId]);
  await broadcastPart(await hubFor(scoreId), scoreId, partId);
}

function pdfHtml(scoreTitle: string, partName: string, pageSvgs: string[]): string {
  const pages = pageSvgs
    .map(
      (svg, i) =>
        `<div${i === 0 ? '' : ' style="page-break-before:always"'}><div style="font-family: Georgia, serif; font-size: 18pt; text-align: center; margin-bottom: 8pt">${escapeHtml(
          scoreTitle,
        )} — ${escapeHtml(partName)}</div><img style="width: 8in; max-height: 10.4in" src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}"></div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: 9in 12in; margin: 0.5in; }</style></head><body>${pages}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Retries every pdf_pending part on the published interval. */
export function startPdfRetryLoop(): NodeJS.Timeout {
  return setInterval(() => {
    void retryPendingParts();
  }, PDF_RETRY_SECONDS * 1000);
}

export async function retryPendingParts(): Promise<void> {
  const scoreIds = await db.query('SELECT DISTINCT score_id FROM parts WHERE status = $1', ['pdf_pending']);
  for (const row of scoreIds.rows as { score_id: string }[]) {
    const parts = (await repo.parts(row.score_id)).filter((p) => p.status === 'pdf_pending');
    const hub = await hubFor(row.score_id);
    const model = hub.model!;
    const staves = await repo.staves(row.score_id);
    for (const part of parts) {
      const partStaves = staves.filter((s) => s.partId === part.id);
      const voices = new Map<string, ReturnType<ScoreModel['voiceEvents']>>();
      for (const staff of partStaves) {
        for (const voice of [1, 2]) {
          voices.set(`${staff.id}:${voice}`, model.voiceEvents(staff.id, voice, true, staff.transpose));
        }
      }
      const all = engraver.engrave(
        partStaves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
        voices,
        model.timeSignatures,
        model.measureCount,
        {
          view: 'part',
          partId: part.id,
          limit: 16,
          cursor: null,
          systemBreaks: part.layout.systemBreaks,
          pageBreaks: part.layout.pageBreaks,
          maxSystemsPerPage: partStaves.length >= 2 ? 5 : 10,
        },
      );
      const systems = [...all.systems];
      let cursor = all.nextCursor;
      while (cursor) {
        const next = engraver.engrave(
          partStaves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
          voices,
          model.timeSignatures,
          model.measureCount,
          {
            view: 'part',
            partId: part.id,
            limit: 16,
            cursor,
            systemBreaks: part.layout.systemBreaks,
            pageBreaks: part.layout.pageBreaks,
            maxSystemsPerPage: partStaves.length >= 2 ? 5 : 10,
          },
        );
        systems.push(...next.systems);
        cursor = next.nextCursor;
      }
      const pages: string[][] = [];
      for (const sys of systems) {
        (pages[sys.page - 1] ??= []).push(sys.svg);
      }
      const score = await repo.scoreRow(row.score_id);
      const html = pdfHtml(score?.title ?? '', part.name, pages.map((p) => p.join('\n')));
      const pdf = await GOTENBERG.renderPdf(html);
      if (pdf !== null) {
        const stored = await MINIO.putObject(partPdfKey(row.score_id, part.id, part.revision), pdf, 'application/pdf');
        if (stored) {
          await db.query('UPDATE parts SET status = $1, last_error = null WHERE score_id = $2 AND id = $3', ['ready', row.score_id, part.id]);
          await broadcastPart(hub, row.score_id, part.id);
        } else {
          await db.query('UPDATE parts SET last_error = $1 WHERE score_id = $2 AND id = $3', ['storage_unavailable', row.score_id, part.id]);
        }
      } else {
        await db.query('UPDATE parts SET last_error = $1 WHERE score_id = $2 AND id = $3', ['renderer_unavailable', row.score_id, part.id]);
      }
    }
  }
}

