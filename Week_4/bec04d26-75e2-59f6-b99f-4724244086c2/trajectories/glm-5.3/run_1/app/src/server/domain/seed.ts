export interface SeedState {
  code: string;
  name: string;
  zone: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
  holidays: string[];
}

export const SEED_STATES: SeedState[] = [
  {
    code: 'AZ', name: 'Arizona', zone: 'America/Phoenix',
    due_day: 20, carry: 'fixed', rate: '5.600', extension_days: 30,
    holidays: ['2026-01-01', '2026-07-03', '2026-11-26', '2026-12-25'],
  },
  {
    code: 'CO', name: 'Colorado', zone: 'America/Denver',
    due_day: 20, carry: 'next_business', rate: '2.900', extension_days: 30,
    holidays: ['2026-01-01', '2026-05-25', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01'],
  },
  {
    code: 'HI', name: 'Hawaii', zone: 'Pacific/Honolulu',
    due_day: 20, carry: 'next_business', rate: '4.000', extension_days: 30,
    holidays: ['2026-01-01', '2026-03-26', '2026-06-11', '2026-07-03', '2026-08-21', '2026-09-07', '2026-11-26', '2026-12-25'],
  },
  {
    code: 'IL', name: 'Illinois', zone: 'America/Chicago',
    due_day: 20, carry: 'next_business', rate: '6.250', extension_days: 30,
    holidays: [
      '2026-01-01', '2026-01-19', '2026-02-12', '2026-05-25', '2026-07-03',
      '2026-09-07', '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25', '2027-01-01',
    ],
  },
  {
    code: 'NY', name: 'New York', zone: 'America/New_York',
    due_day: 20, carry: 'next_business', rate: '4.000', extension_days: 30,
    holidays: [
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
      '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25', '2027-01-01',
    ],
  },
  {
    code: 'WA', name: 'Washington', zone: 'America/Los_Angeles',
    due_day: 25, carry: 'next_business', rate: '6.500', extension_days: 30,
    holidays: [
      '2026-01-01', '2026-05-25', '2026-07-03', '2026-09-07',
      '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25',
    ],
  },
];
