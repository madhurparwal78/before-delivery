import { guardMatchWriteRate, requireUser } from '../auth';
import { pool, transact } from '../db';
import { notFound } from '../errors';
import { type Ctx, readJsonBody, sendJson } from '../http';
import { loadMatch, toApiMatch, type MatchRow } from '../domain/matches';
import {
  callMatch,
  commitEdit,
  confirmScore,
  disputeScore,
  editPreview,
  reportScore,
  resolveDispute,
  saveResult,
  type Actor,
} from '../domain/play';
import type { Effects } from '../domain/engine';
import { isOrganizerRole, loadEntrants, requireVisible, type Visible } from '../domain/tournaments';
import { withTournament } from '../work';

interface MatchWrite {
  visible: Visible;
  actor: Actor;
  matchId: string;
}

const prepare = async (ctx: Ctx, limited: boolean): Promise<MatchWrite> => {
  const user = requireUser(ctx);
  if (limited) await transact(async (db) => guardMatchWriteRate(db, user.id));
  const matchId = ctx.params.id as string;
  const { rows } = await pool.query<{ tournament_id: string }>('select tournament_id from matches where id = $1', [
    matchId,
  ]);
  const owner = rows[0];
  if (owner === undefined) throw notFound();
  const visible = await requireVisible(pool, owner.tournament_id, user.id);
  const entrants = await loadEntrants(pool, owner.tournament_id);
  const mine = entrants.find((entrant) => entrant.user_id === user.id);
  return {
    visible,
    matchId,
    actor: {
      userId: user.id,
      username: user.username,
      isOrganizer: isOrganizerRole(visible.role),
      entrantId: mine?.id ?? null,
    },
  };
};

const runWrite = async <T>(
  write: MatchWrite,
  fn: (effects: Effects, match: MatchRow) => Promise<T>,
): Promise<T> =>
  withTournament(write.visible.tournament.id, async (db, outbox) => {
    const match = await loadMatch(db, write.matchId);
    if (match === null) throw notFound();
    const effects: Effects = {
      db,
      outbox,
      tournament: write.visible.tournament,
      sentences: [],
      actor: write.actor.username,
    };
    return fn(effects, match);
  });

const sendMatch = (ctx: Ctx, write: MatchWrite, match: MatchRow, extra: Record<string, unknown> = {}): void => {
  sendJson(ctx.res, 200, { match: toApiMatch(match, write.actor.isOrganizer), ...extra });
};

export const postCall = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const match = await runWrite(write, (effects, row) => callMatch(effects, row, write.actor, body.version));
  sendMatch(ctx, write, match);
};

export const postReport = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const result = await runWrite(write, (effects, row) => reportScore(effects, row, write.actor, body));
  sendMatch(ctx, write, result.match, { outcome: result.outcome });
};

export const postConfirm = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const match = await runWrite(write, (effects, row) => confirmScore(effects, row, write.actor, body.version));
  sendMatch(ctx, write, match);
};

export const postDispute = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const match = await runWrite(write, (effects, row) => disputeScore(effects, row, write.actor, body));
  sendMatch(ctx, write, match);
};

export const postResult = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const match = await runWrite(write, (effects, row) => saveResult(effects, row, write.actor, body));
  sendMatch(ctx, write, match);
};

export const postResolve = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const match = await runWrite(write, (effects, row) => resolveDispute(effects, row, write.actor, body));
  sendMatch(ctx, write, match);
};

export const postEditPreview = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, false);
  const body = await readJsonBody(ctx.req);
  const preview = await runWrite(write, (effects, row) => editPreview(effects, row, write.actor, body));
  sendJson(ctx.res, 200, {
    dependents: preview.dependents.map((row) => ({ match_id: row.id, label: row.label, state: row.state })),
    count: preview.count,
    confirmed_count: preview.confirmed_count,
    preview_token: preview.preview_token,
  });
};

export const postEdit = async (ctx: Ctx): Promise<void> => {
  const write = await prepare(ctx, true);
  const body = await readJsonBody(ctx.req);
  const result = await runWrite(write, (effects, row) => commitEdit(effects, row, write.actor, body));
  sendMatch(ctx, write, result.match, { reset: result.reset });
};
