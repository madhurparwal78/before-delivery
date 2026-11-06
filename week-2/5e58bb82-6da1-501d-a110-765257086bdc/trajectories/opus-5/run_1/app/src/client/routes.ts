import type { Role } from '../shared/types.js';

export type Screen =
  | { kind: 'fleet' }
  | { kind: 'fleetVessel'; vesselId: string }
  | { kind: 'missions' }
  | { kind: 'missionNew' }
  | { kind: 'mission'; missionId: string }
  | { kind: 'missionPlan'; missionId: string }
  | { kind: 'missionHistory'; missionId: string }
  | { kind: 'launch' }
  | { kind: 'flags' }
  | { kind: 'surveys' }
  | { kind: 'survey'; missionId: string };

export const ROLE_HOME: Record<Role, string> = {
  principal_surveyor: '/fleet',
  launch_technician: '/launch',
  client_reviewer: '/surveys',
};

const ID = /^[A-Za-z0-9._-]+$/;

const STAFF_SCREENS: Screen['kind'][] = [
  'fleet',
  'fleetVessel',
  'missions',
  'mission',
  'missionPlan',
  'missionHistory',
  'launch',
  'flags',
];

/** The same screen addresses the server publishes, parsed for the browser router. */
export function parseScreen(pathname: string): Screen | null {
  const parts = pathname.split('/').slice(1);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.some((part) => part === '')) return null;
  const [first, second, third] = parts;
  if (parts.length === 1) {
    if (first === 'fleet') return { kind: 'fleet' };
    if (first === 'missions') return { kind: 'missions' };
    if (first === 'launch') return { kind: 'launch' };
    if (first === 'flags') return { kind: 'flags' };
    if (first === 'surveys') return { kind: 'surveys' };
    return null;
  }
  if (parts.length === 2 && second !== undefined && ID.test(second)) {
    if (first === 'fleet') return { kind: 'fleetVessel', vesselId: second };
    if (first === 'surveys') return { kind: 'survey', missionId: second };
    if (first === 'missions') {
      return second === 'new' ? { kind: 'missionNew' } : { kind: 'mission', missionId: second };
    }
    return null;
  }
  if (parts.length === 3 && first === 'missions' && second !== undefined && ID.test(second)) {
    if (second === 'new') return null;
    if (third === 'plan') return { kind: 'missionPlan', missionId: second };
    if (third === 'history') return { kind: 'missionHistory', missionId: second };
  }
  return null;
}

export function roleMayOpen(role: Role, screen: Screen): boolean {
  if (role === 'client_reviewer') return screen.kind === 'surveys' || screen.kind === 'survey';
  if (screen.kind === 'missionNew') return role === 'principal_surveyor';
  return STAFF_SCREENS.includes(screen.kind);
}
