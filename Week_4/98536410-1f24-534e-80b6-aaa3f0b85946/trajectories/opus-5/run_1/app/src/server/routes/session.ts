import { config } from '../config.js';
import {
  clearedCookieHeader,
  endSession,
  operatorOf,
  sessionCookieHeader,
  signIn,
} from '../auth.js';
import { bodyObject, requireSession } from '../http/context.js';
import type { RequestContext } from '../http/context.js';
import { json, noContent } from '../http/result.js';
import type { ApiResult } from '../http/result.js';
import { storageStatus } from '../services/storage.js';

let ready = false;

export function markReady(): void {
  ready = true;
}

export async function postSession(context: RequestContext): Promise<ApiResult> {
  const fields = bodyObject(context);
  const result = await signIn(fields['email'], fields['password']);
  return json(
    {
      user: {
        id: result.user.userId,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        operator_id: result.user.operatorId,
      },
      landing: result.landing,
    },
    200,
    { 'set-cookie': sessionCookieHeader(result.sessionId, config.sessionSeconds) },
  );
}

export async function getMe(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  return json({
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
      operator_id: session.operatorId,
    },
    operator: await operatorOf(session.operatorId),
    store_ids: session.storeIds,
    session_expires_at: session.expiresAt.toISOString(),
  });
}

export async function deleteSession(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  await endSession(session.sessionId);
  return noContent({ 'set-cookie': clearedCookieHeader() });
}

export async function getHealth(): Promise<ApiResult> {
  return ready ? json({ status: 'ok' }) : json({ status: 'starting' }, 503);
}

export async function getStatus(): Promise<ApiResult> {
  return json(storageStatus());
}
