export const WORKSHOP_STATUSES = [
  'draft',
  'open',
  'silent_round',
  'revealed',
  'voting',
  'closed',
  'archived',
] as const;

export type WorkshopStatus = (typeof WORKSHOP_STATUSES)[number];

const STATUS_LABELS: Readonly<Record<WorkshopStatus, string>> = {
  draft: 'Draft',
  open: 'Open',
  silent_round: 'Silent round',
  revealed: 'Revealed',
  voting: 'Voting',
  closed: 'Closed',
  archived: 'Archived',
};

/** The one place the legal state edges are decided. */
const LEGAL_EDGES: ReadonlyArray<readonly [WorkshopStatus, WorkshopStatus]> = [
  ['draft', 'open'],
  ['open', 'silent_round'],
  ['silent_round', 'revealed'],
  ['revealed', 'silent_round'],
  ['revealed', 'voting'],
  ['voting', 'closed'],
  ['closed', 'archived'],
];

export const TERMINAL_STATUSES: ReadonlySet<WorkshopStatus> = new Set<WorkshopStatus>(['closed', 'archived']);

export function statusLabel(status: WorkshopStatus): string {
  return STATUS_LABELS[status];
}

export function isWorkshopStatus(value: unknown): value is WorkshopStatus {
  return typeof value === 'string' && (WORKSHOP_STATUSES as readonly string[]).includes(value);
}

export function isLegalEdge(from: WorkshopStatus, to: WorkshopStatus): boolean {
  return LEGAL_EDGES.some(([a, b]) => a === from && b === to);
}
