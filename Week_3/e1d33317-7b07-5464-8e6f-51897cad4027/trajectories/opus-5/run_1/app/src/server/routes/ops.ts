import { errors } from '../errors.js';
import type { HttpApp } from '../http/server.js';
import { FieldCollector, asRecord, queryNumber, stringList } from '../http/validate.js';
import { hub } from '../live/hub.js';
import { canEditStaff } from '../store/collaborators.js';
import { acquireHolds, listHolds, releaseHolds } from '../store/holds.js';
import { applyOperations, readOpsSince } from '../store/ops.js';
import { loadScore } from '../store/score.js';

export function registerOpsRoutes(app: HttpApp): void {
  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/ops',
    auth: 'seat',
    handler: async ({ params, body, caller }) => {
      const record = asRecord(body);
      const seen = typeof record.seen === 'number' ? record.seen : undefined;
      const result = await applyOperations(params.scoreId!, caller, record.ops, seen);
      return {
        json: {
          applied: result.applied,
          duplicates: result.duplicates,
          lamport: result.lamport,
          lastSeq: result.lastSeq,
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/ops',
    auth: 'seat',
    handler: async ({ params, query: search }) => {
      const problems = new FieldCollector();
      const afterSeq = queryNumber(search.get('afterSeq'), 0);
      if (afterSeq === null || afterSeq < 0) problems.add('afterSeq', 'Ask from sequence 0 or more.');
      const limit = queryNumber(search.get('limit'), 200);
      if (limit === null || limit < 1 || limit > 500) {
        problems.add('limit', 'Ask for 1 to 500 operations.');
      }
      problems.throwIfFailed();
      return { json: await readOpsSince(params.scoreId!, afterSeq!, limit!) };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/holds',
    auth: 'seat',
    handler: async ({ params }) => ({ json: { holds: await listHolds(params.scoreId!) } }),
  });

  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/holds',
    auth: 'seat',
    handler: async ({ params, body, caller }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const record = asRecord(body);
      const staffIds = stringList(record.staffIds);
      const problems = new FieldCollector();
      if (staffIds === null || staffIds.length < 1 || staffIds.length > 64) {
        problems.add('staffIds', 'Choose 1 to 64 staves.');
      }
      const known = new Set(state.staves.map((staff) => staff.id));
      if (staffIds && staffIds.some((staffId) => !known.has(staffId))) {
        problems.add('staffIds', 'Unknown staff.');
      }
      if (
        staffIds &&
        !problems.failed &&
        staffIds.some((staffId) => !canEditStaff(caller, staffId))
      ) {
        throw errors.forbiddenStaff();
      }
      const connectionId = record.connectionId;
      if (typeof connectionId !== 'string' || connectionId === '') {
        problems.add('connectionId', 'Unknown connection.');
      } else if (!hub.ownsConnection(caller.id, connectionId)) {
        problems.add('connectionId', 'Unknown connection.');
      }
      problems.throwIfFailed();
      const holds = await acquireHolds(
        scoreId,
        caller,
        staffIds!,
        connectionId as string,
        new Map(state.staves.map((staff) => [staff.id, staff.name])),
      );
      return { status: 201, json: { holds } };
    },
  });

  app.add({
    method: 'DELETE',
    path: '/api/scores/:scoreId/holds',
    auth: 'seat',
    handler: async ({ params, query: search, caller }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const raw = search.get('staffIds') ?? '';
      const staffIds = raw.split(',').filter((value) => value !== '');
      const problems = new FieldCollector();
      if (staffIds.length === 0) problems.add('staffIds', 'Choose 1 to 64 staves.');
      const known = new Set(state.staves.map((staff) => staff.id));
      if (staffIds.some((staffId) => !known.has(staffId))) {
        problems.add('staffIds', 'Unknown staff.');
      }
      problems.throwIfFailed();
      await releaseHolds(scoreId, caller.id, staffIds);
      return { status: 204 };
    },
  });
}
