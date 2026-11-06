import { Router } from 'express';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { type SessionUser, requireUser } from '../http/session.js';
import * as copy from '../../shared/copy.js';
import { chapterById, loadRun, replayRun, runObject } from '../domain/chapters.js';
import { appendEvent } from '../domain/events.js';
import {
  openPartyOf,
  partyObject,
  publishParty,
  removeMember,
  requireParty,
} from '../domain/party.js';
import { requireOwnCharacter, requireCharacterOnServer } from '../domain/characters.js';
import { requirePlayable, scopeByServerId, scopeBySlug } from '../domain/servers.js';
import { newId } from '../util.js';
import { FieldErrors, checkPartyName, onlyFields } from '../validate.js';
import { body, created, ok, route } from './helpers.js';

export const partyRoutes = Router();

partyRoutes.get(
  '/servers/:slug/parties',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const rows = await query<{ id: string }>(
      `SELECT id FROM parties WHERE server_id = $1 AND state = 'open' ORDER BY created_at`,
      [scope.server.id],
    );
    const parties = [];
    for (const row of rows) {
      const object = await partyObject(row.id);
      if (object !== null) parties.push(object);
    }
    ok(res, { parties });
  }),
);

partyRoutes.post(
  '/servers/:slug/parties',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    requirePlayable(scope.server);
    onlyFields(body(req), ['character_id', 'name']);

    const errors = new FieldErrors();
    const name = checkPartyName(errors, body(req).name);
    errors.throwIfAny();
    const character = await requireOwnCharacter(
      scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if ((await openPartyOf(character.id)) !== null) throw fail('already_in_party');

    const id = newId();
    await tx(async (client) => {
      await client.query(
        `INSERT INTO parties (id, server_id, name, state, leader_id)
         VALUES ($1, $2, $3, 'open', $4)`,
        [id, scope.server.id, name, character.id],
      );
      await client.query(
        'INSERT INTO party_members (party_id, server_id, character_id) VALUES ($1, $2, $3)',
        [id, scope.server.id, character.id],
      );
      await publishParty(client, scope.server.id, id);
    });
    created(res, { party: await partyObject(id) });
  }),
);

partyRoutes.post(
  '/parties/:id/members',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['character_id']);
    const located = await locateParty(req.params.id, user);
    requirePlayable(located.scope.server);
    const party = located.party;
    if (party.state !== 'open') throw fail('party_closed');

    const character = await requireOwnCharacter(
      located.scope.server.id,
      String(body(req).character_id ?? ''),
      user.id,
    );
    if ((await openPartyOf(character.id)) !== null) throw fail('already_in_party');

    await tx(async (client) => {
      await client.query(
        `INSERT INTO party_members (party_id, server_id, character_id) VALUES ($1, $2, $3)
         ON CONFLICT (party_id, character_id) DO NOTHING`,
        [party.id, located.scope.server.id, character.id],
      );
      await publishParty(client, located.scope.server.id, party.id);
    });
    ok(res, { party: await partyObject(party.id) });
  }),
);

partyRoutes.delete(
  '/parties/:id/members/:characterId',
  route(async (req, res) => {
    const user = await requireUser(req);
    const located = await locateParty(req.params.id, user);
    const character = await requireCharacterOnServer(
      located.scope.server.id,
      req.params.characterId,
    );
    if (character.user_id !== user.id) throw fail('not_your_character');

    const succession = await tx(async (client) => {
      const outcome = await removeMember(client, located.party, character.id);
      await publishParty(client, located.scope.server.id, located.party.id);
      return outcome;
    });

    if (succession.newLeaderName !== null) {
      const world = await one<{ id: string }>('SELECT world_id AS id FROM characters WHERE id = $1', [
        character.id,
      ]);
      if (world !== null) {
        await appendEvent({
          serverId: located.scope.server.id,
          stream: 'world',
          scopeId: world.id,
          kind: 'world',
          payload: { announcement: copy.newLeader(succession.newLeaderName) },
        });
      }
    }
    ok(res, { party: await partyObject(located.party.id) });
  }),
);

