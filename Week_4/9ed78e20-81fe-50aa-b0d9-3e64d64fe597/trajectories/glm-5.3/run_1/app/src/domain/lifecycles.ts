export type ContentStatus =
  | 'draft'
  | 'in_review'
  | 'returned'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'withdrawn';

export type ContentKind = 'model' | 'news';

/** The one place that decides the content lifecycle. */
const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ['in_review'],
  in_review: ['returned', 'approved'],
  returned: ['in_review'],
  approved: ['scheduled'],
  scheduled: ['published', 'withdrawn'],
  published: ['withdrawn'],
  withdrawn: [],
};

export function contentCanMove(from: ContentStatus, to: ContentStatus): boolean {
  return (CONTENT_TRANSITIONS[from] ?? []).includes(to);
}

export type RequisitionStatus = 'draft' | 'open' | 'closed';

const REQUISITION_TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  draft: ['open'],
  open: ['closed'],
  closed: [],
};

export function requisitionCanMove(from: RequisitionStatus, to: RequisitionStatus): boolean {
  return (REQUISITION_TRANSITIONS[from] ?? []).includes(to);
}

export type ApplicationStage =
  | 'submitted'
  | 'screening'
  | 'interview'
  | 'final_review'
  | 'offer'
  | 'declined'
  | 'withdrawn';

const APPLICATION_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  submitted: ['screening', 'declined', 'withdrawn'],
  screening: ['interview', 'declined', 'withdrawn'],
  interview: ['final_review', 'declined', 'withdrawn'],
  final_review: ['offer', 'declined', 'withdrawn'],
  offer: [],
  declined: [],
  withdrawn: [],
};

export function applicationCanMove(from: ApplicationStage, to: ApplicationStage): boolean {
  return (APPLICATION_TRANSITIONS[from] ?? []).includes(to);
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  submitted: 'Submitted',
  screening: 'Screening',
  interview: 'Interview',
  final_review: 'Final review',
  offer: 'Offer',
  declined: 'Not progressing',
  withdrawn: 'Withdrawn',
};

export const STAGE_ORDER: ApplicationStage[] = [
  'submitted',
  'screening',
  'interview',
  'final_review',
  'offer',
];

export const ACTIVE_STAGES: ApplicationStage[] = ['submitted', 'screening', 'interview', 'final_review'];

export const SUBJECTS = ['research', 'safety', 'policy', 'company'] as const;
export type Subject = (typeof SUBJECTS)[number];
export const SUBJECT_LABELS: Record<Subject, string> = {
  research: 'Research',
  safety: 'Safety',
  policy: 'Policy',
  company: 'Company',
};

export const DISCIPLINES = ['research', 'engineering', 'policy', 'operations'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export type ReleaseRecordStatus =
  | 'open'
  | 'safety_signed'
  | 'legal_signed'
  | 'signed'
  | 'claims_validated'
  | 'cleared';

export function releaseRecordStatus(safety: boolean, legal: boolean): ReleaseRecordStatus {
  if (safety && legal) return 'signed';
  if (safety) return 'safety_signed';
  if (legal) return 'legal_signed';
  return 'open';
}

export type ClaimInput = {
  id: string;
  text: string;
  benchmark: string;
  eval_date: string;
  comparator: string;
  stated_delta: string;
};

export type ClaimView = {
  id: string;
  number: number;
  text: string;
  benchmark: string;
  eval_date: string;
  model_row_id: string;
  comparator_row_id: string;
  delta: string;
};

export type RowView = {
  id: string;
  subject: string;
  subject_name: string;
  organisation: string;
  benchmark: string;
  eval_date: string;
  score: string;
};

/** The one place that decides the recorded difference. */
export function recordedDelta(modelScore: string, comparatorScore: string): string {
  const m = parseScore(modelScore);
  const c = parseScore(comparatorScore);
  const decimals = Math.max(decimalPlaces(modelScore), decimalPlaces(comparatorScore));
  const diff = Math.round((m - c) * 10 ** decimals) / 10 ** decimals;
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  const abs = Math.abs(diff);
  const fixed = abs.toFixed(decimals);
  return `${sign}${fixed}`;
}

export function decimalPlaces(score: string): number {
  const idx = score.indexOf('.');
  return idx === -1 ? 0 : score.length - idx - 1;
}

export function parseScore(score: string): number {
  return Number.parseFloat(score);
}

/** Read time is decided here: markers replaced, word count / 225 rounded up. */
export function readTimeMinutes(body: string, claims: ClaimInput[] | null): number {
  const withClaims = body.replace(/\[claim:([^\]]+)\]/g, (_m, id: string) => {
    const claim = claims?.find((c) => c.id === id);
    return claim ? claim.text : '';
  });
  const stripped = withClaims.replace(/^## /gm, '');
  const words = stripped.split(/\s+/).filter((w) => w.length > 0);
  return Math.max(1, Math.ceil(words.length / 225));
}

export type ClaimFailure = { claim: string; ok: boolean; reason: string };

export function findNumbersInClaimText(text: string, names: string[]): string[] {
  const removed = names.reduce((acc, name) => splitRemove(acc, name), text);
  const out: string[] = [];
  const re = /\d+(?:\.\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(removed)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? removed[start - 1] : '';
    const after = end < removed.length ? removed[end] : '';
    // Skip when adjacent to a letter (Q3, v2) or part of a date YYYY-MM-DD.
    if (isLetter(before) || isLetter(after)) continue;
    if (isDatePart(removed, start, end)) continue;
    out.push(match[0]);
  }
  return out;
}

function splitRemove(text: string, name: string): string {
  if (!name) return text;
  const idx = text.indexOf(name);
  return idx === -1 ? text : text.slice(0, idx) + text.slice(idx + name.length);
}

function isLetter(ch: string): boolean {
  if (!ch) return false;
  return /[A-Za-z]/.test(ch);
}

function isDatePart(text: string, start: number, end: number): boolean {
  const windowStart = Math.max(0, start - 11);
  const window = text.slice(windowStart, Math.min(text.length, end + 11));
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(window);
  if (!m || m.index === undefined) return false;
  const dateStart = windowStart + m.index;
  const dateEnd = dateStart + m[0].length;
  return start >= dateStart - 1 && end <= dateEnd + 1;
}

export function numbersEqual(a: string, b: string): boolean {
  return Number.parseFloat(a) === Number.parseFloat(b);
}
