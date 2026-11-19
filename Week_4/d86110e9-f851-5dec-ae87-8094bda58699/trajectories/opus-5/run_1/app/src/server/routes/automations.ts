import { IMPORT_BODY_LIMIT_BYTES, config } from '../config';
import { one, query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { withLock } from '../locks';
import { publishContent } from '../publishing';
import { StorageUnavailable, putObject } from '../storage';
import { send } from '../sse';
import { pushDrainIfChanged } from '../engine/view';
import { workspaceNow } from '../time';
import { isObject, newId } from '../util';
import { checkName, type Ctx, type Reply, type Route } from '../http';
import {
  automationDetail,
  cellInsideGrid,
  cellTaken,
  checkEdge,
  contentForImport,
  defaultContent,
  defaultStepFields,
  drainCount,
  edgesOf,
  exportFile,
  findNode,
  isStepKind,
  isTriggerKind,
  loadAutomation,
  nextRunAt,
  nextStepName,
  saveDraft,
  stepNumber,
  type AutomationRow,
} from '../automations';
import { KIND_LABELS, type AutomationContent, type JsonObject, type StepNode } from '../../shared/types';

async function requireAutomation(ctx: Ctx): Promise<AutomationRow> {
  const automation = await loadAutomation(ctx.workspace.id, ctx.params.aid);
  if (automation === null) throw notFound();
  return automation;
}

async function listAutomations(ctx: Ctx): Promise<Reply> {
  const rows = await query<AutomationRow>(
    'select * from automations where workspace_id = $1 order by created_at',
    [ctx.workspace.id],
  );
  const automations = [];
  for (const row of rows) {
    automations.push({
      id: row.id,
      name: row.name,
      trigger_kind: row.trigger_kind,
      live_version: row.live_version,
      next_run_at: await nextRunAt(row.id),
      drain_count: await drainCount(row.id),
    });
  }
  return { status: 200, json: { automations } };
}

async function createAutomation(ctx: Ctx): Promise<Reply> {
  const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
  checkName(name);
  const kind = typeof ctx.body.trigger_kind === 'string' ? ctx.body.trigger_kind : '';
  if (name === '') throw badRequest(messages.nameRequired);
  if (!isTriggerKind(kind)) throw badRequest(messages.unknownNodeKind(kind));
  const id = typeof ctx.body.id === 'string' ? ctx.body.id : newId('au');
  const content = defaultContent(kind);
  await query(
    'insert into automations (id, workspace_id, name, trigger_kind, draft, revision) values ($1, $2, $3, $4, $5, 1)',
    [id, ctx.workspace.id, name, kind, JSON.stringify(content)],
  );
  const automation = await loadAutomation(ctx.workspace.id, id);
  if (automation === null) throw notFound();
  return { status: 201, json: await automationDetail(automation) };
}

async function readAutomation(ctx: Ctx): Promise<Reply> {
  return { status: 200, json: await automationDetail(await requireAutomation(ctx)) };
}

function pushDraft(ctx: Ctx, automation: AutomationRow, stepId: string | null): void {
  send({
    type: 'draft',
    workspace_id: ctx.workspace.id,
    automation_id: automation.id,
    revision: automation.revision,
    step_id: stepId,
  });
}

async function addStep(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    const col = Number(ctx.body.col);
    const row = Number(ctx.body.row);
    const kind = typeof ctx.body.kind === 'string' ? ctx.body.kind : '';
    if (cellTaken(fresh.draft, col, row)) throw new ApiError(409, messages.cellTaken);
    if (!isStepKind(kind)) throw badRequest(messages.unknownNodeKind(kind));
    if (!cellInsideGrid(col, row)) throw badRequest(messages.cellOutside);
    const restoreId = typeof ctx.body.id === 'string' ? ctx.body.id : null;
    const taken = restoreId !== null && findNode(fresh.draft, restoreId) !== undefined;
    let step: StepNode;
    if (restoreId !== null && !taken) {
      const count = fresh.kind_counts[kind] ?? 1;
      step = {
        id: restoreId,
        kind,
        name: `${KIND_LABELS[kind]} ${count}`,
        col,
        row,
        fields: defaultStepFields(kind),
      };
      fresh.step_seq = Math.max(fresh.step_seq, stepNumber(restoreId));
    } else {
      fresh.step_seq += 1;
      step = {
        id: `s${fresh.step_seq}`,
        kind,
        name: nextStepName(fresh, kind),
        col,
        row,
        fields: defaultStepFields(kind),
      };
      fresh.kind_counts = { ...fresh.kind_counts, [kind]: (fresh.kind_counts[kind] ?? 0) + 1 };
    }
    fresh.draft.steps.push(step);
    await saveDraft(fresh);
    pushDraft(ctx, fresh, step.id);
    return { status: 201, json: step };
  });
}

