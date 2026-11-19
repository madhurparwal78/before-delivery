import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { ownOrigin, readBody } from '../http/boundary.js';
import { json, noContent, publicRoute, redirect } from '../http/router.js';
import {
  SESSION_COOKIE,
  clearCookie,
  createSession,
  destroySession,
  parseCookies,
  setCookie,
  upsertMemberFromIdentity,
  venueById,
} from '../auth.js';
import { RANGES, asObject, onlyFields, readString, sniffDocumentType } from '../domain/validate.js';
import { documentKey, documentsUnavailable } from '../statements.js';
import { putObject } from '../providers/s3.js';
import { ProviderUnreachable } from '../providers/http.js';
import {
  InvalidCredentials,
  buildAuthorizationRequest,
  exchangeCode,
  passwordGrant,
  setPassword,
} from '../providers/keycloak.js';
import { iso } from '../domain/views.js';
import { shellPage } from '../http/shell.js';
import { memberRoute } from '../http/router.js';
import type { Actor } from '../auth.js';
import type { Member } from '../domain/types.js';
import type { Context, Reply, Route } from '../http/router.js';

const ATTEMPT_COOKIE = 'pv_auth';
const ATTEMPT_TTL_SECONDS = 600;

export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
  venue: { id: string; slug: string; name: string; time_zone: string } | null;
}

export async function meOf(actor: Actor): Promise<Me> {
  return {
    id: actor.member.id,
    username: actor.member.username,
    display_name: actor.member.display_name,
    email: actor.member.email,
    roles: actor.member.roles,
    venue:
      actor.venue === null
        ? null
        : {
            id: actor.venue.id,
            slug: actor.venue.slug,
            name: actor.venue.name,
            time_zone: actor.venue.time_zone,
          },
  };
}

const sameSitePath = (next: string | null): string =>
  next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/';

const redirectUri = (request: import('node:http').IncomingMessage): string =>
  `${ownOrigin(request)}/auth/callback`;

export const sessionRoutes: Route[] = [
  publicRoute('GET', '/auth/login', async ({ request, response, url }) => {
    const attempt = buildAuthorizationRequest(redirectUri(request));
    await pool.query(
      'insert into auth_attempts (state, nonce, code_verifier, next_path) values ($1,$2,$3,$4)',
      [attempt.state, attempt.nonce, attempt.codeVerifier, sameSitePath(url.searchParams.get('next'))],
    );
    setCookie(response, ATTEMPT_COOKIE, attempt.state, ATTEMPT_TTL_SECONDS);
    return redirect(attempt.url);
  }),

  publicRoute('GET', '/auth/callback', async ({ request, response, url }) => {
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const bound = parseCookies(request.headers.cookie)[ATTEMPT_COOKIE];
    clearCookie(response, ATTEMPT_COOKIE);

    if (state === null || code === null || bound !== state) return signInError();
    const claimed = await pool.query<{ code_verifier: string; next_path: string }>(
      `update auth_attempts set used_at = now()
        where state = $1 and used_at is null and created_at > now() - interval '10 minutes'
        returning code_verifier, next_path`,
      [state],
    );
    const attempt = claimed.rows[0];
    if (attempt === undefined) return signInError();

    try {
      const identity = await exchangeCode(code, redirectUri(request), attempt.code_verifier);
      const member = await upsertMemberFromIdentity(identity);
      await createSession(response, member.id);
      return redirect(attempt.next_path);
    } catch (error) {
      if (error instanceof ProviderUnreachable) return signInUnavailable();
      return signInError();
    }
  }),

  publicRoute('POST', '/api/session', async ({ response, body }) => {
    const fields = asObject(body);
    onlyFields(fields, ['username', 'password']);
    const username = readString(fields, 'username');
    const password = readString(fields, 'password');
    try {
      const identity = await passwordGrant(username, password);
      const member = await upsertMemberFromIdentity(identity);
      await createSession(response, member.id);
      return json(200, await meOf(await actorFor(member)));
    } catch (error) {
      if (error instanceof InvalidCredentials) throw new ApiError(401, 'invalid_credentials');
      if (error instanceof ProviderUnreachable) throw new ApiError(503, 'sign_in_unavailable');
      throw error;
    }
  }),

  memberRoute('DELETE', '/api/session', {}, async ({ request, response }) => {
    await destroySession(request);
    clearCookie(response, SESSION_COOKIE);
    return noContent();
  }),

  memberRoute('GET', '/api/me', {}, async ({ actor }) => json(200, await meOf(actor))),

  memberRoute('PATCH', '/api/me', { venue: true }, async ({ actor, body }) => {
    const fields = asObject(body);
    onlyFields(fields, ['display_name']);
    const displayName = readString(fields, 'display_name').trim();
    if (displayName.length < RANGES.displayName.min || displayName.length > RANGES.displayName.max) {
      throw new ValidationError({ display_name: 'invalid' });
    }
    await pool.query('update members set display_name = $2 where id = $1', [
      actor.member.id,
      displayName,
    ]);
    return json(200, await meOf({ ...actor, member: { ...actor.member, display_name: displayName } }));
  }),

  memberRoute('GET', '/api/me/documents', { venue: true }, async ({ actor }) => {
    const result = await pool.query<{
      id: string;
      filename: string;
      content_type: string;
      size_bytes: number;
      uploaded_at: Date;
    }>(
      `select id, filename, content_type, size_bytes, uploaded_at from documents
        where member_id = $1 order by uploaded_at desc`,
      [actor.member.id],
    );
    return json(200, {
      documents: result.rows.map((row) => ({ ...row, uploaded_at: iso(row.uploaded_at) })),
    });
  }),

  memberRoute('POST', '/api/me/documents', { venue: true, rawBody: true }, uploadDocument),

  publicRoute('GET', '/api/invites/:token', async ({ params }) => {
    const result = await pool.query<{ email: string; venue_name: string; expired: boolean }>(
      `select i.email, v.name as venue_name, (i.expires_at <= now()) as expired
         from invites i join venues v on v.id = i.venue_id
        where i.token = $1 and i.accepted_at is null`,
      [params.token],
    );
    const invite = result.rows[0];
    if (invite === undefined) throw new ApiError(404, 'not_found');
    if (invite.expired) throw new ApiError(410, 'invite_expired');
    return json(200, { email: invite.email, venue_name: invite.venue_name });
  }),

  publicRoute('POST', '/api/invites/:token/accept', async ({ params, body }) => {
    const fields = asObject(body);
    onlyFields(fields, ['password']);
    const password = readString(fields, 'password');
    if (password.length < RANGES.password.min || password.length > RANGES.password.max) {
      throw new ValidationError({ password: 'invalid' });
    }
    const result = await pool.query<{ email: string; keycloak_user_id: string; expired: boolean }>(
      `select i.email, m.keycloak_user_id, (i.expires_at <= now()) as expired
         from invites i join members m on m.id = i.member_id
        where i.token = $1 and i.accepted_at is null`,
      [params.token],
    );
    const invite = result.rows[0];
    if (invite === undefined) throw new ApiError(404, 'not_found');
    if (invite.expired) throw new ApiError(410, 'invite_expired');
    try {
      await setPassword(invite.keycloak_user_id, password);
    } catch (error) {
      if (error instanceof ProviderUnreachable) throw new ApiError(503, 'identity_unavailable');
      throw error;
    }
    await pool.query('update invites set accepted_at = now() where token = $1', [params.token]);
    return json(200, { email: invite.email });
  }),
];

