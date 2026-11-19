import { query, transaction, type DBClient } from './db.js';
import { partyMemberConnection, isAccountOnline } from './presence.js';
import { sessionState } from './world.js';

export type PartyRow = {
  id: string;
  status: 'forming' | 'ready_check' | 'in_session' | 'member_dropped' | 'chapter_complete';
  leader_id: string;
  story_id: string;
  ready_check: { deadline_at: number; started_at: number; members_at_start: string[]; responses: Record<string, 'ready' | 'not_ready' | 'pending'> } | null;
  session_id: string | null;
  created_at: Date;
};

export type PartyMemberRow = {
  account_id: string;
  party_id: string;
  joined_at: Date;
  display_name: string;
};

export type ReadyCheck = {
  deadline_at: number;
  remaining_seconds: number;
  responses: Record<string, 'ready' | 'not_ready' | 'pending'>;
};

export function partyJson(party: PartyRow, members: PartyMemberRow[]): Record<string, unknown> {
  const now = Date.now() / 1000;
  let readyCheck: ReadyCheck | null = null;
  if (party.ready_check) {
    // Whole seconds rounded up, computed from the server's own clock.
    const remaining = Math.max(0, Math.ceil(party.ready_check.deadline_at - now));
    readyCheck = {
      deadline_at: party.ready_check.deadline_at,
      remaining_seconds: remaining,
      responses: Object.fromEntries(
        members.map((m) => [m.account_id, (party.ready_check?.responses ?? {})[m.account_id] ?? 'pending']),
      ),
    };
  }
  return {
    id: party.id,
    status: party.status,
    leader_id: party.leader_id,
    story_id: party.story_id,
    members: members.map((m) => {
      const connection = partyMemberConnection(m.account_id, party.session_id);
      return {
        account_id: m.account_id,
        display_name: m.display_name,
        joined_at: m.joined_at.toISOString(),
        connection,
        grace_remaining_seconds: connection === 'dropped' ? graceRemaining(m.account_id, party.session_id) : null,
      };
    }),
    ready_check: readyCheck,
    session_id: party.session_id,
    progress: null,
  };
}

function graceRemaining(accountId: string, sessionId: string | null): number | null {
  if (!sessionId) return null;
  const member = sessionState(sessionId)?.members.find((m) => m.account_id === accountId);
  if (!member || member.status !== 'dropped' || !member.graceUntil) return null;
  return Math.max(0, Math.ceil((member.graceUntil - Date.now()) / 1000));
}



export async function partyById(id: string): Promise<PartyRow | null> {
  const res = await query<PartyRow>(
    'select id, status, leader_id, story_id, ready_check, session_id, created_at from parties where id = $1',
    [id],
  );
  return res.rows[0] ?? null;
}

export async function partyMembers(partyId: string): Promise<PartyMemberRow[]> {
  const res = await query<PartyMemberRow>(
    `select pm.account_id, pm.party_id, pm.joined_at, a.display_name
       from party_members pm join accounts a on a.id = pm.account_id
      where pm.party_id = $1 order by pm.joined_at, pm.account_id`,
    [partyId],
  );
  return res.rows;
}

export async function isMember(partyId: string, accountId: string): Promise<boolean> {
  const res = await query('select 1 from party_members where party_id = $1 and account_id = $2', [partyId, accountId]);
  return res.rows.length > 0;
}

export async function partyForAccount(accountId: string): Promise<PartyRow | null> {
  const res = await query<PartyRow>(
    `select p.id, p.status, p.leader_id, p.story_id, p.ready_check, p.session_id, p.created_at
       from parties p join party_members pm on pm.party_id = p.id
      where pm.account_id = $1`,
    [accountId],
  );
  return res.rows[0] ?? null;
}

