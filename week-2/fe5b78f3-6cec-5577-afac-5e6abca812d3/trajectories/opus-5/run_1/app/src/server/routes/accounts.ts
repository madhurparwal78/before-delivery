import { randomBytes, randomUUID } from 'node:crypto';
import type { Account, RequestContext, Route } from '../http/context';
import { requireAccount } from '../http/context';
import type { FieldErrors } from '../http/errors';
import { FIELD_MESSAGES, errors } from '../http/errors';
import { hashPassword, verifyPassword } from '../passwords';
import { isEmail, isName, isPhone } from '../service/validate';

export const SESSION_COOKIE = 'pakka_session';

function accountBody(account: Account): Record<string, unknown> {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
  };
}

async function startSession(context: RequestContext, accountId: string): Promise<void> {
  const id = randomBytes(32).toString('base64url');
  await context.app.database.query('insert into sessions (id, account_id) values ($1, $2)', [
    id,
    accountId,
  ]);
  context.setCookie(`${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`);
}

function readStrings(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

export const accountRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/accounts',
    auth: 'optional',
    handler: async (context) => {
      const input = readStrings(context.body);
      const fields: FieldErrors = {};
      if (!isName(input.name)) fields.name = FIELD_MESSAGES.name;
      if (!isEmail(input.email)) fields.email = FIELD_MESSAGES.email;
      if (typeof input.password !== 'string' || input.password.length < 10) {
        fields.password = FIELD_MESSAGES.password;
      }
      if (!isPhone(input.phone)) fields.phone = FIELD_MESSAGES.phone;
      if (Object.keys(fields).length > 0) throw errors.validation(fields);

      const email = (input.email as string).toLowerCase();
      const existing = await context.app.database.query<{ id: string }>(
        'select id from accounts where email = $1',
        [email],
      );
      if (existing.length > 0) throw errors.emailTaken();
      const id = randomUUID();
      const name = (input.name as string).trim();
      const phone = input.phone as string;
      await context.app.database.query(
        `insert into accounts (id, name, email, password_hash, phone)
         values ($1, $2, $3, $4, $5)`,
        [id, name, email, await hashPassword(input.password as string), phone],
      );
      await startSession(context, id);
      return {
        status: 201,
        json: accountBody({ id, name, email, phone, killbill_account_id: null }),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/session',
    auth: 'optional',
    handler: async (context) => {
      const input = readStrings(context.body);
      if (typeof input.email !== 'string' || typeof input.password !== 'string') {
        throw errors.invalidCredentials();
      }
      const rows = await context.app.database.query<Account & { password_hash: string }>(
        `select id, name, email, phone, killbill_account_id, password_hash
         from accounts where email = $1`,
        [input.email.toLowerCase()],
      );
      const account = rows[0];
      if (account === undefined || !await verifyPassword(input.password, account.password_hash)) {
        throw errors.invalidCredentials();
      }
      await startSession(context, account.id);
      return { status: 200, json: accountBody(account) };
    },
  },
  {
    method: 'DELETE',
    path: '/api/session',
    auth: 'optional',
    handler: async (context) => {
      if (context.sessionId !== null) {
        await context.app.database.query('delete from sessions where id = $1', [context.sessionId]);
      }
      context.setCookie(`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'required',
    handler: async (context) => ({ status: 200, json: accountBody(requireAccount(context)) }),
  },
];
