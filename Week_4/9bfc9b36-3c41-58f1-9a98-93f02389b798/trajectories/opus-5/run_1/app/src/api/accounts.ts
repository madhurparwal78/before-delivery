import { query, queryOne, transact } from '../db/pool';
import { notFound, refuse } from '../http/errors';
import { FIELD_COPY } from '../shared/copy';
import { accountView, type AccountRow } from '../domain/model';
import { Check, normaliseEmail } from '../domain/validate';
import { audit, nextCode } from '../domain/records';
import { deleteUser, ensureUser, type RealmRole } from '../services/keycloak';
import { answerPage, numericIdSql, padNumber, pageClause } from './lists';
import { onlyRoles } from './visibility';
import { jsonBody, reply, signedIn, type Ctx, type Reply } from './types';

/** Accounts are made by the sailmaker, and no action ever changes a role. */

export async function listAccounts(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  const order = { at: null, id: numericIdSql('id') };
  const clause = pageClause(ctx, {}, order, 1);
  const page = await answerPage<AccountRow, Record<string, unknown>>(
    clause,
    {
      sql: `SELECT * FROM account WHERE deleted = false ${clause.where}
             ORDER BY code_number(id) DESC LIMIT ${clause.limit + 1}`,
      values: clause.values,
      countSql: 'SELECT count(*)::text n FROM account WHERE deleted = false',
      countValues: [],
      position: (row) => ({ at: '', id: padNumber(row.id) }),
    },
    (row) => accountView(row),
  );
  return reply(200, page);
}

export async function createAccount(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const body = jsonBody(ctx);
  const check = new Check(body);
  const rawEmail = check.email('email');
  const displayName = check.text('display_name', 1, 80);
  const password = check.password('password');
  const role = check.choice<'yacht-owner' | 'loft-hand'>('role', ['yacht-owner', 'loft-hand'], FIELD_COPY.role);
  check.done();
  const email = normaliseEmail(rawEmail);

  // One email, one account: the unique index settles two simultaneous creates.
  const created = await transact(async (tx) => {
    const existing = await tx.one<AccountRow>('SELECT * FROM account WHERE email = $1', [email]);
    if (existing !== null) throw refuse('email_taken');
    const id = await nextCode(tx, 'account');
    const row = await tx.one<AccountRow>(
      `INSERT INTO account (id, email, display_name, role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [id, email, displayName, role],
    );
    if (row === null) throw refuse('email_taken');
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'account.create',
      target: id,
      after: role,
    });
    return row;
  });

  const userId = await ensureUser(email, displayName, role as RealmRole, password);
  await query('UPDATE account SET keycloak_user_id = $2 WHERE id = $1', [created.id, userId]);
  return reply(201, accountView({ ...created, keycloak_user_id: userId }));
}

export async function patchAccount(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const row = await queryOne<AccountRow>('SELECT * FROM account WHERE id = $1 AND deleted = false', [id]);
  if (row === null) throw notFound();
  const body = jsonBody(ctx);

  // A role change is refused and still audited.
  if (body['role'] !== undefined) {
    await transact(async (tx) => {
      await audit(tx, ctx.now, {
        actorEmail: caller.email,
        action: 'account.role_change_refused',
        target: id,
        before: row.role,
        after: row.role,
      });
    });
    throw refuse('role_change_forbidden');
  }

  const check = new Check(body);
  const displayName = check.text('display_name', 1, 80);
  check.done();
  const updated = await transact(async (tx) => {
    const next = await tx.one<AccountRow>(
      'UPDATE account SET display_name = $2 WHERE id = $1 RETURNING *',
      [id, displayName],
    );
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'account.rename',
      target: id,
      before: row.display_name,
      after: displayName,
    });
    return next as AccountRow;
  });
  return reply(200, accountView(updated));
}

export async function deleteAccount(ctx: Ctx): Promise<Reply> {
  const caller = signedIn(ctx);
  onlyRoles(caller, ['sailmaker']);
  const id = ctx.params['id'] as string;
  const row = await queryOne<AccountRow>('SELECT * FROM account WHERE id = $1 AND deleted = false', [id]);
  if (row === null) throw notFound();
  const owns = await queryOne<{ code: string }>('SELECT code FROM boat WHERE owner_email = $1 LIMIT 1', [
    row.email,
  ]);
  if (owns !== null) throw refuse('account_in_use');

  await transact(async (tx) => {
    await tx.query('UPDATE account SET deleted = true, keycloak_user_id = NULL WHERE id = $1', [id]);
    await tx.query('DELETE FROM app_session WHERE account_email = $1', [row.email]);
    await audit(tx, ctx.now, {
      actorEmail: caller.email,
      action: 'account.delete',
      target: id,
      before: row.role,
    });
  });
  if (row.keycloak_user_id !== null) await deleteUser(row.keycloak_user_id);
  return { status: 204 };
}

/** The published role table, exactly as the console shows it. */
const ROLE_ABILITIES: readonly { ability: string; sailmaker: string; 'loft-hand': string; 'yacht-owner': string }[] = [
  { ability: 'manage accounts', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'record measurements', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'submit measurements', sailmaker: 'no', 'loft-hand': 'no', 'yacht-owner': 'own boats' },
  { ability: 'decide submissions', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'draw and issue sails', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'claim, lay and cut', sailmaker: 'yes', 'loft-hand': 'assigned drawings with authority', 'yacht-owner': 'no' },
  { ability: 'manage stock and ledger', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'record payments', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'no' },
  { ability: 'view cut sheets', sailmaker: 'yes', 'loft-hand': 'no', 'yacht-owner': 'while sight is granted' },
];

export async function roleTable(ctx: Ctx): Promise<Reply> {
  onlyRoles(signedIn(ctx), ['sailmaker']);
  return reply(200, { items: ROLE_ABILITIES });
}
