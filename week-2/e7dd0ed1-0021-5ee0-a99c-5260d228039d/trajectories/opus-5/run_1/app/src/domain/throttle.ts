import { query } from '../db';
import { config } from '../config';
import { RateLimited } from '../errors';

/** Sign-in throttling: five failures per email inside the window, counted for any credential check. */
export async function checkSignInThrottle(email: string): Promise<void> {
  const found = await query<{ at: string }>(
    `select at from signin_failures where lower(email) = lower($1) and at > now() - ($2 || ' seconds')::interval
     order by at asc`,
    [email, String(config.timing.signinWindow)],
  );
  if (found.length < 5) return;
  const oldest = new Date(found[0].at).getTime();
  const retryAfter = Math.max(1, Math.ceil((oldest + config.timing.signinWindow * 1000 - Date.now()) / 1000));
  throw new RateLimited(retryAfter, `Too many sign-in attempts. Try again in ${retryAfter} seconds.`);
}

export async function recordSignInFailure(email: string): Promise<void> {
  await query('insert into signin_failures (email, at) values ($1, now())', [email]);
}

export async function clearSignInFailures(email: string): Promise<void> {
  await query('delete from signin_failures where lower(email) = lower($1)', [email]);
}
