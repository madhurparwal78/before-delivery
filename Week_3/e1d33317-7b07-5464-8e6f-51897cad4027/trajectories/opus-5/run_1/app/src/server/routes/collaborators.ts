import { randomUUID } from 'node:crypto';
import { query, transact } from '../db/pool.js';
import { errors } from '../errors.js';
import type { HttpApp } from '../http/server.js';
import { FieldCollector, asRecord, stringList, trimmedName } from '../http/validate.js';
import { broadcast } from '../services/valkey.js';
import {
  collaboratorOf,
  createInvite,
  findCollaborator,
  listCollaborators,
  type CollaboratorRow,
} from '../store/collaborators.js';
import { releaseCollaboratorHolds } from '../store/holds.js';
import { loadScore } from '../store/score.js';

function allStaffIds(staves: { id: string }[]): string[] {
  return staves.map((staff) => staff.id);
}

export function registerCollaboratorRoutes(app: HttpApp): void {
  app.add({
    method: 'GET',
    path: '/api/scores/:scoreId/collaborators',
    auth: 'seat',
    handler: async ({ params, caller }) => {
      const state = await loadScore(params.scoreId!);
      const rows = await listCollaborators(params.scoreId!);
      const visible =
        caller.role === 'player' ? rows.filter((row) => row.status === 'active') : rows;
      return {
        json: {
          collaborators: visible.map((row) => collaboratorOf(row, allStaffIds(state.staves))),
        },
      };
    },
  });

  app.add({
    method: 'POST',
    path: '/api/scores/:scoreId/invites',
    auth: 'seat',
    roles: ['composer'],
    handler: async ({ params, body }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const record = asRecord(body);
      const problems = new FieldCollector();
      const { name, problem } = trimmedName(record.name, 60);
      if (problem) problems.add('name', 'Use 1 to 60 characters.');
      const role = record.role;
      if (role !== 'copyist' && role !== 'player') problems.add('role', 'Choose a role.');
      const staffIds = stringList(record.staffIds) ?? [];
      if (stringList(record.staffIds) === null) problems.add('staffIds', 'Unknown staff.');
      const known = new Set(allStaffIds(state.staves));
      if (staffIds.some((staffId) => !known.has(staffId))) {
        problems.add('staffIds', 'Unknown staff.');
      }
      problems.throwIfFailed();
      const created = await transact((client) =>
        createInvite(client, scoreId, name, role as 'copyist' | 'player', staffIds),
      );
      return {
        status: 201,
        json: {
          collaborator: collaboratorOf(created.row, allStaffIds(state.staves)),
          inviteToken: created.inviteToken,
          inviteUrl: `/i/${created.inviteToken}`,
        },
      };
    },
  });

  app.add({
    method: 'GET',
    path: '/api/invites/:inviteToken',
    auth: 'open',
    handler: async ({ params }) => {
      const rows = await query<CollaboratorRow & { title: string }>(
        `select c.*, s.title from collaborators c join scores s on s.id = c.score_id
         where c.invite_token = $1`,
        [params.inviteToken!],
      );
      const row = rows[0];
      if (!row) throw errors.notFound();
      return {
        json: {
          invite: {
            name: row.name,
            role: row.role,
            status: row.status,
            scoreTitle: row.title,
          },
        },
      };
    },
  });

  app.add({
    method: 'POST',
    path: '/api/invites/:inviteToken/accept',
    auth: 'open',
    handler: async ({ params }) => {
      const token = params.inviteToken!;
      const outcome = await transact(async (client) => {
        const rows = await client.query<CollaboratorRow>(
          'select * from collaborators where invite_token = $1 for update',
          [token],
        );
        const row = rows.rows[0];
        if (!row) throw errors.notFound();
        if (row.status === 'removed') throw errors.inviteRevoked();
        if (row.status === 'active') throw errors.inviteUsed();
        const scoreRows = await client.query<{ lamport: number }>(
          'select lamport from scores where id = $1',
          [row.score_id],
        );
        const seatToken = `seat-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
        const updated = await client.query<CollaboratorRow>(
          `update collaborators set status = 'active', seat_token = $2, acked_lamport = $3
           where id = $1 and status = 'invited' returning *`,
          [row.id, seatToken, scoreRows.rows[0]?.lamport ?? 0],
        );
        const result = updated.rows[0];
        if (!result) throw errors.inviteUsed();
        return { row: result, seatToken };
      });
      const state = await loadScore(outcome.row.score_id);
      const collaborator = collaboratorOf(outcome.row, allStaffIds(state.staves));
      await broadcast.publish(outcome.row.score_id, { type: 'score', score: state.head });
      return { json: { seatToken: outcome.seatToken, collaborator } };
    },
  });

  app.add({
    method: 'PATCH',
    path: '/api/scores/:scoreId/collaborators/:collaboratorId',
    auth: 'seat',
    roles: ['composer'],
    handler: async ({ params, body }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const row = await findCollaborator(scoreId, params.collaboratorId!);
      const record = asRecord(body);
      const problems = new FieldCollector();
      const staffIds = stringList(record.staffIds);
      if (staffIds === null) problems.add('staffIds', 'Unknown staff.');
      const known = new Set(allStaffIds(state.staves));
      if (staffIds && staffIds.some((staffId) => !known.has(staffId))) {
        problems.add('staffIds', 'Unknown staff.');
      }
      if (row.role !== 'player') {
        problems.add('staffIds', 'Only section players have assigned staves.');
      }
      problems.throwIfFailed();
      const updated = await query<CollaboratorRow>(
        'update collaborators set staff_ids = $3::jsonb where score_id = $1 and id = $2 returning *',
        [scoreId, row.id, JSON.stringify(staffIds)],
      );
      const collaborator = collaboratorOf(updated[0]!, allStaffIds(state.staves));
      await broadcast.publish(scoreId, { type: 'score', score: state.head });
      return { json: { collaborator } };
    },
  });

  app.add({
    method: 'DELETE',
    path: '/api/scores/:scoreId/collaborators/:collaboratorId',
    auth: 'seat',
    roles: ['composer'],
    handler: async ({ params }) => {
      const scoreId = params.scoreId!;
      const state = await loadScore(scoreId);
      const row = await findCollaborator(scoreId, params.collaboratorId!);
      if (row.role === 'composer') throw errors.cannotRemoveComposer();
      if (row.status === 'removed') throw errors.alreadyRemoved(row.name);
      const updated = await query<CollaboratorRow>(
        `update collaborators set status = 'removed', seat_token = null
         where score_id = $1 and id = $2 returning *`,
        [scoreId, row.id],
      );
      await releaseCollaboratorHolds(scoreId, row.id);
      await broadcast.publish(scoreId, { type: 'close', collaboratorId: row.id });
      const collaborator = {
        ...collaboratorOf(updated[0]!, allStaffIds(state.staves)),
        status: 'removed' as const,
      };
      return { json: { collaborator } };
    },
  });
}
