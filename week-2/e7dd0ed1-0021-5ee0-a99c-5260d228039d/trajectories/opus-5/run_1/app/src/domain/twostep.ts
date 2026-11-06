import type { PoolClient } from '../db';
import { row } from '../db';
import { seal, sha256Hex, unseal } from '../crypto/seal';
import { matchStep, normaliseRecoveryCode } from '../crypto/totp';

export interface TwoStepUser {
  id: string;
  email: string;
  two_step_state: string;
  two_step_secret_sealed: string | null;
  two_step_setup_sealed: string | null;
  two_step_enabled_at: string | null;
  last_accepted_step: string | null;
}

export async function loadTwoStep(client: PoolClient, userId: string): Promise<TwoStepUser | null> {
  return row<TwoStepUser>(
    client,
    `select id, email, two_step_state, two_step_secret_sealed, two_step_setup_sealed, two_step_enabled_at, last_accepted_step
     from users where id = $1 for update`,
    [userId],
  );
}

export function isEnrolled(state: string): boolean {
  return state === 'on';
}

/**
 * The one authenticator check: a code is accepted only for a step later than the user's last
 * accepted step, which it then records. Shared by the sign-in code step, step-up, enable and disable.
 */
export async function acceptAuthenticatorCode(
  client: PoolClient,
  user: TwoStepUser,
  code: string,
  options: { useSetupSecret?: boolean } = {},
): Promise<boolean> {
  const sealed = options.useSetupSecret ? user.two_step_setup_sealed : user.two_step_secret_sealed;
  if (!sealed) return false;
  const step = matchStep(unseal(sealed), code);
  if (step === null) return false;
  const last = user.last_accepted_step === null ? null : Number(user.last_accepted_step);
  if (last !== null && step <= last) return false;
  await client.query('update users set last_accepted_step = $2 where id = $1', [user.id, step]);
  return true;
}

export async function acceptRecoveryCode(client: PoolClient, userId: string, code: string): Promise<boolean> {
  const hash = sha256Hex(normaliseRecoveryCode(code));
  const used = await row<{ code_hash: string }>(
    client,
    'update recovery_codes set used = true where user_id = $1 and code_hash = $2 and not used returning code_hash',
    [userId, hash],
  );
  return used !== null;
}

export async function recoveryCodesLeft(client: PoolClient, userId: string): Promise<number> {
  const found = await row<{ count: string }>(client, 'select count(*)::text as count from recovery_codes where user_id = $1 and not used', [
    userId,
  ]);
  return Number(found?.count ?? '0');
}

export async function storeRecoveryCodes(client: PoolClient, userId: string, codes: string[]): Promise<void> {
  await client.query('delete from recovery_codes where user_id = $1', [userId]);
  for (const code of codes) {
    await client.query('insert into recovery_codes (user_id, code_hash) values ($1, $2) on conflict do nothing', [
      userId,
      sha256Hex(normaliseRecoveryCode(code)),
    ]);
  }
}

export function sealSecret(secret: string): string {
  return seal(secret);
}

export const codeFieldMessages = {
  wrongCode: 'That code didn\u2019t work. Use the current code from your app.',
  wrongRecovery: 'That recovery code didn\u2019t work or was already used.',
  oneOf: 'Enter a code from your app or a recovery code.',
};