async function actorFor(member: Member): Promise<Actor> {
  const venue = member.venue_id === null ? null : await venueById(pool, member.venue_id);
  return { member, venue, apiKeyId: null };
}

const signInError = (): Reply => ({
  status: 400,
  raw: { contentType: 'text/html; charset=utf-8', payload: shellPage('sign_in_error') },
});

const signInUnavailable = (): Reply => ({
  status: 503,
  raw: { contentType: 'text/html; charset=utf-8', payload: shellPage('sign_in_unavailable') },
});

const MULTIPART = /^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i;

interface Part {
  name: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

function parseMultipart(body: Buffer, boundary: string): Part[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const section = body.subarray(start + 2, next - 2);
    const split = section.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = section.subarray(0, split).toString('latin1');
      const name = /name="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1] ?? '';
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? '';
      parts.push({ name, filename, contentType, bytes: section.subarray(split + 4) });
    }
    index = next;
  }
  return parts;
}

async function uploadDocument(context: Context<undefined>): Promise<Reply> {
  const boundary = MULTIPART.exec(context.request.headers['content-type'] ?? '');
  if (boundary === null) throw new ValidationError({ document: 'invalid' });
  const raw = await readBody(context.request, RANGES.documentBytes.max + 64 * 1024);
  const part = parseMultipart(raw, (boundary[1] ?? boundary[2]) as string).find(
    (item) => item.name === 'document',
  );
  if (part === undefined) throw new ValidationError({ document: 'invalid' });
  if (part.bytes.length > RANGES.documentBytes.max) throw new ApiError(413, 'payload_too_large');
  const contentType = sniffDocumentType(part.bytes);
  if (contentType === null) throw new ValidationError({ document: 'unsupported_type' });

  const venue = context.actor.venue;
  if (venue === null) throw new ApiError(403, 'forbidden');
  const id = randomUUID();
  try {
    await putObject(documentKey(venue.id, context.actor.member.id, id), part.bytes, contentType);
  } catch (error) {
    if (error instanceof ProviderUnreachable) throw documentsUnavailable();
    throw error;
  }
  const filename = part.filename.length > 0 ? part.filename.slice(0, 200) : 'document';
  await pool.query(
    `insert into documents (id, venue_id, member_id, filename, content_type, size_bytes)
     values ($1,$2,$3,$4,$5,$6)`,
    [id, venue.id, context.actor.member.id, filename, contentType, part.bytes.length],
  );
  return json(201, {
    id,
    filename,
    content_type: contentType,
    size_bytes: part.bytes.length,
    uploaded_at: iso(new Date()),
  });
}
