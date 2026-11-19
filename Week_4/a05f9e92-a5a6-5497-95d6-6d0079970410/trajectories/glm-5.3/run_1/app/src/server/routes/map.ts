// Service map endpoints: items, relationships, layout, status, impact.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock } from '../db.js';
import { CiClass, CLASS_LABEL, RELATIONSHIP_TYPES, RelationshipType, DEPENDENCY_TYPES, CiNode, Edge, MaintenanceWindow, computeLayout, effectiveStatuses, computeImpact, findCycle, attributesFor, CLASS_ATTRIBUTES, CLASS_PARENT } from '../servicemap.js';
import { loadCis, loadEdges, loadMaintenance, departmentMembers } from './mapload.js';

export { loadCis };


export async function map(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  if (path === '/api/cis' && method === 'GET') return cisList(route, user);
  if (path === '/api/cis' && method === 'POST') return ciCreate(route, user);
  const ciMatch = /^\/api\/cis\/([^/]+)$/.exec(path);
  if (ciMatch && method === 'GET') return ciRead(route, user, ciMatch[1]);
  if (ciMatch && method === 'PATCH') return ciUpdate(route, user, ciMatch[1]);

  if (path === '/api/relationships' && method === 'POST') return relationshipCreate(route, user);
  if (path === '/api/relationships' && method === 'DELETE') return relationshipDelete(route, user);

  if (path === '/api/service-map' && method === 'GET') return serviceMapRead(route, user);

  const statusMatch = /^\/api\/cis\/([^/]+)\/status$/.exec(path);
  if (statusMatch && method === 'POST') return ciStatus(route, user, statusMatch[1]);

  const maintenanceMatch = /^\/api\/cis\/([^/]+)\/maintenance$/.exec(path);
  if (maintenanceMatch && method === 'POST') return maintenanceCreate(route, user, maintenanceMatch[1]);

  const impactMatch = /^\/api\/cis\/([^/]+)\/impact$/.exec(path);
  if (impactMatch && method === 'GET') return impactRead(route, user, impactMatch[1]);

  // Major incidents
  if (path === '/api/major-proposals' && method === 'GET') return proposalsList(route, user);
  const promoteMatch = /^\/api\/major-proposals\/(\d+)\/promote$/.exec(path);
  if (promoteMatch && method === 'POST') return proposalPromote(route, user, Number(promoteMatch[1]));
  const rejectMatch = /^\/api\/major-proposals\/(\d+)\/reject$/.exec(path);
  if (rejectMatch && method === 'POST') return proposalReject(route, user, Number(rejectMatch[1]));

  const childrenMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/children$/.exec(path);
  if (childrenMatch && method === 'POST') return childrenAdd(route, user, childrenMatch[1]);
  const childMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/children\/([A-Za-z]+-\d+)$/.exec(path);
  if (childMatch && method === 'DELETE') return childRemove(route, user, childMatch[1], childMatch[2]);

  const timelineMatch = /^\/api\/records\/([A-Za-z]+-\d+)\/timeline$/.exec(path);
  if (timelineMatch && method === 'GET') return timelineRead(route, user, timelineMatch[1]);
  const majorMatch = /^\/api\/major\/([A-Za-z]+-\d+)$/.exec(path);
  if (majorMatch && method === 'GET') return majorRead(route, user, majorMatch[1]);

  const incidentsMatch = /^\/api\/records\/(ROOT-\d+)\/incidents$/.exec(path);
  if (incidentsMatch && method === 'POST') return problemIncidents(route, user, incidentsMatch[1]);
  const workaroundMatch = /^\/api\/records\/(ROOT-\d+)\/workaround$/.exec(path);
  if (workaroundMatch && method === 'POST') return problemWorkaround(route, user, workaroundMatch[1]);

  return false;
}

function isDeskOrManager(user: SessionUser): boolean {
  return user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('manager');
}



async function cisList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const cis = await loadCis(route.ctx.db);
  const statuses = effectiveStatuses(cis, await loadEdges(route.ctx.db), await loadMaintenance(route.ctx.db), clock.nowMs());
  sendJson(route.res, 200, {
    cis: cis.map(c => ciView(c, statuses.get(c.name) ?? 'healthy')),
  });
  return true;
}

