import { xpToNext, winRate } from '../shared/domain';
import { clearedCookie, passwordMatches, playerById, sessionBody } from './auth';
import { query, transaction } from './db';
import { ApiError, validationFailed } from './errors';
import { route, type Json } from './http';
import { balance, lineBody, lockPlayer, SYSTEM, wallet, writePair, type LedgerRow } from './ledger';
import { notifyPlayer } from './realtime';
import { activeTableUrl, playerIsBusy } from './tables';

const DAILY_REWARD = 100;
const REFILL_AMOUNT = 500;
const REFILL_BELOW = 100;
const REFILLS_PER_DAY = 3;

const DEFAULT_SETTINGS = { sound: true, music: false, aimSensitivity: 5, leftHanded: false, reducedMotion: false, theme: 'dark' };
const THEMES = ['light', 'dark', 'system'];

const TODAY = `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

function settingsOf(stored: Json): Json {
  return { ...DEFAULT_SETTINGS, ...stored };
}

function settingsChanges(body: Json): Json {
  const errors: Record<string, string> = {};
  const changes: Json = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'sound' || key === 'music' || key === 'leftHanded' || key === 'reducedMotion') {
      if (typeof value === 'boolean') changes[key] = value;
      else errors[key] = 'Use true or false.';
    } else if (key === 'aimSensitivity') {
      if (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10) changes[key] = value;
      else errors[key] = 'Use 1 to 10.';
    } else if (key === 'theme') {
      if (typeof value === 'string' && THEMES.includes(value)) changes[key] = value;
      else errors[key] = 'Use light, dark or system.';
    } else {
      errors[key] = 'Not accepted.';
    }
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  return changes;
}

export function registerWalletRoutes(): void {
  route('GET', '/api/me', async ({ session }) => {
    const body = await transaction(async (client) => {
      const player = await playerById(client, session.playerId);
      const claims = await client.query<{ daily: string; refills: string }>(
        `SELECT COUNT(*) FILTER (WHERE kind = 'daily_reward') AS daily, COUNT(*) FILTER (WHERE kind = 'refill') AS refills
         FROM ledger_lines WHERE player_id = $1 AND account = 'wallet' AND created_at >= ${TODAY}`,
        [player.id],
      );
      const delayed = await client.query(
        `SELECT 1 FROM mail_outbox WHERE player_id = $1 AND kind = 'verification' AND delivered_at IS NULL AND attempts > 0 LIMIT 1`,
        [player.id],
      );
      return {
        ...(await sessionBody(client, player)),
        xpToNext: xpToNext(player.level),
        wins: player.wins,
        losses: player.losses,
        winRate: winRate(player.wins, player.losses),
        winStreak: player.win_streak,
        highestPot: Number(player.highest_pot),
        equippedCueId: player.equipped_cue_id,
        equippedClothId: player.equipped_cloth_id,
        dailyRewardClaimed: Number(claims.rows[0].daily) > 0,
        refillsLeft: REFILLS_PER_DAY - Number(claims.rows[0].refills),
        mailDelayed: delayed.rows.length > 0,
        activeTableUrl: activeTableUrl(player.id),
        friendCode: player.friend_code,
        settings: settingsOf(player.settings),
      };
    });
    return { status: 200, body };
  });

  route('PATCH', '/api/me/settings', async ({ session, body }) => {
    const changes = settingsChanges(body);
    const rows = await query<{ settings: Json }>(
      'UPDATE players SET settings = settings || $1::jsonb WHERE id = $2 RETURNING settings',
      [JSON.stringify(changes), session.playerId],
    );
    notifyPlayer(session.playerId);
    return { status: 200, body: settingsOf(rows[0].settings) };
  }, { body: true });

  route('DELETE', '/api/me', async ({ session, body }) => {
    await transaction(async (client) => {
      await lockPlayer(client, session.playerId);
      const player = await playerById(client, session.playerId);
      if (!(await passwordMatches(typeof body.password === 'string' ? body.password : '', player.password_hash))) {
        throw new ApiError(403, 'invalid_credentials', 'Email or password is wrong.');
      }
      if (await playerIsBusy(client, player.id)) throw new ApiError(409, 'in_match', 'You are in a live match, tournament or queue.');

      const held = await client.query<{ club_id: string; role: string }>('SELECT club_id, role FROM club_members WHERE player_id = $1', [player.id]);
      await client.query('DELETE FROM club_members WHERE player_id = $1', [player.id]);
      if (held.rows[0]?.role === 'owner') {
        const { club_id: clubId } = held.rows[0];
        const heir = await client.query<{ player_id: string }>('SELECT player_id FROM club_members WHERE club_id = $1 ORDER BY ordinal LIMIT 1', [clubId]);
        if (heir.rows.length === 0) await client.query('DELETE FROM clubs WHERE id = $1', [clubId]);
        else await client.query(`UPDATE club_members SET role = 'owner' WHERE player_id = $1`, [heir.rows[0].player_id]);
      }
      await client.query('DELETE FROM sessions WHERE player_id = $1', [player.id]);
      await client.query('DELETE FROM friendships WHERE player_id = $1 OR friend_id = $1', [player.id]);
      await client.query('DELETE FROM friend_requests WHERE from_player = $1 OR to_player = $1', [player.id]);
      await client.query('DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1', [player.id]);
      await client.query('DELETE FROM club_requests WHERE player_id = $1', [player.id]);
      await client.query('DELETE FROM club_messages WHERE player_id = $1', [player.id]);
      await client.query('DELETE FROM mail_outbox WHERE player_id = $1', [player.id]);
      await client.query(
        `UPDATE players SET email = NULL, password_hash = NULL, friend_code = NULL, verify_token_hash = NULL,
           display_name = 'Deleted player', birth_year = NULL, deleted_at = now() WHERE id = $1`,
        [player.id],
      );
    });
    return { status: 204, headers: { 'Set-Cookie': clearedCookie() } };
  }, { body: true });

  route('POST', '/api/wallet/daily-reward', async ({ session }) => {
    const coins = await transaction(async (client) => {
      await lockPlayer(client, session.playerId);
      const claimed = await client.query(
        `SELECT 1 FROM ledger_lines WHERE player_id = $1 AND account = 'wallet' AND kind = 'daily_reward' AND created_at >= ${TODAY}`,
        [session.playerId],
      );
      if (claimed.rows.length > 0) throw new ApiError(409, 'daily_claimed', 'Daily reward already claimed today.');
      await writePair(client, { from: SYSTEM, to: wallet(session.playerId), amount: DAILY_REWARD, currency: 'coins', kind: 'daily_reward', refId: session.playerId });
      return balance(client, session.playerId, 'coins');
    });
    notifyPlayer(session.playerId);
    return { status: 200, body: { coins } };
  });

  route('POST', '/api/wallet/refill', async ({ session }) => {
    const answer = await transaction(async (client) => {
      await lockPlayer(client, session.playerId);
      const { rows } = await client.query<{ used: string }>(
        `SELECT COUNT(*) AS used FROM ledger_lines WHERE player_id = $1 AND account = 'wallet' AND kind = 'refill' AND created_at >= ${TODAY}`,
        [session.playerId],
      );
      const used = Number(rows[0].used);
      if (used >= REFILLS_PER_DAY) throw new ApiError(409, 'refill_limit', 'No Refills left today. Back after midnight UTC.');
      const coins = await balance(client, session.playerId, 'coins');
      if (coins >= REFILL_BELOW) throw new ApiError(409, 'refill_not_needed', 'Refill is for balances under 100 Coins.');
      await writePair(client, { from: SYSTEM, to: wallet(session.playerId), amount: REFILL_AMOUNT, currency: 'coins', kind: 'refill', refId: session.playerId });
      return { coins: coins + REFILL_AMOUNT, refillsLeft: REFILLS_PER_DAY - used - 1 };
    });
    notifyPlayer(session.playerId);
    return { status: 200, body: answer };
  });

  route('GET', '/api/wallet/ledger', async ({ session, query: search }) => {
    const currency = search.get('currency');
    if (currency !== 'coins' && currency !== 'cash') throw validationFailed({ currency: 'Use coins or cash.' });
    const lines = await query<LedgerRow>(
      `SELECT * FROM ledger_lines WHERE player_id = $1 AND account = 'wallet' AND currency = $2 ORDER BY seq DESC`,
      [session.playerId, currency],
    );
    return { status: 200, body: { balance: lines.reduce((sum, line) => sum + Number(line.amount), 0), lines: lines.map(lineBody) } };
  });
}
