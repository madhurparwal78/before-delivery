import type { PoolClient, QueryResultRow } from 'pg';
import { one, query } from '../db/pool.js';
import { fail } from '../errors.js';
import type { PartyObject } from '../../shared/types.js';
import { instant } from '../util.js';
import { appendEvent } from './events.js';

interface PartyRow {
  id: string;
  server_id: string;
  name: string;
  state: 'open' | 'closed';
  leader_id: string | null;
  created_at: Date;
}

export async function requireParty(id: string, serverId: string): Promise<PartyRow> {
  const row = await one<PartyRow>('SELECT * FROM parties WHERE id = $1 AND server_id = $2', [
    id,
    serverId,
  ]);
  if (row === null) throw fail('not_found');
  return row;
}

export async function partyObject(
  partyId: string,
  client?: PoolClient,
): Promise<PartyObject | null> {
  const fetch = async <T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> =>
    client === undefined
      ? await query<T>(sql, params)
      : (await client.query<T>(sql, params as unknown[])).rows;

  const rows = await fetch<PartyRow>('SELECT * FROM parties WHERE id = $1', [partyId]);
  const party = rows[0];
  if (party === undefined) return null;
  const members = await fetch<{ character_id: string; name: string; joined_at: Date }>(
    `SELECT pm.character_id, c.name, pm.joined_at
       FROM party_members pm JOIN characters c ON c.id = pm.character_id
      WHERE pm.party_id = $1 ORDER BY pm.joined_at, pm.character_id`,
    [partyId],
  );
  const run = await fetch<{ id: string }>(
    `SELECT id FROM chapter_runs WHERE party_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [partyId],
  );
  return {
    id: party.id,
    name: party.name,
    state: party.state,
    leader_id: party.leader_id,
    members: members.map((member) => ({
      character_id: member.character_id,
      name: member.name,
      joined_at: instant(member.joined_at),
    })),
    run_id: run[0]?.id ?? null,
  };
}

interface Succession {
  readonly closed: boolean;
  readonly newLeaderId: string | null;
  readonly newLeaderName: string | null;
}

/**
 * Leadership succession, in one place: when the leader leaves, the
 * earliest-joined remaining member leads, and the last member leaving closes
 * the party for good.
 */
export async function removeMember(
  client: PoolClient,
  party: PartyRow,
  characterId: string,
): Promise<Succession> {
  const removed = await client.query(
    'DELETE FROM party_members WHERE party_id = $1 AND character_id = $2 RETURNING character_id',
    [party.id, characterId],
  );
  if (removed.rowCount === 0) throw fail('not_found');

  const left = await client.query<{ character_id: string; name: string }>(
    `SELECT pm.character_id, c.name
       FROM party_members pm JOIN characters c ON c.id = pm.character_id
      WHERE pm.party_id = $1 ORDER BY pm.joined_at, pm.character_id`,
    [party.id],
  );

  if (left.rowCount === 0) {
    await client.query(`UPDATE parties SET state = 'closed', leader_id = NULL WHERE id = $1`, [
      party.id,
    ]);
    return { closed: true, newLeaderId: null, newLeaderName: null };
  }

  if (party.leader_id !== characterId) {
    return { closed: false, newLeaderId: party.leader_id, newLeaderName: null };
  }

  const heir = left.rows[0];
  await client.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [party.id, heir.character_id]);
  return { closed: false, newLeaderId: heir.character_id, newLeaderName: heir.name };
}

export async function publishParty(
  client: PoolClient,
  serverId: string,
  partyId: string,
): Promise<void> {
  const object = await partyObject(partyId, client);
  if (object === null) return;
  await appendEvent(
    { serverId, stream: 'server', scopeId: serverId, kind: 'party', payload: object },
    client,
  );
}

export async function openPartyOf(characterId: string, client?: PoolClient): Promise<PartyRow | null> {
  const sql = `SELECT p.* FROM parties p
                 JOIN party_members pm ON pm.party_id = p.id
                WHERE pm.character_id = $1 AND p.state = 'open'
                LIMIT 1`;
  if (client === undefined) return one<PartyRow>(sql, [characterId]);
  const rows = await client.query<PartyRow>(sql, [characterId]);
  return rows.rows[0] ?? null;
}
