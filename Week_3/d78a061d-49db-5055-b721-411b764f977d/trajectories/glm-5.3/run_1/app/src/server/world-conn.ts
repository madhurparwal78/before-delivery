import { query } from './db.js';
import { connections, openSessionConnections, sessionConnectionCount, isAccountOnline } from './presence.js';
import { sessionState, runningSessions, persistSession, completeChapter, countCollectedMotes, saveCheckpoint } from './world.js';
import config from './config.js';

/**
 * Grace and drop handling (DP-49, DP-50, DP-76) — decided in this one module.
 */
export async function onMemberConnectionsChanged(sessionId: string, accountId: string): Promise<void> {
  const state = sessionState(sessionId);
  if (!state) return;
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member) return;
  const count = sessionConnectionCount(sessionId, accountId);
  if (count === 0 && member.status === 'connected') {
    await dropMember(state, member.account_id);
  } else if (count > 0 && member.status === 'dropped') {
    await rejoinMember(state, member.account_id);
  }
}

export async function dropMember(state: import('./world.js').SessionState, accountId: string): Promise<void> {
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member || member.status === 'dropped') return;
  member.status = 'dropped';
  member.graceUntil = Date.now() + config.rejoinGraceSeconds * 1000;
  await persistSession(state);
  const { publishSessionEvent } = await import('./realtime.js');
  await publishSessionEvent(state.id, 'member_dropped', { account_id: accountId, name: member.display_name, grace_seconds: config.rejoinGraceSeconds });
  if (state.party_id) {
    const { partyChannel } = await import('./parties.js');
    const { appendChatMessage } = await import('./chat.js');
    await appendChatMessage(null, partyChannel(state.party_id), {
      kind: 'system',
      code: 'dropped',
      params: { name: member.display_name, seconds: String(config.rejoinGraceSeconds) },
    });
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(state.party_id);
    await query("update parties set status = 'member_dropped' where id = $1 and status in ('in_session')", [state.party_id]);
    publishPartyState(state.party_id);
  }
  const { tickSoon } = await import('./ticker.js');
  tickSoon();
}

export async function rejoinMember(state: import('./world.js').SessionState, accountId: string): Promise<void> {
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member || member.status !== 'dropped') return;
  member.status = 'connected';
  member.graceUntil = null;
  await persistSession(state);
  const { publishSessionEvent } = await import('./realtime.js');
  await publishSessionEvent(state.id, 'member_rejoined', { account_id: accountId });
  if (state.party_id) {
    const { partyChannel } = await import('./parties.js');
    const { appendChatMessage } = await import('./chat.js');
    const name = member.display_name;
    await appendChatMessage(null, partyChannel(state.party_id), { kind: 'system', code: 'rejoined', params: { name } });
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(state.party_id);
    await query("update parties set status = 'in_session' where id = $1 and status = 'member_dropped'", [state.party_id]);
    publishPartyState(state.party_id);
  }
  const { tickSoon } = await import('./ticker.js');
  tickSoon();
}

export async function settleGraces(): Promise<void> {
  const now = Date.now();
  for (const state of [...runningSessions.values()]) {
    if (state.status !== 'running') continue;
    for (const member of state.members) {
      if (member.status !== 'dropped' || !member.graceUntil) continue;
      if (member.graceUntil > now) continue;
      const othersConnected = state.members.some((m) => m.account_id !== member.account_id && m.status === 'connected');
      if (state.mode === 'solo') {
        // A solo session whose grace ends simply ends, with progress at its last checkpoint.
        await saveCheckpointLatest(state);
        await endSoloByGrace(state);
      } else if (othersConnected) {
        await removeMember(state, member.account_id);
      } else {
        await endSessionByGrace(state);
      }
    }
  }
}

async function saveCheckpointLatest(state: import('./world.js').SessionState): Promise<void> {
  await saveCheckpoint(state, countCollectedMotes(state));
}

async function endSoloByGrace(state: import('./world.js').SessionState): Promise<void> {
  state.status = 'complete';
  await persistSession(state);
  runningSessions.delete(state.id);
  const { publishSessionEndedByGrace } = await import('./realtime.js');
  await publishSessionEndedByGrace(state.id);
}

async function endSessionByGrace(state: import('./world.js').SessionState): Promise<void> {
  state.status = 'complete';
  await saveCheckpointLatest(state);
  await persistSession(state);
  runningSessions.delete(state.id);
  if (state.party_id) {
    await query("update parties set status = 'forming', session_id = null where id = $1", [state.party_id]);
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(state.party_id);
  }
  const { publishSessionEndedByGrace } = await import('./realtime.js');
  await publishSessionEndedByGrace(state.id);
}

export async function removeMember(state: import('./world.js').SessionState, accountId: string): Promise<void> {
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member) return;
  const name = member.display_name;
  state.members = state.members.filter((m) => m.account_id !== accountId);
  await persistSession(state);
  const { publishSessionEvent, publishSeatReleased } = await import('./realtime.js');
  await publishSeatReleased(state.id, accountId);
  if (state.party_id) {
    const { partyChannel } = await import('./parties.js');
    const { appendChatMessage } = await import('./chat.js');
    await appendChatMessage(null, partyChannel(state.party_id), { kind: 'system', code: 'removed', params: { name } });
    await query('delete from party_members where party_id = $1 and account_id = $2', [state.party_id, accountId]);
    const remaining = await query<{ count: string }>('select count(*) as count from party_members where party_id = $1', [state.party_id]);
    if (Number(remaining.rows[0]?.count ?? 0) === 0) {
      await query('delete from parties where id = $1', [state.party_id]);
    }
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(state.party_id);
  }
}
