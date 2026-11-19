/** Shared domain types between server and client. Strictly typed, no `any`. */

export type WorkshopStatus =
  | 'draft' | 'open' | 'silent_round' | 'revealed' | 'voting' | 'closed' | 'archived';

export const STATUS_LABELS: Record<WorkshopStatus, string> = {
  draft: 'Draft', open: 'Open', silent_round: 'Silent round', revealed: 'Revealed',
  voting: 'Voting', closed: 'Closed', archived: 'Archived',
};

export const STATUS_ORDER: WorkshopStatus[] = ['draft', 'open', 'silent_round', 'revealed', 'voting', 'closed', 'archived'];

/** The legal workshop state edges, decided once (DP-03). */
export const LEGAL_EDGES: Partial<Record<WorkshopStatus, WorkshopStatus[]>> = {
  draft: ['open'],
  open: ['silent_round'],
  silent_round: ['revealed'],
  revealed: ['silent_round', 'voting'],
  voting: ['closed'],
  closed: ['archived'],
};

export const TEMPLATES = {
  retrospective: ['Went well', 'To improve', 'Actions'],
  discovery: ['Problems', 'Opportunities', 'Questions'],
  strategy: ["Where we are", "Where we're going", "What's in the way"],
  blank: ['Ideas'],
} as const;
export type TemplateCode = keyof typeof TEMPLATES;
export const TEMPLATE_LABELS: Record<TemplateCode, string> = {
  retrospective: 'Retrospective', discovery: 'Discovery sprint',
  strategy: 'Strategy offsite', blank: 'Blank',
};

export type PlanCode = 'free' | 'studio' | 'agency';
export const PLAN_LABELS: Record<PlanCode, string> = { free: 'Free', studio: 'Studio', agency: 'Agency' };
export type TermCode = 'monthly' | 'annual';
export const TERM_LABELS: Record<TermCode, string> = { monthly: 'Monthly', annual: 'Annual' };

export const PLAN_PRICES: Record<PlanCode, Record<TermCode, string>> = {
  free: { monthly: '0.00', annual: '0.00' },
  studio: { monthly: '24.00', annual: '230.40' },
  agency: { monthly: '59.00', annual: '566.40' },
};

/** The entitlement table, decided once (DP-49). null = unlimited. */
export interface Entitlements {
  activeWorkshops: number | null;
  participantsPerWorkshop: number;
  silentRoundsPerWorkshop: number | null;
  invitesPerDay: number;
  recapScale: 1 | 2;
}
export const ENTITLEMENTS: Record<PlanCode, Entitlements> = {
  free: { activeWorkshops: 3, participantsPerWorkshop: 8, silentRoundsPerWorkshop: 1, invitesPerDay: 20, recapScale: 1 },
  studio: { activeWorkshops: 20, participantsPerWorkshop: 30, silentRoundsPerWorkshop: null, invitesPerDay: 200, recapScale: 2 },
  agency: { activeWorkshops: null, participantsPerWorkshop: 50, silentRoundsPerWorkshop: null, invitesPerDay: 1000, recapScale: 2 },
};

export type ErrorCode =
  | 'unauthenticated' | 'invalid_credentials' | 'session_ended' | 'payment_required' | 'plan_limit'
  | 'forbidden' | 'cross_origin' | 'not_found' | 'illegal_transition' | 'phase_locked' | 'deadline_passed'
  | 'workshop_closed' | 'workshop_not_open' | 'room_full' | 'budget_exhausted' | 'no_dot_to_return'
  | 'op_conflict' | 'no_join_link' | 'not_closed' | 'recap_not_ready' | 'plan_unchanged' | 'nothing_due'
  | 'link_revoked' | 'link_expired' | 'too_large' | 'unsupported_media_type' | 'validation'
  | 'rate_limited' | 'quota_exceeded' | 'storage_unavailable' | 'billing_unavailable';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; limit?: number; used?: number; plan?: PlanCode };
}
