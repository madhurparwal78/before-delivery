/**
 * Catalog items, order guides, the cart, checkout, requests and form policies.
 */

import { createHash, randomUUID } from 'node:crypto';

import { iso, now } from '../clock';
import { nextNumber, query, transaction } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import { condition as evaluateCondition, validateExpression } from '../expr/interpret';
import { stateLabel } from '../domain/transitions';
import {
  idempotencyKeyOf,
  replayOf,
  requireCaller,
  requireOperator,
  storeReplay,
  type RequestContext,
} from '../http/context';
import { Engine, type Caller } from '../services/engine';
import { enforcePolicies, resolvePolicies } from '../services/formpolicy';
import { publish } from '../services/live';
import { numberPrefixes, recordJson } from '../services/recordops';
import { RecordScope } from '../services/scope';
import { loadCatalogItems, loadFormPolicies, loadGuides, type CatalogVariable } from '../services/store';
import { advanceRun, advanceRunsWaitingOn, startRun } from '../services/workflow';
import { attachSlas, reviewSlas, slaJson } from '../services/slaservice';
import { created, noContent, ok, route } from './router';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

function variableJson(variable: CatalogVariable): Record<string, unknown> {
  return {
    name: variable.name,
    label: variable.label,
    type: variable.type,
    required: variable.required,
    default: variable.default ?? null,
    choices: variable.choices ?? [],
  };
}

route('GET', '/api/catalog/items', async (context) => {
  const { engine } = await engineFor(context);
  return ok({
    items: [...engine.catalogItems.values()].map((item) => ({
      id: item.id,
      name: item.name,
      workflow: item.workflow,
    })),
  });
});

route('GET', '/api/catalog/items/:id', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const item = engine.catalogItems.get(params.id);
  if (!item) throw notFound();
  const defaults: Record<string, unknown> = {};
  for (const variable of item.variables) {
    defaults[variable.name] =
      variable.name === 'cost_centre' && variable.default === null
        ? (caller.department ?? null)
        : (variable.default ?? null);
  }
  return ok({
    item: {
      id: item.id,
      name: item.name,
      workflow: item.workflow,
      variables: item.variables.map(variableJson),
      defaults,
    },
  });
});

route('POST', '/api/catalog/items', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const id = String(context.body.id ?? '').trim();
  if (id === '') throw validation('Id is required.', { id: 'Id is required.' });
  await upsertItem(engine.workspace, id, context.body);
  return created({ item: { id, ...context.body } });
});

route('PUT', '/api/catalog/items/:id', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await upsertItem(engine.workspace, params.id, context.body);
  return ok({ item: { id: params.id, ...context.body } });
});

async function upsertItem(workspace: string, id: string, body: Record<string, unknown>): Promise<void> {
  await query(
    `INSERT INTO catalog_item (id, name, variables, workflow, workspace)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (workspace, id) DO UPDATE SET name = $2, variables = $3::jsonb, workflow = $4`,
    [id, String(body.name ?? id), JSON.stringify(body.variables ?? []), body.workflow ?? null, workspace],
  );
}

/** A select's offered choices are those whose `when` matches the current answers. */
export function offeredChoices(
  variable: CatalogVariable,
  values: Readonly<Record<string, unknown>>,
): { value: string; label: string }[] {
  return (variable.choices ?? [])
    .filter((choice) => {
      if (!choice.when) return true;
      return String(values[choice.when.variable] ?? '') === String(choice.when.equals);
    })
    .map((choice) => ({ value: choice.value, label: choice.label }));
}

