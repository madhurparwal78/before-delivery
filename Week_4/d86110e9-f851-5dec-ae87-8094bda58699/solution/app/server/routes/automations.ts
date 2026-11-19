import {
  createAutomation, draftView, findAutomation, listAutomations, listVersions, contentView, mutateDraft, publishDraft, versionContent,
  type AutomationRow,
} from '../automations.js';
import { workspaceNow } from '../clock.js';
import { db } from '../db.js';
import { addEdge, addStep, checkName, emptyDraft, removeEdge, removeStep, touchesContent, updateStep } from '../draft.js';
import { refuse } from '../errors.js';
import { publish } from '../events.js';
import { nodeOf } from '../graph.js';
import { heldByOther, takeHold } from '../holds.js';
import type { Ctx, Route } from '../http.js';
import { newId } from '../ids.js';
import type { JsonObject } from '../json.js';
import { isTriggerKind } from '../kinds.js';
import { msg } from '../messages.js';
import { exportBytes, importDraft } from '../portable.js';
import { putObject, StorageUnavailable } from '../storage.js';

const IMPORT_LIMIT = 262_144;

async function requireAutomation(ctx: Ctx): Promise<void> {
  if ((await findAutomation(db, ctx.workspaceId, ctx.params.aid ?? '')) === null) throw refuse.notFound();
}

async function requireStep(ctx: Ctx): Promise<void> {
  const row = await findAutomation(db, ctx.workspaceId, ctx.params.aid ?? '');
  if (row === null || nodeOf(row.draft, ctx.params.sid ?? '') === undefined) throw refuse.notFound();
}

async function loaded(ctx: Ctx): Promise<AutomationRow> {
  return (await findAutomation(db, ctx.workspaceId, ctx.params.aid ?? '')) as AutomationRow;
}

function announceDraft(ctx: Ctx, revision: number, stepId: string): void {
  publish(ctx.workspaceId, { type: 'draft', automation_id: ctx.params.aid ?? '', revision, step_id: stepId });
}

const storageDown = () => refuse.unavailable(msg.storageUnavailable);

export const automationRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:ws/automations',
    async handle(ctx) {
      return { status: 200, body: { automations: await listAutomations(ctx.workspaceId) } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/automations', access: 'write', body: 'json',
    async handle(ctx) {
      const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name !== '') checkName(name);
      if (name === '') throw refuse.invalid(msg.nameRequired);
      if (!isTriggerKind(ctx.body.trigger_kind)) throw refuse.invalid(msg.unknownKind(String(ctx.body.trigger_kind)));
      const created = await createAutomation(db, ctx.workspaceId, name, emptyDraft(ctx.body.trigger_kind));
      return { status: 201, body: await draftView(db, created) };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/automations/:aid', check: requireAutomation,
    async handle(ctx) {
      return { status: 200, body: await draftView(db, await loaded(ctx)) };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/automations/:aid/draft/steps', check: requireAutomation, access: 'write', body: 'json',
    async handle(ctx) {
      const { result, revision } = await mutateDraft(ctx.workspaceId, ctx.params.aid ?? '', (draft) => addStep(draft, ctx.body));
      announceDraft(ctx, revision, result.id);
      return { status: 201, body: result as unknown as JsonObject };
    },
  },
  {
    method: 'PUT', path: '/api/workspaces/:ws/automations/:aid/draft/steps/:sid', check: requireStep, access: 'write', body: 'json',
    async handle(ctx) {
      const stepId = ctx.params.sid ?? '';
      const aid = ctx.params.aid ?? '';
      const now = await workspaceNow(ctx.workspaceId);
      const { result, revision } = await mutateDraft(ctx.workspaceId, aid, async (draft, _row, client) => {
        const node = nodeOf(draft, stepId);
        if (node === undefined) throw refuse.notFound();
        const guarded = touchesContent(ctx.body);
        if (guarded) {
          const holder = await heldByOther(client, aid, stepId, ctx.user.id, now);
          if (holder !== null) throw refuse.conflict(msg.holdConflict(holder, node.name), { step: node as unknown as JsonObject });
        }
        updateStep(draft, stepId, ctx.body);
        if (guarded) await takeHold(client, aid, stepId, ctx.user.id, now);
        return structuredClone(node);
      });
      announceDraft(ctx, revision, stepId);
      return { status: 200, body: { step: result as unknown as JsonObject, revision } };
    },
  },
  {
    method: 'DELETE', path: '/api/workspaces/:ws/automations/:aid/draft/steps/:sid', check: requireStep, access: 'write',
    async handle(ctx) {
      const stepId = ctx.params.sid ?? '';
      const { revision } = await mutateDraft(ctx.workspaceId, ctx.params.aid ?? '', (draft) => removeStep(draft, stepId));
      announceDraft(ctx, revision, stepId);
      return { status: 204 };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/automations/:aid/draft/edges', check: requireAutomation, access: 'write', body: 'json',
    async handle(ctx) {
      const { result, revision } = await mutateDraft(ctx.workspaceId, ctx.params.aid ?? '', (draft) => addEdge(draft, ctx.body));
      announceDraft(ctx, revision, result.from);
      return { status: 201, body: result as unknown as JsonObject };
    },
  },
  {
    method: 'DELETE', path: '/api/workspaces/:ws/automations/:aid/draft/edges/:eid', check: requireAutomation, access: 'write',
    async handle(ctx) {
      const { result, revision } = await mutateDraft(ctx.workspaceId, ctx.params.aid ?? '', (draft) => removeEdge(draft, ctx.params.eid ?? ''));
      announceDraft(ctx, revision, result.from);
      return { status: 204 };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/automations/:aid/publish', check: requireAutomation, access: 'write',
    async handle(ctx) {
      return { status: 201, body: { ...(await publishDraft(ctx.workspaceId, ctx.params.aid ?? '', await workspaceNow(ctx.workspaceId))) } };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/automations/:aid/versions', check: requireAutomation,
    async handle(ctx) {
      return { status: 200, body: { versions: await listVersions(ctx.params.aid ?? '') } };
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:ws/automations/:aid/versions/:n', check: requireAutomation,
    async handle(ctx) {
      const found = await versionContent(db, ctx.params.aid ?? '', Number(ctx.params.n));
      if (found === null) throw refuse.notFound();
      const row = await loaded(ctx);
      return { status: 200, body: { id: row.id, name: row.name, trigger_kind: row.trigger_kind, revision: found.revision, version: Number(ctx.params.n), ...contentView(found.content) } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/automations/:aid/versions/:n/export', check: requireAutomation, access: 'write',
    async handle(ctx) {
      const version = Number(ctx.params.n);
      const found = await versionContent(db, ctx.params.aid ?? '', version);
      if (found === null) throw refuse.notFound();
      const bytes = exportBytes((await loaded(ctx)).name, found.content);
      try {
        await putObject(`exports/${ctx.workspaceId}/${ctx.params.aid}/v${version}.json`, bytes);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageDown();
        throw error;
      }
      return { status: 200, raw: bytes, contentType: 'application/json', headers: { 'content-disposition': `attachment; filename="automation-v${version}.json"` } };
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:ws/imports', access: 'write', body: 'raw', rawLimit: IMPORT_LIMIT,
    async handle(ctx) {
      const { name, draft } = importDraft(ctx.raw);
      const importId = newId('im');
      const key = `imports/${ctx.workspaceId}/${importId}.json`;
      try {
        await putObject(key, ctx.raw);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageDown();
        throw error;
      }
      const created = await createAutomation(db, ctx.workspaceId, name, draft);
      return { status: 201, body: { automation_id: created.id, import_id: importId, key } };
    },
  },
];

