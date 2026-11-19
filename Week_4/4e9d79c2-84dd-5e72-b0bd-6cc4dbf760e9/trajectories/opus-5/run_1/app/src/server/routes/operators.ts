import { Route, assertKnown, jsonBody, pathParam, route } from './router.js';
import {
  PAPER_FILE_LIMIT,
  PAPER_MULTIPART_LIMIT,
  bodyTooLarge,
  invalid,
  notFound,
  providerUnavailable,
} from '../errors.js';
import { copy } from '../copy.js';
import { makeId } from '../db.js';
import { requireDesk } from '../session.js';
import { filePartSize, readMultipart } from '../multipart.js';
import { isDateString } from '../../domain/time.js';
import {
  PAPER_KINDS,
  PaperKind,
  fileTypeOf,
  operatorOf,
  operatorsOf,
  paperFile,
  paperObjectKey,
  refreshDirectory,
  standingFor,
  storePaperRecord,
} from '../data/operators.js';
import { StorageDown, getObject, putObject } from '../providers/storage.js';
import { loadHire } from '../data/hires.js';
import { query } from '../db.js';

function operatorJson(operator: Awaited<ReturnType<typeof operatorsOf>>[number]): Record<string, unknown> {
  return {
    id: operator.id,
    name: operator.name,
    town: operator.town,
    email: operator.email,
    telephone: operator.telephone,
    sizes: operator.sizes,
    listed: operator.listed,
    papers: operator.papers.map((paper) => ({
      kind: paper.kind,
      endsOn: paper.endsOn,
      stored: paper.stored,
      objectKey: paper.objectKey,
    })),
    dbsCheckedOn: operator.dbsCheckedOn,
  };
}

export const operatorRoutes: Route[] = [
  route('GET', '/api/operators', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    ctx.json(200, { operators: (await operatorsOf(desk.id)).map(operatorJson) });
  }),

  route('POST', '/api/operators/refresh', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    await jsonBody(ctx);
    try {
      ctx.json(200, { operators: (await refreshDirectory(desk.id)).map(operatorJson) });
    } catch {
      throw providerUnavailable(copy.directoryFailed, 'directoryProviderDown');
    }
  }),

  route(
    'POST',
    '/api/operators/:id/papers',
    'session',
    async (ctx) => {
      const desk = requireDesk(ctx);
      const operatorId = pathParam(ctx, 'id');
      const raw = await ctx.body(PAPER_MULTIPART_LIMIT);
      const parsed = readMultipart(ctx, raw);
      assertKnown(await operatorOf(desk.id, operatorId));
      const kind = parsed.fields.kind;
      if (!PAPER_KINDS.includes(kind as PaperKind)) {
        throw invalid('Choose a paper.', { kind: 'Choose a paper.' });
      }
      const endsOn = parsed.fields.endsOn;
      if (!isDateString(endsOn)) throw invalid(copy.enterDate, { endsOn: copy.enterDate });
      const file = parsed.files.find((part) => part.name === 'file');
      if (!file) throw invalid(copy.paperWrongType, { file: copy.paperWrongType });
      const contentType = fileTypeOf(file.bytes);
      if (!contentType) throw invalid(copy.paperWrongType, { file: copy.paperWrongType });
      const paperId = makeId('PP');
      const objectKey = paperObjectKey(desk.id, operatorId, kind as PaperKind, paperId);
      try {
        await putObject(objectKey, file.bytes, contentType);
      } catch (trouble) {
        if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
        throw trouble;
      }
      await storePaperRecord(desk.id, operatorId, kind as PaperKind, endsOn, objectKey, contentType, paperId);
      ctx.json(201, { kind, endsOn, stored: true, objectKey });
    },
    {
      limit: PAPER_MULTIPART_LIMIT,
      rate: async (ctx) => {
        const raw = await ctx.body(PAPER_MULTIPART_LIMIT);
        if (filePartSize(ctx, raw) > PAPER_FILE_LIMIT) throw bodyTooLarge();
      },
    },
  ),

  route('GET', '/api/operators/:id/papers/:kind/file', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const operatorId = pathParam(ctx, 'id');
    assertKnown(await operatorOf(desk.id, operatorId));
    const paper = await paperFile(desk.id, operatorId, pathParam(ctx, 'kind'));
    if (!paper) throw notFound();
    try {
      const stored = await getObject(paper.objectKey);
      if (!stored) throw notFound();
      ctx.send(200, stored.body, { 'content-type': paper.contentType });
    } catch (trouble) {
      if (trouble instanceof StorageDown) throw providerUnavailable(copy.fileStoreDown, 'fileStoreDown');
      throw trouble;
    }
  }),

  route('PUT', '/api/operators/:id/dbs', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const operatorId = pathParam(ctx, 'id');
    assertKnown(await operatorOf(desk.id, operatorId));
    const body = await jsonBody(ctx);
    const checkedOn = body.checkedOn;
    if (!isDateString(checkedOn)) throw invalid(copy.enterDate, { checkedOn: copy.enterDate });
    await query('update operators set dbs_checked_on = $3 where desk_id = $1 and id = $2', [
      desk.id,
      operatorId,
      checkedOn,
    ]);
    ctx.json(200, operatorJson(assertKnown(await operatorOf(desk.id, operatorId))));
  }),

  route('GET', '/api/hires/:id/operators', 'session', async (ctx) => {
    const desk = requireDesk(ctx);
    const hire = assertKnown(await loadHire(desk.id, pathParam(ctx, 'id')));
    const operators = await operatorsOf(desk.id);
    ctx.json(200, {
      operators: operators.map((operator) => {
        const standing = standingFor(operator, hire);
        return { id: operator.id, name: operator.name, clear: standing.clear, reason: standing.reason };
      }),
    });
  }),
];
