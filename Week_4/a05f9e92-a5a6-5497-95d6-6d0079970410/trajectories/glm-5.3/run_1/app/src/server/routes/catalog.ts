// Catalog, cart, checkout and request endpoints.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock } from '../db.js';
import { createHash } from 'node:crypto';
import { createRecord, saveRecord } from '../recordservice.js';
import { loadSnapshot, allocateNamedNumber, allocateNumber } from '../recordengine.js';
import { syncSlas } from '../slarunner.js';
import { startRun } from '../runengine.js';

export async function catalog(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  if (path === '/api/catalog/items' && method === 'GET') return catalogItems(route);
  if (path === '/api/catalog/items' && method === 'POST') return catalogItemCreate(route, user);
  const itemMatch = /^\/api\/catalog\/items\/([^/]+)$/.exec(path);
  if (itemMatch && method === 'GET') return catalogItemRead(route, itemMatch[1]);
  if (itemMatch && method === 'PUT') return catalogItemUpdate(route, user, itemMatch[1]);

  const guideMatch = /^\/api\/catalog\/guides\/([^/]+)$/.exec(path);
  if (guideMatch && method === 'GET') return guideRead(route, guideMatch[1]);
  const resolveMatch = /^\/api\/catalog\/guides\/([^/]+)\/resolve$/.exec(path);
  if (resolveMatch && method === 'POST') return guideResolve(route, resolveMatch[1]);

  if (path === '/api/cart' && method === 'GET') return cartRead(route, user);
  if (path === '/api/cart/lines' && method === 'POST') return cartAddLine(route, user);
  const lineMatch = /^\/api\/cart\/lines\/(\d+)$/.exec(path);
  if (lineMatch && method === 'DELETE') return cartRemoveLine(route, user, Number(lineMatch[1]));
  if (path === '/api/cart/checkout' && method === 'POST') return cartCheckout(route, user);

  const requestMatch = /^\/api\/requests\/(ASK-\d+)$/.exec(path);
  if (requestMatch && method === 'GET') return requestRead(route, user, requestMatch[1]);

  if (path === '/api/form-policies' && method === 'GET') return formPolicies(route);
  if (path === '/api/approvals' && method === 'GET') return approvalsList(route, user);
  const approvalDecision = /^\/api\/approvals\/([^/]+)\/decision$/.exec(path);
  if (approvalDecision && method === 'POST') return approvalDecisionPost(route, user, approvalDecision[1]);

  return false;
}