function ciView(c: CiNode, effective: string): unknown {
  return {
    id: c.name.toLowerCase(),
    name: c.name,
    class: c.class,
    criticality: c.criticality,
    business_critical: c.business_critical,
    owner_department: c.owner_department,
    status: c.status,
    effective_status: effective,
    attributes: c.attributes,
    used_by: { departments: c.used_by_departments, people: c.used_by_people },
  };
}

async function ciCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const cls = String(body.class) as CiClass;
  if (!CLASS_LABEL[cls]) throw new ApiError(422, 'validation', 'Unknown class.');
  // A class may not redefine an inherited attribute.
  for (const key of Object.keys(body)) {
    if (inheritedAttribute(cls, key)) {
      throw new ApiError(422, 'validation', `Class ${CLASS_LABEL[cls]} already defines ${key}.`);
    }
  }
  const attributes = (body.attributes ?? {}) as Record<string, unknown>;
  await route.ctx.db.query(
    `INSERT INTO cis(name, "class", criticality, business_critical, owner_department, status, attributes, used_by_departments, used_by_people)
     VALUES ($1,$2,$3,$4,$5,'healthy',$6,$7,$8)`,
    [body.name, cls, Number(body.criticality ?? 3), Boolean(body.business_critical ?? false),
     body.owner_department ?? null, JSON.stringify(attributes),
     (body.used_by as { departments?: string[] } | undefined)?.departments ?? [],
     (body.used_by as { people?: string[] } | undefined)?.people ?? []],
  );
  sendJson(route.res, 201, { ci: { name: body.name } });
  return true;
}

function inheritedAttribute(cls: CiClass, key: string): boolean {
  let cur: CiClass | null = CLASS_PARENT[cls];
  while (cur) {
    if (CLASS_ATTRIBUTES[cur].includes(key)) return true;
    cur = CLASS_PARENT[cur];
  }
  return false;
}

async function ciRead(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const res = await route.ctx.db.query(`SELECT * FROM cis WHERE name = $1`, [name]);
  if (!res.rows.length) throw notFound();
  const cis = await loadCis(route.ctx.db);
  const node = cis.find(c => c.name.toLowerCase() === name.toLowerCase());
  const statuses = effectiveStatuses(cis, await loadEdges(route.ctx.db), await loadMaintenance(route.ctx.db), clock.nowMs());
  if (!node) throw notFound();
  sendJson(route.res, 200, { ci: ciView(node, statuses.get(node.name) ?? 'healthy') });
  return true;
}

async function ciUpdate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const body = route.body;
  const sets: string[] = [];
  const params: unknown[] = [name];
  const add = (key: string, column: string, value: unknown): void => {
    if (!(key in body)) return;
    params.push(value);
    sets.push(`"${column}" = $${params.length}`);
  };
  add('criticality', 'criticality', body.criticality);
  add('business_critical', 'business_critical', body.business_critical);
  add('owner_department', 'owner_department', body.owner_department);
  if ('attributes' in body) { params.push(JSON.stringify(body.attributes)); sets.push(`attributes = $${params.length}`); }
  const usedBy = body.used_by as { departments?: string[]; people?: string[] } | undefined;
  if (usedBy) {
    params.push(usedBy.departments ?? []); sets.push(`used_by_departments = $${params.length}`);
    params.push(usedBy.people ?? []); sets.push(`used_by_people = $${params.length}`);
  }
  if (sets.length) {
    await route.ctx.db.query(`UPDATE cis SET ${sets.join(', ')} WHERE name = $1`, params);
  }
  const res = await route.ctx.db.query(`SELECT * FROM cis WHERE name = $1`, [name]);
  if (!res.rows.length) throw notFound();
  sendJson(route.res, 200, { ci: res.rows[0] });
  return true;
}

