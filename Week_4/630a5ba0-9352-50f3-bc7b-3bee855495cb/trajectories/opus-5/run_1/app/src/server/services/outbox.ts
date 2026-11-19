import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { MemberRow, OutboxRow, WorkspaceRow } from '../db/records.js';
import { cancelSeat, ensureAccount, ensureCatalog, ensureSeat } from './killbill.js';
import { sendMail } from './smtp.js';
import { inviteMail } from './messages.js';

export type OutboxKind =
  | 'killbill_register_workspace'
  | 'killbill_add_seat'
  | 'killbill_cancel_seat'
  | 'mail';

const RETRY_DELAY_SECONDS = 1;
const CLAIM_LEASE_SECONDS = 30;
const COOLDOWN_MS = 5000;
const INSTANCE_ID = randomUUID();

type OutboxService = 'killbill' | 'mail';

const KINDS_BY_SERVICE: Record<OutboxService, OutboxKind[]> = {
  mail: ['mail'],
  killbill: ['killbill_register_workspace', 'killbill_add_seat', 'killbill_cancel_seat'],
};

/**
 * An instance that cannot reach a service stands back from its queue items for a moment,
 * so an instance that can reach it picks them up instead of losing every claim race.
 */
const cooldowns = new Map<OutboxService, number>();

function serviceOf(kind: string): OutboxService {
  return kind === 'mail' ? 'mail' : 'killbill';
}

function kindsOnCooldown(): string[] {
  const now = Date.now();
  const blocked: string[] = [];
  for (const [service, until] of cooldowns) {
    if (until > now) blocked.push(...KINDS_BY_SERVICE[service]);
  }
  return blocked;
}

export async function enqueue(
  tx: PoolClient,
  kind: OutboxKind,
  payload: Record<string, unknown>,
  dedupeKey?: string,
): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `insert into outbox (kind, payload, dedupe_key)
     values ($1, $2::jsonb, $3)
     on conflict (dedupe_key) where dedupe_key is not null do nothing
     returning id`,
    [kind, JSON.stringify(payload), dedupeKey ?? null],
  );
  return result.rows[0]?.id ?? null;
}

async function claim(id: string): Promise<OutboxRow | null> {
  const result = await pool.query<OutboxRow>(
    `update outbox
        set claimed_by = $2,
            claimed_at = now(),
            attempts = attempts + 1,
            next_attempt_at = now() + ($3 || ' seconds')::interval
      where id = $1 and status = 'pending'
      returning *`,
    [id, INSTANCE_ID, String(CLAIM_LEASE_SECONDS)],
  );
  return result.rows[0] ?? null;
}

async function claimDue(limit: number): Promise<OutboxRow[]> {
  const result = await pool.query<OutboxRow>(
    `update outbox
        set claimed_by = $1,
            claimed_at = now(),
            attempts = attempts + 1,
            next_attempt_at = now() + ($3 || ' seconds')::interval
      where id in (
        select id from outbox
         where status = 'pending'
           and next_attempt_at <= now()
           and not (kind = any($4::text[]))
         order by id
         limit $2
         for update skip locked
      )
      returning *`,
    [INSTANCE_ID, limit, String(CLAIM_LEASE_SECONDS), kindsOnCooldown()],
  );
  return result.rows;
}

async function markSent(id: string, kind: string): Promise<void> {
  cooldowns.delete(serviceOf(kind));
  await pool.query(`update outbox set status = 'sent', sent_at = now(), last_error = null where id = $1`, [id]);
}

async function markFailed(id: string, kind: string, error: unknown): Promise<void> {
  cooldowns.set(serviceOf(kind), Date.now() + COOLDOWN_MS);
  const detail = error instanceof Error ? error.message : 'unknown failure';
  await pool.query(
    `update outbox
        set next_attempt_at = now() + ($2 || ' seconds')::interval,
            last_error = $3,
            claimed_by = null
      where id = $1 and status = 'pending'`,
    [id, String(RETRY_DELAY_SECONDS), detail.slice(0, 500)],
  );
}

async function loadWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const result = await pool.query<WorkspaceRow>('select * from workspaces where id = $1', [workspaceId]);
  return result.rows[0] ?? null;
}

async function loadMember(memberId: string): Promise<MemberRow | null> {
  const result = await pool.query<MemberRow>('select * from members where id = $1', [memberId]);
  return result.rows[0] ?? null;
}

