import type { ItemStatus, JobRole, Trade } from '../../shared/domain.js';
import { type ErrorBody, errorBody } from '../errors.js';

export const ITEM_ACTIONS = ['start', 'mark_done', 'verify', 'send_back', 'reopen'] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];

export function isItemAction(value: unknown): value is ItemAction {
  return typeof value === 'string' && (ITEM_ACTIONS as readonly string[]).includes(value);
}

export type ActorOnJob = { role: JobRole; trade: Trade | null; personId: string };

export type ItemFacts = {
  status: ItemStatus;
  trade: Trade | null;
  createdBy: string;
  /** Ascending item numbers of blockers that are not verified. */
  unverifiedBlockers: number[];
  completionPhotos: number;
};

export type Transition = {
  status: ItemStatus;
  storeReason: boolean;
  clearSentBackReason: boolean;
  cascade: boolean;
};

/** May this actor even ask for this action? Decided before any state check. */
export function mayRunAction(action: ItemAction, actor: ActorOnJob, item: ItemFacts): boolean {
  if (actor.role === 'homeowner') return false;
  if (actor.role === 'owner') return true;
  if (actor.role === 'lead') return action !== 'reopen';
  return (
    (action === 'start' || action === 'mark_done') &&
    item.trade !== null &&
    item.trade === actor.trade
  );
}

/** The single item lifecycle table. Errors come back in the published order. */
export function runTransition(action: ItemAction, item: ItemFacts): Transition | ErrorBody {
  const blockedBody = errorBody('blocked', { waiting_on: item.unverifiedBlockers });
  const blocked = item.unverifiedBlockers.length > 0;

  switch (action) {
    case 'start':
      if (item.status !== 'open') return errorBody('invalid_transition');
      return { status: 'in_progress', storeReason: false, clearSentBackReason: false, cascade: false };
    case 'mark_done':
      if (item.status !== 'in_progress') return errorBody('invalid_transition');
      if (blocked) return blockedBody;
      if (item.trade !== null && item.completionPhotos === 0) {
        return errorBody('completion_photo_required');
      }
      return {
        status: 'ready_for_check',
        storeReason: false,
        clearSentBackReason: true,
        cascade: false,
      };
    case 'verify':
      if (item.status === 'verified') return errorBody('invalid_transition');
      if (blocked) return blockedBody;
      if (item.status !== 'ready_for_check' && item.trade !== null) {
        return errorBody('awaiting_trade');
      }
      return { status: 'verified', storeReason: false, clearSentBackReason: false, cascade: false };
    case 'send_back':
      if (item.status !== 'ready_for_check') return errorBody('invalid_transition');
      return { status: 'in_progress', storeReason: true, clearSentBackReason: false, cascade: false };
    case 'reopen':
      if (item.status !== 'verified') return errorBody('invalid_transition');
      return { status: 'open', storeReason: false, clearSentBackReason: true, cascade: true };
  }
}

/** Who may delete an item. `forbidden` outranks `invalid_transition` by API precedence. */
export function checkDelete(actor: ActorOnJob, item: ItemFacts): ErrorBody | null {
  if (actor.role === 'owner') {
    return item.status === 'verified' ? errorBody('invalid_transition') : null;
  }
  if (actor.role === 'lead' && item.status === 'open' && item.createdBy === actor.personId) {
    return null;
  }
  return errorBody('forbidden');
}

/** An item's trade may only change while it is open or in progress. */
export function tradeChangeAllowed(status: ItemStatus): boolean {
  return status === 'open' || status === 'in_progress';
}
