import { query, withTransaction } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { publishNow } from '../jobs/events.js';
import type { Caller } from '../http/session.js';
import {
  findTransition,
  illegalTransitionMessage,
  type CommissionState,
  type TransitionActor,
  type TransitionChannel,
} from '../../shared/states.js';
import { layoutIsComplete } from '../../shared/placement.js';
import type { MilestoneKey, PieceKind } from '../../shared/seed.js';
import {
  installDayOf,
  listMilestones,
  milestoneByKey,
  requiredPiecesOf,
  setState,
  type CommissionRow,
} from './commissions.js';
import { invoiceMilestone } from './billing.js';
import { releaseHold } from './holds.js';

/** Commissions move only along the published transitions, by the published roles. */

function illegal(from: CommissionState, to: CommissionState): ApiError {
  return new ApiError(409, 'illegal_transition', illegalTransitionMessage(from, to), { from, to });
}

async function actorsOf(commission: CommissionRow, caller: Caller): Promise<TransitionActor[]> {
  const actors: TransitionActor[] = [];
  if (caller.user.roles.includes('producer')) actors.push('producer');
  if (commission.client_id === caller.user.id) actors.push('client_owner');
  if (caller.user.roles.includes('crew')) {
    const day = await installDayOf(commission.id);
    if (day?.crew_user_ids.includes(caller.user.id)) actors.push('assigned_crew');
  }
  return actors;
}

/** The milestone a move waits on, when it waits on one. */
async function assertGuard(
  commission: CommissionRow,
  requires: MilestoneKey | undefined,
): Promise<void> {
  if (!requires) return;
  const milestones = await listMilestones(commission.id);
  const milestone = milestoneByKey(milestones, requires);
  if (!milestone || milestone.state !== 'paid') {
    throw new ApiError(409, 'milestone_unpaid', undefined, { milestoneId: milestone?.id ?? null });
  }
}

/**
 * Perform a move asked for through the transitions endpoint. An automatic move,
 * an illegal move, or a move by the wrong role answers the published 409.
 */
export async function applyRequestedTransition(
  commission: CommissionRow,
  to: CommissionState,
  caller: Caller,
): Promise<void> {
  const transition = findTransition(commission.state, to, 'transitions');
  if (!transition) throw illegal(commission.state, to);

  const actors = await actorsOf(commission, caller);
  if (!transition.actors.some((allowed) => actors.includes(allowed))) {
    throw new ApiError(403, 'forbidden');
  }
  await assertGuard(commission, transition.requiresPaidMilestone);

  if (to === 'cancelled') {
    await releaseHold(commission.id);
    await query('DELETE FROM install_days WHERE commission_id = $1', [commission.id]);
    await withTransaction((tx) => setState(tx, commission.id, 'cancelled'));
    await announce(commission.id, 'cancelled');
    return;
  }

  await withTransaction((tx) => setState(tx, commission.id, to));
  await announce(commission.id, to);

  if (to === 'installed') {
    await query(
      `UPDATE install_days SET confirmed_at = now()
        WHERE commission_id = $1 AND confirmed_at IS NULL`,
      [commission.id],
    );
  }

  const triggered = MILESTONE_FOR_STATE[to];
  if (triggered) {
    const milestones = await listMilestones(commission.id);
    const milestone = milestoneByKey(milestones, triggered);
    if (milestone) {
      await invoiceMilestone({ ...commission, state: to }, milestone, new Date());
    }
  }
}

/** The milestone each move invoices. */
const MILESTONE_FOR_STATE: Partial<Record<CommissionState, MilestoneKey>> = {
  concept_approved: 'concept_approval',
  fabricating: 'fabrication',
  accepted: 'signed_acceptance',
};

async function announce(commissionId: string, state: CommissionState): Promise<void> {
  const result = await query<{ client_id: string }>(
    'SELECT client_id FROM commissions WHERE id = $1',
    [commissionId],
  );
  const clientId = result.rows[0]?.client_id;
  await publishNow({
    type: 'commission.updated',
    commissionId,
    state,
    audience: clientId ? [clientId, 'producer'] : ['producer'],
  });
}

/**
 * Record a move made through a channel other than the transitions endpoint:
 * the moves the product makes on its own, and the one the maintenance
 * endpoint makes. The move still has to appear in the published table.
 */
export async function advanceState(
  commissionId: string,
  from: CommissionState,
  to: CommissionState,
  channel: TransitionChannel = 'automatic',
): Promise<boolean> {
  if (!findTransition(from, to, channel)) return false;
  const result = await query<{ id: string }>(
    `UPDATE commissions SET state = $3, updated_at = now()
      WHERE id = $1 AND state = $2
      RETURNING id`,
    [commissionId, from, to],
  );
  if (result.rows[0]) {
    await announce(commissionId, to);
    return true;
  }
  return false;
}

/** briefed becomes previewed as soon as a render is ready. */
export async function markPreviewed(commissionId: string): Promise<void> {
  await advanceState(commissionId, 'briefed', 'previewed');
}

/** previewed becomes placed as soon as the layout holds every required piece. */
export async function markPlacedIfComplete(commission: CommissionRow): Promise<void> {
  const required = requiredPiecesOf(commission) as PieceKind[];
  if (!layoutIsComplete(commission.layout_items, required)) return;
  await advanceState(commission.id, 'previewed', 'placed');
}

export { illegal as illegalTransition };