interface HoldRow {
  user_id: string;
  held_at: Date;
  name: string;
}

async function updateStep(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    const stepId = ctx.params.sid;
    const node = findNode(fresh.draft, stepId);
    if (node === undefined) throw notFound();
    const body = ctx.body;
    checkName(body.name);
    if (body.sample !== undefined && !isObject(body.sample)) throw badRequest(messages.sampleObject);
    const movesOnly =
      body.name === undefined && body.fields === undefined && body.sample === undefined;
    if (body.col !== undefined || body.row !== undefined) {
      const col = body.col === undefined ? node.col : Number(body.col);
      const row = body.row === undefined ? node.row : Number(body.row);
      if (cellTaken(fresh.draft, col, row, stepId)) throw new ApiError(409, messages.cellTaken);
      if (!cellInsideGrid(col, row)) throw badRequest(messages.cellOutside);
      node.col = col;
      node.row = row;
    }
    if (!movesOnly) {
      const hold = await one<HoldRow>(
        `select h.user_id, h.held_at, u.name from edit_holds h join users u on u.id = h.user_id
           where h.automation_id = $1 and h.step_id = $2`,
        [fresh.id, stepId],
      );
      const now = await workspaceNow(ctx.workspace.id);
      if (
        hold !== null &&
        hold.user_id !== ctx.user.id &&
        hold.held_at.getTime() + config.editHoldSeconds * 1000 > now.getTime()
      ) {
        throw new ApiError(409, `${hold.name} is editing ${node.name}. Your change was not saved.`, {
          step: node,
        });
      }
      await query(
        `insert into edit_holds (automation_id, step_id, user_id, held_at) values ($1, $2, $3, $4)
           on conflict (automation_id, step_id) do update set user_id = $3, held_at = $4`,
        [fresh.id, stepId, ctx.user.id, now],
      );
      if (typeof body.name === 'string') node.name = body.name;
      if (isObject(body.fields)) node.fields = { ...node.fields, ...body.fields };
      if (isObject(body.sample) && node.id === 'trigger') fresh.draft.trigger.sample = body.sample;
    }
    const revision = await saveDraft(fresh);
    pushDraft(ctx, fresh, stepId);
    return { status: 200, json: { step: node, revision } };
  });
}

function renumberEdges(content: AutomationContent): void {
  const byPort = new Map<string, typeof content.edges>();
  for (const edge of [...content.edges].sort((a, b) => a.order - b.order)) {
    const key = `${edge.from}:${edge.port}`;
    const list = byPort.get(key) ?? [];
    list.push(edge);
    byPort.set(key, list);
  }
  for (const list of byPort.values()) {
    list.forEach((edge, index) => {
      edge.order = index + 1;
    });
  }
}

async function deleteStep(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    const stepId = ctx.params.sid;
    if (stepId === 'trigger') throw badRequest(messages.triggerUndeletable);
    const node = findNode(fresh.draft, stepId);
    if (node === undefined) throw notFound();
    fresh.draft.steps = fresh.draft.steps.filter((step) => step.id !== stepId);
    fresh.draft.edges = fresh.draft.edges.filter((edge) => edge.from !== stepId && edge.to !== stepId);
    renumberEdges(fresh.draft);
    await query('delete from edit_holds where automation_id = $1 and step_id = $2', [fresh.id, stepId]);
    await saveDraft(fresh);
    pushDraft(ctx, fresh, stepId);
    return { status: 204 };
  });
}