/** Validates submitted variables against their offered choices and policies. */
export function validateVariables(
  engine: Engine,
  caller: Caller,
  itemId: string,
  values: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const item = engine.catalogItems.get(itemId);
  if (!item) return { item: 'That catalog item does not exist.' };
  const errors: Record<string, string> = {};
  const scope = new RecordScope({
    table: 'request_item',
    fields: {},
    state: 'submitted',
    number: null,
    variables: values,
    viewer: caller,
    data: engine.scopeData,
  });
  const outcome = resolvePolicies(
    engine.formPolicies,
    { catalogItem: itemId },
    scope,
    item.variables.map((v) => v.name),
  );

  for (const variable of item.variables) {
    const state = outcome[variable.name] ?? { mandatory: false, visible: true, read_only: false };
    if (!state.visible) continue;
    const value = values[variable.name];
    const empty = value === null || value === undefined || String(value).trim() === '';
    if ((variable.required || state.mandatory) && empty) {
      errors[variable.name] = `${variable.label} is required.`;
      continue;
    }
    if (empty) continue;
    if (variable.type === 'select') {
      const offered = offeredChoices(variable, values);
      if (!offered.some((choice) => choice.value === String(value))) {
        errors[variable.name] =
          `${variable.label} must be one of ${offered.map((c) => c.label).join(', ')}.`;
      }
    }
    if (variable.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      errors[variable.name] = `${variable.label} looks like YYYY-MM-DD.`;
    }
    if (variable.type === 'number' && !Number.isFinite(Number(value))) {
      errors[variable.name] = `${variable.label} must be a number.`;
    }
  }
  return errors;
}

route('GET', '/api/catalog/guides/:id', async (context, params) => {
  const { engine } = await engineFor(context);
  const guide = engine.guides.get(params.id);
  if (!guide) throw notFound();
  return ok({
    guide: {
      id: guide.id,
      name: guide.name,
      questions: guide.questions.map(variableJson),
      rules: guide.rules,
    },
  });
});

route('POST', '/api/catalog/guides/:id/resolve', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const guide = engine.guides.get(params.id);
  if (!guide) throw notFound();
  const answers = (context.body.answers ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const question of guide.questions) {
    const value = answers[question.name];
    if (question.required && (value === null || value === undefined || String(value).trim() === '')) {
      errors[question.name] = `${question.label} is required.`;
    }
  }
  if (Object.keys(errors).length > 0) {
    throw validation(
      `${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? 'problem' : 'problems'} to fix before saving.`,
      errors,
    );
  }
  const scope = new RecordScope({
    table: 'request_item',
    fields: {},
    state: 'submitted',
    number: null,
    answers,
    viewer: caller,
    data: engine.scopeData,
  });
  const items = guide.rules
    .filter((rule) => {
      try {
        return evaluateCondition(rule.condition, scope);
      } catch {
        return false;
      }
    })
    .map((rule) => rule.item);
  return ok({ items });
});

route('GET', '/api/cart', async (context) => {
  const { engine, caller } = await engineFor(context);
  const rows = await query<{ id: string; item: string; quantity: number; variables: Record<string, unknown> }>(
    `SELECT id, item, quantity, variables FROM cart_line WHERE username = $1 ORDER BY created_at, id`,
    [caller.username],
  );
  return ok({
    lines: rows.map((r) => ({
      id: r.id,
      item: r.item,
      item_name: engine.catalogItems.get(r.item)?.name ?? r.item,
      quantity: r.quantity,
      variables: r.variables ?? {},
    })),
  });
});

