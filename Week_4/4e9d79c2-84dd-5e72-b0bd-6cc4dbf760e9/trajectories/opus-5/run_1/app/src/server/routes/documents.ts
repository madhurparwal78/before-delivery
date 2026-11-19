import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import { conflict, gone, invalid, notFound, providerUnavailable, rateLimited } from '../errors.js';
import { copy, documentStored, downloadLimit } from '../copy.js';
import { config } from '../config.js';
import { requireDesk } from '../session.js';
import { instantString, ukTimeRoundedUp } from '../../domain/time.js';
import { DOCUMENT_KINDS, DOCUMENT_LABELS, DocumentKind, DocumentRecord, countRecentDownloads, documentById, documentsOf, markDownload, nextNumbers, oldestDownload } from '../data/documents.js';
import { loadHire } from '../data/hires.js';
import { makeDocument } from '../documents.js';
import { PdfDown } from '../providers/pdf.js';
import { StorageDown, getObject } from '../providers/storage.js';
import { Ctx } from '../http.js';
import { contentDisposition } from '../../domain/text.js';

function documentJson(document: DocumentRecord): Record<string, unknown> {
  return {
    id: document.id,
    kind: document.kind,
    hireId: document.hireId,
    state: document.state,
    number: document.number,
    objectKey: document.objectKey,
    customerName: document.customerName,
    createdAt: instantString(document.createdAt),
    history: document.history,
  };
}

/** Five downloads per desk per window; the sixth is refused with a UK time. */
async function downloadRate(ctx: Ctx): Promise<void> {
  if (!ctx.desk) return;
  const now = Date.now();
  const since = now - config.fileRateWindowSeconds * 1000;
  if ((await countRecentDownloads(ctx.desk.id, since)) < 5) return;
  const oldest = await oldestDownload(ctx.desk.id, since);
  const retryAt = (oldest ?? now) + config.fileRateWindowSeconds * 1000;
  throw rateLimited(downloadLimit(ukTimeRoundedUp(retryAt)), Math.max(1, Math.ceil((retryAt - now) / 1000)));
}

export const documentRoutes: Route[] = [
  route('GET', '/api/documents', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const documents = await documentsOf(desk.id);
    ctx.json(200, { documents: documents.map(documentJson), ...(await nextNumbers(desk.id, Date.now())) });
  }),

  route('POST', '/api/hires/:id/documents', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const body = await jsonBody(ctx);
    const kind = body.kind;
    if (typeof kind !== 'string' || !DOCUMENT_KINDS.includes(kind as DocumentKind)) {
      throw invalid('Choose a kind.', { kind: 'Choose a kind.' });
    }
    const wanted = kind as DocumentKind;
    if (wanted !== 'quote' && !hire.page?.acceptedAt) throw conflict('noAcceptedQuote', copy.noAcceptedQuote);
    try {
      const made = await makeDocument(desk.id, hire, wanted, ctx.desk?.name ?? 'Wayticket');
      ctx.json(201, { ...documentJson(made), announcement: documentStored(DOCUMENT_LABELS[wanted]) });
    } catch (trouble) {
      if (trouble instanceof PdfDown) throw providerUnavailable(copy.pdfServiceDown, 'pdfServiceDown');
      if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
      throw trouble;
    }
  }),

  route('GET', '/api/documents/:id', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.json(200, documentJson(assertKnown(await documentById(desk.id, pathParam(ctx, 'id')))));
  }),

  route(
    'GET',
    '/api/documents/:id/file',
    'session',
    async (ctx) => {
      const desk = requireDesk(ctx);
      const document = assertKnown(await documentById(desk.id, pathParam(ctx, 'id')));
      const hire = await loadHire(desk.id, document.hireId);
      if (hire?.customer.erased) throw gone('pageEnded', copy.notFound);
      if (document.state !== 'stored' || !document.objectKey) throw notFound();
      try {
        const stored = await getObject(document.objectKey);
        if (!stored) throw notFound();
        await markDownload(desk.id, Date.now());
        ctx.send(200, stored.body, {
          'content-type': 'application/pdf',
          'content-disposition': contentDisposition(
            `${DOCUMENT_LABELS[document.kind]} ${document.number ?? document.hireId}.pdf`,
          ),
        });
      } catch (trouble) {
        if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
        throw trouble;
      }
    },
    { rate: downloadRate },
  ),
];
