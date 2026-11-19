/** The shapes the API publishes, shared by the server and the client. Types only. */

export type WorkshopStatus =
  | 'draft'
  | 'open'
  | 'silent_round'
  | 'revealed'
  | 'voting'
  | 'closed'
  | 'archived';

export type TemplateCode = 'retrospective' | 'discovery' | 'strategy' | 'blank';
export type PlanCode = 'free' | 'studio' | 'agency';
export type BillingTerm = 'monthly' | 'annual';
export type BillingState = 'active' | 'past_due' | 'read_only';
export type RecapReason = 'storage_unavailable' | 'billing_unavailable' | 'mail_unavailable';

export interface Money {
  readonly amount: string;
  readonly currency: 'EUR';
}

export interface Invite {
  readonly email: string;
  readonly status: 'sent' | 'queued';
}

export interface RecapInvoice {
  readonly id: string;
  readonly number: string;
  readonly amount: string;
  readonly currency: string;
}

export interface Recap {
  readonly status: 'queued' | 'complete';
  readonly reason: RecapReason | null;
  readonly attempts: number;
  readonly filesStoredAt: string | null;
  readonly emailSentAt: string | null;
  readonly recipients: number;
  readonly recapUrl: string;
  readonly scale: 1 | 2;
  readonly invoice: RecapInvoice | null;
}

export interface FacilitatorWorkshop {
  readonly id: string;
  readonly title: string;
  readonly template: TemplateCode;
  readonly status: WorkshopStatus;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly timeZone: string;
  readonly sponsorEmail: string;
  readonly fee: Money;
  readonly invites: readonly Invite[];
  readonly joinUrl: string | null;
  readonly joinLinkExpiresAt: string;
  readonly participantCount: number;
  readonly participantCap: number | null;
  readonly roundsUsed: number;
  readonly round: { readonly number: number; readonly endsAt: string } | null;
  readonly voting: { readonly dotBudget: number; readonly endsAt: string } | null;
  readonly version: number;
  readonly recap: Recap | null;
}

export interface ParticipantWorkshop {
  readonly id: string;
  readonly title: string;
  readonly status: WorkshopStatus;
  readonly round: { readonly number: number; readonly endsAt: string } | null;
  readonly voting: { readonly dotBudget: number; readonly endsAt: string } | null;
  readonly version: number;
}

export interface BoardFrame {
  readonly id: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: number;
  readonly noteCount: number;
  readonly hiddenCount: number;
}

export interface BoardCluster {
  readonly id: string;
  readonly frameId: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly noteIds: readonly string[];
  readonly noteCount: number;
  readonly dotTotal?: number;
  readonly myDots?: number;
}

export interface BoardNote {
  readonly id: string;
  readonly frameId: string;
  readonly clusterId?: string | null;
  readonly kind?: 'text' | 'image';
  readonly text?: string | null;
  readonly imageUrl?: string | null;
  readonly x: number;
  readonly y: number;
  readonly revealed: boolean;
  readonly mine: boolean;
  readonly authorName?: string;
  readonly facilitatorOnly?: boolean;
}

export interface BoardConnector {
  readonly id: string;
  readonly fromNoteId: string;
  readonly toNoteId: string;
}

export interface BoardParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly notesThisRound: number;
  readonly active: boolean;
}

export interface FacilitatorViewer {
  readonly role: 'facilitator';
  readonly name: string;
}

export interface ParticipantViewer {
  readonly role: 'participant';
  readonly participantId: string;
  readonly displayName: string;
  readonly dotsRemaining: number | null;
}

export interface BoardResponse {
  readonly serverTime: string;
  readonly workshop: FacilitatorWorkshop | ParticipantWorkshop;
  readonly viewer: FacilitatorViewer | ParticipantViewer;
  readonly frames: readonly BoardFrame[];
  readonly clusters: readonly BoardCluster[];
  readonly notes: readonly BoardNote[];
  readonly connectors: readonly BoardConnector[];
  readonly participants?: readonly BoardParticipant[];
}

export interface Entitlements {
  readonly activeWorkshops: number | null;
  readonly participantsPerWorkshop: number | null;
  readonly silentRoundsPerWorkshop: number | null;
  readonly invitesPerDay: number | null;
  readonly recapScale: 1 | 2;
}

