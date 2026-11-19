/**
 * Service map, impact, major incidents and problems.
 */

import { iso, now, nowMs } from '../clock';
import { settings } from '../config';
import { query, transaction } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import {
  classAttributes,
  cycleError,
  cycleThrough,
  isClassName,
  isDependencyType,
  isRelationshipType,
  layoutMap,
  relayPanels,
  statusLabels,
  type CiStatus,
  type ConfigurationItem,
  type Impact,
} from '../domain/cmdb';
import { eventTexts } from '../domain/inbox';
import { isOpenState } from '../domain/transitions';
import { parseDisplayTime } from '../domain/zone';
import { requireCaller, requireOperator, requireRoles, type RequestContext } from '../http/context';
import { Engine, type Caller } from '../services/engine';
import { publish } from '../services/live';
import { deliver, operators, unreadCount } from '../services/notify';
import {
  createRecord,
  recordJson,
  recordSummary,
  transitionRecord,
  type FieldSave,
} from '../services/recordops';
import { insertActivity, type RecordRow } from '../services/store';
import { created, noContent, ok, route } from './router';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

function ciJson(engine: Engine, item: ConfigurationItem): Record<string, unknown> {
  const statuses = engine.map.effectiveStatuses();
  return {
    id: item.id,
    name: item.name,
    class: item.className,
    criticality: item.criticality,
    business_critical: item.businessCritical,
    owner_department: item.ownerDepartment,
    status: item.status,
    effective_status: statuses.get(item.name.toLowerCase()) ?? 'healthy',
    attributes: item.attributes,
    used_by: { departments: item.usedByDepartments, people: item.usedByPeople },
  };
}

function impactJson(engine: Engine, impact: Impact, proposal: unknown): Record<string, unknown> {
  return {
    ci: impact.ci.name,
    status: impact.status,
    base_people: impact.basePeople,
    affected: impact.affected.map((entry) => ({
      ci: {
        name: entry.item.name,
        class: entry.item.className,
        criticality: entry.item.criticality,
        business_critical: entry.item.businessCritical,
      },
      path: entry.path,
      tier: entry.tier,
      people_added: entry.peopleAdded,
      running_people: entry.runningPeople,
    })),
    degraded: impact.degraded.map((entry) => ({ ci: entry.item.name, path: entry.path })),
    people_total: impact.peopleTotal,
    business_critical_affected: impact.businessCriticalAffected,
    proposal,
  };
}

route('GET', '/api/cis', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  return ok({ cis: engine.map.items.map((item) => ciJson(engine, item)) });
});

route('GET', '/api/cis/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const item = engine.map.find(params.name);
  if (!item) throw notFound();
  return ok({ ci: ciJson(engine, item) });
});

