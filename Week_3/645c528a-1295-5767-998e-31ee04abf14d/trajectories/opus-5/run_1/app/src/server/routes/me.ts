import { DAILY_REWARD, REFILL_AMOUNT, REFILL_LIMIT, REFILL_THRESHOLD } from '../../shared/catalog.js';
import { HOME_COPY } from '../../shared/copy.js';
import { query, transaction } from '../db.js';
import { ApiError } from '../errors.js';
import { objectBody, type Ctx, type Router } from '../http.js';
import { credit, serialiseLine, type LedgerLineRow } from '../ledger.js';
import { loadPlayer, meBody, settingsOf, utcDate, verifyPassword } from '../players.js';
import { clearSessionCookie, requireSession } from '../session.js';
import { playerHasLiveMatch, publishPlayer } from '../tables.js';

export function registerMeRoutes(router: Router): void {
  router.get('/api/me', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    return { status: 200, body: await meBody(player) };
  });

  router.patch('/api/me/settings', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const body = objectBody(ctx);
    const current = settingsOf(player);
    const fields: Record<string, string> = {};
    const next = { ...current };
    for (const key of ['sound', 'music', 'leftHanded', 'reducedMotion'] as const) {
      if (body[key] === undefined) continue;
      if (typeof body[key] !== 'boolean') fields[key] = 'Use true or false.';
      else next[key] = body[key] as boolean;
    }
    if (body.aimSensitivity !== undefined) {
      const value = body.aimSensitivity;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
        fields.aimSensitivity = 'Use a whole number from 1 to 10.';
      } else next.aimSensitivity = value;
    }
    if (body.theme !== undefined) {
      if (body.theme !== 'light' && body.theme !== 'dark' && body.theme !== 'system') {
        fields.theme = 'Use light, dark or system.';
      } else next.theme = body.theme;
    }
    for (const key of Object.keys(body)) {
      if (!['sound', 'music', 'leftHanded', 'reducedMotion', 'aimSensitivity', 'theme'].includes(key)) {
        fields[key] = 'Not accepted.';
      }
    }
    if (Object.keys(fields).length > 0) throw ApiError.validation(fields);
    await query(`UPDATE players SET settings = $1 WHERE id = $2`, [JSON.stringify(next), player.id]);
    publishPlayer(player.id);
    return { status: 200, body: next };
  });

  router.delete('/api/me', async (ctx: Ctx) => {
    const { player, sessionId } = await requireSession(ctx);
    const body = objectBody(ctx);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyPassword(password, player.password_hash))) {
      throw new ApiError(403, 'invalid_credentials', 'Email or password is wrong.');
    }
    const queued = await query<{ id: string }>(`SELECT id FROM queue_tickets WHERE player_id = $1 AND status = 'queued'`, [player.id]);
    const tournament = await query<{ tournament_id: string }>(
      `SELECT e.tournament_id FROM tournament_entrants e JOIN tournaments t ON t.id = e.tournament_id
        WHERE e.player_id = $1 AND t.status IN ('open','full','ready_check','round_of_8','semi_finals','final')`,
      [player.id],
    );
    if (queued.length > 0 || tournament.length > 0 || (await playerHasLiveMatch(player.id))) {
      throw new ApiError(409, 'in_match', 'Finish your match before deleting your account.');
    }
    await transaction(async (client) => {
      const club = await client.query<{ club_id: string; role: string }>(
        `SELECT club_id, role FROM club_members WHERE player_id = $1`,
        [player.id],
      );
      const membership = club.rows[0];
      if (membership && membership.role === 'owner') {
        const heir = await client.query<{ player_id: string }>(
          `SELECT player_id FROM club_members WHERE club_id = $1 AND player_id <> $2 ORDER BY joined_at LIMIT 1`,
          [membership.club_id, player.id],
        );
        const next = heir.rows[0];
        if (next) {
          await client.query(`UPDATE club_members SET role = 'owner' WHERE club_id = $1 AND player_id = $2`, [membership.club_id, next.player_id]);
        } else {
          await client.query(`DELETE FROM clubs WHERE id = $1`, [membership.club_id]);
        }
      }
      await client.query(`DELETE FROM club_members WHERE player_id = $1`, [player.id]);
      await client.query(`DELETE FROM sessions WHERE player_id = $1`, [player.id]);
      await client.query(
        `UPDATE players SET deleted = TRUE, display_name = 'Removed player', email = NULL, password_hash = NULL, friend_code = NULL WHERE id = $1`,
        [player.id],
      );
    });
    void sessionId;
    clearSessionCookie(ctx.res);
    return { status: 204, body: null };
  });

  router.post('/api/wallet/daily-reward', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const coins = await transaction(async (client) => {
      const locked = await client.query<{ daily_claim_date: Date | null }>(
        `SELECT daily_claim_date FROM players WHERE id = $1 FOR UPDATE`,
        [player.id],
      );
      const stored = locked.rows[0]?.daily_claim_date;
      const date = stored ? new Date(stored).toISOString().slice(0, 10) : null;
      if (date === utcDate()) return null;
      await client.query(`UPDATE players SET daily_claim_date = $1::date WHERE id = $2`, [utcDate(), player.id]);
      await credit(client, player.id, 'coins', DAILY_REWARD, 'daily_reward', null);
      const after = await client.query<{ coins: string }>(`SELECT coins FROM players WHERE id = $1`, [player.id]);
      return Number(after.rows[0]?.coins ?? 0);
    });
    if (coins === null) throw new ApiError(409, 'daily_claimed', HOME_COPY.dailyAlready);
    publishPlayer(player.id);
    return { status: 200, body: { coins } };
  });

  router.post('/api/wallet/refill', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const outcome = await transaction(async (client) => {
      const locked = await client.query<{ coins: string; refill_date: Date | null; refill_count: number }>(
        `SELECT coins, refill_date, refill_count FROM players WHERE id = $1 FOR UPDATE`,
        [player.id],
      );
      const row = locked.rows[0];
      if (!row) return { error: 'refill_not_needed' as const };
      const today = utcDate();
      const stored = row.refill_date ? new Date(row.refill_date).toISOString().slice(0, 10) : null;
      const used = stored === today ? row.refill_count : 0;
      if (Number(row.coins) >= REFILL_THRESHOLD) return { error: 'refill_not_needed' as const };
      if (used >= REFILL_LIMIT) return { error: 'refill_limit' as const };
      await client.query(`UPDATE players SET refill_date = $1::date, refill_count = $2 WHERE id = $3`, [today, used + 1, player.id]);
      await credit(client, player.id, 'coins', REFILL_AMOUNT, 'refill', null);
      const after = await client.query<{ coins: string }>(`SELECT coins FROM players WHERE id = $1`, [player.id]);
      return { coins: Number(after.rows[0]?.coins ?? 0), refillsLeft: REFILL_LIMIT - (used + 1) };
    });
    if ('error' in outcome) {
      if (outcome.error === 'refill_limit') throw new ApiError(409, 'refill_limit', HOME_COPY.refillUsedUp);
      throw new ApiError(409, 'refill_not_needed', HOME_COPY.refillNotNeeded);
    }
    publishPlayer(player.id);
    return { status: 200, body: outcome };
  });

  router.get('/api/wallet/ledger', async (ctx: Ctx) => {
    const { player } = await requireSession(ctx);
    const currency = ctx.url.searchParams.get('currency') ?? 'coins';
    if (currency !== 'coins' && currency !== 'cash') {
      throw ApiError.validation({ currency: 'Use coins or cash.' });
    }
    const lines = await query<LedgerLineRow>(
      `SELECT * FROM ledger_lines WHERE player_id = $1 AND currency = $2 AND account = 'wallet' ORDER BY seq DESC LIMIT 200`,
      [player.id, currency],
    );
    const fresh = await loadPlayer(player.id);
    const balance = currency === 'coins' ? Number(fresh?.coins ?? 0) : Number(fresh?.cash ?? 0);
    return { status: 200, body: { balance, lines: lines.map(serialiseLine) } };
  });
}