export interface BillingInvoice {
  readonly id: string;
  readonly number: string;
  readonly date: string;
  readonly amount: string;
  readonly balance: string;
  readonly currency: string;
  readonly status: 'paid' | 'unpaid';
}

export interface Billing {
  readonly plan: PlanCode;
  readonly term: BillingTerm;
  readonly state: BillingState;
  readonly pastDueSince: string | null;
  readonly readOnlyAt: string | null;
  readonly renewsOn: string | null;
  readonly pendingChange: {
    readonly plan: PlanCode;
    readonly term: BillingTerm;
    readonly effectiveDate: string;
  } | null;
  readonly entitlements: Entitlements;
  readonly usage: { readonly activeWorkshops: number; readonly invitesToday: number };
  readonly invoices: readonly BillingInvoice[];
  readonly stale: boolean;
  readonly syncedAt: string | null;
}

export interface ActivityEntry {
  readonly id: string;
  readonly seq: number;
  readonly at: string;
  readonly actor: 'facilitator' | 'system';
  readonly action: string;
  readonly workshopId: string | null;
}

export interface TrashItem {
  readonly id: string;
  readonly kind: 'frame';
  readonly title: string;
  readonly deletedAt: string;
  readonly purgeAt: string;
  readonly noteCount: number;
}

export interface BoardVersion {
  readonly id: string;
  readonly version: number;
  readonly reason: 'auto' | 'close' | 'before_restore';
  readonly createdAt: string;
  readonly noteCount: number;
}

export interface SearchResult {
  readonly noteId: string;
  readonly frameId: string;
  readonly text: string;
}

export interface RecapPageCluster {
  readonly frame: string;
  readonly title: string;
  readonly dotTotal: number;
  readonly notes: readonly string[];
}

export interface RecapPage {
  readonly workshop: {
    readonly title: string;
    readonly scheduledStart: string;
    readonly scheduledEnd: string;
    readonly timeZone: string;
  };
  readonly status: 'queued' | 'complete';
  readonly reason: RecapReason | null;
  readonly invoice: { readonly number: string; readonly amount: string; readonly currency: string } | null;
  readonly files: ReadonlyArray<{
    readonly name: string;
    readonly label: string;
    readonly url: string;
    readonly contentType: string;
  }>;
  readonly clusters: readonly RecapPageCluster[];
}

export interface JoinPageWorkshop {
  readonly title: string;
  readonly status: WorkshopStatus;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly timeZone: string;
}

export interface Facilitator {
  readonly name: string;
  readonly email: string;
  readonly timeZone: string;
}

/** The status labels, shared so the client never invents its own wording. */
export const STATUS_LABELS: Readonly<Record<WorkshopStatus, string>> = {
  draft: 'Draft',
  open: 'Open',
  silent_round: 'Silent round',
  revealed: 'Revealed',
  voting: 'Voting',
  closed: 'Closed',
  archived: 'Archived',
};

export const PLAN_LABELS: Readonly<Record<PlanCode, string>> = {
  free: 'Free',
  studio: 'Studio',
  agency: 'Agency',
};

export const TERM_LABELS: Readonly<Record<BillingTerm, string>> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

export const TEMPLATE_LABELS: Readonly<Record<TemplateCode, string>> = {
  retrospective: 'Retrospective',
  discovery: 'Discovery sprint',
  strategy: 'Strategy offsite',
  blank: 'Blank',
};

export const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  'workshop.created': 'Workshop created',
  'join_link.rotated': 'Join link replaced',
  'join_link.turned_off': 'Join link turned off',
  'invites.sent': 'Invites added',
  'frame.trashed': 'Frame moved to trash',
  'frame.restored': 'Frame restored',
  'frame.purged': 'Frame purged',
  'version.restored': 'Version restored',
  'note.facilitator_only_changed': 'Facilitator-only flag changed',
  'plan.changed': 'Plan changed',
  'plan.change_scheduled': 'Plan change scheduled',
  'payment.retried': 'Payment retried',
  'sponsor.invoiced': 'Sponsor invoiced',
  'recap.completed': 'Recap sent',
};

export const VERSION_REASON_LABELS: Readonly<Record<BoardVersion['reason'], string>> = {
  auto: 'Autosave',
  close: 'At close',
  before_restore: 'Before restore',
};