route('POST', '/api/cis', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const name = String(context.body.name ?? '').trim();
  const className = String(context.body.class ?? '');
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  if (!isClassName(className)) throw validation('Class is not a class.', { class: 'Class is not a class.' });
  if (engine.map.find(name)) throw validation('That name is taken.', { name: 'That name is taken.' });
  const criticality = Number(context.body.criticality ?? 2);
  if (![1, 2, 3].includes(criticality)) {
    throw validation('Criticality must be 1 to 3.', { criticality: 'Criticality must be 1 to 3.' });
  }
  const own = classAttributes(className).filter(
    (a) => !['name', 'criticality', 'business_critical', 'owner_department', 'status'].includes(a),
  );
  const attributes: Record<string, unknown> = {};
  for (const key of own) {
    if (key in context.body) attributes[key] = context.body[key];
  }
  const usedBy = (context.body.used_by ?? {}) as { departments?: string[]; people?: string[] };
  await query(
    `INSERT INTO configuration_item (name, class_name, criticality, business_critical, owner_department,
                                     status, attributes, used_by_departments, used_by_people, workspace)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
    [
      name,
      className,
      criticality,
      context.body.business_critical === true,
      context.body.owner_department ?? null,
      String(context.body.status ?? 'healthy'),
      JSON.stringify(attributes),
      JSON.stringify(usedBy.departments ?? []),
      JSON.stringify(usedBy.people ?? []),
      engine.workspace,
    ],
  );
  const refreshed = await Engine.load(engine.workspace);
  const item = refreshed.map.find(name);
  return created({ ci: item ? ciJson(refreshed, item) : null });
});

route('PATCH', '/api/cis/:name', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const item = engine.map.find(params.name);
  if (!item) throw notFound();
  const body = context.body;
  const attributes = { ...item.attributes };
  for (const key of classAttributes(item.className)) {
    if (key in body) attributes[key] = body[key];
  }
  const usedBy = (body.used_by ?? {
    departments: item.usedByDepartments,
    people: item.usedByPeople,
  }) as { departments?: string[]; people?: string[] };
  await query(
    `UPDATE configuration_item SET criticality = $2, business_critical = $3, owner_department = $4,
            attributes = $5::jsonb, used_by_departments = $6::jsonb, used_by_people = $7::jsonb
     WHERE workspace = $8 AND lower(name) = lower($1)`,
    [
      item.name,
      'criticality' in body ? Number(body.criticality) : item.criticality,
      'business_critical' in body ? body.business_critical === true : item.businessCritical,
      'owner_department' in body ? (body.owner_department ?? null) : item.ownerDepartment,
      JSON.stringify(attributes),
      JSON.stringify(usedBy.departments ?? item.usedByDepartments),
      JSON.stringify(usedBy.people ?? item.usedByPeople),
      engine.workspace,
    ],
  );
  const refreshed = await Engine.load(engine.workspace);
  const updated = refreshed.map.find(item.name);
  return ok({ ci: updated ? ciJson(refreshed, updated) : null });
});

route('POST', '/api/relationships', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const source = String(context.body.source ?? '');
  const target = String(context.body.target ?? '');
  const type = String(context.body.type ?? '');
  if (!isRelationshipType(type)) throw validation('Type is not a relationship type.', { type: 'Type is not a relationship type.' });
  if (!engine.map.find(source)) throw validation('Source is not an item.', { source: 'Source is not an item.' });
  if (!engine.map.find(target)) throw validation('Target is not an item.', { target: 'Target is not an item.' });
  if (isDependencyType(type)) {
    const chain = cycleThrough(engine.map, source, target);
    if (chain) throw cycleError(chain);
  }
  await query(
    `INSERT INTO ci_relationship (source, rel_type, target, workspace) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [engine.map.find(source)?.name ?? source, type, engine.map.find(target)?.name ?? target, engine.workspace],
  );
  return created({ relationship: { source, type, target } });
});

route('DELETE', '/api/relationships', async (context) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  await query(
    `DELETE FROM ci_relationship WHERE workspace = $4 AND lower(source) = lower($1)
       AND rel_type = $2 AND lower(target) = lower($3)`,
    [
      String(context.body.source ?? ''),
      String(context.body.type ?? ''),
      String(context.body.target ?? ''),
      engine.workspace,
    ],
  );
  return noContent();
});

route('GET', '/api/service-map', async (context) => {
  const { engine } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const nodes = layoutMap(engine.map);
  return ok({
    nodes: nodes.map((node) => ({
      name: node.name,
      class: node.className,
      status: node.status,
      status_label: statusLabels[node.status],
      layer: node.layer,
      x: node.x,
      y: node.y,
    })),
    edges: engine.map.relationships.map((rel) => ({
      source: rel.source,
      type: rel.type,
      target: rel.target,
    })),
  });
});

/** An outage proposes a major incident once it reaches the published threshold. */
async function proposeIfNeeded(engine: Engine, impact: Impact): Promise<Record<string, unknown> | null> {
  const openIncidents = openIncidentsOn(engine, impact);
  const services = settings().MAJOR_PROPOSAL_SERVICES;
  const incidents = settings().MAJOR_PROPOSAL_INCIDENTS;
  const reason =
    impact.businessCriticalAffected >= services
      ? `${impact.businessCriticalAffected} business-critical services affected`
      : openIncidents.length >= incidents
        ? `${openIncidents.length} open incidents on affected items`
        : null;
  if (reason === null) return null;

  const existing = (
    await query<{ id: string }>(
      `SELECT id FROM major_proposal WHERE ci = $1 AND status = 'open' LIMIT 1`,
      [impact.ci.name],
    )
  )[0];
  if (existing) return null;

  const row = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO major_proposal (ci, reason, business_critical_affected, linked_open_incidents, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [impact.ci.name, reason, impact.businessCriticalAffected, openIncidents.length, now()],
    );
    const to = operators(engine.people);
    const delivered = await deliver(
      client,
      engine.inboxRules,
      engine.people,
      'major_incident_proposed',
      to,
      eventTexts.major_incident_proposed(impact.ci.name, reason),
      null,
    );
    for (const username of delivered) {
      publish({
        topic: 'inbox',
        event: 'unread',
        data: { username, unread: await unreadCount(client, username) },
      });
    }
    return inserted.rows[0];
  });
  publish({ topic: 'major:proposals', event: 'proposed', data: { ci: impact.ci.name, reason } });
  return {
    id: Number(row.id),
    ci: impact.ci.name,
    reason,
    business_critical_affected: impact.businessCriticalAffected,
    linked_open_incidents: openIncidents.length,
    status: 'open',
    incident: null,
  };
}

