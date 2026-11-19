import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { db, Queryable } from '../db.js';
import { conflict, forbidden, notFound, notSignedIn } from '../http.js';
import { PersonRow, Role, WorkspaceRow } from '../domain/types.js';
import { roleOf, workspaceById } from '../domain/workspaces.js';

export interface RequestContext {
  method: string;
  segments: string[];
  query: URLSearchParams;
  body: Record<string, unknown>;
  rawBody: Buffer;
  idempotencyKey: string | null;
  sessionToken: string | null;
  person: PersonRow | null;
  response: ServerResponse;
  cookies: string[];
}

export interface WorkspaceContext {
  person: PersonRow;
  workspace: WorkspaceRow;
  role: Role;
}

export const VIEWER_COPY = "Viewers can't make changes in this workspace.";
export const PRODUCER_COPY = 'Only the owner can change producer behaviour.';
export const MEMBERS_COPY = 'Only the owner can manage members.';

export function requirePerson(ctx: RequestContext): PersonRow {
  if (!ctx.person) throw notSignedIn();
  return ctx.person;
}

/** 401 then 404: another workspace's resource is always 404. */
export async function requireWorkspace(
  ctx: RequestContext,
  workspaceId: string,
): Promise<WorkspaceContext> {
  const person = requirePerson(ctx);
  const workspace = await workspaceById(db, workspaceId);
  if (!workspace) throw notFound();
  const role = await roleOf(db, workspaceId, person.id);
  if (!role) throw notFound();
  return { person, workspace, role };
}

export type WriteScope = 'producer' | 'members' | 'transaction';

export function requireWrite(role: Role, scope: WriteScope): void {
  if (role === 'viewer') throw forbidden(VIEWER_COPY);
  if (role === 'developer' && scope === 'producer') throw forbidden(PRODUCER_COPY);
  if (role === 'developer' && scope === 'members') throw forbidden(MEMBERS_COPY);
}

export interface StoredResponse {
  status: number;
  body: unknown;
}

function fingerprintOf(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Repeating a key with the same body replays the stored response. */
export async function replayIdempotent(
  ctx: RequestContext,
  workspaceId: string,
  personId: string,
): Promise<StoredResponse | null> {
  if (!ctx.idempotencyKey) return null;
  const { rows } = await db.query<{
    request_fingerprint: string;
    response_status: number;
    response_body: string;
  }>(
    `SELECT request_fingerprint, response_status, response_body FROM idempotency_keys
     WHERE person_id = $1 AND workspace_id = $2 AND key = $3`,
    [personId, workspaceId, ctx.idempotencyKey],
  );
  const stored = rows[0];
  if (!stored) return null;
  if (stored.request_fingerprint !== fingerprintOf(ctx.rawBody)) {
    throw conflict('This idempotency key was used for a different request.');
  }
  return { status: stored.response_status, body: JSON.parse(stored.response_body) };
}

export async function storeIdempotent(
  tx: Queryable,
  ctx: RequestContext,
  workspaceId: string,
  personId: string,
  result: StoredResponse,
): Promise<void> {
  if (!ctx.idempotencyKey) return;
  await tx.query(
    `INSERT INTO idempotency_keys
       (person_id, workspace_id, key, request_fingerprint, response_status, response_body, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (person_id, workspace_id, key) DO NOTHING`,
    [
      personId,
      workspaceId,
      ctx.idempotencyKey,
      fingerprintOf(ctx.rawBody),
      result.status,
      JSON.stringify(result.body),
    ],
  );
}

export function readString(ctx: RequestContext, field: string): string {
  const value = ctx.body[field];
  return typeof value === 'string' ? value : '';
}

export function readBoolean(ctx: RequestContext, field: string): boolean | null {
  const value = ctx.body[field];
  return typeof value === 'boolean' ? value : null;
}
