// Reference values, mirrored from the server for the browser.
export const CITIES = [
  { id: 'harrowgate', name: 'Harrowgate' },
  { id: 'kelvane', name: 'Kelvane' },
  { id: 'brindlemoor', name: 'Brindlemoor' },
  { id: 'saltmere', name: 'Saltmere' },
] as const;

export const ROLE_FAMILIES = [
  { id: 'research_assistant', name: 'Research Assistant' },
  { id: 'qc_analyst', name: 'QC Analyst' },
  { id: 'lab_manager', name: 'Lab Manager' },
  { id: 'core_facility', name: 'Core Facility Specialist' },
] as const;

export const WORK_PATTERNS = [
  { id: 'on_site', name: 'On site' },
  { id: 'hybrid', name: 'Hybrid' },
  { id: 'remote', name: 'Remote' },
] as const;

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000'] as const;

export const PAY_BANDS = [
  { id: 'under_4', name: 'Under ₹4 lakh' },
  { id: '4_6', name: '₹4–6 lakh' },
  { id: '6_8', name: '₹6–8 lakh' },
  { id: '8_10', name: '₹8–10 lakh' },
  { id: '10_plus', name: '₹10 lakh and over' },
] as const;

export const STAGES = ['submitted', 'screening', 'interview', 'offer', 'declined'] as const;

export const REJECTION_REASONS = [
  'Identifies a person',
  'Not about this employer',
  'Abusive language',
  'Duplicate post',
  'Other',
] as const;

export const OUTCOMES_CLIENT = [
  { id: 'offer', name: 'Got an offer' },
  { id: 'no_offer', name: 'No offer' },
  { id: 'no_reply', name: 'Never heard back' },
] as const;

export const WORK_PATTERNS_CLIENT = WORK_PATTERNS;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const AUTHOR_LABEL = 'Anonymous bench member';

export function cityName(id: string): string {
  return CITIES.find((entry) => entry.id === id)?.name ?? id;
}

export function roleName(id: string): string {
  return ROLE_FAMILIES.find((entry) => entry.id === id)?.name ?? id;
}

export function workPatternName(id: string): string {
  return WORK_PATTERNS.find((entry) => entry.id === id)?.name ?? id;
}

export function bandName(id: string): string {
  return PAY_BANDS.find((entry) => entry.id === id)?.name ?? id;
}

export function stageName(stage: string): string {
  const cap = stage.charAt(0).toUpperCase() + stage.slice(1);
  return cap === 'Interview' ? 'Interview' : cap;
}

export function payBandFor(payLow: number): string {
  if (payLow < 400000) return 'under_4';
  if (payLow < 600000) return '4_6';
  if (payLow < 800000) return '6_8';
  if (payLow < 1000000) return '8_10';
  return '10_plus';
}

export function rupees(value: number): string {
  const whole = Math.round(value).toString();
  if (whole.length <= 3) return `₹${whole}`;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${grouped},${last3}`;
}

export function rangeText(low: number, high: number): string {
  return `${rupees(low)} – ${rupees(high)}`;
}
