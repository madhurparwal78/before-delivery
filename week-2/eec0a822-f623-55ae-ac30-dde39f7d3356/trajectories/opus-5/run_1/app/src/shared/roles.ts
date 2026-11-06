export const ROLES = [
  'fleet_director',
  'charter_manager',
  'finance_lead',
  'captain',
  'crew_member',
] as const;

export type Role = (typeof ROLES)[number];

export type Action =
  | 'members'
  | 'yachts_read'
  | 'yacht_profile'
  | 'holds_read'
  | 'holds_write'
  | 'quotes_read'
  | 'deposits'
  | 'charters_read'
  | 'manifest_pages'
  | 'manifest_read'
  | 'passport_data'
  | 'close_charter'
  | 'brokers'
  | 'tariffs_write'
  | 'marinas_read'
  | 'passages_write'
  | 'passages_read'
  | 'rota_write'
  | 'rota_read'
  | 'bookings'
  | 'stores'
  | 'energy_logs';

const PERMISSIONS: Record<Action, readonly Role[]> = {
  members: ['fleet_director'],
  yachts_read: ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member'],
  yacht_profile: ['fleet_director'],
  holds_read: ['fleet_director', 'charter_manager', 'finance_lead'],
  holds_write: ['fleet_director', 'charter_manager'],
  quotes_read: ['fleet_director', 'charter_manager', 'finance_lead'],
  deposits: ['fleet_director', 'charter_manager'],
  charters_read: ['fleet_director', 'charter_manager', 'finance_lead', 'captain'],
  manifest_pages: ['fleet_director', 'charter_manager'],
  manifest_read: ['fleet_director', 'charter_manager', 'captain'],
  passport_data: ['fleet_director', 'captain'],
  close_charter: ['fleet_director', 'captain'],
  brokers: ['fleet_director', 'charter_manager'],
  tariffs_write: ['fleet_director', 'finance_lead'],
  marinas_read: ['fleet_director', 'charter_manager', 'finance_lead', 'captain'],
  passages_write: ['fleet_director', 'captain'],
  passages_read: ['fleet_director', 'captain', 'crew_member'],
  rota_write: ['fleet_director', 'captain'],
  rota_read: ['fleet_director', 'captain', 'crew_member'],
  bookings: ['fleet_director', 'captain'],
  stores: ['fleet_director', 'captain', 'crew_member'],
  energy_logs: ['fleet_director', 'captain'],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}

export const HOME_PATHS: Record<Role, string> = {
  fleet_director: 'fleet',
  charter_manager: 'holds',
  finance_lead: 'charters',
  captain: 'today',
  crew_member: 'today',
};

export interface NavLink {
  readonly label: string;
  readonly path: string;
}

const NAV: Record<Role, readonly NavLink[]> = {
  fleet_director: [
    { label: 'Today', path: 'today' },
    { label: 'Fleet', path: 'fleet' },
    { label: 'Holds', path: 'holds' },
    { label: 'Charters', path: 'charters' },
    { label: 'Passages', path: 'passages' },
    { label: 'Berths', path: 'berths' },
    { label: 'Shore power', path: 'shore-power' },
    { label: 'Brokers', path: 'brokers' },
    { label: 'Tariffs', path: 'tariffs' },
  ],
  charter_manager: [
    { label: 'Fleet', path: 'fleet' },
    { label: 'Holds', path: 'holds' },
    { label: 'Charters', path: 'charters' },
    { label: 'Brokers', path: 'brokers' },
  ],
  finance_lead: [
    { label: 'Fleet', path: 'fleet' },
    { label: 'Holds', path: 'holds' },
    { label: 'Charters', path: 'charters' },
    { label: 'Tariffs', path: 'tariffs' },
  ],
  captain: [
    { label: 'Today', path: 'today' },
    { label: 'Fleet', path: 'fleet' },
    { label: 'Charters', path: 'charters' },
    { label: 'Passages', path: 'passages' },
    { label: 'Berths', path: 'berths' },
    { label: 'Shore power', path: 'shore-power' },
  ],
  crew_member: [{ label: 'Today', path: 'today' }],
};

export function navLinks(role: Role): readonly NavLink[] {
  return NAV[role];
}

