import type { Value } from "../shared/expression.js";
import { settings } from "./config.js";
import type { Env } from "./env.js";
import { ApiError, fail, notFound, validation } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish } from "./live.js";
import { Graph, type Impact } from "./map.js";
import { addActivity, findRecord, nowIso, save, summarize, type SummaryJson } from "./records.js";
import { toRecord, type RecordObj } from "./world.js";

const OPEN_INCIDENT = ["new", "assigned", "in_progress", "on_hold"];
const CLOSED = ["resolved", "closed", "cancelled"];

export interface ProposalJson {
  id: number;
  ci: string;
  reason: string;
  business_critical_affected: number;
  linked_open_incidents: string[];
  status: "open" | "promoted" | "rejected";
  incident: string | null;
}

function proposalOf(row: Record<string, unknown>): ProposalJson {
  return {
    id: row.id as number,
    ci: row.ci as string,
    reason: row.reason as string,
    business_critical_affected: row.business_critical_affected as number,
    linked_open_incidents: row.linked_open_incidents as string[],
    status: row.status as ProposalJson["status"],
    incident: (row.incident as string | null) ?? null,
  };
}

export async function listProposals(env: Env): Promise<ProposalJson[]> {
  return (await env.tx.query("SELECT * FROM proposals ORDER BY id")).map(proposalOf);
}

export async function openProposalFor(env: Env, ci: string): Promise<ProposalJson | null> {
  const rows = await env.tx.query("SELECT * FROM proposals WHERE ci = $1 AND status = 'open' ORDER BY id DESC LIMIT 1", [ci]);
  return rows[0] ? proposalOf(rows[0]) : null;
}

async function openIncidentsOn(env: Env, items: string[]): Promise<string[]> {
  const rows = await env.tx.query("SELECT number FROM records WHERE table_name = 'incident' AND fields->>'configuration_item' = ANY($1) AND fields->>'state' = ANY($2) ORDER BY number", [items, OPEN_INCIDENT]);
  return rows.map((r) => r.number as string);
}

/** An outage that reaches the published threshold proposes a major incident for the operator. */
export async function proposeIfNeeded(env: Env, impact: Impact): Promise<ProposalJson | null> {
  const existing = await openProposalFor(env, impact.ci);
  if (existing) return existing;
  const linked = await openIncidentsOn(env, [impact.ci, ...impact.affectedNames]);
  const services = impact.business_critical_affected;
  let reason: string | null = null;
  if (services >= settings.MAJOR_PROPOSAL_SERVICES) reason = `${services} business-critical services affected`;
  else if (impact.affectedNames.length > 0 && linked.length >= settings.MAJOR_PROPOSAL_INCIDENTS) reason = `${linked.length} open incidents on affected items`;
  if (!reason) return null;
  const rows = await env.tx.query(
    "INSERT INTO proposals (ci, reason, business_critical_affected, linked_open_incidents, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [impact.ci, reason, services, JSON.stringify(linked), nowIso()],
  );
  const operators = (await env.tx.query("SELECT username FROM users WHERE 'operator' = ANY(roles)")).map((r) => r.username as string);
  await deliver(env.tx, "major_incident_proposed", operators, `Major incident proposed for ${impact.ci}: ${reason}.`);
  return proposalOf(rows[0]!);
}

export async function promote(env: Env, id: number): Promise<RecordObj> {
  const rows = await env.tx.query("SELECT * FROM proposals WHERE id = $1 FOR UPDATE", [id]);
  if (!rows[0]) return notFound();
  const proposal = proposalOf(rows[0]);
  if (proposal.status !== "open") fail(409, "proposal_closed", "This proposal has already been decided.");
  const graph = await Graph.load(env.world, env.tx);
  const impact = graph.impact(proposal.ci);
  const linked = await openIncidentsOn(env, [proposal.ci, ...impact.affectedNames]);
  const major = await save(env, {
    table: "incident",
    number: null,
    submitted: {
      short_description: { value: `Outage: ${proposal.ci}` },
      configuration_item: { value: proposal.ci },
      impact: { value: 1 },
      urgency: { value: 1 },
      is_major: { value: true },
    },
    system: true,
  });
  await linkChildren(env, major.number, linked);
  await env.tx.query("UPDATE proposals SET status = 'promoted', incident = $2 WHERE id = $1", [id, major.number]);
  return (await findRecord(env.tx, major.number))!;
}