async function catalogItems(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT id, name, variables, workflow FROM catalog_items ORDER BY name`);
  sendJson(route.res, 200, { items: res.rows });
  return true;
}

async function catalogItemCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await validateVariables(body.variables);
  await route.ctx.db.query(
    `INSERT INTO catalog_items(id, name, variables, workflow) VALUES ($1,$2,$3,$4)`,
    [body.id, body.name, JSON.stringify(body.variables), body.workflow],
  );
  sendJson(route.res, 201, { item: body });
  return true;
}

async function catalogItemUpdate(route: RouteContext, user: SessionUser, id: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  await validateVariables(body.variables);
  await route.ctx.db.query(
    `UPDATE catalog_items SET name = $2, variables = $3, workflow = $4 WHERE id = $1`,
    [id, body.name, JSON.stringify(body.variables), body.workflow],
  );
  sendJson(route.res, 200, { item: { id, ...body } });
  return true;
}

async function validateVariables(variables: unknown): Promise<void> {
  if (!Array.isArray(variables)) throw new ApiError(422, 'validation', 'Variables must be a list.');
}

async function catalogItemRead(route: RouteContext, id: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT id, name, variables, workflow FROM catalog_items WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  sendJson(route.res, 200, { item: res.rows[0] });
  return true;
}

async function guideRead(route: RouteContext, id: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT id, name, questions, rules FROM guides WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  sendJson(route.res, 200, { guide: res.rows[0] });
  return true;
}

async function guideResolve(route: RouteContext, id: string): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT rules FROM guides WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const answers = route.body.answers as Record<string, unknown>;
  const rules = res.rows[0].rules as Array<{ item: string; condition: string }>;

  const { parse, evaluate, truthy } = await import('../../express/expression.js');
  const scope: Record<string, unknown> = { answers };
  const matched: string[] = [];
  for (const rule of rules) {
    try {
      const tree = parse(rule.condition);
      const value = evaluate(tree, {
        rec: scope,
        now: clock.nowMs(),
        me: '',
        roles: new Set(),
        resolve: (p: string) => {
          const parts = p.split('.');
          let cur: unknown = scope;
          for (const part of parts) {
            if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
              cur = (cur as Record<string, unknown>)[part];
            } else {
              return null;
            }
          }
          return cur;
        },
      });
      if (truthy(value)) matched.push(rule.item);
    } catch {
      // A rule that fails to evaluate does not match.
    }
  }
  sendJson(route.res, 200, { items: matched });
  return true;
}

async function cartRead(route: RouteContext, user: SessionUser): Promise<boolean> {
  const res = await route.ctx.db.query(
    `SELECT id, item, quantity, variables FROM cart_lines WHERE username = $1 ORDER BY id`,
    [user.username],
  );
  sendJson(route.res, 200, {
    lines: res.rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id), item: r.item, quantity: Number(r.quantity), variables: r.variables,
    })),
  });
  return true;
}

async function cartAddLine(route: RouteContext, user: SessionUser): Promise<boolean> {
  const body = route.body;
  const quantity = Number(body.quantity ?? 1);
  if (quantity < 1 || quantity > 10) {
    throw new ApiError(422, 'validation', 'Quantity must be between 1 and 10.', { quantity: 'Quantity must be between 1 and 10.' });
  }
  const item = await route.ctx.db.query(`SELECT variables FROM catalog_items WHERE id = $1`, [body.item]);
  if (!item.rows.length) throw notFound();

  // Validate submitted variables against the item's offered choices.
  const specs = item.rows[0].variables as Array<{ name: string; label: string; required: boolean; choices?: Array<{ value: string; label: string; when: { variable: string; equals: string } | null }> }>;
  const submitted = (body.variables ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const spec of specs) {
    const value = submitted[spec.name];
    if (spec.required && (value === undefined || value === null || value === '')) {
      fields[spec.name] = `${spec.label} is required.`;
      continue;
    }
    if (spec.choices && spec.choices.length && value !== undefined && value !== null) {
      const offered = offeredChoices(spec, submitted);
      if (!offered.some(c => c.value === value)) {
        fields[spec.name] = `${spec.label} must be one of ${offered.map(c => c.label).join(', ')}.`;
      }
    }
  }
  if (Object.keys(fields).length) {
    throw new ApiError(422, 'validation', `${Object.keys(fields).length} problems to fix before saving.`, fields);
  }

  const res = await route.ctx.db.query(
    `INSERT INTO cart_lines(username, item, quantity, variables) VALUES ($1,$2,$3,$4) RETURNING id`,
    [user.username, body.item, quantity, JSON.stringify(submitted)],
  );
  sendJson(route.res, 201, { line: { id: Number(res.rows[0].id), item: body.item, quantity, variables: submitted } });
  return true;
}

function offeredChoices(spec: { choices?: Array<{ value: string; label: string; when: { variable: string; equals: string } | null }> }, values: Record<string, unknown>): Array<{ value: string; label: string }> {
  return (spec.choices ?? []).filter(c => !c.when || values[c.when.variable] === c.when.equals).map(c => ({ value: c.value, label: c.label }));
}

async function cartRemoveLine(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  await route.ctx.db.query(`DELETE FROM cart_lines WHERE id = $1 AND username = $2`, [id, user.username]);
  route.res.writeHead(204);
  route.res.end();
  return true;
}

/** Checkout: one request, one item per line, tasks from each item's workflow.
 *  Idempotent replays return the stored response. */
async function cartCheckout(route: RouteContext, user: SessionUser): Promise<boolean> {
  const key = String(route.req.headers['idempotency-key'] ?? '');
  const bodyJson = JSON.stringify({ requested_for: route.body.requested_for ?? null });
  const bodyHash = createHash('sha256').update(bodyJson).digest('hex');

  if (key) {
    if (key.length < 1 || key.length > 64) {
      throw new ApiError(422, 'validation', 'Idempotency-Key must be between 1 and 64 characters.');
    }
    const existing = await route.ctx.db.query(
      `SELECT body_hash, response, created_at FROM idempotency WHERE key = $1 AND username = $2`,
      [key, user.username],
    );
    if (existing.rows.length) {
      if (existing.rows[0].body_hash !== bodyHash) {
        throw new ApiError(409, 'idempotency_conflict', 'This key was already used for a different request.');
      }
      sendJson(route.res, 201, existing.rows[0].response);
      return true;
    }
  }

  const lines = await route.ctx.db.query(
    `SELECT id, item, quantity, variables FROM cart_lines WHERE username = $1 ORDER BY id`,
    [user.username],
  );
  if (!lines.rows.length) throw new ApiError(422, 'empty_cart', 'Your cart is empty.');

  const requestNumber = await allocateNamedNumber(route.ctx.db, 'request');
  const items: Array<{ number: string; item: string; state: string }> = [];

  for (const line of lines.rows) {
    const itemRes = await route.ctx.db.query(`SELECT name, workflow FROM catalog_items WHERE id = $1`, [line.item]);
    if (!itemRes.rows.length) continue;
    const itemName = String(itemRes.rows[0].name);

    const itemNumber = await allocateNumber(route.ctx.db, 'request_item');
    const fields = {
      request: requestNumber,
      item: line.item,
      short_description: itemName,
      quantity: Number(line.quantity),
      variables: line.variables,
      requested_for: route.body.requested_for ?? user.username,
      impact: 3,
      urgency: 2,
      priority: 4,
      assignment_group: null,
      assigned_to: null,
      cancel_reason: null,
      created_at: new Date(clock.nowMs()).toISOString(),
    };
    await route.ctx.db.query(
      `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
       VALUES ($1,'request_item','submitted','live',$2,$3,$4,$3)`,
      [itemNumber, JSON.stringify(fields), new Date(clock.nowMs()), user.username],
    );
    await route.ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'submitted',$2)`, [itemNumber, new Date(clock.nowMs())]);
    await route.ctx.db.query(
      `INSERT INTO request_items_meta(number, request, item, quantity, variables) VALUES ($1,$2,$3,$4,$5)`,
      [itemNumber, requestNumber, line.item, Number(line.quantity), JSON.stringify(line.variables)],
    );
    items.push({ number: itemNumber, item: itemName, state: 'submitted' });

    // Start the item's workflow on its current published version.
    const wf = await route.ctx.db.query(`SELECT id FROM workflows WHERE name = $1`, [itemRes.rows[0].workflow]);
    if (wf.rows.length) {
      await startRun(route.ctx, Number(wf.rows[0].id), null, itemNumber, false);
    }
    await syncSlas(route.ctx.db, {
      number: itemNumber, table: 'request_item', state: 'submitted', workspace: 'live',
      fields, priority_overridden: false, created_at: clock.nowMs(), created_by: user.username,
    }, route.ctx.live);
  }

  await route.ctx.db.query(
    `INSERT INTO records(number, "table", state, workspace, fields, created_at, created_by, updated_at)
     VALUES ($1,'request_item','submitted','live',$2,$3,$4,$3)`,
    [requestNumber, JSON.stringify({}), new Date(clock.nowMs()), user.username],
  ).catch(() => undefined);
  await route.ctx.db.query(
    `INSERT INTO requests_meta(number, state, requested_by, requested_for) VALUES ($1,'open',$2,$3)`,
    [requestNumber, user.username, route.body.requested_for ?? null],
  );
  await route.ctx.db.query(`DELETE FROM cart_lines WHERE username = $1`, [user.username]);

  const response = { request: { number: requestNumber, items } };
  if (key) {
    await route.ctx.db.query(
      `INSERT INTO idempotency(key, username, body_hash, response, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [key, user.username, bodyHash, JSON.stringify(response), new Date(clock.nowMs())],
    );
  }
  sendJson(route.res, 201, response);
  return true;
}

async function requestRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const meta = await route.ctx.db.query(`SELECT * FROM requests_meta WHERE number = $1`, [number]);
  if (!meta.rows.length) throw notFound();
  const row = meta.rows[0];
  // Requester, requested-for person or desk roles.
  const allowed = user.roles.includes('operator') || user.roles.includes('technician') ||
    row.requested_by === user.username || row.requested_for === user.username;
  if (!allowed) throw notFound();

  const items = await route.ctx.db.query(
    `SELECT number, "table", state, fields FROM records WHERE "table" = 'request_item' AND fields->>'request' = $1 ORDER BY number`,
    [number],
  );
  const itemViews = [];
  for (const item of items.rows) {
    const tasks = await route.ctx.db.query(
      `SELECT number, state FROM records WHERE "table" = 'task' AND fields->>'parent' = $1 ORDER BY number`,
      [item.number],
    );
    const { slaViews } = await import('../slarunner.js');
    const slas = await slaViews(route.ctx.db, String(item.number));
    itemViews.push({
      number: item.number,
      item: (item.fields as Record<string, unknown>).item,
      state: item.state,
      state_label: stateLabelOf(String(item.state)),
      tasks: tasks.rows.map((t: Record<string, unknown>) => ({
        number: t.number, state: t.state, state_label: stateLabelOf(String(t.state)),
      })),
      slas,
    });
  }
  sendJson(route.res, 200, {
    request: {
      number,
      state: row.state,
      items: itemViews,
    },
  });
  return true;
}

function stateLabelOf(state: string): string {
  const labels: Record<string, string> = {
    submitted: 'Submitted', awaiting_approval: 'Awaiting approval', approved: 'Approved',
    rejected: 'Rejected', fulfilling: 'Fulfilling', delivered: 'Delivered', closed: 'Closed',
    cancelled: 'Cancelled', open: 'Open', in_progress: 'In progress', done: 'Done',
  };
  return labels[state] ?? state;
}

async function formPolicies(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, "table", catalog_item, "order", condition, actions FROM form_policies ORDER BY "order", name`);
  sendJson(route.res, 200, {
    form_policies: res.rows.map((r: Record<string, unknown>) => ({
      name: r.name, table: r.table, catalog_item: r.catalog_item, order: r.order, condition: r.condition, actions: r.actions,
    })),
  });
  return true;
}