async function addEdge(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    const from = typeof ctx.body.from === 'string' ? ctx.body.from : '';
    const port = typeof ctx.body.port === 'string' ? ctx.body.port : '';
    const to = typeof ctx.body.to === 'string' ? ctx.body.to : '';
    checkEdge(fresh.draft, from, port, to);
    fresh.edge_seq += 1;
    const highest = edgesOf(fresh.draft, from, port).reduce((top, edge) => Math.max(top, edge.order), 0);
    const edge = { id: `e${fresh.edge_seq}`, from, port, to, order: highest + 1 };
    fresh.draft.edges.push(edge);
    await saveDraft(fresh);
    pushDraft(ctx, fresh, null);
    return { status: 201, json: edge };
  });
}

async function deleteEdge(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    fresh.draft.edges = fresh.draft.edges.filter((edge) => edge.id !== ctx.params.eid);
    renumberEdges(fresh.draft);
    await saveDraft(fresh);
    pushDraft(ctx, fresh, null);
    return { status: 204 };
  });
}

async function publish(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  return withLock(`draft:${automation.id}`, async () => {
    const fresh = await requireAutomation(ctx);
    if (fresh.live_version !== null) {
      const live = await one<{ revision: number }>(
        'select revision from versions where automation_id = $1 and version = $2',
        [fresh.id, fresh.live_version],
      );
      if (live !== null && live.revision === fresh.revision) {
        throw new ApiError(409, messages.noDraftChanges(fresh.live_version));
      }
    }
    const version = (fresh.live_version ?? 0) + 1;
    const publishedAt = await workspaceNow(ctx.workspace.id);
    await publishContent(ctx.workspace.id, fresh.id, fresh.draft, version, publishedAt);
    send({ type: 'version', workspace_id: ctx.workspace.id, automation_id: fresh.id, version });
    await pushDrainIfChanged(ctx.workspace.id, fresh.id);
    return { status: 201, json: { version, published_at: publishedAt.toISOString() } };
  });
}

async function listVersions(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  const rows = await query<{ version: number; published_at: Date }>(
    'select version, published_at from versions where automation_id = $1 order by version',
    [automation.id],
  );
  const versions = [];
  for (const row of rows) {
    const left = await one<{ count: string }>(
      `select count(*)::int as count from runs where automation_id = $1 and version = $2 and test = false
         and status in ('queued','running','waiting')`,
      [automation.id, row.version],
    );
    const runsLeft = left === null ? 0 : Number(left.count);
    versions.push({
      version: row.version,
      status: row.version === automation.live_version ? 'live' : runsLeft > 0 ? 'draining' : 'retired',
      published_at: row.published_at.toISOString(),
      runs_left: runsLeft,
    });
  }
  return { status: 200, json: { versions } };
}

async function versionContent(ctx: Ctx, automation: AutomationRow): Promise<{ version: number; content: AutomationContent }> {
  const version = Number(ctx.params.n);
  const row = await one<{ version: number; content: AutomationContent }>(
    'select version, content from versions where automation_id = $1 and version = $2',
    [automation.id, version],
  );
  if (row === null) throw notFound();
  return row;
}

async function readVersion(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  const row = await versionContent(ctx, automation);
  return {
    status: 200,
    json: {
      id: automation.id,
      name: automation.name,
      trigger_kind: automation.trigger_kind,
      revision: automation.revision,
      live_version: automation.live_version,
      drain_count: await drainCount(automation.id),
      next_run_at: await nextRunAt(automation.id),
      version: row.version,
      trigger: row.content.trigger,
      steps: row.content.steps,
      edges: row.content.edges,
    },
  };
}

