import type { AccessLevel } from '../shared/api';
import { trialState, workspaceNow, type TrialState, type WorkspaceRecord } from './clock';
import { fail } from './errors';
import { findUserById, findWorkspace, findSessionUser, type UserRecord } from './accounts';
import { findDrawingRecord, type DrawingRecord } from './drawings';
import { assertLinkUsable, findShareByToken, shareStatus, type ShareRecord } from './shares';
import type { RequestContext } from './http';
import { config } from './config';

export interface DrawingCaller {
  drawing: DrawingRecord;
  workspace: WorkspaceRecord;
  access: AccessLevel;
  actor: { name: string; key: string };
  user: UserRecord | null;
  share: ShareRecord | null;
  owner: UserRecord | null;
  ownerName: string;
  ownerTrial: TrialState;
  now: Date;
}

/** Event streams cannot set headers, so they carry the link token as a query parameter. */
function linkToken(context: RequestContext): string | null {
  const header = context.header('authorization');
  if (header !== undefined) {
    const match = /^Link\s+(.+)$/i.exec(header.trim());
    if (match !== null) return match[1]!.trim();
  }
  return context.query('link');
}

/**
 * Resolves the caller of a drawing endpoint, following the published error order:
 * missing credentials, then unknown resource, then link status.
 */
export async function resolveDrawingCaller(context: RequestContext, drawingId: string): Promise<DrawingCaller> {
  const token = linkToken(context);
  const sessionToken = context.cookie(config.sessionCookie);

  if (token !== null) {
    const share = await findShareByToken(token);
    if (share === null || share.drawing_id !== drawingId) fail('not_found');
    const drawing = await findDrawingRecord(share.drawing_id);
    if (drawing === null) fail('not_found');
    const workspace = await findWorkspace(drawing.workspace_id);
    if (workspace === null) fail('not_found');
    const now = workspaceNow(workspace);
    assertLinkUsable(shareStatus(share, workspace, now));
    const owner = drawing.owner_user_id === null ? null : await findUserById(drawing.owner_user_id);
    return {
      drawing,
      workspace,
      access: share.access,
      actor: { name: share.recipient_name, key: `share:${share.id}` },
      user: null,
      share,
      owner,
      ownerName: owner?.name ?? 'Corbel Works',
      ownerTrial: trialState(owner?.confirmed_on ?? null, workspace),
      now,
    };
  }

  if (sessionToken === undefined) fail('unauthenticated');
  const user = await findSessionUser(sessionToken);
  if (user === null) fail('unauthenticated');
  const drawing = await findDrawingRecord(drawingId);
  if (drawing === null || drawing.workspace_id !== user.workspace_id) fail('not_found');
  const workspace = await findWorkspace(drawing.workspace_id);
  if (workspace === null) fail('not_found');
  const owner = drawing.owner_user_id === null ? null : await findUserById(drawing.owner_user_id);
  return {
    drawing,
    workspace,
    access: drawing.owner_user_id === user.id ? 'owner' : 'view',
    actor: { name: user.name, key: `user:${user.id}` },
    user,
    share: null,
    owner,
    ownerName: owner?.name ?? 'Corbel Works',
    ownerTrial: trialState(owner?.confirmed_on ?? null, workspace),
    now: workspaceNow(workspace),
  };
}

export interface WorkspaceCaller {
  workspace: WorkspaceRecord;
  access: AccessLevel;
  now: Date;
}

/** Resolves the workspace behind a request, through either a session or a share link. */
export async function resolveWorkspaceCaller(context: RequestContext): Promise<WorkspaceCaller> {
  const token = linkToken(context);
  if (token !== null) {
    const share = await findShareByToken(token);
    if (share === null) fail('not_found');
    const drawing = await findDrawingRecord(share.drawing_id);
    if (drawing === null) fail('not_found');
    const workspace = await findWorkspace(drawing.workspace_id);
    if (workspace === null) fail('not_found');
    const now = workspaceNow(workspace);
    assertLinkUsable(shareStatus(share, workspace, now));
    return { workspace, access: share.access, now };
  }
  const sessionToken = context.cookie(config.sessionCookie);
  if (sessionToken === undefined) fail('unauthenticated');
  const user = await findSessionUser(sessionToken);
  if (user === null) fail('unauthenticated');
  const workspace = await findWorkspace(user.workspace_id);
  if (workspace === null) fail('not_found');
  return { workspace, access: 'owner', now: workspaceNow(workspace) };
}

export function assertWorkspaceOwner(caller: WorkspaceCaller): void {
  if (caller.access === 'view') fail('view_only');
  if (caller.access === 'markup') fail('markup_only');
  if (caller.access !== 'owner') fail('forbidden');
}

function refuseByLevel(caller: DrawingCaller): void {
  if (caller.access === 'view') fail('view_only');
  if (caller.access === 'markup') fail('markup_only');
}

/** Base geometry writes: owner and edit only, and never after the owner's trial has ended. */
export function assertBaseWrite(caller: DrawingCaller): void {
  refuseByLevel(caller);
  if (caller.ownerTrial.ended) fail('trial_ended');
}

/** Exports are refused to view and mark-up links. */
export function assertExportAllowed(caller: DrawingCaller): void {
  refuseByLevel(caller);
}

/** Owner-only actions: shares, invites, revocation, revisions, closing traces, resolving issues. */
export function assertOwner(caller: DrawingCaller): void {
  refuseByLevel(caller);
  if (caller.access !== 'owner') fail('forbidden');
}

/** Traces may be created by every level except view. */
export function assertTraceWrite(caller: DrawingCaller): void {
  if (caller.access === 'view') fail('view_only');
}
