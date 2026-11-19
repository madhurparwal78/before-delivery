/**
 * Inbox event rules and texts. Rules never add recipients; they only stop
 * delivery. Urgent events ignore the digest setting.
 */

import type { RoleKey } from './roles';

export const inboxEvents = [
  'assigned',
  'mentioned',
  'sla_threshold_50',
  'sla_threshold_75',
  'sla_breach',
  'page',
  'page_exhausted',
  'vote_requested',
  'vote_result',
  'approval_reset',
  'approval_requested',
  'workaround_published',
  'major_incident_proposed',
  'export_finished',
] as const;

export type InboxEvent = (typeof inboxEvents)[number] | 'digest';

export const urgentEvents: readonly InboxEvent[] = ['page', 'page_exhausted', 'sla_breach'];

export function isUrgent(event: InboxEvent): boolean {
  return urgentEvents.includes(event);
}

export interface InboxRule {
  readonly event: string;
  readonly roles: readonly RoleKey[];
  readonly enabled: boolean;
}

export type Digest = 'immediate' | 'daily';

/**
 * A recipient loses an event when a rule with `enabled` false for that event
 * lists any one of their roles.
 */
export function blocked(
  rules: readonly InboxRule[],
  event: InboxEvent,
  roles: readonly RoleKey[],
): boolean {
  return rules.some(
    (rule) => !rule.enabled && rule.event === event && rule.roles.some((role) => roles.includes(role)),
  );
}

export const eventTexts = {
  assigned: (number: string): string => `${number} was assigned to you.`,
  mentioned: (displayName: string, number: string): string => `${displayName} mentioned you on ${number}.`,
  sla_threshold_50: (number: string, sla: string): string => `${number} has used 50 percent of ${sla}.`,
  sla_threshold_75: (number: string, sla: string): string => `${number} has used 75 percent of ${sla}.`,
  sla_breach: (number: string, sla: string): string => `${number} breached ${sla}.`,
  page: (number: string): string => `Page for ${number}: please acknowledge.`,
  page_exhausted: (number: string): string => `Page for ${number} was not acknowledged at any level.`,
  vote_requested: (change: string, title: string): string => `Your vote is needed on ${change}: ${title}.`,
  vote_result: (change: string, outcome: string, step: string): string =>
    `${change} was ${outcome} at ${step}.`,
  approval_reset: (change: string, fieldLabel: string): string =>
    `Approval on ${change} was reset: ${fieldLabel} changed.`,
  approval_requested: (item: string, itemName: string, displayName: string): string =>
    `Approve ${item}: ${itemName} for ${displayName}.`,
  workaround_published: (problem: string, number: string): string =>
    `A workaround was published on ${problem} for ${number}.`,
  major_incident_proposed: (item: string, reason: string): string =>
    `Major incident proposed for ${item}: ${reason}.`,
  export_finished: (id: string): string => `Export ${id} is ready.`,
  digest: (count: number): string => `Daily digest: ${count} updates`,
} as const;

/** The threshold event key for a percent. */
export function thresholdEvent(percent: number): InboxEvent {
  if (percent === 50) return 'sla_threshold_50';
  if (percent === 75) return 'sla_threshold_75';
  return 'sla_breach';
}