route('POST', '/api/cart/lines', async (context) => {
  const { engine, caller } = await engineFor(context);
  const itemId = String(context.body.item ?? '');
  const item = engine.catalogItems.get(itemId);
  if (!item) throw validation('That catalog item does not exist.', { item: 'That catalog item does not exist.' });
  const quantity = Number(context.body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    throw validation('Quantity must be 1 to 10.', { quantity: 'Quantity must be 1 to 10.' });
  }
  const variables = (context.body.variables ?? {}) as Record<string, unknown>;
  const errors = validateVariables(engine, caller, itemId, variables);
  if (Object.keys(errors).length > 0) {
    const count = Object.keys(errors).length;
    throw validation(`${count} ${count === 1 ? 'problem' : 'problems'} to fix before saving.`, errors);
  }
  const id = randomUUID();
  await query(
    `INSERT INTO cart_line (id, username, item, quantity, variables, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [id, caller.username, itemId, quantity, JSON.stringify(variables), now()],
  );
  return created({ line: { id, item: itemId, quantity, variables } });
});

route('DELETE', '/api/cart/lines/:id', async (context, params) => {
  const caller = requireCaller(context);
  await query(`DELETE FROM cart_line WHERE id = $1 AND username = $2`, [params.id, caller.username]);
  return noContent();
});

/**
 * Checkout creates one request, one request item per line and a run of each
 * item's workflow. A replay with the same key returns the stored response.
 */
route('POST', '/api/cart/checkout', async (context) => {
  const { engine, caller } = await engineFor(context);
  const key = idempotencyKeyOf(context.request);
  const bodyHash = createHash('sha256').update(context.bodyText).digest('hex');
  const replay = await replayOf(key, caller.username, '/api/cart/checkout', bodyHash);
  if (replay) return { status: replay.status, body: replay.response };

  const lines = await query<{ id: string; item: string; quantity: number; variables: Record<string, unknown> }>(
    `SELECT id, item, quantity, variables FROM cart_line WHERE username = $1 ORDER BY created_at, id`,
    [caller.username],
  );
  if (lines.length === 0) throw new ApiError(422, 'empty_cart', 'Your cart is empty.');

  const requestedFor =
    context.body.requested_for === null || context.body.requested_for === undefined
      ? caller.username
      : String(context.body.requested_for);

  for (const line of lines) {
    const errors = validateVariables(engine, caller, line.item, line.variables ?? {});
    if (Object.keys(errors).length > 0) {
      const count = Object.keys(errors).length;
      throw validation(`${count} ${count === 1 ? 'problem' : 'problems'} to fix before saving.`, errors);
    }
  }

  const outcome = await transaction(async (client) => {
    const requestNumber = await nextNumber(client, numberPrefixes.request);
    const at = now();
    await client.query(
      `INSERT INTO record (number, table_name, state, fields, versions, state_history,
                           created_at, updated_at, created_by, workspace)
       VALUES ($1, 'request', 'open', $2::jsonb, $3::jsonb, $4::jsonb, $5, $5, $6, $7)`,
      [
        requestNumber,
        JSON.stringify({ requester: caller.username, requested_for: requestedFor, state: 'open' }),
        JSON.stringify({ requester: 1, requested_for: 1, state: 1 }),
        JSON.stringify([{ state: 'open', at: iso(at) }]),
        at,
        caller.username,
        engine.workspace,
      ],
    );
    const items: { number: string; item: string; state: string }[] = [];
    for (const line of lines) {
      const itemNumber = await nextNumber(client, numberPrefixes.request_item);
      const catalogItem = engine.catalogItems.get(line.item);
      const fields = {
        request: requestNumber,
        item: line.item,
        short_description: catalogItem?.name ?? line.item,
        quantity: line.quantity,
        variables: line.variables ?? {},
        requested_for: requestedFor,
        impact: 3,
        urgency: 2,
        priority: 4,
        state: 'submitted',
        created_at: iso(at),
      };
      const versions: Record<string, number> = {};
      for (const name of Object.keys(fields)) versions[name] = 1;
      await client.query(
        `INSERT INTO record (number, table_name, state, fields, versions, state_history,
                             created_at, updated_at, created_by, workspace)
         VALUES ($1, 'request_item', 'submitted', $2::jsonb, $3::jsonb, $4::jsonb, $5, $5, $6, $7)`,
        [
          itemNumber,
          JSON.stringify(fields),
          JSON.stringify(versions),
          JSON.stringify([{ state: 'submitted', at: iso(at) }]),
          at,
          caller.username,
          engine.workspace,
        ],
      );
      items.push({ number: itemNumber, item: line.item, state: 'submitted' });
    }
    await client.query(`DELETE FROM cart_line WHERE username = $1`, [caller.username]);
    return { requestNumber, items };
  });

  const refreshed = await Engine.load(engine.workspace);
  for (const item of outcome.items) {
    const record = refreshed.records.get(item.number);
    if (!record) continue;
    await transaction(async (client) => {
      await attachSlas(client, refreshed, record);
      await reviewSlas(client, refreshed, record);
    });
    const workflow = refreshed.catalogItems.get(item.item)?.workflow;
    if (workflow) await startRun(refreshed, workflow, item.number);
  }

  const body = {
    request: { number: outcome.requestNumber, items: outcome.items },
  };
  await storeReplay(key, caller.username, '/api/cart/checkout', bodyHash, 201, body);
  publish({ topic: 'list:request_item', event: 'created', data: { numbers: outcome.items.map((i) => i.number) } });
  return created(body);
});

route('GET', '/api/requests/:number', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const request = engine.records.get(params.number);
  if (!request) throw notFound();
  const isMine =
    request.fields.requester === caller.username || request.fields.requested_for === caller.username;
  const deskRole = caller.roles.includes('operator') || caller.roles.includes('technician');
  if (!isMine && !deskRole) throw notFound();

  const items = [...engine.records.values()].filter(
    (r) => r.table === 'request_item' && r.fields.request === request.number,
  );
  const itemsJson = await Promise.all(
    items.map(async (item) => {
      const tasks = [...engine.records.values()].filter(
        (r) => r.table === 'task' && r.fields.parent === item.number,
      );
      return {
        number: item.number,
        item: item.fields.item ?? null,
        item_name: engine.catalogItems.get(String(item.fields.item ?? ''))?.name ?? '',
        state: item.state,
        state_label: stateLabel('request_item', item.state),
        tasks: tasks.map((task) => ({
          number: task.number,
          state: task.state,
          state_label: stateLabel('task', task.state),
        })),
        slas: (await engine.slasOf(item)).map(slaJson),
      };
    }),
  );
  return ok({
    request: {
      number: request.number,
      state: request.state,
      state_label: request.state === 'closed' ? 'Closed' : 'Open',
      items: itemsJson,
    },
  });
});

route('GET', '/api/form-policies', async (context) => {
  const { engine } = await engineFor(context);
  requireCaller(context);
  const policies = await loadFormPolicies(engine.workspace);
  return ok({
    form_policies: policies.map((p) => ({
      name: p.name,
      table: p.table,
      catalog_item: p.catalogItem,
      order: p.order,
      condition: p.condition,
      actions: p.actions,
    })),
  });
});

route('POST', '/api/form-policies', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  const condition = String(context.body.condition ?? 'true');
  validateExpression(condition);
  await query(
    `INSERT INTO form_policy (name, table_name, catalog_item, run_order, condition_expr, actions, workspace)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (workspace, name) DO UPDATE SET table_name = $2, catalog_item = $3, run_order = $4,
       condition_expr = $5, actions = $6::jsonb`,
    [
      name,
      context.body.table ?? null,
      context.body.catalog_item ?? null,
      Number(context.body.order ?? 100),
      condition,
      JSON.stringify(context.body.actions ?? []),
      engine.workspace,
    ],
  );
  return created({ form_policy: { name, ...context.body } });
});

/** An approver's decision on a catalog approval. */
route('POST', '/api/approvals/:id/decision', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const row = (
    await query<{ id: string; number: string; approvers: string[]; decision: string | null; run_id: string | null }>(
      `SELECT id, number, approvers, decision, run_id FROM item_approval WHERE id = $1`,
      [params.id],
    )
  )[0];
  if (!row) throw notFound();
  if (!(row.approvers ?? []).includes(caller.username)) throw notFound();
  if (row.decision !== null) throw conflict('already_decided', 'This approval is already decided.');
  const decision = context.body.decision === 'reject' ? 'reject' : 'approve';
  await query(`UPDATE item_approval SET decision = $2, decided_by = $3 WHERE id = $1`, [
    params.id,
    decision,
    caller.username,
  ]);
  await advanceRunsWaitingOn(engine, row.number);
  publish({ topic: 'approvals', event: 'decided', data: { id: params.id, decision } });
  return ok({ approval: { id: params.id, decision, record: row.number } });
});

export { advanceRun, recordJson, enforcePolicies };
