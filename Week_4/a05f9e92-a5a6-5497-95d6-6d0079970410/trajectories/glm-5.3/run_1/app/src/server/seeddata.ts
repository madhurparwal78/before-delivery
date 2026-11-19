// Seed data: Marlowe Quarry Architects. Inserted only when the DB is empty.

import { Db } from './db.js';
import { clock } from './db.js';
import { createHash, randomBytes } from 'node:crypto';

export interface SeedUser {
  username: string; password: string; display_name: string; roles: string[]; department: string; time_zone: string;
}

export const SEED_USERS: SeedUser[] = [
  { username: 'oona', password: 'oona-yard-2026', display_name: 'Oona Petrakis', roles: ['operator'], department: 'IT provider', time_zone: 'Europe/Berlin' },
  { username: 'teodor', password: 'teodor-yard-2026', display_name: 'Teodor Lindqvist', roles: ['technician'], department: 'IT provider', time_zone: 'Europe/Berlin' },
  { username: 'bastian', password: 'bastian-yard-2026', display_name: 'Bastian Quell', roles: ['technician'], department: 'IT provider', time_zone: 'Europe/Berlin' },
  { username: 'ruth', password: 'ruth-yard-2026', display_name: 'Ruth Abernathy', roles: ['requester'], department: 'Design Studio', time_zone: 'Europe/Berlin' },
  { username: 'kofi', password: 'kofi-yard-2026', display_name: 'Kofi Marsh', roles: ['requester'], department: 'Finance', time_zone: 'Europe/Berlin' },
  { username: 'ana', password: 'ana-yard-2026', display_name: 'Ana Feld', roles: ['approver', 'requester'], department: 'Finance', time_zone: 'Europe/Berlin' },
  { username: 'dev', password: 'dev-yard-2026', display_name: 'Devika Raman', roles: ['approver', 'requester'], department: 'Design Studio', time_zone: 'Europe/Berlin' },
  { username: 'jonas', password: 'jonas-yard-2026', display_name: 'Jonas Brandt', roles: ['approver', 'requester'], department: 'Studio Operations', time_zone: 'Europe/Berlin' },
  { username: 'mae', password: 'mae-yard-2026', display_name: 'Mae Castellan', roles: ['manager', 'requester'], department: 'Design Studio', time_zone: 'Europe/Berlin' },
  { username: 'hugo', password: 'hugo-yard-2026', display_name: 'Hugo Varga', roles: ['manager', 'requester'], department: 'Finance', time_zone: 'Europe/Lisbon' },
];

export const SEED_DEPARTMENTS = ['Design Studio', 'Finance', 'Studio Operations', 'Leadership', 'IT provider'];

/** Directory people with no sign-in. */
export function seedPeople(): Array<{ username: string; display_name: string; department: string }> {
  const out: Array<{ username: string; display_name: string; department: string }> = [];
  for (let i = 1; i <= 45; i++) {
    out.push({ username: `design${String(i).padStart(2, '0')}`, display_name: `Design staff ${String(i).padStart(2, '0')}`, department: 'Design Studio' });
  }
  for (let i = 1; i <= 6; i++) {
    out.push({ username: `fin${String(i).padStart(2, '0')}`, display_name: `Finance staff ${String(i).padStart(2, '0')}`, department: 'Finance' });
  }
  for (let i = 1; i <= 13; i++) {
    out.push({ username: `ops${String(i).padStart(2, '0')}`, display_name: `Operations staff ${String(i).padStart(2, '0')}`, department: 'Studio Operations' });
  }
  for (let i = 1; i <= 6; i++) {
    out.push({ username: `lead${String(i).padStart(2, '0')}`, display_name: `Leadership staff ${String(i).padStart(2, '0')}`, department: 'Leadership' });
  }
  return out;
}