async function approvalsList(route: RouteContext, user: SessionUser): Promise<boolean> {
  const out: unknown[] = [];

  // Change steps waiting on this approver.
  const steps = await route.ctx.db.query(
    `SELECT s.id, s.change, s.name, s.opens_at, s.closes_at, s.voters FROM approval_steps s
     WHERE s.status = 'open' ORDER BY s.closes_at ASC, s.change ASC`,
  );
  for (const step of steps.rows) {
    const voters = step.voters as Array<{ username: string }>;
    if (!voters.some(v => v.username === user.username)) continue;
    const change = await route.ctx.db.query(`SELECT number, fields FROM records WHERE number = $1`, [step.change]);
    if (!change.rows.length) continue;
    out.push({
      kind: 'change_step',
      id: String(step.id),
      record: step.change,
      title: (change.rows[0].fields as Record<string, unknown>).title,
      closes_at: step.closes_at ? new Date(step.closes_at as Date).toISOString() : null,
      step: step.name,
    });
  }

  // Catalog approvals: request items in awaiting_approval.
  const items = await route.ctx.db.query(
    `SELECT number, fields FROM records WHERE "table" = 'request_item' AND state = 'awaiting_approval' ORDER BY number`,
  );
  for (const item of items.rows) {
    const fields = item.fields as Record<string, unknown>;
    // The catalog approvers of the requested-for person's department.
    const requestedFor = (fields.requested_for as string) ?? user.username;
    const deptRes = await route.ctx.db.query(`SELECT department FROM people WHERE username = $1`, [requestedFor]);
    const department = deptRes.rows.length ? String(deptRes.rows[0].department) : '';
    const isApprover = user.roles.includes('approver') && user.department === department;
    if (!isApprover) continue;
    out.push({
      kind: 'request_item',
      id: item.number,
      record: item.number,
      title: fields.short_description,
      closes_at: null,
      step: null,
    });
  }

  // Order: closes_at ascending (catalog approvals last), then record number.
  out.sort((a, b) => {
    const av = (a as { closes_at: string | null }).closes_at;
    const bv = (b as { closes_at: string | null }).closes_at;
    if (av === null && bv === null) return (a as { record: string }).record < (b as { record: string }).record ? -1 : 1;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  sendJson(route.res, 200, { approvals: out });
  return true;
}

async function approvalDecisionPost(route: RouteContext, user: SessionUser, id: string): Promise<boolean> {
  const decision = route.body.decision === 'reject' ? 'reject' : 'approve';
  const comment = String(route.body.comment ?? '');

  // A catalog approval moves the item to approved or rejected.
  if (id.startsWith('ITM-')) {
    const snap = await loadSnapshot(route.ctx.db, id);
    if (!snap || snap.state !== 'awaiting_approval') {
      throw new ApiError(409, 'already_decided', 'This approval is already decided.');
    }
    const next = decision === 'approve' ? 'fulfilling' : 'rejected';
    await route.ctx.db.query(`UPDATE records SET state = $2, updated_at = $3 WHERE number = $1`, [id, next, new Date(clock.nowMs())]);
    await route.ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [id, next, new Date(clock.nowMs())]);
    sendJson(route.res, 200, { approval: { id, decision } });
    return true;
  }

  // A change step vote.
  const step = await route.ctx.db.query(`SELECT * FROM approval_steps WHERE id = $1`, [Number(id)]);
  if (!step.rows.length) throw notFound();
  const voters = step.rows[0].voters as Array<{ username: string }>;
  if (!voters.some(v => v.username === user.username)) {
    throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
  }
  if (step.rows[0].status !== 'open') {
    throw new ApiError(409, 'already_decided', 'This approval is already decided.');
  }
  const { castVote } = await import('./changes.js');
  await castVote(route, user, Number(id), { decision, comment, on_behalf_of: null });
  sendJson(route.res, 200, { approval: { id, decision } });
  return true;
}