async function relationshipCreate(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const { source, type, target } = route.body as { source: string; type: string; target: string };
  if (!RELATIONSHIP_TYPES.includes(type as RelationshipType)) {
    throw new ApiError(422, 'validation', 'Unknown relationship type.');
  }
  // A dependency relationship that would form a loop is refused with the chain.
  if (DEPENDENCY_TYPES.includes(type as RelationshipType)) {
    const cycle = findCycle(source, target, await loadEdges(route.ctx.db));
    if (cycle) {
      throw new ApiError(422, 'cycle', `This relationship would form a dependency loop: ${cycle.join(' -> ')}.`);
    }
  }
  await route.ctx.db.query(`INSERT INTO relationships(source, type, target) VALUES ($1,$2,$3)`, [source, type, target]);
  sendJson(route.res, 201, { relationship: { source, type, target } });
  return true;
}

async function relationshipDelete(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const { source, type, target } = route.body as { source: string; type: string; target: string };
  await route.ctx.db.query(`DELETE FROM relationships WHERE source = $1 AND type = $2 AND target = $3`, [source, type, target]);
  route.res.writeHead(204);
  route.res.end();
  return true;
}

async function serviceMapRead(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const cis = await loadCis(route.ctx.db);
  const edges = await loadEdges(route.ctx.db);
  const maintenance = await loadMaintenance(route.ctx.db);
  const statuses = effectiveStatuses(cis, edges, maintenance, clock.nowMs());
  const layout = computeLayout(cis, edges);

  const nodes = layout.nodes.map(n => {
    const node = cis.find(c => c.name === n.name)!;
    return {
      name: n.name,
      class: node.class,
      status: statuses.get(n.name) ?? 'healthy',
      layer: n.layer,
      x: n.x,
      y: n.y,
    };
  });
  sendJson(route.res, 200, {
    nodes,
    edges: edges.map(e => ({ source: e.source, type: e.type, target: e.target })),
  });
  return true;
}

async function ciStatus(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const status = String(route.body.status);
  if (!['down', 'degraded', 'healthy'].includes(status)) {
    throw new ApiError(422, 'validation', 'Unknown status.');
  }
  await route.ctx.db.query(`UPDATE cis SET status = $2 WHERE name = $1`, [name, status]);

  const cis = await loadCis(route.ctx.db);
  const edges = await loadEdges(route.ctx.db);
  const maintenance = await loadMaintenance(route.ctx.db);
  const failed = cis.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!failed) throw notFound();
  const impact = computeImpact(failed, cis, edges, maintenance, clock.nowMs(), await departmentMembers(route.ctx.db));

  // An outage proposes a major incident at the published threshold.
  await checkProposal(route, failed, impact);

  sendJson(route.res, 200, {
    ci: ciView(failed, effectiveStatuses(cis, edges, maintenance, clock.nowMs()).get(failed.name) ?? 'healthy'),
    impact: impactView(impact),
  });
  return true;
}

function impactView(impact: ReturnType<typeof computeImpact>): unknown {
  return {
    ci: impact.ci,
    status: impact.status,
    base_people: impact.base_people,
    affected: impact.affected.map(p => ({
      ci: { name: p.ci.name, class: p.ci.class, criticality: p.ci.criticality, business_critical: p.ci.business_critical },
      path: p.path,
      tier: p.tier,
      people_added: p.people_added,
      running_people: p.running_people,
    })),
    degraded: impact.degraded,
    people_total: impact.people_total,
    business_critical_affected: impact.business_critical_affected,
    proposal: null,
  };
}

