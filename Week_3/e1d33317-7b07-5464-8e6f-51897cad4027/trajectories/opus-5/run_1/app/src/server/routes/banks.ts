import { errors } from '../errors.js';
import type { HttpApp } from '../http/server.js';
import { FieldCollector } from '../http/validate.js';
import {
  bankKind,
  listBanks,
  readBankContent,
  storeBank,
  validFileName,
  validRootPitch,
} from '../store/banks.js';
import { loadScore } from '../store/score.js';

export function registerBankRoutes(app: HttpApp): void {
  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/banks',
    auth: 'seat',
    roles: ['composer'],
    body: 'raw',
    handler: async ({ params, query: search, rawBody }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const fileName = search.get('fileName') ?? '';
      const staffId = search.get('staffId') ?? '';
      const root = search.get('root');
      const problems = new FieldCollector();
      if (!validFileName(fileName)) {
        problems.add('fileName', 'Use a plain file name ending in .wav or .sfz.');
      }
      if (!state.staves.some((staff) => staff.id === staffId)) {
        problems.add('staffId', 'Choose a staff.');
      }
      if (root !== null && !validRootPitch(root)) {
        problems.add('root', 'Use a pitch like A4, C#5 or Bb3.');
      }
      problems.throwIfFailed();
      const kind = bankKind(fileName, rawBody);
      const bank = await storeBank(
        scoreId,
        fileName,
        staffId,
        kind === 'wav' ? (root ?? 'A4') : null,
        kind,
        rawBody,
      );
      return { status: 201, json: { bank } };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/banks',
    auth: 'seat',
    handler: async ({ params }) => ({ json: { banks: await listBanks(params.scoreId!) } }),
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/banks/:bankId/content',
    auth: 'seat',
    handler: async ({ params }) => {
      const content = await readBankContent(params.scoreId!, params.bankId!);
      if (!content) throw errors.notFound();
      return {
        body: content.bytes,
        contentType: content.kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8',
      };
    },
  });
}
