import { query, queryOne, transact, withAdvisoryLock } from './pool';
import { SCHEMA_SQL } from './schema';
import { applySeed, SEED_ACCOUNTS } from './seed';
import { ensureRealmRoles, ensureUser, findUserIdByEmail, type RealmRole } from '../services/keycloak';

/**
 * Schema and seed apply exactly once per database, under a database-wide lock,
 * so instances started at the same moment on one empty database agree.
 */
export async function ensureSchemaAndSeed(): Promise<void> {
  await withAdvisoryLock('boltrope-boot', async () => {
    await query(SCHEMA_SQL);
    const marker = await queryOne<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seeded'`);
    if (marker !== null) return;
    await transact(async (tx) => {
      await applySeed(tx);
    });
  });
}

interface StoredAccount {
  readonly email: string;
  readonly display_name: string;
  readonly role: string;
  readonly keycloak_user_id: string | null;
  readonly seeded_password: string | null;
}

/**
 * Makes sure the realm holds the three roles and a user for every stored,
 * non-deleted seeded account. A missing user is re-created, with no restart.
 */
export async function reconcileIdentity(): Promise<void> {
  await ensureRealmRoles();
  const accounts = await query<StoredAccount>(
    `SELECT email, display_name, role, keycloak_user_id, seeded_password
       FROM account
      WHERE deleted = false AND seeded_password IS NOT NULL
      ORDER BY id`,
  );
  const seededPasswords = new Map(SEED_ACCOUNTS.map((account) => [account.email, account.password]));
  for (const account of accounts) {
    const password = account.seeded_password ?? seededPasswords.get(account.email);
    if (password === undefined) continue;
    const existing = await findUserIdByEmail(account.email);
    if (existing !== null && existing === account.keycloak_user_id) continue;
    const userId = await ensureUser(account.email, account.display_name, account.role as RealmRole, password);
    await query('UPDATE account SET keycloak_user_id = $2 WHERE email = $1', [account.email, userId]);
  }
}
