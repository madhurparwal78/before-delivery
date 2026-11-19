// Sign-in links: token issue, email, redeem with the keep-which-garage rule.
import type { Db } from './db.js';
import type { Config } from './config.js';
import { tokenHex, shortId } from './ids.js';
import { ApiError, linkExpired, validationFailed, mailUnavailable } from './errors.js';
import { sendMail } from './mailer.js';
import { movementsOf } from './ledger.js';
import { createSession, playerForSession } from './game.js';
import { OPENING_BALANCE } from '../shared/domain.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestLink(cfg: Config, db: Db, email: string): Promise<void> {
  const token = tokenHex(24);
  const expiresAt = new Date(Date.now() + cfg.signinLinkTtlSeconds * 1000);
  await db.query('INSERT INTO signin_links (token, email, expires_at) VALUES ($1,$2,$3)', [token, email, expiresAt]);
  const link = `${cfg.publicUrl}/sign-in/${token}`;
  const ok = await sendMail(cfg.mail.smtpHost, cfg.mail.smtpPort, {
    from: cfg.mail.mailFrom,
    to: email,
    subject: 'Your Kerbline sign-in link',
    text: link
  });
  if (!ok) {
    await db.query('DELETE FROM signin_links WHERE token = $1', [token]);
    throw mailUnavailable();
  }
}

export interface RedeemOutcome {
  playerId: string;
  email: string;
  outcome: 'new_account' | 'signed_in' | 'kept_device' | 'kept_account';
}

export async function redeemLink(db: Db, token: string, keep: 'device' | 'account' | undefined,
                                 sessionToken: string | undefined): Promise<{ outcome: RedeemOutcome; session: string }> {
  const guest = sessionToken ? await playerForSession(db, sessionToken) : null;

  // Validate and consume the link first (single-use).
  const linkR = await db.query('SELECT email, used_at, expires_at FROM signin_links WHERE token = $1', [token]);
  if (linkR.rows.length === 0) throw linkExpired();
  const link = linkR.rows[0];
  if (link.used_at !== null || (link.expires_at as Date).getTime() < Date.now()) {
    throw linkExpired();
  }
  const email = link.email as string;

  // Find the account for this email.
  const accountR = await db.query('SELECT player_id, retired FROM players WHERE email = $1 AND guest = false', [email]);
  const account = accountR.rows[0] ?? null;

  // Case: no guest session.
  if (!guest) {
    await db.query('UPDATE signin_links SET used_at = now() WHERE token = $1', [token]);
    if (account) {
      const session = await createSession(db, account.player_id);
      return { outcome: { playerId: account.player_id, email, outcome: 'signed_in' }, session };
    }
    // New player with a Kestrel Hatch.
    const playerId = `p_${shortId(10)}`;
    await db.query('INSERT INTO players (player_id, name, guest, email, units) VALUES ($1,$2,false,$3,$4)', [playerId, email.split('@')[0], email, 'kmh']);
    await db.query('INSERT INTO owned_cars (player_id, car_id, selected) VALUES ($1,$2,true)', [playerId, 'kestrel-hatch']);
    await db.query('INSERT INTO ledger (movement_id, player_id, kind, wallet_amount, counter_account, counter_amount) VALUES ($1,$2,$3,$4,$5,$6)', [`mv_${playerId}_opening`, playerId, 'opening', OPENING_BALANCE, 'house:grants', -OPENING_BALANCE]);
    const session = await createSession(db, playerId);
    return { outcome: { playerId, email, outcome: 'new_account' }, session };
  }

  // Case: guest session exists.
  if (account && account.player_id === guest.playerId) {
    // The guest already owns this email: just sign in.
    await db.query('UPDATE signin_links SET used_at = now() WHERE token = $1', [token]);
    const session = await createSession(db, guest.playerId);
    return { outcome: { playerId: guest.playerId, email, outcome: 'signed_in' }, session };
  }

  const guestHasProgress = await hasProgress(db, guest.playerId);
  if (!account) {
    // The guest garage becomes the account.
    await db.query('UPDATE signin_links SET used_at = now() WHERE token = $1', [token]);
    await db.query('UPDATE players SET guest = false, email = $2 WHERE player_id = $1', [guest.playerId, email]);
    const session = await createSession(db, guest.playerId);
    return { outcome: { playerId: guest.playerId, email, outcome: 'new_account' }, session };
  }

  const accountHasProgress = await hasProgress(db, account.player_id);

  if (guestHasProgress && accountHasProgress) {
    if (!keep) {
      throw new ApiError(409, 'GARAGE_CHOICE_REQUIRED', 'Choose which garage to keep.');
    }
    await db.query('UPDATE signin_links SET used_at = now() WHERE token = $1', [token]);
    if (keep === 'device') {
      await db.query('UPDATE players SET retired = true WHERE player_id = $1', [account.player_id]);
      await db.query('UPDATE players SET guest = false, email = $2 WHERE player_id = $1', [guest.playerId, email]);
      const session = await createSession(db, guest.playerId);
      return { outcome: { playerId: guest.playerId, email, outcome: 'kept_device' }, session };
    }
    await db.query('UPDATE players SET retired = true WHERE player_id = $1', [guest.playerId]);
    const session = await createSession(db, account.player_id);
    return { outcome: { playerId: account.player_id, email, outcome: 'kept_account' }, session };
  }

  await db.query('UPDATE signin_links SET used_at = now() WHERE token = $1', [token]);
  if (guestHasProgress && !accountHasProgress) {
    await db.query('UPDATE players SET retired = true WHERE player_id = $1', [account.player_id]);
    await db.query('UPDATE players SET guest = false, email = $2 WHERE player_id = $1', [guest.playerId, email]);
    const session = await createSession(db, guest.playerId);
    return { outcome: { playerId: guest.playerId, email, outcome: 'kept_device' }, session };
  }
  // Neither has progress, or only the account has progress: keep the account.
  if (guestHasProgress === false && accountHasProgress === false) {
    await db.query('UPDATE players SET retired = true WHERE player_id = $1', [guest.playerId]);
    const session = await createSession(db, account.player_id);
    return { outcome: { playerId: account.player_id, email, outcome: 'signed_in' }, session };
  }
  await db.query('UPDATE players SET retired = true WHERE player_id = $1', [guest.playerId]);
  const session = await createSession(db, account.player_id);
  return { outcome: { playerId: account.player_id, email, outcome: 'kept_account' }, session };
}

async function hasProgress(db: Db, playerId: string): Promise<boolean> {
  const moves = await movementsOf(db, playerId);
  return moves.some(m => m.kind !== 'opening');
}

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw validationFailed({ email: 'Enter a valid email address.' });
  }
  return email;
}
