/**
 * Voiding a rated game: the voided result is undone and every later rated
 * game of both players is recomputed in order, with an audit entry for each
 * player naming the administrator and the ratings before and after.
 */

import express from 'express';
import { newId, transaction, query, rows } from '../db.js';
import { route, fail, requireAdministrator, sendArray } from '../http.js';
import { fetchGame, notFound } from '../games.js';
import { applyResult } from '../ratings.js';

export const router = express.Router();

async function lockMembers(client, ids) {
  const wanted = [...new Set([...ids].filter(Boolean))].sort();
  if (!wanted.length) return new Map();
  const result = await client.query(
    'select * from members where id = any($1::text[]) order by id for update',
    [wanted],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

export async function voidGame(adminId, gameId) {
  return transaction(async (client) => {
    const game = await fetchGame(client, gameId, { lock: true });
    if (!game) throw notFound();
    const isRatedPair = game.status === 'finished' && game.rated
      && game.white_id && game.black_id && game.white_id !== game.black_id;
    if (!isRatedPair) {
      fail(409, 'Only a finished rated game between two members can be voided.');
    }
    if (game.white_rating_before === null || game.black_rating_before === null) {
      fail(409, 'That game carries no pre-game ratings, so it cannot be recomputed.');
    }

    const voided = [game.white_id, game.black_id];
    // The boundary is read back from the store rather than passed in, so no
    // timestamp loses precision on its way through the application.
    const laterResult = await client.query(
      `select * from games
        where status = 'finished' and rated = true
          and (white_id = any($1::text[]) or black_id = any($1::text[]))
          and id <> $2
          and (finished_at, id) > ((select finished_at from games where id = $2), $2)
        order by finished_at asc, id asc`,
      [voided, game.id],
    );
    const later = laterResult.rows;

    const touched = new Set(voided);
    for (const row of later) {
      touched.add(row.white_id);
      touched.add(row.black_id);
    }
    const members = await lockMembers(client, touched);

    const before = new Map();
    for (const [id, row] of members) before.set(id, { rating: row.rating, rated_games: row.rated_games });

    // Both players go back to the numbers they held before the voided game,
    // which drops that game from each of their counts.
    const working = new Map();
    for (const [id, row] of members) working.set(id, { rating: row.rating, rated_games: row.rated_games });
    working.set(game.white_id, {
      rating: game.white_rating_before,
      rated_games: game.white_rated_games_before,
    });
    working.set(game.black_id, {
      rating: game.black_rating_before,
      rated_games: game.black_rated_games_before,
    });

    await client.query(
      `update games set rated = false, end_reason = 'void' where id = $1`,
      [game.id],
    );

    for (const row of later) {
      const sides = [
        { key: 'white', id: row.white_id, storedGames: row.white_rated_games_before },
        { key: 'black', id: row.black_id, storedGames: row.black_rated_games_before },
      ];
      const inputs = {};
      for (const side of sides) {
        const state = working.get(side.id) || { rating: 1200, rated_games: 0 };
        const isVoidedPlayer = voided.includes(side.id);
        const ratedGames = isVoidedPlayer
          ? state.rated_games
          : (side.storedGames ?? state.rated_games);
        inputs[side.key] = { rating: state.rating, rated_games: ratedGames };
      }
      const out = applyResult({ white: inputs.white, black: inputs.black, result: row.result });
      await client.query(
        `update games set white_rating_before = $2, black_rating_before = $3,
            white_rated_games_before = $4, black_rated_games_before = $5 where id = $1`,
        [row.id, inputs.white.rating, inputs.black.rating, inputs.white.rated_games, inputs.black.rated_games],
      );
      for (const side of sides) {
        const isVoidedPlayer = voided.includes(side.id);
        const state = working.get(side.id) || { rating: 1200, rated_games: 0 };
        working.set(side.id, {
          rating: out[side.key].rating_after,
          rated_games: isVoidedPlayer ? state.rated_games + 1 : state.rated_games,
        });
      }
    }

    for (const [id, state] of working) {
      if (voided.includes(id)) {
        await client.query('update members set rating = $2, rated_games = $3 where id = $1', [
          id, state.rating, state.rated_games,
        ]);
      } else {
        await client.query('update members set rating = $2 where id = $1', [id, state.rating]);
      }
    }

    const audits = [];
    for (const id of voided) {
      const row = await client.query(
        `insert into rating_audit (id, game_id, admin_id, member_id, rating_before, rating_after)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [newId(), game.id, adminId, id, before.get(id).rating, working.get(id).rating],
      );
      const audit = row.rows[0];
      const member = members.get(id);
      audits.push({
        id: audit.id,
        game_id: audit.game_id,
        admin_id: audit.admin_id,
        administrator: null,
        member_id: audit.member_id,
        member: member ? member.username : null,
        rating_before: audit.rating_before,
        rating_after: audit.rating_after,
        created_at: audit.created_at,
        recomputed_games: later.length,
      });
    }
    const adminRow = await client.query('select username from members where id = $1', [adminId]);
    for (const audit of audits) audit.administrator = adminRow.rows[0]?.username || null;
    return audits;
  });
}

router.post('/admin/games/:game_id/void', route(async (req, res) => {
  const admin = requireAdministrator(req);
  const audits = await voidGame(admin.id, req.params.game_id);
  sendArray(res, audits);
}));

/** Rated games an administrator may void, newest first. */
export async function voidableGames(limit = 60) {
  return rows(
    `select g.id, g.result, g.end_reason, g.rated, g.finished_at, g.opening,
            w.username as white_username, b.username as black_username,
            g.white_rating_before, g.black_rating_before
       from games g
       left join members w on w.id = g.white_id
       left join members b on b.id = g.black_id
      where g.status = 'finished' and g.white_id is not null and g.black_id is not null
        and g.white_id <> g.black_id
      order by g.finished_at desc nulls last, g.id desc
      limit $1`,
    [limit],
  );
}

export async function auditEntries(limit = 40) {
  return rows(
    `select ra.*, m.username as member_username, a.username as admin_username
       from rating_audit ra
       join members m on m.id = ra.member_id
       join members a on a.id = ra.admin_id
      order by ra.created_at desc, ra.id desc limit $1`,
    [limit],
  );
}