partyRoutes.post(
  '/parties/:id/chapter-runs',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['chapter_id']);
    const located = await locateParty(req.params.id, user);
    requirePlayable(located.scope.server);
    const party = located.party;

    const chapter = chapterById(String(body(req).chapter_id ?? ''));
    if (chapter === null) {
      throw fail('validation', { fields: { chapter_id: 'Choose a published chapter.' } });
    }

    const leader = party.leader_id;
    if (leader === null) throw fail('not_leader');
    const leaderCharacter = await requireCharacterOnServer(located.scope.server.id, leader);
    if (leaderCharacter.user_id !== user.id) throw fail('not_leader');

    const running = await one<{ id: string }>(
      `SELECT id FROM chapter_runs WHERE party_id = $1 AND state <> 'completed'`,
      [party.id],
    );
    if (running !== null) throw fail('run_in_progress');

    const id = newId();
    await tx(async (client) => {
      const members = await client.query<{ character_id: string; x: number; y: number }>(
        `SELECT pm.character_id, c.x, c.y FROM party_members pm
           JOIN characters c ON c.id = pm.character_id
          WHERE pm.party_id = $1 ORDER BY pm.character_id`,
        [party.id],
      );
      await client.query(
        `INSERT INTO chapter_runs (id, server_id, party_id, chapter_id, world_id, state, start_tiles)
         VALUES ($1, $2, $3, $4, $5, 'in_progress', $6)`,
        [
          id,
          located.scope.server.id,
          party.id,
          chapter.id,
          leaderCharacter.world_id,
          JSON.stringify(members.rows),
        ],
      );
      for (const checkpoint of chapter.checkpoints) {
        await client.query(
          `INSERT INTO checkpoints (run_id, server_id, n, name, x, y) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            located.scope.server.id,
            checkpoint.n,
            checkpoint.name,
            checkpoint.x,
            checkpoint.y,
          ],
        );
      }
      await publishParty(client, located.scope.server.id, party.id);
    });

    const run = await loadRun(id);
    if (run === null) throw fail('internal');
    created(res, { run: await runObject(run) });
  }),
);

partyRoutes.get(
  '/chapter-runs/:id',
  route(async (req, res) => {
    const user = await requireUser(req);
    const run = await requireRun(req.params.id, user);
    ok(res, { run: await runObject(run) });
  }),
);

partyRoutes.get(
  '/chapter-runs/:id/replay',
  route(async (req, res) => {
    const user = await requireUser(req);
    const run = await requireRun(req.params.id, user);
    const replayed = await replayRun(run);
    const positions = await query<{ id: string; x: number; y: number }>(
      `SELECT c.id, c.x, c.y FROM characters c
         JOIN party_members pm ON pm.character_id = c.id
        WHERE pm.party_id = $1 ORDER BY c.id`,
      [run.party_id],
    );
    const reached = await query<{ n: number }>(
      'SELECT n FROM checkpoints WHERE run_id = $1 AND reached = true ORDER BY n',
      [run.id],
    );
    const stored = {
      positions: positions.map((row) => ({ character_id: row.id, x: row.x, y: row.y })),
      checkpoints_reached: reached.map((row) => row.n),
    };
    ok(res, {
      run_id: run.id,
      stored,
      replayed,
      match: JSON.stringify(stored) === JSON.stringify(replayed),
    });
  }),
);

interface Located {
  readonly party: Awaited<ReturnType<typeof requireParty>>;
  readonly scope: Awaited<ReturnType<typeof scopeByServerId>>;
}

async function locateParty(id: string, user: SessionUser): Promise<Located> {
  const found = await one<{ server_id: string }>('SELECT server_id FROM parties WHERE id = $1', [
    id,
  ]);
  if (found === null) throw fail('not_found');
  const scope = await scopeByServerId(found.server_id, user);
  return { party: await requireParty(id, found.server_id), scope };
}

async function requireRun(id: string, user: SessionUser) {
  const run = await loadRun(id);
  if (run === null) throw fail('not_found');
  await scopeByServerId(run.server_id, user);
  return run;
}
