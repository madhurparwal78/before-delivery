import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { one, query } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import { worldNow } from './clock.js';
import type { PersonRow } from './auth.js';
import { yesVotesNeeded } from './domain/votes.js';
import type { VoteWire } from './events.js';
import { publishPersonEvent, publishSessionEvent } from './events.js';
import type { SessionRow } from './sessions.js';
import { activeMembers, getOpenSession, leaveSession, memberOf, requireMembership } from './sessions.js';
import { ServiceDownError } from './errors.js';
import { valkeyUp } from './services/valkey.js';

export const VOTE_TEXT = {
  self: 'You cannot start a vote about yourself.',
  alreadyOpen: 'A vote on this person is already open.',
  tooFew: 'Too few people to vote.',
  notAllowed: 'You cannot vote on this.',
  closed: 'This vote has closed.',
  alreadyVoted: 'You have already voted.',
  choice: 'Choose yes or no.'
} as const;

interface VoteRow {
  id: string;
  session_id: string;
  target_id: string;
  status: 'open' | 'passed' | 'failed';
  eligible: number;
  needed: number;
  started_at: Date;
  closes_at: Date;
}

export interface VoteView {
  id: string;
  targetId: string;
  status: 'open' | 'passed' | 'failed';
  eligible: number;
  needed: number;
  yes: number;
  no: number;
  closesAt: string;
}

async function tally(voteId: string): Promise<{ yes: number; no: number }> {
  const rows = await query<{ choice: string; total: string }>(
    'select choice, count(*)::text as total from ballots where vote_id = $1 group by choice',
    [voteId]
  );
  const find = (choice: string): number => Number(rows.find((row) => row.choice === choice)?.total ?? '0');
  return { yes: find('yes'), no: find('no') };
}

async function viewOf(vote: VoteRow): Promise<VoteView> {
  const counts = await tally(vote.id);
  return {
    id: vote.id,
    targetId: vote.target_id,
    status: vote.status,
    eligible: vote.eligible,
    needed: vote.needed,
    yes: counts.yes,
    no: counts.no,
    closesAt: vote.closes_at.toISOString()
  };
}

async function wireOf(vote: VoteRow): Promise<VoteWire> {
  const view = await viewOf(vote);
  const target = await one<{ display_name: string }>('select display_name from people where id = $1', [vote.target_id]);
  return { ...view, targetName: target?.display_name ?? '' };
}

async function applyOutcome(session: SessionRow, vote: VoteRow): Promise<VoteRow> {
  const counts = await tally(vote.id);
  const now = await worldNow(session.world_id);
  if (vote.status !== 'open') return vote;
  if (counts.yes >= vote.needed) {
    await query(`update votes set status = 'passed' where id = $1`, [vote.id]);
    const passed: VoteRow = { ...vote, status: 'passed' };
    await query('insert into session_bans (session_id, person_id) values ($1, $2) on conflict do nothing', [
      session.id,
      vote.target_id
    ]);
    const target = await memberOf(session.id, vote.target_id);
    await publishSessionEvent(session.id, { type: 'vote', vote: await wireOf(passed) });
    await publishPersonEvent(vote.target_id, {
      type: 'removed-from-session',
      sessionId: session.id,
      reason: 'vote'
    });
    if (target !== null) await leaveSession(session, target.person_id, target.display_name);
    return passed;
  }
  if (now.getTime() >= vote.closes_at.getTime()) {
    await query(`update votes set status = 'failed' where id = $1`, [vote.id]);
    const failed: VoteRow = { ...vote, status: 'failed' };
    await publishSessionEvent(session.id, { type: 'vote', vote: await wireOf(failed) });
    return failed;
  }
  return vote;
}

export async function startVote(person: PersonRow, session: SessionRow, targetId: unknown): Promise<VoteView> {
  await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  if (typeof targetId !== 'string') throw notFound();
  const target = await memberOf(session.id, targetId);
  if (target === null) throw notFound();
  const open = await one<VoteRow>(`select * from votes where session_id = $1 and target_id = $2 and status = 'open'`, [
    session.id,
    targetId
  ]);
  if (open !== null) throw conflict(VOTE_TEXT.alreadyOpen);
  const members = await activeMembers(session.id);
  const eligible = members.filter((member) => member.person_id !== targetId);
  if (eligible.length < 2) throw conflict(VOTE_TEXT.tooFew);
  if (targetId === person.id) throw invalid(VOTE_TEXT.self);
  const now = await worldNow(session.world_id);
  const vote: VoteRow = {
    id: randomUUID(),
    session_id: session.id,
    target_id: targetId,
    status: 'open',
    eligible: eligible.length,
    needed: yesVotesNeeded(eligible.length),
    started_at: now,
    closes_at: new Date(now.getTime() + config.voteWindowSeconds * 1000)
  };
  await query(
    `insert into votes (id, session_id, target_id, status, eligible, needed, started_at, closes_at)
     values ($1, $2, $3, 'open', $4, $5, $6, $7)`,
    [vote.id, vote.session_id, vote.target_id, vote.eligible, vote.needed, vote.started_at, vote.closes_at]
  );
  for (const voter of eligible) {
    await query('insert into vote_voters (vote_id, person_id) values ($1, $2)', [vote.id, voter.person_id]);
  }
  await query('insert into ballots (vote_id, person_id, choice) values ($1, $2, $3)', [vote.id, person.id, 'yes']);
  await publishSessionEvent(session.id, { type: 'vote', vote: await wireOf(vote) });
  const settled = await applyOutcome(session, vote);
  return viewOf(settled);
}

export async function castBallot(
  person: PersonRow,
  session: SessionRow,
  voteId: string,
  choice: unknown
): Promise<VoteView> {
  await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  const vote = await one<VoteRow>('select * from votes where id = $1 and session_id = $2', [voteId, session.id]);
  if (vote === null) throw notFound();
  const now = await worldNow(session.world_id);
  if (vote.status !== 'open' || now.getTime() >= vote.closes_at.getTime()) {
    await applyOutcome(session, vote);
    throw conflict(VOTE_TEXT.closed);
  }
  const eligible = await one('select 1 from vote_voters where vote_id = $1 and person_id = $2', [voteId, person.id]);
  if (eligible === null) throw conflict(VOTE_TEXT.notAllowed);
  const existing = await one('select 1 from ballots where vote_id = $1 and person_id = $2', [voteId, person.id]);
  if (existing !== null) throw conflict(VOTE_TEXT.alreadyVoted);
  if (choice !== 'yes' && choice !== 'no') throw invalid(VOTE_TEXT.choice);
  await query('insert into ballots (vote_id, person_id, choice) values ($1, $2, $3)', [voteId, person.id, choice]);
  await publishSessionEvent(session.id, { type: 'vote', vote: await wireOf(vote) });
  const settled = await applyOutcome(session, vote);
  return viewOf(settled);
}

export async function listVotes(session: SessionRow): Promise<VoteView[]> {
  const rows = await query<VoteRow>('select * from votes where session_id = $1 order by started_at asc', [session.id]);
  const views: VoteView[] = [];
  for (const row of rows) views.push(await viewOf(row));
  return views;
}

export async function closeDueVotes(worldId: string, now: Date): Promise<void> {
  const rows = await query<VoteRow>(
    `select v.* from votes v join sessions s on s.id = v.session_id
      where s.world_id = $1 and v.status = 'open' and v.closes_at <= $2`,
    [worldId, now]
  );
  for (const row of rows) {
    const session = await getOpenSession(row.session_id);
    if (session === null) continue;
    await applyOutcome(session, row);
  }
}