function openIncidentsOn(engine: Engine, impact: Impact): RecordRow[] {
  const names = new Set([impact.ci.name.toLowerCase(), ...impact.affected.map((a) => a.item.name.toLowerCase())]);
  return [...engine.records.values()].filter(
    (r) =>
      r.table === 'incident' &&
      isOpenState('incident', r.state) &&
      typeof r.fields.configuration_item === 'string' &&
      names.has(r.fields.configuration_item.toLowerCase()),
  );
}

route('POST', '/api/cis/:name/status', async (context, params) => {
  const { engine } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const item = engine.map.find(params.name);
  if (!item) throw notFound();
  const status = String(context.body.status ?? '');
  if (!['down', 'degraded', 'healthy'].includes(status)) {
    throw validation('Status must be down, degraded or healthy.', {
      status: 'Status must be down, degraded or healthy.',
    });
  }
  await query(
    `UPDATE configuration_item SET status = $2 WHERE workspace = $3 AND lower(name) = lower($1)`,
    [item.name, status as CiStatus, engine.workspace],
  );
  const refreshed = await Engine.load(engine.workspace);
  const impact = refreshed.impact(item.name);
  const proposal = impact && status !== 'healthy' ? await proposeIfNeeded(refreshed, impact) : null;
  publish({ topic: 'map', event: 'status', data: { ci: item.name, status } });
  const updated = refreshed.map.find(item.name);
  return ok({
    ci: updated ? ciJson(refreshed, updated) : null,
    impact: impact ? impactJson(refreshed, impact, proposal) : null,
  });
});

route('POST', '/api/cis/:name/maintenance', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const item = engine.map.find(params.name);
  if (!item) throw notFound();
  const start = parseTime(String(context.body.start ?? ''), caller.timeZone);
  const end = parseTime(String(context.body.end ?? ''), caller.timeZone);
  if (start === null || end === null || end <= start) {
    throw validation('A maintenance window needs a start before its end.', {
      start: 'A maintenance window needs a start before its end.',
    });
  }
  await query(
    `INSERT INTO maintenance_window (ci, start_at, end_at, workspace) VALUES ($1, $2, $3, $4)`,
    [item.name, new Date(start), new Date(end), engine.workspace],
  );
  return created({
    window: { ci: item.name, start: iso(new Date(start)), end: iso(new Date(end)) },
  });
});

function parseTime(text: string, zone: string): number | null {
  const direct = Date.parse(text);
  if (!Number.isNaN(direct)) return direct;
  return parseDisplayTime(zone, text);
}

route('GET', '/api/cis/:name/impact', async (context, params) => {
  const { engine } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const item = engine.map.find(params.name);
  if (!item) throw notFound();
  const impact = engine.impact(item.name);
  if (!impact) throw notFound();
  const proposalRow = (
    await query<{
      id: string;
      ci: string;
      reason: string;
      business_critical_affected: number;
      linked_open_incidents: number;
      status: string;
      incident: string | null;
    }>(`SELECT * FROM major_proposal WHERE ci = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`, [item.name])
  )[0];
  return ok(
    impactJson(
      engine,
      impact,
      proposalRow
        ? {
            id: Number(proposalRow.id),
            ci: proposalRow.ci,
            reason: proposalRow.reason,
            business_critical_affected: proposalRow.business_critical_affected,
            linked_open_incidents: proposalRow.linked_open_incidents,
            status: proposalRow.status,
            incident: proposalRow.incident,
          }
        : null,
    ),
  );
});

