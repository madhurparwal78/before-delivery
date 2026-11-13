import type { ItemStatus } from './copy.js';
import type { Role } from './types.js';

export type ActorKind = 'owner' | 'lead' | 'other';

export interface TransitionRule {
  from: ItemStatus;
  to: ItemStatus;
  /** Who may make the move. */
  allowed: ActorKind[];
  needsPublishAt: boolean;
  needsReason: boolean;
}

export const TRANSITION_LABELS: Record<string, string> = {
  'draft>review': 'Send to review',
  'review>draft': 'Return to draft',
  'review>scheduled': 'Schedule',
  'scheduled>draft': 'Unschedule',
  'published>withdrawn': 'Withdraw',
  'withdrawn>draft': 'Move to draft',
};

export const TRANSITIONS: TransitionRule[] = [
  { from: 'draft', to: 'review', allowed: ['owner', 'lead'], needsPublishAt: false, needsReason: false },
  { from: 'review', to: 'draft', allowed: ['owner', 'lead'], needsPublishAt: false, needsReason: false },
  { from: 'review', to: 'scheduled', allowed: ['lead'], needsPublishAt: true, needsReason: false },
  { from: 'scheduled', to: 'draft', allowed: ['owner', 'lead'], needsPublishAt: false, needsReason: false },
  { from: 'published', to: 'withdrawn', allowed: ['owner', 'lead'], needsPublishAt: false, needsReason: true },
  { from: 'withdrawn', to: 'draft', allowed: ['owner', 'lead'], needsPublishAt: false, needsReason: false },
];

export type TransitionVerdict =
  | { kind: 'allowed'; rule: TransitionRule }
  | { kind: 'illegal' }
  | { kind: 'lead_only' }
  | { kind: 'forbidden' };

export function judgeTransition(from: ItemStatus, to: ItemStatus, actor: ActorKind): TransitionVerdict {
  const rule = TRANSITIONS.find((candidate) => candidate.from === from && candidate.to === to);
  if (!rule) return { kind: 'illegal' };
  if (rule.allowed.includes(actor)) return { kind: 'allowed', rule };
  if (rule.allowed.length === 1 && rule.allowed[0] === 'lead') return { kind: 'lead_only' };
  return { kind: 'forbidden' };
}

export function actorKindFor(role: Role, ownerEmail: string, actorEmail: string): ActorKind {
  if (role === 'lead_curator') return 'lead';
  if (ownerEmail === actorEmail) return 'owner';
  return 'other';
}

export function isItemStatus(value: unknown): value is ItemStatus {
  return (
    value === 'draft' || value === 'review' || value === 'scheduled' || value === 'published' || value === 'withdrawn'
  );
}

