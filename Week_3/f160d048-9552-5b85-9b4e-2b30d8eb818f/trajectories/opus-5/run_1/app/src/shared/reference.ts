export type CityId = 'harrowgate' | 'kelvane' | 'brindlemoor' | 'saltmere';
export type RoleFamilyId = 'research_assistant' | 'qc_analyst' | 'lab_manager' | 'core_facility';
export type WorkPatternId = 'on_site' | 'hybrid' | 'remote';
export type PayBandId = 'under_4' | '4_6' | '6_8' | '8_10' | '10_plus';
export type CompanySize = '1-10' | '11-50' | '51-200' | '201-1000';
export type Stage = 'submitted' | 'screening' | 'interview' | 'offer' | 'declined';
export type PostKind = 'review' | 'pay_report' | 'interview_note';
export type PostState = 'pending' | 'claimed' | 'approved' | 'rejected';
export type Outcome = 'offer' | 'no_offer' | 'no_reply';

export const CITIES: ReadonlyArray<{ id: CityId; name: string }> = [
  { id: 'harrowgate', name: 'Harrowgate' },
  { id: 'kelvane', name: 'Kelvane' },
  { id: 'brindlemoor', name: 'Brindlemoor' },
  { id: 'saltmere', name: 'Saltmere' },
];

export const ROLE_FAMILIES: ReadonlyArray<{ id: RoleFamilyId; name: string }> = [
  { id: 'research_assistant', name: 'Research Assistant' },
  { id: 'qc_analyst', name: 'QC Analyst' },
  { id: 'lab_manager', name: 'Lab Manager' },
  { id: 'core_facility', name: 'Core Facility Specialist' },
];

export const WORK_PATTERNS: ReadonlyArray<{ id: WorkPatternId; name: string }> = [
  { id: 'on_site', name: 'On site' },
  { id: 'hybrid', name: 'Hybrid' },
  { id: 'remote', name: 'Remote' },
];

export const PAY_BANDS: ReadonlyArray<{ id: PayBandId; name: string; low: number; high: number }> = [
  { id: 'under_4', name: 'Under ₹4 lakh', low: 0, high: 399999 },
  { id: '4_6', name: '₹4–6 lakh', low: 400000, high: 599999 },
  { id: '6_8', name: '₹6–8 lakh', low: 600000, high: 799999 },
  { id: '8_10', name: '₹8–10 lakh', low: 800000, high: 999999 },
  { id: '10_plus', name: '₹10 lakh and over', low: 1000000, high: Number.MAX_SAFE_INTEGER },
];

export const COMPANY_SIZES: ReadonlyArray<CompanySize> = ['1-10', '11-50', '51-200', '201-1000'];

export const STAGES: ReadonlyArray<Stage> = ['submitted', 'screening', 'interview', 'offer', 'declined'];

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  submitted: 'Submitted',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  declined: 'Declined',
};

export const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  offer: 'Got an offer',
  no_offer: 'No offer',
  no_reply: 'Never heard back',
};

export const REJECTION_REASONS: ReadonlyArray<string> = [
  'Identifies a person',
  'Not about this employer',
  'Abusive language',
  'Duplicate post',
  'Other',
];

export const KIND_LABELS: Readonly<Record<PostKind, string>> = {
  review: 'review',
  pay_report: 'pay report',
  interview_note: 'interview note',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function cityName(id: string): string {
  return CITIES.find((c) => c.id === id)?.name ?? id;
}

export function roleFamilyName(id: string): string {
  return ROLE_FAMILIES.find((r) => r.id === id)?.name ?? id;
}

export function workPatternName(id: string): string {
  return WORK_PATTERNS.find((w) => w.id === id)?.name ?? id;
}

export function payBandName(id: string): string {
  return PAY_BANDS.find((b) => b.id === id)?.name ?? id;
}

export function payBandFor(payLow: number): PayBandId {
  for (const band of PAY_BANDS) {
    if (payLow >= band.low && payLow <= band.high) return band.id;
  }
  return '10_plus';
}

export function isCityId(value: unknown): value is CityId {
  return typeof value === 'string' && CITIES.some((c) => c.id === value);
}

export function isRoleFamilyId(value: unknown): value is RoleFamilyId {
  return typeof value === 'string' && ROLE_FAMILIES.some((r) => r.id === value);
}

export function isWorkPatternId(value: unknown): value is WorkPatternId {
  return typeof value === 'string' && WORK_PATTERNS.some((w) => w.id === value);
}

export function isPayBandId(value: unknown): value is PayBandId {
  return typeof value === 'string' && PAY_BANDS.some((b) => b.id === value);
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGES.includes(value as Stage);
}

/** `2026-03` becomes `March 2026`. */
export function monthYear(postedMonth: string): string {
  const [year, month] = postedMonth.split('-');
  if (!year || !month) return postedMonth;
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : postedMonth;
}

/** Whole rupees with Indian digit grouping, for example `₹6,40,000`. */
export function money(amount: number): string {
  const whole = Math.round(amount).toString();
  if (whole.length <= 3) return `₹${whole}`;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export function moneyRange(low: number, high: number): string {
  return `${money(low)} – ${money(high)}`;
}

export function reviewCountText(count: number): string {
  return count === 1 ? '1 review' : `${count} reviews`;
}

export function reviewCountLine(count: number): string {
  return count === 0 ? 'No ratings yet' : reviewCountText(count);
}

export function jobCountLine(count: number): string {
  if (count === 0) return 'No jobs match these filters';
  if (count === 1) return '1 job found';
  return `${count} jobs found`;
}

export function applicantCountLine(count: number): string {
  if (count === 0) return 'No applicants shown';
  if (count === 1) return '1 applicant shown';
  return `${count} applicants shown`;
}

export function newCountText(count: number): string {
  if (count === 0) return 'No new jobs';
  if (count === 1) return '1 new job';
  return `${count} new jobs`;
}

export function belowThresholdReports(count: number, threshold: number): string {
  return `${count} of ${threshold} reports. The range opens at ${threshold}.`;
}

export function atThresholdReports(count: number): string {
  return `${count} reports`;
}