export async function reject(env: Env, id: number, reason: string): Promise<ProposalJson> {
  const rows = await env.tx.query("SELECT * FROM proposals WHERE id = $1 FOR UPDATE", [id]);
  if (!rows[0]) return notFound();
  if (rows[0].status !== "open") fail(409, "proposal_closed", "This proposal has already been decided.");
  const updated = await env.tx.query("UPDATE proposals SET status = 'rejected', reject_reason = $2 WHERE id = $1 RETURNING *", [id, reason]);
  return proposalOf(updated[0]!);
}

export async function linkChildren(env: Env, parent: string, numbers: string[]): Promise<void> {
  for (const number of numbers) {
    if (number === parent) validation("An incident cannot be its own child.");
    const child = await findRecord(env.tx, number);
    if (!child || child.table !== "incident") validation(`Unknown incident "${number}".`, { numbers: `Unknown incident "${number}".` });
    await save(env, { table: "incident", number, submitted: { parent: { value: parent } }, system: true });
    await addActivity(env, parent, "child", `Linked ${number}.`, { system: true });
  }
  publish(`major:${parent}`, "changed", {});
}

export async function unlinkChild(env: Env, parent: string, child: string): Promise<void> {
  const rec = await findRecord(env.tx, child);
  if (!rec || rec.fields.parent !== parent) return notFound();
  await save(env, { table: "incident", number: child, submitted: { parent: { value: null } }, system: true });
  await addActivity(env, parent, "child", `Unlinked ${child}.`, { system: true });
}

/** Resolving a major incident resolves every open child in the same transaction, or fails them all. */
export async function resolveOpenChildren(env: Env, parent: RecordObj, depth: number): Promise<void> {
  const rows = await env.tx.query("SELECT * FROM records WHERE table_name = 'incident' AND fields->>'parent' = $1 AND NOT (fields->>'state' = ANY($2)) ORDER BY id", [parent.number, CLOSED]);
  const note = `Resolved with major incident ${parent.number}: ${String(parent.fields.resolution_note ?? "")}`;
  for (const child of rows.map(toRecord)) {
    try {
      await save(env, {
        table: "incident",
        number: child.number,
        submitted: { resolution_code: { value: parent.fields.resolution_code ?? null }, resolution_note: { value: note } },
        to: "resolved",
        force: true,
        system: true,
        depth,
      });
    } catch (error) {
      if (error instanceof ApiError) fail(422, "child_failed", `Child ${child.number} could not be resolved: ${error.message.replace(/\.$/, "")}.`);
      throw error;
    }
  }
  await addActivity(env, parent.number, "resolution", `Resolved with code ${String(parent.fields.resolution_code)}: ${String(parent.fields.resolution_note ?? "")}`);
}

export async function checkFixDone(env: Env, existing: RecordObj, next: Record<string, Value>): Promise<void> {
  const fix = typeof next.fix_change === "string" ? await findRecord(env.tx, next.fix_change) : null;
  if (!fix || fix.fields.state !== "done") fail(422, "fix_not_done", `The fix change ${String(next.fix_change ?? existing.fields.fix_change)} is not done yet.`);
}

export async function checkNoOpenIncidents(env: Env, problem: RecordObj): Promise<void> {
  const rows = await env.tx.query("SELECT count(*)::int AS n FROM records WHERE table_name = 'incident' AND fields->>'problem' = $1 AND NOT (fields->>'state' = ANY($2))", [problem.number, CLOSED]);
  const open = rows[0]!.n as number;
  if (open > 0) fail(422, "open_incidents", `Resolve or close the ${open} linked open incidents before closing this problem.`);
}