async function checkProposal(route: RouteContext, failed: CiNode, impact: ReturnType<typeof computeImpact>): Promise<void> {
  const servicesThreshold = Number(route.ctx.settings.get('MAJOR_PROPOSAL_SERVICES') ?? 2);
  const incidentsThreshold = Number(route.ctx.settings.get('MAJOR_PROPOSAL_INCIDENTS') ?? 3);

  const businessCritical = impact.affected.filter(p => p.ci.business_critical && p.ci.class === 'business_service').length;
  const affectedNames = [failed.name, ...impact.affected.map(p => p.ci.name)];
  const openStates = ['new', 'assigned', 'in_progress', 'on_hold'];
  const placeholders = affectedNames.map((_, i) => `$${i + 2}`).join(',');
  const openIncidents = await route.ctx.db.query(
    `SELECT count(*)::int AS n FROM records WHERE "table" = 'incident' AND state = ANY($1) AND fields->>'configuration_item' IN (${placeholders})`,
    [openStates, ...affectedNames],
  );
  const openCount = Number(openIncidents.rows[0].n);

  const reason = businessCritical >= servicesThreshold
    ? `${businessCritical} business-critical services affected`
    : openCount >= incidentsThreshold
      ? `${openCount} open incidents on affected items`
      : null;

  // Reject any open proposal for the same item first.
  await route.ctx.db.query(
    `UPDATE major_proposals SET status = 'rejected' WHERE ci = $1 AND status = 'open'`,
    [failed.name],
  );

  if (reason) {
    const insert = await route.ctx.db.query(
      `INSERT INTO major_proposals(ci, reason, business_critical_affected, linked_open_incidents, status)
       VALUES ($1,$2,$3,$4,'open') RETURNING id`,
      [failed.name, reason, businessCritical, openCount],
    );
    const { deliver, loadRules } = await import('./inboxdata.js');
    const rules = await loadRules(route.ctx.db);
    await deliver(route.ctx.db, rules, 'major_incident_proposed', 'oona', `Major incident proposed for ${failed.name}: ${reason}.`, null);
    route.ctx.live.publish('inbox', 'updated', {});
    void insert;
  }
}

export async function computeImpactForCi(db: RouteContext['ctx']['db'], name: string): Promise<{ people_total: number; business_critical_affected: number }> {
  const cis = await loadCis(db);
  const edges = await loadEdges(db);
  const maintenance = await loadMaintenance(db);
  const failed = cis.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!failed) return { people_total: 0, business_critical_affected: 0 };
  const impact = computeImpact(failed, cis, edges, maintenance, clock.nowMs(), await departmentMembers(db));
  return { people_total: impact.people_total, business_critical_affected: impact.business_critical_affected };
}

async function maintenanceCreate(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const start = Date.parse(String(route.body.start));
  const end = Date.parse(String(route.body.end));
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new ApiError(422, 'validation', 'Start must be before end.');
  }
  const res = await route.ctx.db.query(
    `INSERT INTO maintenance_windows(ci, start, "end") VALUES ($1,$2,$3) RETURNING id`,
    [name, new Date(start), new Date(end)],
  );
  sendJson(route.res, 201, { window: { id: Number(res.rows[0].id), ci: name, start: new Date(start).toISOString(), end: new Date(end).toISOString() } });
  return true;
}

async function impactRead(route: RouteContext, user: SessionUser, name: string): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const cis = await loadCis(route.ctx.db);
  const edges = await loadEdges(route.ctx.db);
  const maintenance = await loadMaintenance(route.ctx.db);
  const failed = cis.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!failed) throw notFound();
  const impact = computeImpact(failed, cis, edges, maintenance, clock.nowMs(), await departmentMembers(route.ctx.db));
  const open = await route.ctx.db.query(`SELECT status, incident FROM major_proposals WHERE ci = $1 AND status = 'open' LIMIT 1`, [failed.name]);
  const view = impactView(impact) as { proposal: unknown };
  view.proposal = open.rows.length ? { id: Number(open.rows[0].id), ci: failed.name, status: open.rows[0].status } : null;
  sendJson(route.res, 200, view);
  return true;
}

async function proposalsList(route: RouteContext, user: SessionUser): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const res = await route.ctx.db.query(`SELECT * FROM major_proposals ORDER BY id DESC`);
  sendJson(route.res, 200, {
    proposals: res.rows.map((r: Record<string, unknown>) => ({
      id: Number(r.id), ci: r.ci, reason: r.reason,
      business_critical_affected: Number(r.business_critical_affected),
      linked_open_incidents: Number(r.linked_open_incidents),
      status: r.status, incident: r.incident,
    })),
  });
  return true;
}

