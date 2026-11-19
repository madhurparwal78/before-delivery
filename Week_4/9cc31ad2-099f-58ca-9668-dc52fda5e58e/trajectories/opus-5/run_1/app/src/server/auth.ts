import { randomBytes } from 'node:crypto';
import { OPENING_BALANCE } from '../shared/catalogue.js';
import { config } from './config.js';
import { db, one, withPlayerLock, type Queryable } from './db.js';
import { formatThousands } from '../shared/format.js';
import { ApiError, gone, unavailable, validationFailed } from './errors.js';
import { balanceOf } from './ledger.js';
import { MailUnavailable, sendSigninEmail } from './mail.js';
import { accountName, createPlayer, createSession, type PlayerRow } from './players.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

export function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
}

export async function requestSigninLink(email: string): Promise<void> {
  const token = randomBytes(24).toString('hex');
  await db.query(
    `insert into signin_tokens (token, email, expires_at)
     values ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [token, email, String(config.signinLinkTtlSeconds)],
  );
  try {
    await sendSigninEmail(email, `${config.publicUrl}/sign-in/${token}`);
  } catch (error) {
    await db.query('delete from signin_tokens where token = $1', [token]);
    if (error instanceof MailUnavailable) {
      throw unavailable('MAIL_UNAVAILABLE', 'The sign-in email could not be sent.');
    }
    throw error;
  }
}

export type RedeemOutcome = 'new_account' | 'signed_in' | 'kept_device' | 'kept_account';

export interface RedeemResult {
  playerId: string;
  email: string;
  outcome: RedeemOutcome;
  sessionId: string | null;
}

async function hasProgress(tx: Queryable, playerId: string): Promise<boolean> {
  const row = await one<{ movement_id: string }>(
    tx,
    `select movement_id from ledger_movements where player_id = $1 and kind <> 'opening' limit 1`,
    [playerId],
  );
  return row !== null;
}

/** The coin balance and car count shown in the keep-which-garage dialog. */
async function garageSummary(playerId: string): Promise<string> {
  const coins = await balanceOf(db, playerId);
  const row = await one<{ cars: string }>(
    db,
    'select count(*)::text as cars from owned_cars where player_id = $1',
    [playerId],
  );
  const cars = Number.parseInt(row?.cars ?? '0', 10);
  return `${formatThousands(coins)} coins · ${cars} ${cars === 1 ? 'car' : 'cars'}`;
}

async function consumeToken(token: string): Promise<void> {
  await db.query('update signin_tokens set used = true where token = $1', [token]);
}

async function accountFor(email: string): Promise<PlayerRow | null> {
  return await one<PlayerRow>(
    db,
    `select player_id, name, guest, email, units, selected_car_id, trophy from players
     where lower(email) = lower($1) and retired = false`,
    [email],
  );
}

async function claimEmailForGuest(guestId: string, email: string, accountId: string | null): Promise<void> {
  if (accountId !== null) {
    await db.query('update players set email = null, retired = true where player_id = $1', [
      accountId,
    ]);
  }
  await db.query(
    'update players set email = $2, guest = false, name = $3 where player_id = $1',
    [guestId, email, accountName(email)],
  );
}

/** Opens a sign-in link: moves the guest garage into the account, or asks which to keep. */
export async function redeemSigninLink(
  token: unknown,
  keep: unknown,
  guest: PlayerRow | null,
): Promise<RedeemResult> {
  if (typeof token !== 'string') throw validationFailed({ token: 'Open the link from your email.' });
  if (keep !== undefined && keep !== null && keep !== 'device' && keep !== 'account') {
    throw validationFailed({ keep: 'Choose which garage to keep.' });
  }
  const row = await one<{ email: string; used: boolean; expired: boolean }>(
    db,
    `select email, used, (expires_at < now()) as expired from signin_tokens where token = $1`,
    [token],
  );
  if (!row || row.used || row.expired) {
    throw gone('LINK_EXPIRED', 'This sign-in link has expired or was already used.');
  }
  const email = row.email;
  const account = await accountFor(email);
  const guestPlayer = guest !== null && guest.guest ? guest : null;

  if (guestPlayer === null) {
    if (account === null) {
      const created = await createPlayer({
        guest: false,
        name: accountName(email),
        email,
        cars: ['kestrel-hatch'],
        balance: OPENING_BALANCE,
      });
      await consumeToken(token);
      return {
        playerId: created.playerId,
        email,
        outcome: 'new_account',
        sessionId: created.sessionId,
      };
    }
    const sessionId = await withPlayerLock(account.player_id, (tx) =>
      createSession(tx, account.player_id),
    );
    await consumeToken(token);
    return { playerId: account.player_id, email, outcome: 'signed_in', sessionId };
  }

  if (account === null) {
    await claimEmailForGuest(guestPlayer.player_id, email, null);
    await consumeToken(token);
    return {
      playerId: guestPlayer.player_id,
      email,
      outcome: 'new_account',
      sessionId: null,
    };
  }

  const guestProgress = await hasProgress(db, guestPlayer.player_id);
  const accountProgress = await hasProgress(db, account.player_id);
  let decision: 'device' | 'account';
  let outcome: RedeemOutcome;
  if (guestProgress && accountProgress) {
    if (keep !== 'device' && keep !== 'account') {
      throw new ApiError(409, 'GARAGE_CHOICE_REQUIRED', 'Choose which garage to keep.', {
        device: await garageSummary(guestPlayer.player_id),
        account: await garageSummary(account.player_id),
      });
    }
    decision = keep;
    outcome = keep === 'device' ? 'kept_device' : 'kept_account';
  } else if (guestProgress) {
    decision = 'device';
    outcome = 'kept_device';
  } else if (accountProgress) {
    decision = 'account';
    outcome = 'kept_account';
  } else {
    decision = 'account';
    outcome = 'signed_in';
  }

  if (decision === 'device') {
    await claimEmailForGuest(guestPlayer.player_id, email, account.player_id);
    await consumeToken(token);
    return { playerId: guestPlayer.player_id, email, outcome, sessionId: null };
  }

  await db.query('update players set retired = true where player_id = $1', [
    guestPlayer.player_id,
  ]);
  const sessionId = await withPlayerLock(account.player_id, (tx) =>
    createSession(tx, account.player_id),
  );
  await consumeToken(token);
  return { playerId: account.player_id, email, outcome, sessionId };
}

export function emailFieldError(): ApiError {
  return validationFailed({ email: 'Enter a valid email address.' });
}
