import { HttpException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { DbService } from '../db.service';
import { readSession, signSession } from './tokens';
import { checkEmail, checkText, checkPassword } from '../../shared/forms';
import { PlanId } from '../../shared/catalog';

export interface MemberContext {
  user: { id: string; name: string; email: string; role: 'owner' | 'member' };
  workspace: { id: string; name: string; plan: PlanId };
}

interface AccountRow {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'member';
  token_version: number;
  workspace_id: string;
  workspace_name: string;
  plan: PlanId;
}

const ACCOUNT_QUERY = `
  select u.id, u.name, u.email, u.role, u.token_version,
         w.id as workspace_id, w.name as workspace_name, w.plan
    from users u join workspaces w on w.id = u.workspace_id
   where u.id = $1 and u.removed_at is null`;

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  async resolveSession(token: string | undefined | null): Promise<MemberContext | null> {
    const claims = readSession(token);
    if (!claims) return null;
    const result = await this.db.query<AccountRow>(ACCOUNT_QUERY, [claims.uid]).catch(() => null);
    const row = result?.rows[0];
    if (!row || row.token_version !== claims.v) return null;
    return toContext(row);
  }

  async signUp(body: { name?: unknown; email?: unknown; password?: unknown }) {
    const errors: Record<string, string> = {};
    const name = checkText(body.name, 1, 80, 'Enter a name of 1 to 80 characters.');
    if (name) errors.name = name;
    const email = checkEmail(body.email);
    if (email) errors.email = email;
    const password = checkPassword(body.password);
    if (password) errors.password = password;
    if (Object.keys(errors).length) throw new HttpException({ errors }, 422);

    const trimmedName = String(body.name).trim();
    const trimmedEmail = String(body.email).trim();
    const passwordHash = await bcrypt.hash(String(body.password), 10);

    return this.db.transaction(async (client) => {
      const workspace = await client.query<{ id: string; name: string; plan: PlanId }>(
        `insert into workspaces (name, plan) values ($1, 'free') returning id, name, plan`,
        [`${trimmedName}'s workspace`]
      );
      const user = await this.createAccount(client, {
        workspaceId: workspace.rows[0].id,
        name: trimmedName,
        email: trimmedEmail,
        passwordHash,
        role: 'owner'
      });
      await client.query(`insert into projects (workspace_id, name) values ($1, 'My first project')`, [
        workspace.rows[0].id
      ]);
      await this.db.addCreditEntry(client, {
        workspaceId: workspace.rows[0].id,
        kind: 'plan',
        amount: 125,
        userId: user.id,
        generationId: null
      });
      return {
        token: signSession({ uid: user.id, v: 0 }),
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      };
    });
  }

  /** Both ways an account is created (signing up and joining a team) land here. */
  async createAccount(
    client: PoolClient,
    account: { workspaceId: string; name: string; email: string; passwordHash: string; role: 'owner' | 'member' }
  ) {
    const existing = await client.query('select 1 from users where lower(email) = lower($1)', [account.email]);
    if (existing.rowCount) {
      throw new HttpException({ error: 'An account with this email already exists.' }, 409);
    }
    const inserted = await client.query<{ id: string; name: string; email: string; role: 'owner' | 'member' }>(
      `insert into users (workspace_id, name, email, password_hash, role)
       values ($1, $2, $3, $4, $5) returning id, name, email, role`,
      [account.workspaceId, account.name, account.email, account.passwordHash, account.role]
    );
    return inserted.rows[0];
  }

  async logIn(body: { email?: unknown; password?: unknown }) {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const result = await this.db.query<AccountRow & { password_hash: string }>(
      `select u.id, u.name, u.email, u.role, u.token_version, u.password_hash,
              w.id as workspace_id, w.name as workspace_name, w.plan
         from users u join workspaces w on w.id = u.workspace_id
        where lower(u.email) = lower($1) and u.removed_at is null`,
      [email]
    );
    const row = result.rows[0];
    const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!row || !ok) throw new HttpException({ error: 'Email or password is incorrect.' }, 401);
    return {
      token: signSession({ uid: row.id, v: row.token_version }),
      user: { id: row.id, name: row.name, email: row.email, role: row.role }
    };
  }

  async logOut(userId: string): Promise<void> {
    await this.db.query('update users set token_version = token_version + 1 where id = $1', [userId]);
  }
}

function toContext(row: AccountRow): MemberContext {
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role },
    workspace: { id: row.workspace_id, name: row.workspace_name, plan: row.plan }
  };
}