/** PBKDF2 password hash. */
export function hashPassword(password: string, salt?: string): string {
  const useSalt = salt ?? randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(useSalt + password).digest('hex');
  return `sha256$${useSalt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'sha256') return false;
  return hashPassword(password, parts[1]) === stored;
}

export const OFFICE_HOURS = {
  name: 'Office hours',
  time_zone: 'Europe/Berlin',
  hours: {
    mon: [['08:00', '17:00']], tue: [['08:00', '17:00']], wed: [['08:00', '17:00']],
    thu: [['08:00', '17:00']], fri: [['08:00', '17:00']], sat: [], sun: [],
  },
  holidays: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-10-03', '2026-12-25', '2026-12-26'],
};

export const AROUND_THE_CLOCK = {
  name: 'Around the clock',
  time_zone: 'Europe/Berlin',
  hours: {
    mon: [['00:00', '24:00']], tue: [['00:00', '24:00']], wed: [['00:00', '24:00']],
    thu: [['00:00', '24:00']], fri: [['00:00', '24:00']], sat: [['00:00', '24:00']], sun: [['00:00', '24:00']],
  },
  holidays: [],
};

export const SEED_SLA_DEFINITIONS = [
  {
    name: 'Incident response',
    table: 'incident',
    start: 'true',
    pause: 'state = "on_hold"',
    stop: 'state != "new"',
    schedule: 'Office hours',
    targets: { '1': 900, '2': 1800, '3': 3600, '4': 14400, '5': 28800 },
  },
  {
    name: 'Incident resolution',
    table: 'incident',
    start: 'true',
    pause: 'state = "on_hold"',
    stop: 'state in ["resolved", "closed", "cancelled"]',
    schedule: 'Office hours',
    targets: { '1': 14400, '2': 32400, '3': 64800, '4': 129600, '5': 259200 },
  },
  {
    name: 'Request fulfilment',
    table: 'request_item',
    start: 'true',
    pause: 'state = "awaiting_approval"',
    stop: 'state in ["delivered", "closed", "rejected", "cancelled"]',
    schedule: 'Office hours',
    targets: { '1': 97200, '2': 97200, '3': 97200, '4': 97200, '5': 97200 },
  },
];

export interface SeedCi {
  name: string; class: string; criticality: number; business_critical?: boolean;
  used_by_departments?: string[]; used_by_people?: string[]; attributes?: Record<string, unknown>;
}

export const SEED_CIS: SeedCi[] = [
  { name: 'Payroll', class: 'business_service', criticality: 3, business_critical: true, used_by_departments: ['Finance', 'Leadership'], used_by_people: ['ops01'] },
  { name: 'Project files', class: 'business_service', criticality: 3, business_critical: true, used_by_departments: ['Design Studio', 'Studio Operations'] },
  { name: 'Mail', class: 'business_service', criticality: 3, business_critical: true, used_by_departments: ['Design Studio', 'Finance', 'Studio Operations', 'Leadership'] },
  { name: 'Sign-in', class: 'business_service', criticality: 3, business_critical: true, used_by_departments: ['Design Studio', 'Finance', 'Studio Operations', 'Leadership'] },
  { name: 'Remote access', class: 'business_service', criticality: 2, used_by_departments: ['Design Studio', 'Leadership'] },
  { name: 'Printing', class: 'business_service', criticality: 1, used_by_departments: ['Design Studio', 'Studio Operations'] },
  { name: 'Payroll app', class: 'application', criticality: 3 },
  { name: 'Mail relay', class: 'application', criticality: 3 },
  { name: 'Directory', class: 'application', criticality: 3 },
  { name: 'File gateway', class: 'application', criticality: 3 },
  { name: 'Print server', class: 'application', criticality: 1 },
  { name: 'payroll-vm', class: 'virtual_server', criticality: 3, attributes: { host_name: 'payroll-vm' } },
  { name: 'mail-vm', class: 'virtual_server', criticality: 3, attributes: { host_name: 'mail-vm' } },
  { name: 'dir-vm', class: 'virtual_server', criticality: 3, attributes: { host_name: 'dir-vm' } },
  { name: 'print-vm', class: 'virtual_server', criticality: 1, attributes: { host_name: 'print-vm' } },
  { name: 'host-a', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Kanal office' } },
  { name: 'host-b', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Kanal office' } },
  { name: 'host-c', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Hafen office' } },
  { name: 'Host cluster', class: 'cluster', criticality: 3, attributes: { required_healthy: 2 } },
  { name: 'File cluster', class: 'cluster', criticality: 3, attributes: { required_healthy: 2 } },
  { name: 'fs-node-1', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Kanal office' } },
  { name: 'fs-node-2', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Kanal office' } },
  { name: 'fs-node-3', class: 'server', criticality: 2, attributes: { operating_system: 'Linux', location: 'Hafen office' } },
  { name: 'Core switch', class: 'network_device', criticality: 3, attributes: { location: 'Kanal office' } },
  { name: 'VPN gateway', class: 'network_device', criticality: 2, attributes: { location: 'Kanal office' } },
  { name: 'Main storage array', class: 'storage', criticality: 3, attributes: { capacity_gb: 40000 } },
];

export const SEED_RELATIONSHIPS: Array<[string, string, string]> = [
  ['Payroll', 'depends on', 'Payroll app'],
  ['Payroll', 'depends on', 'Sign-in'],
  ['Project files', 'depends on', 'File gateway'],
  ['Project files', 'depends on', 'Sign-in'],
  ['Mail', 'depends on', 'Mail relay'],
  ['Mail', 'depends on', 'Sign-in'],
  ['Sign-in', 'depends on', 'Directory'],
  ['Remote access', 'depends on', 'VPN gateway'],
  ['Remote access', 'depends on', 'Sign-in'],
  ['Printing', 'depends on', 'Print server'],
  ['Payroll app', 'runs on', 'payroll-vm'],
  ['Mail relay', 'runs on', 'mail-vm'],
  ['Directory', 'runs on', 'dir-vm'],
  ['Print server', 'runs on', 'print-vm'],
  ['File gateway', 'runs on', 'File cluster'],
  ['payroll-vm', 'hosted by', 'Host cluster'],
  ['mail-vm', 'hosted by', 'Host cluster'],
  ['dir-vm', 'hosted by', 'Host cluster'],
  ['print-vm', 'hosted by', 'Host cluster'],
  ['host-a', 'member of', 'Host cluster'],
  ['host-b', 'member of', 'Host cluster'],
  ['host-c', 'member of', 'Host cluster'],
  ['fs-node-1', 'member of', 'File cluster'],
  ['fs-node-2', 'member of', 'File cluster'],
  ['fs-node-3', 'member of', 'File cluster'],
  ['Host cluster', 'depends on', 'Main storage array'],
  ['Host cluster', 'depends on', 'Core switch'],
  ['File cluster', 'depends on', 'Core switch'],
  ['VPN gateway', 'depends on', 'Core switch'],
];

export const SEED_FREEZE_WINDOWS = [
  { name: 'Payroll freeze', start: '2026-11-25T00:00:00+01:00', end: '2026-12-01T00:00:00+01:00', time_zone: 'Europe/Berlin', scope: 'Payroll' },
  { name: 'Year-end freeze', start: '2026-12-21T00:00:00+01:00', end: '2027-01-04T00:00:00+01:00', time_zone: 'Europe/Berlin', scope: 'all' },
];

export const SEED_BOARDS = [
  { name: 'Change board', rule: 'weighted', n: null, threshold_percent: 60, window_hours: 48, members: [{ username: 'ana', weight: 2 }, { username: 'dev', weight: 1 }, { username: 'jonas', weight: 1 }] },
  { name: 'Emergency board', rule: 'any', n: null, threshold_percent: null, window_hours: 1, members: [{ username: 'ana', weight: 1 }, { username: 'dev', weight: 1 }, { username: 'jonas', weight: 1 }] },
];

export const SEED_KNOWLEDGE = [
  {
    number: 'ART-000001', title: 'Clearing an A1 plotter jam', keywords: ['plotter', 'jam', 'paper'],
    body: 'Open the front cover, lift the green lever and pull the sheet towards you. Reload the roll before closing.',
    helpful_yes: 4, helpful_no: 0, audience: { roles: [], departments: [] },
  },
  {
    number: 'ART-000002', title: 'Connecting to Remote access from home', keywords: ['vpn', 'remote', 'home'],
    body: 'Start the Remote access client, choose Marlowe Office and sign in with your usual password. If it drops, restart your home router.',
    helpful_yes: 2, helpful_no: 1, audience: { roles: [], departments: [] },
  },
  {
    number: 'ART-000003', title: 'Resetting your sign-in password', keywords: ['password', 'reset', 'locked'],
    body: 'Use the Reset password link on the sign-in page. After five failed tries the account locks for fifteen minutes.',
    helpful_yes: 0, helpful_no: 0, audience: { roles: [], departments: [] },
  },
  {
    number: 'ART-000004', title: 'Payroll export checklist', keywords: ['payroll', 'export', 'contractors'],
    body: 'Check that every contractor has a cost centre before running the monthly export.',
    helpful_yes: 0, helpful_no: 0, audience: { roles: [], departments: ['Finance'] },
  },
  {
    number: 'ART-000005', title: 'Installing the old plotter driver', keywords: ['plotter', 'driver'],
    body: 'Download the driver from the print server share and run the installer.',
    helpful_yes: 0, helpful_no: 0, audience: { roles: [], departments: [] }, valid_until: '2026-06-30',
  },
];

export const SEED_QUEUES = [
  { name: 'Open incidents', table: 'incident', filter: 'state in ["new", "assigned", "in_progress", "on_hold"]' },
  { name: 'My work', table: 'incident', filter: 'assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]' },
  { name: 'Unassigned', table: 'incident', filter: 'is_empty(assigned_to) and state in ["new", "assigned"]' },
  { name: 'Awaiting requester', table: 'incident', filter: 'state = "on_hold" and hold_reason = "awaiting_requester"' },
  { name: 'Major incidents', table: 'incident', filter: 'is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]' },
];