/** Leader succession: the remaining member with the earliest join time (DP-41). */
export async function ensureLeaderOnLeave(party: PartyRow, leaverId: string): Promise<string | null> {
  const res = await query<{ account_id: string }>(
    `select account_id from party_members where party_id = $1 and account_id <> $2 order by joined_at, account_id limit 1`,
    [party.id, leaverId],
  );
  const next = res.rows[0]?.account_id;
  if (next) {
    await query('update parties set leader_id = $1 where id = $2', [next, party.id]);
    return next;
  }
  return null;
}

export type SystemLine = { code: string; params: Record<string, string> };

export async function postSystemLine(client: DBClient | null, channel: string, code: string, params: Record<string, string>): Promise<void> {
  const { appendChatMessage } = await import('./chat.js');
  await appendChatMessage(client, channel, { kind: 'system', code, params });
}

export async function leaveParty(partyId: string, accountId: string, displayName: string): Promise<void> {
  const party = await partyById(partyId);
  if (!party) return;
  const wasLeader = party.leader_id === accountId;
  const members = await partyMembers(partyId);
  const { postSystemLine } = await import('./party-lines.js');
  await transaction(async (client) => {
    await client.query('delete from party_members where party_id = $1 and account_id = $2', [partyId, accountId]);
    const remaining = await client.query<{ account_id: string }>(
      'select account_id from party_members where party_id = $1',
      [partyId],
    );
    if (remaining.rows.length === 0) {
      await client.query('delete from parties where id = $1', [partyId]);
      await client.query("update invites set status = 'closed' where party_id = $1", [partyId]);
      return;
    }
    if (wasLeader) {
      const next = await client.query<{ account_id: string }>(
        'select account_id from party_members where party_id = $1 order by joined_at, account_id limit 1',
        [partyId],
      );
      const nextLeader = next.rows[0]?.account_id;
      if (nextLeader) {
        await client.query('update parties set leader_id = $1 where id = $2', [nextLeader, partyId]);
        const nameRes = await client.query<{ display_name: string }>('select display_name from accounts where id = $1', [nextLeader]);
        await postSystemLine(client, `party-${partyId}`, 'leader', { name: nameRes.rows[0]?.display_name ?? '' });
      }
    }
    if (party.status === 'ready_check') {
      await endReadyCheck(client, partyId, party, members, accountId, 'left');
    } else if (party.status === 'in_session' || party.status === 'member_dropped') {
      await client.query("update parties set status = 'forming' where id = $1", [partyId]);
    }
  });
  const { publishPartyState } = await import('./realtime.js');
  publishPartyState(partyId);
}

export async function endReadyCheck(
  client: DBClient,
  partyId: string,
  party: PartyRow,
  members: PartyMemberRow[],
  excludeId: string | null,
  cause: 'not_ready' | 'left' | 'deadline',
): Promise<void> {
  const check = party.ready_check;
  await client.query("update parties set status = 'forming', ready_check = null where id = $1", [partyId]);
  const { postSystemLine } = await import('./party-lines.js');
  if (!check) {
    await postSystemLine(client, `party-${partyId}`, 'ready_failed', { n: '1' });
    return;
  }
  const responses = check.responses ?? {};
  let notReady = 0;
  for (const member of members) {
    if (member.account_id === excludeId) { notReady++; continue; }
    const response = responses[member.account_id] ?? 'pending';
    if (response !== 'ready') notReady++;
  }
  if (notReady < 1) notReady = 1;
  await postSystemLine(client, `party-${partyId}`, 'ready_failed', { n: String(notReady) });
}

export async function startReadyCheck(party: PartyRow): Promise<PartyRow | null> {
  const members = await partyMembers(party.id);
  if (members.length < 2) throw Object.assign(new Error('not enough'), { code: 'not_enough_members' });
  const now = Date.now();
  const deadline = Math.ceil(now / 1000) + 20;
  const responses: Record<string, 'pending'> = {};
  for (const m of members) responses[m.account_id] = 'pending';
  const check = { deadline_at: deadline, started_at: Math.floor(now / 1000), responses, members_at_start: members.map((m) => m.account_id) };
  const res = await query<PartyRow>(
    `update parties set status = 'ready_check', ready_check = $1 where id = $2 and status = 'forming'
     returning id, status, leader_id, story_id, ready_check, session_id, created_at`,
    [JSON.stringify(check), party.id],
  );
  const updated = res.rows[0];
  if (!updated) throw Object.assign(new Error('state'), { code: 'wrong_state' });
  return updated;
}