async function proposalPromote(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT * FROM major_proposals WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  const proposal = res.rows[0];
  if (proposal.status !== 'open') throw new ApiError(409, 'proposal_closed', 'This proposal is already closed.');

  const { createRecord } = await import('../recordservice.js');
  const snap = await createRecord(route.ctx.db, 'incident', {
    short_description: `Outage: ${String(proposal.ci)}`,
    description: null,
    caller: user.username,
    affected_person: null,
    configuration_item: String(proposal.ci),
    impact: 1,
    urgency: 1,
    priority: 1,
    assignment_group: null,
    assigned_to: null,
    hold_reason: null,
    resolution_code: null,
    resolution_note: null,
    reopen_reason: null,
    cancel_reason: null,
    confidential: false,
    is_major: true,
    parent: null,
    problem: null,
  }, { username: user.username, actingFor: null }, 'live');

  // Link every open incident on the failed or affected items as a child.
  const cis = await loadCis(route.ctx.db);
  const edges = await loadEdges(route.ctx.db);
  const maintenance = await loadMaintenance(route.ctx.db);
  const failed = cis.find(c => c.name.toLowerCase() === String(proposal.ci).toLowerCase())!;
  const impact = computeImpact(failed, cis, edges, maintenance, clock.nowMs(), await departmentMembers(route.ctx.db));
  const affectedNames = [failed.name, ...impact.affected.map(p => p.ci.name)];
  const placeholders = affectedNames.map((_, i) => `$${i + 2}`).join(',');
  const children = await route.ctx.db.query(
    `SELECT number, state FROM records WHERE "table" = 'incident' AND state = ANY($1) AND fields->>'configuration_item' IN (${placeholders}) AND number != $${affectedNames.length + 2}`,
    [['new', 'assigned', 'in_progress', 'on_hold'], ...affectedNames, snap.number],
  );
  for (const child of children.rows) {
    await route.ctx.db.query(`INSERT INTO record_links(kind, parent, child) VALUES ('parent',$1,$2) ON CONFLICT DO NOTHING`, [snap.number, child.number]);
    await route.ctx.db.query(`UPDATE records SET fields = jsonb_set(fields, '{parent}', to_jsonb($2::text)) WHERE number = $1`, [child.number, snap.number]);
  }

  await route.ctx.db.query(`UPDATE major_proposals SET status = 'promoted', incident = $2 WHERE id = $1`, [id, snap.number]);
  sendJson(route.res, 201, { record: { number: snap.number } });
  return true;
}

async function proposalReject(route: RouteContext, user: SessionUser, id: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const res = await route.ctx.db.query(`SELECT * FROM major_proposals WHERE id = $1`, [id]);
  if (!res.rows.length) throw notFound();
  if (res.rows[0].status !== 'open') throw new ApiError(409, 'proposal_closed', 'This proposal is already closed.');
  await route.ctx.db.query(`UPDATE major_proposals SET status = 'rejected' WHERE id = $1`, [id]);
  sendJson(route.res, 200, { proposal: { id, status: 'rejected' } });
  return true;
}

async function childrenAdd(route: RouteContext, user: SessionUser, parent: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const numbers = (route.body.numbers ?? []) as string[];
  for (const child of numbers) {
    await route.ctx.db.query(`INSERT INTO record_links(kind, parent, child) VALUES ('parent',$1,$2) ON CONFLICT DO NOTHING`, [parent, child]);
    await route.ctx.db.query(`UPDATE records SET fields = jsonb_set(fields, '{parent}', to_jsonb($2::text)) WHERE number = $1`, [child, parent]);
  }
  const snap = await loadSnapshotFor(route, parent);
  sendJson(route.res, 200, { record: { number: snap.number, children: numbers } });
  return true;
}

async function childRemove(route: RouteContext, user: SessionUser, parent: string, child: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  await route.ctx.db.query(`DELETE FROM record_links WHERE kind = 'parent' AND parent = $1 AND child = $2`, [parent, child]);
  await route.ctx.db.query(`UPDATE records SET fields = fields - 'parent' WHERE number = $1`, [child]);
  route.res.writeHead(200);
  route.res.end();
  return true;
}

async function timelineRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  const snap = await loadSnapshotFor(route, number);
  const res = await route.ctx.db.query(
    `SELECT at, actor, acting_for, kind, text FROM activity WHERE record = $1 ORDER BY at DESC, id DESC`,
    [snap.number],
  );
  sendJson(route.res, 200, {
    timeline: res.rows.map((r: Record<string, unknown>) => ({
      at: new Date(r.at as Date).toISOString(),
      actor: String(r.actor),
      acting_for: r.acting_for ? String(r.acting_for) : null,
      kind: String(r.kind),
      text: String(r.text),
    })),
  });
  return true;
}

