import type { PanelId, Severity } from './panels.js';

export type ListingStatus = 'draft' | 'rendering' | 'live' | 'under_offer' | 'sold' | 'withdrawn';
export type OfferStatus = 'open' | 'needs_reread' | 'accepted' | 'declined' | 'lapsed' | 'closed_by_acceptance';
export type LinkStatus = 'active' | 'revoked' | 'expired';
export type LinkRole = 'buyer' | 'inspector';
export type AlertState = 'waiting' | 'delivered' | 'failed';
export type AlertKind = 'viewing_claim' | 'new_offer' | 'offer_lapsing';

/** Legal listing transitions. rendering may return to the prior status on failure. */
export const LISTING_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ['rendering', 'withdrawn'],
  rendering: ['live', 'draft', 'under_offer', 'sold', 'withdrawn'],
  live: ['rendering', 'under_offer', 'withdrawn'],
  under_offer: ['sold', 'withdrawn'],
  sold: [],
  withdrawn: [],
};

export function listingTransitionAllowed(from: ListingStatus, to: ListingStatus): boolean {
  return LISTING_TRANSITIONS[from].includes(to);
}

/** Legal offer transitions. */
export function offerTransitionAllowed(from: OfferStatus, to: OfferStatus): boolean {
  switch (from) {
    case 'open': return to === 'needs_reread' || to === 'accepted' || to === 'declined' || to === 'lapsed' || to === 'closed_by_acceptance';
    case 'needs_reread': return to === 'open' || to === 'declined' || to === 'lapsed' || to === 'closed_by_acceptance';
    default: return false;
  }
}

export const OFFER_STATUS_WORD: Record<OfferStatus, string> = {
  open: 'Open', needs_reread: 'Needs re-read', accepted: 'Accepted', declined: 'Declined',
  lapsed: 'Lapsed', closed_by_acceptance: 'Closed by another acceptance',
};

export const LISTING_STATUS_WORD: Record<ListingStatus, string> = {
  draft: 'Draft', rendering: 'Rendering', live: 'Live', under_offer: 'Under offer', sold: 'Sold', withdrawn: 'Withdrawn',
};

export const ALERT_STATE_WORD: Record<AlertState, string> = { waiting: 'Waiting', delivered: 'Delivered', failed: 'Failed' };

export const OFFER_LAPSE_SECONDS_DEFAULT = 172_800;
export const OFFER_WARNING_SECONDS_DEFAULT = 14_400;
export const LINK_TTL_SECONDS_DEFAULT = 1_209_600;
export const RECORD_PULL_MAX_AGE_SECONDS_DEFAULT = 2_592_000;

export interface AdvisoryRow {
  id: string;
  motTestNumber: string;
  text: string;
  stance: 'repaired' | 'monitoring' | 'not_repaired' | null;
  note: string | null;
  answeredAt: string | null;
  recurred: boolean;
}

export interface TapeStep {
  motTestNumber: string;
  completedDate: string;
  testResult: string;
  status: 'read' | 'skipped';
  odometerValue: string | null;
  odometerUnit: 'MI' | 'KM' | null;
  normalisedKm: number | null;
  flag: null | 'unit_change' | 'drop' | 'no_odometer' | 'unreadable';
  defects: { type: string; text: string; dangerous: boolean }[];
}

export interface RecordPull {
  pulledAt: string;
  firstUsedDate: string;
  tape: TapeStep[];
  advisories: AdvisoryRow[];
  openAdvisories: number;
}

export interface FindingRow {
  id: string;
  revision: number;
  position: number;
  panelId: PanelId;
  panelLabel: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: Severity;
  material: boolean;
  band: string;
  photoId: string | null;
}

/** The hero finding: highest severity, tie to earliest walkround position. */
export function heroOf(findings: { id: string; severity: Severity; position: number }[]): string | null {
  let best: { id: string; severity: Severity; position: number } | null = null;
  for (const f of findings) {
    if (!best) { best = f; continue; }
    const better = f.severity !== best.severity
      ? severityOrder(f.severity) > severityOrder(best.severity)
      : f.position < best.position;
    if (better) best = f;
  }
  return best ? best.id : null;
}

function severityOrder(severity: Severity): number {
  return severity === 'serious' ? 2 : severity === 'moderate' ? 1 : 0;
}

/** A cars row as pg returns it. */
export interface CarRow {
  id: string;
  name: string;
  registration: string;
  asking_pounds: number;
  viewing_area: string;
  home_address: string;
  story: string;
  listing_status: ListingStatus;
  current_version: number | null;
  pulled_at: Date | null;
}

export const PUBLISH_BLOCKER_COPY: Record<string, string> = {
  no_findings: 'Add at least one finding',
  no_record_pull: 'Pull the test record',
  record_stale: 'The test record is too old. Pull it again.',
  advisories_unanswered: 'Answer every advisory from the latest pull',
  advisory_recurred: 'Change the stance on each advisory seen again at a later test',
};