export async function answerReadyCheck(partyId: string, accountId: string, ready: boolean): Promise<PartyRow | null> {
  const party = await partyById(partyId);
  if (!party || !party.ready_check) throw Object.assign(new Error('no check'), { code: 'no_ready_check' });
  const check = party.ready_check;
  if (check.responses[accountId] && check.responses[accountId] !== 'pending') {
    throw Object.assign(new Error('answered'), { code: 'already_answered' });
  }
  const responses = { ...check.responses, [accountId]: ready ? 'ready' : 'not_ready' } as Record<string, 'ready' | 'not_ready' | 'pending'>;
  const members = await partyMembers(partyId);
  const allAnswered = members.every((m) => {
    const r = responses[m.account_id] ?? 'pending';
    return r !== 'pending';
  });
  if (!ready) {
    await transaction(async (client) => {
      await client.query("update parties set status = 'forming', ready_check = null where id = $1", [partyId]);
      const { postSystemLine } = await import('./party-lines.js');
      let notReady = 0;
      for (const m of members) {
        const r = responses[m.account_id] ?? 'pending';
        if (r !== 'ready') notReady++;
      }
      if (notReady < 1) notReady = 1;
      await postSystemLine(client, `party-${partyId}`, 'ready_failed', { n: String(notReady) });
    });
    const updated = await partyById(partyId);
    return updated;
  }
  if (allAnswered) {
    const updated = await query<PartyRow>(
      "update parties set ready_check = $1 where id = $2 returning id, status, leader_id, story_id, ready_check, session_id, created_at",
      [JSON.stringify({ ...check, responses }), partyId],
    );
    const readyRow = updated.rows[0];
    if (readyRow) await passReadyCheck(readyRow, members);
    const after = await partyById(partyId);
    return after;
  }
  const updated = await query<PartyRow>(
    "update parties set ready_check = $1 where id = $2 returning id, status, leader_id, story_id, ready_check, session_id, created_at",
    [JSON.stringify({ ...check, responses }), partyId],
  );
  return updated.rows[0] ?? null;
}

async function passReadyCheck(party: PartyRow, members: PartyMemberRow[]): Promise<void> {
  const { createSessionForParty } = await import('./world.js');
  const { postSystemLine } = await import('./party-lines.js');
  const session = await createSessionForParty(party, members);
  await transaction(async (client) => {
    await client.query("update parties set status = 'in_session', session_id = $1 where id = $2", [session.id, party.id]);
    await postSystemLine(client, `party-${party.id}`, 'ready_passed', { story: party.story_id });
  });
}
export async function tickReadyChecks(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const res = await query<PartyRow & { check_deadline: number }>(
    `select id, status, leader_id, story_id, ready_check, session_id, created_at,
            (ready_check->>'deadline_at')::bigint as check_deadline
       from parties where status = 'ready_check'`,
  );
  for (const party of res.rows) {
    if (party.check_deadline <= now) {
      const members = await partyMembers(party.id);
      await transaction(async (client) => {
        await endReadyCheck(client, party.id, party, members, null, 'deadline');
      });
      const { publishPartyState } = await import('./realtime.js');
      publishPartyState(party.id);
    }
  }
}

export async function handoffLeadership(partyId: string, accountId: string): Promise<void> {
  await query('update parties set leader_id = $1 where id = $2', [accountId, partyId]);
}

export function partyChannel(partyId: string): string {
  return `party-${partyId}`;
}
