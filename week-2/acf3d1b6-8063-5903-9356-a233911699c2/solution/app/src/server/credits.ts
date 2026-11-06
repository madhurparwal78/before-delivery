import { Controller, Get, Injectable, Req } from '@nestjs/common';
import type { CreditKind } from '../shared/catalog.js';
import { Database, type Client, type Queryable } from './database.js';
import type { SignedInRequest } from './session.js';

interface CreditEntryInput {
  workspaceId: string;
  kind: CreditKind;
  amount: number;
  userId: string;
  generationId?: string | null;
  createdAt?: string;
}

/**
 * The workspace's one balance is the sum of its credit entries. Every change to it goes through `record`, inside a
 * transaction that holds the workspace row lock, so each entry's running balance is exact.
 */
@Injectable()
export class CreditsService {
  async balance(client: Queryable, workspaceId: string): Promise<number> {
    const { rows } = await client.query<{ balance: number }>(
      'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM credit_entries entry WHERE entry.workspace_id = $1',
      [workspaceId],
    );
    return rows[0].balance;
  }

  /** Adds one entry; the caller holds the workspace lock. Returns the balance after it. */
  async record(client: Client, entry: CreditEntryInput): Promise<number> {
    const after = (await this.balance(client, entry.workspaceId)) + entry.amount;
    await client.query(
      `INSERT INTO credit_entries (workspace_id, kind, amount, balance_after, user_id, generation_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, clock_timestamp()))`,
      [entry.workspaceId, entry.kind, entry.amount, after, entry.userId, entry.generationId ?? null, entry.createdAt ?? null],
    );
    return after;
  }
}

@Controller('credits')
export class CreditsController {
  constructor(private readonly db: Database) {}

  /** The history newest first; the newest entry's running balance is the balance, read in the same statement. */
  @Get()
  async list(@Req() req: SignedInRequest) {
    const { rows } = await this.db.query<{ balance_after: number }>(
      `SELECT e.id::int AS id, e.kind, e.amount, e.balance_after, u.name AS user_name, e.generation_id, e.created_at
         FROM credit_entries e JOIN users u ON u.id = e.user_id
        WHERE e.workspace_id = $1
        ORDER BY e.id DESC`,
      [req.member.workspace.id],
    );
    return { balance: rows[0]?.balance_after ?? 0, entries: rows };
  }
}