/** A fix change that is Done and successful resolves the problems waiting on it. */
export async function afterFixChangeDone(env: Env, rec: RecordObj, previous: RecordObj | null): Promise<void> {
  if (rec.table !== "change" || rec.fields.state !== "done" || rec.fields.outcome !== "successful" || previous?.fields.state === "done") return;
  const rows = await env.tx.query("SELECT number FROM records WHERE table_name = 'problem' AND fields->>'fix_change' = $1 AND fields->>'state' = 'fix_in_progress'", [rec.number]);
  for (const row of rows) {
    await save(env, { table: "problem", number: row.number as string, submitted: {}, to: "resolved", system: true });
    await addActivity(env, row.number as string, "system", `Resolved by fix change ${rec.number}.`, { system: true });
  }
}

export async function linkIncidents(env: Env, problem: string, numbers: string[]): Promise<void> {
  for (const number of numbers) {
    const rec = await findRecord(env.tx, number);
    if (!rec || rec.table !== "incident") validation(`Unknown incident "${number}".`, { numbers: `Unknown incident "${number}".` });
    await save(env, { table: "incident", number, submitted: { problem: { value: problem } }, system: true });
  }
}

export async function publishWorkaround(env: Env, problem: string, text: string): Promise<void> {
  if (text.trim() === "") validation("Write the workaround steps.", { text: "Workaround is required." });
  await save(env, { table: "problem", number: problem, submitted: { workaround: { value: text } } });
  const rows = await env.tx.query("SELECT * FROM records WHERE table_name = 'incident' AND fields->>'problem' = $1 AND NOT (fields->>'state' = ANY($2))", [problem, CLOSED]);
  for (const incident of rows.map(toRecord)) {
    await deliver(env.tx, "workaround_published", [incident.fields.assigned_to as string | null], `A workaround was published on ${problem} for ${incident.number}.`, incident.number);
    env.tx.after.push(() => publish(`record:${incident.number}`, "changed", { number: incident.number }));
  }
}

export interface TimelineEntry {
  at: string;
  actor: string | null;
  kind: string;
  text: string;
}

export async function timeline(env: Env, number: string): Promise<TimelineEntry[]> {
  const rows = await env.tx.query("SELECT at, actor, kind, text FROM activity WHERE record_number = $1 AND kind = ANY($2) ORDER BY id DESC", [number, ["work_note", "state", "child", "resolution"]]);
  return rows.map((r) => ({ at: r.at as string, actor: r.actor ? env.world.displayName(r.actor as string) : null, kind: r.kind as string, text: r.text as string }));
}

export interface MajorView {
  record: RecordObj;
  impact: Omit<Impact, "affectedNames"> & { proposal: ProposalJson | null };
  children: SummaryJson[];
  timeline: TimelineEntry[];
}

export async function impactJson(env: Env, name: string, asStatus?: "down" | "degraded"): Promise<MajorView["impact"]> {
  const graph = await Graph.load(env.world, env.tx);
  const { affectedNames: _names, ...impact } = graph.impact(name, asStatus);
  return { ...impact, proposal: await openProposalFor(env, name) };
}

export async function majorView(env: Env, rec: RecordObj): Promise<MajorView> {
  const access = await env.access();
  const children = (await env.tx.query("SELECT * FROM records WHERE table_name = 'incident' AND fields->>'parent' = $1 ORDER BY id", [rec.number])).map(toRecord).filter((c) => access.canRead(c));
  const item = typeof rec.fields.configuration_item === "string" ? rec.fields.configuration_item : null;
  const impact = item ? await impactJson(env, item) : { ci: "", status: "healthy", base_people: 0, affected: [], degraded: [], people_total: 0, business_critical_affected: 0, proposal: null };
  return { record: rec, impact, children: await summarize(env, children), timeline: await timeline(env, rec.number) };
}
