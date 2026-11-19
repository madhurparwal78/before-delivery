export type ContentStatus =
  | 'draft'
  | 'in_review'
  | 'returned'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'withdrawn';

export type RequisitionStatus = 'draft' | 'open' | 'closed';

export type ApplicationStage =
  | 'submitted'
  | 'screening'
  | 'interview'
  | 'final_review'
  | 'offer'
  | 'declined'
  | 'withdrawn';

const CONTENT_MOVES: ReadonlyMap<ContentStatus, readonly ContentStatus[]> = new Map([
  ['draft', ['in_review']],
  ['in_review', ['returned', 'approved']],
  ['returned', ['in_review']],
  ['approved', ['scheduled']],
  ['scheduled', ['published', 'withdrawn']],
  ['published', ['withdrawn']],
  ['withdrawn', []],
]);

const REQUISITION_MOVES: ReadonlyMap<RequisitionStatus, readonly RequisitionStatus[]> = new Map([
  ['draft', ['open']],
  ['open', ['closed']],
  ['closed', []],
]);

const APPLICATION_MOVES: ReadonlyMap<ApplicationStage, readonly ApplicationStage[]> = new Map([
  ['submitted', ['screening', 'declined', 'withdrawn']],
  ['screening', ['interview', 'declined', 'withdrawn']],
  ['interview', ['final_review', 'declined', 'withdrawn']],
  ['final_review', ['offer', 'declined', 'withdrawn']],
  ['offer', []],
  ['declined', []],
  ['withdrawn', []],
]);

export const CONTENT_STATUSES: readonly ContentStatus[] = [...CONTENT_MOVES.keys()];
export const APPLICATION_STAGES: readonly ApplicationStage[] = [...APPLICATION_MOVES.keys()];

export const ACTIVE_APPLICATION_STAGES: readonly ApplicationStage[] = [
  'submitted',
  'screening',
  'interview',
  'final_review',
];

export const STAGE_LABELS: Readonly<Record<ApplicationStage, string>> = {
  submitted: 'Submitted',
  screening: 'Screening',
  interview: 'Interview',
  final_review: 'Final review',
  offer: 'Offer',
  declined: 'Not progressing',
  withdrawn: 'Withdrawn',
};

export const STAGE_PROGRESS: readonly ApplicationStage[] = [
  'submitted',
  'screening',
  'interview',
  'final_review',
  'offer',
];

export function contentMoveAllowed(from: ContentStatus, to: ContentStatus): boolean {
  return (CONTENT_MOVES.get(from) ?? []).includes(to);
}

export function requisitionMoveAllowed(from: RequisitionStatus, to: RequisitionStatus): boolean {
  return (REQUISITION_MOVES.get(from) ?? []).includes(to);
}

export function applicationMoveAllowed(from: ApplicationStage, to: ApplicationStage): boolean {
  return (APPLICATION_MOVES.get(from) ?? []).includes(to);
}

export function isApplicationStage(value: string): value is ApplicationStage {
  return APPLICATION_MOVES.has(value as ApplicationStage);
}

export function contentEditable(status: ContentStatus): boolean {
  return status === 'draft' || status === 'returned';
}

export function commentsOpen(status: ContentStatus): boolean {
  return (
    status === 'draft' || status === 'in_review' || status === 'returned' || status === 'approved'
  );
}
