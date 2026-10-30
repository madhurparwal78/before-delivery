import { PoolClient } from 'pg';
import { Author, Role, SubscriptionDto } from '../../shared/api';
import { PeriodId, PlanId, TRIAL_SEATS, planOffer } from '../../shared/plans';
import { pool, query } from '../db/pool';
import { isoOrNull } from './time';
import { randomId } from '../util/crypto';

export interface WorkspaceRow {
  id: string;
  name: string;
  time_zone: string;
  review_links_enabled: boolean;
  signing_secret: string;
  created_at: Date;
}

export interface SubscriptionRow {
  workspace_id: string;
  state: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  plan: PlanId;
  period: PeriodId;
  extra_seats: number;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  failed_at: Date | null;
  suspended_reason: string | null;
  pending_change: { plan: PlanId; period: PeriodId; extraSeats: number; effectiveAt: string } | null;
  card_last4: string | null;
  kb_account_id: string | null;
  kb_bundle_id: string | null;
  kb_base_subscription_id: string | null;
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  const rows = await query<WorkspaceRow>(`SELECT * FROM workspaces WHERE id = $1`, [workspaceId]);
  return rows[0] ?? null;
}

export async function getSubscription(workspaceId: string): Promise<SubscriptionRow> {
  const rows = await query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  const row = rows[0];
  if (!row) throw new Error(`Workspace ${workspaceId} has no subscription`);
  return row;
}

export function seatsPurchased(subscription: SubscriptionRow): number {
  if (subscription.state === 'trial') return TRIAL_SEATS;
  return planOffer(subscription.plan, subscription.period).includedSeats + subscription.extra_seats;
}

export function seatsForChoice(plan: PlanId, period: PeriodId, extraSeats: number): number {
  return planOffer(plan, period).includedSeats + extraSeats;
}

/** Seats used counts active members plus open invitations. Agent tokens never use seats. */
export async function seatsUsed(workspaceId: string, client?: PoolClient): Promise<number> {
  const runner = client ?? pool;
  const result = await runner.query<{ used: string }>(
    `SELECT (
       (SELECT count(*) FROM members WHERE workspace_id = $1 AND removed_at IS NULL)
       + (SELECT count(*) FROM invitations
            WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())
     ) AS used`,
    [workspaceId],
  );
  return Number(result.rows[0]?.used ?? 0);
}

export function subscriptionDto(subscription: SubscriptionRow): SubscriptionDto {
  return {
    state: subscription.state,
    plan: subscription.plan,
    period: subscription.period,
    seatsPurchased: seatsPurchased(subscription),
    extraSeats: subscription.extra_seats,
    trialEndsAt: isoOrNull(subscription.trial_ends_at),
    graceEndsAt: isoOrNull(subscription.grace_ends_at),
    pendingChange: subscription.pending_change,
  };
}

/** Scene work stops while the workspace is suspended or cancelled. */
export function isReadOnly(subscription: SubscriptionRow): boolean {
  return subscription.state === 'suspended' || subscription.state === 'cancelled';
}

export interface MemberRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  joined_at: Date;
  removed_at: Date | null;
}

export async function activeMembers(workspaceId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT * FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY joined_at, id`,
    [workspaceId],
  );
}

export async function billingContacts(workspaceId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT * FROM members
     WHERE workspace_id = $1 AND removed_at IS NULL AND role IN ('owner', 'billing_manager')
     ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, joined_at`,
    [workspaceId],
  );
}

export async function writeAudit(
  entry: {
    workspaceId: string;
    actor: Author;
    action: string;
    target: { type: string; id: string };
  },
  client?: PoolClient,
): Promise<void> {
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO audit_entries (id, workspace_id, actor_kind, actor_id, actor_name, action, target_type, target_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomId('aud'),
      entry.workspaceId,
      entry.actor.kind,
      entry.actor.id,
      entry.actor.name,
      entry.action,
      entry.target.type,
      entry.target.id,
    ],
  );
}

export const SCHEDULER_ACTOR: Author = { kind: 'system', id: 'system', name: 'Orrery scheduler' };
