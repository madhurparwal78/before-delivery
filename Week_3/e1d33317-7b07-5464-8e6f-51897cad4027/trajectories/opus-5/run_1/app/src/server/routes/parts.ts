import type { PartLayout } from '../../shared/types.js';
import { errors } from '../errors.js';
import type { HttpApp } from '../http/server.js';
import { FieldCollector, asRecord } from '../http/validate.js';
import { canEditStaff, type CollaboratorRow } from '../store/collaborators.js';
import { requireHolds } from '../store/holds.js';
import {
  findPart,
  listParts,
  readPartPage,
  readPartPdf,
  savePartLayout,
  startExtraction,
} from '../store/parts.js';
import { loadScore } from '../store/score.js';

function measureList(
  value: unknown,
  measureCount: number,
): { measures: number[]; valid: boolean } {
  if (!Array.isArray(value)) return { measures: [], valid: false };
  const measures = value as unknown[];
  const valid =
    measures.every(
      (measure) =>
        typeof measure === 'number' &&
        Number.isInteger(measure) &&
        measure >= 1 &&
        measure <= measureCount - 1,
    ) && new Set(measures).size === measures.length;
  return { measures: valid ? (measures as number[]) : [], valid };
}

function ownsWholePart(caller: CollaboratorRow, staffIds: string[]): boolean {
  return staffIds.every((staffId) => canEditStaff(caller, staffId));
}

/** Header values carry bytes, so a part name such as Clarinet in B♭ travels as UTF-8. */
function headerSafe(value: string): string {
  return Buffer.from(value, 'utf8').toString('latin1');
}

export function registerPartRoutes(app: HttpApp): void {
  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/parts',
    auth: 'seat',
    handler: async ({ params }) => ({ json: { parts: await listParts(params.scoreId!) } }),
  });

  app.add({
    method: 'PUT',
    path: '/api/scores/:scoreId/parts/:partId/layout',
    auth: 'seat',
    roles: ['composer', 'copyist'],
    handler: async ({ params, body, caller }) => {
      const scoreId = params.scoreId!;
      const part = await findPart(scoreId, params.partId!);
      const state = await loadScore(scoreId);
      await requireHolds(
        scoreId,
        caller,
        part.staffIds,
        new Map(state.staves.map((staff) => [staff.id, staff.name])),
      );
      const record = asRecord(body);
      const problems = new FieldCollector();
      const limit = `Use measures from 1 to ${state.head.measureCount - 1}, each once.`;
      const systemBreaks = measureList(record.systemBreaks, state.head.measureCount);
      if (!systemBreaks.valid) problems.add('systemBreaks', limit);
      const pageBreaks = measureList(record.pageBreaks, state.head.measureCount);
      if (!pageBreaks.valid) problems.add('pageBreaks', limit);
      problems.throwIfFailed();
      const layout: PartLayout = {
        systemBreaks: [...systemBreaks.measures].sort((a, b) => a - b),
        pageBreaks: [...pageBreaks.measures].sort((a, b) => a - b),
      };
      return { json: { part: await savePartLayout(scoreId, params.partId!, layout) } };
    },
  });

  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/parts/:partId/extract',
    auth: 'seat',
    handler: async ({ params, caller }) => {
      const scoreId = params.scoreId!;
      const part = await findPart(scoreId, params.partId!);
      if (caller.role === 'player' && !ownsWholePart(caller, part.staffIds)) {
        throw errors.forbiddenStaff();
      }
      return { status: 202, json: { part: await startExtraction(scoreId, params.partId!) } };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/parts/:partId/pages/:page',
    auth: 'seat',
    handler: async ({ params }) => {
      const name = params.page!;
      if (!name.endsWith('.svg')) throw errors.notFound();
      const page = Number(name.slice(0, -4));
      if (!Number.isInteger(page) || page < 1) throw errors.notFound();
      const bytes = await readPartPage(params.scoreId!, params.partId!, page);
      if (!bytes) throw errors.notFound();
      return { body: bytes, contentType: 'image/svg+xml' };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/parts/:partId/pdf',
    auth: 'seat',
    handler: async ({ params, caller }) => {
      const scoreId = params.scoreId!;
      const part = await findPart(scoreId, params.partId!);
      if (caller.role === 'player' && !ownsWholePart(caller, part.staffIds)) {
        throw errors.forbiddenStaff();
      }
      const state = await loadScore(scoreId);
      const bytes = await readPartPdf(scoreId, params.partId!);
      if (!bytes) throw errors.notFound();
      return {
        body: bytes,
        contentType: 'application/pdf',
        headers: {
          'content-disposition': headerSafe(
            `attachment; filename="${state.head.title} - ${part.name}.pdf"`,
          ),
        },
      };
    },
  });
}
