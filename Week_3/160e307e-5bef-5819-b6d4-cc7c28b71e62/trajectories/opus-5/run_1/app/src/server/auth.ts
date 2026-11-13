import { randomBytes } from 'node:crypto';
import { one, query } from './db.js';
import { ApiError, conflict, unprocessable } from './errors.js';
import { env } from './env.js';
import { sendSignInLink } from './mail.js';
import { newSessionFor, playerById } from './players.js';
import type { PlayerRow } from './players.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function emailValid(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export async function requestLink(player: PlayerRow, email: string): Promise<void> {
  if (!emailValid(email)) throw unprocessable('EMAIL_INVALID');
  const normalised = email.toLowerCase();
  if (player.email !== null && player.email !== normalised) throw conflict('ALREADY_LINKED');

  const token = randomBytes(24).toString('base64url');
  const accepted = await sendSignInLink(email, token);
  if (!accepted) throw new ApiError(503, 'MAIL_UNAVAILABLE');
  await query(
    `insert into link_tokens (token, player_id, email, expires_at)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [token, player.id, normalised, String(env.magicLinkSeconds)],
  );
}

export type LinkOutcome =
  | { kind: 'linked'; email: string; sessionId: string | null }
  | { kind: 'signed-in'; name: string; sessionId: string }
  | { kind: 'expired' };

/** Tokens are single use. An email that already belongs to another player signs in as them. */
export async function openLink(token: string, currentPlayerId: string | null): Promise<LinkOutcome> {
  const row = await one<{ token: string; player_id: string; email: string }>(
    `update link_tokens set used = true
     where token = $1 and used = false and expires_at > now()
     returning token, player_id, email`,
    [token],
  );
  if (row === null) return { kind: 'expired' };

  const owner = await one<{ id: string; name: string }>('select id, name from players where email = $1', [
    row.email,
  ]);
  if (owner !== null && owner.id !== row.player_id) {
    return { kind: 'signed-in', name: owner.name, sessionId: await newSessionFor(owner.id) };
  }
  const target = await playerById(row.player_id);
  if (target === null) return { kind: 'expired' };
  if (target.email === null) {
    await query('update players set email = $2 where id = $1', [target.id, row.email]);
  }
  const sessionId = currentPlayerId === target.id ? null : await newSessionFor(target.id);
  return { kind: 'linked', email: row.email, sessionId };
}
