/** Editorial lifecycle: chapters and timeline events. */

export type ItemStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'withdrawn';
export type ItemKind = 'chapter' | 'event';

export const TRANSITIONS: Record<ItemStatus, Partial<Record<ItemStatus, 'owner_or_lead' | 'lead_only' | 'server_only'>>> = {
  draft: { review: 'owner_or_lead' },
  review: { draft: 'owner_or_lead', scheduled: 'lead_only' },
  scheduled: { draft: 'owner_or_lead', published: 'server_only' },
  published: { withdrawn: 'owner_or_lead' },
  withdrawn: { draft: 'owner_or_lead' },
};

export function transitionAllowed(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from][to] !== undefined;
}

export function transitionWho(from: ItemStatus, to: ItemStatus): 'owner_or_lead' | 'lead_only' | 'server_only' | null {
  return TRANSITIONS[from][to] ?? null;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'Draft',
  review: 'Review',
  scheduled: 'Scheduled',
  published: 'Published',
  withdrawn: 'Withdrawn',
};