async function exportVersion(ctx: Ctx): Promise<Reply> {
  const automation = await requireAutomation(ctx);
  const row = await versionContent(ctx, automation);
  const bytes = Buffer.from(exportFile(automation.name, row.content), 'utf8');
  const key = `exports/${ctx.workspace.id}/${automation.id}/v${row.version}.json`;
  try {
    await putObject(key, bytes);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, messages.storageUnavailable);
    throw error;
  }
  return {
    status: 200,
    body: bytes,
    contentType: 'application/json',
    headers: {
      'content-disposition': `attachment; filename="${automation.id}-v${row.version}.json"`,
      'x-switchyard-key': key,
    },
  };
}

async function importAutomation(ctx: Ctx): Promise<Reply> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.raw.toString('utf8')) as unknown;
  } catch {
    throw badRequest(messages.importBadJson);
  }
  if (!isObject(parsed)) throw badRequest(messages.importNotSwitchyard);
  const file: JsonObject = parsed;
  if (file.format !== 'switchyard-automation' || file.format_version !== 1) {
    throw badRequest(messages.importNotSwitchyard);
  }
  const content = contentForImport(file);
  const importId = newId('im');
  const key = `imports/${ctx.workspace.id}/${importId}.json`;
  try {
    await putObject(key, ctx.raw);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, messages.storageUnavailable);
    throw error;
  }
  await query('insert into imports (id, workspace_id, object_key) values ($1, $2, $3)', [
    importId,
    ctx.workspace.id,
    key,
  ]);
  const automationId = newId('au');
  const name = typeof file.name === 'string' ? file.name : 'Imported automation';
  const counts: Record<string, number> = {};
  let highest = 0;
  for (const step of content.steps) {
    counts[step.kind] = (counts[step.kind] ?? 0) + 1;
    highest = Math.max(highest, stepNumber(step.id));
  }
  await query(
    `insert into automations (id, workspace_id, name, trigger_kind, draft, revision, step_seq, edge_seq, kind_counts)
       values ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
    [
      automationId,
      ctx.workspace.id,
      name,
      content.trigger.kind,
      JSON.stringify(content),
      highest,
      content.edges.length,
      JSON.stringify(counts),
    ],
  );
  return { status: 201, json: { automation_id: automationId, import_id: importId, key } };
}

export const automationRoutes: Route[] = [
  { method: 'GET', path: '/api/workspaces/:ws/automations', auth: 'session', workspace: 'ws', handler: listAutomations },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: createAutomation,
  },
  {
    method: 'GET',
    path: '/api/workspaces/:ws/automations/:aid',
    auth: 'session',
    workspace: 'ws',
    handler: readAutomation,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations/:aid/draft/steps',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: addStep,
  },
  {
    method: 'PUT',
    path: '/api/workspaces/:ws/automations/:aid/draft/steps/:sid',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: updateStep,
  },
  {
    method: 'DELETE',
    path: '/api/workspaces/:ws/automations/:aid/draft/steps/:sid',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    handler: deleteStep,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations/:aid/draft/edges',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: addEdge,
  },
  {
    method: 'DELETE',
    path: '/api/workspaces/:ws/automations/:aid/draft/edges/:eid',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    handler: deleteEdge,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations/:aid/publish',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: publish,
  },
  {
    method: 'GET',
    path: '/api/workspaces/:ws/automations/:aid/versions',
    auth: 'session',
    workspace: 'ws',
    handler: listVersions,
  },
  {
    method: 'GET',
    path: '/api/workspaces/:ws/automations/:aid/versions/:n',
    auth: 'session',
    workspace: 'ws',
    handler: readVersion,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/automations/:aid/versions/:n/export',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'json',
    handler: exportVersion,
  },
  {
    method: 'POST',
    path: '/api/workspaces/:ws/imports',
    auth: 'session',
    workspace: 'ws',
    minimumRole: 'editor',
    body: 'raw',
    bodyLimit: IMPORT_BODY_LIMIT_BYTES,
    handler: importAutomation,
  },
];
