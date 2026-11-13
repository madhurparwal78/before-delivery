import type { EditPreview, EditResult, MatchView, ReportResult } from '../../shared/api.js';
import { emitDraw, mutate, read, type Access } from '../access.js';
import { takeRateSlot, type User } from '../auth.js';
import { serverNow } from '../clock.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { resetAnnouncement, announcementOf } from '../domain/announcements.js';
import { match as matchOf } from '../domain/draw.js';
import { applyAction, assertEditable, parseGames, type Actor, type MatchAction } from '../domain/match.js';
import { commitEdit, dependentSet, describeDependents, previewToken } from '../domain/shutter.js';
import type { Match } from '../domain/types.js';
import { ApiError, fail } from '../errors.js';
import { ok, route, type Ctx } from '../http.js';
import { publish } from '../live.js';
import { MSG } from '../messages.js';
import { saveDraw } from '../repo.js';
import { forViewer, matchView } from '../views.js';

const me = (ctx: Ctx): User => ctx.user as User;
const versionOf = (body: Record<string, unknown>): number => (typeof body['version'] === 'number' ? body['version'] : -1);

async function tournamentOfMatch(id: string): Promise<string> {
  const { rows } = await pool.query<{ tournament_id: string }>('SELECT tournament_id FROM matches WHERE id = $1', [id]);
  return rows[0]?.tournament_id ?? fail('not_found', MSG.tournamentNotFound);
}

async function takeWriteSlot(user: User): Promise<void> {
  if (!(await takeRateSlot('match', user.id, config.reportRate, await serverNow()))) fail('rate_limited', MSG.scoreRate);
}

const actorOf = (a: Access): Actor => ({ username: a.user.username, organizer: a.organizer, entrantId: a.myEntrant?.id ?? null });
const viewFor = (a: Access, m: Match): MatchView => forViewer(matchView(a.draw, m), a.organizer);

// A refused write names the current match, so the dialog can show who updated it.
function withCurrentMatch(error: unknown, a: Access, m: Match): unknown {
  if (error instanceof ApiError && (error.code === 'stale_match' || error.code === 'already_resolved')) {
    return new ApiError(error.code, error.message, { match: viewFor(a, m) });
  }
  return error;
}

type WriteKind = 'call' | 'report' | 'confirm' | 'dispute' | 'result' | 'resolve';

async function write(ctx: Ctx, kind: WriteKind): Promise<ReturnType<typeof ok>> {
  const user = me(ctx);
  const body = ctx.json();
  await takeWriteSlot(user);
  const matchId = ctx.params['id'] as string;
  return mutate(user, await tournamentOfMatch(matchId), async (a, c) => {
    const m = matchOf(a.draw, matchId);
    const action = { kind, games: body, version: versionOf(body) } as MatchAction;
    let outcome;
    try {
      outcome = applyAction(a.draw, m, action, actorOf(a));
    } catch (error) {
      throw withCurrentMatch(error, a, m);
    }
    await saveDraw(c, a.draw);
    await emitDraw(c, a.draw, a.coOrganizers);
    const reply: ReportResult | { match: MatchView } = kind === 'report'
      ? { match: viewFor(a, m), outcome: outcome as ReportResult['outcome'] } : { match: viewFor(a, m) };
    return ok(reply);
  });
}

export function registerMatches(): void {
  for (const kind of ['call', 'report', 'confirm', 'dispute', 'result', 'resolve'] as const) {
    route('POST', `/api/matches/:id/${kind}`, (ctx) => write(ctx, kind));
  }

  route('POST', '/api/matches/:id/edit-preview', async (ctx) => {
    const body = ctx.json();
    const matchId = ctx.params['id'] as string;
    const a = await read(me(ctx), await tournamentOfMatch(matchId));
    const m = matchOf(a.draw, matchId);
    try {
      assertEditable(a.draw, m, actorOf(a), versionOf(body));
    } catch (error) {
      throw withCurrentMatch(error, a, m);
    }
    const games = parseGames(a.draw, body);
    const set = dependentSet(a.draw, m, games.upper, games.lower);
    const { dependents, count, confirmedCount } = describeDependents(set);
    const reply: EditPreview = { dependents, count, confirmed_count: confirmedCount,
      preview_token: previewToken(m, games.upper, games.lower, set) };
    return ok(reply);
  });

  route('POST', '/api/matches/:id/edit', async (ctx) => {
    const body = ctx.json();
    const user = me(ctx);
    await takeWriteSlot(user);
    const matchId = ctx.params['id'] as string;
    return mutate(user, await tournamentOfMatch(matchId), async (a, c) => {
      const m = matchOf(a.draw, matchId);
      assertEditable(a.draw, m, actorOf(a));
      const games = parseGames(a.draw, body);
      const set = dependentSet(a.draw, m, games.upper, games.lower);
      if (previewToken(m, games.upper, games.lower, set) !== body['preview_token']) fail('stale_preview', MSG.stalePreview);
      commitEdit(a.draw, m, games.upper, games.lower, set);
      await saveDraw(c, a.draw);
      const text = [set.length ? resetAnnouncement(set.length) : null, announcementOf(a.draw.tournament.format, a.draw.events)]
        .filter((part): part is string => part !== null).join('. ') || null;
      if (set.length) {
        await publish(c, a.draw.tournament.id, a.draw.now, [{ type: 'matches.reset',
          data: { matches: set.map((x) => matchView(a.draw, x)) } }]);
      }
      await emitDraw(c, a.draw, a.coOrganizers, { skip: new Set(set.map((x) => x.id)), text });
      const reply: EditResult = { match: viewFor(a, m), reset: set.map((x) => x.id) };
      return ok(reply);
    });
  });
}
