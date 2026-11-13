import * as pg from 'pg';
import type { PocketBaseClient } from './pocketbase';
import type { StorageClient } from './storage';
import type { BroadcastHub } from './hub';
import { randomId } from './util';
import { setOperatorPocketbaseId, OPERATOR_POCKETBASE_ID } from './operatorIdentity';

export const OPERATOR_EMAIL = 'operator@sideline.test';
export const OPERATOR_PASSWORD = 'chalk-and-floodlights-26';
export const OPERATOR_TEAM_NAME = 'Operations';

export type ManagerRole = 'manager' | 'operator';

export interface AccountRecord {
  id: string;
  pocketbase_id: string;
  team_name: string;
  role: ManagerRole;
  email: string;
}

export class AccountUnavailable extends Error {
  constructor() {
    super('accounts_unavailable');
  }
}

export class Accounts {
  constructor(
    private readonly pool: pg.Pool,
    private readonly pocketbase: PocketBaseClient,
    private readonly storage: StorageClient,
    private readonly hub: BroadcastHub,
  ) {}

  async ensureOperatorAccount(): Promise<void> {
    try {
      let user = await this.pocketbase.findUserByEmail(OPERATOR_EMAIL);
      if (user === null) {
        user = await this.pocketbase.createUser(OPERATOR_EMAIL, OPERATOR_PASSWORD, OPERATOR_TEAM_NAME);
      }
      setOperatorPocketbaseId(user.id);
      const existing = await this.pool.query<{ id: string }>(
        'SELECT id FROM managers WHERE pocketbase_id = $1',
        [user.id],
      );
      if (existing.rows.length === 0) {
        await this.pool.query(
          `INSERT INTO managers (id, pocketbase_id, team_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [randomId(12), user.id, OPERATOR_TEAM_NAME],
        );
      }
    } catch {
      // PocketBase unreachable: retried by the background catch-up task.
    }
  }

  async signUp(email: string, password: string, teamName: string): Promise<AccountRecord> {
    const existing = await this.pocketbase.findUserByEmail(email);
    if (existing !== null) {
      const error = new Error('email_taken') as Error & { code?: string };
      error.code = 'email_taken';
      throw error;
    }
    const user = await this.pocketbase.createUser(email, password, teamName);
    const managerId = randomId(12);
    await this.pool.query(
      `INSERT INTO managers (id, pocketbase_id, team_name) VALUES ($1, $2, $3)
       ON CONFLICT (pocketbase_id) DO NOTHING`,
      [managerId, user.id, teamName],
    );
    const row = await this.pool.query<{ id: string }>(
      'SELECT id FROM managers WHERE pocketbase_id = $1',
      [user.id],
    );
    return {
      id: row.rows[0].id,
      pocketbase_id: user.id,
      team_name: teamName,
      role: 'manager',
      email,
    };
  }

  async signIn(email: string, password: string): Promise<AccountRecord> {
    const user = await this.pocketbase.authUser(email, password);
    const role: ManagerRole = user.id === OPERATOR_POCKETBASE_ID() ? 'operator' : 'manager';
    const existing = await this.pool.query<{ id: string; team_name: string }>(
      'SELECT id, team_name FROM managers WHERE pocketbase_id = $1',
      [user.id],
    );
    let recordId = existing.rows[0]?.id;
    let teamName = existing.rows[0]?.team_name ?? user.name;
    if (recordId === undefined) {
      recordId = randomId(12);
      teamName = user.name;
      await this.pool.query(
        'INSERT INTO managers (id, pocketbase_id, team_name) VALUES ($1, $2, $3)',
        [recordId, user.id, teamName],
      );
    } else if (existing.rows[0].team_name !== user.name) {
      await this.pool.query('UPDATE managers SET team_name = $1 WHERE id = $2', [user.name, recordId]);
      teamName = user.name;
    }
    return { id: recordId, pocketbase_id: user.id, team_name: teamName, role, email };
  }
}
