import { createHash } from 'node:crypto';
import { JSON_BODY_LIMIT_BYTES, config } from '../config';
import { one, query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { createRun } from '../engine/runs';
import { mailReachable } from '../mail';
import { storageReachable } from '../storage';
import { findLiveByTrigger } from '../triggers';
import { workspaceNow } from '../time';
import { isObject, parseDecimal } from '../util';
import { readBody, type Ctx, type Reply, type Route } from '../http';
import type { AutomationContent, JsonObject, JsonValue } from '../../shared/types';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number';
}

export function formFields(content: AutomationContent): FormField[] {
  const raw = content.trigger.fields.form_fields;
  if (!Array.isArray(raw)) return [];
  const fields: FormField[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    fields.push({
      name,
      label: typeof item.label === 'string' && item.label !== '' ? item.label : name,
      type: item.type === 'number' ? 'number' : 'text',
    });
  }
  return fields;
}

async function submitForm(ctx: Ctx): Promise<Reply> {
  const automation = await findLiveByTrigger(ctx.params.slug, 'form', ctx.params.path);
  if (automation === null) throw notFound();
  const values: JsonObject = {};
  for (const field of formFields(automation.content)) {
    const given = ctx.body[field.name];
    const empty = given === undefined || given === null || (typeof given === 'string' && given.trim() === '');
    if (empty) throw badRequest(messages.requiredField(field.label), { field: field.name });
    if (field.type === 'number') {
      const parsed = typeof given === 'number' ? given : parseDecimal(String(given));
      if (parsed === null || !Number.isFinite(parsed)) {
        throw badRequest(messages.mustBeNumber(field.label), { field: field.name });
      }
      values[field.name] = parsed;
    } else {
      values[field.name] = typeof given === 'string' ? given : JSON.stringify(given);
    }
  }
  const live = await one<{ version: number; content: AutomationContent }>(
    `select v.version, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version where a.id = $1`,
    [automation.id],
  );
  if (live === null) throw notFound();
  const started = await createRun({
    workspaceId: automation.workspace_id,
    automationId: automation.id,
    version: live.version,
    content: live.content,
    triggerOutput: values,
    test: false,
  });
  return { status: 202, json: { run_id: started.run_id } };
}

function formEncoded(raw: Buffer): JsonObject {
  const params = new URLSearchParams(raw.toString('utf8'));
  const body: JsonObject = {};
  for (const [name, value] of params) body[name] = value;
  return body;
}

async function hook(ctx: Ctx): Promise<Reply> {
  const automation = await findLiveByTrigger(ctx.params.slug, 'webhook', ctx.params.path);
  if (automation === null) throw notFound();
  if ((ctx.req.method ?? 'GET').toUpperCase() !== 'POST') {
    throw new ApiError(405, messages.methodNotAllowed, { headers: { allow: 'POST' } });
  }
  let raw: Buffer;
  try {
    raw = await readBody(ctx.req, config.webhookBodyLimitBytes);
  } catch (error) {
    if (error instanceof ApiError && error.status === 413) throw new ApiError(413, messages.webhookTooLarge);
    throw error;
  }
  const contentType = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' && contentType !== 'application/x-www-form-urlencoded') {
    throw new ApiError(415, messages.webhookContentType);
  }
  let body: JsonObject;
  if (contentType === 'application/x-www-form-urlencoded') {
    body = formEncoded(raw);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw badRequest(messages.badJson);
    }
    if (!isObject(parsed)) throw badRequest(messages.notAnObject);
    body = parsed;
  }
  const key = ctx.req.headers['idempotency-key'];
  const hookPath = ctx.params.path;
  const bodyHash = createHash('sha256').update(raw).digest('hex');
  if (typeof key === 'string' && key !== '') {
    const now = await workspaceNow(automation.workspace_id);
    const existing = await one<{ body_hash: string; run_id: string; first_at: Date }>(
      'select body_hash, run_id, first_at from idempotency_keys where workspace_id = $1 and hook_path = $2 and key = $3',
      [automation.workspace_id, hookPath, key],
    );
    if (existing !== null) {
      const inWindow = existing.first_at.getTime() + config.idempotencyWindowSeconds * 1000 > now.getTime();
      if (inWindow) {
        if (existing.body_hash === bodyHash) {
          return { status: 200, json: { run_id: existing.run_id, replayed: true } };
        }
        throw new ApiError(409, messages.idempotencyConflict);
      }
    }
    const started = await startHookRun(automation.id, automation.workspace_id, body);
    await query(
      `insert into idempotency_keys (workspace_id, hook_path, key, body_hash, run_id, first_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (workspace_id, hook_path, key)
         do update set body_hash = $4, run_id = $5, first_at = $6`,
      [automation.workspace_id, hookPath, key, bodyHash, started, now],
    );
    return { status: 202, json: { run_id: started, replayed: false } };
  }
  const started = await startHookRun(automation.id, automation.workspace_id, body);
  return { status: 202, json: { run_id: started, replayed: false } };
}

async function startHookRun(automationId: string, workspaceId: string, body: JsonValue): Promise<string> {
  const live = await one<{ version: number; content: AutomationContent }>(
    `select v.version, v.content from automations a
       join versions v on v.automation_id = a.id and v.version = a.live_version where a.id = $1`,
    [automationId],
  );
  if (live === null) throw notFound();
  const started = await createRun({
    workspaceId,
    automationId,
    version: live.version,
    content: live.content,
    triggerOutput: body,
    test: false,
  });
  return started.run_id;
}

async function health(): Promise<Reply> {
  const [storage, mail] = await Promise.all([storageReachable(), mailReachable()]);
  return { status: 200, json: { status: storage && mail ? 'ok' : 'unavailable' } };
}

export const publicRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/forms/:slug/:path',
    body: 'json',
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    skipOriginCheck: true,
    handler: submitForm,
  },
  { method: '*', path: '/hooks/:slug/:path', skipOriginCheck: true, handler: hook },
  { method: 'GET', path: '/api/health', handler: health },
];