route('GET', '/api/major-proposals', async (context) => {
  await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const rows = await query<{
    id: string;
    ci: string;
    reason: string;
    business_critical_affected: number;
    linked_open_incidents: number;
    status: string;
    incident: string | null;
  }>(`SELECT * FROM major_proposal ORDER BY id DESC`);
  return ok({
    proposals: rows.map((r) => ({
      id: Number(r.id),
      ci: r.ci,
      reason: r.reason,
      business_critical_affected: r.business_critical_affected,
      linked_open_incidents: r.linked_open_incidents,
      status: r.status,
      incident: r.incident,
    })),
  });
});

route('POST', '/api/major-proposals/:id/promote', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const row = (
    await query<{ id: string; ci: string; status: string }>(`SELECT * FROM major_proposal WHERE id = $1`, [
      Number(params.id),
    ])
  )[0];
  if (!row) throw notFound();
  if (row.status !== 'open') throw conflict('proposal_closed', 'This proposal is already closed.');

  const impact = engine.impact(row.ci);
  const children = impact ? openIncidentsOn(engine, impact) : [];
  const result = await createRecord(engine, caller, {
    table: 'incident',
    fields: {
      short_description: `Outage: ${row.ci}`,
      configuration_item: row.ci,
      is_major: true,
      impact: 1,
      urgency: 1,
    },
    runAssignment: false,
  });
  await transaction(async (client) => {
    await client.query(`UPDATE major_proposal SET status = 'promoted', incident = $2 WHERE id = $1`, [
      Number(params.id),
      result.record.number,
    ]);
    for (const child of children) {
      await client.query(
        `UPDATE record SET fields = jsonb_set(fields, '{parent}', $2::jsonb) WHERE number = $1`,
        [child.number, JSON.stringify(result.record.number)],
      );
      await client.query(
        `INSERT INTO record_link (parent, child) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [result.record.number, child.number],
      );
      await insertActivity(
        client,
        result.record.number,
        now(),
        'link',
        `Linked ${child.number} as a child.`,
        caller.actor,
      );
    }
  });
  // Priority 1 is the published value for a promoted major incident.
  await query(
    `UPDATE record SET fields = jsonb_set(fields, '{priority}', '1'::jsonb) WHERE number = $1`,
    [result.record.number],
  );
  publish({ topic: 'major:proposals', event: 'promoted', data: { incident: result.record.number } });
  const refreshed = await Engine.load(engine.workspace);
  const record = refreshed.records.get(result.record.number);
  if (!record) throw notFound();
  return created({ record: await recordJson(refreshed, caller, record, await refreshed.slasOf(record)) });
});

route('POST', '/api/major-proposals/:id/reject', async (context, params) => {
  await engineFor(context);
  requireOperator(context);
  const row = (
    await query<{ id: string; status: string }>(`SELECT * FROM major_proposal WHERE id = $1`, [Number(params.id)])
  )[0];
  if (!row) throw notFound();
  if (row.status !== 'open') throw conflict('proposal_closed', 'This proposal is already closed.');
  await query(`UPDATE major_proposal SET status = 'rejected' WHERE id = $1`, [Number(params.id)]);
  return ok({ proposal: { id: Number(row.id), status: 'rejected', reason: String(context.body.reason ?? '') } });
});

route('POST', '/api/records/:number/children', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const parent = engine.requireVisible(caller, params.number);
  const numbers = Array.isArray(context.body.numbers) ? context.body.numbers.map(String) : [];
  await transaction(async (client) => {
    for (const number of numbers) {
      const child = engine.records.get(number);
      if (!child) throw validation(`${number} is not a record.`, { numbers: `${number} is not a record.` });
      await client.query(
        `UPDATE record SET fields = jsonb_set(fields, '{parent}', $2::jsonb) WHERE number = $1`,
        [number, JSON.stringify(parent.number)],
      );
      await client.query(`INSERT INTO record_link (parent, child) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        parent.number,
        number,
      ]);
    }
  });
  const refreshed = await Engine.load(engine.workspace);
  const record = refreshed.records.get(parent.number);
  if (!record) throw notFound();
  return ok({ record: await recordJson(refreshed, caller, record, await refreshed.slasOf(record)) });
});