async function accountFor(workspace: WorkspaceRow): Promise<string> {
  if (workspace.killbill_account_id) return workspace.killbill_account_id;
  const owner = await pool.query<MemberRow>(
    `select * from members where workspace_id = $1 and role = 'owner' limit 1`,
    [workspace.id],
  );
  const ownerEmail = owner.rows[0]?.email ?? 'owner@tidemark.test';
  await ensureCatalog();
  const accountId = await ensureAccount({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    ownerEmail,
  });
  await pool.query('update workspaces set killbill_account_id = $2 where id = $1', [workspace.id, accountId]);
  return accountId;
}

async function registerSeat(workspaceId: string, memberId: string): Promise<void> {
  const workspace = await loadWorkspace(workspaceId);
  const member = await loadMember(memberId);
  if (!workspace || !member || member.status === 'removed') return;
  const accountId = await accountFor(workspace);
  const subscriptionId = await ensureSeat({ accountId, workspaceId, memberId });
  await pool.query('update members set killbill_subscription_id = $2, updated_at = now() where id = $1', [
    memberId,
    subscriptionId,
  ]);
}

/** Once Kill Bill accepts a queued seat, the invite becomes `invited` and its email is queued. */
async function promoteInvite(workspaceId: string, memberId: string, origin: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const member = await client.query<MemberRow>(
      `select * from members where id = $1 and status = 'pending_billing' for update`,
      [memberId],
    );
    const row = member.rows[0];
    if (!row) {
      await client.query('commit');
      return;
    }
    const workspace = await client.query<WorkspaceRow>('select * from workspaces where id = $1', [workspaceId]);
    const owner = await client.query<MemberRow>(
      `select * from members where workspace_id = $1 and role = 'owner' limit 1`,
      [workspaceId],
    );
    await client.query(`update members set status = 'invited', updated_at = now() where id = $1`, [memberId]);
    const mail = inviteMail({
      email: row.email,
      ownerName: owner.rows[0]?.name ?? 'The owner',
      workspaceName: workspace.rows[0]?.name ?? 'the workspace',
      origin,
      token: row.invite_token ?? '',
    });
    await enqueue(client, 'mail', { ...mail }, `invite:${memberId}`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function perform(item: OutboxRow): Promise<void> {
  const payload = item.payload;
  switch (item.kind as OutboxKind) {
    case 'killbill_register_workspace': {
      await registerSeat(String(payload.workspaceId), String(payload.memberId));
      return;
    }
    case 'killbill_add_seat': {
      await registerSeat(String(payload.workspaceId), String(payload.memberId));
      await promoteInvite(String(payload.workspaceId), String(payload.memberId), String(payload.origin));
      return;
    }
    case 'killbill_cancel_seat': {
      const workspace = await loadWorkspace(String(payload.workspaceId));
      if (!workspace) return;
      const accountId = await accountFor(workspace);
      await cancelSeat({
        accountId,
        workspaceId: workspace.id,
        memberId: String(payload.memberId),
        subscriptionId: payload.subscriptionId ? String(payload.subscriptionId) : null,
      });
      return;
    }
    case 'mail': {
      await sendMail({
        to: String(payload.to),
        subject: String(payload.subject),
        body: String(payload.body),
        messageId: `<outbox-${item.id}@tidemark.test>`,
      });
      return;
    }
  }
}

/** Runs one queued item now, so a request can report `sent` or `registered`. */
export async function runItemNow(id: string | null): Promise<boolean> {
  if (id === null) return false;
  const item = await claim(id);
  if (!item) return false;
  try {
    await perform(item);
    await markSent(item.id, item.kind);
    return true;
  } catch (error) {
    await markFailed(item.id, item.kind, error);
    return false;
  }
}

async function drainOnce(): Promise<void> {
  const items = await claimDue(10);
  for (const item of items) {
    try {
      await perform(item);
      await markSent(item.id, item.kind);
    } catch (error) {
      await markFailed(item.id, item.kind, error);
    }
  }
}

export function startOutboxWorker(): void {
  const tick = async (): Promise<void> => {
    try {
      await drainOnce();
    } catch {
      // The next tick retries; a database blip must not stop the worker.
    }
  };
  setInterval(() => void tick(), 1000).unref();
  void tick();
}