async function majorRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!isDeskOrManager(user)) throw forbidden();
  const snap = await loadSnapshotFor(route, number);
  const cis = await loadCis(route.ctx.db);
  const failed = cis.find(c => c.name.toLowerCase() === String(snap.fields.configuration_item ?? '').toLowerCase());
  const impact = failed ? computeImpact(failed, cis, await loadEdges(route.ctx.db), await loadMaintenance(route.ctx.db), clock.nowMs(), await departmentMembers(route.ctx.db)) : null;

  const childRows = await route.ctx.db.query(
    `SELECT child FROM record_links WHERE kind = 'parent' AND parent = $1 ORDER BY child`,
    [number],
  );
  const children: unknown[] = [];
  for (const row of childRows.rows) {
    const child = await loadSnapshotFor(route, String(row.child));
    const { summaryWithSla } = await import('./summary.js');
    children.push(await summaryWithSla(route, child));
  }

  const timeline = await route.ctx.db.query(
    `SELECT at, actor, acting_for, kind, text FROM activity WHERE record = $1 ORDER BY at DESC, id DESC`,
    [number],
  );
  sendJson(route.res, 200, {
    record: { number: snap.number, state: snap.state },
    impact: impact ? impactView(impact) : null,
    children,
    timeline: timeline.rows.map((r: Record<string, unknown>) => ({
      at: new Date(r.at as Date).toISOString(),
      actor: String(r.actor),
      acting_for: r.acting_for ? String(r.acting_for) : null,
      kind: String(r.kind),
      text: String(r.text),
    })),
  });
  return true;
}

async function problemIncidents(route: RouteContext, user: SessionUser, problem: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const numbers = (route.body.numbers ?? []) as string[];
  for (const incident of numbers) {
    await route.ctx.db.query(`INSERT INTO record_links(kind, parent, child) VALUES ('incident',$1,$2) ON CONFLICT DO NOTHING`, [problem, incident]);
    await route.ctx.db.query(`UPDATE records SET fields = jsonb_set(fields, '{problem}', to_jsonb($2::text)) WHERE number = $1`, [incident, problem]);
  }
  const snap = await loadSnapshotFor(route, problem);
  sendJson(route.res, 200, { record: { number: snap.number } });
  return true;
}

async function problemWorkaround(route: RouteContext, user: SessionUser, problem: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician'))) throw forbidden();
  const text = String(route.body.text ?? '');
  if (!text) throw new ApiError(422, 'validation', 'Text is required.');
  const snap = await loadSnapshotFor(route, problem);
  const merged = { ...snap.fields, workaround: text };
  await route.ctx.db.query(`UPDATE records SET fields = $2 WHERE number = $1`, [problem, JSON.stringify(merged)]);

  // The workaround shows on every linked open incident, and their assignees
  // get an inbox item.
  const incidents = await route.ctx.db.query(`SELECT child FROM record_links WHERE kind = 'incident' AND parent = $1`, [problem]);
  const { deliver, loadRules } = await import('./inboxdata.js');
  const rules = await loadRules(route.ctx.db);
  for (const incident of incidents.rows) {
    const child = String(incident.child);
    route.ctx.live.publish(`record:${child}`, 'workaround', { problem, text });
    const childSnap = await loadSnapshotFor(route, child);
    const assignee = childSnap.fields.assigned_to as string | null;
    if (assignee) {
      await deliver(route.ctx.db, rules, 'workaround_published', assignee, `A workaround was published on ${problem} for ${child}.`, child);
    }
  }
  route.ctx.live.publish('inbox', 'updated', {});
  sendJson(route.res, 200, { record: { number: problem, workaround: text } });
  return true;
}

async function loadSnapshotFor(route: RouteContext, number: string) {
  const { loadSnapshot } = await import('../recordengine.js');
  const snap = await loadSnapshot(route.ctx.db, number);
  if (!snap) throw notFound();
  return snap;
}
