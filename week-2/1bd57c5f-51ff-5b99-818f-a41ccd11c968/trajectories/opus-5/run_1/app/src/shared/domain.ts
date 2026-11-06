export const TRADE_KEYS = [
  'electrical',
  'plumbing',
  'tile',
  'paint',
  'carpentry',
  'hvac',
  'flooring',
] as const;

export type Trade = (typeof TRADE_KEYS)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  tile: 'Tile',
  paint: 'Paint',
  carpentry: 'Carpentry',
  hvac: 'HVAC',
  flooring: 'Flooring',
};

export function isTrade(value: unknown): value is Trade {
  return typeof value === 'string' && (TRADE_KEYS as readonly string[]).includes(value);
}

export function tradeLabel(trade: Trade | null): string {
  return trade === null ? 'Crew' : TRADE_LABELS[trade];
}

export const ITEM_STATUSES = ['open', 'in_progress', 'ready_for_check', 'verified'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  ready_for_check: 'Ready for check',
  verified: 'Verified',
};

export type JobStatus = 'active' | 'walkthrough' | 'closed_out';

export const JOB_STAGE_LABELS: Record<JobStatus, string> = {
  active: 'Active',
  walkthrough: 'Walkthrough',
  closed_out: 'Closed out',
};

export type JobRole = 'owner' | 'lead' | 'trade' | 'homeowner';

export const ROLE_LABELS: Record<JobRole, string> = {
  owner: 'Owner',
  lead: 'Lead carpenter',
  trade: 'Trade',
  homeowner: 'Homeowner',
};

export type PinStatus = 'placed' | 'unpinned' | 'needs_review';

export type ConflictField =
  | 'title'
  | 'room_id'
  | 'trade'
  | 'cost_note'
  | 'quantity'
  | 'unit_cost'
  | 'pin';

export const CONFLICT_FIELD_LABELS: Record<ConflictField, string> = {
  title: 'Title',
  room_id: 'Room',
  trade: 'Trade',
  cost_note: 'Cost note',
  quantity: 'Quantity',
  unit_cost: 'Unit cost',
  pin: 'Pin',
};

export const COPY = {
  offlineBanner:
    "You're offline. Changes are saved on this phone and will sync when you reconnect.",
  photosOffline: 'Photos need a connection.',
  emptyRoom: 'No items in this room yet.',
  conflictHeading: 'Needs a decision',
  planUnavailable: 'Plan unavailable right now.',
  noJobs: 'No jobs yet.',
  signedOut: "You've been signed out.",
  notFoundHeading: "We can't find that page.",
  backToJobs: 'Back to your jobs',
  reviewText: 'Pin needs review',
  outboxQueued: 'Not sent yet',
  outboxSent: 'Sent',
  saving: 'Saving',
  photoUploading: 'Photo uploading',
  waitingToSync: 'Waiting to sync',
  noVisitsTomorrow: 'No site visits tomorrow',
} as const;

export const VISIT_STATUS_LABELS = {
  scheduled: 'Scheduled',
  moved: 'Moved',
  cancelled: 'Cancelled',
} as const;

export type OccurrenceStatus = keyof typeof VISIT_STATUS_LABELS;
