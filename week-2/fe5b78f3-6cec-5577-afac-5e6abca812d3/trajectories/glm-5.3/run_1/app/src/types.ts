// Domain codes used across Pakka Rail.

export type ClassCode = 'SL' | '3A';
export type QuotaCode = 'GN' | 'TQ' | 'LD' | 'SS';
export type WlType = 'GNWL' | 'RLWL' | 'PQWL' | 'TQWL';
export type AcceptCode = 'CNF' | 'RAC' | 'WL';
export type PassengerState =
  | 'CNF' | 'RAC' | 'GNWL' | 'RLWL' | 'PQWL' | 'TQWL'
  | 'NOSB' | 'CAN' | 'CHART_NOT_CONFIRMED';
export type BookingState = 'booked' | 'chart_prepared' | 'journey_complete';
export type TicketKind = 'booked' | 'cancellation' | 'chart';
export type BandCode =
  | 'flat' | 'quarter' | 'half' | 'tatkal_confirmed' | 'clerkage'
  | 'party_clerkage' | 'rac_after_chart' | 'after_chart' | 'chart_full' | 'no_fare';
export type Gender = 'M' | 'F' | 'T';
export type BerthType = 'LB' | 'MB' | 'UB' | 'SL' | 'SU';
export type BerthPref = BerthType | 'NONE';
export type BerthQuota = 'GN' | 'TQ' | 'LD' | 'SS' | 'RAC';

export interface StopSeed {
  code: string; name: string; km: number; time: string; rl: boolean;
}

export interface TrainSeed {
  number: string; name: string; stops: StopSeed[]; coaches: { code: string; cls: ClassCode }[]; chart: string;
}

export const QUOTA_LABEL: Record<QuotaCode, string> = {
  GN: 'General', TQ: 'Tatkal', LD: 'Ladies', SS: 'Senior',
};

export const TICKET_KIND_LABEL: Record<TicketKind, string> = {
  booked: 'as booked', cancellation: 'after cancellation', chart: 'after chart',
};

export const BAND_LABEL: Record<BandCode, string> = {
  flat: 'Flat charge',
  quarter: '25% deduction',
  half: '50% deduction',
  tatkal_confirmed: 'Confirmed Tatkal, no refund',
  clerkage: 'Clerkage',
  party_clerkage: 'Part-confirmed party, clerkage',
  rac_after_chart: 'RAC after chart, clerkage',
  after_chart: 'After chart, no refund',
  chart_full: 'Not confirmed at chart',
  no_fare: 'Child, no fare',
};

export const BERTH_TYPE_LABEL: Record<BerthType, string> = {
  LB: 'lower', MB: 'middle', UB: 'upper', SL: 'side lower', SU: 'side upper',
};

export const CLASSES: ClassCode[] = ['SL', '3A'];
export const QUOTAS: QuotaCode[] = ['GN', 'TQ', 'LD', 'SS'];

/** Senior criteria: aged 60 or over, or a woman aged 45 or over. */
export function meetsSeniorCriteria(age: number, gender: Gender): boolean {
  return age >= 60 || (gender === 'F' && age >= 45);
}
