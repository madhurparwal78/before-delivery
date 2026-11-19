import type { AutomationRow } from '../automations.js';
import { workspaceNow } from '../clock.js';
import { parseDecimal } from '../conditions.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { startRun } from '../engine.js';
import { refuse } from '../errors.js';
import { hasJsonType, parseObject, readBody, shellPage, JSON_LIMIT, type Route } from '../http.js';
import type { Json, JsonObject } from '../json.js';
import { msg } from '../messages.js';
import type { Content } from '../model.js';
import { stringify } from '../template.js';

interface Live {
  automation: AutomationRow;
  content: Content;
}

async function findLive(slug: string, column: 'live_form_path' | 'live_hook_path', path: string): Promise<Live | null> {
  const { rows } = await db.query<AutomationRow>(
    `SELECT a.* FROM automations a JOIN workspaces w ON w.id = a.workspace_id WHERE w.slug = $1 AND a.${column} = $2 AND a.live_version IS NOT NULL`,
    [slug, path],
  );
  const automation = rows[0];
  if (automation === undefined) return null;
  const version = await db.query<{ content: Content }>('SELECT content FROM versions WHERE automation_id = $1 AND version = $2', [automation.id, automation.live_version]);
  return { automation, content: (version.rows[0] as { content: Content }).content };
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number';
}

const fieldsOf = (content: Content): FormField[] => content.trigger.fields.form_fields as unknown as FormField[];

/** Validates a submission against the published fields; text stays text and number fields become numbers. */
function formValues(fields: FormField[], body: JsonObject): JsonObject {
  const values: JsonObject = {};
  for (const field of fields) {
    const given = body[field.name];
    if (given === undefined || given === null || (typeof given === 'string' && given.trim() === '')) throw refuse.field(msg.required(field.label), field.name);
    if (field.type === 'text') {
      values[field.name] = stringify(given);
      continue;
    }
    const number = typeof given === 'number' ? given : typeof given === 'string' ? parseDecimal(given) : null;
    if (number === null || !Number.isFinite(number)) throw refuse.field(msg.numberField(field.label), field.name);
    values[field.name] = number;
  }
  return values;
}

async function lock(tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, ...parts: string[]): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(parts)]);
}

/** Starts the hook's run, or answers a repeated delivery from the key the first one recorded. */
async function receiveDelivery(live: Live, hookPath: string, key: string | null, raw: Buffer, payload: JsonObject): Promise<{ status: 200 | 202; body: JsonObject }> {
  const workspaceId = live.automation.workspace_id;
  const begin = async () => (await startRun({ workspaceId, automation: live.automation, test: false, triggerOutput: payload, at: await workspaceNow(workspaceId) })).run_id;
  if (key === null) return { status: 202, body: { run_id: await begin(), replayed: false } };
  return db.tx(async (client) => {
    await lock(client, workspaceId, hookPath, key);
    const now = await workspaceNow(workspaceId);
    const { rows } = await client.query<{ body: Buffer; run_id: string; first_at: number }>(
      'SELECT body, run_id, first_at FROM idempotency_keys WHERE workspace_id = $1 AND hook_path = $2 AND idem_key = $3',
      [workspaceId, hookPath, key],
    );
    const known = rows[0];
    if (known !== undefined && now < known.first_at + config.idempotencyWindowSeconds * 1000) {
      if (!known.body.equals(raw)) throw refuse.conflict(msg.keyConflict);
      return { status: 200, body: { run_id: known.run_id, replayed: true } };
    }
    const runId = await begin();
    await client.query(
      `INSERT INTO idempotency_keys (workspace_id, hook_path, idem_key, body, run_id, first_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, hook_path, idem_key) DO UPDATE SET body = EXCLUDED.body, run_id = EXCLUDED.run_id, first_at = EXCLUDED.first_at`,
      [workspaceId, hookPath, key, raw, runId, now],
    );
    return { status: 202, body: { run_id: runId, replayed: false } };
  });
}

export const publicRoutes: Route[] = [
  {
    method: 'GET', path: '/forms/:slug/:path', auth: 'public',
    async handle(ctx) {
      const live = await findLive(ctx.params.slug ?? '', 'live_form_path', ctx.params.path ?? '');
      if (live === null) return shellPage(404);
      return shellPage(200, { name: live.automation.name, fields: fieldsOf(live.content) as unknown as Json[] });
    },
  },
  {
    method: 'POST', path: '/api/forms/:slug/:path', auth: 'public', anyOrigin: true,
    async handle(ctx) {
      const live = await findLive(ctx.params.slug ?? '', 'live_form_path', ctx.params.path ?? '');
      if (live === null) throw refuse.notFound();
      const raw = await readBody(ctx.request, JSON_LIMIT);
      if (!hasJsonType(ctx.request)) throw refuse.unsupported(msg.contentType);
      const values = formValues(fieldsOf(live.content), parseObject(raw));
      const started = await startRun({
        workspaceId: live.automation.workspace_id, automation: live.automation, test: false, triggerOutput: values,
        at: await workspaceNow(live.automation.workspace_id),
      });
      return { status: 202, body: { run_id: started.run_id } };
    },
  },
  {
    method: '*', path: '/hooks/:slug/:path', auth: 'public', anyOrigin: true,
    async handle(ctx) {
      const live = await findLive(ctx.params.slug ?? '', 'live_hook_path', ctx.params.path ?? '');
      if (live === null) throw refuse.notFound();
      if (ctx.request.method !== 'POST') throw refuse.notAllowed();
      const raw = await readBody(ctx.request, config.webhookBodyLimitBytes);
      const type = (ctx.request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      let payload: JsonObject;
      if (type === 'application/json') payload = parseObject(raw);
      else if (type === 'application/x-www-form-urlencoded') payload = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      else throw refuse.unsupported(msg.webhookContentType);
      const key = ctx.request.headers['idempotency-key'];
      const delivered = await receiveDelivery(live, ctx.params.path ?? '', typeof key === 'string' && key !== '' ? key : null, raw, payload);
      return { status: delivered.status, body: delivered.body };
    },
  },
];