route('DELETE', '/api/records/:number/children/:child', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  engine.requireVisible(caller, params.number);
  await transaction(async (client) => {
    await client.query(
      `UPDATE record SET fields = jsonb_set(fields, '{parent}', 'null'::jsonb) WHERE number = $1`,
      [params.child],
    );
    await client.query(`DELETE FROM record_link WHERE parent = $1 AND child = $2`, [
      params.number,
      params.child,
    ]);
  });
  return ok({ removed: params.child });
});

route('GET', '/api/records/:number/timeline', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  return ok({ entries: await timelineOf(record.number) });
});

async function timelineOf(number: string): Promise<Record<string, unknown>[]> {
  const rows = await query<{ at: Date; actor: string | null; kind: string; text: string }>(
    `SELECT at, actor, kind, text FROM record_activity
     WHERE number = $1 AND kind IN ('work_note', 'state', 'link', 'resolution', 'approval')
     ORDER BY id DESC`,
    [number],
  );
  return rows.map((r) => ({ at: iso(r.at), actor: r.actor, kind: r.kind, text: r.text }));
}

route('GET', '/api/major/:number', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const record = engine.requireVisible(caller, params.number);
  const itemName = typeof record.fields.configuration_item === 'string' ? record.fields.configuration_item : null;
  const impact = itemName ? engine.impact(itemName) : null;
  const children = [...engine.records.values()].filter((r) => r.fields.parent === record.number);
  return ok({
    record: await recordJson(engine, caller, record, await engine.slasOf(record)),
    impact: impact ? impactJson(engine, impact, null) : null,
    panels: impact ? relayPanels(impact) : [],
    children: await Promise.all(
      children.map(async (child) => recordSummary(engine, caller, child, await engine.slasOf(child))),
    ),
    timeline: await timelineOf(record.number),
  });
});

route('POST', '/api/records/:number/incidents', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const problem = engine.requireVisible(caller, params.number);
  const numbers = Array.isArray(context.body.numbers) ? context.body.numbers.map(String) : [];
  await transaction(async (client) => {
    for (const number of numbers) {
      await client.query(
        `UPDATE record SET fields = jsonb_set(fields, '{problem}', $2::jsonb) WHERE number = $1`,
        [number, JSON.stringify(problem.number)],
      );
    }
  });
  const refreshed = await Engine.load(engine.workspace);
  const record = refreshed.records.get(problem.number);
  if (!record) throw notFound();
  return ok({ record: await recordJson(refreshed, caller, record, await refreshed.slasOf(record)) });
});

route('POST', '/api/records/:number/workaround', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const problem = engine.requireVisible(caller, params.number);
  const text = String(context.body.text ?? '');
  if (text.trim() === '') throw validation('A workaround needs text.', { text: 'A workaround needs text.' });
  const linked = [...engine.records.values()].filter(
    (r) => r.table === 'incident' && r.fields.problem === problem.number && isOpenState('incident', r.state),
  );
  await transaction(async (client) => {
    await client.query(
      `UPDATE record SET fields = jsonb_set(fields, '{workaround}', $2::jsonb),
              versions = jsonb_set(versions, '{workaround}', to_jsonb(coalesce((versions->>'workaround')::int, 1) + 1))
       WHERE number = $1`,
      [problem.number, JSON.stringify(text)],
    );
    for (const incident of linked) {
      const assignee = incident.fields.assigned_to;
      if (typeof assignee !== 'string') continue;
      const delivered = await deliver(
        client,
        engine.inboxRules,
        engine.people,
        'workaround_published',
        [assignee],
        eventTexts.workaround_published(problem.number, incident.number),
        incident.number,
      );
      for (const username of delivered) {
        publish({
          topic: 'inbox',
          event: 'unread',
          data: { username, unread: await unreadCount(client, username) },
        });
      }
    }
  });
  for (const incident of linked) {
    publish({
      topic: `record:${incident.number}`,
      event: 'workaround',
      data: { problem: problem.number, text },
    });
  }
  const refreshed = await Engine.load(engine.workspace);
  const record = refreshed.records.get(problem.number);
  if (!record) throw notFound();
  return ok({ record: await recordJson(refreshed, caller, record, await refreshed.slasOf(record)) });
});

export { transitionRecord, nowMs, ApiError, type FieldSave };
