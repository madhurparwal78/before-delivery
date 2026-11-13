import type { Role } from '../../shared/api.js';

export const SEED_PASSWORD = 'relayline-demo-2026';

export interface SeedOrg {
  id: string;
  name: string;
  contractId: string;
  rotationIntervalMinutes: number;
  hourlyRateCents: number;
  teamSurchargeBp: number;
  mileageCentsPerMile: number;
}

export const SEED_ORGS: readonly SeedOrg[] = [
  {
    id: 'riverbend',
    name: 'Riverbend Regional Hospital',
    contractId: 'contract-riverbend',
    rotationIntervalMinutes: 20,
    hourlyRateCents: 9000,
    teamSurchargeBp: 1000,
    mileageCentsPerMile: 67,
  },
  {
    id: 'maple-valley',
    name: 'Maple Valley School District',
    contractId: 'contract-maple-valley',
    rotationIntervalMinutes: 30,
    hourlyRateCents: 7850,
    teamSurchargeBp: 500,
    mileageCentsPerMile: 70,
  },
  {
    id: 'harlan-court',
    name: 'Harlan County Court',
    contractId: 'contract-harlan-court',
    rotationIntervalMinutes: 15,
    hourlyRateCents: 10500,
    teamSurchargeBp: 1500,
    mileageCentsPerMile: 0,
  },
];

export const SEED_RATE_EFFECTIVE_FROM = '2026-01-01';
export const CONTRACT_MINIMUM_MINUTES = 120;
export const CONTRACT_INCREMENT_MINUTES = 15;

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  orgId: string | null;
  initials: string | null;
  phone: string | null;
  homeCity: string | null;
  payRateCents: number | null;
  credentials: readonly { code: string; expiresOn: string }[];
}

export const SEED_USERS: readonly SeedUser[] = [
  {
    id: 'dana-okafor',
    name: 'Dana Okafor',
    email: 'dana.okafor@tandemhands.example',
    role: 'coordinator',
    orgId: null,
    initials: null,
    phone: null,
    homeCity: null,
    payRateCents: null,
    credentials: [],
  },
  {
    id: 'morgan-ellis',
    name: 'Morgan Ellis',
    email: 'morgan.ellis@tandemhands.example',
    role: 'billing_manager',
    orgId: null,
    initials: null,
    phone: null,
    homeCity: null,
    payRateCents: null,
    credentials: [],
  },
  {
    id: 'lena-torres',
    name: 'Lena Torres',
    email: 'lena.torres@riverbend.example',
    role: 'requester',
    orgId: 'riverbend',
    initials: null,
    phone: null,
    homeCity: null,
    payRateCents: null,
    credentials: [],
  },
  {
    id: 'sam-whitfield',
    name: 'Sam Whitfield',
    email: 'sam.whitfield@maplevalley.example',
    role: 'requester',
    orgId: 'maple-valley',
    initials: null,
    phone: null,
    homeCity: null,
    payRateCents: null,
    credentials: [],
  },
  {
    id: 'ruth-adeyemi',
    name: 'Ruth Adeyemi',
    email: 'ruth.adeyemi@harlancourt.example',
    role: 'requester',
    orgId: 'harlan-court',
    initials: null,
    phone: null,
    homeCity: null,
    payRateCents: null,
    credentials: [],
  },
  {
    id: 'jordan-reyes',
    name: 'Jordan Reyes',
    email: 'jordan.reyes@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'JR',
    phone: '+1 555 010 0141',
    homeCity: 'Fairbrook',
    payRateCents: 5500,
    credentials: [{ code: 'NIC', expiresOn: '2028-06-30' }],
  },
  {
    id: 'avery-chen',
    name: 'Avery Chen',
    email: 'avery.chen@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'AC',
    phone: '+1 555 010 0142',
    homeCity: 'Linden Park',
    payRateCents: 5200,
    credentials: [
      { code: 'NIC', expiresOn: '2027-12-31' },
      { code: 'EIPA', expiresOn: '2027-08-31' },
    ],
  },
  {
    id: 'casey-morgan',
    name: 'Casey Morgan',
    email: 'casey.morgan@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'CM',
    phone: '+1 555 010 0143',
    homeCity: 'Oak Hollow',
    payRateCents: 5000,
    credentials: [{ code: 'BEI', expiresOn: '2028-03-31' }],
  },
  {
    id: 'riley-brooks',
    name: 'Riley Brooks',
    email: 'riley.brooks@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'RB',
    phone: '+1 555 010 0144',
    homeCity: 'Westmere',
    payRateCents: 6500,
    credentials: [
      { code: 'NIC', expiresOn: '2028-12-31' },
      { code: 'SC:L', expiresOn: '2028-12-31' },
    ],
  },
  {
    id: 'taylor-nguyen',
    name: 'Taylor Nguyen',
    email: 'taylor.nguyen@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'TN',
    phone: '+1 555 010 0145',
    homeCity: 'Fairbrook',
    payRateCents: 4800,
    credentials: [
      { code: 'NIC', expiresOn: '2026-01-31' },
      { code: 'EIPA', expiresOn: '2027-05-31' },
    ],
  },
  {
    id: 'quinn-halvorsen',
    name: 'Quinn Halvorsen',
    email: 'quinn.halvorsen@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'QH',
    phone: '+1 555 010 0146',
    homeCity: 'Cedar Bluff',
    payRateCents: 6200,
    credentials: [
      { code: 'NIC', expiresOn: '2029-01-31' },
      { code: 'SC:L', expiresOn: '2029-01-31' },
    ],
  },
  {
    id: 'sasha-lindqvist',
    name: 'Sasha Lindqvist',
    email: 'sasha.lindqvist@interpreters.example',
    role: 'interpreter',
    orgId: null,
    initials: 'SL',
    phone: '+1 555 010 0147',
    homeCity: 'Granite Falls',
    payRateCents: 6300,
    credentials: [{ code: 'SC:L', expiresOn: '2028-09-30' }],
  },
];

export const BOOKING_REF_PREFIX = 'BK-';
export const BOOKING_REF_START = 1001;
export const LINE_REF_PREFIX = 'LN-';
export const LINE_REF_START = 5001;
