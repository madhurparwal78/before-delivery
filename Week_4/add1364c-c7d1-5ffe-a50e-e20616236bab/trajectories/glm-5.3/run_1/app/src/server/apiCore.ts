import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, conflict, forbidden, invalid, notFound, unavailable, writeError } from './errors.js';
import { emptyOk, jsonOk } from './http.js';
import { officeTimeString, officeDateString, offsetAbbreviation } from './officeTime.js';
import type { Store } from './store.js';
import { decodeCursor } from './domain/audit.js';
import { mapPerson, type PersonRow } from './people.js';

export interface RequestCtx {
  store: Store;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
}

/** An authenticated request: the person, their session and its end. */
export interface Auth {
  person: PersonRow;
  sessionId: string;
  sessionEndsAt: Date;
}

export type Handler = (ctx: never) => Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  publicRoute?: boolean;
  handler: Handler;
}

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const COPY = {
  signInBadCredentials: `That username and password don't match.`,
  signInDisabled: `This sign-in is switched off. Ask the office manager.`,
  signInUnavailable: `Sign-in is unavailable right now. Try again in a minute.`,
  lockedPrefix: `Too many tries. Sign-in for this username reopens at `,
  sessionEndedHeading: `Your reveal session has ended`,
  sessionEndedBody: `Sign in again to reveal logins.`,
  turnRequired: `This login is past its 14-day leeway. Turn it before revealing.`,
  turnMessage: (vault: string, n: number): string => `${vault} needs at least ${n} characters.`,
  ruleChanged: `This rule changed since you opened it. Reload it and try again.`,
  cantSignNow: `This rule can't be signed now.`,
  alreadyLeft: (name: string): string => `${name} has already left.`,
  lineDecided: `This line is already decided.`,
  linesUndecided: `Decide every line before signing off.`,
  rotationExists: `This login already has a rotation.`,
  billingOutage: `Billing can't be reached. Seat changes wait here and are not counted until billing confirms them.`,
  feedOutageWithCheck: (stamp: string): string => `The breach feed can't be reached. Showing the last good check from ${stamp}.`,
  feedOutageNoCheck: `The breach feed can't be reached. No check has succeeded yet.`,
  tooLargeImport: `That file is too large to import.`,
  notUtf8: `Save the spreadsheet as UTF-8 CSV and try again.`,
  notBase64: `The file could not be read.`,
  wrongHeader: `The first row must be the Lockset column headings.`,
  tooManyRows: `Import at most 2,000 rows at a time.`,
  badFilename: `Give the file a name of 1 to 120 characters.`
};

export function readSessionCookie(header: string): string | null {
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('lockset_session=')) {
      const value = trimmed.slice('lockset_session='.length);
      if (value.length > 0) return value;
    }
  }
  return null;
}

/** Load a session; `sessionEnded` distinguishes the two 401s. */
export async function loadSession(
  store: Store,
  sessionId: string
): Promise<{ person: PersonRow; sessionEndsAt: Date; sessionEnded: boolean } | null> {
  const rows = await store.pool.query(
    `SELECT s.ends_at, s.ended_reason, p.id, p.full_name, p.email, p.handle, p.role, p.status,
            p.aliases, p.term_starts_on, p.term_ends_on, p.left_at, p.first_signed_in_at
     FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.id = $1`,
    [sessionId]
  );
  if (rows.rows.length === 0) return null;
  const row = rows.rows[0];
  const person = mapPerson(row);
  // A leave or term end answers signed_out even if the time limit has also passed.
  if (person.status === 'left' || person.left_at !== null) return null;
  const now = store.clock.now();
  const endsAt = new Date(row.ends_at as string);
  if (row.ended_reason === 'time_limit' || now.getTime() >= endsAt.getTime()) {
    return { person, sessionEndsAt: endsAt, sessionEnded: true };
  }
  return { person, sessionEndsAt: endsAt, sessionEnded: false };
}

export function signedOutError(): ApiError {
  return new ApiError(401, 'signed_out', 'Sign in to use the drawer.');
}

export function sessionEndedError(): ApiError {
  return new ApiError(401, 'session_ended', COPY.sessionEndedBody);
}

export function compileRoute(method: string, path: string, handler: Handler, publicRoute?: boolean): Route {
  const keys: string[] = [];
  const source = path.replace(/\{([a-zA-Z]+)\}/g, (_all, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, publicRoute, handler };
}

export function matchRoute(route: Route, method: string, pathname: string): Record<string, string> | null {
  if (route.method !== method) return null;
  const match = route.pattern.exec(pathname);
  if (!match) return null;
  const params: Record<string, string> = {};
  route.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] ?? '');
  });
  return params;
}
