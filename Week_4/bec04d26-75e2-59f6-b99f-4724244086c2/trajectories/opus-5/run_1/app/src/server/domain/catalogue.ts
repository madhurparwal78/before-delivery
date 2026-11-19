import { Carry } from '../../shared/types';

export interface CatalogueState {
  code: string;
  name: string;
  zone: string;
  dueDay: number;
  carry: Carry;
  rate: string;
  extensionDays: number;
  holidays: string[];
}

/**
 * The six-state catalogue a new practice starts with. Every rule, rate and
 * holiday is invented and has no link to any real tax authority.
 */
export const CATALOGUE: readonly CatalogueState[] = [
  {
    code: 'AZ',
    name: 'Arizona',
    zone: 'America/Phoenix',
    dueDay: 20,
    carry: 'fixed',
    rate: '5.600',
    extensionDays: 30,
    holidays: ['2026-01-01', '2026-07-03', '2026-11-26', '2026-12-25'],
  },
  {
    code: 'CO',
    name: 'Colorado',
    zone: 'America/Denver',
    dueDay: 20,
    carry: 'next_business',
    rate: '2.900',
    extensionDays: 30,
    holidays: [
      '2026-01-01',
      '2026-05-25',
      '2026-07-03',
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
      '2027-01-01',
    ],
  },
  {
    code: 'HI',
    name: 'Hawaii',
    zone: 'Pacific/Honolulu',
    dueDay: 20,
    carry: 'next_business',
    rate: '4.000',
    extensionDays: 30,
    holidays: [
      '2026-01-01',
      '2026-03-26',
      '2026-06-11',
      '2026-07-03',
      '2026-08-21',
      '2026-09-07',
      '2026-11-26',
      '2026-12-25',
    ],
  },
  {
    code: 'IL',
    name: 'Illinois',
    zone: 'America/Chicago',
    dueDay: 20,
    carry: 'next_business',
    rate: '6.250',
    extensionDays: 30,
    holidays: [
      '2026-01-01',
      '2026-01-19',
      '2026-02-12',
      '2026-05-25',
      '2026-07-03',
      '2026-09-07',
      '2026-11-11',
      '2026-11-26',
      '2026-11-27',
      '2026-12-25',
      '2027-01-01',
    ],
  },
  {
    code: 'NY',
    name: 'New York',
    zone: 'America/New_York',
    dueDay: 20,
    carry: 'next_business',
    rate: '4.000',
    extensionDays: 30,
    holidays: [
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
      '2027-01-01',
    ],
  },
  {
    code: 'WA',
    name: 'Washington',
    zone: 'America/Los_Angeles',
    dueDay: 25,
    carry: 'next_business',
    rate: '6.500',
    extensionDays: 30,
    holidays: [
      '2026-01-01',
      '2026-05-25',
      '2026-07-03',
      '2026-09-07',
      '2026-11-11',
      '2026-11-26',
      '2026-11-27',
      '2026-12-25',
    ],
  },
];

export const CATALOGUE_EDITION_DATE = '2020-01-01';
