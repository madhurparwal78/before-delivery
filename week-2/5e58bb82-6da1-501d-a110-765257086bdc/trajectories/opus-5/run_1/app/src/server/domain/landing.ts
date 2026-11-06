import type { Role } from '../../shared/types.js';

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

/** Parses a path part into the screen it names, or null when it names none. */
export function parseScreen(pathname: string): Screen | null {
  const segments = pathname.split('/');
  if (segments[0] !== '') return null;
  const parts = segments.slice(1);
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

export function roleMayOpen(role: Role, screen: Screen): boolean {
  if (role === 'client_reviewer') return screen.kind === 'surveys' || screen.kind === 'survey';
  if (screen.kind === 'missionNew') return role === 'principal_surveyor';
  return STAFF_SCREENS.includes(screen.kind);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The shape half of the safe-return rule: exactly one leading slash, no
 * protocol-relative or backslash second character before or after one round of
 * percent-decoding, and no control character.
 */
export function isSafeShape(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0) return false;
  if (hasControlCharacter(raw)) return false;
  const check = (value: string): boolean =>
    value.startsWith('/') && value[1] !== '/' && value[1] !== '\\';
  if (!check(raw)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  if (hasControlCharacter(decoded)) return false;
  return check(decoded);
}

export function splitPath(raw: string): { pathname: string; query: string } {
  const hash = raw.indexOf('#');
  const withoutHash = hash === -1 ? raw : raw.slice(0, hash);
  const mark = withoutHash.indexOf('?');
  return mark === -1
    ? { pathname: withoutHash, query: '' }
    : { pathname: withoutHash.slice(0, mark), query: withoutHash.slice(mark) };
}

export interface ScopeLookup {
  missionOrgId(missionId: string): Promise<string | null>;
  missionIsOpen(missionId: string): Promise<boolean>;
  vesselExists(vesselId: string): Promise<boolean>;
}

/**
 * The one safe-return decision: a path is safe for a role only when its shape
 * holds, it names a screen the role may open, and for a client reviewer any
 * survey address names a mission of their own organisation.
 */
export async function isSafePath(
  raw: string,
  role: Role,
  clientOrgId: string | null,
  lookup: ScopeLookup,
): Promise<boolean> {
  if (!isSafeShape(raw)) return false;
  const { pathname } = splitPath(raw);
  const screen = parseScreen(pathname);
  if (!screen) return false;
  if (!roleMayOpen(role, screen)) return false;
  if (role === 'client_reviewer' && screen.kind === 'survey') {
    const org = await lookup.missionOrgId(screen.missionId);
    if (org === null || org !== clientOrgId) return false;
  }
  return true;
}

/** A stored last screen qualifies only while the record it names still does. */
async function lastScreenQualifies(
  raw: string,
  role: Role,
  clientOrgId: string | null,
  lookup: ScopeLookup,
): Promise<boolean> {
  if (!(await isSafePath(raw, role, clientOrgId, lookup))) return false;
  const screen = parseScreen(splitPath(raw).pathname);
  if (!screen) return false;
  switch (screen.kind) {
    case 'fleetVessel':
      return lookup.vesselExists(screen.vesselId);
    case 'mission':
    case 'missionPlan':
    case 'missionHistory':
      return lookup.missionIsOpen(screen.missionId);
    case 'survey':
      return (await lookup.missionOrgId(screen.missionId)) === clientOrgId;
    default:
      return true;
  }
}

/** The one landing decision used by sign-in. */
export async function landingAddress(
  next: string | null | undefined,
  lastScreen: string | null,
  role: Role,
  clientOrgId: string | null,
  lookup: ScopeLookup,
): Promise<string> {
  const home = ROLE_HOME[role];
  if (typeof next === 'string' && next.length > 0) {
    return (await isSafePath(next, role, clientOrgId, lookup)) ? next : home;
  }
  if (lastScreen && (await lastScreenQualifies(lastScreen, role, clientOrgId, lookup))) {
    return lastScreen;
  }
  return home;
}
