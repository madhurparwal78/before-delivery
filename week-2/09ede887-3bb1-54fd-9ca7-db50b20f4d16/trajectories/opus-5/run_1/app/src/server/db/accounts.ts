import type { Database } from './pool.js';
import { isUniqueViolation } from './pool.js';
import { DECOY_PASSWORD_HASH, hashPassword, newToken, verifyPassword } from '../domain/passwords.js';
import { conflict, invalidCredentials, rateLimited, unavailable } from '../http/errors.js';

export type Role = 'attendee' | 'organiser';

export interface Account {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export class Accounts {
  constructor(
    private readonly database: Database,
    private readonly throttleWindowSeconds: number,
  ) {}

  async signup(name: string, email: string, password: string): Promise<{ token: string; account: Account }> {
    const passwordHash = await hashPassword(password);
    try {
      const inserted = await this.database.query<Account>(
        `INSERT INTO accounts (name, email, password_hash, role) VALUES ($1, $2, $3, 'attendee')
         RETURNING id, name, email, role`,
        [name, email, passwordHash],
      );
      const account = inserted.rows[0];
      if (account === undefined) throw unavailable();
      return { token: await this.issueToken(account.id), account };
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('email_taken');
      throw error;
    }
  }

  /**
   * Both an unknown email and a wrong password run the same slow check and
   * answer identically, so neither reveals whether the account exists.
   */
  async login(email: string, password: string): Promise<{ token: string; account: Account }> {
    const retryAfter = await this.throttleRetryAfter(email);
    if (retryAfter !== null) throw rateLimited(retryAfter);
    const found = await this.database.query<Account & { password_hash: string }>(
      'SELECT id, name, email, role, password_hash FROM accounts WHERE email = $1',
      [email],
    );
    const row = found.rows[0];
    const matched = await verifyPassword(password, row?.password_hash ?? DECOY_PASSWORD_HASH);
    if (row === undefined || !matched) {
      await this.database.query('INSERT INTO signin_failures (email) VALUES ($1)', [email]);
      throw invalidCredentials();
    }
    const account: Account = { id: row.id, name: row.name, email: row.email, role: row.role };
    return { token: await this.issueToken(account.id), account };
  }

  /** Whole seconds until fewer than five failures remain inside the window. */
  private async throttleRetryAfter(email: string): Promise<number | null> {
    const result = await this.database.query<{ retry_after: number | null }>(
      `WITH recent AS (
         SELECT failed_at FROM signin_failures
          WHERE email = $1 AND failed_at > now() - make_interval(secs => $2)
          ORDER BY failed_at DESC
       )
       SELECT CEIL(EXTRACT(EPOCH FROM (
                (SELECT failed_at FROM recent ORDER BY failed_at DESC OFFSET 4 LIMIT 1)
                + make_interval(secs => $2) - now())))::int AS retry_after
         WHERE (SELECT count(*) FROM recent) >= 5`,
      [email, this.throttleWindowSeconds],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return Math.max(1, row.retry_after ?? 1);
  }

  private async issueToken(accountId: number): Promise<string> {
    const token = newToken();
    await this.database.query('INSERT INTO tokens (token, account_id) VALUES ($1, $2)', [token, accountId]);
    return token;
  }

  async logout(token: string): Promise<void> {
    await this.database.query('DELETE FROM tokens WHERE token = $1', [token]);
  }

  /** Every role check reads the role stored on the account behind the token. */
  async accountForToken(token: string): Promise<Account | null> {
    const result = await this.database.query<Account>(
      `SELECT a.id, a.name, a.email, a.role FROM tokens t JOIN accounts a ON a.id = t.account_id
        WHERE t.token = $1`,
      [token],
    );
    return result.rows[0] ?? null;
  }
}
