import { autoConfirm } from './domain/match.js';
import { match as matchOf } from './domain/draw.js';
import { emitDraw, tournamentMessage } from './access.js';
import { serverNow } from './clock.js';
import { config } from './config.js';
import { pool, tx } from './db.js';
import { deliver, publish } from './live.js';
import { loadCoOrganizers, loadDraw, saveDraw, saveTournament } from './repo.js';
import { forViewer, matchView } from './views.js';
import { MSG } from './messages.js';

// Deadlines are decided on server time and applied in time order, each in its own transaction.
interface Due { tournamentId: string; at: number; matchId?: string }

async function closeCheckin(due: Due, now: number): Promise<void> {
  await tx(async (c) => {
    const draw = await loadDraw(c, due.tournamentId, 'system', now, true);
    if (!draw || draw.tournament.state !== 'checkin_open' || (draw.tournament.checkinClosesAt ?? Infinity) > now) return;
    draw.tournament.state = 'checkin_closed';
    await saveTournament(c, draw.tournament);
    const co = (await loadCoOrganizers(c, due.tournamentId)).map((u) => u.username);
    await publish(c, due.tournamentId, now, [tournamentMessage(draw, co), { type: 'announcement', data: { text: MSG.checkinClosed } }]);
  });
  await deliver(due.tournamentId);
}

async function confirmReport(due: Due, now: number): Promise<void> {
  await tx(async (c) => {
    const draw = await loadDraw(c, due.tournamentId, 'system', now, true);
    const m = draw && draw.tournament.state === 'running' ? draw.byId.get(due.matchId as string) : undefined;
    if (!draw || !m || m.state !== 'reported' || (m.report?.autoConfirmAt ?? Infinity) > now) return;
    autoConfirm(draw, m);
    await saveDraw(c, draw);
    await emitDraw(c, draw, (await loadCoOrganizers(c, due.tournamentId)).map((u) => u.username));
  });
  await deliver(due.tournamentId);
}

// Overdue is turned on for organizers only; it never changes a match's version or updated_by.
async function flagOverdue(now: number): Promise<void> {
  const { rows } = await pool.query<{ id: string; tournament_id: string }>(
    `SELECT m.id, m.tournament_id FROM matches m JOIN tournaments t ON t.id = m.tournament_id
     WHERE t.state = 'running' AND NOT m.overdue AND (
       (m.state = 'called' AND m.called_at + $2 <= $1)
       OR (t.format = 'swiss' AND m.state IN ('pending', 'called') AND m.paired_at + $3 <= $1
           AND m.round = (SELECT max(round) FROM matches x WHERE x.tournament_id = m.tournament_id)))`,
    [now, config.matchLimitMs, config.swissRoundMs]);
  const byTournament = new Map<string, string[]>();
  for (const row of rows) byTournament.set(row.tournament_id, [...(byTournament.get(row.tournament_id) ?? []), row.id]);
  for (const [tournamentId, ids] of byTournament) {
    await tx(async (c) => {
      await c.query('UPDATE matches SET overdue = true WHERE id = ANY($1)', [ids]);
      const draw = await loadDraw(c, tournamentId, 'system', now);
      if (!draw) return;
      await publish(c, tournamentId, now, ids.map((id) => ({ type: 'match.updated' as const,
        data: { match: forViewer(matchView(draw, matchOf(draw, id)), true) }, organizersOnly: true })));
    });
    await deliver(tournamentId);
  }
}

async function pass(): Promise<void> {
  const now = await serverNow();
  const closing = await pool.query<{ id: string; at: number }>(
    `SELECT id, checkin_closes_at AS at FROM tournaments WHERE state = 'checkin_open' AND checkin_closes_at <= $1`, [now]);
  const confirming = await pool.query<{ id: string; tournament_id: string; at: number }>(
    `SELECT id, tournament_id, (report->>'autoConfirmAt')::bigint AS at FROM matches
     WHERE state = 'reported' AND (report->>'autoConfirmAt')::bigint <= $1`, [now]);
  const due: Array<Due & { kind: 'close' | 'confirm' }> = [
    ...closing.rows.map((r) => ({ kind: 'close' as const, tournamentId: r.id, at: r.at })),
    ...confirming.rows.map((r) => ({ kind: 'confirm' as const, tournamentId: r.tournament_id, matchId: r.id, at: r.at })),
  ].sort((a, b) => a.at - b.at);
  for (const item of due) await (item.kind === 'close' ? closeCheckin(item, now) : confirmReport(item, now));
  await flagOverdue(now);
}

// Passes run one after another, so a caller that moved the clock always gets a pass that saw the new time.
let tail: Promise<void> = Promise.resolve();
let queued = 0;

export function runDeadlines(): Promise<void> {
  queued += 1;
  const next = tail.then(pass).finally(() => { queued -= 1; });
  tail = next.catch(() => undefined);
  return next;
}

export function startDeadlineLoop(): void {
  setInterval(() => {
    if (queued === 0) runDeadlines().catch((error) => console.error('deadlines:', error));
  }, 1000).unref();
}
